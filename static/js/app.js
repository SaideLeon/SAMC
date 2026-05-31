/**
 * app.js — SAMC (Sistema de Análise de Mensagens Curtas)
 * SPA com SSE streaming, Markdown rendering, export
 */

/* ════════════════════════════════════════════════════
   UTILITÁRIOS
   ════════════════════════════════════════════════════ */

const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

function toast(msg, tipo = 'success') {
  const icone = tipo === 'success' ? '✓' : '✗';
  const el = document.createElement('div');
  el.className = `toast ${tipo}`;
  el.innerHTML = `<span class="toast-icon">${icone}</span><span>${msg}</span>`;
  $('#toastContainer').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

function fmt_data(str) {
  if (!str) return '—';
  const d = new Date(str);
  if (isNaN(d)) return str.slice(0, 16);
  return d.toLocaleDateString('pt', { day: '2-digit', month: '2-digit' }) +
         ' ' + d.toLocaleTimeString('pt', { hour: '2-digit', minute: '2-digit' });
}

function fmt_rem(msg) {
  return msg.sender || msg.address || '?';
}

/* ─── SSE helper ─────────────────────────────────── */

async function consumeSSE(url, body, onChunk, onDone) {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    onDone('[Erro ao contactar o servidor]');
    return;
  }

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
      if (raw === '[DONE]') {
        onDone(acumulado);
        return;
      }
      try {
        const chunk = JSON.parse(raw);
        acumulado += chunk;
        onChunk(acumulado);
      } catch {}
    }
  }
  onDone(acumulado);
}

/* ─── Download helper ────────────────────────────── */

async function downloadViaApi(endpoint, payload, filename) {
  try {
    const r = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const blob = await r.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast(`${filename} descarregado`);
  } catch {
    toast('Erro ao exportar', 'error');
  }
}

/* ─── Loading state helper ───────────────────────── */

function setLoading(btnEl, sim) {
  if (sim) {
    btnEl._origText = btnEl.innerHTML;
    btnEl.innerHTML = '<div class="loading-spinner" style="width:14px;height:14px;border-width:2px"></div>';
    btnEl.disabled = true;
  } else {
    btnEl.innerHTML = btnEl._origText || btnEl.innerHTML;
    btnEl.disabled = false;
  }
}

/* ════════════════════════════════════════════════════
   SIDEBAR & NAVEGAÇÃO
   ════════════════════════════════════════════════════ */

const sidebar  = $('#sidebar');
const overlay  = $('#overlay');
const menuBtn  = $('#menuBtn');
const closeBtn = $('#sidebarClose');

menuBtn.addEventListener('click', () => {
  sidebar.classList.add('open');
  overlay.classList.add('visible');
});
closeBtn.addEventListener('click', closeSidebar);
overlay.addEventListener('click', closeSidebar);

function closeSidebar() {
  sidebar.classList.remove('open');
  overlay.classList.remove('visible');
}

const VIEW_LABELS = {
  recentes:   'Mensagens Recentes',
  contacto:   'Por Contacto',
  tipo:       'Por Tipo',
  pesquisar:  'Pesquisar',
  backup:     'Backup',
  spam:       'Anti-Spam · IA',
  chat:       'Chat com IA',
  remetentes: 'Remetentes Suspeitos',
  enviar:     'Enviar SMS',
};

function activateView(nome) {
  $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === nome));
  $$('.view').forEach(v => v.classList.remove('active'));
  $(`#view-${nome}`)?.classList.add('active');
  $('#topbarTitle').textContent = VIEW_LABELS[nome] || nome;
  closeSidebar();
}

$$('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => activateView(btn.dataset.view));
});

/* ════════════════════════════════════════════════════
   STATUS
   ════════════════════════════════════════════════════ */

