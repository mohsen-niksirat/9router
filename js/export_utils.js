/**
 * 9Router Web - Rich Session Exports (Markdown / Printable RTL HTML)
 * & Web Crypto API Encrypted Backup (PBKDF2 SHA-256 100k + AES-GCM 256-bit)
 */

const PBKDF2_ITERATIONS = 100000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

function getCrypto() {
  if (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.subtle) {
    return globalThis.crypto;
  }
  throw new Error('Web Crypto API در این مرورگر در دسترس نیست (Web Crypto API is not available)');
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function sanitizeFilename(title, ext) {
  const base = String(title || 'chat-export')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
  return `${base || 'chat-export'}.${ext}`;
}

function triggerDownload(content, filename, mimeType) {
  if (typeof document === 'undefined' || typeof Blob === 'undefined') return;
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function formatDate(ts) {
  const date = ts ? new Date(ts) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  try {
    return date.toLocaleString('fa-IR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return date.toISOString();
  }
}

function extractMessageText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && part.type === 'text') return part.text || '';
        if (part && part.type === 'image_url') return '[Image]';
        return '';
      })
      .filter(Boolean)
      .join('\n\n');
  }
  if (content == null) return '';
  return String(content);
}

function extractMetaLabel(msg) {
  if (!msg) return '';
  if (typeof msg.meta === 'string' && msg.meta.trim()) return msg.meta.trim();
  const parts = [];
  const provider = msg.providerName || msg.provider || msg.meta?.providerName || msg.meta?.provider;
  const model = msg.model || msg.meta?.model;
  if (provider) parts.push(provider);
  if (model) parts.push(model);
  return parts.join(' / ');
}

function extractSources(msg) {
  const list = msg?.sources || msg?.webSources;
  if (!Array.isArray(list)) return [];
  return list.filter((s) => s && (s.url || s.title));
}

function roleLabel(role) {
  if (role === 'user') return 'کاربر (User)';
  if (role === 'assistant') return 'دستیار (Assistant)';
  if (role === 'system') return 'سیستم (System)';
  return String(role || 'پیام');
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderSimpleMarkdown(mdText) {
  const text = String(mdText || '');
  const codeBlocks = [];
  const withPlaceholders = text.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const idx = codeBlocks.length;
    const langTag = lang ? `<div class="code-lang">${escapeHtml(lang)}</div>` : '';
    codeBlocks.push(`<div class="code-wrap" dir="ltr">${langTag}<pre><code>${escapeHtml(code.replace(/\n$/, ''))}</code></pre></div>`);
    return `\u0000CODEBLOCK_${idx}\u0000`;
  });

  let html = escapeHtml(withPlaceholders);

  // Inline code
  html = html.replace(/`([^`\n]+)`/g, '<code class="inline-code" dir="ltr">$1</code>');
  // Bold & italic
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  // Links
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  // Headings
  html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^# (.+)$/gm, '<h2>$1</h2>');
  // Line breaks
  html = html.replace(/\n\n+/g, '</p><p>');
  html = html.replace(/\n/g, '<br>');
  html = `<p>${html}</p>`;

  // Restore code blocks
  html = html.replace(/\u0000CODEBLOCK_(\d+)\u0000/g, (_, idx) => `</p>${codeBlocks[Number(idx)]}<p>`);
  html = html.replace(/<p>\s*<\/p>/g, '');

  return html;
}

/**
 * Exports a chat session as a clean Markdown (.md) file and triggers download.
 * @param {object} session
 * @returns {string} Generated Markdown content
 */
export function exportSessionMarkdown(session) {
  if (!session || typeof session !== 'object') {
    throw new Error('جلسه گفتگو نامعتبر است (Invalid session object)');
  }

  const title = session.title || 'گفتگوی بدون عنوان';
  const dateStr = formatDate(session.updatedAt || Date.now());
  const messages = Array.isArray(session.messages) ? session.messages : [];

  const lines = [
    `# ${title}`,
    '',
    `- **تاریخ:** ${dateStr}`,
    `- **تعداد پیام‌ها:** ${messages.length}`,
  ];

  if (session.folder) {
    lines.push(`- **پوشه:** ${session.folder}`);
  }

  lines.push('', '---', '');

  for (const msg of messages) {
    lines.push(`## ${roleLabel(msg.role)}`);
    const meta = extractMetaLabel(msg);
    if (meta) {
      lines.push(`> **مدل / ارائه‌دهنده:** ${meta}`);
    }
    lines.push('');

    const reasoning = msg.reasoning || msg.thinking;
    if (reasoning && typeof reasoning === 'string' && reasoning.trim()) {
      lines.push('<details><summary>روند استدلال (Reasoning)</summary>', '', reasoning.trim(), '', '</details>', '');
    }

    const body = extractMessageText(msg.content).trim();
    if (body) {
      lines.push(body, '');
    }

    const sources = extractSources(msg);
    if (sources.length > 0) {
      lines.push('### منابع وب');
      for (const src of sources) {
        const sTitle = src.title || src.url;
        if (src.url) {
          lines.push(`- [${sTitle}](${src.url})`);
        } else {
          lines.push(`- ${sTitle}`);
        }
      }
      lines.push('');
    }

    lines.push('---', '');
  }

  const md = lines.join('\n');
  triggerDownload(md, sanitizeFilename(title, 'md'), 'text/markdown;charset=utf-8');
  return md;
}

