/**
 * Safe, zero-build Markdown renderer for 9Router Web.
 * Features:
 * - XSS-safe HTML escaping
 * - Fenced code blocks (including streaming unclosed blocks) with dir="ltr" isolation
 * - Language badge, Copy button, Wrap-lines toggle, and data-artifact-preview hook (html/svg/mermaid)
 * - Lightweight single-pass syntax highlighting (JS/TS/Python/HTML/CSS/JSON/Bash)
 * - GFM Tables, Blockquotes, Nested Lists (ul/ol/tasks), Headings, HR, Inline code & Links
 */

export function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Register lightweight client-side helper for Wrap-lines toggle
if (typeof window !== 'undefined') {
  if (!window.__toggleCodeWrap) {
    window.__toggleCodeWrap = (btn) => {
      const wrap = btn?.closest?.('.code-wrap');
      if (!wrap) return;
      const isWrapped = wrap.classList.toggle('code-wrapped');
      btn.classList.toggle('active', isWrapped);
      btn.setAttribute('aria-pressed', String(isWrapped));
    };
  }
}

const PREVIEWABLE_LANGS = new Set(['html', 'htm', 'svg', 'mermaid']);

const LANG_ALIASES = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  htm: 'html',
  xml: 'html',
  svg: 'html',
  scss: 'css',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
};

const JS_KEYWORDS =
  '\\b(?:async|await|break|case|catch|class|const|continue|debugger|default|delete|do|else|enum|export|extends|finally|for|from|function|if|implements|import|in|instanceof|interface|let|new|of|package|private|protected|public|return|static|super|switch|this|throw|try|type|typeof|var|void|while|with|yield)\\b';

const PY_KEYWORDS =
  '\\b(?:and|as|assert|async|await|break|class|continue|def|del|elif|else|except|finally|for|from|global|if|import|in|is|lambda|nonlocal|not|or|pass|raise|return|try|while|with|yield)\\b';

const BASH_KEYWORDS =
  '\\b(?:if|then|else|elif|fi|for|do|done|while|until|case|esac|in|function|return|local|export|unset|readonly|shift|exit|echo|cd|ls|rm|cp|mv|mkdir|cat|grep|sed|awk|curl|git|npm|npx|node|python|python3|pip|docker|sudo)\\b';

/**
 * Single-pass syntax highlighter operating on already HTML-escaped code.
 * Never mutates HTML entities or injects unescaped markup.
 */
