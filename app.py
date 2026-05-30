"""
SAMC — Sistema de Análise de Mensagens Curtas — Flask Backend
Termux + Gemini + SSE streaming
"""

import subprocess, json, os, re
from datetime import datetime
from collections import Counter
from flask import Flask, render_template, request, jsonify, Response, stream_with_context
import requests as _req

app = Flask(__name__)
app.secret_key = os.urandom(24)

# ─── Config ──────────────────────────────────────────────────────────────────

GEMINI_MODEL = "gemini-3.1-flash-lite"
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
    """Gerador SSE — yield 'data: ...\n\n' para cada chunk."""
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
                        # Escapar para SSE
                        for ln in texto.splitlines(keepends=True):
                            yield f"data: {json.dumps(ln)}\n\n"
                    except (KeyError, json.JSONDecodeError):
                        continue
    except Exception as e:
        yield f"data: {json.dumps(f'[Erro stream: {e}]')}\n\n"
    yield "data: [DONE]\n\n"

# ─── Helpers SMS ──────────────────────────────────────────────────────────────

TIPOS_SMS = {"inbox": 1, "sent": 2, "draft": 3, "outbox": 4}

def get_sms(limite=50, tipo="all", endereco=None):
    cmd = ["termux-sms-list", f"--message-limit={limite}"]
    if tipo != "all" and tipo in TIPOS_SMS:
        cmd += [f"--message-selection=type == {TIPOS_SMS[tipo]}"]
    if endereco:
        cmd += [f"--message-address={endereco}"]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if not result.stdout.strip():
            return []
        return json.loads(result.stdout)
    except Exception:
        return []

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

    suspeitas_idx = [i for i, m in enumerate(msgs) if spam_heuristico(m.get("body", ""))]
    outras_idx    = [i for i in range(len(msgs)) if i not in suspeitas_idx]

    suspeitas_msgs = [msgs[i] for i in suspeitas_idx]
    BATCH = 20
    classificacoes = {}

    for start in range(0, len(suspeitas_msgs), BATCH):
        batch      = suspeitas_msgs[start:start + BATCH]
        resultados = classificar_batch_gemini(batch)
        for r in resultados:
            lid = r.get("id", -1)
            if 0 <= lid < len(batch):
                gid = suspeitas_idx[start + lid]
                classificacoes[gid] = r.get("classificacao", "suspeito")

    for i in outras_idx:
        classificacoes[i] = "legitimo"

    spam_list     = [msgs[i] for i in range(len(msgs)) if classificacoes.get(i) == "spam"]
    legitimas     = [msgs[i] for i in range(len(msgs)) if classificacoes.get(i) == "legitimo"]
    incertas      = [msgs[i] for i in range(len(msgs)) if classificacoes.get(i) not in ("spam", "legitimo")]

    return jsonify({
        "total":     len(msgs),
        "spam":      spam_list,
        "legitimas": legitimas,
        "incertas":  incertas,
    })

# ─── API: Remetentes ──────────────────────────────────────────────────────────

@app.route("/api/remetentes")
def api_remetentes():
    limite = int(request.args.get("limite", 500))
    msgs   = get_sms(limite=limite)
    dados  = analisar_remetentes(msgs)
    return jsonify({"total_msgs": len(msgs), "remetentes": dados})

# ─── API: Chat SSE ────────────────────────────────────────────────────────────

@app.route("/api/chat/resumo", methods=["POST"])
def api_chat_resumo():
    """Envia contexto inicial e faz stream do resumo automático."""
    data   = request.json or {}
    limite = int(data.get("limite", 100))
    tipo   = data.get("tipo", "all")
    msgs   = get_sms(limite=limite, tipo=tipo)

    contexto = construir_contexto(msgs)
    sistema  = (
        f"Tens acesso a {len(msgs)} SMS do utilizador. "
        "Responde sempre em Português. Usa Markdown na resposta: "
        "# cabeçalhos, **negrito**, - listas, > citações. "
        "Sê conciso e claro.\n\nMENSAGENS:\n" + contexto
    )
    pergunta = "Faz um resumo: quantas mensagens há, principais remetentes e temas."
    historico = [
        gemini_msg("user", sistema),
        gemini_msg("user", pergunta),
    ]

    # Guardar contexto em ficheiro temporário para reutilizar no /api/chat/perguntar
    ctx_path = "/tmp/sms_chat_ctx.json"
    with open(ctx_path, "w") as f:
        json.dump({"sistema": sistema, "historico": []}, f)

    return Response(
        stream_with_context(gemini_stream_sse(historico)),
        content_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

@app.route("/api/chat/perguntar", methods=["POST"])
def api_chat_perguntar():
    """Recebe pergunta + histórico do cliente e faz stream da resposta."""
    data      = request.json or {}
    pergunta  = data.get("pergunta", "")
    historico = data.get("historico", [])  # [{role, content}] do frontend
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
    """Análise Gemini de remetentes suspeitos com SSE."""
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
    historico = [gemini_msg("user", pergunta)]
    return Response(
        stream_with_context(gemini_stream_sse(historico)),
        content_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

# ─── API: Export ──────────────────────────────────────────────────────────────

@app.route("/api/export/txt", methods=["POST"])
def api_export_txt():
    data  = request.json or {}
    msgs  = data.get("mensagens", [])
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
        headers={"Content-Disposition": f"attachment; filename=sms_export.txt"},
    )

@app.route("/api/export/json", methods=["POST"])
def api_export_json():
    data = request.json or {}
    msgs = data.get("mensagens", [])
    return Response(
        json.dumps(msgs, ensure_ascii=False, indent=2),
        mimetype="application/json",
        headers={"Content-Disposition": "attachment; filename=sms_export.json"},
    )

# ─── Status ───────────────────────────────────────────────────────────────────

@app.route("/api/status")
def api_status():
    return jsonify({
        "gemini": bool(gemini_key()),
        "termux": True,  # assume que está no Termux
    })

if __name__ == "__main__":
    print("\n  SAMC — Sistema de Análise de Mensagens Curtas — a iniciar em http://localhost:5000\n")
    app.run(host="0.0.0.0", port=5000, debug=False, threaded=True)
