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

    runBtn.textContent = '■ توقف';
    const currentAborts = [new AbortController(), new AbortController()];
    arenaAborts = currentAborts;

    const runSide = async (idx) => {
      const pid = container.querySelector(`#arena-prov-${idx}`).value;
      const bodyEl = container.querySelector(`#arena-body-${idx}`);
      const footEl = container.querySelector(`#arena-foot-${idx}`);
      bodyEl.innerHTML = '▌';
      footEl.innerHTML = '<span>در حال استریم...</span><span></span>';
      let lastStreamed = { text: '', thinking: '' };

      try {
        const res = await runChatCompletion({
          messages: [
            { role: 'system', content: store.state.settings.systemPrompt },
            { role: 'user', content: prompt },
          ],
          targetOverride: { type: 'provider', id: pid },
          signal: currentAborts[idx].signal,
          onMeta: (meta) => {
            if (!meta.done) {
              footEl.innerHTML = `<span>${escHtml(meta.providerName)} / ${escHtml(meta.modelId)}</span><span>TTFT ${meta.ttftMs}ms</span>`;
            }
          },
          onStream: ({ text, thinking }) => {
            lastStreamed = { text: text || '', thinking: thinking || '' };
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
        const sec = Math.max(0.1, res.totalMs / 1000);
        footEl.innerHTML = `<span>${escHtml(res.providerName)} / ${escHtml(res.modelId)}</span><span>TTFT ${res.ttftMs}ms · ${sec.toFixed(1)}s · ~${res.tokPerSec} tok/s</span>`;
      } catch (err) {
        if (err.name === 'AbortError') {
          if (lastStreamed.text || lastStreamed.thinking) {
            const tHtml = lastStreamed.thinking
              ? `<details class="think-box"><summary>💭 فرایند تفکر مدل</summary><div style="margin-top:6px">${escHtml(lastStreamed.thinking).replace(/\n/g, '<br>')}</div></details>`
              : '';
            bodyEl.innerHTML = `${tHtml}${renderMarkdown(lastStreamed.text)}`;
          } else {
            bodyEl.innerHTML = '<span class="muted">متوقف شد.</span>';
          }
          footEl.innerHTML = '<span>متوقف شد</span><span></span>';
        } else {
          bodyEl.innerHTML = `<span style="color:var(--danger)">❌ ${escHtml(err.message)}</span>`;
          footEl.innerHTML = '<span style="color:var(--danger)">خطا</span><span></span>';
        }
      }
    };

    try {
      await Promise.allSettled([runSide(0), runSide(1)]);
    } finally {
      if (arenaAborts === currentAborts) {
        arenaAborts = [];
        runBtn.textContent = '⚔️ مقایسه';
      }
    }
  });
}
