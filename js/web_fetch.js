/**
 * 9Router Web — Web Page Fetch & Readable Text Extraction (Part D)
 * Pure URL validation, browser/Node readable text extraction, and CORS-aware fetch.
 */

export const MAX_WEB_TEXT_CHARS = 20000;
export const TRUNCATION_NOTE = '\n\n[توجه: متن صفحه به دلیل محدودیت ۲۰٬۰۰۰ کاراکتر کوتاه شد]';

function applyCorsProxy(url, corsProxy = '') {
  const proxy = String(corsProxy || '').trim();
  if (!proxy) return url;
  return proxy.includes('{url}')
    ? proxy.replace('{url}', encodeURIComponent(url))
    : `${proxy.replace(/\/+$/, '')}/${url}`;
}

function getHostname(rawUrl) {
  try {
    return new URL(rawUrl).hostname;
  } catch {
    return '';
  }
}

function decodeHtmlEntities(str) {
  return String(str || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    });
}

function normalizeText(raw) {
  return String(raw || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t\f\v]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Validate that a URL uses http: or https:. Throws a clear Persian error otherwise.
 *
 * @param {string} url
 * @returns {string} normalized href
 */
export function validateWebUrl(url) {
  const trimmed = String(url ?? '').trim();
  if (!trimmed) {
    throw new Error('لطفاً یک آدرس وب معتبر وارد کنید.');
  }
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('آدرس واردشده معتبر نیست. لطفاً آدرسی با http:// یا https:// وارد کنید.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('فقط آدرس‌های با پروتکل http و https پشتیبانی می‌شوند.');
  }
  return parsed.href;
}

/**
 * Extract readable text from an HTML string.
 * Uses DOMParser in browsers and a safe regex/tag-stripper fallback in Node.
 *
 * @param {string} html
 * @param {string} [url='']
 * @returns {{ title: string, url: string, text: string, length: number, truncated: boolean }}
 */
export function extractReadableText(html, url = '') {
  const rawHtml = String(html ?? '');
  const cleanUrl = String(url || '').trim();
  const hostFallback = getHostname(cleanUrl);

  let title = '';
  let text = '';

  if (typeof DOMParser !== 'undefined') {
    const parser = new DOMParser();
    const doc = parser.parseFromString(rawHtml, 'text/html');

    title = normalizeText(doc.querySelector('title')?.textContent || '');

    const removeSelectors = [
      'script',
      'style',
      'noscript',
      'nav',
      'footer',
      'aside',
      'iframe',
      'svg',
      'template',
      '[hidden]',
      '[aria-hidden="true"]',
    ];
    for (const el of doc.querySelectorAll(removeSelectors.join(','))) {
      el.remove();
    }

    for (const el of doc.querySelectorAll('[style]')) {
      const styleAttr = String(el.getAttribute('style') || '').toLowerCase();
      if (/display\s*:\s*none|visibility\s*:\s*hidden/.test(styleAttr)) {
        el.remove();
      }
    }

    const root = doc.querySelector('main, article, [role="main"]') || doc.body || doc.documentElement;
    text = normalizeText(root?.textContent || '');
  } else {
    const titleMatch = rawHtml.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    if (titleMatch) {
      title = normalizeText(decodeHtmlEntities(titleMatch[1]));
    }

    let cleaned = rawHtml
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style|noscript|nav|footer|aside|iframe|svg|template)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<([a-z0-9-]+)\b[^>]*(?:\bhidden\b|aria-hidden\s*=\s*["']true["']|style\s*=\s*["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden)[^"']*["'])[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<\/(p|div|section|article|main|header|h[1-6]|li|tr|blockquote|pre|br)\s*>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ');

    text = normalizeText(decodeHtmlEntities(cleaned));
  }

  let truncated = false;
  if (text.length > MAX_WEB_TEXT_CHARS) {
    text = text.slice(0, MAX_WEB_TEXT_CHARS).trimEnd() + TRUNCATION_NOTE;
    truncated = true;
  }

  return {
    title: title || hostFallback || cleanUrl || 'صفحه وب',
    url: cleanUrl,
    text,
    length: text.length,
    truncated,
  };
}

/**
 * Fetch a web page by URL:
 * 1) Direct fetch(url)
 * 2) If that fails and corsProxy is configured, retry via corsProxy
 * 3) Otherwise throw ONE clear Persian CORS/network error (never uses any unconfigured 3rd-party service).
 *
 * @param {object} options
 * @param {string} options.url
 * @param {string} [options.corsProxy='']
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{ title: string, url: string, text: string, length: number, truncated: boolean }>}
 */
export async function fetchWebPage({ url, corsProxy = '', signal } = {}) {
  const validUrl = validateWebUrl(url);

  const tryFetchHtml = async (targetUrl) => {
    const res = await fetch(targetUrl, {
      method: 'GET',
      signal,
      headers: {
        Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
      },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return res.text();
  };

  let html = null;
  try {
    html = await tryFetchHtml(validUrl);
  } catch (err) {
    if (signal?.aborted || err?.name === 'AbortError') {
      throw err;
    }
    const proxy = String(corsProxy || '').trim();
    if (proxy) {
      try {
        html = await tryFetchHtml(applyCorsProxy(validUrl, proxy));
      } catch (proxyErr) {
        if (signal?.aborted || proxyErr?.name === 'AbortError') {
          throw proxyErr;
        }
      }
    }
  }

  if (html === null) {
    throw new Error(
      'دریافت محتوای این صفحه ممکن نشد (سایت درخواست مرورگر را به دلیل CORS یا خطای شبکه مسدود کرده است). در صورت تمایل می‌توانید پروکسی CORS خود را در تنظیمات وارد کنید.'
    );
  }

  return extractReadableText(html, validUrl);
}
