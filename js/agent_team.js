/**
 * OpenBot-Style Multi-Agent Team Studio (Builder + Live Execution Engine)
 * Cycle A: Studio Toolbar, Execution Modes, HITL Toggle, Visual Roster, Agent & Team Inspector Modals.
 * Cycle B: 4 Orchestration Modes (manager_worker, sequential, parallel, debate_review),
 *          targetOverride + temperature (zero activeTarget mutation), Live Telemetry,
 *          Shared Blackboard, HITL Steering Gate, Run History & Artifact Export.
 */

import { store, TEAM_MODES } from './store.js';
import { escHtml, renderMarkdown } from './markdown.js';
import { runChatCompletion } from './router.js';

let selectedTeamId = null;
let teamAbort = null;
let activeModalCleanup = null;
let activeSubPanel = null; // null | 'blackboard' | 'history'

const AGENT_ICONS = ['🤖', '👑', '🧠', '🎨', '💻', '🔍', '✍️', '📊', '🛡️', '⚡', '🧪', '🏗️', '📝', '🎯', '🌐', '🔧'];
const TEAM_ICONS = ['🚀', '🌐', '🔬', '🛡️', '✍️', '🤖', '⚡', '🎯', '🧠', '💡', '📊', '🎨'];

const MODE_KEYS = ['manager_worker', 'sequential', 'parallel', 'debate_review'];
const MODE_META = {
  manager_worker: { icon: '👑', label: 'مدیر-متخصص', flow: 'تقسیم وظایف و هماهنگی' },
  sequential: { icon: '⛓️', label: 'ترتیبی', flow: 'اجرای زنجیره‌ای مرحله به مرحله' },
  parallel: { icon: '⚡', label: 'موازی', flow: 'اجرای همزمان متخصص‌ها' },
  debate_review: { icon: '🔄', label: 'نقد و بازبینی', flow: 'تولید، نقد و اصلاح' },
};

function maskKeyLabel(keyObj, idx) {
  const val = String(keyObj?.key || '');
  const tail = val.length > 8 ? `${val.slice(0, 4)}...${val.slice(-4)}` : (val || `key-${idx + 1}`);
  const label = keyObj?.label ? `${keyObj.label} (${tail})` : tail;
  const statusTag = keyObj?.status === 'dead' ? ' [غیرفعال]' : keyObj?.status === 'cooldown' ? ' [استراحت]' : '';
  return `${label}${statusTag}`;
}

function getAgentAssignmentBadge(agent) {
  const prov = agent.providerId ? store.state.providers.find((p) => p.id === agent.providerId) : null;
  if (!prov) {
    return { label: 'خودکار (بهترین کلید فعال)', isAuto: true };
  }
  const modelName = agent.model || prov.defaultModel || 'پیش‌فرض';
  const keyObj = agent.keyId ? (prov.keys || []).find((k) => k.id === agent.keyId) : null;
  const keyPart = keyObj ? ` | ${keyObj.label || 'کلید اختصاصی'}` : '';
  return { label: `${prov.name} / ${modelName}${keyPart}`, isAuto: false };
}

function formatTelemetry(meta) {
  if (!meta) return 'در حال اتصال...';
  const parts = [];
  const provider = meta.provider || meta.providerName;
  const model = meta.model || meta.modelId;
  const tps = meta.tokPerSec ?? meta.tps;
  if (provider || model) {
    parts.push(`${provider || ''}${provider && model ? ' / ' : ''}${model || ''}`);
  }
  if (typeof tps === 'number' && tps > 0) {
    parts.push(`${tps.toFixed(1)} tok/s`);
  }
  if (typeof meta.ttftMs === 'number' && meta.ttftMs > 0) {
    parts.push(`${Math.round(meta.ttftMs)}ms`);
  }
  return parts.join(' | ') || 'در حال نوشتن...';
}

async function callAgent(agent, messages, { onStream, onMeta, signal }) {
  const hasActiveKey = store.state.providers.some((p) => (p.keys || []).some((k) => k.status !== 'dead'));
  if (!hasActiveKey) {
    throw new Error('هیچ کلید API فعالی پیدا نشد. ابتدا از بخش «ارائه‌دهنده‌ها و کلیدها» یک کلید اضافه کنید.');
  }
  const targetOverride = agent?.providerId
    ? {
        type: 'provider',
        id: agent.providerId,
        model: agent.model || undefined,
        keyId: agent.keyId || undefined,
      }
    : undefined;

  const temperature = typeof agent?.temperature === 'number' && !Number.isNaN(agent.temperature)
    ? agent.temperature
    : undefined;

  return await runChatCompletion({
    messages,
    targetOverride,
    temperature,
    onStream,
    onMeta,
    signal,
  });
}

