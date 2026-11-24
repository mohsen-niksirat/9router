/**
 * Client-side Multi-Provider AI Router for 9Router Web.
 * - Executes chains directly from the visual node-based Combo graph
 * - Supports real SSE streaming, reasoning_content, vision, and Image Gen/Edit
 * - Automatic key & provider failover with live latency/token telemetry
 */

import { store } from './store.js';

function applyCorsProxy(url) {
  const proxy = (store.state.settings.corsProxy || '').trim();
  if (!proxy) return url;
  return proxy.includes('{url}') ? proxy.replace('{url}', encodeURIComponent(url)) : `${proxy.replace(/\/+$/, '')}/${url}`;
}

/**
 * Resolve ordered list of provider entries from a Combo's visual node graph.
 */
export function resolveComboChain(combo) {
  const policyNode = combo.nodes.find((n) => n.type === 'policy');
  const policy = policyNode?.policy || combo.policy || 'fallback';

  // Walk edges starting from policyNode (or startNode) in graph order
  const startId = policyNode?.id || combo.nodes.find((n) => n.type === 'start')?.id;
  const visited = new Set();
  const orderedProviderIds = [];

  const queue = [startId];
  while (queue.length) {
    const cur = queue.shift();
    if (!cur || visited.has(cur)) continue;
    visited.add(cur);
    const outgoing = combo.edges.filter((e) => e.from === cur);
    for (const edge of outgoing) {
      const target = combo.nodes.find((n) => n.id === edge.to);
      if (!target) continue;
      if (target.type === 'provider' && target.providerId) {
        if (!orderedProviderIds.includes(target.providerId)) {
          orderedProviderIds.push(target.providerId);
        }
      }
      queue.push(target.id);
    }
  }

  // Fallback: if user placed provider nodes without edges, include them
  if (!orderedProviderIds.length) {
    for (const n of combo.nodes) {
      if (n.type === 'provider' && n.providerId) orderedProviderIds.push(n.providerId);
    }
  }

  let providers = orderedProviderIds
    .map((pid) => store.state.providers.find((p) => p.id === pid))
    .filter(Boolean);

  // Apply routing policy ordering
  if (policy === 'round_robin' && providers.length > 1) {
    const shift = store.state.rrCursor % providers.length;
    store.state.rrCursor = (store.state.rrCursor + 1) % 100000;
    providers = [...providers.slice(shift), ...providers.slice(0, shift)];
  } else if (policy === 'smart_router') {
    providers.sort((a, b) => {
      const failA = a.keys.reduce((s, k) => s + (k.failures || 0), 0);
      const failB = b.keys.reduce((s, k) => s + (k.failures || 0), 0);
      return failA - failB;
    });
  } else if (policy === 'least_used') {
    providers.sort((a, b) => {
      const tokA = a.keys.reduce((s, k) => s + (k.tokens || 0), 0);
      const tokB = b.keys.reduce((s, k) => s + (k.tokens || 0), 0);
      return tokA - tokB;
    });
  }

  return { policy, providers };
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

function extractContentParts(content) {
  if (!content) return { text: '', thinking: '' };
  if (typeof content === 'string') return { text: content, thinking: '' };

  let text = '';
  let thinking = '';
  const items = Array.isArray(content) ? content : [content];
  for (const item of items) {
    if (!item) continue;
    if (typeof item === 'string') {
      text += item;
    } else if (item.type === 'thinking' || item.type === 'reasoning') {
      if (typeof item.thinking === 'string') thinking += item.thinking;
      else if (Array.isArray(item.thinking)) {
        for (const sub of item.thinking) {
          if (typeof sub === 'string') thinking += sub;
          else if (sub?.text) thinking += sub.text;
        }
      } else if (typeof item.text === 'string') {
        thinking += item.text;
      }
    } else if (typeof item.text === 'string') {
      text += item.text;
    } else if (typeof item.content === 'string') {
      text += item.content;
    }
  }
  return { text, thinking };
}

async function parseSSE(res, onStream, signal) {
  const reader = res.body.getReader();
  const dec = new TextDecoder('utf-8');
  let buffer = '';
  let accumulated = '';
  let thinking = '';
  let usage = null;
  let doneSignal = false;

  const processLine = (line) => {
    const t = line.trim();
    if (!t.startsWith('data:')) return;
    const payload = t.slice(5).trim();
    if (payload === '[DONE]') { doneSignal = true; return; }
    try {
      const ev = JSON.parse(payload);
      if (ev.usage) usage = ev.usage;
      const d = ev.choices?.[0]?.delta || {};
      const r = d.reasoning_content || d.reasoning || '';
      if (typeof r === 'string' && r) {
        thinking += r;
        onStream?.({ type: 'thinking', thinking, text: accumulated });
      }
      if (d.content) {
        const parts = extractContentParts(d.content);
        if (parts.thinking) {
          thinking += parts.thinking;
          onStream?.({ type: 'thinking', thinking, text: accumulated });
        }
        if (parts.text) {
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
 */
export async function runChatCompletion({ messages, onStream, signal }) {
  const t0 = performance.now();
  const target = store.state.activeTarget;
  let providers = [];
  let policy = 'fallback';

  if (target?.type === 'provider') {
    const p = store.state.providers.find((x) => x.id === target.id);
    if (p) providers = [p];
  } else {
    const combo = store.state.combos.find((c) => c.id === target?.id) || store.state.combos[0];
    if (combo) {
      const resolved = resolveComboChain(combo);
      providers = resolved.providers;
      policy = resolved.policy;
    }
  }

  if (!providers.length) {
    throw new Error('هیچ ارائه‌دهنده یا کمبویی انتخاب نشده است. از بخش Providers & Keys کلید اضافه کنید.');
  }

  let lastError = null;
  for (const prov of providers) {
    const triedKeys = new Set();
    for (let attempt = 0; attempt < Math.max(1, prov.keys.length); attempt++) {
      const key = pickKey(prov, policy, triedKeys);
      if (!key) break;
      triedKeys.add(key.id);

      const model = prov.defaultModel || prov.models[0] || 'gpt-4o-mini';
      const url = applyCorsProxy(`${prov.baseUrl.replace(/\/+$/, '')}/chat/completions`);

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
            temperature: Number(store.state.settings.temperature ?? 0.7),
            max_tokens: Number(store.state.settings.maxTokens ?? 4096),
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
          const parts = extractContentParts(data.choices?.[0]?.message?.content);
          out = {
            text: parts.text,
            thinking: parts.thinking,
            usage: data.usage,
          };
        } else {
          out = await parseSSE(res, onStream, signal);
        }

        const elapsedMs = Math.round(performance.now() - t0);
        const tokens = out.usage?.total_tokens || Math.ceil(out.text.length / 4);
        key.lastUsedAt = Date.now();
        key.tokens = (key.tokens || 0) + tokens;
        key.failures = 0;
        key.status = 'active';
        store.save();

        return {
          text: out.text,
          thinking: out.thinking,
          provider: prov.name,
          model,
          tokens,
          elapsedMs,
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
