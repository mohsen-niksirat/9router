/**
 * Client-side Multi-Provider AI Router for 9Router Web.
 * - Executes chains directly from the visual node-based Combo graph
 * - Supports real SSE streaming, reasoning_content, vision, and Image Gen/Edit
 * - Automatic key & provider failover with live latency/token telemetry
 */

import { store } from './store.js';

function applyCorsProxy(url, proxyOverride) {
  const proxy = (proxyOverride !== undefined ? proxyOverride : store.state.settings.corsProxy || '').trim();
  if (!proxy) return url;
  return proxy.includes('{url}') ? proxy.replace('{url}', encodeURIComponent(url)) : `${proxy.replace(/\/+$/, '')}/${url}`;
}

/**
 * Fetch available model IDs from an OpenAI-compatible GET /models endpoint.
 * @param {{ baseUrl: string, apiKey?: string, corsProxy?: string }} opts
 * @returns {Promise<string[]>}
 */
export async function fetchProviderModels({ baseUrl, apiKey = '', corsProxy } = {}) {
  const cleanBase = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!cleanBase || !/^https?:\/\//i.test(cleanBase)) {
    throw new Error('Base URL معتبر وارد کنید (با http:// یا https://).');
  }
  const headers = { Accept: 'application/json' };
  const cleanKey = String(apiKey || '').trim();
  if (cleanKey) {
    headers.Authorization = `Bearer ${cleanKey}`;
  }

  const requestModels = async (endpoint) => {
    try {
      return await fetch(applyCorsProxy(endpoint, corsProxy), { method: 'GET', headers });
    } catch (err) {
      if (err instanceof TypeError) {
        throw new Error(
          'خطای اتصال یا محدودیت CORS از سمت سرور ارائه‌دهنده. اگر این ارائه‌دهنده اجازه درخواست مستقیم از مرورگر را نمی‌دهد، در بخش تنظیمات یک CORS Proxy وارد کنید یا آدرس Base URL (مثلاً /v1) را بررسی کنید.'
        );
      }
      throw err;
    }
  };

  let res = await requestModels(`${cleanBase}/models`);
  if (res.status === 404 && !/\/v1$/i.test(cleanBase)) {
    res = await requestModels(`${cleanBase}/v1/models`);
  }
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`خطای سرور (${res.status}): ${errText.slice(0, 160) || res.statusText}`);
  }

  const payload = await res.json();
  let rawList = [];
  if (Array.isArray(payload)) {
    rawList = payload;
  } else if (Array.isArray(payload?.data)) {
    rawList = payload.data;
  } else if (Array.isArray(payload?.models)) {
    rawList = payload.models;
  }

  const ids = new Set();
  for (const item of rawList) {
    const id = typeof item === 'string' ? item : item?.id || item?.name || '';
    const trimmed = String(id).trim();
    if (trimmed) ids.add(trimmed);
  }
  return Array.from(ids).sort((a, b) => a.localeCompare(b));
}

/**
 * Resolve ordered list of provider entries from a Combo's visual node graph.
 * Honors per-node model selection (`node.model`) and preserves node order.
 */
export function resolveComboChain(combo) {
  const policyNode = combo.nodes.find((n) => n.type === 'policy');
  const policy = policyNode?.policy || combo.policy || 'fallback';

  // Walk edges starting from policyNode (or startNode) in graph order
  const startId = policyNode?.id || combo.nodes.find((n) => n.type === 'start')?.id;
  const visited = new Set();
  const orderedNodes = [];
  const seenNodeIds = new Set();

  const queue = [startId];
  while (queue.length) {
    const cur = queue.shift();
    if (!cur || visited.has(cur)) continue;
    visited.add(cur);
    const outgoing = combo.edges.filter((e) => e.from === cur);
    for (const edge of outgoing) {
      const target = combo.nodes.find((n) => n.id === edge.to);
      if (!target) continue;
      if (target.type === 'provider' && target.providerId && !seenNodeIds.has(target.id)) {
        seenNodeIds.add(target.id);
        orderedNodes.push(target);
      }
      queue.push(target.id);
    }
  }

  // Fallback: if user placed provider nodes without edges, include them
  if (!orderedNodes.length) {
    for (const n of combo.nodes) {
      if (n.type === 'provider' && n.providerId && !seenNodeIds.has(n.id)) {
        seenNodeIds.add(n.id);
        orderedNodes.push(n);
      }
    }
  }

  let entries = orderedNodes
    .map((n) => {
      const provider = store.state.providers.find((p) => p.id === n.providerId);
      if (!provider) return null;
      return { provider, model: n.model || '' };
    })
    .filter(Boolean);

  // Apply routing policy ordering
  if (policy === 'round_robin' && entries.length > 1) {
    const shift = store.state.rrCursor % entries.length;
    store.state.rrCursor = (store.state.rrCursor + 1) % 100000;
    entries = [...entries.slice(shift), ...entries.slice(0, shift)];
  } else if (policy === 'smart_router') {
    entries.sort((a, b) => {
      const failA = a.provider.keys.reduce((s, k) => s + (k.failures || 0), 0);
      const failB = b.provider.keys.reduce((s, k) => s + (k.failures || 0), 0);
      return failA - failB;
    });
  } else if (policy === 'least_used') {
    entries.sort((a, b) => {
      const tokA = a.provider.keys.reduce((s, k) => s + (k.tokens || 0), 0);
      const tokB = b.provider.keys.reduce((s, k) => s + (k.tokens || 0), 0);
      return tokA - tokB;
    });
  }

  const providers = entries.map((e) => e.provider);
  return { policy, providers, entries };
}

