/**
 * Manus AI API v2 Client Engine (https://open.manus.ai/docs/v2)
 * Zero-dependency ES module supporting:
 * - Task creation & multi-turn follow-up (`task.create`, `task.sendMessage`, `task.stop`)
 * - Presigned file uploads (`file.upload` + PUT bytes)
 * - Live polling (`task.detail` + `task.listMessages?verbose=true`)
 * - Plan steps, tool events, explanations, sandbox path -> signed URL rewriting,
 *   dual visual images + downloadable file attachments, and question options.
 */

export const MANUS_MODELS = ['standard', 'max', 'lite'];

const MANUS_CORS_ERROR_MSG =
  'خطای اتصال به سرور Manus AI (محدودیت CORS مرورگر): سرویس api.manus.ai درخواست مستقیم از مرورگر را مسدود می‌کند. لطفاً در بخش «تنظیمات -> CORS Proxy» یک آدرس CORS Proxy معتبر تنظیم کنید.';

const TERMINAL_STATUSES = new Set(['stopped', 'completed', 'done', 'waiting', 'failed', 'error']);

const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif|svg|bmp)$/i;

function escapeRegExp(str) {
  return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function createAbortError() {
  if (typeof DOMException === 'function') {
    return new DOMException('Aborted', 'AbortError');
  }
  const err = new Error('Aborted');
  err.name = 'AbortError';
  return err;
}

export function isManusProvider(provider) {
  if (!provider) return false;
  if (typeof provider === 'string') {
    return /api\.manus\.ai/i.test(provider);
  }
  if (typeof provider === 'object') {
    return provider.apiType === 'manus-v2' || /api\.manus\.ai/i.test(String(provider.baseUrl || ''));
  }
  return false;
}

export function normalizeManusRootUrl(baseUrl = 'https://api.manus.ai') {
  const cleaned = String(baseUrl || '')
    .trim()
    .replace(/\/v[12]\/?$/i, '')
    .replace(/\/+$/, '');
  return cleaned || 'https://api.manus.ai';
}

export function applyManusCorsProxy(url, corsProxy = '') {
  const proxy = String(corsProxy || '').trim();
  if (!proxy) return url;
  return proxy.includes('{url}')
    ? proxy.replace('{url}', encodeURIComponent(url))
    : `${proxy.replace(/\/+$/, '')}/${url}`;
}

function buildManusHeaders(apiKey) {
  return {
    'x-manus-api-key': String(apiKey || '').trim(),
    'Content-Type': 'application/json',
  };
}

async function manusJsonRequest(url, { method = 'GET', apiKey, body, corsProxy = '', signal } = {}) {
  if (signal?.aborted) throw createAbortError();
  const proxiedUrl = applyManusCorsProxy(url, corsProxy);
  const init = {
    method,
    headers: buildManusHeaders(apiKey),
    signal,
  };
  if (body !== undefined && method !== 'GET') {
    init.body = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(proxiedUrl, init);
  } catch (err) {
    if (signal?.aborted || err?.name === 'AbortError') throw createAbortError();
    if (err instanceof TypeError) {
      throw new Error(MANUS_CORS_ERROR_MSG);
    }
    throw err;
  }

  if (!res.ok) {
    const rawText = await res.text().catch(() => '');
    let detail = rawText;
    try {
      const parsed = JSON.parse(rawText);
      detail = parsed?.message || parsed?.error?.message || (typeof parsed?.error === 'string' ? parsed.error : '') || rawText;
    } catch {}
    const err = new Error(`خطای سرور Manus AI (${res.status}): ${String(detail || res.statusText || '').slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }

  return await res.json();
}

function inferMimeType(filename = '') {
  const lower = String(filename || '').toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.bmp')) return 'image/bmp';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.zip')) return 'application/zip';
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'text/html';
  if (lower.endsWith('.md')) return 'text/markdown';
  if (lower.endsWith('.csv')) return 'text/csv';
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  if (lower.endsWith('.wav')) return 'audio/wav';
  if (lower.endsWith('.mp4')) return 'video/mp4';
  return 'application/octet-stream';
}

function parseDataUrlToBytes(dataUrl, index = 0) {
  const str = String(dataUrl || '');
  const match = str.match(/^data:([^;,]+)?(?:;base64)?,(.*)$/s);
  if (!match) return null;
  const contentType = (match[1] || 'image/png').trim();
  const payload = match[2] || '';
  const isBase64 = /;base64,/i.test(str.slice(0, Math.min(str.length, 128)));

  let bytes;
  if (isBase64) {
    const cleanB64 = payload.replace(/\s+/g, '');
    const bin = atob(cleanB64);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      bytes[i] = bin.charCodeAt(i);
    }
  } else {
    bytes = new TextEncoder().encode(decodeURIComponent(payload));
  }

  const extMap = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/svg+xml': 'svg',
    'image/bmp': 'bmp',
  };
  const ext = extMap[contentType.toLowerCase()] || 'png';
  return {
    bytes,
    contentType,
    filename: `attachment_${index + 1}.${ext}`,
  };
}

/**
 * Upload a file via Manus v2 presigned upload flow:
 * 1) POST {root}/v2/file.upload -> { file: { id }, upload_url }
 * 2) PUT raw bytes/blob to upload_url -> returns file.id
 */
export async function uploadManusFile({
  baseUrl = 'https://api.manus.ai',
  apiKey,
  corsProxy = '',
  filename = 'attachment.bin',
  blobOrBytes,
  contentType = 'application/octet-stream',
  signal,
} = {}) {
  const root = normalizeManusRootUrl(baseUrl);
  const initRes = await manusJsonRequest(`${root}/v2/file.upload`, {
    method: 'POST',
    apiKey,
    corsProxy,
    body: { filename },
    signal,
  });

  const payload = initRes?.data && typeof initRes.data === 'object' ? initRes.data : initRes;
  const fileId = String(payload?.file?.id || initRes?.file?.id || payload?.file_id || payload?.id || '').trim();
  const uploadUrl = String(payload?.upload_url || initRes?.upload_url || payload?.uploadUrl || '').trim();

  if (!fileId || !uploadUrl) {
    throw new Error('پاسخ نامعتبر از سرویس بارگذاری فایل Manus AI دریافت شد.');
  }

  const putHeaders = {
    'Content-Type': contentType || inferMimeType(filename),
  };

  let putRes;
  try {
    putRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: putHeaders,
      body: blobOrBytes,
      signal,
    });
  } catch (err) {
    if (signal?.aborted || err?.name === 'AbortError') throw createAbortError();
    if (err instanceof TypeError && corsProxy) {
      putRes = await fetch(applyManusCorsProxy(uploadUrl, corsProxy), {
        method: 'PUT',
        headers: putHeaders,
        body: blobOrBytes,
        signal,
      });
    } else {
      throw err;
    }
  }

  if (!putRes.ok) {
    const err = new Error(`خطا در آپلود فایل به Manus AI (${putRes.status}).`);
    err.status = putRes.status;
    throw err;
  }

  return fileId;
}

function normalizePlanStatus(raw, fallback = 'todo') {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const s = String(raw).trim().toLowerCase();
  if (s === 'done' || s === 'completed' || s === 'complete' || s === 'finished' || s === 'success') return 'done';
  if (s === 'in_progress' || s === 'in-progress' || s === 'running' || s === 'active' || s === 'working' || s === 'current') {
    return 'in_progress';
  }
  return 'todo';
}

function normalizeToolStatus(raw) {
  if (raw === undefined || raw === null || raw === '') return 'done';
  const s = String(raw).trim().toLowerCase();
  if (s === 'failed' || s === 'error') return 'error';
  if (s === 'in_progress' || s === 'in-progress' || s === 'running' || s === 'pending' || s === 'active' || s === 'working') {
    return 'in_progress';
  }
  return 'done';
}

function extractContentString(val) {
  if (val == null) return { text: '', inlineImages: [] };
  if (typeof val === 'string') return { text: val, inlineImages: [] };
  if (Array.isArray(val)) {
    const parts = [];
    const inlineImages = [];
    for (const item of val) {
      if (!item) continue;
      if (typeof item === 'string') {
        parts.push(item);
      } else if (typeof item === 'object') {
        if (item.type === 'image' || item.type === 'image_url') {
          const imgUrl = String(item.url || item.image_url?.url || item.image_url || '').trim();
          if (imgUrl) inlineImages.push(imgUrl);
        } else if (typeof item.text === 'string') {
          parts.push(item.text);
        } else if (typeof item.content === 'string') {
          parts.push(item.content);
        }
      }
    }
    return { text: parts.join(''), inlineImages };
  }
  if (typeof val === 'object') {
    if (typeof val.text === 'string') return { text: val.text, inlineImages: [] };
    if (typeof val.content === 'string') return { text: val.content, inlineImages: [] };
  }
  return { text: '', inlineImages: [] };
}

function isImageAttachment(att = {}, filename = '', path = '', url = '') {
  const ct = String(att.content_type || att.contentType || att.mime_type || att.mimeType || '').toLowerCase();
  if (ct.startsWith('image/')) return true;
  if (String(att.type || '').toLowerCase() === 'image') return true;
  const cleanUrlPath = String(url || '').split('?')[0].split('#')[0];
  return IMAGE_EXT_RE.test(filename || path || cleanUrlPath);
}

/**
 * Pure helper that parses Manus `task.listMessages` events.
 * Slices after the latest `user_message` when `onlyAfterLastUser === true` and a `user_message` exists.
 */
export function parseManusMessages(messages = [], onlyAfterLastUser = true) {
  const list = Array.isArray(messages) ? messages : [];
  let sliceStart = 0;
  if (onlyAfterLastUser) {
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i];
      if (m && (m.type === 'user_message' || (!m.type && m.role === 'user'))) {
        sliceStart = i + 1;
        break;
      }
    }
  }

  const events = sliceStart > 0 ? list.slice(sliceStart) : list;

  let planSteps = [];
  const toolEvents = [];
  const toolIndexById = new Map();
  const thinkingParts = [];
  const textParts = [];
  const standaloneImageUrls = [];
  const attachmentMap = new Map();
  let questionOptions = [];
  let errorMessage = '';

  const addOrMergeAttachment = (rawAtt) => {
    if (!rawAtt || typeof rawAtt !== 'object') return;
    const url = String(rawAtt.url || rawAtt.signed_url || rawAtt.download_url || rawAtt.file_url || '').trim();
    const path = String(rawAtt.path || rawAtt.sandbox_path || rawAtt.file_path || '').trim();
    const fallbackNameFromPath = path ? path.split('/').filter(Boolean).pop() || '' : '';
    const fallbackNameFromUrl = url ? url.split('?')[0].split('#')[0].split('/').filter(Boolean).pop() || '' : '';
    const filename = String(
      rawAtt.filename || rawAtt.file_name || rawAtt.name || fallbackNameFromPath || fallbackNameFromUrl || 'file',
    ).trim();
    const isImage = isImageAttachment(rawAtt, filename, path, url);
    const rawCt = String(rawAtt.content_type || rawAtt.contentType || rawAtt.mime_type || rawAtt.mimeType || '').trim();
    const contentType = rawCt || inferMimeType(filename || path || url);
    const type = String(rawAtt.type || (isImage ? 'image' : 'file')).trim();
    const coverImage = String(
      rawAtt.cover_image || rawAtt.coverImage || rawAtt.thumbnail_url || rawAtt.thumbnail || '',
    ).trim();

    const dedupeKey = url || String(rawAtt.file_uid || rawAtt.file_id || rawAtt.id || '').trim() || path || filename;
    if (!dedupeKey) return;

    if (attachmentMap.has(dedupeKey)) {
      const prev = attachmentMap.get(dedupeKey);
      attachmentMap.set(dedupeKey, {
        filename: prev.filename || filename,
        contentType: prev.contentType || contentType,
        url: url || prev.url,
        path: path || prev.path,
        type: prev.type || type,
        isImage: prev.isImage || isImage,
        coverImage: coverImage || prev.coverImage,
      });
    } else {
      attachmentMap.set(dedupeKey, {
        filename,
        contentType,
        url,
        path,
        type,
        isImage,
        coverImage,
      });
    }
  };

  for (const ev of events) {
    if (!ev || typeof ev !== 'object') continue;
    const evType = String(ev.type || '').trim();

    if (Array.isArray(ev.attachments)) {
      for (const att of ev.attachments) addOrMergeAttachment(att);
    }

    if (evType === 'plan_update') {
      const payload =
        (ev.plan_update && typeof ev.plan_update === 'object' ? ev.plan_update : null) ||
        (ev.data && typeof ev.data === 'object' ? ev.data : null) ||
        ev;
      const rawSteps =
        payload.steps ||
        payload.plan?.steps ||
        (Array.isArray(payload.plan) ? payload.plan : null) ||
        payload.items ||
        ev.steps;

      if (Array.isArray(rawSteps)) {
        planSteps = rawSteps
          .map((s, idx) => {
            if (typeof s === 'string') {
              return { id: String(idx + 1), title: s.trim(), status: 'todo' };
            }
            if (!s || typeof s !== 'object') return null;
            const id = String(s.id ?? s.step_id ?? idx + 1);
            const title = String(s.title ?? s.description ?? s.text ?? s.content ?? s.name ?? '').trim();
            const rawStatus = s.status ?? s.state ?? (s.completed === true || s.done === true ? 'done' : 'todo');
            return {
              id,
              title,
              status: normalizePlanStatus(rawStatus, 'todo'),
            };
          })
          .filter((s) => s && s.title);
      } else if (payload.step_id != null || payload.id != null || payload.title) {
        const id = String(payload.step_id ?? payload.id ?? planSteps.length + 1);
        const title = String(payload.title ?? payload.description ?? payload.text ?? '').trim();
        const status = normalizePlanStatus(payload.status ?? payload.state, 'in_progress');
        const existingIdx = planSteps.findIndex((s) => s.id === id);
        if (existingIdx >= 0) {
          planSteps[existingIdx] = {
            ...planSteps[existingIdx],
            ...(title ? { title } : {}),
            status,
          };
        } else if (title) {
          planSteps.push({ id, title, status });
        }
      }
      continue;
    }

    if (evType === 'new_plan_step') {
      const payload =
        (ev.new_plan_step && typeof ev.new_plan_step === 'object' ? ev.new_plan_step : null) ||
        (ev.step && typeof ev.step === 'object' ? ev.step : null) ||
        (ev.data && typeof ev.data === 'object' ? ev.data : null) ||
        ev;
      const id = String(payload.id ?? payload.step_id ?? ev.id ?? `step_${planSteps.length + 1}`);
      const title = String(payload.title ?? payload.description ?? payload.content ?? payload.text ?? ev.title ?? '').trim();
      const rawStatus = payload.status ?? payload.state ?? ev.status;
      const status = normalizePlanStatus(rawStatus, 'in_progress');
      const existingIdx = planSteps.findIndex((s) => s.id === id);
      if (existingIdx >= 0) {
        planSteps[existingIdx] = {
          ...planSteps[existingIdx],
          ...(title ? { title } : {}),
          status,
        };
      } else if (title) {
        planSteps.push({ id, title, status });
      }
      continue;
    }

    if (evType === 'tool_used') {
      const payload =
        (ev.tool_used && typeof ev.tool_used === 'object' ? ev.tool_used : null) ||
        (ev.data && typeof ev.data === 'object' ? ev.data : null) ||
        ev;
      const rawId = String(payload.id ?? payload.tool_call_id ?? payload.call_id ?? ev.id ?? '').trim();
      const id = rawId || `tool_${toolEvents.length + 1}`;
      const tool = String(
        payload.tool ?? payload.tool_name ?? payload.name ?? payload.action ?? ev.tool ?? 'tool',
      ).trim();
      const brief = String(
        payload.brief ??
          payload.description ??
          payload.summary ??
          payload.title ??
          payload.command ??
          payload.query ??
          payload.url ??
          ev.brief ??
          '',
      ).trim();
      const status = normalizeToolStatus(payload.status ?? payload.state ?? ev.status);

      if (rawId && toolIndexById.has(rawId)) {
        const idx = toolIndexById.get(rawId);
        const prev = toolEvents[idx];
        toolEvents[idx] = {
          id: prev.id,
          tool: tool || prev.tool,
          brief: brief || prev.brief,
          status,
        };
      } else {
        if (rawId) toolIndexById.set(rawId, toolEvents.length);
        toolEvents.push({ id, tool, brief, status });
      }
      continue;
    }

    if (evType === 'explanation') {
      const payload = ev.explanation && typeof ev.explanation === 'object' ? ev.explanation : ev;
      const rawExp =
        payload.content ??
        payload.text ??
        (typeof ev.explanation === 'string' ? ev.explanation : null) ??
        ev.content ??
        ev.text;
      const { text } = extractContentString(rawExp);
      if (text.trim()) thinkingParts.push(text.trim());
      continue;
    }

    if (evType === 'assistant_message' || (!evType && ev.role === 'assistant')) {
      const payload = ev.assistant_message && typeof ev.assistant_message === 'object' ? ev.assistant_message : ev;
      if (Array.isArray(payload.attachments) && payload.attachments !== ev.attachments) {
        for (const att of payload.attachments) addOrMergeAttachment(att);
      }
      const { text, inlineImages } = extractContentString(payload.content ?? payload.text ?? ev.content ?? ev.text);
      if (text) textParts.push(text);
      for (const imgUrl of inlineImages) standaloneImageUrls.push(imgUrl);

      const qOpts = payload.question_expectation?.options ?? ev.question_expectation?.options ?? payload.options;
      if (Array.isArray(qOpts) && qOpts.length) {
        questionOptions = qOpts
          .map((opt) =>
            typeof opt === 'string'
              ? opt.trim()
              : String(opt?.label ?? opt?.text ?? opt?.title ?? opt?.value ?? '').trim(),
          )
          .filter(Boolean);
      }
      continue;
    }

    if (evType === 'error_message' || evType === 'error') {
      const payload = ev.error_message && typeof ev.error_message === 'object' ? ev.error_message : ev;
      const msg = String(
        payload.message ??
          payload.content ??
          payload.text ??
          (typeof ev.error === 'string' ? ev.error : ev.error?.message) ??
          '',
      ).trim();
      if (msg) errorMessage = msg;
    }
  }

  let text = textParts.join('\n\n').trim();
  const attachmentsList = Array.from(attachmentMap.values());

  // Rewrite sandbox paths (e.g. ](/home/ubuntu/img.png) or (/home/ubuntu/doc.pdf)) to signed attachment URLs
  const pathAttachments = attachmentsList
    .filter((a) => a.path && a.url)
    .sort((a, b) => b.path.length - a.path.length);

  for (const att of pathAttachments) {
    const escapedPath = escapeRegExp(att.path);
    const re = new RegExp(`(?<![a-zA-Z0-9])(?:sandbox:|file:\\/\\/)?${escapedPath}`, 'g');
    text = text.replace(re, att.url);
  }

  // Also capture any standalone https? image URLs in markdown or inline blocks so every generated image
  // appears BOTH in `images` (visual preview) AND in `attachments` (downloadable file card).
  if (text) {
    const mdImgRe = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g;
    let m;
    while ((m = mdImgRe.exec(text)) !== null) {
      standaloneImageUrls.push(m[1]);
    }
  }

  for (const imgUrl of standaloneImageUrls) {
    const cleanUrl = String(imgUrl || '').trim();
    if (!/^https?:\/\//i.test(cleanUrl)) continue;
    const alreadyExists = attachmentsList.some((a) => a.url === cleanUrl);
    if (!alreadyExists) {
      const nameFromUrl = cleanUrl.split('?')[0].split('#')[0].split('/').filter(Boolean).pop() || 'image.png';
      const filename = IMAGE_EXT_RE.test(nameFromUrl) ? nameFromUrl : `${nameFromUrl}.png`;
      attachmentsList.push({
        filename,
        contentType: inferMimeType(filename),
        url: cleanUrl,
        path: '',
        type: 'image',
        isImage: true,
        coverImage: '',
      });
    }
  }

  const images = attachmentsList
    .filter((a) => a.isImage && a.url)
    .map((a) => ({
      url: a.url,
      filename: a.filename,
      contentType: a.contentType,
    }));

  return {
    planSteps,
    toolEvents,
    thinking: thinkingParts.join('\n\n').trim(),
    text,
    attachments: attachmentsList,
    images,
    questionOptions,
    errorMessage,
  };
}

function extractLatestUserTurn(messages = []) {
  const list = Array.isArray(messages) ? messages : [];
  let userMsg = null;
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i]?.role === 'user') {
      userMsg = list[i];
      break;
    }
  }
  if (!userMsg && list.length) {
    userMsg = list[list.length - 1];
  }
  if (!userMsg) return { text: '', dataUrls: [] };

  let text = '';
  const dataUrls = [];

  if (typeof userMsg.content === 'string') {
    text = userMsg.content;
  } else if (Array.isArray(userMsg.content)) {
    const textParts = [];
    for (const part of userMsg.content) {
      if (!part) continue;
      if (typeof part === 'string') {
        textParts.push(part);
      } else if (part.type === 'text' && typeof part.text === 'string') {
        textParts.push(part.text);
      } else if (part.type === 'image_url') {
        const u = String(part.image_url?.url || part.image_url || '').trim();
        if (u.startsWith('data:')) dataUrls.push(u);
      }
    }
    text = textParts.join('\n').trim();
  }

  if (Array.isArray(userMsg.images)) {
    for (const img of userMsg.images) {
      const u = String(img || '').trim();
      if (u.startsWith('data:') && !dataUrls.includes(u)) {
        dataUrls.push(u);
      }
    }
  }

  return { text: text.trim(), dataUrls };
}

function abortableSleep(ms, signal) {
  if (!ms || ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(createAbortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Execute or continue a Manus AI v2 agent task with live polling.
 */
export async function runManusTask({
  provider,
  apiKey,
  model = 'standard',
  messages = [],
  existingTaskId = '',
  corsProxy = '',
  pollIntervalMs = 1500,
  onStream,
  onMeta,
  onManusUpdate,
  signal,
} = {}) {
  const t0 = performance.now();
  let ttftMs = null;
  const root = normalizeManusRootUrl(provider?.baseUrl || 'https://api.manus.ai');
  const cleanKey = String(apiKey || '').trim();
  if (!cleanKey) {
    throw new Error('کلید API برای Manus AI یافت نشد. لطفاً کلید x-manus-api-key را در بخش ارائه‌دهنده‌ها وارد کنید.');
  }

  if (signal?.aborted) throw createAbortError();

  const agentProfile = MANUS_MODELS.includes(model) ? model : 'standard';
  const { text: userText, dataUrls } = extractLatestUserTurn(messages);

  const fileParts = [];
  for (let i = 0; i < dataUrls.length; i++) {
    if (signal?.aborted) throw createAbortError();
    const decoded = parseDataUrlToBytes(dataUrls[i], i);
    if (!decoded) continue;
    try {
      const fileId = await uploadManusFile({
        baseUrl: root,
        apiKey: cleanKey,
        corsProxy,
        filename: decoded.filename,
        blobOrBytes: decoded.bytes,
        contentType: decoded.contentType,
        signal,
      });
      if (fileId) {
        fileParts.push({ type: 'file', file_id: fileId });
      }
    } catch (uploadErr) {
      if (signal?.aborted || uploadErr?.name === 'AbortError') throw createAbortError();
      // Gracefully continue with text if S3 presigned upload is blocked by browser CORS
    }
  }

  const contentParts = [
    {
      type: 'text',
      text: userText || (fileParts.length ? 'فایل پیوست‌شده را تحلیل کن.' : ''),
      visibility: 'visible',
    },
    ...fileParts,
  ];
  const messagePayload = { content: contentParts };

  let taskId = String(existingTaskId || '').trim();
  let stopSent = false;

  const stopRemoteTaskFireAndForget = () => {
    if (stopSent || !taskId) return;
    stopSent = true;
    fetch(applyManusCorsProxy(`${root}/v2/task.stop`, corsProxy), {
      method: 'POST',
      headers: buildManusHeaders(cleanKey),
      body: JSON.stringify({ task_id: taskId }),
    }).catch(() => {});
  };

  try {
    if (taskId) {
      const sendRes = await manusJsonRequest(`${root}/v2/task.sendMessage`, {
        method: 'POST',
        apiKey: cleanKey,
        corsProxy,
        body: {
          task_id: taskId,
          message: messagePayload,
        },
        signal,
      });
      const updatedId =
        sendRes?.data?.task_id || sendRes?.task_id || sendRes?.task?.id || sendRes?.data?.id || '';
      if (updatedId) taskId = String(updatedId).trim();
    } else {
      const createRes = await manusJsonRequest(`${root}/v2/task.create`, {
        method: 'POST',
        apiKey: cleanKey,
        corsProxy,
        body: {
          agent_profile: agentProfile,
          share_visibility: 'private',
          message: messagePayload,
        },
        signal,
      });
      taskId = String(
        createRes?.data?.task_id ||
          createRes?.task_id ||
          createRes?.task?.id ||
          createRes?.data?.id ||
          createRes?.id ||
          '',
      ).trim();
      if (!taskId) {
        throw new Error('شناسه تسک (task_id) از پاسخ سرور Manus AI دریافت نشد.');
      }
    }

    let finalParsed = {
      planSteps: [],
      toolEvents: [],
      thinking: '',
      text: '',
      attachments: [],
      images: [],
      questionOptions: [],
      errorMessage: '',
    };
    let finalStatus = 'running';
    let taskUsage = null;
    let pollTick = 0;

    while (true) {
      if (signal?.aborted) {
        stopRemoteTaskFireAndForget();
        throw createAbortError();
      }

      if (pollTick > 0) {
        await abortableSleep(pollIntervalMs, signal);
      }
      pollTick++;

      const encodedId = encodeURIComponent(taskId);
      const [detailRes, listRes] = await Promise.all([
        manusJsonRequest(`${root}/v2/task.detail?task_id=${encodedId}`, {
          method: 'GET',
          apiKey: cleanKey,
          corsProxy,
          signal,
        }),
        manusJsonRequest(
          `${root}/v2/task.listMessages?task_id=${encodedId}&verbose=true&order=asc&include_cover=true`,
          {
            method: 'GET',
            apiKey: cleanKey,
            corsProxy,
            signal,
          },
        ),
      ]);

      const rawMessages =
        listRes?.messages ||
        listRes?.data?.messages ||
        (Array.isArray(listRes?.data) ? listRes.data : null) ||
        [];
      const parsed = parseManusMessages(rawMessages, true);
      finalParsed = parsed;

      const rawStatus =
        detailRes?.status ||
        detailRes?.task?.status ||
        detailRes?.data?.status ||
        detailRes?.data?.task?.status ||
        'running';
      const status = String(rawStatus).trim().toLowerCase() || 'running';
      finalStatus = status;

      const detailUsage = detailRes?.usage || detailRes?.task?.usage || detailRes?.data?.usage || null;
      if (detailUsage) taskUsage = detailUsage;

      if (
        ttftMs === null &&
        (parsed.text || parsed.thinking || parsed.planSteps.length || parsed.toolEvents.length)
      ) {
        ttftMs = Math.round(performance.now() - t0);
      }

      onStream?.(parsed.text, parsed.thinking);

      const hasOutput = Boolean(
        parsed.text ||
          parsed.thinking ||
          parsed.attachments.length ||
          parsed.images.length ||
          parsed.errorMessage,
      );
      const isTerminal = TERMINAL_STATUSES.has(status) && (hasOutput || pollTick >= 6);
      onMeta?.({
        providerName: provider?.name || 'Manus AI',
        modelId: agentProfile,
        ttftMs,
        totalMs: isTerminal ? Math.round(performance.now() - t0) : null,
        tokensOut: 0,
        tokPerSec: 0,
        done: isTerminal,
      });

      onManusUpdate?.({
        taskId,
        status,
        manusStatus: status,
        planSteps: parsed.planSteps,
        toolEvents: parsed.toolEvents,
        attachments: parsed.attachments,
        images: parsed.images,
        questionOptions: parsed.questionOptions,
      });

      if (isTerminal) {
        if ((status === 'failed' || status === 'error') && !parsed.text) {
          throw new Error(
            parsed.errorMessage
              ? `خطای اجرای تسک Manus AI: ${parsed.errorMessage}`
              : 'اجرای تسک در Manus AI با خطا متوقف شد.',
          );
        }
        break;
      }
    }

    const totalMs = Math.round(performance.now() - t0);
    if (ttftMs === null) ttftMs = totalMs;

    return {
      taskId,
      manusTaskId: taskId,
      status: finalStatus,
      manusStatus: finalStatus,
      text: finalParsed.text,
      thinking: finalParsed.thinking,
      planSteps: finalParsed.planSteps,
      manusPlan: finalParsed.planSteps,
      toolEvents: finalParsed.toolEvents,
      manusTools: finalParsed.toolEvents,
      attachments: finalParsed.attachments,
      images: finalParsed.images,
      questionOptions: finalParsed.questionOptions,
      errorMessage: finalParsed.errorMessage,
      usage: taskUsage,
      ttftMs,
      totalMs,
    };
  } catch (err) {
    if (signal?.aborted || err?.name === 'AbortError') {
      stopRemoteTaskFireAndForget();
      throw createAbortError();
    }
    throw err;
  }
}