async function checkStatus() {
  try {
    const r = await fetch('/api/status');
    const d = await r.json();
    const dot = $('#statusDotGemini');
    const txt = $('#statusTextGemini');
    if (d.gemini) {
      dot.className = 'status-dot ok';
      txt.textContent = 'Gemini ativo';
    } else {
      dot.className = 'status-dot err';
      txt.textContent = 'Gemini sem chave';
    }
  } catch {}
}

/* ════════════════════════════════════════════════════
   COMPONENTES
   ════════════════════════════════════════════════════ */

let _exportContext = null;

function renderMsgs(msgs, containerId, { badges = {}, showExport = true } = {}) {
  const el = $(`#${containerId}`);
  if (!msgs.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">◉</div>Nenhuma mensagem encontrada</div>`;
    return;
  }

  el.innerHTML = `<div class="list-count">${msgs.length} mensagem(ns)</div>`;

  msgs.forEach((msg, i) => {
    const rem   = fmt_rem(msg);
    const data  = fmt_data(msg.received);
    const corpo = (msg.body || '').trim();
    const tag   = badges[i];

    let badgeHtml = '';
    if (tag === 'SPAM')    badgeHtml = '<span class="badge badge-red">SPAM</span>';
    else if (tag === 'OK') badgeHtml = '<span class="badge badge-green">OK</span>';
    else if (tag === '?')  badgeHtml = '<span class="badge badge-yellow">?</span>';

    const card = document.createElement('div');
    card.className = `msg-card${tag ? ' ' + (tag === 'SPAM' ? 'spam' : tag === 'OK' ? 'legitimo' : 'suspeito') : ''}`;
    card.innerHTML = `
      <div class="msg-header">
        <span class="msg-sender">${rem}</span>
        ${badgeHtml}
        <span class="msg-date">${data}</span>
      </div>
      <div class="msg-body">${corpo.replace(/</g, '&lt;')}</div>
      ${showExport ? `<button class="msg-export-btn" data-idx="${i}">⊞ exportar</button>` : ''}
    `;

    card.addEventListener('click', (e) => {
      if (e.target.classList.contains('msg-export-btn')) return;
      card.classList.toggle('expanded');
    });

    if (showExport) {
      card.querySelector('.msg-export-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        openExportModal([msg], rem);
      });
    }

    el.appendChild(card);
  });
}

/* ─── Tabs ───────────────────────────────────────── */

function setupTabs(containerSel) {
  const container = $(containerSel) || document;
  $$('.stab', container).forEach(btn => {
    btn.addEventListener('click', () => {
      const group = btn.closest('.spam-tabs, .rem-tabs');
      $$('.stab', group).forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const tabId = btn.dataset.tab;
      const parent = group.parentElement;
      $$('.stab-content', parent).forEach(c => c.classList.remove('active'));
      $(`#${tabId}`)?.classList.add('active');
    });
  });
}

/* ─── Modal Export ───────────────────────────────── */

function openExportModal(msgs, titulo = '') {
  _exportContext = { msgs, titulo };
  $('#exportDesc').textContent = `${msgs.length} mensagem(ns) prontas para exportar.`;
  $('#exportModal').classList.remove('hidden');
}

$('#exportClose').addEventListener('click', () => $('#exportModal').classList.add('hidden'));
$('#exportModal').addEventListener('click', (e) => {
  if (e.target === $('#exportModal')) $('#exportModal').classList.add('hidden');
});

$('#exportTxt').addEventListener('click', async () => {
  if (!_exportContext) return;
  await downloadViaApi('/api/export/txt', _exportContext, 'sms_export.txt');
  $('#exportModal').classList.add('hidden');
});

$('#exportJson').addEventListener('click', async () => {
  if (!_exportContext) return;
  await downloadViaApi('/api/export/json', _exportContext, 'sms_export.json');
  $('#exportModal').classList.add('hidden');
});

/* ════════════════════════════════════════════════════
   VIEW: RECENTES
   ════════════════════════════════════════════════════ */