function pickKey(provider, policy, triedKeyIds) {
  const candidates = provider.keys.filter((k) => k.status !== 'dead' && !triedKeyIds.has(k.id));
  if (!candidates.length) return null;
  if (policy === 'round_robin') {
    return [...candidates].sort((a, b) => (a.lastUsedAt || 0) - (b.lastUsedAt || 0))[0];
  }
  if (policy === 'smart_router') {
    return [...candidates].sort((a, b) => (a.failures || 0) - (b.failures || 0))[0];
  }
  if (policy === 'least_used') {
    return [...candidates].sort((a, b) => (a.tokens || 0) - (b.tokens || 0))[0];
  }
  return candidates[0];
}

export function extractTextParts(val) {
  if (val == null) return { text: '', thinking: '' };
  if (typeof val === 'string') return { text: val, thinking: '' };
  if (typeof val !== 'object') return { text: '', thinking: '' };

  let text = '';
  let thinking = '';
  const items = Array.isArray(val) ? val : [val];
  for (const item of items) {
    if (item == null) continue;
    if (typeof item === 'string') {
      text += item;
      continue;
    }
    if (typeof item !== 'object') continue;

    if (item.type === 'thinking' || item.type === 'reasoning') {
      if (item.thinking != null) {
        const sub = extractTextParts(item.thinking);
        thinking += sub.thinking + sub.text;
      } else if (item.text != null) {
        const sub = extractTextParts(item.text);
        thinking += sub.thinking + sub.text;
      } else if (item.content != null) {
        const sub = extractTextParts(item.content);
        thinking += sub.thinking + sub.text;
      }
      continue;
    }

    if (item.thinking != null) {
      const sub = extractTextParts(item.thinking);
      thinking += sub.thinking + sub.text;
    }
    if (item.text != null) {
      const sub = extractTextParts(item.text);
      text += sub.text;
      thinking += sub.thinking;
    } else if (item.content != null) {
      const sub = extractTextParts(item.content);
      text += sub.text;
      thinking += sub.thinking;
    }
  }
  return { text, thinking };
}

async function parseSSE(res, onStream, signal, onFirstToken) {
  const reader = res.body.getReader();
  const dec = new TextDecoder('utf-8');
  let buffer = '';
  let accumulated = '';
  let thinking = '';
  let usage = null;
  let doneSignal = false;
  let firstTokenSeen = false;

  const markFirstToken = () => {
    if (!firstTokenSeen) {
      firstTokenSeen = true;
      onFirstToken?.();
    }
  };

  const processLine = (line) => {
    const t = line.trim();
    if (!t.startsWith('data:')) return;
    const payload = t.slice(5).trim();
    if (payload === '[DONE]') { doneSignal = true; return; }
    try {
      const ev = JSON.parse(payload);
      if (ev.usage) usage = ev.usage;
      const d = ev.choices?.[0]?.delta || {};
      const rRaw = d.reasoning_content ?? d.reasoning;
      if (rRaw != null) {
        const rParts = extractTextParts(rRaw);
        const rText = rParts.thinking + rParts.text;
        if (rText) {
          markFirstToken();
          thinking += rText;
          onStream?.({ type: 'thinking', thinking, text: accumulated });
        }
      }
      if (d.content != null) {
        const parts = extractTextParts(d.content);
        if (parts.thinking) {
          markFirstToken();
          thinking += parts.thinking;
          onStream?.({ type: 'thinking', thinking, text: accumulated });
        }
        if (parts.text) {
          markFirstToken();
          accumulated += parts.text;
          onStream?.({ type: 'delta', delta: parts.text, text: accumulated, thinking });
        }
      }
    } catch {}
  };

  try {
    while (!doneSignal) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += dec.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const l of lines) {
        processLine(l);
        if (doneSignal) break;
      }
    }
    if (!doneSignal && buffer) processLine(buffer);
  } finally {
    reader.cancel().catch(() => {});
  }
  return { text: accumulated.trim(), thinking: thinking.trim(), usage };
}