/**
 * Exports a chat session as a self-contained printable RTL HTML file (PDF-ready via @media print).
 * @param {object} session
 * @returns {string} Generated HTML document string
 */
export function exportSessionHtml(session) {
  if (!session || typeof session !== 'object') {
    throw new Error('جلسه گفتگو نامعتبر است (Invalid session object)');
  }

  const title = session.title || 'گفتگوی بدون عنوان';
  const dateStr = formatDate(session.updatedAt || Date.now());
  const messages = Array.isArray(session.messages) ? session.messages : [];

  const renderedMessages = messages
    .map((msg) => {
      const roleClass = msg.role === 'user' ? 'msg-user' : msg.role === 'assistant' ? 'msg-assistant' : 'msg-system';
      const meta = extractMetaLabel(msg);
      const reasoning = msg.reasoning || msg.thinking;
      const sources = extractSources(msg);
      const bodyHtml = renderSimpleMarkdown(extractMessageText(msg.content));

      const metaHtml = meta ? `<span class="msg-meta" dir="ltr">${escapeHtml(meta)}</span>` : '';
      const reasoningHtml =
        reasoning && typeof reasoning === 'string' && reasoning.trim()
          ? `<details class="msg-reasoning"><summary>روند استدلال</summary><div class="reasoning-body">${renderSimpleMarkdown(reasoning)}</div></details>`
          : '';

      const sourcesHtml =
        sources.length > 0
          ? `<div class="msg-sources"><div class="sources-title">منابع وب</div><ul>${sources
              .map((s) => {
                const label = escapeHtml(s.title || s.url);
                return s.url
                  ? `<li><a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer">${label}</a></li>`
                  : `<li>${label}</li>`;
              })
              .join('')}</ul></div>`
          : '';

      return `<article class="msg ${roleClass}">
  <header class="msg-head">
    <span class="msg-role">${escapeHtml(roleLabel(msg.role))}</span>
    ${metaHtml}
  </header>
  ${reasoningHtml}
  <div class="msg-body">${bodyHtml}</div>
  ${sourcesHtml}
