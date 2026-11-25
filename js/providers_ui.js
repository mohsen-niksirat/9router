/**
 * Unified Providers & Keys Hub (inspired by api-key-manager).
 * Card grid with inline masked keys, pin toggle, search, filter pills, and 1-click key management.
 */

import { store, maskKey } from './store.js';
import { escHtml } from './markdown.js';

let activeFilter = 'all';
let searchQuery = '';

export function renderProvidersHub(container, { onToast, onSelectForChat }) {
  const all = store.state.providers;

  const filtered = all
    .filter((p) => {
      if (activeFilter === 'pinned') return p.pinned;
      if (activeFilter === 'with_keys') return p.keys.length > 0;
      if (activeFilter === 'no_keys') return p.keys.length === 0;
      if (activeFilter === 'custom') return !p.isBuiltin;
      return true;
    })
    .filter((p) => {
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return (
        p.name.toLowerCase().includes(q) ||
        p.baseUrl.toLowerCase().includes(q) ||
        p.models.some((m) => m.toLowerCase().includes(q))
      );
    })
    .sort((a, b) => Number(b.pinned) - Number(a.pinned));

  const filterPills = [
    ['all', 'همه'],
    ['pinned', 'پین‌شده'],
    ['with_keys', 'دارای کلید'],
    ['no_keys', 'بدون کلید'],
    ['custom', 'سفارشی'],
  ];

  container.innerHTML = `
    <div class="hub-head">
      <div>
        <h2>ارائه‌دهنده‌ها و کلیدهای API</h2>
        <p class="muted">تمام کلیدها به‌صورت محلی در مرورگر شما ذخیره می‌شوند و مستقیم به ارائه‌دهنده ارسال می‌گردند.</p>
      </div>
      <div class="hub-actions">
        <input class="hub-search" id="prov-search" placeholder="جستجوی ارائه‌دهنده یا مدل..." value="${escHtml(searchQuery)}">
        <button class="btn btn-amber" id="btn-open-add-prov">+ افزودن ارائه‌دهنده</button>
      </div>
    </div>

    <div class="filter-bar">
      ${filterPills
        .map(([k, lbl]) => `<button class="filter-pill ${activeFilter === k ? 'active' : ''}" data-filter="${k}">${lbl}</button>`)
        .join('')}
    </div>

    <div class="prov-grid">
      ${filtered
        .map((p) => {
          const activeCount = p.keys.filter((k) => k.status === 'active').length;
          const letter = (p.name || 'A')[0].toUpperCase();
          const shownModels = p.models.slice(0, 3);
          const extraCount = Math.max(0, p.models.length - 3);
          const keysHtml = p.noKey
            ? `<div class="local-help-note">سرور محلی بدون نیاز به کلید API. برای دسترسی از مرورگر در Ollama متغیر <code dir="ltr">OLLAMA_ORIGINS=*</code> را تنظیم کنید و توجه داشته باشید مرورگرها از صفحه HTTPS به سرور HTTP محلی محدودیت Mixed Content دارند.</div>`
            : p.keys.length
            ? p.keys
                .map(
                  (k) => `
                  <div class="key-line">
                    <span class="key-mask" title="${escHtml(k.label)}">${escHtml(maskKey(k.value))}</span>
                    <div class="key-line-acts">
                      <span class="dot-status ${k.status}" title="${k.status}"></span>
                      ${k.status !== 'active' ? `<button class="mini-btn" data-reset-key="${p.id}:${k.id}" title="فعال‌سازی مجدد">↻</button>` : ''}
                      <button class="mini-btn danger" data-del-key="${p.id}:${k.id}" title="حذف کلید">×</button>
                    </div>
                  </div>`
                )
                .join('')
            : `<div class="no-keys-tag">هنوز کلیدی اضافه نشده</div>`;

          return `
            <div class="prov-card">
              <div class="prov-card-top">
                <div class="prov-id">
                  <div class="prov-badge" style="background:${escHtml(p.color || '#6366f1')}">${escHtml(letter)}</div>
                  <div class="prov-titles">
                    <div class="prov-name">${escHtml(p.name)} ${p.noKey ? '<span class="local-badge">محلی / بدون کلید</span>' : ''} ${p.supportsImages ? '<span class="img-cap" title="پشتیبانی از تولید/ویرایش تصویر">🎨</span>' : ''}</div>
                    <div class="prov-url" title="${escHtml(p.baseUrl)}">${escHtml(p.baseUrl)}</div>
                  </div>
                </div>
                <button class="pin-btn ${p.pinned ? 'pinned' : ''}" data-pin="${p.id}" title="پین">📌</button>
              </div>

              <div class="model-tags">
                ${shownModels.map((m) => `<span class="m-tag ${m === p.defaultModel ? 'def' : ''}" data-set-def="${p.id}::${escHtml(m)}" title="کلیک برای انتخاب به عنوان پیش‌فرض">${escHtml(m)}</span>`).join('')}
                ${extraCount > 0 ? `<span class="m-tag more" data-edit-prov="${p.id}" title="مشاهده و ویرایش همه مدل‌ها">+${extraCount}</span>` : ''}
                <button class="m-tag" type="button" data-quick-add-model="${p.id}" title="افزودن سریع مدل جدید">+ مدل</button>
              </div>

              <div class="key-stats">
                ${p.noKey
                  ? '<span class="stat-pill green">محلی / بدون کلید</span>'
                  : `<span class="stat-pill ${activeCount > 0 ? 'green' : ''}">${activeCount} فعال</span><span class="stat-pill">کل: ${p.keys.length}</span>`}
              </div>

              <div class="keys-stack">${keysHtml}</div>

              <div class="prov-card-foot">
                <button class="btn btn-sm btn-ghost" data-add-key="${p.id}">+ کلید جدید</button>
                <button class="btn btn-sm btn-ghost" data-edit-prov="${p.id}">✏️ ویرایش</button>
                <button class="btn btn-sm btn-ghost" data-chat-prov="${p.id}">💬 چت مستقیم</button>
                ${!p.isBuiltin ? `<button class="btn btn-sm btn-danger" data-del-prov="${p.id}">حذف</button>` : ''}
              </div>
            </div>`;
        })
        .join('')}
    </div>
  `;

  // Wire events
  container.querySelector('#prov-search')?.addEventListener('input', (e) => {
    searchQuery = e.target.value;
    renderProvidersHub(container, { onToast, onSelectForChat });
    const inp = container.querySelector('#prov-search');
    if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
  });

  container.querySelectorAll('[data-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeFilter = btn.dataset.filter;
      renderProvidersHub(container, { onToast, onSelectForChat });
    });
  });

  container.querySelector('#btn-open-add-prov')?.addEventListener('click', () => {
    window.__openAddProviderModal?.();
  });

  container.querySelectorAll('[data-pin]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const p = store.state.providers.find((x) => x.id === btn.dataset.pin);
      if (p) store.updateProvider(p.id, { pinned: !p.pinned });
      renderProvidersHub(container, { onToast, onSelectForChat });
    });
  });

  container.querySelectorAll('[data-set-def]').forEach((el) => {
    el.addEventListener('click', () => {
      const [pid, model] = el.dataset.setDef.split('::');
      store.updateProvider(pid, { defaultModel: model });
      onToast(`مدل پیش‌فرض روی ${model} تنظیم شد`);
      renderProvidersHub(container, { onToast, onSelectForChat });
    });
  });

  container.querySelectorAll('[data-add-key]').forEach((btn) => {
    btn.addEventListener('click', () => {
      window.__openAddKeyModal?.(btn.dataset.addKey);
    });
  });

  container.querySelectorAll('[data-edit-prov]').forEach((btn) => {
    btn.addEventListener('click', () => {
      window.__openEditProviderModal?.(btn.dataset.editProv);
    });
  });

  container.querySelectorAll('[data-quick-add-model]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const p = store.state.providers.find((x) => x.id === btn.dataset.quickAddModel);
      if (!p) return;
      const model = window.prompt(`نام مدل جدید برای ${p.name}:`, '');
      if (!model || !model.trim()) return;
      store.updateProvider(p.id, { models: [...(p.models || []), model.trim()] });
      onToast(`مدل ${model.trim()} اضافه شد`);
      renderProvidersHub(container, { onToast, onSelectForChat });
    });
  });

  container.querySelectorAll('[data-del-key]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const [pid, kid] = btn.dataset.delKey.split(':');
      store.deleteKey(pid, kid);
      onToast('کلید حذف شد');
      renderProvidersHub(container, { onToast, onSelectForChat });
    });
  });

  container.querySelectorAll('[data-reset-key]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const [pid, kid] = btn.dataset.resetKey.split(':');
      store.resetKey(pid, kid);
      onToast('کلید مجدداً فعال شد');
      renderProvidersHub(container, { onToast, onSelectForChat });
    });
  });

  container.querySelectorAll('[data-del-prov]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!confirm('این ارائه‌دهنده و کلیدهایش حذف شوند؟')) return;
      store.deleteProvider(btn.dataset.delProv);
      onToast('ارائه‌دهنده حذف شد');
      renderProvidersHub(container, { onToast, onSelectForChat });
    });
  });

  container.querySelectorAll('[data-chat-prov]').forEach((btn) => {
    btn.addEventListener('click', () => {
      onSelectForChat?.({ type: 'provider', id: btn.dataset.chatProv });
    });
  });
}
