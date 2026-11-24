/**
 * Visual Multi-Agent Team Orchestrator (Manager + Specialist Workers)
 * Features: Live Step Progress Bar, Collapsible non-squishing cards, Live HTML Preview & Download.
 */

import { store } from './store.js';
import { escHtml, renderMarkdown } from './markdown.js';
import { runChatCompletion } from './router.js';

let selectedTeamId = null;
let teamAbort = null;

function providerOptionsHtml(selectedId) {
  const withKeys = store.state.providers.filter((p) => p.keys.some((k) => k.status !== 'dead'));
  const list = withKeys.length ? withKeys : store.state.providers;
  return `<option value="">خودکار (اولین کلید فعال)</option>` + list
    .map((p) => `<option value="${p.id}" ${p.id === selectedId ? 'selected' : ''}>${escHtml(p.name)} (${escHtml(p.defaultModel)})</option>`)
    .join('');
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
  const m = String(text || '').match(/```html\n?([\s\S]*?)```/i);
  if (m) return m[1];
  if (/<html[\s>]/i.test(text || '') && /<\/html>/i.test(text || '')) {
    const start = text.search(/<!doctype|<html/i);
    const end = text.lastIndexOf('</html>') + 7;
    if (start >= 0 && end > start) return text.slice(start, end);
  }
  return null;
}