</article>`;
    })
    .join('\n');

  const html = `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} - 9Router Web</title>
  <style>
    :root {
      --bg: #f8fafc;
      --surface: #ffffff;
      --user-bg: #eef2ff;
      --user-border: #c7d2fe;
      --border: #e2e8f0;
      --text: #0f172a;
      --muted: #64748b;
      --accent: #4f46e5;
      --code-bg: #0f172a;
      --code-text: #f8fafc;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 24px 16px 48px;
      background: var(--bg);
      color: var(--text);
      font-family: Vazirmatn, Tahoma, system-ui, -apple-system, sans-serif;
      line-height: 1.75;
      font-size: 15px;
    }
    .container {
      max-width: 860px;
      margin: 0 auto;
    }
    .doc-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 16px;
      padding-bottom: 16px;
      margin-bottom: 24px;
      border-bottom: 2px solid var(--border);
    }
    .doc-title {
      margin: 0 0 6px;
      font-size: 22px;
      font-weight: 700;
    }
    .doc-meta {
      font-size: 13px;
      color: var(--muted);
    }
    .print-btn {
      padding: 10px 16px;
      border: 1px solid var(--accent);
      border-radius: 8px;
      background: var(--accent);
      color: #ffffff;
      font-family: inherit;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
    }
    .print-btn:hover { opacity: 0.92; }
    .msg {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px 20px;
      margin-bottom: 16px;
      break-inside: avoid;
    }
    .msg-user {
      background: var(--user-bg);
      border-color: var(--user-border);
    }
    .msg-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      margin-bottom: 10px;
      padding-bottom: 8px;
      border-bottom: 1px solid rgba(148, 163, 184, 0.25);
      font-size: 13px;
    }
    .msg-role { font-weight: 700; color: var(--accent); }
    .msg-meta {
      color: var(--muted);
      font-size: 12px;
      font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
    }
    .msg-body p { margin: 0 0 10px; }
    .msg-body p:last-child { margin-bottom: 0; }
    .msg-body a { color: var(--accent); text-decoration: underline; }
    .inline-code {
      background: rgba(15, 23, 42, 0.08);
      padding: 1px 6px;
      border-radius: 4px;
      font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
      font-size: 0.9em;
    }
    .code-wrap {
      margin: 12px 0;
      border-radius: 8px;
      overflow: hidden;
      background: var(--code-bg);
      color: var(--code-text);
    }
    .code-lang {
      padding: 4px 12px;
      font-size: 11px;
      color: #94a3b8;
      background: rgba(255, 255, 255, 0.06);
      font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
    }
    .code-wrap pre {
      margin: 0;
      padding: 12px 14px;
      overflow-x: auto;
      font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
      font-size: 13px;
      line-height: 1.55;
    }
    .msg-reasoning {
      margin-bottom: 10px;
      padding: 8px 12px;
      border-radius: 8px;
      background: rgba(148, 163, 184, 0.12);
      font-size: 13px;
      color: var(--muted);
    }
    .msg-reasoning summary { cursor: pointer; font-weight: 600; }
    .msg-sources {
      margin-top: 12px;
      padding-top: 10px;
      border-top: 1px dashed var(--border);
      font-size: 13px;
    }
    .sources-title { font-weight: 700; margin-bottom: 4px; color: var(--muted); }
    .msg-sources ul { margin: 0; padding-right: 18px; }
    @media print {
      @page { margin: 14mm; }
      body {
        background: #ffffff;
        padding: 0;
        font-size: 12.5px;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      .no-print { display: none !important; }
      .msg { box-shadow: none; break-inside: avoid; }
      .code-wrap pre { white-space: pre-wrap; word-break: break-word; }
    }
  </style>
</head>
<body>
  <main class="container">
    <header class="doc-header">
      <div>
        <h1 class="doc-title">${escapeHtml(title)}</h1>
        <div class="doc-meta">تاریخ: ${escapeHtml(dateStr)} | تعداد پیام‌ها: ${messages.length}${session.folder ? ` | پوشه: ${escapeHtml(session.folder)}` : ''}</div>
      </div>
      <button type="button" id="print-doc-btn" class="print-btn no-print">چاپ / ذخیره PDF</button>
    </header>
    ${renderedMessages || '<p>هیچ پیامی در این گفتگو وجود ندارد.</p>'}
  </main>
  <script>document.getElementById('print-doc-btn')?.addEventListener('click',function(){window.print();});</script>
</body>
</html>`;

  triggerDownload(html, sanitizeFilename(title, 'html'), 'text/html;charset=utf-8');
  return html;
}

async function deriveAesKey(passphrase, salt, usages) {
  const cryptoObj = getCrypto();
  const encoder = new TextEncoder();
  const keyMaterial = await cryptoObj.subtle.importKey(
    'raw',
    encoder.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return cryptoObj.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    usages
  );
}

/**
 * Encrypts a backup object using PBKDF2 (SHA-256, 100k iterations) + AES-GCM (256-bit).
 * @param {object} dataObj
 * @param {string} passphrase
 * @returns {Promise<string>} JSON string: { encrypted: true, v: 1, salt, iv, ciphertext }
 */
export async function encryptBackup(dataObj, passphrase) {
  if (typeof passphrase !== 'string' || !passphrase.length) {
    throw new Error('رمز عبور برای رمزنگاری الزامی است (Passphrase is required)');
  }
  const cryptoObj = getCrypto();
  const salt = cryptoObj.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = cryptoObj.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveAesKey(passphrase, salt, ['encrypt']);

  const plaintext = new TextEncoder().encode(JSON.stringify(dataObj));
  const cipherBuffer = await cryptoObj.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plaintext
  );

  const envelope = {
    encrypted: true,
    v: 1,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(cipherBuffer)),
  };

  return JSON.stringify(envelope, null, 2);
}

/**
 * Checks whether a JSON string (or parsed object) is an encrypted 9Router backup envelope.
 * @param {string|object} jsonString
 * @returns {boolean}
 */
export function isEncryptedBackup(jsonString) {
  try {
    const obj = typeof jsonString === 'string' ? JSON.parse(jsonString) : jsonString;
    return Boolean(
      obj &&
      typeof obj === 'object' &&
      obj.encrypted === true &&
      typeof obj.salt === 'string' &&
      typeof obj.iv === 'string' &&
      typeof obj.ciphertext === 'string'
    );
  } catch {
    return false;
  }
}

/**
 * Decrypts an encrypted backup JSON string back into the original object.
 * Throws a clear Persian/English error if the passphrase is wrong or data is corrupted.
 * @param {string} jsonString
 * @param {string} passphrase
 * @returns {Promise<object>}
 */
export async function decryptBackup(jsonString, passphrase) {
  if (typeof passphrase !== 'string' || !passphrase.length) {
    throw new Error('رمز عبور برای رمزگشایی الزامی است (Passphrase is required)');
  }

  let envelope;
  try {
    envelope = typeof jsonString === 'string' ? JSON.parse(jsonString) : jsonString;
  } catch {
    throw new Error('فرمت فایل پشتیبان نامعتبر است (Invalid backup JSON format)');
  }

  if (!isEncryptedBackup(envelope)) {
    throw new Error('این فایل یک پشتیبان رمزنگاری‌شده معتبر نیست (Not a valid encrypted backup)');
  }

  const cryptoObj = getCrypto();
  const salt = base64ToBytes(envelope.salt);
  const iv = base64ToBytes(envelope.iv);
  const ciphertext = base64ToBytes(envelope.ciphertext);
  const key = await deriveAesKey(passphrase, salt, ['decrypt']);

  let plainBuffer;
  try {
    plainBuffer = await cryptoObj.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    );
  } catch {
    throw new Error('رمز عبور اشتباه است یا فایل پشتیبان آسیب دیده است (Incorrect passphrase or corrupted backup)');
  }

  try {
    const decoded = new TextDecoder().decode(plainBuffer);
    return JSON.parse(decoded);
  } catch {
    throw new Error('داده‌های رمزگشایی‌شده قابل خواندن نیستند (Decrypted backup data is invalid JSON)');
  }
}
