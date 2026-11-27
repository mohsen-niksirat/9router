/**
 * 9Router Web - Main Application Controller
 * Streaming chat + Inline Message Actions + Routing Telemetry + Smart Auto-Scroll
 * + Reasoning Timer + Composer Polish (Drag/Drop, Quick Model & Params Popovers).
 */

import { store } from './store.js';
import { renderMarkdown, escHtml } from './markdown.js';
import { runChatCompletion, runImageGeneration, fetchProviderModels } from './router.js';
import { renderProvidersHub } from './providers_ui.js';
import { renderComboGraph } from './combo_graph.js';
import { renderAgentTeam } from './agent_team.js';
import { renderArena } from './arena.js';
import { searchWeb, buildGroundedPrompt, extractFollowUps, renderSourceCardsHtml, linkifyCitations } from './web_search.js';
import { createArtifactController } from './artifacts.js';
import { createCommandPalette } from './command_palette.js';
import { exportSessionMarkdown, exportSessionHtml, encryptBackup, decryptBackup, isEncryptedBackup } from './export_utils.js';
import { renderAnalyticsView } from './analytics.js';
import { extractVariables, substituteVariables } from './prompt_utils.js';
import { fetchWebPage } from './web_fetch.js';

let currentTab = 'chat';
let attachedImages = [];
let attachedUrls = [];
let pendingPromptTemplate = null;
let imageMode = false;
let activeAbort = null;
let userScrolledUp = false;
let editingMsgIdx = null;
let artifactController = null;
let cmdPalette = null;
let activeFolderFilter = '';

function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._tid);
  el._tid = setTimeout(() => el.classList.remove('show'), 2500);
}

window.addEventListener('ninerouter:storage-error', (e) => {
  toast(e.detail?.message || 'حافظه مرورگر پر شده است');
});

window.__openHtmlPreview = (htmlCode) => {
  const frame = document.getElementById('preview-frame');
  if (frame) frame.srcdoc = htmlCode;
  document.getElementById('modal-preview')?.classList.add('open');
};

function toggleSidebar(open) {
  document.getElementById('sidebar')?.classList.toggle('open', open);
  document.getElementById('backdrop')?.classList.toggle('show', open);
}

function applyTheme() {
  document.documentElement.classList.toggle('light-mode', store.state.settings.theme === 'light');
}

function compactMaskKey(val) {
  const s = String(val || '');
  if (s.length < 10) return '••••';
  return `${s.slice(0, 6)}...${s.slice(-4)}`;
}

function getActiveTargetLabel() {
  const t = store.state.activeTarget;
  if (t?.type === 'provider') {
    const p = store.state.providers.find((x) => x.id === t.id);
    if (!p) return 'انتخاب نشده';
    const model = t.model || p.defaultModel || p.models?.[0] || '';
    const pinnedKey = t.keyId ? (p.keys || []).find((k) => k.id === t.keyId) : null;
    const keyTag = pinnedKey ? ' 🔑' : '';
    return model ? `${p.name} (${model})${keyTag}` : `${p.name}${keyTag}`;
  }
  const c = store.state.combos.find((x) => x.id === t?.id) || store.state.combos[0];
  return c ? `کمبو: ${c.name}` : 'انتخاب نشده';
}

const APISFREELLM_DAILY_LIMIT = 10_000_000;

function formatCompactTokens(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2).replace(/\.00$/, '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(Math.max(0, Math.round(n)));
}

function updateFreeQuotaPill() {
  const el = document.getElementById('free-quota-pill');
  if (!el) return;
  const t = store.state.activeTarget;
  const isFree = t && t.type === 'provider' && t.id === 'prov_apisfreellm';
  if (!isFree) {
    el.hidden = true;
    return;
  }
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const cutoff = startOfDay.getTime();
  const used = (store.state.usageEvents || []).reduce((sum, ev) => {
    if (ev && ev.providerId === 'prov_apisfreellm' && Number(ev.ts) >= cutoff) {
      return sum + (Number(ev.totalTokens) || 0);
    }
    return sum;
  }, 0);
  const remaining = Math.max(0, APISFREELLM_DAILY_LIMIT - used);
  el.textContent = `⚡ مانده امروز: ${formatCompactTokens(remaining)} / 10M`;
  el.classList.toggle('low', remaining < 1_000_000);
  el.hidden = false;
}

function updateTargetPill() {
  const label = getActiveTargetLabel();
  const topEl = document.getElementById('active-target-label');
  const quickEl = document.getElementById('quick-model-label');
  if (topEl) topEl.textContent = label;
  if (quickEl) quickEl.textContent = label;
  updateFreeQuotaPill();
}

function updateQuickParamsLabel() {
  const el = document.getElementById('quick-params-label');
  if (!el) return;
  const temp = Number(store.state.settings.temperature ?? 0.7).toFixed(1);
  const maxTok = Number(store.state.settings.maxTokens ?? 4096);
  el.textContent = `دما ${temp} · ${maxTok}`;
}

function updateWebSearchButton() {
  const btn = document.getElementById('btn-web-search');
  if (!btn) return;
  const ws = store.state.settings.webSearch || {};
  const active = Boolean(ws.enabled && ws.apiKey);
  btn.classList.toggle('active', active);
  btn.setAttribute('aria-pressed', String(active));
}

function closeAllPopovers() {
  document.querySelectorAll('.popover-panel.open').forEach((p) => p.classList.remove('open'));
  document.querySelectorAll('[aria-expanded="true"]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
}

function renderModelPopover(query = '') {
  const panel = document.getElementById('popover-model');
  if (!panel) return;

  let searchEl = panel.querySelector('#popover-model-search');
  let bodyEl = panel.querySelector('.popover-model-body');
  if (!searchEl || !bodyEl) {
    panel.innerHTML = `
      <div class="popover-search-wrap">
        <input type="search" id="popover-model-search" class="popover-search" placeholder="جستجوی مدل یا ارائه‌دهنده..." autocomplete="off">
      </div>
      <div class="popover-model-body"></div>
    `;
    searchEl = panel.querySelector('#popover-model-search');
    bodyEl = panel.querySelector('.popover-model-body');
    searchEl.addEventListener('input', () => {
      renderModelPopover(searchEl.value);
    });
    searchEl.addEventListener('click', (e) => e.stopPropagation());
  }
  if (query !== undefined && searchEl.value !== query) {
    searchEl.value = query;
  }

  const q = (searchEl.value || '').trim().toLowerCase();
  const t = store.state.activeTarget;

  // Active provider key selector row
  let keysBarHtml = '';
  if (t?.type === 'provider') {
    const activeProv = store.state.providers.find((x) => x.id === t.id);
    if (activeProv && activeProv.keys?.length) {
      const selectedKeyId = activeProv.keys.some((k) => k.id === t.keyId) ? t.keyId : '';
      const keyPills = [
        `<button class="popover-key-pill ${!selectedKeyId ? 'active' : ''}" type="button" data-pick-key="">خودکار</button>`,
        ...activeProv.keys.map((k) => {
          const isKeyAct = selectedKeyId === k.id;
          const dotCls = k.status === 'dead' ? 'dead' : k.status === 'cooldown' ? 'cooldown' : '';
          return `<button class="popover-key-pill ${isKeyAct ? 'active' : ''}" type="button" data-pick-key="${escHtml(k.id)}" title="${escHtml(k.label || '')}">
            <span class="dot-status ${dotCls}" aria-hidden="true"></span>
            <span class="ltr-code">${escHtml(compactMaskKey(k.value))}</span>
          </button>`;
        }),
      ].join('');
      keysBarHtml = `
        <div class="popover-keys-bar">
          <div class="popover-keys-label">کلید فعال (${escHtml(activeProv.name)})</div>
          <div class="popover-keys-pills">${keyPills}</div>
        </div>
      `;
    }
  }

  const filteredCombos = store.state.combos.filter((c) => {
    if (!q) return true;
    return c.name.toLowerCase().includes(q) || (c.policy || '').toLowerCase().includes(q);
  });

  const comboItems = filteredCombos
    .map((c) => {
      const isAct = t?.type === 'combo' && t.id === c.id;
      return `<button class="popover-opt ${isAct ? 'active' : ''}" type="button" data-pick-type="combo" data-pick-id="${escHtml(c.id)}">
        <span>🔀 ${escHtml(c.name)}</span>
        <small>${escHtml(c.policy || 'fallback')}</small>
      </button>`;
    })
    .join('');

  const provGroups = store.state.providers
    .map((p) => {
      const allModels = (p.models && p.models.length) ? p.models : (p.defaultModel ? [p.defaultModel] : []);
      const nameMatches = !q || p.name.toLowerCase().includes(q);
      const matchedModels = nameMatches
        ? allModels
        : allModels.filter((m) => m.toLowerCase().includes(q));
      if (q && !nameMatches && !matchedModels.length) return '';

      const activeKeyCount = (p.keys || []).filter((k) => k.status !== 'dead').length;
      const keyBadge = p.noKey ? 'محلی / بدون کلید' : activeKeyCount ? `${activeKeyCount} کلید` : 'بدون کلید';
      const activeModelForProv = t?.type === 'provider' && t.id === p.id
        ? (t.model || p.defaultModel || allModels[0] || '')
        : '';

      const modelRows = matchedModels.length
        ? matchedModels
            .map((m) => {
              const isAct = t?.type === 'provider' && t.id === p.id && activeModelForProv === m;
              return `<button class="popover-opt popover-model-opt ${isAct ? 'active' : ''}" type="button" data-pick-type="provider" data-pick-id="${escHtml(p.id)}" data-pick-model="${escHtml(m)}">
                <span class="ltr-code" title="${escHtml(m)}">${escHtml(m)}</span>
                ${m === p.defaultModel ? '<small>پیش‌فرض</small>' : ''}
              </button>`;
            })
            .join('')
        : `<button class="popover-opt ${t?.type === 'provider' && t.id === p.id ? 'active' : ''}" type="button" data-pick-type="provider" data-pick-id="${escHtml(p.id)}" data-pick-model="">
            <span class="muted">مدلی تعریف نشده</span>
          </button>`;

      return `
        <div class="popover-prov-group">
          <div class="popover-prov-head">
            <span class="popover-prov-name"><span class="node-dot" style="background:${escHtml(p.color || '#f5b942')}"></span>${escHtml(p.name)}</span>
            <small class="${(p.noKey || activeKeyCount) ? 'ok' : ''}">${keyBadge}</small>
          </div>
          ${modelRows}
        </div>
      `;
    })
    .filter(Boolean)
    .join('');

  bodyEl.innerHTML = `
    ${keysBarHtml}
    ${(!q || comboItems) ? `
      <div class="popover-group">
        <div class="popover-head">کمبوهای مسیریابی</div>
        ${comboItems || '<div class="muted" style="padding:4px 8px">کمبویی وجود ندارد</div>'}
      </div>
    ` : ''}
    <div class="popover-group">
      <div class="popover-head">ارائه‌دهنده‌ها و مدل‌ها</div>
      ${provGroups || '<div class="muted" style="padding:6px 8px">موردی یافت نشد</div>'}
    </div>
  `;

  bodyEl.querySelectorAll('[data-pick-key]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const cur = store.state.activeTarget;
      if (cur?.type !== 'provider') return;
      store.state.activeTarget = { ...cur, keyId: btn.dataset.pickKey || '' };
      store.save();
      updateTargetPill();
      renderModelPopover(searchEl.value);
      toast(btn.dataset.pickKey ? 'کلید اختصاصی انتخاب شد' : 'انتخاب کلید روی حالت خودکار قرار گرفت');
    });
  });

  bodyEl.querySelectorAll('[data-pick-type]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const type = btn.dataset.pickType;
      const id = btn.dataset.pickId;
      if (type === 'provider') {
        const model = btn.dataset.pickModel || '';
        const prevKeyId = t?.type === 'provider' && t.id === id ? (t.keyId || '') : '';
        store.state.activeTarget = { type: 'provider', id, model, keyId: prevKeyId };
      } else {
        store.state.activeTarget = { type: 'combo', id };
      }
      store.save();
      updateTargetPill();
      closeAllPopovers();
      toast(`هدف فعال: ${getActiveTargetLabel()}`);
    });
  });
}

