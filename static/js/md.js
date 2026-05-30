/**
 * md.js — Parser Markdown → HTML para o SMS Analítico
 * Suporta: # cabeçalhos, **bold**, *italic*, `code`,
 *          - bullets, 1. numerado, > blockquote, ---, ```blocos```
 */

window.MD = {
  parse(texto) {
    if (!texto) return '';
    const linhas = texto.split('\n');
    const out = [];
    let inCode = false;
    let codeLang = '';
    let codeBuffer = [];
    let inList = false;
    let listType = '';

    const fechaLista = () => {
      if (inList) {
        out.push(listType === 'ul' ? '</ul>' : '</ol>');
        inList = false;
        listType = '';
      }
    };

    const inline = (txt) => {
      // Ordem importa: bold antes de italic
      return txt
        // **bold** ou __bold__
        .replace(/\*\*(.+?)\*\*|__(.+?)__/g, (_, a, b) => `<strong>${a || b}</strong>`)
        // *italic* ou _italic_
        .replace(/\*([^\s*][^*]*?)\*|_([^\s_][^_]*?)_/g, (_, a, b) => `<em>${a || b}</em>`)
        // `code`
        .replace(/`([^`]+)`/g, (_, c) => `<code>${this.esc(c)}</code>`)
        // ~~strikethrough~~
        .replace(/~~(.+?)~~/g, (_, s) => `<del>${s}</del>`);
    };

    for (const linha of linhas) {
      const s = linha.trim();

      // ── Bloco de código ```
      if (s.startsWith('```')) {
        if (!inCode) {
          fechaLista();
          inCode = true;
          codeLang = s.slice(3).trim();
          codeBuffer = [];
        } else {
          inCode = false;
          const lang = codeLang ? ` data-lang="${codeLang}"` : '';
          out.push(`<pre${lang}><code>${this.esc(codeBuffer.join('\n'))}</code></pre>`);
          codeBuffer = [];
          codeLang = '';
        }
        continue;
      }

      if (inCode) {
        codeBuffer.push(linha);
        continue;
      }

      // ── Linha vazia
      if (!s) {
        fechaLista();
        out.push('<br>');
        continue;
      }

      // ── Separador --- / ===
      if (/^[-=]{3,}$/.test(s)) {
        fechaLista();
        out.push('<hr>');
        continue;
      }

      // ── Cabeçalhos # ## ###
      const mH = s.match(/^(#{1,6})\s+(.*)/);
      if (mH) {
        fechaLista();
        const nivel = mH[1].length;
        const titulo = inline(mH[2]);
        out.push(`<h${nivel}>${titulo}</h${nivel}>`);
        continue;
      }

      // ── Bullet list - / * / +
      const mBullet = s.match(/^[-*+]\s+(.*)/);
      if (mBullet) {
        if (!inList || listType !== 'ul') {
          fechaLista();
          out.push('<ul>');
          inList = true;
          listType = 'ul';
        }
        out.push(`<li>${inline(mBullet[1])}</li>`);
        continue;
      }

      // ── Numbered list 1. / 2.
      const mNum = s.match(/^(\d+)\.\s+(.*)/);
      if (mNum) {
        if (!inList || listType !== 'ol') {
          fechaLista();
          out.push('<ol>');
          inList = true;
          listType = 'ol';
        }
        out.push(`<li>${inline(mNum[2])}</li>`);
        continue;
      }

      // ── Blockquote > texto
      const mCit = s.match(/^>\s*(.*)/);
      if (mCit) {
        fechaLista();
        out.push(`<blockquote>${inline(mCit[1])}</blockquote>`);
        continue;
      }

      // ── Parágrafo normal
      fechaLista();
      out.push(`<p>${inline(s)}</p>`);
    }

    fechaLista();
    return out.join('\n');
  },

  esc(txt) {
    return txt
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  },

  /** Renderiza no elemento destino, substitui conteúdo. */
  render(el, texto) {
    el.innerHTML = this.parse(texto);
    el.classList.add('markdown-output');
  },

  /** Acrescenta texto (streaming — chama no fim com texto completo). */
  append(el, texto) {
    el.innerHTML = this.parse(texto);
    el.classList.add('markdown-output');
  },
};
