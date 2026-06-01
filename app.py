"""
SAMC — Sistema de Análise de Mensagens Curtas — Flask Backend
Termux + Gemini + SSE streaming
"""

import subprocess, json, os
from datetime import datetime
from collections import Counter
from flask import Flask, render_template, request, jsonify, Response, stream_with_context
import requests as _req

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

app = Flask(__name__)
app.secret_key = os.urandom(24)

# ─── Config ──────────────────────────────────────────────────────────────────

GEMINI_MODEL = "gemini-2.5-flash-lite"
GEMINI_BASE  = "https://generativelanguage.googleapis.com/v1beta/models"

PALAVRAS_SPAM = [
    "ganha","ganhar","sorteio","prémio","premio","gratis","grátis",
    "digita","roleta","aposta","jogo","quiz","regista-te","regista",
    "credito","crédito","mola","bónus","bonus","clica","acessa",
    "visita","subscreve","mt/dia","por apenas","começa a jogar",
    "habilita-te","habilita","minha sorte","txopela",
]

# ─── Helpers Gemini ───────────────────────────────────────────────────────────

def gemini_key():
    return os.environ.get("GEMINI_API_KEY", "")

def gemini_msg(role, texto):
    return {"role": role, "parts": [{"text": texto}]}

def gemini_completar(historico):
    key = gemini_key()
    if not key:
        return "[Erro: GEMINI_API_KEY não definida]"
    url = f"{GEMINI_BASE}/{GEMINI_MODEL}:generateContent?key={key}"
    try:
        r = _req.post(url, json={"contents": historico}, timeout=60)
        r.raise_for_status()
        return r.json()["candidates"][0]["content"]["parts"][0]["text"]
    except Exception as e:
        return f"[Erro Gemini: {e}]"

def gemini_stream_sse(historico):
    key = gemini_key()
    if not key:
        yield "data: [Erro: GEMINI_API_KEY não definida]\n\n"
        return
    url = f"{GEMINI_BASE}/{GEMINI_MODEL}:streamGenerateContent?alt=sse&key={key}"
    try:
        with _req.post(url, json={"contents": historico}, stream=True, timeout=90) as r:
            r.raise_for_status()
            for line in r.iter_lines():
                if not line:
                    continue
                line = line.decode("utf-8")
                if line.startswith("data: "):
                    raw = line[6:]
                    if raw.strip() == "[DONE]":
                        break
                    try:
                        chunk = json.loads(raw)
                        texto = chunk["candidates"][0]["content"]["parts"][0]["text"]
                        for ln in texto.splitlines(keepends=True):
                            yield f"data: {json.dumps(ln)}\n\n"
                    except (KeyError, json.JSONDecodeError):
                        continue
    except Exception as e:
        yield f"data: {json.dumps(f'[Erro stream: {e}]')}\n\n"
    yield "data: [DONE]\n\n"

# ─── Helpers SMS ──────────────────────────────────────────────────────────────

# Mapeamento de tipos para o código numérico do Android
TIPOS_SMS = {"inbox": 1, "sent": 2, "draft": 3, "outbox": 4}

def get_sms(limite=50, tipo="all", endereco=None):
    """
    Lê SMS via termux-sms-list.

    Estratégia de compatibilidade:
    - Usa apenas --message-limit e --message-selection (flags universais).
    - NÃO usa --message-address: a flag existe nalgumas versões mas falha
      com números que contêm '+' e não está disponível em versões antigas.
    - Filtro por endereço é feito em Python após receber todos os resultados.
    - Quando tipo != "all", aplica --message-selection para reduzir os dados
      transferidos antes do filtro Python.
    """
    cmd = ["termux-sms-list", "--message-limit", str(limite)]

    # Filtro de tipo via --message-selection (formato correcto: sem '=')
    if tipo != "all" and tipo in TIPOS_SMS:
        cmd += ["--message-selection", f"type = {TIPOS_SMS[tipo]}"]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)

        stderr = result.stderr.strip()
        if stderr:
            # Loga o erro sem rebentar a app — útil para debug
            print(f"[termux-sms-list stderr] {stderr}", flush=True)

        raw = (result.stdout or "").strip()
        if not raw:
            return []

        msgs = json.loads(raw)

        # Filtro pós-fetch por endereço — robusto a variações de formato do número
        if endereco:
            endereco_norm = _normalizar_numero(endereco)
            msgs = [
                m for m in msgs
                if _numero_coincide(endereco_norm, m.get("address") or m.get("sender") or "")
            ]

        # termux-sms-list devolve do mais antigo para o mais recente; invertemos
        return list(reversed(msgs))

    except json.JSONDecodeError as e:
        print(f"[get_sms] JSON inválido: {e}", flush=True)
        return []
    except subprocess.TimeoutExpired:
        print("[get_sms] Timeout a correr termux-sms-list", flush=True)
        return []
    except FileNotFoundError:
        print("[get_sms] termux-sms-list não encontrado. Instala o pacote termux-api.", flush=True)
        return []
    except Exception as e:
        print(f"[get_sms] Erro inesperado: {e}", flush=True)
        return []