function renderSessionsSidebar(filter = '') {
  const list = document.getElementById('sessions-list');
  const folderBar = document.getElementById('folder-bar');
  const activeId = store.state.activeSessionId;
  const q = filter.trim().toLowerCase();

  // Render folder filter pills when folders exist
  const folders = [...new Set(store.state.sessions.map((s) => (s.folder || '').trim()).filter(Boolean))];
  if (folderBar) {
    if (folders.length) {
      if (activeFolderFilter && !folders.includes(activeFolderFilter)) activeFolderFilter = '';
      folderBar.classList.add('show');
      folderBar.innerHTML = [
        `<button class="folder-pill ${activeFolderFilter === '' ? 'active' : ''}" type="button" data-folder-filter="">همه</button>`,
        ...folders.map((f) => `<button class="folder-pill ${activeFolderFilter === f ? 'active' : ''}" type="button" data-folder-filter="${escHtml(f)}">📁 ${escHtml(f)}</button>`),
      ].join('');
      folderBar.querySelectorAll('[data-folder-filter]').forEach((b) => {
        b.addEventListener('click', () => {
          activeFolderFilter = b.dataset.folderFilter || '';
          renderSessionsSidebar(document.getElementById('ses-search')?.value || '');
        });
      });
    } else {
      activeFolderFilter = '';
      folderBar.classList.remove('show');
      folderBar.innerHTML = '';
    }
  }

  let rows = [...store.state.sessions];
  if (activeFolderFilter) {
    rows = rows.filter((s) => (s.folder || '').trim() === activeFolderFilter);
  }
  if (q) {
    rows = rows.filter((s) => s.title.toLowerCase().includes(q) || (s.folder || '').toLowerCase().includes(q));
  }
  // Sort pinned sessions to the top
  rows.sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)));

  list.innerHTML = rows
    .map(
      (s) => `
      <div class="ses-row ${s.id === activeId ? 'active' : ''}" data-ses="${s.id}" tabindex="0" role="button">
        <span class="ses-title">${s.pinned ? '📌 ' : ''}${escHtml(s.title)}</span>
        ${s.folder ? `<span class="ses-folder-tag">${escHtml(s.folder)}</span>` : ''}
        <span class="ses-acts">
          <button class="ses-pin ${s.pinned ? 'pinned' : ''}" type="button" data-pin-ses="${s.id}" title="${s.pinned ? 'برداشتن پین' : 'پین کردن'}" aria-label="${s.pinned ? 'برداشتن پین گفتگو' : 'پین کردن گفتگو'}">📌</button>
          <button class="ses-folder-btn" type="button" data-folder-ses="${s.id}" title="تنظیم پوشه" aria-label="تنظیم پوشه گفتگو">📁</button>
          <button class="ses-del" type="button" data-del-ses="${s.id}" title="حذف گفتگو" aria-label="حذف گفتگو">×</button>
        </span>
      </div>`
    )
    .join('');

  list.querySelectorAll('[data-ses]').forEach((row) => {
    const openSes = (e) => {
      if (e.target.closest('[data-del-ses], [data-pin-ses], [data-folder-ses]')) return;
      editingMsgIdx = null;
      store.state.activeSessionId = row.dataset.ses;
      store.save();
      switchTab('chat');
      renderChatMessages();
    };
    row.addEventListener('click', openSes);
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openSes(e);
      }
    });
  });

  list.querySelectorAll('[data-pin-ses]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const s = store.togglePinSession(btn.dataset.pinSes);
      renderSessionsSidebar(document.getElementById('ses-search')?.value || '');
      if (s) toast(s.pinned ? 'گفتگو پین شد' : 'پین گفتگو برداشته شد');
    });
  });

  list.querySelectorAll('[data-folder-ses]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const cur = store.state.sessions.find((x) => x.id === btn.dataset.folderSes);
      const next = window.prompt('نام پوشه برای این گفتگو (برای حذف پوشه خالی بگذارید):', cur?.folder || '');
      if (next === null) return;
      store.setSessionFolder(btn.dataset.folderSes, next);
      renderSessionsSidebar(document.getElementById('ses-search')?.value || '');
      toast(next.trim() ? `به پوشه «${next.trim()}» منتقل شد` : 'از پوشه خارج شد');
    });
  });

  list.querySelectorAll('[data-del-ses]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      store.deleteSession(btn.dataset.delSes);
      renderSessionsSidebar(document.getElementById('ses-search')?.value || '');
      renderChatMessages();
    });
  });
}

function renderTelemetryBadge(m) {
  const meta = m.meta || {};
  const prov = meta.providerName || m.provider || '';
  const model = meta.modelId || m.model || '';
  const ttftMs = meta.ttftMs ?? m.ttftMs ?? null;
  const tokPerSec = meta.tokPerSec ?? m.tokPerSec ?? null;
  const tokens = meta.tokensOut ?? m.tokens ?? null;
  const totalMs = meta.totalMs ?? m.elapsedMs ?? null;

  if (!prov && !model && !ttftMs && !tokPerSec && !tokens && !totalMs) return '';

  const parts = [];
  if (prov || model) {
    const label = prov && model ? `${prov} / ${model}` : prov || model;
    parts.push(`<span class="telemetry-model">${escHtml(label)}</span>`);
  }
  if (typeof ttftMs === 'number' && ttftMs > 0) {
    const ttftText = ttftMs >= 1000 ? `${(ttftMs / 1000).toFixed(2)}s` : `${Math.round(ttftMs)}ms`;
    parts.push(`<span class="telemetry-metric">TTFT ${ttftText}</span>`);
  }
  if (typeof tokPerSec === 'number' && tokPerSec > 0) {
    parts.push(`<span class="telemetry-metric">${tokPerSec.toFixed(1)} tok/s</span>`);
  }
  if (typeof tokens === 'number' && tokens > 0) {
    parts.push(`<span class="telemetry-metric">${tokens} tok</span>`);
  }
  if (typeof totalMs === 'number' && totalMs > 0) {
    parts.push(`<span class="telemetry-metric">${(totalMs / 1000).toFixed(1)}s</span>`);
  }

  return `<div class="telemetry-badge">${parts.join('<span class="telemetry-sep" aria-hidden="true">·</span>')}</div>`;
}

