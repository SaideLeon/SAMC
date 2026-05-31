/**
 * enviar.js — Painel de Envio de SMS
 * Fluxo: pesquisar mensagem → clicar para seleccionar número → compor → confirmar → enviar
 * Usa a mesma API /api/mensagens já existente.
 */

(function () {

  /* ── Estado ─────────────────────────────────────── */
  let _numeroSeleccionado = null;

  /* ── Shortcuts ──────────────────────────────────── */
  const $id = (id) => document.getElementById(id);

  /* ════════════════════════════════════════════════
     PESQUISA
  ════════════════════════════════════════════════ */

  async function pesquisar() {
    const palavra = $id('env-pesquisa').value.trim();
    const limite  = parseInt($id('env-pool').value) || 500;

    if (!palavra) {
      toast('Insere uma palavra-chave', 'error');
      return;
    }

    const btn = $id('env-pesquisar-btn');
    setLoading(btn, true);

    $id('env-resultados').innerHTML = `
      <div class="loading-block">
        <div class="loading-spinner"></div>
        <span class="loading-text">A pesquisar…</span>
      </div>`;

    try {
      const r = await fetch(`/api/mensagens?limite=${limite}&pesquisa=${encodeURIComponent(palavra)}`);
      const d = await r.json();
      renderResultados(d.mensagens || []);
    } catch {
      toast('Erro ao pesquisar mensagens', 'error');
      $id('env-resultados').innerHTML = '';
    }

    setLoading(btn, false);
  }

  /* ════════════════════════════════════════════════
     RENDERIZAR RESULTADOS
  ════════════════════════════════════════════════ */

  function renderResultados(msgs) {
    const el = $id('env-resultados');

    if (!msgs.length) {
      el.innerHTML = `<div class="empty-state"><div class="empty-icon">◎</div>Nenhuma mensagem encontrada</div>`;
      return;
    }

    el.innerHTML = `<div class="list-count">${msgs.length} resultado(s) — toca numa mensagem para seleccionar o número</div>`;

    msgs.forEach((msg) => {
      const numero = msg.sender || msg.address || '?';
      const data   = fmt_data(msg.received);
      const corpo  = (msg.body || '').trim();
      const activo = _numeroSeleccionado === numero;

      const card = document.createElement('div');
      card.className = `msg-card env-result-card${activo ? ' env-card-selected' : ''}`;
      card.dataset.numero = numero;
      card.innerHTML = `
        <div class="msg-header">
          <span class="msg-sender">${esc(numero)}</span>
          <span class="msg-date">${data}</span>
        </div>
        <div class="msg-body">${esc(corpo)}</div>
        <div class="env-select-hint">Toca para usar este número</div>
      `;

      card.addEventListener('click', () => seleccionarNumero(numero));
      el.appendChild(card);
    });
  }

  /* ════════════════════════════════════════════════
     SELECÇÃO DO NÚMERO
  ════════════════════════════════════════════════ */

  function seleccionarNumero(numero) {
    _numeroSeleccionado = numero;

    /* highlight no card */
    document.querySelectorAll('.env-result-card').forEach(c => {
      c.classList.toggle('env-card-selected', c.dataset.numero === numero);
    });

    /* barra de destino */
    $id('env-dest-numero').textContent = numero;
    $id('env-dest-bar').classList.remove('hidden');

    /* focar textarea */
    $id('env-corpo').focus();
    actualizarBotao();

    toast(`Número seleccionado: ${numero}`);
  }

  function limparSeleccao() {
    _numeroSeleccionado = null;
    $id('env-dest-bar').classList.add('hidden');
    $id('env-dest-numero').textContent = '—';
    document.querySelectorAll('.env-result-card').forEach(c => {
      c.classList.remove('env-card-selected');
    });
    actualizarBotao();
  }

  /* ════════════════════════════════════════════════
     COMPOSIÇÃO
  ════════════════════════════════════════════════ */

  function actualizarBotao() {
    const temDest  = !!_numeroSeleccionado;
    const temCorpo = ($id('env-corpo').value || '').trim().length > 0;
    $id('env-send-btn').disabled = !(temDest && temCorpo);
  }

  function actualizarContador() {
    const n  = ($id('env-corpo').value || '').length;
    $id('env-char-num').textContent = n;
    const cc = $id('env-char-count');
    cc.classList.remove('warn', 'danger');
    if (n >= 150)      cc.classList.add('danger');
    else if (n >= 120) cc.classList.add('warn');
    actualizarBotao();
  }

  /* ════════════════════════════════════════════════
     ENVIO
  ════════════════════════════════════════════════ */

  function abrirConfirmacao() {
    const corpo  = ($id('env-corpo').value || '').trim();
    const numero = _numeroSeleccionado;
    if (!corpo || !numero) return;

    $id('env-confirm-numero').textContent  = numero;
    $id('env-confirm-preview').textContent = corpo;
    $id('env-confirm-modal').classList.remove('hidden');
  }

  function fecharConfirmacao() {
    $id('env-confirm-modal').classList.add('hidden');
  }

  async function confirmarEnvio() {
    const corpo  = ($id('env-corpo').value || '').trim();
    const numero = _numeroSeleccionado;
    fecharConfirmacao();

    const btn  = $id('env-send-btn');
    const orig = btn.innerHTML;
    btn.innerHTML = '<div class="loading-spinner" style="width:14px;height:14px;border-width:2px"></div>';
    btn.disabled  = true;

    try {
      const r = await fetch('/api/sms/enviar', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ numero, corpo }),
      });
      const d = await r.json();

      if (d.ok) {
        toast(`SMS enviado para ${numero}`, 'success');
        /* limpar tudo após envio bem sucedido */
        $id('env-corpo').value = '';
        actualizarContador();
        limparSeleccao();
        $id('env-resultados').innerHTML = '';
        $id('env-pesquisa').value = '';
      } else {
        toast(`Erro: ${d.erro}`, 'error');
        btn.innerHTML = orig;
        actualizarBotao();
      }
    } catch {
      toast('Erro de rede ao enviar', 'error');
      btn.innerHTML = orig;
      actualizarBotao();
    }
  }

  /* ════════════════════════════════════════════════
     UTILITÁRIOS
  ════════════════════════════════════════════════ */

  function esc(str) {
    return (str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /* ════════════════════════════════════════════════
     EVENTOS
  ════════════════════════════════════════════════ */

  $id('env-pesquisar-btn').addEventListener('click', pesquisar);

  $id('env-pesquisa').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') pesquisar();
  });

  $id('env-dest-clear').addEventListener('click', limparSeleccao);

  $id('env-corpo').addEventListener('input', actualizarContador);

  $id('env-send-btn').addEventListener('click', abrirConfirmacao);

  $id('env-confirm-close').addEventListener('click', fecharConfirmacao);
  $id('env-confirm-cancel').addEventListener('click', fecharConfirmacao);
  $id('env-confirm-ok').addEventListener('click', confirmarEnvio);

  $id('env-confirm-modal').addEventListener('click', (e) => {
    if (e.target === $id('env-confirm-modal')) fecharConfirmacao();
  });

})();