def _normalizar_numero(numero):
    """
    Remove espaços, hífens e parênteses para comparação.
    Mantém o '+' inicial se existir.
    """
    import re
    return re.sub(r"[\s\-\(\)]", "", (numero or "").strip())


def _numero_coincide(pesquisa, candidato):
    """
    Devolve True se 'pesquisa' coincidir com 'candidato'.
    Compara por sufixo quando um dos dois não tem código de país,
    e também faz pesquisa por nome (case-insensitive substring).
    """
    if not pesquisa or not candidato:
        return False

    cand_norm = _normalizar_numero(candidato)

    # Correspondência exacta
    if pesquisa == cand_norm:
        return True

    # Correspondência por sufixo (ex: "84..." vs "+25884...")
    if cand_norm.endswith(pesquisa) or pesquisa.endswith(cand_norm):
        return True

    # Pesquisa por nome/texto (case-insensitive)
    if pesquisa.lower() in candidato.lower():
        return True

    return False


def remetente(msg):
    return msg.get("sender") or msg.get("address") or "?"

def spam_heuristico(corpo):
    c = (corpo or "").lower()
    return sum(1 for p in PALAVRAS_SPAM if p in c) >= 2

def pesquisar_msgs(msgs, palavra):
    p = palavra.lower()
    return [m for m in msgs
            if p in (m.get("body") or "").lower()
            or p in (m.get("sender") or "").lower()
            or p in (m.get("address") or "").lower()]

def construir_contexto(msgs, max_chars=12000):
    linhas, total = [], 0
    for i, msg in enumerate(msgs):
        rem = remetente(msg)
        dat = (msg.get("received") or "")[:10]
        bod = (msg.get("body") or "")[:300]
        txt = f"[{i+1}] {dat} | De: {rem} | {bod}"
        total += len(txt)
        if total > max_chars:
            linhas.append(f"… ({len(msgs) - i} mensagens omitidas)")
            break
        linhas.append(txt)
    return "\n".join(linhas)

def analisar_remetentes(msgs):
    contagem, spam_count = Counter(), Counter()
    for msg in msgs:
        rem = remetente(msg)
        contagem[rem] += 1
        if spam_heuristico(msg.get("body", "")):
            spam_count[rem] += 1
    resultado = []
    for rem, total in contagem.most_common():
        spam  = spam_count.get(rem, 0)
        risco = "ALTO" if spam >= 2 else ("MÉDIO" if spam == 1 else "BAIXO")
        resultado.append({"remetente": rem, "total": total, "spam": spam, "risco": risco})
    return resultado

def classificar_batch_gemini(batch):
    entradas = []
    for i, msg in enumerate(batch):
        rem   = remetente(msg)
        corpo = (msg.get("body") or "")[:400]
        entradas.append(f"[{i}] De: {rem}\nMensagem: {corpo}")
    sistema = (
        "És um classificador de SMS para utilizadores moçambicanos. "
        "Classifica cada mensagem como 'spam' ou 'legitimo'.\n"
        "SPAM: promoções, sorteios, jogos, apostas, publicidade, esquemas.\n"
        "LEGITIMO: mensagens pessoais, bancárias reais, OTPs, notificações.\n\n"
        "Responde APENAS em JSON válido sem markdown:\n"
        '{"resultados": [{"id": 0, "classificacao": "spam", "motivo": "razão"}]}'
    )
    historico = [gemini_msg("user", sistema + "\n\nMensagens:\n\n" + "\n\n".join(entradas))]
    try:
        resposta = gemini_completar(historico)
        resposta = resposta.strip().lstrip("```json").lstrip("```").rstrip("```").strip()
        return json.loads(resposta).get("resultados", [])
    except Exception:
        return []

