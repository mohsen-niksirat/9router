/**
 * 9Router Web - Artifacts / Canvas Side-Pane Controller
 * Provides live sandboxed preview (HTML/SVG), formatted Markdown/code preview,
 * inline code editing with version history (v1, v2, ...), copy, download,
 * and AI refinement handoff.
 */

import { renderMarkdown, escHtml } from './markdown.js';

const EXT_MAP = {
  html: 'html',
  htm: 'html',
  svg: 'svg',
  markdown: 'md',
  md: 'md',
  javascript: 'js',
  js: 'js',
  mjs: 'js',
  jsx: 'jsx',
  typescript: 'ts',
  ts: 'ts',
  tsx: 'tsx',
  python: 'py',
  py: 'py',
  css: 'css',
  scss: 'scss',
  json: 'json',
  sql: 'sql',
  bash: 'sh',
  sh: 'sh',
  shell: 'sh',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yml',
  mermaid: 'mmd',
};

function normalizeLang(lang) {
  return String(lang || 'txt')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_+-]/g, '') || 'txt';
}

function getFileExtension(lang) {
  const norm = normalizeLang(lang);
  return EXT_MAP[norm] || 'txt';
}

function sanitizeFilename(title, lang) {
  const base = String(title || 'artifact')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 60);
  const ext = getFileExtension(lang);
  const name = base || 'artifact';
  return name.toLowerCase().endsWith(`.${ext}`) ? name : `${name}.${ext}`;
}

function buildSvgSrcdoc(svgCode) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  *, *::before, *::after { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 16px;
    width: 100%;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #ffffff;
    color: #111827;
    font-family: system-ui, -apple-system, sans-serif;
  }
  svg {
    max-width: 100%;
    max-height: calc(100vh - 32px);
    height: auto;
    display: block;
  }
