#!/usr/bin/env python
"""
SAMC — Backup diário local das SMS.

Corre uma vez por dia (agendado via termux-job-scheduler, ver boot/samc-boot.sh).
NÃO precisa de internet: lê as SMS do telemóvel com termux-sms-list e grava
apenas as mensagens novas (desde o último backup) num ficheiro JSON em
backups/pending/. Esse ficheiro fica à espera de internet — quem o envia para
o Supabase é o backup/sync_supabase.py, corrido separadamente.

Uso manual:
    python backup/backup_diario.py
"""
import json
import os
import subprocess
import sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from estado import PENDING_DIR, agora_iso, carregar_estado, guardar_estado, log, obter_device_id

LIMITE_LEITURA = int(os.environ.get("SAMC_BACKUP_LIMITE", "20000"))
TIMEOUT_S      = int(os.environ.get("SAMC_BACKUP_TIMEOUT", "60"))


def ler_todas_sms(limite=LIMITE_LEITURA):
    """Lê até `limite` SMS (todos os tipos) via termux-sms-list."""
    cmd = ["termux-sms-list", f"--message-limit={limite}", "--message-type=all"]
    try:
        resultado = subprocess.run(cmd, capture_output=True, text=True, timeout=TIMEOUT_S)
    except FileNotFoundError:
        log("backup.log", "ERRO: termux-sms-list não encontrado (instala o pacote termux-api).")
        return None
    except subprocess.TimeoutExpired:
        log("backup.log", "ERRO: timeout a correr termux-sms-list.")
        return None

    stderr = (resultado.stderr or "").strip()
    if stderr:
        log("backup.log", f"aviso termux-sms-list: {stderr}")

    bruto = (resultado.stdout or "").strip()
    if not bruto:
        return []

    try:
        return json.loads(bruto)
    except json.JSONDecodeError as e:
        log("backup.log", f"ERRO: JSON inválido de termux-sms-list ({e}).")
        return None


def principal():
    mensagens = ler_todas_sms()
    if mensagens is None:
        sys.exit(1)

    estado = carregar_estado()
    ultimo_id = int(estado.get("ultimo_id") or 0)

    novas = [m for m in mensagens if int(m.get("_id", 0)) > ultimo_id]

    if not novas:
        log("backup.log", "sem mensagens novas desde o último backup.")
        estado["ultimo_backup_em"] = agora_iso()
        guardar_estado(estado)
        return

    maior_id = max(int(m.get("_id", 0)) for m in mensagens)

    carimbo = datetime.now().strftime("%Y%m%d_%H%M%S")
    caminho = os.path.join(PENDING_DIR, f"backup_{carimbo}.json")
    payload = {
        "device_id": obter_device_id(),
        "gerado_em": agora_iso(),
        "mensagens": novas,
    }
    with open(caminho, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    estado["ultimo_id"] = maior_id
    estado["ultimo_backup_em"] = agora_iso()
    guardar_estado(estado)

    log("backup.log", f"{len(novas)} mensagem(ns) nova(s) guardada(s) em {os.path.basename(caminho)}.")


if __name__ == "__main__":
    principal()