$('#rec-carregar').addEventListener('click', async () => {
  const btn    = $('#rec-carregar');
  const limite = +$('#rec-limite').value || 20;
  setLoading(btn, true);
  try {
    const r = await fetch(`/api/mensagens?limite=${limite}`);
    const d = await r.json();
    renderMsgs(d.mensagens, 'rec-lista');
  } catch { toast('Erro ao carregar mensagens', 'error'); }
  setLoading(btn, false);
});

/* ════════════════════════════════════════════════════
   VIEW: CONTACTO
   ════════════════════════════════════════════════════ */

$('#con-carregar').addEventListener('click', async () => {
  const btn      = $('#con-carregar');
  const endereco = $('#con-endereco').value.trim();
  const limite   = +$('#con-limite').value || 100;
  if (!endereco) { toast('Insere um número ou nome', 'error'); return; }
  setLoading(btn, true);
  try {
    const r = await fetch(`/api/mensagens?limite=${limite}&endereco=${encodeURIComponent(endereco)}`);
    const d = await r.json();
    renderMsgs(d.mensagens, 'con-lista');
  } catch { toast('Erro ao carregar', 'error'); }
  setLoading(btn, false);
});

/* ════════════════════════════════════════════════════
   VIEW: TIPO
   ════════════════════════════════════════════════════ */

$('#tip-carregar').addEventListener('click', async () => {
  const btn    = $('#tip-carregar');
  const tipo   = $('#tip-tipo').value;
  const limite = +$('#tip-limite').value || 50;
  setLoading(btn, true);
  try {
    const r = await fetch(`/api/mensagens?limite=${limite}&tipo=${tipo}`);
    const d = await r.json();
    renderMsgs(d.mensagens, 'tip-lista');
  } catch { toast('Erro ao carregar', 'error'); }
  setLoading(btn, false);
});

/* ════════════════════════════════════════════════════
   VIEW: PESQUISAR
   ════════════════════════════════════════════════════ */

$('#pes-carregar').addEventListener('click', async () => {
  const btn     = $('#pes-carregar');
  const palavra = $('#pes-palavra').value.trim();
  const limite  = +$('#pes-limite').value || 500;
  if (!palavra) { toast('Insere uma palavra-chave', 'error'); return; }
  setLoading(btn, true);
  try {
    const r = await fetch(`/api/mensagens?limite=${limite}&pesquisa=${encodeURIComponent(palavra)}`);
    const d = await r.json();
    renderMsgs(d.mensagens, 'pes-lista');
  } catch { toast('Erro ao pesquisar', 'error'); }
  setLoading(btn, false);
});

$('#pes-palavra').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('#pes-carregar').click();
});

/* ════════════════════════════════════════════════════
   VIEW: BACKUP
   ════════════════════════════════════════════════════ */

async function fazerBackup(fmt) {
  const limite = +$('#bak-limite').value || 5000;
  $('#bak-status').textContent = 'A carregar mensagens…';
  try {
    const r = await fetch(`/api/mensagens?limite=${limite}`);
    const d = await r.json();
    const ts = new Date().toISOString().slice(0, 10);
    if (fmt === 'txt' || fmt === 'ambos')
      await downloadViaApi('/api/export/txt', { mensagens: d.mensagens, titulo: 'Backup Completo' }, `sms_backup_${ts}.txt`);
    if (fmt === 'json' || fmt === 'ambos')
      await downloadViaApi('/api/export/json', { mensagens: d.mensagens }, `sms_backup_${ts}.json`);
    $('#bak-status').textContent = `✓ ${d.total} mensagens exportadas`;
  } catch {
    $('#bak-status').textContent = '✗ Erro ao exportar';
  }
}

$('#bak-txt').addEventListener('click',   () => fazerBackup('txt'));
$('#bak-json').addEventListener('click',  () => fazerBackup('json'));
$('#bak-ambos').addEventListener('click', () => fazerBackup('ambos'));