function highlightCode(escapedCode, rawLang) {
  const norm = LANG_ALIASES[rawLang] || rawLang;
  if (!escapedCode) return '';

  if (norm === 'javascript' || norm === 'typescript') {
    const re = new RegExp(
      `(\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/)|(&quot;(?:\\\\.|[^&]|&(?!quot;))*?&quot;|&#39;(?:\\\\.|[^&]|&(?!#39;))*?&#39;|\`(?:\\\\.|[^\`])*?\`)|(${JS_KEYWORDS})|\\b(true|false|null|undefined|NaN|Infinity)\\b|\\b(\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)\\b`,
      'g'
    );
    return escapedCode.replace(re, (m, cmt, str, kw, bool, num) => {
      if (cmt) return `<span class="tok-comment">${cmt}</span>`;
      if (str) return `<span class="tok-string">${str}</span>`;
      if (kw) return `<span class="tok-keyword">${kw}</span>`;
      if (bool) return `<span class="tok-boolean">${bool}</span>`;
      if (num) return `<span class="tok-number">${num}</span>`;
      return m;
    });
  }

  if (norm === 'python') {
    const re = new RegExp(
      `(#[^\\n]*)|(&quot;&quot;&quot;[\\s\\S]*?&quot;&quot;&quot;|&#39;&#39;&#39;[\\s\\S]*?&#39;&#39;&#39;|&quot;(?:\\\\.|[^&]|&(?!quot;))*?&quot;|&#39;(?:\\\\.|[^&]|&(?!#39;))*?&#39;)|(${PY_KEYWORDS})|\\b(True|False|None|self)\\b|\\b(\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)\\b`,
      'g'
    );
    return escapedCode.replace(re, (m, cmt, str, kw, bool, num) => {
      if (cmt) return `<span class="tok-comment">${cmt}</span>`;
      if (str) return `<span class="tok-string">${str}</span>`;
      if (kw) return `<span class="tok-keyword">${kw}</span>`;
      if (bool) return `<span class="tok-boolean">${bool}</span>`;
      if (num) return `<span class="tok-number">${num}</span>`;
      return m;
    });
  }

  if (norm === 'json') {
    const re =
      /(&quot;(?:\\.|[^&]|&(?!quot;))*?&quot;)(\s*:)?|\b(true|false|null)\b|(-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)/g;
    return escapedCode.replace(re, (m, str, colon, bool, num) => {
      if (str && colon) return `<span class="tok-attr">${str}</span>${colon}`;
      if (str) return `<span class="tok-string">${str}</span>`;
      if (bool) return `<span class="tok-boolean">${bool}</span>`;
      if (num) return `<span class="tok-number">${num}</span>`;
      return m;
    });
  }

  if (norm === 'css') {
    const re =
      /(\/\*[\s\S]*?\*\/)|(&quot;(?:\\.|[^&]|&(?!quot;))*?&quot;|&#39;(?:\\.|[^&]|&(?!#39;))*?&#39;)|(@[a-z-]+)|([a-z-]+)(\s*:)|(#[0-9a-fA-F]{3,8}\b|\b\d+(?:\.\d+)?(?:px|rem|em|%|vh|vw|dvh|s|ms|deg)?\b)/g;
    return escapedCode.replace(re, (m, cmt, str, at, prop, colon, num) => {
      if (cmt) return `<span class="tok-comment">${cmt}</span>`;
      if (str) return `<span class="tok-string">${str}</span>`;
      if (at) return `<span class="tok-keyword">${at}</span>`;
      if (prop && colon) return `<span class="tok-attr">${prop}</span>${colon}`;
      if (num) return `<span class="tok-number">${num}</span>`;
      return m;
    });
  }

  if (norm === 'html') {
    const re =
      /(&lt;!--[\s\S]*?--&gt;)|(&lt;\/?[a-zA-Z][\w:-]*)([\s\S]*?)(\/?&gt;)/g;
    return escapedCode.replace(re, (m, cmt, openTag, attrs, closeTag) => {
      if (cmt) return `<span class="tok-comment">${cmt}</span>`;
      const hlAttrs = attrs.replace(
        /(\s+[a-zA-Z_:][\w:.-]*)(=)(&quot;[\s\S]*?&quot;|&#39;[\s\S]*?&#39;)/g,
        (_, name, eq, val) =>
          `<span class="tok-attr">${name}</span>${eq}<span class="tok-string">${val}</span>`
      );
      return `<span class="tok-tag">${openTag}</span>${hlAttrs}<span class="tok-tag">${closeTag}</span>`;
    });
  }

  if (norm === 'bash') {
    const re = new RegExp(
      `(#[^\\n]*)|(&quot;(?:\\\\.|[^&]|&(?!quot;))*?&quot;|&#39;(?:\\\\.|[^&]|&(?!#39;))*?&#39;)|(\\$[a-zA-Z_][a-zA-Z0-9_]*|\\$\\{[^}]+\\})|(${BASH_KEYWORDS})|\\b(\\d+)\\b`,
      'g'
    );
    return escapedCode.replace(re, (m, cmt, str, varName, kw, num) => {
      if (cmt) return `<span class="tok-comment">${cmt}</span>`;
      if (str) return `<span class="tok-string">${str}</span>`;
      if (varName) return `<span class="tok-attr">${varName}</span>`;
      if (kw) return `<span class="tok-keyword">${kw}</span>`;
      if (num) return `<span class="tok-number">${num}</span>`;
      return m;
    });
  }

  return escapedCode;
}

function buildCodeBlockHtml(lang, rawCode) {
  const cleanLang = String(lang || '').trim().toLowerCase().replace(/[^a-z0-9_+-]/g, '');
  const displayLang = escHtml(cleanLang || 'code');
  const trimmedCode = String(rawCode || '').replace(/\n$/, '');
  const escapedCode = escHtml(trimmedCode);
  const highlighted = highlightCode(escapedCode, cleanLang);

  const previewBtn = PREVIEWABLE_LANGS.has(cleanLang)
    ? `<button class="code-btn preview-code-btn" type="button" data-artifact-preview="${displayLang}" title="پیش‌نمایش">پیش‌نمایش</button>`
    : '';

  return (
    `<div class="code-wrap" dir="ltr" data-lang="${displayLang}">` +
      `<div class="code-head">` +
        `<span class="code-lang">${displayLang}</span>` +
        `<div class="code-actions">` +
          previewBtn +
          `<button class="code-btn wrap-code-btn" type="button" data-code-wrap-toggle aria-pressed="false" onclick="window.__toggleCodeWrap && window.__toggleCodeWrap(this)">شکستن خط</button>` +
          `<button class="code-btn copy-code-btn" type="button" data-code-copy onclick="window.__copyCode && window.__copyCode(this)">کپی</button>` +
        `</div>` +
      `</div>` +
      `<pre dir="ltr"><code dir="ltr" class="language-${displayLang}">${highlighted}</code></pre>` +
    `</div>`
  );
}

/**
 * Render inline markdown on an already HTML-escaped string.
 */
function renderInline(escaped) {
  if (!escaped) return '';
  const inlineCodes = [];

  // Protect inline code spans first
  let out = escaped.replace(/`([^`\n]+)`/g, (_, code) => {
    const idx = inlineCodes.length;
    inlineCodes.push(`<code class="inline-code" dir="ltr">${code}</code>`);
    return `@@INLINECODE_${idx}@@`;
  });

  // Links: [label](https://... or http://... or mailto:...)
  out = out.replace(
    /\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)/g,
    '<a class="md-link" href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
  );

  // Bold + Italic, Bold, Italic, Strikethrough
  out = out.replace(/\*\*\*([^*\n]+)\*\*\*/g, '<strong><em>$1</em></strong>');
  out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  out = out.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');

  // Restore inline code
  out = out.replace(/@@INLINECODE_(\d+)@@/g, (_, i) => inlineCodes[Number(i)] || '');
  return out;
}

function splitTableRow(line) {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((cell) => cell.trim());
}

function isTableSeparator(line) {
  const trimmed = line.trim();
  if (!trimmed.includes('|') && !trimmed.includes('-')) return false;
  const cells = splitTableRow(trimmed);
  return cells.length > 0 && cells.every((c) => /^:?-{3,}:?$/.test(c));
}

function parseTableAligns(sepLine) {
  return splitTableRow(sepLine).map((c) => {
    const left = c.startsWith(':');
    const right = c.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    if (left) return 'left';
    return '';
  });
}

function renderListBlock(lines, startIdx) {
  const root = { type: null, items: [] };
  const stack = [{ indent: -1, list: root }];
  let i = startIdx;

  while (i < lines.length) {
    const line = lines[i];
    const m = line.match(/^(\s*)(?:([-*+])|(\d+)\.)\s+(.*)$/);
    if (!m) break;

    const indent = m[1].replace(/\t/g, '  ').length;
    const type = m[3] ? 'ol' : 'ul';

    // If top-level list type switches (e.g. ul -> ol without blank line), end this list block
    if (stack.length > 1 && indent <= stack[1].indent && type !== stack[1].list.type) {
      break;
    }

    let content = m[4];

    // Task list checkbox support
    let taskPrefix = '';
    const taskMatch = content.match(/^\[( |x|X)\]\s+(.*)$/);
    if (taskMatch) {
      const checked = taskMatch[1].toLowerCase() === 'x';
      taskPrefix = `<input class="md-task-cb" type="checkbox" disabled${checked ? ' checked' : ''}> `;
      content = taskMatch[2];
    }

    while (stack.length > 1 && indent < stack[stack.length - 1].indent) {
      stack.pop();
    }

    const top = stack[stack.length - 1];
    if (indent > top.indent) {
      const newList = { type, items: [] };
      if (top.list.items.length > 0) {
        top.list.items[top.list.items.length - 1].children.push(newList);
      } else {
        root.type = root.type || type;
        if (root === top.list) {
          root.items.push({ html: taskPrefix + renderInline(escHtml(content)), children: [] });
          stack.push({ indent, list: root });
          i++;
          continue;
        }
      }
      newList.items.push({ html: taskPrefix + renderInline(escHtml(content)), children: [] });
      stack.push({ indent, list: newList });
    } else {
      top.list.items.push({ html: taskPrefix + renderInline(escHtml(content)), children: [] });
    }
    i++;
  }

  function serializeList(node) {
    const tag = node.type === 'ol' ? 'ol' : 'ul';
    const itemsHtml = node.items
      .map((item) => {
        const sub = item.children.map(serializeList).join('');
        return `<li>${item.html}${sub}</li>`;
      })
      .join('');
    return `<${tag} class="md-list md-${tag}">${itemsHtml}</${tag}>`;
  }

  return { html: serializeList(root), nextIdx: i };
}

export function renderMarkdown(raw) {
  const src = String(raw || '').replace(/\r\n?/g, '\n');
  const codeBlocks = [];

  // 1. Extract closed fenced code blocks
  let text = src.replace(/```([^\n`]*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push(buildCodeBlockHtml(lang, code));
    return `\n@@CODEBLOCK_${idx}@@\n`;
  });

  // 1b. Handle unclosed fenced code block (common during live streaming)
  text = text.replace(/```([^\n`]*)\n([\s\S]*)$/, (_, lang, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push(buildCodeBlockHtml(lang, code));
    return `\n@@CODEBLOCK_${idx}@@\n`;
  });

  const lines = text.split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Blank line
    if (!trimmed) {
      i++;
      continue;
    }

    // Code block placeholder
    const cbMatch = trimmed.match(/^@@CODEBLOCK_(\d+)@@$/);
    if (cbMatch) {
      out.push(codeBlocks[Number(cbMatch[1])] || '');
      i++;
      continue;
    }

    // Horizontal rule
    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      out.push('<hr class="md-hr">');
      i++;
      continue;
    }

    // Headings (# to ######)
    const hMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (hMatch) {
      const level = hMatch[1].length;
      const tag = `h${Math.min(level + 1, 6)}`;
      out.push(`<${tag} class="md-h md-h${level}">${renderInline(escHtml(hMatch[2].trim()))}</${tag}>`);
      i++;
      continue;
    }

    // Blockquote (> ...)
    if (/^\s*>\s?/.test(line)) {
      const quoteLines = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      out.push(`<blockquote class="md-quote">${renderMarkdown(quoteLines.join('\n'))}</blockquote>`);
      continue;
    }

    // GFM Table
    if (
      line.includes('|') &&
      i + 1 < lines.length &&
      isTableSeparator(lines[i + 1])
    ) {
      const headers = splitTableRow(line);
      const aligns = parseTableAligns(lines[i + 1]);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      const thead =
        '<thead><tr>' +
        headers
          .map((h, col) => {
            const align = aligns[col] ? ` style="text-align:${aligns[col]}"` : '';
            return `<th${align}>${renderInline(escHtml(h))}</th>`;
          })
          .join('') +
        '</tr></thead>';
      const tbody =
        '<tbody>' +
        rows
          .map(
            (r) =>
              '<tr>' +
              headers
                .map((_, col) => {
                  const align = aligns[col] ? ` style="text-align:${aligns[col]}"` : '';
                  return `<td${align}>${renderInline(escHtml(r[col] ?? ''))}</td>`;
                })
                .join('') +
              '</tr>'
          )
          .join('') +
        '</tbody>';
      out.push(`<div class="md-table-wrap"><table class="md-table">${thead}${tbody}</table></div>`);
      continue;
    }

    // Lists (unordered / ordered / nested)
    if (/^\s*(?:[-*+]|\d+\.)\s+/.test(line)) {
      const { html, nextIdx } = renderListBlock(lines, i);
      out.push(html);
      i = nextIdx;
      continue;
    }

    // Paragraph (collect consecutive plain lines)
    const paraLines = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^@@CODEBLOCK_\d+@@$/.test(lines[i].trim()) &&
      !/^(?:-{3,}|\*{3,}|_{3,})$/.test(lines[i].trim()) &&
      !/^#{1,6}\s+/.test(lines[i]) &&
      !/^\s*>\s?/.test(lines[i]) &&
      !/^\s*(?:[-*+]|\d+\.)\s+/.test(lines[i]) &&
      !(lines[i].includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1]))
    ) {
      paraLines.push(renderInline(escHtml(lines[i])));
      i++;
    }
    if (paraLines.length) {
      out.push(`<p class="md-p">${paraLines.join('<br>')}</p>`);
    }
  }

  return out.join('\n');
}
