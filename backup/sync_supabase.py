#!/usr/bin/env python
"""
SAMC — Sincronização dos backups pendentes com o Supabase.

Pensado para correr com frequência (ex: a cada 15 min) via termux-job-scheduler
com a restrição --network any — o Android só o executa quando há rede. Mesmo
assim o script volta a verificar a ligação por si (para o caso de correr
manualmente) e nunca falha "a barulho": se não houver internet ou o Supabase
estiver em baixo, sai em silêncio e tenta de novo na próxima corrida — nada é
perdido, os ficheiros continuam em backups/pending/.

Uso manual:
    python backup/sync_supabase.py
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from estado import ERRO_DIR, PENDING_DIR, SYNCED_DIR, agora_iso, carregar_estado, guardar_estado, log

import requests

SUPABASE_URL   = (os.environ.get("SUPABASE_URL") or "").rstrip("/")
SUPABASE_KEY   = os.environ.get("SUPABASE_KEY", "")  # usa a service_role key (fica só no .env, nunca no git)
SUPABASE_TABLE = os.environ.get("SUPABASE_TABLE", "sms_mensagens")
TIMEOUT_S      = int(os.environ.get("SAMC_SYNC_TIMEOUT", "15"))


def configurado():
    if not SUPABASE_URL or not SUPABASE_KEY:
        log("sync.log", "SUPABASE_URL / SUPABASE_KEY não definidos — a saltar sincronização.")
        return False
    return True


def tem_internet():
    """Testa a ligação fazendo um pedido leve ao próprio Supabase (evita depender de terceiros)."""
    try:
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/",
            headers={"apikey": SUPABASE_KEY},
            timeout=TIMEOUT_S,
        )
        return r.status_code < 500
    except requests.exceptions.RequestException:
        return False


def linhas_para_supabase(payload):
    device_id = payload.get("device_id", "desconhecido")
    linhas = []
    for m in payload.get("mensagens", []):
        linhas.append({
            "device_id":   device_id,
            "sms_id":      int(m.get("_id", 0)),
            "numero":      m.get("address") or m.get("sender") or "",
            "tipo":        m.get("type", ""),
            "corpo":       m.get("body", ""),
            "recebido_em": m.get("received", ""),
        })
    return linhas


def enviar_lote(linhas):
    url = f"{SUPABASE_URL}/rest/v1/{SUPABASE_TABLE}"
    headers = {
        "apikey":        SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type":  "application/json",
        # ON CONFLICT (device_id, sms_id) — ver sql/schema.sql — evita duplicados
        # se um ficheiro for reenviado por engano.
        "Prefer":        "resolution=merge-duplicates,return=minimal",
    }
    return requests.post(url, headers=headers, json=linhas, timeout=TIMEOUT_S)


def principal():
    if not configurado():
        return

    ficheiros = sorted(
        f for f in os.listdir(PENDING_DIR) if f.endswith(".json")
    )
    if not ficheiros:
        return

    if not tem_internet():
        log("sync.log", f"sem internet — {len(ficheiros)} ficheiro(s) por enviar, tenta-se depois.")
        return

    enviados, falhados = 0, 0
    for nome in ficheiros:
        caminho = os.path.join(PENDING_DIR, nome)
        try:
            with open(caminho, "r", encoding="utf-8") as f:
                payload = json.load(f)
        except (json.JSONDecodeError, OSError) as e:
            os.replace(caminho, os.path.join(ERRO_DIR, nome))
            log("sync.log", f"{nome}: ficheiro ilegível ({e}) — movido para backups/erro/.")
            falhados += 1
            continue

        linhas = linhas_para_supabase(payload)
        if not linhas:
            os.replace(caminho, os.path.join(SYNCED_DIR, nome))
            continue

        try:
            resp = enviar_lote(linhas)
        except requests.exceptions.RequestException as e:
            log("sync.log", f"ligação perdida a meio do envio ({e}) — tenta-se na próxima.")
            break  # rede pode ter caído; para e tenta tudo de novo depois

        if resp.status_code in (200, 201, 204):
            os.replace(caminho, os.path.join(SYNCED_DIR, nome))
            enviados += 1
        elif resp.status_code in (401, 403):
            log("sync.log", f"ERRO {resp.status_code}: credenciais Supabase inválidas — verifica SUPABASE_KEY.")
            break  # não adianta tentar os restantes ficheiros agora
        else:
            os.replace(caminho, os.path.join(ERRO_DIR, nome))
            log("sync.log", f"{nome}: Supabase respondeu {resp.status_code}: {resp.text[:300]} — movido para backups/erro/.")
            falhados += 1

    if enviados or falhados:
        log("sync.log", f"concluído: {enviados} ficheiro(s) sincronizado(s), {falhados} com erro.")
        estado = carregar_estado()
        estado["ultimo_sync_em"] = agora_iso()
        guardar_estado(estado)


if __name__ == "__main__":
    principal()