/**
 * Send a chat completion request with live SSE streaming and automatic failover.
 * @param {object} opts
 * @param {Array} opts.messages
 * @param {function} [opts.onStream]
 * @param {function} [opts.onMeta] - Called with telemetry { providerName, modelId, ttftMs, totalMs, tokensOut, tokPerSec, done }
 * @param {AbortSignal} [opts.signal]
 * @param {{ type: 'provider'|'combo', id: string, model?: string, keyId?: string }} [opts.targetOverride]
 * @param {number} [opts.temperature]
 * @param {number} [opts.maxTokens]
 */
export async function runChatCompletion({ messages, onStream, onMeta, signal, targetOverride = null, temperature, maxTokens }) {
  const t0 = performance.now();
  const target = targetOverride || store.state.activeTarget;
  let entries = [];
  let policy = 'fallback';

  if (target?.type === 'provider') {
    const p = store.state.providers.find((x) => x.id === target.id);
    if (p) entries = [{ provider: p, model: target?.model || '' }];
  } else {
    const combo = store.state.combos.find((c) => c.id === target?.id) || store.state.combos[0];
    if (combo) {
      const resolved = resolveComboChain(combo);
      entries = resolved.entries || resolved.providers.map((p) => ({ provider: p, model: '' }));
      policy = resolved.policy;
    }
  }

  if (!entries.length) {
    throw new Error('هیچ ارائه‌دهنده یا کمبویی انتخاب نشده است. از بخش Providers & Keys کلید اضافه کنید.');
  }

  let lastError = null;
  for (const entry of entries) {
    const prov = entry.provider;
    const triedKeys = new Set();
    const pinnedKey =
      target?.type === 'provider' && target?.keyId
        ? (prov.keys || []).find((k) => k.id === target.keyId) || null
        : null;
    const maxAttempts = pinnedKey ? 1 : Math.max(1, prov.keys.length);
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const key = pinnedKey || pickKey(prov, policy, triedKeys);
      if (!key) break;
      triedKeys.add(key.id);

      const model = entry.model || target?.model || prov.defaultModel || prov.models[0] || '';
      if (!model) {
        lastError = new Error(`هیچ مدلی برای ارائه‌دهنده ${prov.name} تعریف نشده است.`);
        break;
      }
      const url = applyCorsProxy(`${prov.baseUrl.replace(/\/+$/, '')}/chat/completions`);
      const attemptStart = performance.now();
      let ttftMs = null;

      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${key.value}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            messages,
            temperature:
              typeof temperature === 'number' && !Number.isNaN(temperature)
                ? temperature
                : Number(store.state.settings.temperature ?? 0.7),
            max_tokens:
              typeof maxTokens === 'number' && !Number.isNaN(maxTokens)
                ? maxTokens
                : Number(store.state.settings.maxTokens ?? 4096),
            stream: true,
          }),
          signal,
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          const err = new Error(`${prov.name} (${res.status}): ${errText.slice(0, 180)}`);
          err.status = res.status;
          throw err;
        }

        const ct = (res.headers.get('content-type') || '').toLowerCase();
        let out;
        if (ct.includes('application/json') || !res.body?.getReader) {
          const data = await res.json();
          ttftMs = Math.round(performance.now() - attemptStart);
          const msg = data.choices?.[0]?.message || {};
          const contentParts = extractTextParts(msg.content);
          const reasoningParts = extractTextParts(msg.reasoning_content ?? msg.reasoning);
          out = {
            text: contentParts.text,
            thinking: [reasoningParts.thinking, reasoningParts.text, contentParts.thinking].filter(Boolean).join(''),
            usage: data.usage,
          };
        } else {
          out = await parseSSE(res, onStream, signal, () => {
            ttftMs = Math.round(performance.now() - attemptStart);
            onMeta?.({
              providerName: prov.name,
              modelId: model,
              ttftMs,
              totalMs: null,
              tokensOut: 0,
              tokPerSec: 0,
              done: false,
            });
          });
        }

        const totalMs = Math.round(performance.now() - t0);
        if (ttftMs === null) ttftMs = totalMs;
        const tokensOut = out.usage?.completion_tokens || Math.ceil((out.text.length + out.thinking.length) / 4);
        const tokens = out.usage?.total_tokens || tokensOut;
        const tokPerSec = Math.round((tokensOut / Math.max(0.05, totalMs / 1000)) * 10) / 10;

        const meta = {
          providerName: prov.name,
          modelId: model,
          ttftMs,
          totalMs,
          tokensOut,
          tokPerSec,
          done: true,
        };
        onMeta?.(meta);

        key.lastUsedAt = Date.now();
        key.tokens = (key.tokens || 0) + tokens;
        key.failures = 0;
        key.status = 'active';
        store.save();

        return {
          text: out.text,
          thinking: out.thinking,
          provider: prov.name,
          providerName: prov.name,
          model,
          modelId: model,
          tokens,
          tokensOut,
          elapsedMs: totalMs,
          totalMs,
          ttftMs,
          tokPerSec,
          meta,
        };
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        lastError = err;
        key.failures = (key.failures || 0) + 1;
        if (err.status === 401 || err.status === 403) key.status = 'dead';
        else if (err.status === 429) key.status = 'cooldown';
        store.save();
      }
    }
  }

  throw new Error(
    lastError
      ? `همه ارائه‌دهنده‌ها شکست خوردند. آخرین خطا: ${lastError.message}`
      : 'هیچ کلید API فعالی در ارائه‌دهنده‌های انتخاب‌شده وجود ندارد. لطفاً ابتدا کلید اضافه کنید.'
  );
}

