/**
 * Perplexity-style BYOK Web Search, Grounded Prompting & Citation Utilities.
 * Supports Tavily, Serper, and Brave Search APIs with optional CORS proxy support.
 */

const PROVIDER_ENDPOINTS = {
  tavily: 'https://api.tavily.com/search',
  serper: 'https://google.serper.dev/search',
  brave: 'https://api.search.brave.com/res/v1/web/search',
};

function applyCorsProxy(url, corsProxy = '') {
  const proxy = String(corsProxy || '').trim();
  if (!proxy) return url;
  return proxy.includes('{url}')
    ? proxy.replace('{url}', encodeURIComponent(url))
    : `${proxy.replace(/\/+$/, '')}/${url}`;
}

function safeUrl(rawUrl) {
  if (typeof rawUrl !== 'string') return '';
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.href;
    }
  } catch {
    // Invalid URL
  }
  return '';
}

function extractDomain(rawUrl) {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./i, '');
  } catch {
    return '';
  }
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeSources(rawItems, maxResults) {
  const sources = [];
  const seenUrls = new Set();

  for (const item of rawItems || []) {
    if (sources.length >= maxResults) break;
    const url = safeUrl(item?.url || item?.link || '');
    if (!url || seenUrls.has(url)) continue;
    seenUrls.add(url);

    const domain = extractDomain(url);
    const title = String(item?.title || domain || url).replace(/\s+/g, ' ').trim();
    const snippet = String(item?.snippet || item?.content || item?.description || '')
      .replace(/\s+/g, ' ')
      .trim();

    sources.push({
      index: sources.length + 1,
      title,
      url,
      domain,
      snippet,
    });
  }

  return sources;
}

/**
 * Execute a web search via Tavily, Serper, or Brave Search.
 *
 * @param {object} options
 * @param {string} options.query
 * @param {'tavily'|'serper'|'brave'} [options.provider='tavily']
 * @param {string} options.apiKey
 * @param {string} [options.corsProxy='']
 * @param {number} [options.maxResults=5]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{ query: string, provider: string, sources: Array<{ index: number, title: string, url: string, domain: string, snippet: string }>, durationMs: number }>}
 */
export async function searchWeb({
  query,
  provider = 'tavily',
  apiKey,
  corsProxy = '',
  maxResults = 5,
  signal,
} = {}) {
  const cleanQuery = String(query || '').trim();
  if (!cleanQuery) {
    throw new Error('Search query is required.');
  }

  const key = String(apiKey || '').trim();
  if (!key) {
    throw new Error('Search API key is required.');
  }

  const normalizedProvider = String(provider || 'tavily').trim().toLowerCase();
  if (!PROVIDER_ENDPOINTS[normalizedProvider]) {
    throw new Error(`Unsupported search provider: "${provider}". Use tavily, serper, or brave.`);
  }

  const limit = Math.max(1, Math.min(20, Number(maxResults) || 5));
  const startedAt = Date.now();

  let res;
  if (normalizedProvider === 'tavily') {
    const url = applyCorsProxy(PROVIDER_ENDPOINTS.tavily, corsProxy);
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: key,
        query: cleanQuery,
        max_results: limit,
        search_depth: 'basic',
        include_answer: false,
      }),
      signal,
    });
  } else if (normalizedProvider === 'serper') {
    const url = applyCorsProxy(PROVIDER_ENDPOINTS.serper, corsProxy);
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': key,
      },
      body: JSON.stringify({
        q: cleanQuery,
        num: limit,
      }),
      signal,
    });
  } else {
    const targetUrl = `${PROVIDER_ENDPOINTS.brave}?q=${encodeURIComponent(cleanQuery)}&count=${limit}`;
    const url = applyCorsProxy(targetUrl, corsProxy);
    res = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'X-Subscription-Token': key,
      },
      signal,
    });
  }

  if (!res.ok) {
    const errText = (await res.text().catch(() => '')).slice(0, 240);
    throw new Error(`${normalizedProvider} search failed (${res.status}): ${errText || res.statusText}`);
  }

  const data = await res.json();
  let rawItems = [];
  if (normalizedProvider === 'tavily') {
    rawItems = Array.isArray(data?.results) ? data.results : [];
  } else if (normalizedProvider === 'serper') {
    rawItems = Array.isArray(data?.organic) ? data.organic : [];
  } else if (normalizedProvider === 'brave') {
    rawItems = Array.isArray(data?.web?.results) ? data.web.results : [];
  }

  const sources = normalizeSources(rawItems, limit);
  const durationMs = Math.max(0, Date.now() - startedAt);

  return {
    query: cleanQuery,
    provider: normalizedProvider,
    sources,
    durationMs,
  };
}

/**
 * Build a grounded prompt with numbered web sources, inline citation rules,
 * and a ---FOLLOWUPS--- section request.
 *
 * @param {string} userQuery
 * @param {Array<{ index: number, title: string, url: string, domain: string, snippet: string }>} sources
 * @returns {string}
 */
