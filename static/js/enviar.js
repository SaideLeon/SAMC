/**
 * enviar.js — Painel de Envio de SMS
 * Carrega contactos, selecção, histórico de thread, confirmação e envio.
 */

/* ════════════════════════════════════════════════════
   ESTADO
   ════════════════════════════════════════════════════ */

const Enviar = (() => {
  let _contactos   = [];   // lista completa carregada da API
  let _filtrados   = [];   // lista após filtro de pesquisa
  let _seleccionado = null; // { numero, ultima, preview }

  /* ─── Elementos ─────────────────────────────────── */
  const el = {
    list:        () => document.getElementById('env-contact-list'),
    search:      () => document.getElementById('env-search'),
    refreshBtn:  () => document.getElementById('env-refresh-btn'),
    destBar:     () => document.getElementById('env-dest-bar'),
    destDisplay: () => document.getElementById('env-dest-display'),
    destClear:   () => document.getElementById('env-dest-clear'),
    thread:      () => document.getElementById('env-thread'),
    textarea:    () => document.getElementById('env-corpo'),
    charNum:     () => document.getElementById('env-char-num'),
    charCount:   () => document.getElementById('env-char-num').parentElement,
    sendBtn:     () => document.getElementById('env-send-btn'),
    // modal confirmação
    confirmModal:  () => document.getElementById('env-confirm-modal'),
    confirmClose:  () => document.getElementById('env-confirm-close'),
    confirmCancel: () => document.getElementById('env-confirm-cancel'),
    confirmOk:     () => document.getElementById('env-confirm-ok'),
    confirmNumero: () => document.getElementById('env-confirm-numero'),
    confirmPrev:   () => document.getElementById('env-confirm-preview'),
  };

  /* ════════════════════════════════════════════════════
     CONTACTOS
     ════════════════════════════════════════════════════ */

  async function carregarContactos() {
    el.list().innerHTML = `
      <div class="loading-block">
        <div class="loading-spinner"></div>
        <span class="loading-text">A carregar contactos…</span>
      </div>`;

    try {
      const r = await fetch('/api/contactos?limite=500');
      const d = await r.json();
      _contactos = d.contactos || [];
      _filtrados  = _contactos;
      renderContactos(_contactos);
    } catch {
      el.list().innerHTML = `<div class="empty-state">
        <div class="empty-icon">⊗</div>Erro ao carregar contactos</div>`;
    }
  }

  function renderContactos(lista) {
    const container = el.list();

    if (!lista.length) {
      container.innerHTML = `<div class="empty-state">
        <div class="empty-icon">◎</div>Nenhum contacto encontrado</div>`;
      return;
    }

    container.innerHTML = '';
    lista.forEach(c => {
      const item = document.createElement('div');
      item.className = 'env-contact-item';
      if (_seleccionado && _seleccionado.numero === c.numero) {
        item.classList.add('selected');
      }
      item.dataset.numero = c.numero;
      item.innerHTML = `
        <span class="env-contact-num">${escHtml(c.numero)}</span>
        <span class="env-contact-preview">${escHtml(c.preview || '')}</span>
        <button class="env-contact-quick-send" data-numero="${escHtml(c.numero)}" title="Envio rápido">▶ enviar</button>
      `;

      // Seleccionar contacto ao clicar no item
      item.addEventListener('click', (e) => {
        if (e.target.classList.contains('env-contact-quick-send')) return;
        seleccionarContacto(c);
      });

      // Envio rápido: selecciona e foca no textarea
      item.querySelector('.env-contact-quick-send').addEventListener('click', (e) => {
        e.stopPropagation();
        seleccionarContacto(c);
        el.textarea().focus();
      });

      container.appendChild(item);
    });
  }

  function filtrarContactos(query) {
    const q = query.trim().toLowerCase();
    if (!q) {
      _filtrados = _contactos;
    } else {
      _filtrados = _contactos.filter(c =>
        c.numero.toLowerCase().includes(q) ||
        (c.preview || '').toLowerCase().includes(q)
      );
    }
    renderContactos(_filtrados);
  }

  /* ════════════════════════════════════════════════════
     SELECÇÃO
     ════════════════════════════════════════════════════ */

  async function seleccionarContacto(c) {
    _seleccionado = c;

    // Actualizar UI de lista (highlight)
    document.querySelectorAll('.env-contact-item').forEach(item => {
      item.classList.toggle('selected', item.dataset.numero === c.numero);
    });

    // Barra do destinatário
    el.destDisplay().textContent = c.numero;
    el.destClear().classList.remove('hidden');

    // Actualizar estado do botão de envio
    actualizarBotaoEnvio();

    // Carregar histórico (thread)
    await carregarThread(c.numero);

    // Fechar sidebar em mobile se aberto
    if (window.innerWidth < 900) {
      const sb = document.getElementById('sidebar');
      if (sb) sb.classList.remove('open');
      const ov = document.getElementById('overlay');
      if (ov) ov.classList.remove('visible');
    }
  }

  function limparSeleccao() {
    _seleccionado = null;
    el.destDisplay().textContent = '—';
    el.destClear().classList.add('hidden');
    el.thread().innerHTML = `
      <div class="env-thread-empty">
        <div class="empty-icon">◎</div>
        <div>Selecciona um contacto para ver o histórico</div>
      </div>`;
    document.querySelectorAll('.env-contact-item').forEach(i => i.classList.remove('selected'));
    actualizarBotaoEnvio();
  }

  /* ════════════════════════════════════════════════════
     THREAD (histórico com contacto)
     ════════════════════════════════════════════════════ */

  async function carregarThread(numero) {
    const thread = el.thread();
    thread.innerHTML = `
      <div class="loading-block" style="justify-content:center">
        <div class="loading-spinner"></div>
        <span class="loading-text">A carregar histórico…</span>
      </div>`;

    try {
      // Buscar inbox e sent filtrado pelo número
      const [rIn, rOut] = await Promise.all([
        fetch(`/api/mensagens?limite=200&endereco=${encodeURIComponent(numero)}&tipo=inbox`),
        fetch(`/api/mensagens?limite=200&endereco=${encodeURIComponent(numero)}&tipo=sent`),
      ]);
      const [dIn, dOut] = await Promise.all([rIn.json(), rOut.json()]);

      const todas = [
        ...(dIn.mensagens  || []).map(m => ({ ...m, _dir: 'in'  })),
        ...(dOut.mensagens || []).map(m => ({ ...m, _dir: 'out' })),
      ].sort((a, b) => {
        const ta = new Date(a.received || 0).getTime();
        const tb = new Date(b.received || 0).getTime();
        return ta - tb;
      });

      thread.innerHTML = '';

      if (!todas.length) {
        thread.innerHTML = `
          <div class="env-thread-empty">
            <div class="empty-icon">◎</div>
            <div>Sem histórico com este contacto</div>
          </div>`;
        return;
      }

      todas.forEach(msg => {
        const bub = document.createElement('div');
        bub.className = `env-bubble ${msg._dir === 'out' ? 'env-bubble-out' : 'env-bubble-in'}`;
        const corpo = escHtml((msg.body || '').trim());
        const data  = fmtDataThread(msg.received);
        bub.innerHTML = `
          <div>${corpo}</div>
          <div class="env-bubble-meta">${data}</div>
        `;
        thread.appendChild(bub);
      });

      // Scroll para o fundo
      thread.scrollTop = thread.scrollHeight;

    } catch {
      thread.innerHTML = `<div class="empty-state">
        <div class="empty-icon">⊗</div>Erro ao carregar histórico</div>`;
    }
  }

  /* ════════════════════════════════════════════════════
     COMPOSIÇÃO E ENVIO
     ════════════════════════════════════════════════════ */

  function actualizarBotaoEnvio() {
    const corpo = (el.textarea().value || '').trim();
    const temDest = !!_seleccionado;
    const temCorpo = corpo.length > 0;
    el.sendBtn().disabled = !(temDest && temCorpo);
  }

  function actualizarContador() {
    const n = el.textarea().value.length;
    el.charNum().textContent = n;
    const cc = el.charCount();
    cc.classList.remove('warn', 'danger');
    if (n >= 150) cc.classList.add('danger');
    else if (n >= 120) cc.classList.add('warn');
  }

  function abrirConfirmacao() {
    const corpo  = el.textarea().value.trim();
    const numero = _seleccionado?.numero || '';
    el.confirmNumero().textContent = numero;
    el.confirmPrev().textContent   = corpo;
    el.confirmModal().classList.remove('hidden');
  }

  function fecharConfirmacao() {
    el.confirmModal().classList.add('hidden');
  }

  async function confirmarEnvio() {
    const corpo  = el.textarea().value.trim();
    const numero = _seleccionado?.numero || '';
    fecharConfirmacao();

    const btn = el.sendBtn();
    const orig = btn.innerHTML;
    btn.innerHTML = '<div class="loading-spinner" style="width:14px;height:14px;border-width:2px"></div>';
    btn.disabled = true;

    try {
      const r = await fetch('/api/sms/enviar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ numero, corpo }),
      });
      const d = await r.json();

      if (d.ok) {
        toast(`SMS enviado para ${numero}`, 'success');
        el.textarea().value = '';
        actualizarContador();
        actualizarBotaoEnvio();
        // Adicionar bolha enviada ao thread sem recarregar tudo
        adicionarBolhaEnviada(corpo);
      } else {
        toast(`Erro: ${d.erro}`, 'error');
      }
    } catch {
      toast('Erro de rede ao enviar', 'error');
    }

    btn.innerHTML = orig;
    actualizarBotaoEnvio();
  }

  function adicionarBolhaEnviada(corpo) {
    // Remove estado vazio se existir
    const vazio = el.thread().querySelector('.env-thread-empty');
    if (vazio) vazio.remove();

    const bub = document.createElement('div');
    bub.className = 'env-bubble env-bubble-out';
    bub.innerHTML = `
      <div>${escHtml(corpo)}</div>
      <div class="env-bubble-meta">${fmtDataThread(new Date().toISOString())}</div>
    `;
    el.thread().appendChild(bub);
    el.thread().scrollTop = el.thread().scrollHeight;
  }

  /* ════════════════════════════════════════════════════
     UTILITÁRIOS
     ════════════════════════════════════════════════════ */

  function escHtml(str) {
    return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function fmtDataThread(str) {
    if (!str) return '';
    const d = new Date(str);
    if (isNaN(d)) return str.slice(0, 16);
    const hoje = new Date();
    const mesmodia =
      d.getDate() === hoje.getDate() &&
      d.getMonth() === hoje.getMonth() &&
      d.getFullYear() === hoje.getFullYear();
    if (mesmodia) {
      return d.toLocaleTimeString('pt', { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString('pt', { day: '2-digit', month: '2-digit' }) +
           ' ' + d.toLocaleTimeString('pt', { hour: '2-digit', minute: '2-digit' });
  }

  /* ════════════════════════════════════════════════════
     PERMITIR ENVIO PARA NÚMERO DIGITADO DIRECTAMENTE
     (se não estiver na lista de contactos)
     ════════════════════════════════════════════════════ */

  function tentarSeleccionarNumeroDigitado(valor) {
    const v = valor.trim();
    // Aceita se parecer um número de telemóvel (pelo menos 6 dígitos, pode ter + e espaços)
    if (/^[+\d][\d\s\-]{5,}$/.test(v)) {
      const c = { numero: v, preview: 'Número digitado manualmente', ultima: '' };
      seleccionarContacto(c);
    }
  }

  /* ════════════════════════════════════════════════════
     INIT — ligar eventos
     ════════════════════════════════════════════════════ */

  function init() {
    // Pesquisa / filtro
    el.search().addEventListener('input', (e) => {
      filtrarContactos(e.target.value);
    });

    // Enter na pesquisa → se não houver match, tenta usar como número
    el.search().addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        if (_filtrados.length === 1) {
          seleccionarContacto(_filtrados[0]);
        } else if (_filtrados.length === 0) {
          tentarSeleccionarNumeroDigitado(e.target.value);
        }
      }
    });

    // Refresh da lista
    el.refreshBtn().addEventListener('click', carregarContactos);

    // Limpar selecção
    el.destClear().addEventListener('click', limparSeleccao);

    // Textarea: contador + botão
    el.textarea().addEventListener('input', () => {
      actualizarContador();
      actualizarBotaoEnvio();
    });

    // Botão de envio → abre confirmação
    el.sendBtn().addEventListener('click', abrirConfirmacao);

    // Modal de confirmação
    el.confirmClose().addEventListener('click', fecharConfirmacao);
    el.confirmCancel().addEventListener('click', fecharConfirmacao);
    el.confirmOk().addEventListener('click', confirmarEnvio);
    el.confirmModal().addEventListener('click', (e) => {
      if (e.target === el.confirmModal()) fecharConfirmacao();
    });

    // Carregar contactos na primeira vez que a view é activada
    document.querySelectorAll('.nav-item').forEach(btn => {
      if (btn.dataset.view === 'enviar') {
        btn.addEventListener('click', () => {
          if (!_contactos.length) carregarContactos();
        });
      }
    });
  }

  /* Expõe init e carregarContactos para o app.js */
  return { init, carregarContactos };
})();