export function renderAgentTeam(container, { onToast }) {
  if (!store.state.teams?.length) return;
  let team = store.state.teams.find((t) => t.id === selectedTeamId) || store.state.teams[0];
  selectedTeamId = team.id;

  const stepsList = [
    { id: 'plan', label: '① برنامه‌ریزی مدیر' },
    ...team.workers.map((w, i) => ({ id: w.id, label: `${i + 2}. ${w.role}` })),
    { id: 'final', label: '✨ خروجی نهایی' },
  ];

  container.innerHTML = `
    <div class="graph-toolbar">
      <div class="graph-left">
        <select id="team-select" class="graph-select">
          ${store.state.teams.map((t) => `<option value="${t.id}" ${t.id === team.id ? 'selected' : ''}>🤖 ${escHtml(t.name)}</option>`).join('')}
        </select>
        <button class="btn btn-sm btn-ghost" id="btn-add-worker">+ افزودن متخصص</button>
      </div>
      <div class="graph-right">
        <span style="font-size:12px;color:var(--text-3)">روی عنوان هر کارت کلیک کن تا باز/بسته شود</span>
      </div>
    </div>

    <div class="team-layout">
      <div class="team-graph-pane">
        <div class="team-stage">
          <div class="t-node t-manager" id="tnode-manager">
            <div class="t-node-head"><span>👑 مدیر تیم (Orchestrator)</span></div>
            <div class="t-node-body">
              <select class="node-policy-select" id="mgr-prov-sel">${providerOptionsHtml(team.manager.providerId)}</select>
            </div>
          </div>

          <div class="t-connector">↓ تقسیم وظایف و هماهنگی ↓</div>

          <div class="t-workers-row">
            ${team.workers
              .map(
                (w) => `
              <div class="t-node t-worker" id="tnode-${w.id}">
                <div class="t-node-head">
                  <span>${escHtml(w.role)}</span>
                  ${team.workers.length > 1 ? `<button class="node-del" data-del-worker="${w.id}" title="حذف">×</button>` : ''}
                </div>
                <div class="t-node-body">
                  <select class="node-policy-select" data-worker-prov="${w.id}">${providerOptionsHtml(w.providerId)}</select>
                  <div class="t-inst">${escHtml(w.instructions)}</div>
                </div>
              </div>`
              )
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
          ${stepsList.map((s) => `<span class="step-chip" data-step="${s.id}">${escHtml(s.label)}</span>`).join('')}
        </div>
        <div class="team-feed" id="team-feed">
          <div class="empty-box" style="margin:auto">
            یک درخواست بنویس (مثلاً: <b>«یک صفحه فرود مدرن برای فروشگاه لوازم ورزشی با HTML/CSS/JS بساز»</b>) تا مراحل کار تیم را زنده ببینی و خروجی نهایی را پیش‌نمایش و دانلود کنی.
          </div>
        </div>
        <div class="team-composer">
          <textarea id="team-goal" rows="2" placeholder="درخواست خود را برای تیم ایجنت‌ها بنویسید..."></textarea>
          <button class="btn btn-amber" id="btn-run-team">🚀 اجرای تیم</button>
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

  container.querySelector('#team-select').addEventListener('change', (e) => {
    selectedTeamId = e.target.value;
    renderAgentTeam(container, { onToast });
  });
  container.querySelector('#mgr-prov-sel').addEventListener('change', (e) => {
    team.manager.providerId = e.target.value;
    store.save();
  });
  container.querySelectorAll('[data-worker-prov]').forEach((sel) => {
    sel.addEventListener('change', () => {
      const w = team.workers.find((x) => x.id === sel.dataset.workerProv);
      if (w) { w.providerId = sel.value; store.save(); }
    });
  });
  container.querySelectorAll('[data-del-worker]').forEach((btn) => {
    btn.addEventListener('click', () => {
      team.workers = team.workers.filter((w) => w.id !== btn.dataset.delWorker);
      store.save();
      renderAgentTeam(container, { onToast });
    });
  });
  container.querySelector('#btn-add-worker').addEventListener('click', () => {
    const role = prompt('نقش متخصص جدید (مثلاً: ✍️ کپی‌رایتر):');
    if (!role) return;
    const instructions = prompt('شرح وظیفه این متخصص:', `به عنوان ${role} بهترین خروجی را تولید کن.`);
    team.workers.push({ id: store.uid('w'), role: role.trim(), providerId: '', instructions: (instructions || '').trim() });
    store.save();
    renderAgentTeam(container, { onToast });
  });

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
      const mgrCard = appendAgentCard('👑 مدیر تیم — برنامه‌ریزی', 'در حال نوشتن...');
      const mgrBody = mgrCard.querySelector('.agent-card-body');
      const workersDesc = team.workers.map((w, i) => `${i + 1}. ${w.role}: ${w.instructions}`).join('\n');

      const planRes = await callAgent(
        team.manager.providerId,
        [
          { role: 'system', content: team.manager.instructions },
          { role: 'user', content: `هدف کاربر:\n${goal}\n\nاعضای تیم:\n${workersDesc}\n\nیک برنامه کوتاه و شفاف بنویس که هر عضو دقیقاً چه کاری انجام دهد.` },
        ],
        ({ text }) => { mgrBody.innerHTML = renderMarkdown(text) + ' ▌'; mgrBody.scrollTop = mgrBody.scrollHeight; },
        teamAbort.signal
      );
      mgrBody.innerHTML = renderMarkdown(planRes.text);
      mgrCard.querySelector('.stat-pill').textContent = `✓ ${planRes.provider} / ${planRes.model}`;
      setStepStatus('plan', 'done');

      // Phase 2: Workers execute
      const workerOutputs = [];
      for (const w of team.workers) {
        if (teamAbort.signal.aborted) break;
        setActiveNode(`tnode-${w.id}`);
        setStepStatus(w.id, 'active');
        const wCard = appendAgentCard(w.role, 'در حال نوشتن...');
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
          ({ text }) => { wBody.innerHTML = renderMarkdown(text) + ' ▌'; wBody.scrollTop = wBody.scrollHeight; feedEl.scrollTop = feedEl.scrollHeight; },
          teamAbort.signal
        );
        wBody.innerHTML = renderMarkdown(wRes.text);
        wCard.querySelector('.stat-pill').textContent = `✓ ${wRes.provider} / ${wRes.model}`;
        setStepStatus(w.id, 'done');
        workerOutputs.push({ role: w.role, text: wRes.text });
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
        ({ text }) => { finalBody.innerHTML = renderMarkdown(text) + ' ▌'; finalBody.scrollTop = finalBody.scrollHeight; feedEl.scrollTop = feedEl.scrollHeight; },
        teamAbort.signal
      );
      finalBody.innerHTML = renderMarkdown(finalRes.text);
      finalCard.querySelector('.stat-pill').textContent = `✓ ${finalRes.provider} / ${finalRes.model}`;
      setStepStatus('final', 'done');

      const finalHtml = extractHtmlCode(finalRes.text) || bestHtmlFound;
      if (finalHtml) {
        const acts = document.createElement('div');
        acts.className = 'final-actions';
        acts.innerHTML = `
          <button class="btn btn-amber btn-sm" id="btn-live-preview">👁️ پیش‌نمایش زنده سایت</button>
          <button class="btn btn-ghost btn-sm" id="btn-dl-html">⬇️ دانلود index.html</button>
        `;
        finalCard.appendChild(acts);
        acts.querySelector('#btn-live-preview').addEventListener('click', () => window.__openHtmlPreview?.(finalHtml));
        acts.querySelector('#btn-dl-html').addEventListener('click', () => {
          const blob = new Blob([finalHtml], { type: 'text/html;charset=utf-8' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'index.html';
          a.click();
        });
      }
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
