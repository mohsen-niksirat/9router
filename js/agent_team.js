/**
 * OpenBot-Style Multi-Agent Team Studio (Builder + Orchestrator)
 * Cycle A: Studio Toolbar, Execution Modes, HITL Toggle, Visual Roster, Agent & Team Inspector Modals.
 */

import { store, TEAM_MODES } from './store.js';
import { escHtml, renderMarkdown } from './markdown.js';
import { runChatCompletion } from './router.js';

let selectedTeamId = null;
let teamAbort = null;
let activeModalCleanup = null;

const AGENT_ICONS = ['🤖', '👑', '🧠', '🎨', '💻', '🔍', '✍️', '📊', '🛡️', '⚡', '🧪', '🏗️', '📝', '🎯', '🌐', '🔧'];
const TEAM_ICONS = ['🚀', '🌐', '🔬', '🛡️', '✍️', '🤖', '⚡', '🎯', '🧠', '💡', '📊', '🎨'];

const MODE_KEYS = ['manager_worker', 'sequential', 'parallel', 'debate_review'];
const MODE_META = {
  manager_worker: { icon: '👑', label: 'مدیر-متخصص', flow: 'تقسیم وظایف و هماهنگی' },
  sequential: { icon: '⛓️', label: 'ترتیبی', flow: 'اجرای زنجیره‌ای مرحله به مرحله' },
  parallel: { icon: '⚡', label: 'موازی', flow: 'اجرای همزمان متخصص‌ها' },
  debate_review: { icon: '🔄', label: 'نقد و بازبینی', flow: 'چاپ اولیه، نقد و اصلاح' },
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

async function callAgent(providerId, messages, onStream, signal) {
  const prevTarget = store.state.activeTarget;
  try {
    const chosenProv =
      store.state.providers.find((p) => p.id === providerId && p.keys.some((k) => k.status !== 'dead')) ||
      store.state.providers.find((p) => p.keys.some((k) => k.status !== 'dead'));
    if (!chosenProv) {
      throw new Error('هیچ کلید API فعالی پیدا نشد. ابتدا از بخش «ارائه‌دهنده‌ها و کلیدها» یک کلید اضافه کنید.');
    }
    store.state.activeTarget = { type: 'provider', id: chosenProv.id };
    return await runChatCompletion({ messages, onStream, signal });
  } finally {
    store.state.activeTarget = prevTarget;
  }
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

  const stepsList = [
    { id: 'plan', label: '① برنامه‌ریزی مدیر' },
    ...team.workers.map((w, i) => ({ id: w.id, label: `${i + 2}. ${w.name || w.role}` })),
    { id: 'final', label: '✨ خروجی نهایی' },
  ];

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
          ${stepsList.map((s) => `<span class="step-chip" data-step="${escHtml(s.id)}">${escHtml(s.label)}</span>`).join('')}
        </div>
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

  const setActiveNode = (nodeId) => {
    container.querySelectorAll('.t-node').forEach((n) => n.classList.remove('running'));
    if (nodeId) container.querySelector(`#${nodeId}`)?.classList.add('running');
  };

  const setStepStatus = (stepId, status) => {
    const el = container.querySelector(`[data-step="${stepId}"]`);
    if (!el) return;
    el.classList.remove('active', 'done');
    if (status) el.classList.add(status);
  };

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

  // ─── Existing Run Engine (Overhauled in Cycle B) ──────────
  const runBtn = container.querySelector('#btn-run-team');
  const feedEl = container.querySelector('#team-feed');

  function appendAgentCard(title, badge, isFinal = false) {
    const card = document.createElement('details');
    card.className = `agent-card ${isFinal ? 'final-card' : ''}`;
    card.open = true;
    card.innerHTML = `<summary><b>${escHtml(title)}</b><span class="stat-pill">${escHtml(badge)}</span></summary><div class="agent-card-body">▌</div>`;
    feedEl.appendChild(card);
    feedEl.scrollTop = feedEl.scrollHeight;
    return card;
  }

  runBtn.addEventListener('click', async () => {
    if (teamAbort) {
      teamAbort.abort();
      teamAbort = null;
      runBtn.textContent = '🚀 اجرای تیم';
      setActiveNode(null);
      return;
    }

    const goal = container.querySelector('#team-goal').value.trim();
    if (!goal) return onToast('لطفاً درخواست خود را بنویسید');

    teamAbort = new AbortController();
    runBtn.textContent = '■ توقف';
    feedEl.innerHTML = '';
    stepsList.forEach((s) => setStepStatus(s.id, null));

    let bestHtmlFound = null;

    try {
      // Phase 1: Manager Plan
      setActiveNode('tnode-manager');
      setStepStatus('plan', 'active');
      const mgrCard = appendAgentCard(`${team.manager.icon || '👑'} ${team.manager.name || 'مدیر تیم'}: برنامه‌ریزی`, 'در حال نوشتن...');
      const mgrBody = mgrCard.querySelector('.agent-card-body');
      const workersDesc = team.workers.map((w, i) => `${i + 1}. ${w.name || w.role} (${w.role}): ${w.instructions}`).join('\n');

      const planRes = await callAgent(
        team.manager.providerId,
        [
          { role: 'system', content: team.manager.instructions },
          { role: 'user', content: `هدف کاربر:\n${goal}\n\nاعضای تیم:\n${workersDesc}\n\nیک برنامه کوتاه و شفاف بنویس که هر عضو دقیقاً چه کاری انجام دهد.` },
        ],
        ({ text, thinking }) => { mgrBody.innerHTML = formatAgentOutput(text, thinking, true); mgrBody.scrollTop = mgrBody.scrollHeight; },
        teamAbort.signal
      );
      mgrBody.innerHTML = formatAgentOutput(planRes.text, planRes.thinking, false);
      mgrCard.querySelector('.stat-pill').textContent = `✓ ${planRes.provider} / ${planRes.model}`;
      setStepStatus('plan', 'done');

      // Phase 2: Workers execute
      const workerOutputs = [];
      for (const w of team.workers) {
        if (teamAbort.signal.aborted) break;
        setActiveNode(`tnode-${w.id}`);
        setStepStatus(w.id, 'active');
        const wCard = appendAgentCard(`${w.icon || '🤖'} ${w.name || w.role}`, 'در حال نوشتن...');
        const wBody = wCard.querySelector('.agent-card-body');

        const prevContext = workerOutputs.length
          ? `\n\nخروجی اعضای قبلی تیم:\n${workerOutputs.map((o) => `### ${o.role}\n${o.text}`).join('\n\n')}`
          : '';

        const wRes = await callAgent(
          w.providerId,
          [
            { role: 'system', content: `نقش تو: ${w.role}\nوظیفه: ${w.instructions}` },
            { role: 'user', content: `هدف اصلی کاربر:\n${goal}\n\nبرنامه مدیر:\n${planRes.text}${prevContext}\n\nحالا وظیفه خودت را با دقت بالا انجام بده.` },
          ],
          ({ text, thinking }) => { wBody.innerHTML = formatAgentOutput(text, thinking, true); wBody.scrollTop = wBody.scrollHeight; feedEl.scrollTop = feedEl.scrollHeight; },
          teamAbort.signal
        );
        wBody.innerHTML = formatAgentOutput(wRes.text, wRes.thinking, false);
        wCard.querySelector('.stat-pill').textContent = `✓ ${wRes.provider} / ${wRes.model}`;
        setStepStatus(w.id, 'done');
        workerOutputs.push({ role: w.name || w.role, text: wRes.text });
        const foundHtml = extractHtmlCode(wRes.text);
        if (foundHtml) bestHtmlFound = foundHtml;
      }

      // Phase 3: Manager Final Synthesis
      setActiveNode('tnode-final');
      setStepStatus('final', 'active');
      const finalCard = appendAgentCard('✨ خروجی نهایی یکپارچه (مدیر تیم)', 'در حال جمع‌بندی...', true);
      const finalBody = finalCard.querySelector('.agent-card-body');
      const allWork = workerOutputs.map((o) => `### ${o.role}\n${o.text}`).join('\n\n');

      const finalRes = await callAgent(
        team.manager.providerId,
        [
          { role: 'system', content: team.manager.instructions },
          { role: 'user', content: `هدف کاربر:\n${goal}\n\nخروجی اعضای تیم:\n${allWork}\n\nهمه موارد را یکپارچه کن و خروجی نهایی کامل و آماده استفاده را تحویل بده. اگر پروژه وب است، کل کد HTML/CSS/JS را در یک بلوک \`\`\`html واحد قرار بده.` },
        ],
        ({ text, thinking }) => { finalBody.innerHTML = formatAgentOutput(text, thinking, true); finalBody.scrollTop = finalBody.scrollHeight; feedEl.scrollTop = feedEl.scrollHeight; },
        teamAbort.signal
      );
      finalBody.innerHTML = formatAgentOutput(finalRes.text, finalRes.thinking, false);
      finalCard.querySelector('.stat-pill').textContent = `✓ ${finalRes.provider} / ${finalRes.model}`;
      setStepStatus('final', 'done');

      const finalHtml = extractHtmlCode(finalRes.text) || bestHtmlFound;
      const fullReportMd = `# هدف پروژه\n${goal}\n\n## برنامه مدیر\n${planRes.text}\n\n${workerOutputs.map((o) => `## ${o.role}\n${o.text}`).join('\n\n')}\n\n## خروجی نهایی\n${finalRes.text}`;

      store.state.lastTeamRun = { goal, fullReportMd, finalHtml: finalHtml || null, ts: Date.now() };
      store.save();

      const acts = document.createElement('div');
      acts.className = 'final-actions';
      acts.innerHTML = `
        ${finalHtml ? '<button type="button" class="btn btn-amber btn-sm" id="btn-live-preview">👁️ پیش‌نمایش زنده سایت</button>' : ''}
        ${finalHtml ? '<button type="button" class="btn btn-ok btn-sm" id="btn-dl-html">⬇️ دانلود index.html</button>' : ''}
        <button type="button" class="btn btn-ghost btn-sm" id="btn-dl-md">📄 دانلود کل گزارش (.md)</button>
        <button type="button" class="btn btn-ghost btn-sm" id="btn-copy-final">📋 کپی خروجی</button>
      `;
      finalCard.appendChild(acts);
      acts.querySelector('#btn-live-preview')?.addEventListener('click', () => window.__openHtmlPreview?.(finalHtml));
      acts.querySelector('#btn-dl-html')?.addEventListener('click', () => {
        const blob = new Blob([finalHtml], { type: 'text/html;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'index.html';
        a.click();
      });
      acts.querySelector('#btn-dl-md')?.addEventListener('click', () => {
        const blob = new Blob([fullReportMd], { type: 'text/markdown;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `9router-team-output-${Date.now()}.md`;
        a.click();
      });
      acts.querySelector('#btn-copy-final')?.addEventListener('click', () => {
        navigator.clipboard.writeText(finalHtml || finalRes.text).then(() => onToast('کپی شد ✓'));
      });
      feedEl.scrollTop = feedEl.scrollHeight;
    } catch (err) {
      if (err.name !== 'AbortError') {
        const errCard = appendAgentCard('❌ خطا در اجرای تیم', 'متوقف شد');
        errCard.querySelector('.agent-card-body').innerHTML = `<span style="color:var(--danger)">${escHtml(err.message)}</span>`;
      }
    } finally {
      setActiveNode(null);
      teamAbort = null;
      runBtn.textContent = '🚀 اجرای تیم';
    }
  });
}