/* ════════════════════════════════════════════════════
   VIEW: SPAM
   ════════════════════════════════════════════════════ */

$('#spam-analisar').addEventListener('click', async () => {
  const btn    = $('#spam-analisar');
  const limite = +$('#spam-limite').value || 200;
  setLoading(btn, true);
  $('#spam-resultado').classList.add('hidden');
  $('#spam-loading').classList.remove('hidden');

  try {
    const r = await fetch('/api/spam', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limite }),
    });
    const d = await r.json();

    $('#spam-stats').innerHTML = `
      <div class="stat-card"><div class="stat-num cyan">${d.total}</div><div class="stat-label">Total</div></div>
      <div class="stat-card"><div class="stat-num red">${d.spam.length}</div><div class="stat-label">SPAM</div></div>
      <div class="stat-card"><div class="stat-num green">${d.legitimas.length}</div><div class="stat-label">Legítimas</div></div>
      <div class="stat-card"><div class="stat-num yellow">${d.incertas.length}</div><div class="stat-label">Incertas</div></div>
    `;

    renderMsgs(d.spam,      'spam-msgs',      { badges: Object.fromEntries(d.spam.map((_, i) => [i, 'SPAM'])) });
    renderMsgs(d.legitimas, 'spam-legitimas', { badges: Object.fromEntries(d.legitimas.map((_, i) => [i, 'OK'])) });
    renderMsgs(d.incertas,  'spam-incertas',  { badges: Object.fromEntries(d.incertas.map((_, i) => [i, '?'])) });

    setupTabs('#view-spam');
    $('#spam-loading').classList.add('hidden');
    $('#spam-resultado').classList.remove('hidden');
    toast(`Análise completa: ${d.spam.length} SPAM detectados`);
  } catch {
    toast('Erro na análise', 'error');
    $('#spam-loading').classList.add('hidden');
  }
  setLoading(btn, false);
});

/* ════════════════════════════════════════════════════
   VIEW: CHAT IA
   ════════════════════════════════════════════════════ */

let _chatSistema   = '';
let _chatHistorico = [];
let _chatStreaming  = false;

function addBubble(role, conteudo, streaming = false) {
  const msgs = $('#chat-messages');
  const wrap = document.createElement('div');
  wrap.className = `chat-bubble bubble-${role === 'user' ? 'user' : 'ai'}`;

  const label = document.createElement('div');
  label.className = 'bubble-label';
  label.textContent = role === 'user' ? 'TU' : 'GEMINI';
  wrap.appendChild(label);

  const body = document.createElement('div');
  body.className = 'bubble-body';
  if (streaming) body.classList.add('typing-cursor');
  wrap.appendChild(body);

  msgs.appendChild(wrap);
  msgs.scrollTop = msgs.scrollHeight;
  return body;
}

function updateBubble(bodyEl, texto, done = false) {
  MD.render(bodyEl, texto);
  if (done) bodyEl.classList.remove('typing-cursor');
  bodyEl.closest('.chat-messages').scrollTop = 99999;
}

$('#chat-iniciar').addEventListener('click', async () => {
  const btn    = $('#chat-iniciar');
  const limite = +$('#chat-limite').value || 100;
  const tipo   = $('#chat-tipo').value;
  setLoading(btn, true);

  try {
    $('#chat-messages').innerHTML = '';
    _chatHistorico = [];
    _chatSistema   = `Tens acesso a ${limite} SMS do utilizador. Responde sempre em Português. Usa Markdown.`;

    const body = addBubble('ai', '', true);
    updateBubble(body, '_A carregar mensagens e gerar resumo…_');

    await consumeSSE(
      '/api/chat/resumo',
      { limite, tipo },
      (acum)  => { updateBubble(body, acum); },
      (final) => {
        updateBubble(body, final, true);
        _chatHistorico.push({ role: 'assistant', content: final });
        _chatSistema = 'Tens acesso a SMS do utilizador. Responde em Português. Usa Markdown.';
      }
    );

    $('#chat-setup').style.display = 'none';
    $('#chat-container').classList.remove('hidden');
    toast('Chat iniciado com sucesso');
  } catch {
    toast('Erro ao iniciar chat', 'error');
  }
  setLoading(btn, false);
});

