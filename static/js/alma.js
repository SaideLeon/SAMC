/**
 * alma.js — Dr. Alma · Psicóloga de Casais no SAMC
 * Fluxo: pesquisar contacto → carregar SMS → análise → chat contínuo
 */

(function () {
  'use strict';

  /* ── Estado ─────────────────────────────────────── */
  let _contacto        = null;   // número/nome seleccionado
  let _mensagens       = [];     // array de SMS do contacto
  let _analiseFeita    = false;  // se o relatório já foi gerado
  let _chatHistorico   = [];     // histórico do chat com Alma
  let _chatStreaming    = false;  // guard anti-duplo envio
  let _sistemaAlma     = '';     // system prompt com contexto das mensagens

  /* ── DOM shortcuts ──────────────────────────────── */
  const $$ = id => document.getElementById(id);

  /* ── Phases ─────────────────────────────────────── */
  function mostrarFase(nome) {
    document.querySelectorAll('.alma-phase').forEach(el => {
      el.classList.toggle('active', el.dataset.fase === nome);
    });
  }

  /* ════════════════════════════════════════════════
     FASE 1 — Pesquisa do contacto
  ════════════════════════════════════════════════ */

  async function pesquisarContacto() {
    const valor  = $$('alma-contacto-input').value.trim();
    const limite = parseInt($$('alma-limite').value) || 300;
    if (!valor) { toast('Insere um número ou nome', 'error'); return; }

    const btn = $$('alma-pesquisar-btn');
    setLoading(btn, true);
    $$('alma-pesquisa-resultado').innerHTML = `
      <div class="loading-block">
        <div class="loading-spinner"></div>
        <span class="loading-text">A carregar mensagens…</span>
      </div>`;

    try {
      const r = await fetch(`/api/mensagens?limite=${limite}&endereco=${encodeURIComponent(valor)}`);
      const d = await r.json();

      if (!d.mensagens || !d.mensagens.length) {
        $$('alma-pesquisa-resultado').innerHTML =
          `<div class="empty-state"><div class="empty-icon">◎</div>Nenhuma mensagem encontrada para "${esc(valor)}"</div>`;
        setLoading(btn, false);
        return;
      }

      // Guarda e renderiza preview
      _mensagens = d.mensagens;
      _contacto  = valor;
      renderPreviewContacto(d.mensagens, valor);
    } catch {
      toast('Erro ao carregar mensagens', 'error');
      $$('alma-pesquisa-resultado').innerHTML = '';
    }

    setLoading(btn, false);
  }

  function renderPreviewContacto(msgs, contacto) {
    const el = $$('alma-pesquisa-resultado');
    const preview = msgs.slice(0, 5);

    el.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.5rem;flex-wrap:wrap;gap:0.5rem">
        <span class="alma-contact-badge">◎ ${esc(contacto)} · ${msgs.length} mensagem(ns)</span>
        <button class="btn btn-primary" id="alma-analisar-btn" style="font-size:0.72rem;padding:0.45rem 1rem">
          ◐ Iniciar Análise com Dr. Alma
        </button>
      </div>
      <div class="msg-lista" style="max-height:220px;overflow-y:auto">
        ${preview.map(m => `
          <div class="msg-card" style="cursor:default">
            <div class="msg-header">
              <span class="msg-sender">${esc(m.sender || m.address || '?')}</span>
              <span class="msg-date">${fmt_data(m.received)}</span>
            </div>
            <div class="msg-body">${esc((m.body || '').trim())}</div>
          </div>
        `).join('')}
        ${msgs.length > 5 ? `<div class="list-count" style="text-align:center;padding:0.5rem">… mais ${msgs.length - 5} mensagens</div>` : ''}
      </div>
    `;

    $$('alma-analisar-btn').addEventListener('click', iniciarAnalise);
  }

  /* ════════════════════════════════════════════════
     FASE 2 — Análise da Dr. Alma
  ════════════════════════════════════════════════ */

  async function iniciarAnalise() {
    if (!_mensagens.length) return;
    mostrarFase('analise');
    _analiseFeita  = false;
    _chatHistorico = [];

    // Constrói contexto textual das mensagens
    const contextoSMS = construirContexto(_mensagens);
    _sistemaAlma = construirSistemaAlma(contextoSMS, _contacto, _mensagens.length);

    // Mostra loading
    $$('alma-relatorio-wrap').innerHTML = `
      <div class="alma-loading">
        <div class="alma-loading-spinner"></div>
        <div class="alma-loading-txt">Dr. Alma está a analisar as conversas…</div>
      </div>`;

    // Activa dot online
    document.querySelectorAll('.alma-dot').forEach(d => d.classList.add('online'));
    document.querySelectorAll('.alma-status-txt').forEach(s => s.textContent = 'Em sessão');

    // Primeira pergunta — pede o relatório completo
    const perguntaInicial = (
      `Acabei de te enviar ${_mensagens.length} mensagens SMS trocadas com o contacto "${_contacto}". ` +
      `Por favor, analisa esta conversa e apresenta o teu relatório clínico completo segundo o teu método habitual. ` +
      `Inclui diagnóstico actual, padrões de comunicação detectados, pontos de atenção e prognóstico.`
    );

    const msgGemini = [
      { role: 'user', parts: [{ text: _sistemaAlma }] },
      { role: 'model', parts: [{ text: 'Entendido. Sou a Dr. Alma, psicóloga clínica especializada em terapia relacional. Analisei as mensagens fornecidas e estou pronta para apresentar a minha avaliação.' }] },
      { role: 'user', parts: [{ text: perguntaInicial }] },
    ];

    // Cria caixa do relatório
    $$('alma-relatorio-wrap').innerHTML = `
      <div class="alma-report-box">
        <div class="alma-report-header">
          <span class="alma-report-title">◐ Relatório Clínico · Dr. Alma</span>
          <span class="alma-msg-count">${_mensagens.length} msgs analisadas</span>
        </div>
        <div class="alma-report-body markdown-output" id="alma-report-content"></div>
      </div>
    `;

    const reportEl = $$('alma-report-content');
    reportEl.classList.add('alma-typing');

    let relatorioFinal = '';
    await consumeSSEGemini(msgGemini,
      (acum) => { MD.render(reportEl, acum); reportEl.scrollTop = 99999; },
      (final) => {
        relatorioFinal = final;
        MD.render(reportEl, final);
        reportEl.classList.remove('alma-typing');
        _analiseFeita = true;

        // Adiciona ao histórico do chat
        _chatHistorico.push({ role: 'user',      content: perguntaInicial });
        _chatHistorico.push({ role: 'assistant', content: final });

        // Activa o chat
        const chatSection = $$('alma-chat-section');
        chatSection.style.display = 'flex';
        chatSection.style.flexDirection = 'column';
        chatSection.style.flex = '1';
        chatSection.style.minHeight = '0';
        chatSection.style.gap = '0';
        chatSection.classList.remove('hidden');
        $$('alma-chat-send').disabled = false;
        adicionarMensagemChat('alma', final, false);
      }
    );
  }

  /* ════════════════════════════════════════════════
     FASE 2 — Chat com a Dr. Alma
  ════════════════════════════════════════════════ */

  function adicionarMensagemChat(quem, conteudo, streaming = false) {
    const msgs = $$('alma-chat-msgs');
    const wrap = document.createElement('div');
    wrap.className = `alma-bubble alma-bubble-${quem === 'user' ? 'user' : 'alma'}`;

    const label = document.createElement('div');
    label.className = 'alma-bubble-label';
    label.textContent = quem === 'user' ? 'VOCÊ' : 'DR. ALMA';
    wrap.appendChild(label);

    const body = document.createElement('div');
    body.className = 'alma-bubble-body';
    if (streaming) body.classList.add('alma-typing');

    if (quem === 'user') {
      body.textContent = conteudo;
    } else {
      MD.render(body, conteudo);
      body.classList.add('markdown-output');
    }

    wrap.appendChild(body);
    msgs.appendChild(wrap);
    msgs.scrollTop = msgs.scrollHeight;
    return body;
  }

  async function enviarMensagemChat() {
    if (_chatStreaming || !_analiseFeita) return;
    const input = $$('alma-chat-input');
    const texto = input.value.trim();
    if (!texto) return;

    input.value = '';
    _chatStreaming = true;
    $$('alma-chat-send').disabled = true;

    adicionarMensagemChat('user', texto);
    _chatHistorico.push({ role: 'user', content: texto });

    const bodyEl = adicionarMensagemChat('alma', '', true);

    // Constrói histórico Gemini
    const msgGemini = [
      { role: 'user',  parts: [{ text: _sistemaAlma }] },
      { role: 'model', parts: [{ text: 'Entendido. Sou a Dr. Alma, psicóloga clínica especializada em terapia relacional. Analisei as mensagens fornecidas e estou pronta.' }] },
    ];
    for (const h of _chatHistorico.slice(0, -1)) {
      msgGemini.push({
        role:  h.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: h.content }],
      });
    }
    msgGemini.push({ role: 'user', parts: [{ text: texto }] });

    await consumeSSEGemini(msgGemini,
      (acum) => {
        MD.render(bodyEl, acum);
        bodyEl.classList.add('markdown-output');
        $$('alma-chat-msgs').scrollTop = 99999;
      },
      (final) => {
        MD.render(bodyEl, final);
        bodyEl.classList.add('markdown-output');
        bodyEl.classList.remove('alma-typing');
        _chatHistorico.push({ role: 'assistant', content: final });
      }
    );

    _chatStreaming = false;
    $$('alma-chat-send').disabled = false;
    input.focus();
  }

  /* ════════════════════════════════════════════════
     RESET — Novo contacto
  ════════════════════════════════════════════════ */

  function resetAlma() {
    _contacto      = null;
    _mensagens     = [];
    _analiseFeita  = false;
    _chatHistorico = [];
    _sistemaAlma   = '';
    _chatStreaming  = false;

    $$('alma-contacto-input').value = '';
    $$('alma-pesquisa-resultado').innerHTML = '';
    $$('alma-chat-msgs').innerHTML = '';
    $$('alma-chat-section').classList.add('hidden');

    document.querySelectorAll('.alma-dot').forEach(d => d.classList.remove('online'));
    document.querySelectorAll('.alma-status-txt').forEach(s => s.textContent = 'Disponível');

    mostrarFase('seleccao');
  }

  /* ════════════════════════════════════════════════
     HELPERS
  ════════════════════════════════════════════════ */

  function construirContexto(msgs, maxChars = 18000) {
    const linhas = [];
    let total = 0;
    for (let i = 0; i < msgs.length; i++) {
      const msg = msgs[i];
      const rem = msg.sender || msg.address || '?';
      const dat = (msg.received || '').slice(0, 16);
      const bod = (msg.body || '').slice(0, 500);
      const linha = `[${i + 1}] ${dat} | ${rem}: ${bod}`;
      total += linha.length;
      if (total > maxChars) {
        linhas.push(`… (${msgs.length - i} mensagens omitidas por limite de contexto)`);
        break;
      }
      linhas.push(linha);
    }
    return linhas.join('\n');
  }

  function construirSistemaAlma(contextoSMS, contacto, totalMsgs) {
    return `És a Dr. Alma — Psicóloga Clínica especializada em Terapia de Casais e Relações Interpessoais, com 20 anos de experiência, formada em Psicologia Clínica com especialização em Terapia Cognitivo-Comportamental para Casais (TCC-C) e Terapia Focada na Emoção (EFT).

CONTEXTO DA SESSÃO:
- Contacto analisado: "${contacto}"
- Total de mensagens fornecidas: ${totalMsgs}
- Fonte: SMS reais exportados do telemóvel do utilizador

A tua abordagem é honesta, empática e clinicamente fundamentada. Nunca és superficial. Usas os frameworks de Gottman (4 Cavaleiros: crítica, desprezo, defensividade, stonewalling), Teoria do Apego, e o Triângulo do Amor de Sternberg.

Quando analisas mensagens de texto/SMS, tens em conta:
- Tom e linguagem usados
- Frequência e padrões de contacto
- Presença ou ausência de marcadores emocionais
- Assimetrias na comunicação
- Sinais de tensão, afecto, distância ou proximidade
- O que NÃO é dito (silêncios, ausências, mudanças de assunto)

Responde SEMPRE em Português. Usa Markdown para formatar as tuas respostas.
Mantém o papel clínico durante todo o chat — és uma profissional, não uma IA genérica.

MENSAGENS SMS DO UTILIZADOR (análise de "${contacto}"):
─────────────────────────────────────────────
${contextoSMS}
─────────────────────────────────────────────`;
  }

  /** SSE consumer que fala directamente com o backend /api/alma/chat */
  async function consumeSSEGemini(msgGemini, onChunk, onDone) {
    try {
      const resp = await fetch('/api/alma/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mensagens: msgGemini }),
      });

      if (!resp.ok) { onDone('[Erro ao contactar Dr. Alma]'); return; }

      const reader = resp.body.getReader();
      const dec = new TextDecoder();
      let buffer = '';
      let acumulado = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buffer.indexOf('\n\n')) !== -1) {
          const bloco = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 2);
          if (!bloco.startsWith('data: ')) continue;
          const raw = bloco.slice(6).trim();
          if (raw === '[DONE]') { onDone(acumulado); return; }
          try {
            acumulado += JSON.parse(raw);
            onChunk(acumulado);
          } catch {}
        }
      }
      onDone(acumulado);
    } catch (e) {
      onDone(`[Erro: ${e.message}]`);
    }
  }

  function esc(str) {
    return (str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /* ════════════════════════════════════════════════
     EVENTOS
  ════════════════════════════════════════════════ */

  $$('alma-pesquisar-btn').addEventListener('click', pesquisarContacto);

  $$('alma-contacto-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') pesquisarContacto();
  });

  $$('alma-reset-btn').addEventListener('click', resetAlma);

  $$('alma-chat-send').addEventListener('click', enviarMensagemChat);

  $$('alma-chat-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      enviarMensagemChat();
    }
  });

})();