export function buildGroundedPrompt(userQuery, sources = []) {
  const cleanQuery = String(userQuery || '').trim();
  if (!Array.isArray(sources) || !sources.length) {
    return cleanQuery;
  }

  const sourceBlock = sources
    .map((s, i) => {
      const idx = s.index ?? i + 1;
      const title = s.title || s.domain || s.url || `Source ${idx}`;
      const snippet = s.snippet ? `\nSnippet: ${s.snippet}` : '';
      return `[${idx}] ${title} (${s.domain || ''})\nURL: ${s.url || ''}${snippet}`;
    })
    .join('\n\n');

  return [
    'Use the following live web search results to answer the user accurately and concisely.',
    '',
    'WEB SEARCH RESULTS:',
    sourceBlock,
    '',
    'INSTRUCTIONS:',
    '- Cite supporting sources inline using bracketed numbers like [1], [2] immediately after the relevant statement.',
    '- Only cite source numbers that exist in the results above; never invent URLs or citations.',
    '- Respond in the same language as the user question.',
    '- At the very end of your response, add a line containing exactly `---FOLLOWUPS---` followed by 3 short, relevant follow-up questions (one per line, no bullets or numbering) in the same language as the user.',
    '',
    `USER QUESTION:\n${cleanQuery}`,
  ].join('\n');
}

/**
 * Extract the trailing ---FOLLOWUPS--- block from a model response.
 *
 * @param {string} text
 * @returns {{ cleanText: string, followUps: string[] }}
 */
export function extractFollowUps(text) {
  if (typeof text !== 'string' || !text) {
    return { cleanText: '', followUps: [] };
  }

  const delimiterRe = /\r?\n?\s*-{2,}\s*FOLLOWUPS\s*-{2,}\s*\r?\n?/i;
  const match = delimiterRe.exec(text);
  if (!match) {
    return { cleanText: text, followUps: [] };
  }

  const cleanText = text.slice(0, match.index).trimEnd();
  const tail = text.slice(match.index + match[0].length);

  const seen = new Set();
  const followUps = [];

  for (const rawLine of tail.split(/\r?\n/)) {
    const cleaned = rawLine
      .trim()
      .replace(/^(?:[-*•]+|\d+[.)\]])\s*/, '')
      .replace(/^["'`]+|["'`]+$/g, '')
      .trim();

    if (!cleaned || seen.has(cleaned.toLowerCase())) continue;
    seen.add(cleaned.toLowerCase());
    followUps.push(cleaned);
    if (followUps.length >= 3) break;
  }

  return { cleanText, followUps };
}

/**
 * Render Perplexity-style horizontal source cards (XSS-safe).
 *
 * @param {Array<{ index: number, title: string, url: string, domain: string, snippet?: string }>} sources
 * @returns {string}
 */
export function renderSourceCardsHtml(sources = []) {
  if (!Array.isArray(sources) || !sources.length) return '';

  const cards = sources
    .map((src, i) => {
      const url = safeUrl(src?.url || '');
      if (!url) return '';
      const idx = Number(src?.index) || i + 1;
      const domain = escapeHtml(src?.domain || extractDomain(url) || 'web');
      const title = escapeHtml(src?.title || domain);
      const href = escapeHtml(url);

      return `<a class="web-source-card" href="${href}" target="_blank" rel="noopener noreferrer" title="${title}" data-source-index="${idx}"><span class="web-source-badge">${idx}</span><span class="web-source-body"><span class="web-source-title">${title}</span><span class="web-source-domain">${domain}</span></span></a>`;
    })
    .filter(Boolean);

  if (!cards.length) return '';
  return `<div class="web-sources-strip" role="region" aria-label="Web sources">${cards.join('')}</div>`;
}

/**
 * Replace inline [1], [2] citation markers in rendered HTML with clickable
 * `<a class="cite-chip" ...>[1]</a>` links without touching tags, anchors, or code blocks.
 *
 * @param {string} html
 * @param {Array<{ index: number, title: string, url: string, domain: string }>} sources
 * @returns {string}
 */
export function linkifyCitations(html, sources = []) {
  if (typeof html !== 'string' || !html) return '';
  if (!Array.isArray(sources) || !sources.length) return html;

  const sourceMap = new Map();
  for (let i = 0; i < sources.length; i++) {
    const src = sources[i];
    const url = safeUrl(src?.url || '');
    if (!url) continue;
    const idx = Number(src?.index) || i + 1;
    sourceMap.set(idx, {
      index: idx,
      url,
      title: src?.title || src?.domain || url,
      domain: src?.domain || extractDomain(url),
    });
  }

  if (!sourceMap.size) return html;

  let inAnchor = 0;
  let inCode = 0;
  let inPre = 0;

  return html
    .split(/(<[^>]+>)/g)
    .map((segment) => {
      if (!segment) return segment;
      if (segment.startsWith('<') && segment.endsWith('>')) {
        const tagMatch = /^<\s*(\/)?\s*([a-z0-9]+)/i.exec(segment);
        if (tagMatch) {
          const isClosing = Boolean(tagMatch[1]);
          const tagName = tagMatch[2].toLowerCase();
          const delta = isClosing ? -1 : 1;
          if (tagName === 'a') inAnchor = Math.max(0, inAnchor + delta);
          else if (tagName === 'code') inCode = Math.max(0, inCode + delta);
          else if (tagName === 'pre') inPre = Math.max(0, inPre + delta);
        }
        return segment;
      }

      if (inAnchor > 0 || inCode > 0 || inPre > 0) {
        return segment;
      }

      return segment.replace(/\[(\d{1,2})\]/g, (full, numStr) => {
        const idx = Number(numStr);
        const src = sourceMap.get(idx);
        if (!src) return full;

        const href = escapeHtml(src.url);
        const tooltip = escapeHtml(src.domain ? `${src.title} (${src.domain})` : src.title);
        return `<a class="cite-chip" href="${href}" target="_blank" rel="noopener noreferrer" title="${tooltip}" data-cite-index="${idx}">[${idx}]</a>`;
      });
    })
    .join('');
}