function extractHtmlCode(text) {
  const s = String(text || '');
  const closed = s.match(/```html\n?([\s\S]*?)```/i);
  if (closed) return closed[1];
  const unclosed = s.match(/```html\n?([\s\S]+)$/i);
  if (unclosed && /<html|<body|<div|<style/i.test(unclosed[1])) return unclosed[1];
  if (/<html[\s>]|<!doctype html/i.test(s)) {
    const start = s.search(/<!doctype html|<html/i);
    const endIdx = s.lastIndexOf('</html>');
    return endIdx > start ? s.slice(start, endIdx + 7) : s.slice(start);
  }
  return null;
}

function formatAgentOutput(text, thinking, isLive = false) {
  const thinkHtml = thinking
    ? `<details class="think-box" ${isLive ? 'open' : ''}><summary>💭 ${isLive ? 'در حال تفکر...' : 'فرایند تفکر مدل'}</summary><div style="margin-top:6px">${escHtml(isLive ? thinking.slice(-600) : thinking).replace(/\n/g, '<br>')}</div></details>`
    : '';
  const bodyHtml = text ? renderMarkdown(text) : (isLive && !thinking ? 'در حال اتصال...' : '');
  return `${thinkHtml}${bodyHtml}${isLive ? ' ▌' : ''}`;
}

function buildStepsList(team, mode) {
  if (mode === 'sequential') {
    return team.workers.map((w, i) => ({ id: w.id, label: `${i + 1}. ${w.name || w.role}` }));
  }
  if (mode === 'parallel') {
    return [
      { id: 'parallel-workers', label: `⚡ اجرای همزمان (${team.workers.length})` },
      { id: 'final', label: '✨ جمع‌بندی مدیر' },
    ];
  }
  if (mode === 'debate_review') {
    const rounds = Math.max(1, Number(team.maxRounds) || 1);
    const steps = [{ id: 'draft', label: '۱. پیش‌نویس اولیه' }];
    for (let r = 1; r <= rounds; r++) {
      steps.push({ id: `review-${r}`, label: `نقد دور ${r}` });
      steps.push({ id: `revise-${r}`, label: `اصلاح دور ${r}` });
    }
    return steps;
  }
  return [
    { id: 'plan', label: '① برنامه‌ریزی مدیر' },
    ...team.workers.map((w, i) => ({ id: w.id, label: `${i + 2}. ${w.name || w.role}` })),
    { id: 'final', label: '✨ خروجی نهایی' },
  ];
}

function attachArtifactActions(parentEl, { finalHtml, fullReportMd, finalText, onToast }) {
  const acts = document.createElement('div');
  acts.className = 'final-actions';
  acts.innerHTML = `
    ${finalHtml ? '<button type="button" class="btn btn-amber btn-sm" data-act="preview">👁️ پیش‌نمایش زنده</button>' : ''}
    ${finalHtml ? '<button type="button" class="btn btn-ok btn-sm" data-act="dl-html">⬇️ .html</button>' : ''}
    <button type="button" class="btn btn-ghost btn-sm" data-act="dl-md">📄 .md</button>
    <button type="button" class="btn btn-ghost btn-sm" data-act="copy">📋 کپی</button>
  `;
  parentEl.appendChild(acts);
  acts.querySelector('[data-act="preview"]')?.addEventListener('click', () => window.__openHtmlPreview?.(finalHtml));
  acts.querySelector('[data-act="dl-html"]')?.addEventListener('click', () => {
    const blob = new Blob([finalHtml], { type: 'text/html;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'index.html';
    a.click();
  });
  acts.querySelector('[data-act="dl-md"]')?.addEventListener('click', () => {
    const blob = new Blob([fullReportMd], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `9router-team-output-${Date.now()}.md`;
    a.click();
  });
  acts.querySelector('[data-act="copy"]')?.addEventListener('click', () => {
    navigator.clipboard.writeText(finalHtml || finalText || fullReportMd).then(() => onToast('کپی شد ✓'));
  });
}

function waitForHitl(nextLabel, feedEl, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const err = new Error('Aborted');
      err.name = 'AbortError';
      return reject(err);
    }

    const bar = document.createElement('div');
    bar.className = 'hitl-bar';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'کنترل انسانی بین مراحل');
    bar.innerHTML = `
      <div class="hitl-bar-head">
        <span class="hitl-badge">⏸️ توقف بین مراحل</span>
        <span class="hitl-next-label">مرحله بعدی: <b>${escHtml(nextLabel)}</b></span>
      </div>
      <div class="hitl-bar-controls">
        <input type="text" class="hitl-input" placeholder="تزریق دستور یا راهنمایی برای مرحله بعد (اختیاری)..." aria-label="تزریق دستور" />
        <button type="button" class="btn btn-amber btn-sm" data-hitl="continue">▶️ ادامه</button>
        <button type="button" class="btn btn-ok btn-sm" data-hitl="inject">💬 تزریق دستور</button>
        <button type="button" class="btn btn-ghost btn-sm" data-hitl="skip">⏭️ رد شدن</button>
      </div>
    `;
    feedEl.appendChild(bar);
    feedEl.scrollTop = feedEl.scrollHeight;

    const input = bar.querySelector('.hitl-input');
    input.focus();

    const onAbort = () => {
      bar.remove();
      const err = new Error('Aborted');
      err.name = 'AbortError';
      reject(err);
    };

    const finish = (action, feedback = '') => {
      signal?.removeEventListener('abort', onAbort);
      bar.classList.add('resolved');
      bar.innerHTML = `<div class="hitl-resolved-note">${
        action === 'skip'
          ? `⏭️ مرحله «${escHtml(nextLabel)}» رد شد.`
          : feedback
            ? `💬 دستور تزریق شد: «${escHtml(feedback)}»`
            : `▶️ ادامه به مرحله «${escHtml(nextLabel)}» تایید شد.`
      }</div>`;
      resolve({ action, feedback });
    };

    signal?.addEventListener('abort', onAbort, { once: true });
    bar.querySelector('[data-hitl="continue"]').addEventListener('click', () => finish('continue', input.value.trim()));
    bar.querySelector('[data-hitl="inject"]').addEventListener('click', () => finish('continue', input.value.trim()));
    bar.querySelector('[data-hitl="skip"]').addEventListener('click', () => finish('skip', ''));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        finish('continue', input.value.trim());
      }
    });
  });
}

function closeActiveModal() {
  if (typeof activeModalCleanup === 'function') {
    activeModalCleanup();
    activeModalCleanup = null;
  }
}

function mountAccessibleModal(html, triggerEl, onMount) {
  closeActiveModal();
  const overlay = document.createElement('div');
  overlay.className = 'modal-bg open team-modal-bg';
  overlay.innerHTML = html;
  document.body.appendChild(overlay);

  const dialog = overlay.querySelector('.modal');
  const getFocusables = () =>
    Array.from(
      dialog.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')
    );

  const cleanup = () => {
    document.removeEventListener('keydown', onKeyDown);
    overlay.remove();
    if (triggerEl && typeof triggerEl.focus === 'function' && document.contains(triggerEl)) {
      triggerEl.focus();
    }
    if (activeModalCleanup === cleanup) activeModalCleanup = null;
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      cleanup();
      return;
    }
    if (e.key === 'Tab') {
      const focusables = getFocusables();
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) cleanup();
  });
  document.addEventListener('keydown', onKeyDown);
  activeModalCleanup = cleanup;

  onMount(overlay, cleanup);

  const firstInput = dialog.querySelector('input:not([type="hidden"]), textarea, select, button');
  if (firstInput) firstInput.focus();
}

function openAgentInspectorModal({ title, initial, triggerEl, onSave }) {
  const data = {
    name: initial?.name || '',
    role: initial?.role || '',
    icon: initial?.icon || '🤖',
    providerId: initial?.providerId || '',
    model: initial?.model || '',
    keyId: initial?.keyId || '',
    temperature: typeof initial?.temperature === 'number' ? initial.temperature : 0.7,
    instructions: initial?.instructions || '',
  };

  const provOptions = [
    `<option value="">خودکار (اولین کلید فعال)</option>`,
    ...store.state.providers.map((p) => {
      const activeCount = (p.keys || []).filter((k) => k.status !== 'dead').length;
      return `<option value="${escHtml(p.id)}" ${p.id === data.providerId ? 'selected' : ''}>${escHtml(p.name)} (${activeCount} کلید فعال)</option>`;
    }),
  ].join('');

  const modalHtml = `
    <div class="modal team-inspector-modal" role="dialog" aria-modal="true" aria-labelledby="agent-modal-title">
      <div class="team-modal-head">
        <h3 id="agent-modal-title">${escHtml(title)}</h3>
        <button type="button" class="icon-btn team-modal-close" aria-label="بستن">×</button>
      </div>

      <div class="team-modal-grid">
        <div class="field">
          <label for="ai-name">نام ایجنت</label>
          <input id="ai-name" type="text" value="${escHtml(data.name)}" placeholder="مثلاً: معمار فرانت‌اند" />
        </div>
        <div class="field">
          <label for="ai-role">نقش (Role)</label>
          <input id="ai-role" type="text" value="${escHtml(data.role)}" placeholder="مثلاً: طراح رابط کاربری" />
        </div>
      </div>

      <div class="field">
        <label>آیکون / ایموجی</label>
        <div class="emoji-picker-row">
          <input id="ai-icon" class="emoji-custom-input" type="text" maxlength="4" value="${escHtml(data.icon)}" aria-label="ایموجی دلخواه" />
          <div class="emoji-grid" role="group" aria-label="انتخاب سریع آیکون">
            ${AGENT_ICONS.map((ic) => `<button type="button" class="emoji-opt ${ic === data.icon ? 'active' : ''}" data-emoji="${ic}">${ic}</button>`).join('')}
          </div>
        </div>
      </div>

      <div class="field">
        <label for="ai-instructions">پرامپت سیستم (System Prompt)</label>
        <textarea id="ai-instructions" rows="4" placeholder="دستورالعمل دقیق، لحن و استانداردهای خروجی این ایجنت را بنویسید...">${escHtml(data.instructions)}</textarea>
      </div>

      <div class="team-cascade-box">
        <div class="team-cascade-title">تنظیمات مدل و مسیریابی</div>
        <div class="team-modal-grid-3">
          <div class="field">
            <label for="ai-provider">ارائه‌دهنده (Provider)</label>
            <select id="ai-provider">${provOptions}</select>
          </div>
          <div class="field">
            <label for="ai-model">مدل (Model)</label>
            <select id="ai-model"></select>
          </div>
          <div class="field">
            <label for="ai-key">کلید API</label>
            <select id="ai-key"></select>
          </div>
        </div>
      </div>

      <div class="field">
        <div class="param-label-row">
          <label for="ai-temp">دمای پاسخ (Temperature)</label>
          <output id="ai-temp-out" for="ai-temp">${Number(data.temperature).toFixed(1)}</output>
        </div>
        <input id="ai-temp" type="range" min="0" max="2" step="0.1" value="${Number(data.temperature)}" />
      </div>

      <div class="modal-acts">
        <button type="button" class="btn btn-ghost" id="ai-cancel">انصراف</button>
        <button type="button" class="btn btn-amber" id="ai-save">ذخیره تغییرات</button>
      </div>
    </div>
  `;

  mountAccessibleModal(modalHtml, triggerEl, (overlay, close) => {
    const provSel = overlay.querySelector('#ai-provider');
    const modelSel = overlay.querySelector('#ai-model');
    const keySel = overlay.querySelector('#ai-key');
    const iconInput = overlay.querySelector('#ai-icon');
    const tempInput = overlay.querySelector('#ai-temp');
    const tempOut = overlay.querySelector('#ai-temp-out');

    const syncCascade = (keepModel, keepKey) => {
      const prov = store.state.providers.find((p) => p.id === provSel.value);
      if (!prov) {
        modelSel.innerHTML = `<option value="">خودکار (مدل پیش‌فرض)</option>`;
        modelSel.disabled = true;
        keySel.innerHTML = `<option value="">خودکار (چرخش هوشمند)</option>`;
        keySel.disabled = true;
        return;
      }
      modelSel.disabled = false;
      keySel.disabled = false;

      const models = Array.from(new Set([prov.defaultModel, ...(prov.models || [])].filter(Boolean)));
      modelSel.innerHTML =
        `<option value="">خودکار (${escHtml(prov.defaultModel || 'پیش‌فرض')})</option>` +
        models.map((m) => `<option value="${escHtml(m)}" ${m === keepModel ? 'selected' : ''}>${escHtml(m)}</option>`).join('');

      const keys = prov.keys || [];
      keySel.innerHTML =
        `<option value="">خودکار (چرخش هوشمند کلیدها)</option>` +
        keys.map((k, idx) => `<option value="${escHtml(k.id)}" ${k.id === keepKey ? 'selected' : ''}>${escHtml(maskKeyLabel(k, idx))}</option>`).join('');
    };

    syncCascade(data.model, data.keyId);

    provSel.addEventListener('change', () => syncCascade('', ''));
    tempInput.addEventListener('input', () => {
      tempOut.textContent = Number(tempInput.value).toFixed(1);
    });

    overlay.querySelectorAll('.emoji-opt').forEach((btn) => {
      btn.addEventListener('click', () => {
        iconInput.value = btn.dataset.emoji;
        overlay.querySelectorAll('.emoji-opt').forEach((b) => b.classList.toggle('active', b === btn));
      });
    });

    overlay.querySelector('.team-modal-close').addEventListener('click', close);
    overlay.querySelector('#ai-cancel').addEventListener('click', close);
    overlay.querySelector('#ai-save').addEventListener('click', () => {
      const name = overlay.querySelector('#ai-name').value.trim();
      const role = overlay.querySelector('#ai-role').value.trim();
      if (!name && !role) {
        overlay.querySelector('#ai-name').focus();
        return;
      }
      onSave({
        name: name || role,
        role: role || name,
        icon: iconInput.value.trim() || '🤖',
        instructions: overlay.querySelector('#ai-instructions').value.trim(),
        providerId: provSel.value,
        model: provSel.value ? modelSel.value : '',
        keyId: provSel.value ? keySel.value : '',
        temperature: Math.min(2, Math.max(0, Number(tempInput.value) || 0)),
      });
      close();
    });
  });
}

function openTeamEditorModal({ title, initial, triggerEl, onSave }) {
  const data = {
    name: initial?.name || '',
    icon: initial?.icon || '🚀',
    description: initial?.description || '',
    mode: initial?.mode || 'manager_worker',
    maxRounds: Number(initial?.maxRounds) || 1,
    hitlPause: Boolean(initial?.hitlPause),
  };

  const modalHtml = `
    <div class="modal team-inspector-modal" role="dialog" aria-modal="true" aria-labelledby="team-modal-title">
      <div class="team-modal-head">
        <h3 id="team-modal-title">${escHtml(title)}</h3>
        <button type="button" class="icon-btn team-modal-close" aria-label="بستن">×</button>
      </div>

      <div class="field">
        <label for="tm-name">نام تیم</label>
        <input id="tm-name" type="text" value="${escHtml(data.name)}" placeholder="مثلاً: تیم توسعه اپلیکیشن" />
      </div>

      <div class="field">
        <label>آیکون تیم</label>
        <div class="emoji-picker-row">
          <input id="tm-icon" class="emoji-custom-input" type="text" maxlength="4" value="${escHtml(data.icon)}" aria-label="آیکون تیم" />
          <div class="emoji-grid" role="group" aria-label="انتخاب آیکون تیم">
            ${TEAM_ICONS.map((ic) => `<button type="button" class="emoji-opt ${ic === data.icon ? 'active' : ''}" data-emoji="${ic}">${ic}</button>`).join('')}
          </div>
        </div>
      </div>

      <div class="field">
        <label for="tm-desc">توضیحات تیم</label>
        <textarea id="tm-desc" rows="2" placeholder="شرح کوتاه ماموریت و کاربرد این تیم...">${escHtml(data.description)}</textarea>
      </div>

      <div class="team-modal-grid">
        <div class="field">
          <label for="tm-mode">حالت اجرا (Orchestration Mode)</label>
          <select id="tm-mode">
            ${MODE_KEYS.map((m) => `<option value="${m}" ${m === data.mode ? 'selected' : ''}>${MODE_META[m].icon} ${escHtml(TEAM_MODES?.[m]?.labelFa || MODE_META[m].label)}</option>`).join('')}
          </select>
        </div>
        <div class="field" id="tm-rounds-wrap">
          <label for="tm-rounds">حداکثر دور بازبینی</label>
          <input id="tm-rounds" type="number" min="1" max="5" value="${data.maxRounds}" />
        </div>
      </div>

      <label class="team-check-row">
        <input id="tm-hitl" type="checkbox" ${data.hitlPause ? 'checked' : ''} />
        <span>توقف بین مراحل برای تایید یا راهنمایی کاربر (HITL)</span>
      </label>

      <div class="modal-acts">
        <button type="button" class="btn btn-ghost" id="tm-cancel">انصراف</button>
        <button type="button" class="btn btn-amber" id="tm-save">ذخیره تیم</button>
      </div>
    </div>
  `;

  mountAccessibleModal(modalHtml, triggerEl, (overlay, close) => {
    const iconInput = overlay.querySelector('#tm-icon');
    const modeSel = overlay.querySelector('#tm-mode');
    const roundsWrap = overlay.querySelector('#tm-rounds-wrap');

    const syncRounds = () => {
      roundsWrap.style.display = modeSel.value === 'debate_review' ? 'flex' : 'none';
    };
    syncRounds();
    modeSel.addEventListener('change', syncRounds);

    overlay.querySelectorAll('.emoji-opt').forEach((btn) => {
      btn.addEventListener('click', () => {
        iconInput.value = btn.dataset.emoji;
        overlay.querySelectorAll('.emoji-opt').forEach((b) => b.classList.toggle('active', b === btn));
      });
    });

    overlay.querySelector('.team-modal-close').addEventListener('click', close);
    overlay.querySelector('#tm-cancel').addEventListener('click', close);
    overlay.querySelector('#tm-save').addEventListener('click', () => {
      const name = overlay.querySelector('#tm-name').value.trim();
      if (!name) {
        overlay.querySelector('#tm-name').focus();
        return;
      }
      onSave({
        name,
        icon: iconInput.value.trim() || '🚀',
        description: overlay.querySelector('#tm-desc').value.trim(),
        mode: modeSel.value,
        maxRounds: Math.min(5, Math.max(1, Number(overlay.querySelector('#tm-rounds').value) || 1)),
        hitlPause: overlay.querySelector('#tm-hitl').checked,
      });
      close();
    });
  });
}

export function renderAgentTeam(container, { onToast }) {
  if (!store.state.teams?.length) return;
  let team = store.state.teams.find((t) => t.id === selectedTeamId) || store.state.teams[0];
  selectedTeamId = team.id;

  const activeMode = MODE_META[team.mode] ? team.mode : 'manager_worker';
  const modeInfo = MODE_META[activeMode];
  const mgrBadge = getAgentAssignmentBadge(team.manager);
  const stepsList = buildStepsList(team, activeMode);
  const runsCount = (store.state.teamRuns || []).length;

  let blackboardEntries = [];

  container.innerHTML = `
    <div class="team-studio-toolbar">
      <div class="team-toolbar-row">
        <div class="team-toolbar-group">
          <select id="team-select" class="graph-select team-select" aria-label="انتخاب تیم">
            ${store.state.teams.map((t) => `<option value="${escHtml(t.id)}" ${t.id === team.id ? 'selected' : ''}>${escHtml(t.icon || '🤖')} ${escHtml(t.name)}</option>`).join('')}
          </select>
          <button type="button" class="btn btn-sm btn-amber" id="btn-new-team">+ تیم جدید</button>
          <button type="button" class="btn btn-sm btn-ghost" id="btn-edit-team" title="ویرایش مشخصات تیم">✏️ ویرایش تیم</button>
          <button type="button" class="btn btn-sm btn-ghost" id="btn-dup-team" title="کپی گرفتن از این تیم">📋 کپی</button>
          <button type="button" class="btn btn-sm btn-danger" id="btn-del-team" title="حذف تیم" ${store.state.teams.length <= 1 ? 'disabled' : ''}>🗑️ حذف</button>
        </div>

        <div class="team-toolbar-group">
          <button type="button" class="hitl-toggle ${team.hitlPause ? 'active' : ''}" id="btn-hitl-toggle" role="switch" aria-checked="${team.hitlPause ? 'true' : 'false'}">
            <span class="hitl-dot" aria-hidden="true"></span>
            <span>توقف بین مراحل</span>
          </button>
        </div>
      </div>

      <div class="team-toolbar-row team-modes-row">
        <div class="mode-pills-bar" role="group" aria-label="حالت اجرای تیم">
          ${MODE_KEYS.map((m) => {
            const label = TEAM_MODES?.[m]?.labelFa || MODE_META[m].label;
            return `<button type="button" class="studio-mode-pill ${activeMode === m ? 'active' : ''}" data-team-mode="${m}" aria-pressed="${activeMode === m ? 'true' : 'false'}">${MODE_META[m].icon} ${escHtml(label)}</button>`;
          }).join('')}
        </div>
        ${team.description ? `<span class="team-desc-hint">${escHtml(team.description)}</span>` : ''}
      </div>
    </div>

    <div class="team-layout">
      <div class="team-graph-pane">
        <div class="roster-head">
          <span class="roster-title">اعضای تیم (${team.workers.length + 1})</span>
          <button type="button" class="btn btn-sm btn-ghost" id="btn-add-worker">+ افزودن ایجنت</button>
        </div>

        <div class="team-stage">
          <div class="t-node t-manager" id="tnode-manager">
            <div class="t-node-head">
              <div class="agent-ident">
                <span class="agent-icon-badge" aria-hidden="true">${escHtml(team.manager.icon || '👑')}</span>
                <div class="agent-titles">
                  <div class="agent-name">${escHtml(team.manager.name || 'مدیر تیم')}</div>
                  <div class="agent-role">${escHtml(team.manager.role || 'Orchestrator')}</div>
                </div>
              </div>
              <div class="agent-card-acts">
                <button type="button" class="roster-act-btn" id="btn-edit-manager" title="ویرایش مدیر" aria-label="ویرایش مدیر">✏️</button>
              </div>
            </div>
            <div class="t-node-body">
              <div class="agent-badges-row">
                <span class="agent-meta-badge ${mgrBadge.isAuto ? '' : 'assigned'}">${escHtml(mgrBadge.label)}</span>
                <span class="agent-temp-badge" title="Temperature">🌡️ ${Number(team.manager.temperature ?? 0.7).toFixed(1)}</span>
              </div>
              <div class="t-inst">${escHtml(team.manager.instructions)}</div>
            </div>
          </div>

          <div class="t-connector">↓ ${escHtml(modeInfo.flow)} ↓</div>

          <div class="t-workers-row">
            ${team.workers
              .map((w, idx) => {
                const badge = getAgentAssignmentBadge(w);
                return `
              <div class="t-node t-worker" id="tnode-${escHtml(w.id)}">
                <div class="t-node-head">
                  <div class="agent-ident">
                    <span class="agent-icon-badge" aria-hidden="true">${escHtml(w.icon || '🤖')}</span>
                    <div class="agent-titles">
                      <div class="agent-name">${escHtml(w.name || w.role)}</div>
                      <div class="agent-role">${escHtml(w.role)}</div>
                    </div>
                  </div>
                  <div class="agent-card-acts">
                    <button type="button" class="roster-act-btn" data-move-up="${escHtml(w.id)}" title="انتقال به بالا" aria-label="انتقال به بالا" ${idx === 0 ? 'disabled' : ''}>↑</button>
                    <button type="button" class="roster-act-btn" data-move-down="${escHtml(w.id)}" title="انتقال به پایین" aria-label="انتقال به پایین" ${idx === team.workers.length - 1 ? 'disabled' : ''}>↓</button>
                    <button type="button" class="roster-act-btn" data-edit-worker="${escHtml(w.id)}" title="ویرایش ایجنت" aria-label="ویرایش ایجنت">✏️</button>
                    ${team.workers.length > 1 ? `<button type="button" class="roster-act-btn danger" data-del-worker="${escHtml(w.id)}" title="حذف ایجنت" aria-label="حذف ایجنت">🗑️</button>` : ''}
                  </div>
                </div>
                <div class="t-node-body">
                  <div class="agent-badges-row">
                    <span class="agent-meta-badge ${badge.isAuto ? '' : 'assigned'}">${escHtml(badge.label)}</span>
                    <span class="agent-temp-badge" title="Temperature">🌡️ ${Number(w.temperature ?? 0.7).toFixed(1)}</span>
                  </div>
                  <div class="t-inst">${escHtml(w.instructions)}</div>
                </div>
              </div>`;
              })
              .join('')}
          </div>

          <div class="t-connector">↓ جمع‌بندی و تحویل نهایی ↓</div>

          <div class="t-node t-output" id="tnode-final">
            <div class="t-node-head"><span>✨ خروجی نهایی یکپارچه</span></div>
          </div>
        </div>
      </div>

      <div class="team-feed-pane">
        <div class="team-steps-bar" id="team-steps-bar">
          <div class="steps-chips-wrap">
            ${stepsList.map((s) => `<span class="step-chip" data-step="${escHtml(s.id)}">${escHtml(s.label)}</span>`).join('')}
          </div>
          <div class="feed-panel-toggles">
            <button type="button" class="feed-sub-btn ${activeSubPanel === 'blackboard' ? 'active' : ''}" id="btn-toggle-blackboard" aria-expanded="${activeSubPanel === 'blackboard' ? 'true' : 'false'}">
              📋 تخته سیاه <span class="sub-count" id="bb-count">0</span>
            </button>
            <button type="button" class="feed-sub-btn ${activeSubPanel === 'history' ? 'active' : ''}" id="btn-toggle-history" aria-expanded="${activeSubPanel === 'history' ? 'true' : 'false'}">
              🕘 تاریخچه <span class="sub-count" id="hist-count">${runsCount}</span>
            </button>
          </div>
        </div>

        <div class="team-subpanel ${activeSubPanel ? 'open' : ''}" id="team-subpanel"></div>

        <div class="team-feed" id="team-feed">
          <div class="empty-box" style="margin:auto">
            یک درخواست بنویس (مثلاً: <b>«یک صفحه فرود مدرن برای فروشگاه لوازم ورزشی با HTML/CSS/JS بساز»</b>) تا مراحل کار تیم را زنده ببینی و خروجی نهایی را پیش‌نمایش و دانلود کنی.
          </div>
        </div>
        <div class="team-composer">
          <textarea id="team-goal" rows="2" placeholder="درخواست خود را برای تیم ایجنت‌ها بنویسید..."></textarea>
          <button type="button" class="btn btn-amber" id="btn-run-team">🚀 اجرای تیم</button>
        </div>
      </div>
    </div>
  `;

  const feedEl = container.querySelector('#team-feed');
  const subPanelEl = container.querySelector('#team-subpanel');
  const bbBtn = container.querySelector('#btn-toggle-blackboard');
  const histBtn = container.querySelector('#btn-toggle-history');
  const bbCountEl = container.querySelector('#bb-count');
  const histCountEl = container.querySelector('#hist-count');

  const setActiveNodes = (nodeIds) => {
    container.querySelectorAll('.t-node').forEach((n) => n.classList.remove('running'));
    const list = Array.isArray(nodeIds) ? nodeIds : nodeIds ? [nodeIds] : [];
    list.forEach((id) => container.querySelector(`#${id}`)?.classList.add('running'));
  };

  const setStepStatus = (stepId, status) => {
    const el = container.querySelector(`[data-step="${stepId}"]`);
    if (!el) return;
    el.classList.remove('active', 'done');
    if (status) el.classList.add(status);
  };

  const renderSubPanel = () => {
    bbBtn.classList.toggle('active', activeSubPanel === 'blackboard');
    bbBtn.setAttribute('aria-expanded', activeSubPanel === 'blackboard' ? 'true' : 'false');
    histBtn.classList.toggle('active', activeSubPanel === 'history');
    histBtn.setAttribute('aria-expanded', activeSubPanel === 'history' ? 'true' : 'false');

    if (!activeSubPanel) {
      subPanelEl.classList.remove('open');
      subPanelEl.innerHTML = '';
      return;
    }

    subPanelEl.classList.add('open');

    if (activeSubPanel === 'blackboard') {
      subPanelEl.innerHTML = `
        <div class="subpanel-head">
          <span>📋 تخته سیاه اشتراکی (پیام‌ها و دست‌به‌دست شدن‌ها)</span>
          <button type="button" class="icon-btn subpanel-close" aria-label="بستن">×</button>
        </div>
        <div class="blackboard-list">
          ${
            blackboardEntries.length
              ? blackboardEntries
                  .map(
                    (e) => `
              <div class="bb-item ${e.kind === 'hitl' ? 'bb-hitl' : ''}">
                <div class="bb-meta">
                  <span class="bb-route">${escHtml(e.from)} ➔ ${escHtml(e.to)}</span>
                  <span class="bb-time">${escHtml(e.time)}</span>
                </div>
                <div class="bb-text">${escHtml(e.summary)}</div>
              </div>`
                  )
                  .join('')
              : `<div class="subpanel-empty">هنوز پیامی بین ایجنت‌ها ثبت نشده است. پس از اجرای تیم، handoffها اینجا نمایش داده می‌شوند.</div>`
          }
        </div>
      `;
      subPanelEl.querySelector('.subpanel-close').addEventListener('click', () => {
        activeSubPanel = null;
        renderSubPanel();
      });
      return;
    }

    const runs = store.state.teamRuns || [];
    histCountEl.textContent = String(runs.length);
    subPanelEl.innerHTML = `
      <div class="subpanel-head">
        <span>🕘 تاریخچه اجراهای تیم (${runs.length})</span>
        <button type="button" class="icon-btn subpanel-close" aria-label="بستن">×</button>
      </div>
      <div class="history-list">
        ${
          runs.length
            ? runs
                .map((r) => {
                  const mLabel = TEAM_MODES?.[r.mode]?.labelFa || MODE_META[r.mode]?.label || r.mode || '';
                  const dt = r.createdAt ? new Date(r.createdAt).toLocaleString('fa-IR') : '';
                  return `
              <div class="hist-item" data-run-id="${escHtml(r.id)}">
                <div class="hist-main">
                  <div class="hist-goal">${escHtml(r.goal || 'بدون عنوان')}</div>
                  <div class="hist-meta">${escHtml(r.teamName || '')} | ${escHtml(mLabel)} | ${escHtml(dt)}</div>
                </div>
                <div class="hist-acts">
                  <button type="button" class="btn btn-sm btn-ghost" data-load-run="${escHtml(r.id)}">نمایش</button>
                  <button type="button" class="roster-act-btn danger" data-del-run="${escHtml(r.id)}" title="حذف از تاریخچه" aria-label="حذف از تاریخچه">🗑️</button>
                </div>
              </div>`;
                })
                .join('')
            : `<div class="subpanel-empty">هنوز هیچ اجرایی در تاریخچه ذخیره نشده است.</div>`
        }
      </div>
    `;

    subPanelEl.querySelector('.subpanel-close').addEventListener('click', () => {
      activeSubPanel = null;
      renderSubPanel();
    });

    subPanelEl.querySelectorAll('[data-load-run]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const run = (store.state.teamRuns || []).find((x) => x.id === btn.dataset.loadRun);
        if (!run) return;
        feedEl.innerHTML = '';
        const card = document.createElement('details');
        card.className = 'agent-card final-card';
        card.open = true;
        card.innerHTML = `<summary><b>🕘 ${escHtml(run.teamName || 'اجرای ذخیره شده')}: ${escHtml((run.goal || '').slice(0, 60))}</b><span class="stat-pill">${escHtml(TEAM_MODES?.[run.mode]?.labelFa || run.mode || '')}</span></summary><div class="agent-card-body">${renderMarkdown(run.finalText || run.fullReportMd || '')}</div>`;
        feedEl.appendChild(card);
        attachArtifactActions(card, {
          finalHtml: run.finalHtml,
          fullReportMd: run.fullReportMd || run.finalText || '',
          finalText: run.finalText || '',
          onToast,
        });
        if (Array.isArray(run.blackboard)) {
          blackboardEntries = run.blackboard;
          bbCountEl.textContent = String(blackboardEntries.length);
        }
        activeSubPanel = null;
        renderSubPanel();
      });
    });

    subPanelEl.querySelectorAll('[data-del-run]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (store.deleteTeamRun(btn.dataset.delRun)) {
          onToast('از تاریخچه حذف شد');
          renderSubPanel();
        }
      });
    });
  };

  const postBlackboard = (from, to, summary, kind = 'handoff') => {
    const clean = String(summary || '').replace(/\s+/g, ' ').trim().slice(0, 180);
    blackboardEntries.push({
      from,
      to,
      summary: clean || 'خروجی ثبت شد',
      kind,
      time: new Date().toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    });
    bbCountEl.textContent = String(blackboardEntries.length);
    if (activeSubPanel === 'blackboard') renderSubPanel();
  };

  bbBtn.addEventListener('click', () => {
    activeSubPanel = activeSubPanel === 'blackboard' ? null : 'blackboard';
    renderSubPanel();
  });
  histBtn.addEventListener('click', () => {
    activeSubPanel = activeSubPanel === 'history' ? null : 'history';
    renderSubPanel();
  });
  renderSubPanel();

  // ─── Studio Toolbar Actions ───────────────────────────────
  container.querySelector('#team-select').addEventListener('change', (e) => {
    selectedTeamId = e.target.value;
    renderAgentTeam(container, { onToast });
  });

  container.querySelector('#btn-new-team').addEventListener('click', (e) => {
    openTeamEditorModal({
      title: 'ساخت تیم جدید',
      initial: { name: '', icon: '🚀', description: '', mode: 'manager_worker', maxRounds: 1, hitlPause: false },
      triggerEl: e.currentTarget,
      onSave: (vals) => {
        const created = store.createTeam(vals);
        selectedTeamId = created.id;
        onToast('تیم جدید ساخته شد ✓');
        renderAgentTeam(container, { onToast });
      },
    });
  });

  container.querySelector('#btn-edit-team').addEventListener('click', (e) => {
    openTeamEditorModal({
      title: 'ویرایش مشخصات تیم',
      initial: team,
      triggerEl: e.currentTarget,
      onSave: (vals) => {
        store.updateTeam(team.id, vals);
        onToast('مشخصات تیم ذخیره شد ✓');
        renderAgentTeam(container, { onToast });
      },
    });
  });

  container.querySelector('#btn-dup-team').addEventListener('click', () => {
    const copy = store.duplicateTeam(team.id);
    if (copy) {
      selectedTeamId = copy.id;
      onToast('کپی تیم ساخته شد ✓');
      renderAgentTeam(container, { onToast });
    }
  });

  container.querySelector('#btn-del-team').addEventListener('click', () => {
    if (store.state.teams.length <= 1) {
      return onToast('حداقل یک تیم باید باقی بماند');
    }
    const ok = store.deleteTeam(team.id);
    if (ok) {
      selectedTeamId = store.state.teams[0]?.id || null;
      onToast('تیم حذف شد');
      renderAgentTeam(container, { onToast });
    }
  });

  container.querySelectorAll('[data-team-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.teamMode;
      if (mode === team.mode) return;
      store.updateTeam(team.id, { mode });
      renderAgentTeam(container, { onToast });
    });
  });

  container.querySelector('#btn-hitl-toggle').addEventListener('click', () => {
    store.updateTeam(team.id, { hitlPause: !team.hitlPause });
    renderAgentTeam(container, { onToast });
  });

  // ─── Roster Actions ───────────────────────────────────────
  container.querySelector('#btn-edit-manager').addEventListener('click', (e) => {
    openAgentInspectorModal({
      title: 'ویرایش مدیر تیم',
      initial: team.manager,
      triggerEl: e.currentTarget,
      onSave: (vals) => {
        store.updateTeam(team.id, { manager: { ...team.manager, ...vals } });
        onToast('تنظیمات مدیر ذخیره شد ✓');
        renderAgentTeam(container, { onToast });
      },
    });
  });

  container.querySelector('#btn-add-worker').addEventListener('click', (e) => {
    openAgentInspectorModal({
      title: 'افزودن ایجنت جدید',
      initial: { name: '', role: '', icon: '🤖', providerId: '', model: '', keyId: '', temperature: 0.7, instructions: '' },
      triggerEl: e.currentTarget,
      onSave: (vals) => {
        store.addTeamWorker(team.id, vals);
        onToast('ایجنت جدید اضافه شد ✓');
        renderAgentTeam(container, { onToast });
      },
    });
  });

  container.querySelectorAll('[data-edit-worker]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const worker = team.workers.find((w) => w.id === btn.dataset.editWorker);
      if (!worker) return;
      openAgentInspectorModal({
        title: `ویرایش ایجنت: ${worker.name || worker.role}`,
        initial: worker,
        triggerEl: e.currentTarget,
        onSave: (vals) => {
          store.updateTeamWorker(team.id, worker.id, vals);
          onToast('تغییرات ایجنت ذخیره شد ✓');
          renderAgentTeam(container, { onToast });
        },
      });
    });
  });

  container.querySelectorAll('[data-move-up]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (store.moveTeamWorker(team.id, btn.dataset.moveUp, -1)) {
        renderAgentTeam(container, { onToast });
      }
    });
  });

  container.querySelectorAll('[data-move-down]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (store.moveTeamWorker(team.id, btn.dataset.moveDown, 1)) {
        renderAgentTeam(container, { onToast });
      }
    });
  });

  container.querySelectorAll('[data-del-worker]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (store.deleteTeamWorker(team.id, btn.dataset.delWorker)) {
        onToast('ایجنت حذف شد');
        renderAgentTeam(container, { onToast });
      }
    });
  });

  // ─── Cycle B: Live OpenBot Execution Engine ───────────────
  const runBtn = container.querySelector('#btn-run-team');

  function appendAgentCard(title, badge, { isFinal = false, parent = feedEl } = {}) {
    const card = document.createElement('details');
    card.className = `agent-card ${isFinal ? 'final-card' : ''}`;
    card.open = true;
    card.innerHTML = `<summary><b>${escHtml(title)}</b><span class="stat-pill telemetry-pill">${escHtml(badge)}</span></summary><div class="agent-card-body">▌</div>`;
    parent.appendChild(card);
    feedEl.scrollTop = feedEl.scrollHeight;
    return card;
  }

  async function executeAgentStep(agent, title, messages, { isFinal = false, parent = feedEl } = {}) {
    const card = appendAgentCard(title, 'در حال اتصال...', { isFinal, parent });
    const body = card.querySelector('.agent-card-body');
    const pill = card.querySelector('.telemetry-pill');

    const res = await callAgent(agent, messages, {
      onStream: ({ text, thinking }) => {
        body.innerHTML = formatAgentOutput(text, thinking, true);
        body.scrollTop = body.scrollHeight;
        feedEl.scrollTop = feedEl.scrollHeight;
      },
      onMeta: (meta) => {
        pill.textContent = formatTelemetry(meta);
      },
      signal: teamAbort.signal,
    });

    body.innerHTML = formatAgentOutput(res.text, res.thinking, false);
    pill.textContent = `✓ ${formatTelemetry(res)}`;
    return { res, card };
  }

  runBtn.addEventListener('click', async () => {
    if (teamAbort) {
      teamAbort.abort();
      teamAbort = null;
      runBtn.textContent = '🚀 اجرای تیم';
      setActiveNodes(null);
      return;
    }

    const goal = container.querySelector('#team-goal').value.trim();
    if (!goal) return onToast('لطفاً درخواست خود را بنویسید');

    teamAbort = new AbortController();
    runBtn.textContent = '■ توقف';
    feedEl.innerHTML = '';
    blackboardEntries = [];
    bbCountEl.textContent = '0';
    stepsList.forEach((s) => setStepStatus(s.id, null));

    let bestHtmlFound = null;
    let finalCard = null;
    let finalText = '';
    const reportSections = [`# هدف پروژه\n${goal}`];
    let hitlNote = '';

    const maybePause = async (nextLabel) => {
      if (!team.hitlPause) return { action: 'continue', feedback: '' };
      const res = await waitForHitl(nextLabel, feedEl, teamAbort.signal);
      if (res.feedback) {
        hitlNote = res.feedback;
        postBlackboard('👤 کاربر (HITL)', nextLabel, res.feedback, 'hitl');
      }
      return res;
    };

    try {
      postBlackboard('👤 کاربر', team.name, goal, 'handoff');

      if (activeMode === 'sequential') {
        // ─── Mode 2: Sequential Pipeline ─────────────────────
        const outputs = [];
        for (let i = 0; i < team.workers.length; i++) {
          const w = team.workers[i];
          if (i > 0) {
            const gate = await maybePause(w.name || w.role);
            if (gate.action === 'skip') {
              setStepStatus(w.id, 'done');
              continue;
            }
          }
          setActiveNodes(`tnode-${w.id}`);
          setStepStatus(w.id, 'active');
          const prevCtx = outputs.length
            ? `\n\nخروجی مراحل قبلی:\n${outputs.map((o) => `### ${o.role}\n${o.text}`).join('\n\n')}`
            : '';
          const guidance = hitlNote ? `\n\nراهنمایی مستقیم کاربر برای این مرحله:\n${hitlNote}` : '';
          hitlNote = '';

          const isLast = i === team.workers.length - 1;
          const { res, card } = await executeAgentStep(
            w,
            `${w.icon || '🤖'} ${w.name || w.role}`,
            [
              { role: 'system', content: `نقش تو: ${w.role}\nوظیفه: ${w.instructions}` },
              { role: 'user', content: `هدف اصلی کاربر:\n${goal}${prevCtx}${guidance}\n\nوظیفه خودت را کامل انجام بده.` },
            ],
            { isFinal: isLast }
          );
          setStepStatus(w.id, 'done');
          outputs.push({ role: w.name || w.role, text: res.text });
          reportSections.push(`## ${w.name || w.role}\n${res.text}`);
          postBlackboard(w.name || w.role, team.workers[i + 1]?.name || 'خروجی نهایی', res.text);
          const foundHtml = extractHtmlCode(res.text);
          if (foundHtml) bestHtmlFound = foundHtml;
          if (isLast) {
            finalCard = card;
            finalText = res.text;
          }
        }
      } else if (activeMode === 'parallel') {
        // ─── Mode 3: Parallel Fan-out / Fan-in ───────────────
        setActiveNodes(team.workers.map((w) => `tnode-${w.id}`));
        setStepStatus('parallel-workers', 'active');

        const grid = document.createElement('div');
        grid.className = 'parallel-grid';
        feedEl.appendChild(grid);

        const settled = await Promise.allSettled(
          team.workers.map((w) =>
            executeAgentStep(
              w,
              `${w.icon || '🤖'} ${w.name || w.role}`,
              [
                { role: 'system', content: `نقش تو: ${w.role}\nوظیفه: ${w.instructions}` },
                { role: 'user', content: `هدف اصلی کاربر:\n${goal}\n\nبه‌صورت مستقل و با دقت بالا سهم تخصصی خودت را تولید کن.` },
              ],
              { parent: grid }
            ).then((r) => ({ worker: w, res: r.res }))
          )
        );
        setStepStatus('parallel-workers', 'done');

        const workerOutputs = [];
        settled.forEach((item, idx) => {
          const w = team.workers[idx];
          if (item.status === 'fulfilled') {
            const text = item.value.res.text;
            workerOutputs.push({ role: w.name || w.role, text });
            reportSections.push(`## ${w.name || w.role}\n${text}`);
            postBlackboard(w.name || w.role, team.manager.name || 'مدیر تیم', text);
            const foundHtml = extractHtmlCode(text);
            if (foundHtml) bestHtmlFound = foundHtml;
          } else {
            const msg = item.reason?.message || 'خطا در اجرا';
            postBlackboard(w.name || w.role, team.manager.name || 'مدیر تیم', `خطا: ${msg}`);
          }
        });

        await maybePause('جمع‌بندی نهایی مدیر');
        setActiveNodes('tnode-final');
        setStepStatus('final', 'active');
        const allWork = workerOutputs.map((o) => `### ${o.role}\n${o.text}`).join('\n\n');
        const guidance = hitlNote ? `\n\nراهنمایی کاربر:\n${hitlNote}` : '';
        hitlNote = '';

        const { res, card } = await executeAgentStep(
          team.manager,
          `✨ جمع‌بندی نهایی (${team.manager.name || 'مدیر تیم'})`,
          [
            { role: 'system', content: team.manager.instructions },
            { role: 'user', content: `هدف کاربر:\n${goal}\n\nخروجی‌های موازی اعضای تیم:\n${allWork}${guidance}\n\nهمه موارد را یکپارچه کن و خروجی نهایی کامل را تحویل بده.` },
          ],
          { isFinal: true }
        );
        setStepStatus('final', 'done');
        finalCard = card;
        finalText = res.text;
        reportSections.push(`## خروجی نهایی\n${res.text}`);
        postBlackboard(team.manager.name || 'مدیر تیم', 'خروجی نهایی', res.text);
      } else if (activeMode === 'debate_review') {
        // ─── Mode 4: Debate / Critic Review Loop ─────────────
        const author = team.workers[0] || team.manager;
        const critic = team.workers[1] || team.manager;
        const rounds = Math.max(1, Number(team.maxRounds) || 1);

        setActiveNodes(author.id ? `tnode-${author.id}` : 'tnode-manager');
        setStepStatus('draft', 'active');
        const draftStep = await executeAgentStep(
          author,
          `${author.icon || '✍️'} ${author.name || author.role}: پیش‌نویس اولیه`,
          [
            { role: 'system', content: `نقش تو: ${author.role}\nوظیفه: ${author.instructions}` },
            { role: 'user', content: `هدف کاربر:\n${goal}\n\nیک پیش‌نویس کامل و باکیفیت تولید کن.` },
          ]
        );
        setStepStatus('draft', 'done');
        let currentDraft = draftStep.res.text;
        finalCard = draftStep.card;
        finalText = currentDraft;
        reportSections.push(`## پیش‌نویس اولیه (${author.name || author.role})\n${currentDraft}`);
        postBlackboard(author.name || author.role, critic.name || critic.role, currentDraft);
        const h0 = extractHtmlCode(currentDraft);
        if (h0) bestHtmlFound = h0;

        for (let r = 1; r <= rounds; r++) {
          const gateReview = await maybePause(`نقد دور ${r}`);
          if (gateReview.action === 'skip') {
            setStepStatus(`review-${r}`, 'done');
            setStepStatus(`revise-${r}`, 'done');
            continue;
          }

          setActiveNodes(critic.id ? `tnode-${critic.id}` : 'tnode-manager');
          setStepStatus(`review-${r}`, 'active');
          const guidance1 = hitlNote ? `\n\nنکته کاربر:\n${hitlNote}` : '';
          hitlNote = '';

          const reviewStep = await executeAgentStep(
            critic,
            `${critic.icon || '🔍'} ${critic.name || critic.role}: نقد دور ${r}`,
            [
              { role: 'system', content: `نقش تو: ${critic.role}\nوظیفه: ${critic.instructions}` },
              { role: 'user', content: `هدف کاربر:\n${goal}\n\nپیش‌نویس فعلی:\n${currentDraft}${guidance1}\n\nایرادات، نقاط ضعف و پیشنهادهای دقیق اصلاحی را فهرست کن.` },
            ]
          );
          setStepStatus(`review-${r}`, 'done');
          reportSections.push(`## نقد دور ${r} (${critic.name || critic.role})\n${reviewStep.res.text}`);
          postBlackboard(critic.name || critic.role, author.name || author.role, reviewStep.res.text);

          const gateRevise = await maybePause(`اصلاح دور ${r}`);
          if (gateRevise.action === 'skip') {
            setStepStatus(`revise-${r}`, 'done');
            continue;
          }

          setActiveNodes(author.id ? `tnode-${author.id}` : 'tnode-manager');
          setStepStatus(`revise-${r}`, 'active');
          const guidance2 = hitlNote ? `\n\nنکته کاربر:\n${hitlNote}` : '';
          hitlNote = '';

          const reviseStep = await executeAgentStep(
            author,
            `${author.icon || '✨'} ${author.name || author.role}: نسخه اصلاح‌شده (دور ${r})`,
            [
              { role: 'system', content: `نقش تو: ${author.role}\nوظیفه: ${author.instructions}` },
              { role: 'user', content: `هدف کاربر:\n${goal}\n\nپیش‌نویس قبلی:\n${currentDraft}\n\nنقد منتقد:\n${reviewStep.res.text}${guidance2}\n\nنسخه اصلاح‌شده و نهایی را کامل بنویس.` },
            ],
            { isFinal: r === rounds }
          );
          setStepStatus(`revise-${r}`, 'done');
          currentDraft = reviseStep.res.text;
          finalCard = reviseStep.card;
          finalText = currentDraft;
          reportSections.push(`## نسخه اصلاح‌شده دور ${r}\n${currentDraft}`);
          postBlackboard(author.name || author.role, r === rounds ? 'خروجی نهایی' : (critic.name || critic.role), currentDraft);
          const hr = extractHtmlCode(currentDraft);
          if (hr) bestHtmlFound = hr;
        }
      } else {
        // ─── Mode 1: Manager-Worker (Hierarchical) ───────────
        setActiveNodes('tnode-manager');
        setStepStatus('plan', 'active');
        const workersDesc = team.workers.map((w, i) => `${i + 1}. ${w.name || w.role} (${w.role}): ${w.instructions}`).join('\n');
        const planStep = await executeAgentStep(
          team.manager,
          `${team.manager.icon || '👑'} ${team.manager.name || 'مدیر تیم'}: برنامه‌ریزی`,
          [
            { role: 'system', content: team.manager.instructions },
            { role: 'user', content: `هدف کاربر:\n${goal}\n\nاعضای تیم:\n${workersDesc}\n\nیک برنامه کوتاه و شفاف بنویس که هر عضو دقیقاً چه کاری انجام دهد.` },
          ]
        );
        setStepStatus('plan', 'done');
        reportSections.push(`## برنامه مدیر\n${planStep.res.text}`);
        postBlackboard(team.manager.name || 'مدیر تیم', 'همه متخصص‌ها', planStep.res.text);

        const workerOutputs = [];
        for (const w of team.workers) {
          if (teamAbort.signal.aborted) break;
          const gate = await maybePause(w.name || w.role);
          if (gate.action === 'skip') {
            setStepStatus(w.id, 'done');
            continue;
          }

          setActiveNodes(`tnode-${w.id}`);
          setStepStatus(w.id, 'active');
          const prevContext = workerOutputs.length
            ? `\n\nخروجی اعضای قبلی تیم:\n${workerOutputs.map((o) => `### ${o.role}\n${o.text}`).join('\n\n')}`
            : '';
          const guidance = hitlNote ? `\n\nراهنمایی کاربر:\n${hitlNote}` : '';
          hitlNote = '';

          const wStep = await executeAgentStep(
            w,
            `${w.icon || '🤖'} ${w.name || w.role}`,
            [
              { role: 'system', content: `نقش تو: ${w.role}\nوظیفه: ${w.instructions}` },
              { role: 'user', content: `هدف اصلی کاربر:\n${goal}\n\nبرنامه مدیر:\n${planStep.res.text}${prevContext}${guidance}\n\nحالا وظیفه خودت را با دقت بالا انجام بده.` },
            ]
          );
          setStepStatus(w.id, 'done');
          workerOutputs.push({ role: w.name || w.role, text: wStep.res.text });
          reportSections.push(`## ${w.name || w.role}\n${wStep.res.text}`);
          postBlackboard(w.name || w.role, team.manager.name || 'مدیر تیم', wStep.res.text);
          const foundHtml = extractHtmlCode(wStep.res.text);
          if (foundHtml) bestHtmlFound = foundHtml;
        }

        await maybePause('خروجی نهایی یکپارچه');
        setActiveNodes('tnode-final');
        setStepStatus('final', 'active');
        const allWork = workerOutputs.map((o) => `### ${o.role}\n${o.text}`).join('\n\n');
        const guidance = hitlNote ? `\n\nراهنمایی کاربر:\n${hitlNote}` : '';
        hitlNote = '';

        const synthStep = await executeAgentStep(
          team.manager,
          '✨ خروجی نهایی یکپارچه (مدیر تیم)',
          [
            { role: 'system', content: team.manager.instructions },
            { role: 'user', content: `هدف کاربر:\n${goal}\n\nخروجی اعضای تیم:\n${allWork}${guidance}\n\nهمه موارد را یکپارچه کن و خروجی نهایی کامل و آماده استفاده را تحویل بده. اگر پروژه وب است، کل کد HTML/CSS/JS را در یک بلوک \`\`\`html واحد قرار بده.` },
          ],
          { isFinal: true }
        );
        setStepStatus('final', 'done');
        finalCard = synthStep.card;
        finalText = synthStep.res.text;
        reportSections.push(`## خروجی نهایی\n${finalText}`);
        postBlackboard(team.manager.name || 'مدیر تیم', 'خروجی نهایی', finalText);
      }

      const finalHtml = extractHtmlCode(finalText) || bestHtmlFound;
      const fullReportMd = reportSections.join('\n\n');

      store.state.lastTeamRun = { goal, fullReportMd, finalHtml: finalHtml || null, ts: Date.now() };
      store.addTeamRun({
        teamId: team.id,
        teamName: team.name,
        mode: activeMode,
        goal,
        finalText,
        finalHtml: finalHtml || null,
        fullReportMd,
        blackboard: [...blackboardEntries],
      });
      histCountEl.textContent = String((store.state.teamRuns || []).length);
      if (activeSubPanel === 'history') renderSubPanel();

      if (finalCard) {
        attachArtifactActions(finalCard, { finalHtml, fullReportMd, finalText, onToast });
      }
      feedEl.scrollTop = feedEl.scrollHeight;
    } catch (err) {
      if (err.name !== 'AbortError') {
        const errCard = appendAgentCard('❌ خطا در اجرای تیم', 'متوقف شد');
        errCard.querySelector('.agent-card-body').innerHTML = `<span style="color:var(--danger)">${escHtml(err.message)}</span>`;
      }
    } finally {
      setActiveNodes(null);
      teamAbort = null;
      runBtn.textContent = '🚀 اجرای تیم';
    }
  });
}