function buildMessageHtml(m, idx) {
  if (m.role === 'user') {
    if (editingMsgIdx === idx) {
      return `
        <div class="msg user" data-msg-index="${idx}">
          <div class="msg-edit-box">
            <textarea id="edit-msg-textarea" aria-label="ویرایش پیام">${escHtml(m.content || '')}</textarea>
            <div class="msg-edit-actions">
              <button class="btn btn-sm btn-ghost" type="button" data-action="cancel-edit">لغو</button>
              <button class="btn btn-sm btn-amber" type="button" data-action="save-edit" data-msg-index="${idx}">ذخیره و ارسال مجدد</button>
            </div>
          </div>
        </div>`;
    }
    const imgs = (m.images || []).map((src) => `<img src="${src}" alt="تصویر پیوست‌شده">`).join('');
    const urlsHtml = (m.urls || [])
      .filter((u) => u && /^https?:\/\//i.test(String(u.url || '')))
      .map((u) => {
        let host = '';
        try { host = new URL(u.url).hostname; } catch { host = u.url; }
        const label = u.title || host || u.url;
        return `<a class="msg-url-chip" href="${escHtml(u.url)}" target="_blank" rel="noopener noreferrer" title="${escHtml(u.url)}">🔗 <span>${escHtml(label)}</span>${u.truncated ? '<span class="url-trunc-badge">خلاصه‌شده</span>' : ''}</a>`;
      })
      .join('');
    return `
      <div class="msg user" data-msg-index="${idx}">
        <div class="bubble">${escHtml(m.content).replace(/\n/g, '<br>')}${urlsHtml ? `<div class="msg-urls">${urlsHtml}</div>` : ''}${imgs ? `<div class="msg-imgs">${imgs}</div>` : ''}</div>
        <div class="msg-footer">
          <div class="msg-actions" role="toolbar" aria-label="عملیات پیام کاربر">
            <button class="msg-act-btn" type="button" data-action="edit" data-msg-index="${idx}" title="ویرایش و ارسال مجدد">✏️ ویرایش</button>
            <button class="msg-act-btn" type="button" data-action="fork" data-msg-index="${idx}" title="انشعاب گفتگوی جدید از این پیام">⑂ انشعاب</button>
            <button class="msg-act-btn" type="button" data-action="copy" data-msg-index="${idx}" title="کپی متن">📋 کپی</button>
            <button class="msg-act-btn danger" type="button" data-action="delete" data-msg-index="${idx}" title="حذف پیام">🗑 حذف</button>
          </div>
        </div>
      </div>`;
  }

  const thinkLabel = m.thinkingMs
    ? `تفکر برای ${(m.thinkingMs / 1000).toFixed(1)} ثانیه`
    : 'فرایند تفکر مدل';
  const thinkHtml = m.thinking
    ? `<details class="think-box"><summary><span class="think-dot" aria-hidden="true"></span><span>${thinkLabel}</span></summary><div class="think-body">${escHtml(m.thinking)}</div></details>`
    : '';
  const sourcesHtml = m.sources?.length ? renderSourceCardsHtml(m.sources) : '';
  const renderedBody = m.sources?.length
    ? linkifyCitations(renderMarkdown(m.content || ''), m.sources)
    : renderMarkdown(m.content || '');
  const imgHtml = m.imageUrl
    ? `<img class="gen-img" src="${m.imageUrl}" alt="تصویر تولیدشده"><a class="btn btn-sm btn-ghost" style="margin-top:8px" href="${m.imageUrl}" download="9router-image.png" target="_blank" rel="noopener noreferrer">⬇️ دانلود تصویر</a>`
    : '';
  const telemetryHtml = renderTelemetryBadge(m);
  const followUpsHtml = m.followUps?.length
    ? `<div class="followups-bar" role="region" aria-label="سوالات پیشنهادی بعدی">${m.followUps
        .map((q) => `<button class="followup-chip" type="button" data-followup="${escHtml(q)}">↳ ${escHtml(q)}</button>`)
        .join('')}</div>`
    : '';

  return `
    <div class="msg ai" data-msg-index="${idx}">
      <div class="ai-wrap">
        <div class="ai-av" aria-hidden="true">9R</div>
        <div class="bubble">${sourcesHtml}${thinkHtml}${renderedBody}${imgHtml}</div>
      </div>
      <div class="msg-footer">
        ${telemetryHtml}
        <div class="msg-actions" role="toolbar" aria-label="عملیات پاسخ دستیار">
          <button class="msg-act-btn" type="button" data-action="regen" data-msg-index="${idx}" title="تولید مجدد پاسخ">↻ بازتولید</button>
          <button class="msg-act-btn" type="button" data-action="fork" data-msg-index="${idx}" title="انشعاب گفتگوی جدید از این پیام">⑂ انشعاب</button>
          <button class="msg-act-btn" type="button" data-action="copy" data-msg-index="${idx}" title="کپی مارک‌داون خام">📋 کپی</button>
          <button class="msg-act-btn danger" type="button" data-action="delete" data-msg-index="${idx}" title="حذف پاسخ">🗑 حذف</button>
        </div>
      </div>
      ${followUpsHtml}
    </div>`;
}

function renderChatMessages(forceScroll = true) {
  const col = document.getElementById('chat-messages');
  const ses = store.getActiveSession();
  if (!ses.messages.length) {
    col.innerHTML = `
      <div class="chat-empty">
        <h1>چطور می‌تونم کمکت کنم؟</h1>
        <div class="sug-grid">
          <button class="sug-btn" type="button" data-sug="یک کد تمیز جاوااسکریپت برای مدیریت Rate Limit بنویس"><b>کدنویسی و معماری</b>ساخت الگوریتم و دیباگ کد</button>
          <button class="sug-btn" type="button" data-sug="این متن را به فارسی روان و حرفه‌ای ترجمه کن:"><b>ترجمه دقیق</b>فارسی و انگلیسی روان</button>
          <button class="sug-btn" type="button" data-sug="تفاوت Fallback و Round-Robin در مسیریابی هوش مصنوعی چیست؟"><b>توضیح مفاهیم</b>ساده، دقیق و کاربردی</button>
          <button class="sug-btn" type="button" data-sug-img="یک تصویر سینمایی از یک شهر آینده‌نگر در شب با نورهای نئون"><b>🎨 تولید تصویر</b>ساخت عکس مستقیم در چت</button>
        </div>
      </div>`;
    col.querySelectorAll('[data-sug]').forEach((b) => {
      b.addEventListener('click', () => {
        const inp = document.getElementById('msg-input');
        inp.value = b.dataset.sug;
        autoGrowInput();
        inp.focus();
      });
    });
    col.querySelectorAll('[data-sug-img]').forEach((b) => {
      b.addEventListener('click', () => {
        imageMode = true;
        const imgBtn = document.getElementById('btn-img-mode');
        imgBtn.classList.add('active');
        imgBtn.setAttribute('aria-pressed', 'true');
        const inp = document.getElementById('msg-input');
        inp.value = b.dataset.sugImg;
        autoGrowInput();
        inp.focus();
      });
    });
    updateJumpButton();
    return;
  }

  col.innerHTML = ses.messages.map((m, i) => buildMessageHtml(m, i)).join('');
  if (editingMsgIdx !== null) {
    const editTa = document.getElementById('edit-msg-textarea');
    if (editTa) {
      editTa.focus();
      editTa.setSelectionRange(editTa.value.length, editTa.value.length);
    }
  } else if (forceScroll) {
    scrollBottom(true);
  }
}

function updateJumpButton() {
  const s = document.getElementById('chat-scroll');
  const btn = document.getElementById('btn-jump-bottom');
  if (!s || !btn) return;
  const dist = s.scrollHeight - s.scrollTop - s.clientHeight;
  userScrolledUp = dist > 80;
  btn.classList.toggle('show', userScrolledUp);
}

function scrollBottom(force = false) {
  const s = document.getElementById('chat-scroll');
  if (!s) return;
  if (!force && userScrolledUp) return;
  if (force) userScrolledUp = false;
  s.scrollTo({ top: s.scrollHeight, behavior: force ? 'smooth' : 'auto' });
  const btn = document.getElementById('btn-jump-bottom');
  if (force && btn) btn.classList.remove('show');
}

function autoGrowInput() {
  const msgInput = document.getElementById('msg-input');
  if (!msgInput) return;
  msgInput.style.height = 'auto';
  msgInput.style.height = `${Math.min(msgInput.scrollHeight, 160)}px`;
}

function renderPreviews() {
  const bar = document.getElementById('composer-previews');
  if (!attachedImages.length && !attachedUrls.length) {
    bar.classList.remove('show');
    bar.innerHTML = '';
    return;
  }
  bar.classList.add('show');
  const imgChips = attachedImages
    .map((src, i) => `<div class="prev-chip"><img src="${src}" alt="پیش‌نمایش تصویر پیوست"><button type="button" data-rm-img="${i}" aria-label="حذف تصویر">×</button></div>`)
    .join('');
  const urlChips = attachedUrls
    .map((u, i) => {
      let host = '';
      try { host = new URL(u.url).hostname; } catch { host = u.url; }
      const label = u.title || host;
      return `<div class="url-chip" title="${escHtml(u.url)}">
        <span class="url-chip-icon" aria-hidden="true">🔗</span>
        <span class="url-chip-label">${escHtml(label)}</span>
        ${u.truncated ? '<span class="url-trunc-badge">خلاصه‌شده</span>' : ''}
        <button type="button" class="url-chip-rm" data-rm-url="${i}" aria-label="حذف لینک">×</button>
      </div>`;
    })
    .join('');
  bar.innerHTML = imgChips + urlChips;
  bar.querySelectorAll('[data-rm-img]').forEach((b) => {
    b.addEventListener('click', () => {
      attachedImages.splice(Number(b.dataset.rmImg), 1);
      renderPreviews();
    });
  });
  bar.querySelectorAll('[data-rm-url]').forEach((b) => {
    b.addEventListener('click', () => {
      attachedUrls.splice(Number(b.dataset.rmUrl), 1);
      renderPreviews();
    });
  });
}

function handleFiles(fileList) {
  Array.from(fileList || []).forEach((f) => {
    const r = new FileReader();
    if (f.type.startsWith('image/')) {
      r.onload = (ev) => {
        attachedImages.push(ev.target.result);
        renderPreviews();
      };
      r.readAsDataURL(f);
    } else {
      r.onload = (ev) => {
        const content = String(ev.target.result || '').slice(0, 40000);
        const inp = document.getElementById('msg-input');
        const ext = f.name.split('.').pop() || 'text';
        inp.value = `${inp.value ? inp.value + '\n\n' : ''}📄 فایل (${f.name}):\n\`\`\`${ext}\n${content}\n\`\`\``;
        autoGrowInput();
        toast(`فایل ${f.name} پیوست شد`);
      };
      r.readAsText(f);
    }
  });
}

async function streamAssistantResponse({ isImage = false, imagePrompt = '', sourceImage = null, urlContexts = [] } = {}) {
  const sendBtn = document.getElementById('send-btn');
  const ses = store.getActiveSession();

  activeAbort = new AbortController();
  sendBtn.classList.add('stop');
  sendBtn.textContent = '■';
  sendBtn.setAttribute('aria-label', 'توقف تولید');
  sendBtn.setAttribute('title', 'توقف');

  const col = document.getElementById('chat-messages');
  const liveDiv = document.createElement('div');
  liveDiv.className = 'msg ai';
  liveDiv.innerHTML = `<div class="ai-wrap"><div class="ai-av" aria-hidden="true">9R</div><div class="bubble">▌</div></div><div class="msg-footer"><div class="msg-meta"></div></div>`;
  col.appendChild(liveDiv);
  const bubbleEl = liveDiv.querySelector('.bubble');
  const metaEl = liveDiv.querySelector('.msg-meta');
  scrollBottom(true);

  let thinkStartMs = null;
  let thinkingMs = 0;
  let thinkTimerId = null;
  let latestThinking = '';
  let latestAcc = '';
  let liveMeta = null;
  let webSources = [];

  const stopThinkTimer = () => {
    if (thinkTimerId) {
      clearInterval(thinkTimerId);
      thinkTimerId = null;
    }
    if (thinkStartMs && !thinkingMs) {
      thinkingMs = Math.round(performance.now() - thinkStartMs);
    }
  };

  const renderLiveBubble = () => {
    const sourcesHtml = webSources.length ? renderSourceCardsHtml(webSources) : '';
    let thinkHtml = '';
    if (latestThinking) {
      const elapsedSec = thinkStartMs
        ? ((thinkingMs || (performance.now() - thinkStartMs)) / 1000).toFixed(1)
        : '0.0';
      const isActiveThink = !latestAcc && thinkTimerId !== null;
      const summaryText = isActiveThink
        ? `در حال تفکر... ${elapsedSec} ثانیه`
        : `تفکر برای ${elapsedSec} ثانیه`;
      thinkHtml = `<details class="think-box ${isActiveThink ? 'is-thinking' : ''}" open><summary><span class="think-dot" aria-hidden="true"></span><span>${summaryText}</span></summary><div class="think-body">${escHtml(latestThinking)}</div></details>`;
    }
    const bodyHtml = webSources.length
      ? linkifyCitations(renderMarkdown(latestAcc || ''), webSources)
      : renderMarkdown(latestAcc || '');
    bubbleEl.innerHTML = `${sourcesHtml}${thinkHtml}${bodyHtml} ▌`;
    scrollBottom(false);
  };

  try {
    if (isImage) {
      bubbleEl.innerHTML = `<em style="color:var(--text-3)">🎨 در حال ${sourceImage ? 'ویرایش' : 'تولید'} تصویر...</em>`;
      const imgRes = await runImageGeneration({
        prompt: imagePrompt,
        sourceImageDataUrl: sourceImage,
        signal: activeAbort.signal,
      });
      const aiMsg = {
        role: 'assistant',
        content: imgRes.revisedPrompt || 'تصویر شما آماده شد:',
        imageUrl: imgRes.imageUrl,
        provider: imgRes.provider,
        model: imgRes.model,
        elapsedMs: imgRes.elapsedMs,
        meta: {
          providerName: imgRes.provider,
          modelId: imgRes.model,
          totalMs: imgRes.elapsedMs,
        },
      };
      ses.messages.push(aiMsg);
      ses.updatedAt = Date.now();
      store.save();
      renderChatMessages(true);
    } else {
      const apiMessages = [
        { role: 'system', content: store.state.settings.systemPrompt },
        ...ses.messages.slice(-20).map((m) => {
          if (m.role === 'user' && m.images?.length) {
            return {
              role: 'user',
              content: [
                { type: 'text', text: m.content || 'این تصویر را تحلیل کن.' },
                ...m.images.map((url) => ({ type: 'image_url', image_url: { url } })),
              ],
            };
          }
          return { role: m.role, content: m.content || '' };
        }),
      ];

      // Attach fetched web page contexts as delimited blocks on the current user turn
      if (urlContexts.length) {
        const ctxBlock = urlContexts
          .map((u) => `--- محتوای صفحه وب (${u.title || u.url}) ---\nURL: ${u.url}\n${u.text}\n--- پایان محتوای صفحه وب ---`)
          .join('\n\n');
        const lastApiMsg = apiMessages[apiMessages.length - 1];
        if (lastApiMsg && lastApiMsg.role === 'user') {
          if (typeof lastApiMsg.content === 'string') {
            lastApiMsg.content = lastApiMsg.content ? `${lastApiMsg.content}\n\n${ctxBlock}` : ctxBlock;
          } else if (Array.isArray(lastApiMsg.content)) {
            const textPart = lastApiMsg.content.find((p) => p.type === 'text');
            if (textPart) textPart.text = `${textPart.text}\n\n${ctxBlock}`;
            else lastApiMsg.content.unshift({ type: 'text', text: ctxBlock });
          }
        }
      }

      // Perplexity-style BYOK Web Search when enabled
      const ws = store.state.settings.webSearch || {};
      const lastMsg = ses.messages[ses.messages.length - 1];
      if (ws.enabled && ws.apiKey && lastMsg?.role === 'user' && lastMsg.content) {
        bubbleEl.innerHTML = `<details class="think-box is-thinking" open><summary><span class="think-dot" aria-hidden="true"></span><span>در حال جستجو در وب (${escHtml(ws.provider || 'tavily')})...</span></summary></details>`;
        try {
          const searchRes = await searchWeb({
            query: lastMsg.content,
            provider: ws.provider || 'tavily',
            apiKey: ws.apiKey,
            corsProxy: store.state.settings.corsProxy || '',
            maxResults: 5,
            signal: activeAbort.signal,
          });
          webSources = searchRes.sources || [];
          if (webSources.length) {
            const grounded = buildGroundedPrompt(lastMsg.content, webSources);
            const lastApiMsg = apiMessages[apiMessages.length - 1];
            if (typeof lastApiMsg.content === 'string') {
              lastApiMsg.content = grounded;
            }
            renderLiveBubble();
          }
        } catch (searchErr) {
          if (searchErr.name === 'AbortError') throw searchErr;
          toast(`خطای جستجوی وب: ${searchErr.message}`);
        }
      }

      const res = await runChatCompletion({
        messages: apiMessages,
        signal: activeAbort.signal,
        onMeta: (meta) => {
          liveMeta = meta;
          metaEl.innerHTML = renderTelemetryBadge({ meta });
        },
        onStream: ({ type, text: acc, thinking }) => {
          latestThinking = thinking || latestThinking;
          latestAcc = acc || latestAcc;
          if (type === 'thinking' && !thinkStartMs) {
            thinkStartMs = performance.now();
            thinkTimerId = setInterval(() => {
              if (!latestAcc) renderLiveBubble();
            }, 100);
          }
          if (type === 'delta' && thinkStartMs && !thinkingMs) {
            stopThinkTimer();
          }
          renderLiveBubble();
        },
      });

      stopThinkTimer();
      const { cleanText, followUps } = webSources.length
        ? extractFollowUps(res.text || '')
        : { cleanText: res.text || '', followUps: [] };

      const finalMeta = res.meta || liveMeta || {
        providerName: res.providerName || res.provider || '',
        modelId: res.modelId || res.model || '',
        ttftMs: res.ttftMs ?? null,
        totalMs: res.totalMs ?? res.elapsedMs ?? null,
        tokensOut: res.tokensOut ?? res.tokens ?? null,
        tokPerSec: res.tokPerSec ?? null,
      };

      const aiMsg = {
        role: 'assistant',
        content: cleanText,
        thinking: res.thinking,
        thinkingMs: thinkingMs || 0,
        sources: webSources,
        followUps,
        provider: res.providerName || res.provider,
        model: res.modelId || res.model,
        tokens: res.tokensOut ?? res.tokens,
        elapsedMs: res.totalMs ?? res.elapsedMs,
        meta: finalMeta,
      };
      ses.messages.push(aiMsg);
      ses.updatedAt = Date.now();
      store.save();
      renderChatMessages(true);
    }
  } catch (err) {
    stopThinkTimer();
    if (err.name === 'AbortError') {
      metaEl.textContent = 'توقف توسط کاربر';
    } else {
      bubbleEl.innerHTML = `<span style="color:var(--danger)">❌ ${escHtml(err.message)}</span>`;
    }
  } finally {
    stopThinkTimer();
    activeAbort = null;
    sendBtn.classList.remove('stop');
    sendBtn.textContent = '↑';
    sendBtn.setAttribute('aria-label', 'ارسال پیام');
    sendBtn.setAttribute('title', 'ارسال');
  }
}

async function handleSend() {
  if (activeAbort) {
    activeAbort.abort();
    activeAbort = null;
    const sendBtn = document.getElementById('send-btn');
    sendBtn.classList.remove('stop');
    sendBtn.textContent = '↑';
    sendBtn.setAttribute('aria-label', 'ارسال پیام');
    return;
  }

  const inp = document.getElementById('msg-input');
  const text = inp.value.trim();
  if (!text && !attachedImages.length && !attachedUrls.length) return;

  const ses = store.getActiveSession();
  if (!ses.messages.length && (text || attachedUrls.length)) {
    ses.title = (text || attachedUrls[0]?.title || attachedUrls[0]?.url || 'گفتگوی جدید').slice(0, 36);
  }

  const imgsForRequest = [...attachedImages];
  const urlsForRequest = [...attachedUrls];
  const userMsg = {
    role: 'user',
    content: text,
    images: imgsForRequest,
    urls: urlsForRequest.map(({ title, url, truncated }) => ({ title, url, truncated })),
  };
  ses.messages.push(userMsg);
  ses.updatedAt = Date.now();
  store.save();

  inp.value = '';
  inp.style.height = '';
  attachedImages = [];
  attachedUrls = [];
  editingMsgIdx = null;
  renderPreviews();
  renderSessionsSidebar();
  renderChatMessages(true);

  await streamAssistantResponse({
    isImage: imageMode,
    imagePrompt: text,
    sourceImage: imgsForRequest[0] || null,
    urlContexts: urlsForRequest,
  });
}

function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.nav-item[data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${tab}`));
  toggleSidebar(false);
  closeAllPopovers();
  if (tab === 'providers') {
    renderProvidersHub(document.getElementById('providers-mount'), {
      onToast: toast,
      onSelectForChat: (target) => {
        store.state.activeTarget = target;
        store.save();
        updateTargetPill();
        switchTab('chat');
        toast('ارائه‌دهنده برای چت انتخاب شد');
      },
    });
  } else if (tab === 'combos') {
    renderComboGraph(document.getElementById('combos-mount'), {
      onToast: toast,
      onActivateCombo: (comboId) => {
        store.state.activeTarget = { type: 'combo', id: comboId };
        store.save();
        updateTargetPill();
        toast('کمبو در چت فعال شد');
      },
    });
  } else if (tab === 'team') {
    renderAgentTeam(document.getElementById('team-mount'), { onToast: toast });
  } else if (tab === 'arena') {
    renderArena(document.getElementById('arena-mount'), { onToast: toast });
  } else if (tab === 'analytics') {
    renderAnalyticsView(document.getElementById('analytics-mount'), store);
  }
}

// ─── Provider Modal Online Model Picker ───────────────────────────────────────
let fetchedProvModels = [];

function parseProvModelsInput() {
  const raw = document.getElementById('m-prov-models')?.value || '';
  return raw.split(/[\r\n,،]+/).map((s) => s.trim()).filter(Boolean);
}

function writeProvModelsInput(models) {
  const ta = document.getElementById('m-prov-models');
  if (ta) ta.value = models.join('\n');
}

function setProvFetchStatus(text = '', isError = false) {
  const el = document.getElementById('m-prov-fetch-status');
  if (!el) return;
  if (!text) {
    el.hidden = true;
    el.textContent = '';
    el.classList.remove('error');
    return;
  }
  el.hidden = false;
  el.textContent = text;
  el.classList.toggle('error', isError);
}

function resetProviderModelPicker() {
  fetchedProvModels = [];
  const picker = document.getElementById('m-prov-picker');
  const search = document.getElementById('m-prov-picker-search');
  const list = document.getElementById('m-prov-picker-list');
  const count = document.getElementById('m-prov-picker-count');
  if (picker) picker.hidden = true;
  if (search) search.value = '';
  if (list) list.innerHTML = '';
  if (count) count.textContent = '';
  setProvFetchStatus('');
}

function renderProviderModelPicker() {
  const picker = document.getElementById('m-prov-picker');
  const search = document.getElementById('m-prov-picker-search');
  const list = document.getElementById('m-prov-picker-list');
  const count = document.getElementById('m-prov-picker-count');
  if (!picker || !list) return;

  if (!fetchedProvModels.length) {
    picker.hidden = true;
    return;
  }
  picker.hidden = false;
  if (search) search.placeholder = `جستجو در بین ${fetchedProvModels.length} مدل...`;

  const selectedSet = new Set(parseProvModelsInput());
  const q = (search?.value || '').trim().toLowerCase();
  const filtered = q
    ? fetchedProvModels.filter((m) => m.toLowerCase().includes(q))
    : fetchedProvModels;

  const selectedInFetched = fetchedProvModels.filter((m) => selectedSet.has(m)).length;
  if (count) count.textContent = `${selectedInFetched} انتخاب‌شده`;

  if (!filtered.length) {
    list.innerHTML = '<div class="model-picker-empty">مدلی با این عبارت پیدا نشد.</div>';
    return;
  }

  list.innerHTML = filtered
    .map((m) => {
      const checked = selectedSet.has(m);
      return `<label class="model-picker-item ${checked ? 'selected' : ''}" role="option" aria-selected="${checked}">
        <input type="checkbox" data-pick-model="${escHtml(m)}" ${checked ? 'checked' : ''}>
        <span title="${escHtml(m)}">${escHtml(m)}</span>
      </label>`;
    })
    .join('');

  list.querySelectorAll('input[data-pick-model]').forEach((cb) => {
    cb.addEventListener('change', () => {
      const modelId = cb.dataset.pickModel;
      const cur = parseProvModelsInput();
      const idx = cur.indexOf(modelId);
      if (cb.checked && idx === -1) {
        cur.push(modelId);
      } else if (!cb.checked && idx !== -1) {
        cur.splice(idx, 1);
      }
      writeProvModelsInput(cur);
      cb.closest('.model-picker-item')?.classList.toggle('selected', cb.checked);
      cb.closest('.model-picker-item')?.setAttribute('aria-selected', String(cb.checked));
      const nowSet = new Set(cur);
      const selCount = fetchedProvModels.filter((m) => nowSet.has(m)).length;
      if (count) count.textContent = `${selCount} انتخاب‌شده`;
    });
  });
}

// ─── Modals ───────────────────────────────────────────────────────────────────
window.__openAddProviderModal = () => {
  document.getElementById('m-prov-id').value = '';
  document.getElementById('m-prov-title').textContent = 'افزودن ارائه‌دهنده';
  document.getElementById('m-prov-name').value = '';
  document.getElementById('m-prov-url').value = '';
  const apiKeyEl = document.getElementById('m-prov-apikey');
  if (apiKeyEl) apiKeyEl.value = '';
  document.getElementById('m-prov-default-model').value = '';
  document.getElementById('m-prov-models').value = '';
  document.getElementById('m-prov-img').checked = false;
  const noKeyEl = document.getElementById('m-prov-nokey');
  if (noKeyEl) noKeyEl.checked = false;
  resetProviderModelPicker();
  document.getElementById('modal-prov').classList.add('open');
};

window.__openEditProviderModal = (providerId) => {
  const p = store.state.providers.find((x) => x.id === providerId);
  if (!p) return;
  document.getElementById('m-prov-id').value = p.id;
  document.getElementById('m-prov-title').textContent = 'ویرایش ارائه‌دهنده';
  document.getElementById('m-prov-name').value = p.name || '';
  document.getElementById('m-prov-url').value = p.baseUrl || '';
  const apiKeyEl = document.getElementById('m-prov-apikey');
  if (apiKeyEl) apiKeyEl.value = '';
  document.getElementById('m-prov-default-model').value = p.defaultModel || '';
  document.getElementById('m-prov-models').value = (p.models || []).join('\n');
  document.getElementById('m-prov-img').checked = Boolean(p.supportsImages);
  const noKeyEl = document.getElementById('m-prov-nokey');
  if (noKeyEl) noKeyEl.checked = Boolean(p.noKey);
  resetProviderModelPicker();
  document.getElementById('modal-prov').classList.add('open');
};

window.__openAddKeyModal = (providerId) => {
  document.getElementById('m-key-prov-id').value = providerId;
  document.getElementById('m-key-label').value = '';
  document.getElementById('m-key-val').value = '';
  document.getElementById('modal-key').classList.add('open');
};

// ─── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  applyTheme();
  updateTargetPill();
  updateQuickParamsLabel();
  updateWebSearchButton();
  renderSessionsSidebar();
  renderChatMessages(true);

  const artifactPaneEl = document.getElementById('artifact-pane');
  if (artifactPaneEl) {
    artifactController = createArtifactController({
      paneEl: artifactPaneEl,
      onRefineRequest: async ({ title, lang, code, instruction }) => {
        if (activeAbort) return toast('ابتدا تولید پاسخ فعلی را متوقف کنید');
        const inp = document.getElementById('msg-input');
        inp.value = `لطفاً آرتیفکت «${title || 'کد'}» (${lang || 'html'}) را بر اساس این دستور بهبود بده:\n${instruction}\n\n\`\`\`${lang || 'html'}\n${code}\n\`\`\``;
        await handleSend();
      },
    });
  }

  document.getElementById('btn-web-search')?.addEventListener('click', () => {
    const ws = store.state.settings.webSearch || (store.state.settings.webSearch = { enabled: false, provider: 'tavily', apiKey: '' });
    if (!ws.apiKey) {
      toast('برای جستجوی وب ابتدا کلید API را در تنظیمات وارد کنید');
      document.getElementById('btn-settings')?.click();
      setTimeout(() => document.getElementById('s-ws-key')?.focus(), 50);
      return;
    }
    ws.enabled = !ws.enabled;
    store.save();
    updateWebSearchButton();
    toast(ws.enabled ? `🌐 جستجوی وب (${ws.provider}) فعال شد` : 'جستجوی وب غیرفعال شد');
  });

  // Command Palette (Ctrl+K) & Keyboard Shortcuts (Ctrl+/)
  cmdPalette = createCommandPalette({
    getItems: () => {
      const items = [
        { id: 'act-new-chat', group: 'عملیات سریع', title: 'چت جدید', shortcut: 'Ctrl+Shift+O', action: () => document.getElementById('btn-new-chat')?.click() },
        { id: 'act-theme', group: 'عملیات سریع', title: 'تغییر تم (تاریک / روشن)', action: () => document.getElementById('btn-theme')?.click() },
        { id: 'act-web-search', group: 'عملیات سریع', title: 'تغییر وضعیت جستجوی وب', action: () => document.getElementById('btn-web-search')?.click() },
        { id: 'act-export-md', group: 'خروجی گفتگو', title: 'خروجی Markdown (.md)', action: () => { exportSessionMarkdown(store.getActiveSession()); toast('فایل Markdown دانلود شد'); } },
        { id: 'act-export-html', group: 'خروجی گفتگو', title: 'خروجی HTML قابل چاپ / PDF', action: () => { exportSessionHtml(store.getActiveSession()); toast('فایل HTML قابل چاپ دانلود شد'); } },
        { id: 'act-settings', group: 'عملیات سریع', title: 'تنظیمات مدل، کلید جستجو و شبکه', action: () => document.getElementById('btn-settings')?.click() },
        { id: 'act-shortcuts', group: 'عملیات سریع', title: 'راهنمای میانبرهای صفحه‌کلید', shortcut: 'Ctrl+/', action: () => cmdPalette?.openShortcutsModal() },
        { id: 'tab-chat', group: 'بخش‌ها', title: 'گفتگو', action: () => switchTab('chat') },
        { id: 'tab-providers', group: 'بخش‌ها', title: 'ارائه‌دهنده‌ها و کلیدها', action: () => switchTab('providers') },
        { id: 'tab-combos', group: 'بخش‌ها', title: 'کمبو گرافیکی (نودها)', action: () => switchTab('combos') },
        { id: 'tab-team', group: 'بخش‌ها', title: 'تیم ایجنت‌ها (Swarm)', action: () => switchTab('team') },
        { id: 'tab-arena', group: 'بخش‌ها', title: 'مقایسه مدل‌ها (Arena)', action: () => switchTab('arena') },
        { id: 'tab-analytics', group: 'بخش‌ها', title: 'آمار و هزینه', action: () => switchTab('analytics') },
        { id: 'act-prompt-lib', group: 'عملیات سریع', title: 'کتابخانه پرامپت‌ها', action: () => document.getElementById('btn-prompt-lib')?.click() },
      ];
      for (const c of store.state.combos) {
        items.push({
          id: `combo-${c.id}`,
          group: 'کمبوها و مدل‌ها',
          title: `کمبو: ${c.name}`,
          subtitle: c.policy || 'fallback',
          action: () => {
            store.state.activeTarget = { type: 'combo', id: c.id };
            store.save();
            updateTargetPill();
            toast(`کمبو فعال شد: ${c.name}`);
          },
        });
      }
      for (const p of store.state.providers) {
        items.push({
          id: `prov-${p.id}`,
          group: 'کمبوها و مدل‌ها',
          title: p.name,
          subtitle: p.defaultModel || '',
          action: () => {
            store.state.activeTarget = { type: 'provider', id: p.id };
            store.save();
            updateTargetPill();
            toast(`ارائه‌دهنده فعال شد: ${p.name}`);
          },
        });
      }
      for (const s of store.state.sessions) {
        items.push({
          id: `ses-${s.id}`,
          group: 'تاریخچه گفتگوها',
          title: `${s.pinned ? '📌 ' : ''}${s.title}`,
          subtitle: s.folder || `${s.messages.length} پیام`,
          action: () => {
            editingMsgIdx = null;
            store.state.activeSessionId = s.id;
            store.save();
            switchTab('chat');
            renderSessionsSidebar(document.getElementById('ses-search')?.value || '');
            renderChatMessages(true);
          },
        });
      }
      return items;
    },
  });

  document.getElementById('btn-cmd-palette')?.addEventListener('click', () => cmdPalette?.open());
  document.getElementById('btn-export-md')?.addEventListener('click', () => {
    exportSessionMarkdown(store.getActiveSession());
    toast('فایل Markdown دانلود شد');
  });
  document.getElementById('btn-export-html')?.addEventListener('click', () => {
    exportSessionHtml(store.getActiveSession());
    toast('فایل HTML قابل چاپ دانلود شد');
  });

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'KeyO') {
      e.preventDefault();
      document.getElementById('btn-new-chat')?.click();
    }
  });

  document.querySelectorAll('.nav-item[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  document.getElementById('topbar-target-pill')?.addEventListener('click', () => switchTab('combos'));
  document.getElementById('btn-add-api-key')?.addEventListener('click', () => switchTab('providers'));

  // Delegated handler for markdown code block actions (copy & wrap toggle)
  document.addEventListener('click', (e) => {
    const copyBtn = e.target.closest?.('[data-code-copy]');
    if (copyBtn) {
      const code = copyBtn.closest('.code-wrap')?.querySelector('code')?.textContent || '';
      navigator.clipboard?.writeText(code).then(() => {
        copyBtn.textContent = 'کپی شد ✓';
        setTimeout(() => {
          copyBtn.textContent = 'کپی';
        }, 1500);
      });
      return;
    }

    const wrapBtn = e.target.closest?.('[data-code-wrap-toggle]');
    if (wrapBtn) {
      const wrap = wrapBtn.closest('.code-wrap');
      if (!wrap) return;
      const isWrapped = wrap.classList.toggle('code-wrapped');
      wrapBtn.classList.toggle('active', isWrapped);
      wrapBtn.setAttribute('aria-pressed', String(isWrapped));
    }
  });

  document.getElementById('btn-menu').addEventListener('click', () => toggleSidebar(true));
  document.getElementById('backdrop').addEventListener('click', () => toggleSidebar(false));
  document.getElementById('btn-new-chat').addEventListener('click', () => {
    editingMsgIdx = null;
    store.createSession();
    renderSessionsSidebar();
    switchTab('chat');
    renderChatMessages(true);
  });
  document.getElementById('btn-theme').addEventListener('click', () => {
    store.state.settings.theme = store.state.settings.theme === 'dark' ? 'light' : 'dark';
    store.save();
    applyTheme();
  });

  // Smart Auto-Scroll & Jump-to-Bottom
  const chatScroll = document.getElementById('chat-scroll');
  chatScroll?.addEventListener('scroll', updateJumpButton, { passive: true });
  document.getElementById('btn-jump-bottom')?.addEventListener('click', () => scrollBottom(true));

  // Delegated Message Actions, Follow-ups & Artifact Preview Hooks
  const chatMessages = document.getElementById('chat-messages');
  chatMessages?.addEventListener('click', async (e) => {
    // Follow-up suggestion chip
    const followBtn = e.target.closest('[data-followup]');
    if (followBtn) {
      if (activeAbort) return toast('ابتدا تولید پاسخ فعلی را متوقف کنید');
      const inp = document.getElementById('msg-input');
      inp.value = followBtn.dataset.followup || '';
      autoGrowInput();
      await handleSend();
      return;
    }

    // Artifact preview hook from markdown.js
    const previewBtn = e.target.closest('[data-artifact-preview]');
    if (previewBtn) {
      const wrap = previewBtn.closest('.code-wrap');
      const code = wrap?.querySelector('code')?.textContent || '';
      const lang = (previewBtn.dataset.artifactPreview || wrap?.dataset.lang || 'html').toLowerCase();
      if (artifactController) {
        artifactController.open({
          title: `پیش‌نمایش ${lang.toUpperCase()}`,
          lang,
          code,
        });
      } else {
        window.__openHtmlPreview(code);
      }
      return;
    }

    const actBtn = e.target.closest('[data-action]');
    if (!actBtn) return;
    const action = actBtn.dataset.action;
    const idx = Number(actBtn.dataset.msgIndex);
    const ses = store.getActiveSession();

    if (action === 'copy') {
      const msg = ses.messages[idx];
      if (!msg) return;
      navigator.clipboard.writeText(msg.content || '').then(() => {
        toast(msg.role === 'assistant' ? 'مارک‌داون کپی شد' : 'متن کپی شد');
      });
    } else if (action === 'delete') {
      if (activeAbort) return toast('ابتدا تولید پاسخ را متوقف کنید');
      ses.messages.splice(idx, 1);
      editingMsgIdx = null;
      store.save();
      renderChatMessages(false);
      toast('پیام حذف شد');
    } else if (action === 'edit') {
      if (activeAbort) return toast('ابتدا تولید پاسخ را متوقف کنید');
      editingMsgIdx = idx;
      renderChatMessages(false);
    } else if (action === 'cancel-edit') {
      editingMsgIdx = null;
      renderChatMessages(false);
    } else if (action === 'save-edit') {
      const ta = document.getElementById('edit-msg-textarea');
      const newText = ta?.value.trim() || '';
      if (!newText) return toast('متن پیام نمی‌تواند خالی باشد');
      ses.messages[idx].content = newText;
      ses.messages = ses.messages.slice(0, idx + 1);
      if (idx === 0) ses.title = newText.slice(0, 36);
      editingMsgIdx = null;
      ses.updatedAt = Date.now();
      store.save();
      renderSessionsSidebar();
      renderChatMessages(true);
      await streamAssistantResponse({ isImage: false });
    } else if (action === 'fork') {
      if (activeAbort) return toast('ابتدا تولید پاسخ را متوقف کنید');
      const forked = store.forkSession(ses.id, idx);
      if (forked) {
        editingMsgIdx = null;
        renderSessionsSidebar(document.getElementById('ses-search')?.value || '');
        renderChatMessages(true);
        toast('گفتگوی جدید از این پیام منشعب شد');
      }
    } else if (action === 'regen') {
      if (activeAbort) return toast('ابتدا تولید پاسخ را متوقف کنید');
      ses.messages = ses.messages.slice(0, idx);
      ses.updatedAt = Date.now();
      store.save();
      renderChatMessages(true);
      await streamAssistantResponse({ isImage: false });
    }
  });

  // Quick Model / Combo Switcher Popover
  const btnQuickModel = document.getElementById('btn-quick-model');
  const popModel = document.getElementById('popover-model');
  btnQuickModel?.addEventListener('click', (e) => {
    e.stopPropagation();
    const willOpen = !popModel.classList.contains('open');
    closeAllPopovers();
    if (willOpen) {
      renderModelPopover();
      popModel.classList.add('open');
      btnQuickModel.setAttribute('aria-expanded', 'true');
    }
  });

  // Quick Parameters Popover
  const btnQuickParams = document.getElementById('btn-quick-params');
  const popParams = document.getElementById('popover-params');
  const qpTemp = document.getElementById('qp-temp');
  const qpTempVal = document.getElementById('qp-temp-val');
  const qpMaxTokens = document.getElementById('qp-max-tokens');

  btnQuickParams?.addEventListener('click', (e) => {
    e.stopPropagation();
    const willOpen = !popParams.classList.contains('open');
    closeAllPopovers();
    if (willOpen) {
      const temp = Number(store.state.settings.temperature ?? 0.7);
      const maxTok = Number(store.state.settings.maxTokens ?? 4096);
      qpTemp.value = String(temp);
      qpTempVal.textContent = temp.toFixed(1);
      qpMaxTokens.value = String(maxTok);
      popParams.classList.add('open');
      btnQuickParams.setAttribute('aria-expanded', 'true');
    }
  });

  qpTemp?.addEventListener('input', () => {
    const val = parseFloat(qpTemp.value);
    qpTempVal.textContent = val.toFixed(1);
    store.state.settings.temperature = val;
    store.save();
    updateQuickParamsLabel();
  });

  qpMaxTokens?.addEventListener('change', () => {
    const val = Math.max(128, Math.min(65536, parseInt(qpMaxTokens.value, 10) || 4096));
    qpMaxTokens.value = String(val);
    store.state.settings.maxTokens = val;
    store.save();
    updateQuickParamsLabel();
  });

  // Close popovers on outside click & modals/popovers on Escape
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.popover-anchor')) closeAllPopovers();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeAllPopovers();
      document.querySelectorAll('.modal-bg.open').forEach((m) => m.classList.remove('open'));
      toggleSidebar(false);
      if (artifactController?.isOpen()) artifactController.close();
      if (editingMsgIdx !== null) {
        editingMsgIdx = null;
        renderChatMessages(false);
      }
    }
  });

  // Drag & Drop File Overlay on Chat View
  const viewChat = document.getElementById('view-chat');
  const dropOverlay = document.getElementById('drop-overlay');
  let dragDepth = 0;
  viewChat?.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragDepth++;
    dropOverlay?.classList.add('show');
  });
  viewChat?.addEventListener('dragover', (e) => {
    e.preventDefault();
  });
  viewChat?.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) dropOverlay?.classList.remove('show');
  });
  viewChat?.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    dropOverlay?.classList.remove('show');
    if (e.dataTransfer?.files?.length) {
      handleFiles(e.dataTransfer.files);
    }
  });

  document.getElementById('btn-img-mode').addEventListener('click', (e) => {
    imageMode = !imageMode;
    e.currentTarget.classList.toggle('active', imageMode);
    e.currentTarget.setAttribute('aria-pressed', String(imageMode));
    toast(imageMode ? '🎨 حالت تولید/ویرایش تصویر فعال شد' : '💬 حالت گفتگوی متنی فعال شد');
  });

  document.getElementById('btn-attach').addEventListener('click', () => document.getElementById('file-input').click());
  document.getElementById('file-input').addEventListener('change', (e) => {
    handleFiles(e.target.files);
    e.target.value = '';
  });

  // Paste image directly into composer
  document.getElementById('msg-input')?.addEventListener('paste', (e) => {
    const items = Array.from(e.clipboardData?.items || []);
    const imgFiles = items.filter((i) => i.type.startsWith('image/')).map((i) => i.getAsFile()).filter(Boolean);
    if (imgFiles.length) {
      handleFiles(imgFiles);
    }
  });

  // Session search
  document.getElementById('ses-search')?.addEventListener('input', (e) => {
    renderSessionsSidebar(e.target.value);
  });

  // Voice input (Web Speech API)
  const voiceBtn = document.getElementById('btn-voice');
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (voiceBtn) {
    if (!SpeechRec) {
      voiceBtn.style.display = 'none';
    } else {
      let rec = null;
      let listening = false;
      voiceBtn.addEventListener('click', () => {
        if (listening && rec) { rec.stop(); return; }
        rec = new SpeechRec();
        rec.lang = 'fa-IR';
        rec.interimResults = false;
        rec.onstart = () => { listening = true; voiceBtn.style.color = 'var(--danger)'; toast('🎤 در حال گوش دادن...'); };
        rec.onresult = (ev) => {
          const transcript = ev.results?.[0]?.[0]?.transcript || '';
          if (transcript) {
            const inp = document.getElementById('msg-input');
            inp.value = inp.value ? `${inp.value} ${transcript}` : transcript;
            inp.dispatchEvent(new Event('input'));
          }
        };
        rec.onend = () => { listening = false; voiceBtn.style.color = ''; };
        rec.onerror = () => { listening = false; voiceBtn.style.color = ''; toast('خطا در تشخیص صدا'); };
        rec.start();
      });
    }
  }

  // Register PWA Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  document.getElementById('send-btn').addEventListener('click', handleSend);
  const msgInput = document.getElementById('msg-input');
  const slashMenu = document.getElementById('slash-menu');
  function insertPromptIntoComposer(promptObj) {
    if (!promptObj) return;
    const vars = extractVariables(promptObj.text || '');
    if (vars.length) {
      pendingPromptTemplate = promptObj;
      const titleEl = document.getElementById('pv-title');
      const fieldsEl = document.getElementById('pv-fields');
      if (titleEl) titleEl.textContent = `پر کردن متغیرها: ${promptObj.title}`;
      if (fieldsEl) {
        fieldsEl.innerHTML = vars
          .map(
            (v, idx) => `
            <div class="field">
              <label for="pv-var-${idx}">${escHtml(v)}</label>
              <input id="pv-var-${idx}" data-var-name="${escHtml(v)}" placeholder="مقدار ${escHtml(v)}...">
            </div>`
          )
          .join('');
      }
      document.getElementById('modal-prompt-vars')?.classList.add('open');
      setTimeout(() => document.getElementById('pv-var-0')?.focus(), 30);
      return;
    }
    msgInput.value = (promptObj.text || '') + ' ';
    autoGrowInput();
    msgInput.focus();
  }

  document.getElementById('pv-apply')?.addEventListener('click', () => {
    if (!pendingPromptTemplate) return;
    const values = {};
    document.querySelectorAll('#pv-fields [data-var-name]').forEach((inp) => {
      values[inp.dataset.varName] = inp.value;
    });
    msgInput.value = substituteVariables(pendingPromptTemplate.text || '', values) + ' ';
    pendingPromptTemplate = null;
    document.getElementById('modal-prompt-vars')?.classList.remove('open');
    autoGrowInput();
    msgInput.focus();
  });

  msgInput.addEventListener('input', () => {
    autoGrowInput();
    if (slashMenu && msgInput.value.startsWith('/')) {
      const q = msgInput.value.slice(1).toLowerCase();
      const matches = (store.state.prompts || []).filter(
        (p) => p.title.toLowerCase().includes(q) || (p.category || '').toLowerCase().includes(q)
      );
      if (matches.length) {
        slashMenu.innerHTML = matches
          .map(
            (p) => `<button class="slash-item" type="button" data-prompt-id="${escHtml(p.id)}">
              <div class="slash-item-head"><b>/${escHtml(p.title)}</b><span class="slash-cat">${escHtml(p.category || 'عمومی')}</span></div>
              <span>${escHtml(p.text)}</span>
            </button>`
          )
          .join('');
        slashMenu.classList.add('show');
        slashMenu.querySelectorAll('.slash-item').forEach((b) => {
          b.addEventListener('click', () => {
            const found = (store.state.prompts || []).find((x) => x.id === b.dataset.promptId);
            slashMenu.classList.remove('show');
            if (found) insertPromptIntoComposer(found);
          });
        });
      } else {
        slashMenu.classList.remove('show');
      }
    } else if (slashMenu) {
      slashMenu.classList.remove('show');
    }
  });
  msgInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  });

  // Online Fetch Models in Add/Edit Provider Modal
  const fetchModelsBtn = document.getElementById('m-prov-fetch-models');
  fetchModelsBtn?.addEventListener('click', async () => {
    const baseUrl = document.getElementById('m-prov-url')?.value.trim() || '';
    if (!baseUrl || !/^https?:\/\//i.test(baseUrl)) {
      setProvFetchStatus('ابتدا یک Base URL معتبر (با http:// یا https://) وارد کنید.', true);
      return;
    }
    const provId = document.getElementById('m-prov-id')?.value.trim() || '';
    const prov = provId ? store.state.providers.find((x) => x.id === provId) : null;
    const modalApiKey = document.getElementById('m-prov-apikey')?.value.trim() || '';
    const activeKey = modalApiKey || prov?.keys?.find((k) => k.status !== 'dead')?.value || '';

    fetchModelsBtn.disabled = true;
    fetchModelsBtn.textContent = 'در حال دریافت...';
    setProvFetchStatus('در حال دریافت لیست مدل‌ها...');

    try {
      const models = await fetchProviderModels({
        baseUrl,
        apiKey: activeKey,
        corsProxy: store.state.settings.corsProxy || '',
        noKey: Boolean(document.getElementById('m-prov-nokey')?.checked),
      });
      fetchedProvModels = models;
      if (!models.length) {
        document.getElementById('m-prov-picker')?.setAttribute('hidden', '');
        setProvFetchStatus('هیچ مدلی از این آدرس برگردانده نشد.', true);
      } else {
        setProvFetchStatus('');
        renderProviderModelPicker();
        document.getElementById('m-prov-picker-search')?.focus();
      }
    } catch (err) {
      fetchedProvModels = [];
      document.getElementById('m-prov-picker')?.setAttribute('hidden', '');
      setProvFetchStatus(err?.message || 'خطا در دریافت لیست مدل‌ها', true);
    } finally {
      fetchModelsBtn.disabled = false;
      fetchModelsBtn.textContent = '🔄 دریافت آنلاین مدل‌ها';
    }
  });

  document.getElementById('m-prov-picker-search')?.addEventListener('input', () => {
    renderProviderModelPicker();
  });

  document.getElementById('m-prov-models')?.addEventListener('input', () => {
    if (fetchedProvModels.length) renderProviderModelPicker();
  });

  // Modals submit
  document.getElementById('m-prov-save').addEventListener('click', () => {
    const id = document.getElementById('m-prov-id').value.trim();
    const name = document.getElementById('m-prov-name').value.trim();
    const baseUrl = document.getElementById('m-prov-url').value.trim();
    const apiKey = document.getElementById('m-prov-apikey')?.value.trim() || '';
    const defaultModel = document.getElementById('m-prov-default-model').value.trim();
    const models = document.getElementById('m-prov-models').value.split(/[\r\n,،]+/).map((s) => s.trim()).filter(Boolean);
    const supportsImages = document.getElementById('m-prov-img').checked;
    const noKey = Boolean(document.getElementById('m-prov-nokey')?.checked);
    if (!name || !baseUrl.startsWith('http')) return toast('نام و Base URL معتبر وارد کنید');
    if (id) {
      const existing = store.state.providers.find((x) => x.id === id);
      const effectiveDefault =
        defaultModel && existing && defaultModel === existing.defaultModel && !models.includes(defaultModel)
          ? (models[0] || '')
          : defaultModel;
      const updated = store.updateProvider(id, { name, baseUrl, defaultModel: effectiveDefault, models, supportsImages, noKey });
      if (apiKey && updated && !(updated.keys || []).some((k) => k.value === apiKey)) {
        store.addKey(updated.id, { value: apiKey });
      }
      updateTargetPill();
      document.getElementById('modal-prov').classList.remove('open');
      switchTab('providers');
      toast('ارائه‌دهنده ویرایش شد');
    } else {
      const created = store.addProvider({ name, baseUrl, defaultModel, models, supportsImages, noKey });
      if (apiKey && created && !(created.keys || []).some((k) => k.value === apiKey)) {
        store.addKey(created.id, { value: apiKey });
      }
      document.getElementById('modal-prov').classList.remove('open');
      switchTab('providers');
      toast('ارائه‌دهنده اضافه شد');
    }
  });

  document.getElementById('m-key-save').addEventListener('click', () => {
    const pid = document.getElementById('m-key-prov-id').value;
    const label = document.getElementById('m-key-label').value.trim();
    const value = document.getElementById('m-key-val').value.trim();
    if (value.length < 6) return toast('کلید نامعتبر است');
    store.addKey(pid, { value, label });
    document.getElementById('modal-key').classList.remove('open');
    switchTab('providers');
    toast('کلید ذخیره شد');
  });

  // Settings modal + Export/Import
  function populateSystemPromptPresets() {
    const sel = document.getElementById('s-sys-preset');
    if (!sel) return;
    const sysPrompts = (store.state.prompts || []).filter((p) => p.kind === 'system');
    sel.innerHTML = [
      '<option value="">— انتخاب پیش‌تنظیم —</option>',
      ...sysPrompts.map(
        (p) => `<option value="${escHtml(p.id)}">${escHtml(p.title)} (${escHtml(p.category || 'عمومی')})</option>`
      ),
    ].join('');
  }

  document.getElementById('s-sys-preset')?.addEventListener('change', (e) => {
    const id = e.target.value;
    if (!id) return;
    const p = (store.state.prompts || []).find((x) => x.id === id);
    if (p) {
      document.getElementById('s-sys').value = p.text || '';
      toast(`پیش‌تنظیم «${p.title}» اعمال شد`);
    }
  });

  document.getElementById('btn-settings').addEventListener('click', () => {
    populateSystemPromptPresets();
    document.getElementById('s-sys').value = store.state.settings.systemPrompt;
    document.getElementById('s-temp').value = store.state.settings.temperature;
    document.getElementById('s-proxy').value = store.state.settings.corsProxy || '';
    const ws = store.state.settings.webSearch || {};
    const wsProv = document.getElementById('s-ws-provider');
    const wsKey = document.getElementById('s-ws-key');
    if (wsProv) wsProv.value = ws.provider || 'tavily';
    if (wsKey) wsKey.value = ws.apiKey || '';
    document.getElementById('modal-settings').classList.add('open');
  });
  document.getElementById('s-save').addEventListener('click', () => {
    store.state.settings.systemPrompt = document.getElementById('s-sys').value.trim();
    store.state.settings.temperature = parseFloat(document.getElementById('s-temp').value) || 0.7;
    store.state.settings.corsProxy = document.getElementById('s-proxy').value.trim();
    const wsProv = document.getElementById('s-ws-provider')?.value || 'tavily';
    const wsKey = document.getElementById('s-ws-key')?.value.trim() || '';
    store.state.settings.webSearch = {
      ...(store.state.settings.webSearch || {}),
      provider: wsProv,
      apiKey: wsKey,
      enabled: wsKey ? Boolean(store.state.settings.webSearch?.enabled) : false,
    };
    store.save();
    updateQuickParamsLabel();
    updateWebSearchButton();
    document.getElementById('modal-settings').classList.remove('open');
    toast('تنظیمات ذخیره شد');
  });

  document.getElementById('btn-export').addEventListener('click', async () => {
    const pass = window.prompt(
      'رمز عبور برای رمزنگاری بکاپ با AES-GCM (توصیه می‌شود — برای بکاپ بدون رمز خالی بگذارید):',
      ''
    );
    if (pass === null) return;
    const trimmedPass = pass.trim();
    if (!trimmedPass) {
      const confirmed = window.confirm(
        'هشدار امنیتی: فایل بکاپ بدون رمزنگاری شامل تمام کلیدهای API شما به صورت متن ساده است و هر کسی که این فایل را داشته باشد به تمام کلیدها دسترسی خواهد داشت.\n\nآیا مطمئن هستید که می‌خواهید بدون رمزنگاری ادامه دهید؟'
      );
      if (!confirmed) {
        toast('دانلود بکاپ لغو شد');
        return;
      }
    }
    let payload = store.exportJson();
    if (trimmedPass) {
      try {
        payload = await encryptBackup(store.state, trimmedPass);
        toast('بکاپ رمزنگاری‌شده آماده شد');
      } catch (err) {
        return toast(`خطا در رمزنگاری: ${err.message}`);
      }
    }
    const blob = new Blob([payload], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `9router-web-backup-${trimmedPass ? 'encrypted-' : ''}${Date.now()}.json`;
    a.click();
  });

  document.getElementById('btn-import').addEventListener('click', () => document.getElementById('import-file').click());
  document.getElementById('import-file').addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = async (ev) => {
      try {
        let raw = String(ev.target.result || '');
        if (isEncryptedBackup(raw)) {
          const pass = window.prompt('این فایل بکاپ رمزنگاری شده است. رمز عبور را وارد کنید:');
          if (!pass) return toast('بازیابی لغو شد');
          const decryptedObj = await decryptBackup(raw, pass.trim());
          raw = JSON.stringify(decryptedObj);
        }
        store.importJson(raw);
        updateTargetPill();
        updateQuickParamsLabel();
        updateWebSearchButton();
        renderSessionsSidebar();
        switchTab(currentTab);
        toast('پشتیبان با موفقیت بازیابی شد');
      } catch (err) {
        toast(err?.message || 'فایل پشتیبان نامعتبر است');
      }
    };
    r.readAsText(f);
    e.target.value = '';
  });

  // ─── Prompt Library Modal ───────────────────────────────────────────────────
  function renderPromptLibrary() {
    const listEl = document.getElementById('pl-list');
    const catSel = document.getElementById('pl-cat-filter');
    const searchEl = document.getElementById('pl-search');
    if (!listEl || !catSel) return;

    const all = store.state.prompts || [];
    const cats = [...new Set(all.map((p) => p.category || 'عمومی'))];
    const prevCat = catSel.value || '';
    catSel.innerHTML = [
      '<option value="">همه دسته‌ها</option>',
      ...cats.map((c) => `<option value="${escHtml(c)}" ${c === prevCat ? 'selected' : ''}>${escHtml(c)}</option>`),
    ].join('');

    const q = (searchEl?.value || '').trim().toLowerCase();
    const activeCat = catSel.value || '';
    const filtered = all.filter((p) => {
      if (activeCat && (p.category || 'عمومی') !== activeCat) return false;
      if (!q) return true;
      return (
        (p.title || '').toLowerCase().includes(q) ||
        (p.text || '').toLowerCase().includes(q) ||
        (p.category || '').toLowerCase().includes(q)
      );
    });

    if (!filtered.length) {
      listEl.innerHTML = '<div class="muted" style="padding:16px;text-align:center">پرامپتی یافت نشد.</div>';
      return;
    }

    listEl.innerHTML = filtered
      .map(
        (p) => `
        <div class="pl-card">
          <div class="pl-card-head">
            <div class="pl-card-title">
              <strong>${escHtml(p.title)}</strong>
              <span class="slash-cat">${escHtml(p.category || 'عمومی')}</span>
              <span class="pl-kind-badge ${p.kind === 'system' ? 'sys' : ''}">${p.kind === 'system' ? 'System' : 'Prompt'}</span>
            </div>
            <div class="pl-card-acts">
              ${p.kind !== 'system' ? `<button class="btn btn-sm btn-ghost" type="button" data-pl-use="${escHtml(p.id)}">استفاده</button>` : ''}
              <button class="btn btn-sm btn-ghost" type="button" data-pl-edit="${escHtml(p.id)}">ویرایش</button>
              <button class="btn btn-sm btn-ghost" type="button" data-pl-dup="${escHtml(p.id)}">کپی</button>
              <button class="btn btn-sm btn-danger" type="button" data-pl-del="${escHtml(p.id)}">حذف</button>
            </div>
          </div>
          <div class="pl-card-text">${escHtml(p.text)}</div>
        </div>`
      )
      .join('');

    listEl.querySelectorAll('[data-pl-use]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const p = (store.state.prompts || []).find((x) => x.id === btn.dataset.plUse);
        if (!p) return;
        document.getElementById('modal-prompts')?.classList.remove('open');
        switchTab('chat');
        insertPromptIntoComposer(p);
      });
    });

    listEl.querySelectorAll('[data-pl-edit]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const p = (store.state.prompts || []).find((x) => x.id === btn.dataset.plEdit);
        if (!p) return;
        const editor = document.getElementById('pl-editor');
        document.getElementById('pl-edit-id').value = p.id;
        document.getElementById('pl-title').value = p.title || '';
        document.getElementById('pl-category').value = p.category || 'عمومی';
        document.getElementById('pl-kind').value = p.kind === 'system' ? 'system' : 'prompt';
        document.getElementById('pl-text').value = p.text || '';
        if (editor) editor.hidden = false;
        document.getElementById('pl-title')?.focus();
      });
    });

    listEl.querySelectorAll('[data-pl-dup]').forEach((btn) => {
      btn.addEventListener('click', () => {
        store.duplicatePrompt(btn.dataset.plDup);
        renderPromptLibrary();
        toast('پرامپت کپی شد');
      });
    });

    listEl.querySelectorAll('[data-pl-del]').forEach((btn) => {
      btn.addEventListener('click', () => {
        store.deletePrompt(btn.dataset.plDel);
        renderPromptLibrary();
        toast('پرامپت حذف شد');
      });
    });
  }

  document.getElementById('btn-prompt-lib')?.addEventListener('click', () => {
    const editor = document.getElementById('pl-editor');
    if (editor) editor.hidden = true;
    renderPromptLibrary();
    document.getElementById('modal-prompts')?.classList.add('open');
  });

  document.getElementById('pl-search')?.addEventListener('input', renderPromptLibrary);
  document.getElementById('pl-cat-filter')?.addEventListener('change', renderPromptLibrary);

  document.getElementById('pl-new-btn')?.addEventListener('click', () => {
    const editor = document.getElementById('pl-editor');
    document.getElementById('pl-edit-id').value = '';
    document.getElementById('pl-title').value = '';
    document.getElementById('pl-category').value = 'عمومی';
    document.getElementById('pl-kind').value = 'prompt';
    document.getElementById('pl-text').value = '';
    if (editor) editor.hidden = false;
    document.getElementById('pl-title')?.focus();
  });

  document.getElementById('pl-cancel-edit')?.addEventListener('click', () => {
    const editor = document.getElementById('pl-editor');
    if (editor) editor.hidden = true;
  });

  document.getElementById('pl-editor')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const id = document.getElementById('pl-edit-id').value.trim();
    const title = document.getElementById('pl-title').value.trim();
    const category = document.getElementById('pl-category').value.trim() || 'عمومی';
    const kind = document.getElementById('pl-kind').value === 'system' ? 'system' : 'prompt';
    const text = document.getElementById('pl-text').value.trim();
    if (!title || !text) return toast('عنوان و متن پرامپت الزامی است');
    if (id) {
      store.updatePrompt(id, { title, category, kind, text });
      toast('پرامپت ویرایش شد');
    } else {
      store.addPrompt({ title, category, kind, text });
      toast('پرامپت اضافه شد');
    }
    const editor = document.getElementById('pl-editor');
    if (editor) editor.hidden = true;
    renderPromptLibrary();
  });

  document.getElementById('pl-export')?.addEventListener('click', () => {
    const json = store.exportPromptsJson();
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `9router-prompts-${Date.now()}.json`;
    a.click();
    toast('فایل پرامپت‌ها دانلود شد');
  });

  document.getElementById('pl-import')?.addEventListener('click', () => {
    document.getElementById('pl-import-file')?.click();
  });

  document.getElementById('pl-import-file')?.addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = (ev) => {
      try {
        store.importPromptsJson(String(ev.target.result || ''));
        renderPromptLibrary();
        toast('پرامپت‌ها با موفقیت وارد شدند');
      } catch (err) {
        toast(err?.message || 'فایل JSON پرامپت نامعتبر است');
      }
    };
    r.readAsText(f);
    e.target.value = '';
  });

  // ─── Attach URL Modal ───────────────────────────────────────────────────────
  const urlModal = document.getElementById('modal-url-attach');
  const urlInput = document.getElementById('url-attach-input');
  const urlStatus = document.getElementById('url-attach-status');
  const urlSubmit = document.getElementById('url-attach-submit');

  function setUrlStatus(msg = '', isErr = false) {
    if (!urlStatus) return;
    if (!msg) {
      urlStatus.hidden = true;
      urlStatus.textContent = '';
      urlStatus.classList.remove('error');
      return;
    }
    urlStatus.hidden = false;
    urlStatus.textContent = msg;
    urlStatus.classList.toggle('error', isErr);
  }

  document.getElementById('btn-attach-url')?.addEventListener('click', () => {
    if (urlInput) urlInput.value = '';
    setUrlStatus('');
    urlModal?.classList.add('open');
    setTimeout(() => urlInput?.focus(), 30);
  });

  urlSubmit?.addEventListener('click', async () => {
    const rawUrl = urlInput?.value.trim() || '';
    if (!rawUrl) return setUrlStatus('لطفاً یک آدرس معتبر وارد کنید.', true);
    urlSubmit.disabled = true;
    urlSubmit.textContent = 'در حال دریافت...';
    setUrlStatus('در حال دریافت و استخراج متن صفحه...');
    try {
      const page = await fetchWebPage({
        url: rawUrl,
        corsProxy: store.state.settings.corsProxy || '',
      });
      attachedUrls.push(page);
      renderPreviews();
      urlModal?.classList.remove('open');
      toast(`صفحه «${page.title || page.url}» پیوست شد`);
    } catch (err) {
      setUrlStatus(err?.message || 'خطا در دریافت صفحه وب', true);
    } finally {
      urlSubmit.disabled = false;
      urlSubmit.textContent = 'دریافت محتوا';
    }
  });

  document.querySelectorAll('[data-close-modal]').forEach((b) => {
    b.addEventListener('click', () => b.closest('.modal-bg')?.classList.remove('open'));
  });
});