# ─── Rotas principais ─────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")

# ─── API: Mensagens ───────────────────────────────────────────────────────────

@app.route("/api/mensagens")
def api_mensagens():
    limite   = int(request.args.get("limite", 20))
    tipo     = request.args.get("tipo", "all")
    endereco = request.args.get("endereco") or None
    palavra  = request.args.get("pesquisa") or None
    msgs = get_sms(limite=limite, tipo=tipo, endereco=endereco)
    if palavra:
        msgs = pesquisar_msgs(msgs, palavra)
    return jsonify({"total": len(msgs), "mensagens": msgs})

# ─── API: Spam ────────────────────────────────────────────────────────────────

@app.route("/api/spam", methods=["POST"])
def api_spam():
    data   = request.json or {}
    limite = int(data.get("limite", 200))
    msgs   = get_sms(limite=limite)

    suspeitas_idx  = [i for i, m in enumerate(msgs) if spam_heuristico(m.get("body", ""))]
    outras_idx     = [i for i in range(len(msgs)) if i not in suspeitas_idx]
    suspeitas_msgs = [msgs[i] for i in suspeitas_idx]
    classificacoes = {}

    for start in range(0, len(suspeitas_msgs), 20):
        batch = suspeitas_msgs[start:start + 20]
        for r in classificar_batch_gemini(batch):
            lid = r.get("id", -1)
            if 0 <= lid < len(batch):
                classificacoes[suspeitas_idx[start + lid]] = r.get("classificacao", "suspeito")

    for i in outras_idx:
        classificacoes[i] = "legitimo"

    return jsonify({
        "total":     len(msgs),
        "spam":      [msgs[i] for i in range(len(msgs)) if classificacoes.get(i) == "spam"],
        "legitimas": [msgs[i] for i in range(len(msgs)) if classificacoes.get(i) == "legitimo"],
        "incertas":  [msgs[i] for i in range(len(msgs)) if classificacoes.get(i) not in ("spam", "legitimo")],
    })

# ─── API: Remetentes ──────────────────────────────────────────────────────────

@app.route("/api/remetentes")
def api_remetentes():
    limite = int(request.args.get("limite", 500))
    msgs   = get_sms(limite=limite)
    return jsonify({"total_msgs": len(msgs), "remetentes": analisar_remetentes(msgs)})

# ─── API: Chat SSE ────────────────────────────────────────────────────────────