async function enviarPergunta() {
  if (_chatStreaming) return;
  const input    = $('#chat-input');
  const pergunta = input.value.trim();
  if (!pergunta) return;

  input.value   = '';
  _chatStreaming = true;
  $('#chat-send').disabled = true;

  addBubble('user', '').textContent = pergunta;
  _chatHistorico.push({ role: 'user', content: pergunta });

  const body = addBubble('ai', '', true);

  await consumeSSE(
    '/api/chat/perguntar',
    { pergunta, historico: _chatHistorico.slice(0, -1), sistema: _chatSistema },
    (acum)  => { updateBubble(body, acum); },
    (final) => {
      updateBubble(body, final, true);
      _chatHistorico.push({ role: 'assistant', content: final });
    }
  );

  _chatStreaming = false;
  $('#chat-send').disabled = false;
  input.focus();
}

$('#chat-send').addEventListener('click', enviarPergunta);
$('#chat-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviarPergunta(); }
});

/* ════════════════════════════════════════════════════
   VIEW: REMETENTES
   ════════════════════════════════════════════════════ */

let _remSuspeitos = [];

$('#rem-analisar').addEventListener('click', async () => {
  const btn    = $('#rem-analisar');
  const limite = +$('#rem-limite').value || 500;
  setLoading(btn, true);

  try {
    const r = await fetch(`/api/remetentes?limite=${limite}`);
    const d = await r.json();

    const suspeitos = d.remetentes.filter(r => r.risco !== 'BAIXO');
    const limpos    = d.remetentes.filter(r => r.risco === 'BAIXO');
    _remSuspeitos   = suspeitos;

    renderRemTable(suspeitos, 'rem-suspeitos');
    renderRemTable(limpos,    'rem-limpos');

    setupTabs('#view-remetentes');
    $('#rem-resultado').classList.remove('hidden');
    toast(`${d.remetentes.length} remetentes analisados`);
  } catch { toast('Erro na análise', 'error'); }
  setLoading(btn, false);
});

function renderRemTable(lista, id) {
  const el = $(`#${id}`);
  if (!lista.length) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">✓</div>Nenhum</div>';
    return;
  }
  const RISK_CLASS = { ALTO: 'risk-alto', 'MÉDIO': 'risk-médio', BAIXO: 'risk-baixo' };
  el.innerHTML = `
    <table class="rem-table">
      <thead><tr><th>Remetente</th><th>Msgs</th><th>Risco</th></tr></thead>
      <tbody>
        ${lista.map(r => `
          <tr>
            <td style="color:var(--cyan)">${r.remetente}</td>
            <td>${r.total}</td>
            <td><span class="risk-tag ${RISK_CLASS[r.risco] || ''}">${r.risco}</span></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

$('#rem-ia-btn').addEventListener('click', async () => {
  if (!_remSuspeitos.length) { toast('Analisa primeiro', 'error'); return; }
  const btn = $('#rem-ia-btn');
  setLoading(btn, true);

  const out = $('#rem-ia-output');
  out.classList.remove('hidden');
  out.innerHTML = '<div class="loading-text">A consultar Gemini…</div>';

  await consumeSSE(
    '/api/chat/remetentes-ia',
    { suspeitos: _remSuspeitos },
    (acum)  => { MD.render(out, acum); },
    (final) => { MD.render(out, final); }
  );

  setLoading(btn, false);
});

/* ════════════════════════════════════════════════════
   INIT
   ════════════════════════════════════════════════════ */

checkStatus();
activateView('recentes');
setTimeout(() => $('#rec-carregar').click(), 300);
