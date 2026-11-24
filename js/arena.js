/**
 * Arena — Side-by-Side Parallel Multi-Model Comparison with live streaming & tok/s telemetry.
 */

import { store } from './store.js';
import { escHtml, renderMarkdown } from './markdown.js';
import { runChatCompletion } from './router.js';

let arenaAborts = [];

export function renderArena(container, { onToast }) {
  const withKeys = store.state.providers.filter((p) => p.keys.some((k) => k.status !== 'dead'));
  const list = withKeys.length ? withKeys : store.state.providers;

  const opts = (idx) =>
    list
      .map((p, i) => `<option value="${p.id}" ${i === idx % list.length ? 'selected' : ''}>${escHtml(p.name)} (${escHtml(p.defaultModel)})</option>`)
      .join('');

  container.innerHTML = `
    <div class="graph-toolbar">
      <div class="graph-left"><b>⚔️ مقایسه هم‌زمان مدل‌ها (Arena)</b></div>
      <div class="graph-right"><span style="font-size:12px;color:var(--text-3)">یک پیام بفرست و پاسخ ۲ مدل را هم‌زمان کنار هم مقایسه کن</span></div>
    </div>

    <div class="arena-grid">
      <div class="arena-col">
        <div class="arena-col-head">
          <span>مدل A</span>
          <select id="arena-prov-0" class="graph-select">${opts(0)}</select>
        </div>
        <div class="arena-col-body" id="arena-body-0"><span class="muted">آماده مقایسه...</span></div>
        <div class="arena-col-foot" id="arena-foot-0"><span>—</span><span></span></div>
      </div>

      <div class="arena-col">
        <div class="arena-col-head">
          <span>مدل B</span>
          <select id="arena-prov-1" class="graph-select">${opts(1)}</select>
        </div>
        <div class="arena-col-body" id="arena-body-1"><span class="muted">آماده مقایسه...</span></div>
        <div class="arena-col-foot" id="arena-foot-1"><span>—</span><span></span></div>
      </div>
    </div>

    <div class="team-composer">
      <textarea id="arena-prompt" rows="2" placeholder="سوالی بنویس تا هر دو مدل هم‌زمان جواب بدهند..."></textarea>
      <button class="btn btn-amber" id="btn-run-arena">⚔️ مقایسه</button>
    </div>
  `;

  const runBtn = container.querySelector('#btn-run-arena');
  runBtn.addEventListener('click', async () => {
    if (arenaAborts.length) {
      arenaAborts.forEach((a) => a.abort());
      arenaAborts = [];
      runBtn.textContent = '⚔️ مقایسه';
      return;
    }

    const prompt = container.querySelector('#arena-prompt').value.trim();
    if (!prompt) return onToast('لطفاً پیام خود را بنویسید');

    const prevTarget = store.state.activeTarget;
    runBtn.textContent = '■ توقف';
    arenaAborts = [new AbortController(), new AbortController()];

    const runSide = async (idx) => {
      const pid = container.querySelector(`#arena-prov-${idx}`).value;
      const bodyEl = container.querySelector(`#arena-body-${idx}`);
      const footEl = container.querySelector(`#arena-foot-${idx}`);
      bodyEl.innerHTML = '▌';
      footEl.innerHTML = '<span>در حال استریم...</span><span></span>';

      try {
        store.state.activeTarget = { type: 'provider', id: pid };
        const res = await runChatCompletion({
          messages: [
            { role: 'system', content: store.state.settings.systemPrompt },
            { role: 'user', content: prompt },
          ],
          signal: arenaAborts[idx].signal,
          onStream: ({ text, thinking }) => {
            const tHtml = thinking
              ? `<details class="think-box" open><summary>💭 در حال تفکر...</summary><div style="margin-top:6px">${escHtml(thinking.slice(-500)).replace(/\n/g, '<br>')}</div></details>`
              : '';
            bodyEl.innerHTML = `${tHtml}${renderMarkdown(text || '')} ▌`;
            bodyEl.scrollTop = bodyEl.scrollHeight;
          },
        });
        const finalThink = res.thinking
          ? `<details class="think-box"><summary>💭 فرایند تفکر مدل</summary><div style="margin-top:6px">${escHtml(res.thinking).replace(/\n/g, '<br>')}</div></details>`
          : '';
        bodyEl.innerHTML = `${finalThink}${renderMarkdown(res.text)}`;
        const sec = Math.max(0.1, res.elapsedMs / 1000);
        const tps = Math.round((res.tokens || 0) / sec);
        footEl.innerHTML = `<span>${escHtml(res.provider)} / ${escHtml(res.model)}</span><span>${sec.toFixed(1)}s · ~${tps} tok/s</span>`;
      } catch (err) {
        if (err.name !== 'AbortError') {
          bodyEl.innerHTML = `<span style="color:var(--danger)">❌ ${escHtml(err.message)}</span>`;
        }
      }
    };

    try {
      await Promise.all([runSide(0), runSide(1)]);
    } finally {
      store.state.activeTarget = prevTarget;
      arenaAborts = [];
      runBtn.textContent = '⚔️ مقایسه';
    }
  });
}