export const streamChat = runChatCompletion;

/**
 * Generate or Edit an image using OpenAI-compatible /images/generations or /images/edits.
 */
export async function runImageGeneration({ prompt, sourceImageDataUrl = null, signal }) {
  const t0 = performance.now();
  // Prefer an active provider with keys (ideally one that supportsImages)
  const withKeys = store.state.providers.filter((p) => p.keys.some((k) => k.status !== 'dead'));
  const targetProv = withKeys.find((p) => p.supportsImages) || withKeys[0];

  // Free zero-key fallback via Pollinations.ai when no image-capable API key is configured
  if (!targetProv || (!targetProv.supportsImages && !sourceImageDataUrl)) {
    const seed = Math.floor(Math.random() * 1e9);
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&seed=${seed}&nologo=true`;
    return {
      imageUrl: url,
      revisedPrompt: prompt,
      provider: 'Pollinations (رایگان بدون کلید)',
      model: 'flux',
      elapsedMs: Math.round(performance.now() - t0),
    };
  }

  const key = targetProv.keys.find((k) => k.status !== 'dead');
  const imgModel = targetProv.models.find((m) => /image|dall-e|flux|imagen/i.test(m)) || 'dall-e-3';

  let res;
  if (sourceImageDataUrl) {
    // Image Edit endpoint (/images/edits)
    const blob = await (await fetch(sourceImageDataUrl)).blob();
    const fd = new FormData();
    fd.append('image', blob, 'input.png');
    fd.append('prompt', prompt || 'Enhance and improve this image');
    fd.append('model', imgModel === 'dall-e-3' ? 'gpt-image-1' : imgModel);
    fd.append('n', '1');
    fd.append('size', '1024x1024');
    res = await fetch(applyCorsProxy(`${targetProv.baseUrl.replace(/\/+$/, '')}/images/edits`), {
      method: 'POST',
      headers: { Authorization: `Bearer ${key.value}` },
      body: fd,
      signal,
    });
  } else {
    // Image Generation endpoint (/images/generations)
    res = await fetch(applyCorsProxy(`${targetProv.baseUrl.replace(/\/+$/, '')}/images/generations`), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key.value}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: imgModel,
        prompt,
        n: 1,
        size: '1024x1024',
      }),
      signal,
    });
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`${targetProv.name} Image API (${res.status}): ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  const item = data.data?.[0];
  const imageUrl = item?.url || (item?.b64_json ? `data:image/png;base64,${item.b64_json}` : null);
  if (!imageUrl) throw new Error('ارائه‌دهنده تصویری برنگرداند.');

  return {
    imageUrl,
    revisedPrompt: item?.revised_prompt || '',
    provider: targetProv.name,
    model: imgModel,
    elapsedMs: Math.round(performance.now() - t0),
  };
}
