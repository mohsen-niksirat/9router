/**
 * 9Router Web — Usage & Cost Analytics (Part B)
 * Pure usage aggregation + Persian Analytics UI (zero external dependencies).
 */

import { escHtml } from './markdown.js';

const MS_PER_DAY = 86_400_000;

function formatNumber(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '0';
  return Math.round(num).toLocaleString('en-US');
}

function formatCost(cost) {
  if (cost === null || cost === undefined || !Number.isFinite(Number(cost))) {
    return '—';
  }
  const num = Number(cost);
  if (num === 0) return '$0.00';
  if (num < 0.01) return `$${num.toFixed(4)}`;
  if (num < 1) return `$${num.toFixed(3)}`;
  return `$${num.toFixed(2)}`;
}

function toLocalDateKey(ts) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function toShortDateLabel(ts) {
  const d = new Date(ts);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${m}/${day}`;
}

/**
 * Pure aggregation over usage events for a given period and price table.
 *
 * @param {Array<object>} events
 * @param {Record<string, { inPer1M: number, outPer1M: number }>} prices
 * @param {'today'|'7d'|'30d'} [period='7d']
 * @param {number} [now=Date.now()]
 */
export function aggregateUsage(events = [], prices = {}, period = '7d', now = Date.now()) {
  const nowTs = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  const normalizedPeriod = period === 'today' || period === '30d' ? period : '7d';

  const startOfToday = new Date(nowTs);
  startOfToday.setHours(0, 0, 0, 0);

  let cutoff;
  let dayCount;
  if (normalizedPeriod === 'today') {
    cutoff = startOfToday.getTime();
    dayCount = 1;
  } else if (normalizedPeriod === '30d') {
    cutoff = nowTs - 30 * MS_PER_DAY;
    dayCount = 30;
  } else {
    cutoff = nowTs - 7 * MS_PER_DAY;
    dayCount = 7;
  }

  const dayBuckets = new Map();
  for (let i = dayCount - 1; i >= 0; i -= 1) {
    const dayTs = startOfToday.getTime() - i * MS_PER_DAY;
    const key = toLocalDateKey(dayTs);
    dayBuckets.set(key, {
      date: key,
      label: toShortDateLabel(dayTs),
      requests: 0,
      totalTokens: 0,
      costSum: 0,
      hasPriced: false,
    });
  }

  const providerMap = new Map();
  const modelMap = new Map();

  let totalRequests = 0;
  let totalTokensIn = 0;
  let totalTokensOut = 0;
  let totalTokens = 0;
  let totalCostSum = 0;
  let hasAnyPriced = false;

  const list = Array.isArray(events) ? events : [];
  const priceTable = prices && typeof prices === 'object' ? prices : {};

  for (const ev of list) {
    if (!ev || typeof ev !== 'object') continue;
    const ts = Number(ev.ts);
    if (!Number.isFinite(ts) || ts < cutoff || ts > nowTs) continue;

    const tokensIn = Math.max(0, Number(ev.tokensIn) || 0);
    const tokensOut = Math.max(0, Number(ev.tokensOut) || 0);
    const evTotal = Math.max(0, Number(ev.totalTokens) || tokensIn + tokensOut);

    const providerId = String(ev.providerId || 'unknown');
    const providerName = String(ev.providerName || providerId);
    const model = String(ev.model || 'unknown');
    const priceKey = `${providerId}|${model}`;
    const price = priceTable[priceKey];

    const hasPrice = Boolean(
      price &&
        Number.isFinite(Number(price.inPer1M)) &&
        Number.isFinite(Number(price.outPer1M))
    );
    const evCost = hasPrice
      ? (tokensIn / 1e6) * Number(price.inPer1M) + (tokensOut / 1e6) * Number(price.outPer1M)
      : null;

    totalRequests += 1;
    totalTokensIn += tokensIn;
    totalTokensOut += tokensOut;
    totalTokens += evTotal;
    if (hasPrice) {
      hasAnyPriced = true;
      totalCostSum += evCost;
    }

    // Per-provider aggregation
    let prov = providerMap.get(providerId);
    if (!prov) {
      prov = {
        providerId,
        providerName,
        requests: 0,
        tokensIn: 0,
        tokensOut: 0,
        totalTokens: 0,
        costSum: 0,
        hasPriced: false,
      };
      providerMap.set(providerId, prov);
    }
    prov.requests += 1;
    prov.tokensIn += tokensIn;
    prov.tokensOut += tokensOut;
    prov.totalTokens += evTotal;
    if (hasPrice) {
      prov.hasPriced = true;
      prov.costSum += evCost;
    }

    // Per-model aggregation
    let mod = modelMap.get(priceKey);
    if (!mod) {
      mod = {
        key: priceKey,
        providerId,
        providerName,
        model,
        requests: 0,
        tokensIn: 0,
        tokensOut: 0,
        totalTokens: 0,
        costSum: 0,
        hasPriced: false,
      };
      modelMap.set(priceKey, mod);
    }
    mod.requests += 1;
    mod.tokensIn += tokensIn;
    mod.tokensOut += tokensOut;
    mod.totalTokens += evTotal;
    if (hasPrice) {
      mod.hasPriced = true;
      mod.costSum += evCost;
    }

    // Per-day bucket
    const dayKey = toLocalDateKey(ts);
    const bucket = dayBuckets.get(dayKey);
    if (bucket) {
      bucket.requests += 1;
      bucket.totalTokens += evTotal;
      if (hasPrice) {
        bucket.hasPriced = true;
        bucket.costSum += evCost;
      }
    }
  }

  const byProvider = Array.from(providerMap.values())
    .map((p) => ({
      providerId: p.providerId,
      providerName: p.providerName,
      requests: p.requests,
      tokensIn: p.tokensIn,
      tokensOut: p.tokensOut,
      totalTokens: p.totalTokens,
      cost: p.hasPriced ? p.costSum : null,
      sharePct: totalTokens > 0 ? Math.round((p.totalTokens / totalTokens) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.totalTokens - a.totalTokens || b.requests - a.requests);

  const byModel = Array.from(modelMap.values())
    .map((m) => ({
      key: m.key,
      providerId: m.providerId,
      providerName: m.providerName,
      model: m.model,
      requests: m.requests,
      tokensIn: m.tokensIn,
      tokensOut: m.tokensOut,
      totalTokens: m.totalTokens,
      cost: m.hasPriced ? m.costSum : null,
      sharePct: totalTokens > 0 ? Math.round((m.totalTokens / totalTokens) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.totalTokens - a.totalTokens || b.requests - a.requests);

  const byDay = Array.from(dayBuckets.values()).map((d) => ({
    date: d.date,
    label: d.label,
    requests: d.requests,
    totalTokens: d.totalTokens,
    cost: d.hasPriced ? d.costSum : null,
  }));

  return {
    period: normalizedPeriod,
    totalRequests,
    totalTokensIn,
    totalTokensOut,
    totalTokens,
    totalCost: hasAnyPriced ? totalCostSum : null,
    hasAnyPriced,
    byProvider,
    byModel,
    byDay,
  };
}

let activePeriod = '7d';

function savePriceToStore(store, providerId, model, inPer1M, outPer1M) {
  const key = `${providerId}|${model}`;
  if (typeof store?.setModelPrice === 'function') {
    if (store.setModelPrice.length >= 3) {
      store.setModelPrice(providerId, model, { inPer1M, outPer1M });
    } else {
      store.setModelPrice(key, { inPer1M, outPer1M });
    }
  }
}

function deletePriceFromStore(store, key) {
  if (typeof store?.deleteModelPrice === 'function') {
    if (store.deleteModelPrice.length >= 2) {
      const [providerId, ...rest] = key.split('|');
      store.deleteModelPrice(providerId, rest.join('|'));
    } else {
      store.deleteModelPrice(key);
    }
  }
}

/**
 * Render the Persian Usage & Cost Analytics view into containerEl.
 * Uses event delegation (zero inline onclick) and escapes all dynamic values.
 */
export function renderAnalyticsView(containerEl, store) {
  if (!containerEl) return;

  const events = store?.state?.usageEvents || [];
  const prices = store?.state?.modelPrices || {};
  const providers = store?.state?.providers || [];

  const agg = aggregateUsage(events, prices, activePeriod);
  const maxDayTokens = Math.max(1, ...agg.byDay.map((d) => d.totalTokens));

  const providerNameById = new Map(providers.map((p) => [p.id, p.name]));

  const periods = [
    ['today', 'امروز'],
    ['7d', '۷ روز'],
    ['30d', '۳۰ روز'],
  ];

  const barHtml = agg.byDay
    .map((d) => {
      const pct = d.totalTokens > 0 ? Math.max(4, Math.round((d.totalTokens / maxDayTokens) * 100)) : 0;
      const tip = `${d.date} — ${formatNumber(d.requests)} درخواست، ${formatNumber(d.totalTokens)} توکن، هزینه: ${formatCost(d.cost)}`;
      return `
        <div class="analytics-bar-col" title="${escHtml(tip)}">
          <div class="analytics-bar-track">
            <div class="analytics-bar" style="height:${pct}%"></div>
          </div>
          <span class="analytics-bar-label">${escHtml(d.label)}</span>
        </div>`;
    })
    .join('');

  const providerRows = agg.byProvider
    .map(
      (p) => `
      <tr>
        <td>${escHtml(providerNameById.get(p.providerId) || p.providerName)}</td>
        <td dir="ltr">${formatNumber(p.requests)}</td>
        <td dir="ltr">${formatNumber(p.totalTokens)}</td>
        <td dir="ltr">${p.sharePct}%</td>
        <td dir="ltr">${escHtml(formatCost(p.cost))}</td>
      </tr>`
    )
    .join('');

  const modelRows = agg.byModel
    .map(
      (m) => `
      <tr>
        <td dir="ltr"><code>${escHtml(m.model)}</code></td>
        <td>${escHtml(providerNameById.get(m.providerId) || m.providerName)}</td>
        <td dir="ltr">${formatNumber(m.requests)}</td>
        <td dir="ltr">${formatNumber(m.totalTokens)}</td>
        <td dir="ltr">${m.sharePct}%</td>
        <td dir="ltr">${escHtml(formatCost(m.cost))}</td>
      </tr>`
    )
    .join('');

  const priceEntries = Object.entries(prices).sort(([a], [b]) => a.localeCompare(b));
  const priceRows = priceEntries
    .map(([key, val]) => {
      const [provId, ...modelParts] = key.split('|');
      const modelName = modelParts.join('|');
      const provLabel = providerNameById.get(provId) || provId;
      return `
      <tr>
        <td>${escHtml(provLabel)}</td>
        <td dir="ltr"><code>${escHtml(modelName)}</code></td>
        <td dir="ltr">$${Number(val?.inPer1M || 0).toFixed(3)}</td>
        <td dir="ltr">$${Number(val?.outPer1M || 0).toFixed(3)}</td>
        <td class="analytics-price-acts">
          <button type="button" class="mini-btn" data-price-edit="${escHtml(key)}" title="ویرایش">✎</button>
          <button type="button" class="mini-btn danger" data-price-del="${escHtml(key)}" title="حذف">×</button>
        </td>
      </tr>`;
    })
    .join('');

  const providerOptions = providers
    .map((p) => `<option value="${escHtml(p.id)}">${escHtml(p.name)}</option>`)
    .join('');

  const bodyHtml =
    agg.totalRequests === 0
      ? `
      <div class="analytics-empty">
        <div class="analytics-empty-icon">📊</div>
        <h3>هنوز مصرفی در این بازه ثبت نشده است</h3>
        <p class="muted">پس از ارسال اولین پیام در گفتگو، آرنا یا تیم ایجنت‌ها، آمار توکن و برآورد هزینه اینجا نمایش داده می‌شود.</p>
      </div>`
      : `
      <div class="analytics-cards">
        <div class="analytics-card">
          <span class="analytics-card-label">تعداد درخواست‌ها</span>
          <strong class="analytics-card-val" dir="ltr">${formatNumber(agg.totalRequests)}</strong>
        </div>
        <div class="analytics-card">
          <span class="analytics-card-label">توکن ورودی</span>
          <strong class="analytics-card-val" dir="ltr">${formatNumber(agg.totalTokensIn)}</strong>
        </div>
        <div class="analytics-card">
          <span class="analytics-card-label">توکن خروجی</span>
          <strong class="analytics-card-val" dir="ltr">${formatNumber(agg.totalTokensOut)}</strong>
        </div>
        <div class="analytics-card">
          <span class="analytics-card-label">برآورد هزینه کل (USD)</span>
          <strong class="analytics-card-val" dir="ltr">${escHtml(formatCost(agg.totalCost))}</strong>
        </div>
      </div>

      <div class="analytics-chart-card">
        <div class="analytics-section-head">
          <h3>نمودار مصرف روزانه (توکن)</h3>
          <span class="muted">مجموع: ${formatNumber(agg.totalTokens)} توکن</span>
        </div>
        <div class="analytics-bars" dir="ltr">${barHtml}</div>
      </div>

      <div class="analytics-tables-grid">
        <div class="analytics-table-card">
          <h3>تفکیک بر اساس ارائه‌دهنده</h3>
          <table class="analytics-table">
            <thead>
              <tr>
                <th>ارائه‌دهنده</th>
                <th>درخواست</th>
                <th>توکن</th>
                <th>سهم</th>
                <th>برآورد هزینه</th>
              </tr>
            </thead>
            <tbody>${providerRows}</tbody>
          </table>
        </div>

        <div class="analytics-table-card">
          <h3>تفکیک بر اساس مدل</h3>
          <table class="analytics-table">
            <thead>
              <tr>
                <th>مدل</th>
                <th>ارائه‌دهنده</th>
                <th>درخواست</th>
                <th>توکن</th>
                <th>سهم</th>
                <th>برآورد هزینه</th>
              </tr>
            </thead>
            <tbody>${modelRows}</tbody>
          </table>
        </div>
      </div>`;

  containerEl.innerHTML = `
    <div class="analytics-view">
      <div class="analytics-head">
        <div>
          <h2>آمار مصرف و برآورد هزینه</h2>
          <p class="muted">تمام هزینه‌ها برآوردی هستند؛ برای مدل‌های بدون قیمت، مقدار «—» نمایش داده می‌شود.</p>
        </div>
        <div class="analytics-period-switch" role="tablist" aria-label="بازه زمانی آمار">
          ${periods
            .map(
              ([id, label]) =>
                `<button type="button" class="filter-pill ${activePeriod === id ? 'active' : ''}" data-analytics-period="${id}">${label}</button>`
            )
            .join('')}
        </div>
      </div>

      ${bodyHtml}

      <div class="analytics-prices-card">
        <div class="analytics-section-head">
          <h3>قیمت‌های پیش‌فرض قابل ویرایش</h3>
          <span class="muted">دلار به ازای هر ۱ میلیون توکن (ورودی / خروجی)</span>
        </div>

        <form class="analytics-price-form" data-analytics-price-form="true">
          <select name="providerId" class="analytics-input" required>
            ${providerOptions || '<option value="custom">سفارشی</option>'}
          </select>
          <input name="model" class="analytics-input" dir="ltr" placeholder="نام مدل (مثلاً gpt-4o-mini)" required>
          <input name="inPer1M" type="number" step="0.001" min="0" class="analytics-input" dir="ltr" placeholder="ورودی ($/1M)" required>
          <input name="outPer1M" type="number" step="0.001" min="0" class="analytics-input" dir="ltr" placeholder="خروجی ($/1M)" required>
          <button type="submit" class="btn btn-amber">ذخیره قیمت</button>
        </form>

        ${
          priceEntries.length === 0
            ? '<p class="muted">هنوز قیمتی ثبت نشده است.</p>'
            : `
          <table class="analytics-table">
            <thead>
              <tr>
                <th>ارائه‌دهنده</th>
                <th>مدل</th>
                <th>ورودی ($/1M)</th>
                <th>خروجی ($/1M)</th>
                <th>عملیات</th>
              </tr>
            </thead>
            <tbody>${priceRows}</tbody>
          </table>`
        }
      </div>
    </div>
  `;

  if (!containerEl._analyticsBound) {
    containerEl._analyticsBound = true;
    containerEl._analyticsStore = store;

    containerEl.addEventListener('click', (e) => {
      const currentStore = containerEl._analyticsStore;
      const periodBtn = e.target.closest('[data-analytics-period]');
      if (periodBtn) {
        activePeriod = periodBtn.getAttribute('data-analytics-period') || '7d';
        renderAnalyticsView(containerEl, currentStore);
        return;
      }

      const delBtn = e.target.closest('[data-price-del]');
      if (delBtn) {
        const key = delBtn.getAttribute('data-price-del');
        if (key) {
          deletePriceFromStore(currentStore, key);
          renderAnalyticsView(containerEl, currentStore);
        }
        return;
      }

      const editBtn = e.target.closest('[data-price-edit]');
      if (editBtn) {
        const key = editBtn.getAttribute('data-price-edit');
        const currentPrices = currentStore?.state?.modelPrices || {};
        const entry = currentPrices[key];
        const form = containerEl.querySelector('[data-analytics-price-form]');
        if (key && entry && form) {
          const [provId, ...modelParts] = key.split('|');
          const provSelect = form.elements.namedItem('providerId');
          const modelInput = form.elements.namedItem('model');
          const inInput = form.elements.namedItem('inPer1M');
          const outInput = form.elements.namedItem('outPer1M');
          if (provSelect) provSelect.value = provId;
          if (modelInput) modelInput.value = modelParts.join('|');
          if (inInput) inInput.value = String(entry.inPer1M ?? 0);
          if (outInput) outInput.value = String(entry.outPer1M ?? 0);
          modelInput?.focus?.();
        }
      }
    });

    containerEl.addEventListener('submit', (e) => {
      const form = e.target.closest('[data-analytics-price-form]');
      if (!form) return;
      e.preventDefault();
      const currentStore = containerEl._analyticsStore;
      const fd = new FormData(form);
      const providerId = String(fd.get('providerId') || '').trim();
      const model = String(fd.get('model') || '').trim();
      const inPer1M = Number(fd.get('inPer1M'));
      const outPer1M = Number(fd.get('outPer1M'));
      if (!providerId || !model || !Number.isFinite(inPer1M) || !Number.isFinite(outPer1M) || inPer1M < 0 || outPer1M < 0) {
        return;
      }
      savePriceToStore(currentStore, providerId, model, inPer1M, outPer1M);
      renderAnalyticsView(containerEl, currentStore);
    });
  } else {
    containerEl._analyticsStore = store;
  }
}