</style>
</head>
<body>${svgCode}</body>
</html>`;
}

function copyTextFallback(text) {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    return navigator.clipboard.writeText(text);
  }
  return new Promise((resolve, reject) => {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      resolve();
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Create an Artifact / Canvas side-pane controller.
 * @param {object} options
 * @param {HTMLElement} options.paneEl - Container element (e.g. #artifact-pane)
 * @param {(payload: { title: string, lang: string, code: string, instruction: string }) => void} [options.onRefineRequest]
 * @param {() => void} [options.onOpen]
 * @param {() => void} [options.onClose]
 */
export function createArtifactController({ paneEl, onRefineRequest, onOpen, onClose } = {}) {
  if (!paneEl) {
    throw new Error('createArtifactController requires a valid paneEl');
  }

  // Map<title, { title: string, versions: Array<{ lang: string, code: string, createdAt: number }> }>
  const registry = new Map();
  let activeTitle = '';
  let activeVersionIdx = 0;
  let activeTab = 'preview'; // 'preview' | 'code'
  let draftCode = '';
  let dirty = false;
  let openState = false;
  let refineOpen = false;
  let copyTimer = null;

  paneEl.setAttribute('aria-hidden', 'true');
  paneEl.innerHTML = `
    <div class="artifact-shell" role="region" aria-label="پیش‌نمایش و ویرایشگر آرتیفکت">
      <header class="artifact-header">
        <div class="artifact-title-group">
          <span class="artifact-lang-badge" data-artifact-lang>HTML</span>
          <h2 class="artifact-title" data-artifact-title>آرتیفکت</h2>
        </div>
        <div class="artifact-header-actions">
          <div class="artifact-version-nav" role="group" aria-label="نسخه‌های آرتیفکت">
            <button type="button" class="artifact-icon-btn" data-artifact-ver-prev title="نسخه قبلی" aria-label="نسخه قبلی">‹</button>
            <span class="artifact-version-label" data-artifact-ver-label dir="ltr">v1 / 1</span>
            <button type="button" class="artifact-icon-btn" data-artifact-ver-next title="نسخه بعدی" aria-label="نسخه بعدی">›</button>
          </div>
          <button type="button" class="artifact-icon-btn artifact-close-btn" data-artifact-close title="بستن (Esc)" aria-label="بستن پنل آرتیفکت">✕</button>
        </div>
      </header>

      <div class="artifact-toolbar">
        <div class="artifact-tabs" role="tablist" aria-label="نمای آرتیفکت">
          <button type="button" class="artifact-tab active" role="tab" aria-selected="true" data-artifact-tab="preview">پیش‌نمایش</button>
          <button type="button" class="artifact-tab" role="tab" aria-selected="false" data-artifact-tab="code">کد / ویرایش</button>
        </div>
        <div class="artifact-actions">
          <button type="button" class="artifact-btn artifact-btn-save" data-artifact-save hidden title="ذخیره تغییرات به عنوان نسخه جدید">ذخیره نسخه جدید</button>
          <button type="button" class="artifact-btn" data-artifact-copy title="کپی کد">کپی</button>
          <button type="button" class="artifact-btn" data-artifact-download title="دانلود فایل">دانلود</button>
          <button type="button" class="artifact-btn artifact-btn-primary" data-artifact-refine title="بهبود این آرتیفکت با هوش مصنوعی">بهبود با AI</button>
        </div>
      </div>

      <form class="artifact-refine-bar" data-artifact-refine-bar hidden>
        <input
          type="text"
          class="artifact-refine-input"
          data-artifact-refine-input
          placeholder="تغییر مورد نظر را بنویسید (مثلا: دکمه‌ها را بزرگ‌تر کن یا تم تاریک اضافه کن)..."
          aria-label="دستور بهبود آرتیفکت با هوش مصنوعی"
        >
        <button type="submit" class="artifact-btn artifact-btn-primary" data-artifact-refine-submit>ارسال</button>
        <button type="button" class="artifact-btn" data-artifact-refine-cancel>لغو</button>
      </form>

      <div class="artifact-body">
        <div class="artifact-preview-pane" data-artifact-preview-pane></div>
        <div class="artifact-code-pane" data-artifact-code-pane hidden>
          <textarea
            class="artifact-editor"
            data-artifact-editor
            dir="ltr"
            spellcheck="false"
            aria-label="ویرایشگر کد آرتیفکت"
          ></textarea>
        </div>
      </div>
    </div>
  `;

  const elLang = paneEl.querySelector('[data-artifact-lang]');
  const elTitle = paneEl.querySelector('[data-artifact-title]');
  const elVerPrev = paneEl.querySelector('[data-artifact-ver-prev]');
  const elVerNext = paneEl.querySelector('[data-artifact-ver-next]');
  const elVerLabel = paneEl.querySelector('[data-artifact-ver-label]');
  const elClose = paneEl.querySelector('[data-artifact-close]');
  const elTabPreview = paneEl.querySelector('[data-artifact-tab="preview"]');
  const elTabCode = paneEl.querySelector('[data-artifact-tab="code"]');
  const elSaveBtn = paneEl.querySelector('[data-artifact-save]');
  const elCopyBtn = paneEl.querySelector('[data-artifact-copy]');
  const elDownloadBtn = paneEl.querySelector('[data-artifact-download]');
  const elRefineBtn = paneEl.querySelector('[data-artifact-refine]');
  const elRefineBar = paneEl.querySelector('[data-artifact-refine-bar]');
  const elRefineInput = paneEl.querySelector('[data-artifact-refine-input]');
  const elRefineCancel = paneEl.querySelector('[data-artifact-refine-cancel]');
  const elPreviewPane = paneEl.querySelector('[data-artifact-preview-pane]');
  const elCodePane = paneEl.querySelector('[data-artifact-code-pane]');
  const elEditor = paneEl.querySelector('[data-artifact-editor]');

  function getActiveEntry() {
    return registry.get(activeTitle) || null;
  }

  function getCurrentVersion() {
    const entry = getActiveEntry();
    if (!entry || !entry.versions.length) return null;
    const idx = Math.max(0, Math.min(activeVersionIdx, entry.versions.length - 1));
    return entry.versions[idx];
  }

  function getEffectiveCode() {
    const ver = getCurrentVersion();
    if (!ver) return '';
    return dirty ? draftCode : ver.code;
  }

  function renderPreview() {
    const ver = getCurrentVersion();
    if (!ver) {
      elPreviewPane.innerHTML = '';
      return;
    }

    const code = getEffectiveCode();
    const lang = normalizeLang(ver.lang);

    if (lang === 'html' || lang === 'htm') {
      const iframe = document.createElement('iframe');
      iframe.className = 'artifact-iframe';
      iframe.setAttribute('sandbox', 'allow-scripts');
      iframe.setAttribute('title', activeTitle || 'HTML Preview');
      iframe.srcdoc = code;
      elPreviewPane.innerHTML = '';
      elPreviewPane.appendChild(iframe);
      return;
    }

    if (lang === 'svg') {
      const iframe = document.createElement('iframe');
      iframe.className = 'artifact-iframe artifact-iframe-svg';
      iframe.setAttribute('sandbox', 'allow-scripts');
      iframe.setAttribute('title', activeTitle || 'SVG Preview');
      iframe.srcdoc = buildSvgSrcdoc(code);
      elPreviewPane.innerHTML = '';
      elPreviewPane.appendChild(iframe);
      return;
    }

    if (lang === 'md' || lang === 'markdown') {
      elPreviewPane.innerHTML = `<div class="artifact-md-preview msg-content">${renderMarkdown(code)}</div>`;
      return;
    }

    const fenced = '```' + lang + '\n' + code + '\n```';
    elPreviewPane.innerHTML = `<div class="artifact-code-preview">${renderMarkdown(fenced)}</div>`;
  }

  function syncUI() {
    const entry = getActiveEntry();
    const ver = getCurrentVersion();
    if (!entry || !ver) return;

    const total = entry.versions.length;
    const currentNum = activeVersionIdx + 1;

    elTitle.textContent = entry.title;
    elTitle.title = entry.title;
    elLang.textContent = normalizeLang(ver.lang).toUpperCase();
    elVerLabel.textContent = `v${currentNum} / ${total}`;
    elVerPrev.disabled = activeVersionIdx <= 0;
    elVerNext.disabled = activeVersionIdx >= total - 1;

    const isPreview = activeTab === 'preview';
    elTabPreview.classList.toggle('active', isPreview);
    elTabPreview.setAttribute('aria-selected', String(isPreview));
    elTabCode.classList.toggle('active', !isPreview);
    elTabCode.setAttribute('aria-selected', String(!isPreview));

    elPreviewPane.hidden = !isPreview;
    elCodePane.hidden = isPreview;

    elSaveBtn.hidden = !dirty;
    if (dirty) {
      elSaveBtn.textContent = `ذخیره v${total + 1}`;
    }

    if (elEditor.value !== getEffectiveCode()) {
      elEditor.value = getEffectiveCode();
    }

    if (isPreview) {
      renderPreview();
    }
  }

  function setTab(tab) {
    activeTab = tab === 'code' ? 'code' : 'preview';
    syncUI();
    if (activeTab === 'code') {
      elEditor.focus();
    }
  }

  function toggleRefineBar(show) {
    refineOpen = Boolean(show);
    elRefineBar.hidden = !refineOpen;
    elRefineBtn.classList.toggle('active', refineOpen);
    if (refineOpen) {
      elRefineInput.focus();
    }
  }

  function open({ title, lang = 'html', code = '' } = {}) {
    const normLang = normalizeLang(lang);
    const cleanTitle = String(title || '').trim() || `آرتیفکت ${normLang.toUpperCase()}`;
    const cleanCode = String(code ?? '');

    let entry = registry.get(cleanTitle);
    if (!entry) {
      entry = { title: cleanTitle, versions: [] };
      registry.set(cleanTitle, entry);
    }

    const last = entry.versions[entry.versions.length - 1];
    if (!last || last.code !== cleanCode || last.lang !== normLang) {
      entry.versions.push({
        lang: normLang,
        code: cleanCode,
        createdAt: Date.now(),
      });
    }

    activeTitle = cleanTitle;
    activeVersionIdx = entry.versions.length - 1;
    draftCode = cleanCode;
    dirty = false;
    activeTab = 'preview';
    toggleRefineBar(false);

    openState = true;
    paneEl.classList.add('open');
    paneEl.setAttribute('aria-hidden', 'false');
    paneEl.parentElement?.classList.add('artifact-open');
    document.body.classList.add('artifact-open');

    syncUI();
    if (typeof onOpen === 'function') onOpen();
  }

  function close() {
    if (!openState) return;
    openState = false;
    toggleRefineBar(false);
    paneEl.classList.remove('open');
    paneEl.setAttribute('aria-hidden', 'true');
    paneEl.parentElement?.classList.remove('artifact-open');
    document.body.classList.remove('artifact-open');
    if (typeof onClose === 'function') onClose();
  }

  function isOpen() {
    return openState;
  }

  function getState() {
    const entry = getActiveEntry();
    const ver = getCurrentVersion();
    return {
      open: openState,
      title: entry ? entry.title : '',
      lang: ver ? ver.lang : '',
      code: getEffectiveCode(),
      version: entry ? activeVersionIdx + 1 : 0,
      totalVersions: entry ? entry.versions.length : 0,
      activeTab,
      dirty,
    };
  }

  // Event bindings
  elClose.addEventListener('click', () => close());

  elTabPreview.addEventListener('click', () => setTab('preview'));
  elTabCode.addEventListener('click', () => setTab('code'));

  elVerPrev.addEventListener('click', () => {
    const entry = getActiveEntry();
    if (!entry || activeVersionIdx <= 0) return;
    activeVersionIdx -= 1;
    draftCode = entry.versions[activeVersionIdx].code;
    dirty = false;
    syncUI();
  });

  elVerNext.addEventListener('click', () => {
    const entry = getActiveEntry();
    if (!entry || activeVersionIdx >= entry.versions.length - 1) return;
    activeVersionIdx += 1;
    draftCode = entry.versions[activeVersionIdx].code;
    dirty = false;
    syncUI();
  });

  elEditor.addEventListener('input', () => {
    const ver = getCurrentVersion();
    draftCode = elEditor.value;
    dirty = Boolean(ver && draftCode !== ver.code);
    const entry = getActiveEntry();
    elSaveBtn.hidden = !dirty;
    if (dirty && entry) {
      elSaveBtn.textContent = `ذخیره v${entry.versions.length + 1}`;
    }
  });

  elSaveBtn.addEventListener('click', () => {
    const entry = getActiveEntry();
    const ver = getCurrentVersion();
    if (!entry || !ver || !dirty) return;
    entry.versions.push({
      lang: ver.lang,
      code: draftCode,
      createdAt: Date.now(),
    });
    activeVersionIdx = entry.versions.length - 1;
    dirty = false;
    syncUI();
  });

  elCopyBtn.addEventListener('click', () => {
    const code = getEffectiveCode();
    copyTextFallback(code)
      .then(() => {
        elCopyBtn.textContent = 'کپی شد ✓';
        clearTimeout(copyTimer);
        copyTimer = setTimeout(() => {
          elCopyBtn.textContent = 'کپی';
        }, 1500);
      })
      .catch(() => {
        elCopyBtn.textContent = 'خطا در کپی';
        clearTimeout(copyTimer);
        copyTimer = setTimeout(() => {
          elCopyBtn.textContent = 'کپی';
        }, 1500);
      });
  });

  elDownloadBtn.addEventListener('click', () => {
    const ver = getCurrentVersion();
    if (!ver) return;
    const code = getEffectiveCode();
    const filename = sanitizeFilename(activeTitle, ver.lang);
    const blob = new Blob([code], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  elRefineBtn.addEventListener('click', () => {
    toggleRefineBar(!refineOpen);
  });

  elRefineCancel.addEventListener('click', () => {
    elRefineInput.value = '';
    toggleRefineBar(false);
  });

  elRefineBar.addEventListener('submit', (e) => {
    e.preventDefault();
    const ver = getCurrentVersion();
    if (!ver) return;
    const instruction = elRefineInput.value.trim();
    elRefineInput.value = '';
    toggleRefineBar(false);
    if (typeof onRefineRequest === 'function') {
      onRefineRequest({
        title: activeTitle,
        lang: ver.lang,
        code: getEffectiveCode(),
        instruction,
      });
    }
  });

  function handleKeyDown(e) {
    if (!openState) return;
    if (e.key === 'Escape') {
      if (refineOpen) {
        e.stopPropagation();
        toggleRefineBar(false);
        elRefineBtn.focus();
      } else {
        close();
      }
    }
  }

  document.addEventListener('keydown', handleKeyDown);

  function destroy() {
    clearTimeout(copyTimer);
    document.removeEventListener('keydown', handleKeyDown);
  }

  return {
    open,
    close,
    isOpen,
    getState,
    destroy,
  };
}
