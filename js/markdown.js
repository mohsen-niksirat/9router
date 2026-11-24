/**
 * Safe Markdown renderer with fenced code blocks & 1-click Copy button.
 */

export function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderMarkdown(raw) {
  const src = String(raw || '');
  const codeBlocks = [];

  // Extract fenced code blocks first
  let text = src.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const idx = codeBlocks.length;
    const safeLang = escHtml(lang || 'code');
    const safeCode = escHtml(code.replace(/\n$/, ''));
    codeBlocks.push(
      `<div class="code-wrap"><div class="code-head"><span>${safeLang}</span><button class="copy-code-btn" type="button" onclick="window.__copyCode(this)">کپی</button></div><pre><code>${safeCode}</code></pre></div>`
    );
    return `@@CODEBLOCK_${idx}@@`;
  });

  text = escHtml(text);

  // Headings
  text = text.replace(/^### (.+)$/gm, '<h4>$1</h4>');
  text = text.replace(/^## (.+)$/gm, '<h3>$1</h3>');
  text = text.replace(/^# (.+)$/gm, '<h2>$1</h2>');

  // Inline formatting
  text = text.replace(/`([^`\n]+)`/g, '<code class="inline-code">$1</code>');
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  // Line breaks
  text = text.replace(/\n/g, '<br>');

  // Restore code blocks
  text = text.replace(/@@CODEBLOCK_(\d+)@@/g, (_, i) => codeBlocks[Number(i)] || '');
  return text;
}