@app.route("/api/chat/resumo", methods=["POST"])
def api_chat_resumo():
    data    = request.json or {}
    limite  = int(data.get("limite", 100))
    tipo    = data.get("tipo", "all")
    msgs    = get_sms(limite=limite, tipo=tipo)
    contexto = construir_contexto(msgs)
    sistema  = (
        f"Tens acesso a {len(msgs)} SMS do utilizador. "
        "Responde sempre em Português. Usa Markdown na resposta: "
        "# cabeçalhos, **negrito**, - listas, > citações. "
        "Sê conciso e claro.\n\nMENSAGENS:\n" + contexto
    )
    historico = [
        gemini_msg("user", sistema),
        gemini_msg("user", "Faz um resumo: quantas mensagens há, principais remetentes e temas."),
    ]
    return Response(
        stream_with_context(gemini_stream_sse(historico)),
        content_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

@app.route("/api/chat/perguntar", methods=["POST"])
def api_chat_perguntar():
    data      = request.json or {}
    pergunta  = data.get("pergunta", "")
    historico = data.get("historico", [])
    sistema   = data.get("sistema", "")
    msgs_gemini = []
    if sistema:
        msgs_gemini.append(gemini_msg("user", sistema))
        msgs_gemini.append(gemini_msg("model", "Entendido. Estou pronto para analisar as mensagens."))
    for h in historico:
        role = "model" if h["role"] == "assistant" else "user"
        msgs_gemini.append(gemini_msg(role, h["content"]))
    msgs_gemini.append(gemini_msg("user", pergunta))
    return Response(
        stream_with_context(gemini_stream_sse(msgs_gemini)),
        content_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

@app.route("/api/chat/remetentes-ia", methods=["POST"])
def api_remetentes_ia():
    data      = request.json or {}
    suspeitos = data.get("suspeitos", [])
    lista_txt = "\n".join(
        f"- {r['remetente']} ({r['total']} msgs, {r['spam']} com padrão spam)"
        for r in suspeitos[:20]
    )
    pergunta = (
        "Analisa esta lista de remetentes de SMS de um utilizador moçambicano. "
        "Indica quais são mais provavelmente spam, golpe ou marketing agressivo "
        "e dá uma recomendação breve por remetente. Usa Markdown.\n\n" + lista_txt
    )
    return Response(
        stream_with_context(gemini_stream_sse([gemini_msg("user", pergunta)])),
        content_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

# ─── API: Dr. Alma ────────────────────────────────────────────────────────────

@app.route("/api/alma/chat", methods=["POST"])
def api_alma_chat():
    data     = request.json or {}
    mensagens = data.get("mensagens", [])

    if not mensagens:
        def vazio():
            yield "data: [Erro: sem mensagens para processar]\n\n"
            yield "data: [DONE]\n\n"
        return Response(
            stream_with_context(vazio()),
            content_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    return Response(
        stream_with_context(gemini_stream_sse(mensagens)),
        content_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

# ─── API: Export ──────────────────────────────────────────────────────────────

@app.route("/api/export/txt", methods=["POST"])
def api_export_txt():
    data   = request.json or {}
    msgs   = data.get("mensagens", [])
    titulo = data.get("titulo", "")
    linhas = [f"SMS Export — {datetime.now().strftime('%d/%m/%Y %H:%M:%S')}"]
    if titulo:
        linhas.append(f"\n{'#'*50}\n# {titulo}\n{'#'*50}\n")
    for msg in msgs:
        linhas += [
            "=" * 45,
            f"De:   {remetente(msg)}",
            f"Data: {msg.get('received','')}",
            f"Tipo: {msg.get('type','')}",
            f"Msg:  {msg.get('body','')}",
        ]
    return Response(
        "\n".join(linhas),
        mimetype="text/plain",
        headers={"Content-Disposition": "attachment; filename=sms_export.txt"},
    )

@app.route("/api/export/json", methods=["POST"])
def api_export_json():
    msgs = (request.json or {}).get("mensagens", [])
    return Response(
        json.dumps(msgs, ensure_ascii=False, indent=2),
        mimetype="application/json",
        headers={"Content-Disposition": "attachment; filename=sms_export.json"},
    )

# ─── API: Enviar SMS ──────────────────────────────────────────────────────────

@app.route("/api/sms/enviar", methods=["POST"])
def api_sms_enviar():
    data   = request.json or {}
    numero = (data.get("numero") or "").strip()
    corpo  = (data.get("corpo") or "").strip()

    if not numero:
        return jsonify({"ok": False, "erro": "Número em falta"}), 400
    if not corpo:
        return jsonify({"ok": False, "erro": "Mensagem em falta"}), 400
    if len(corpo) > 160:
        return jsonify({"ok": False, "erro": f"Mensagem demasiado longa ({len(corpo)}/160 chars)"}), 400

    try:
        result = subprocess.run(
            ["termux-sms-send", "-n", numero, corpo],
            capture_output=True, text=True, timeout=30
        )
        if result.returncode == 0:
            return jsonify({"ok": True, "mensagem": f"SMS enviado para {numero}"})
        err = result.stderr.strip() or "Erro desconhecido"
        return jsonify({"ok": False, "erro": err}), 500
    except subprocess.TimeoutExpired:
        return jsonify({"ok": False, "erro": "Timeout ao enviar"}), 500
    except FileNotFoundError:
        return jsonify({"ok": False, "erro": "termux-sms-send não encontrado. Instala o pacote termux-api."}), 500
    except Exception as e:
        return jsonify({"ok": False, "erro": str(e)}), 500

# ─── Status ───────────────────────────────────────────────────────────────────

@app.route("/api/status")
def api_status():
    return jsonify({"gemini": bool(gemini_key()), "termux": True})

# ─── PWA ─────────────────────────────────────────────────────────────────────

@app.route("/sw.js")
def pwa_sw():
    return app.send_static_file("js/sw.js"), 200, {
        "Content-Type": "application/javascript",
        "Cache-Control": "no-cache, no-store, must-revalidate",
    }

@app.route("/manifest.json")
def pwa_manifest():
    return app.send_static_file("manifest.json"), 200, {
        "Content-Type": "application/manifest+json",
    }

if __name__ == "__main__":
    print("\n  SAMC — Sistema de Análise de Mensagens Curtas — a iniciar em http://localhost:5000\n")
    app.run(host="0.0.0.0", port=5000, debug=False, threaded=True)
