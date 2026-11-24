/**
 * 9Router Web — Main Application Controller
 * ChatGPT-style streaming chat + Vision + Image Gen/Edit + Unified Providers + Visual Node Combos.
 */

import { store } from './store.js';
import { renderMarkdown, escHtml } from './markdown.js';
import { runChatCompletion, runImageGeneration } from './router.js';
import { renderProvidersHub } from './providers_ui.js';
import { renderComboGraph } from './combo_graph.js';
import { renderAgentTeam } from './agent_team.js';

let currentTab = 'chat';
let attachedImages = [];
let imageMode = false;
let activeAbort = null;

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2500);
}

window.__copyCode = (btn) => {
  const code = btn.closest('.code-wrap')?.querySelector('code')?.textContent || '';
  navigator.clipboard.writeText(code).then(() => {
    btn.textContent = 'کپی شد ✓';
    setTimeout(() => (btn.textContent = 'کپی'), 1500);
  });
};

function toggleSidebar(open) {
  document.getElementById('sidebar').classList.toggle('open', open);
  document.getElementById('backdrop').classList.toggle('show', open);
}

function applyTheme() {
  document.documentElement.classList.toggle('light-mode', store.state.settings.theme === 'light');
}

function updateTargetPill() {
  const t = store.state.activeTarget;
  const el = document.getElementById('active-target-label');
  if (t?.type === 'provider') {
    const p = store.state.providers.find((x) => x.id === t.id);
    el.textContent = p ? `${p.name} (${p.defaultModel})` : 'انتخاب نشده';
  } else {
    const c = store.state.combos.find((x) => x.id === t?.id) || store.state.combos[0];
    el.textContent = c ? `کمبو: ${c.name}` : 'انتخاب نشده';
  }
}

function renderSessionsSidebar(filter = '') {
  const list = document.getElementById('sessions-list');
  const activeId = store.state.activeSessionId;
  const q = filter.trim().toLowerCase();
  const rows = q
    ? store.state.sessions.filter((s) => s.title.toLowerCase().includes(q))
    : store.state.sessions;
  list.innerHTML = rows
    .map(
      (s) => `
      <div class="ses-row ${s.id === activeId ? 'active' : ''}" data-ses="${s.id}">
        <span class="ses-title">${escHtml(s.title)}</span>
        <button class="ses-del" data-del-ses="${s.id}" title="حذف">×</button>
      </div>`
    )
    .join('');

  list.querySelectorAll('[data-ses]').forEach((row) => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('[data-del-ses]')) return;
      store.state.activeSessionId = row.dataset.ses;
      store.save();
      switchTab('chat');
      renderChatMessages();
    });
  });

  list.querySelectorAll('[data-del-ses]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      store.deleteSession(btn.dataset.delSes);
      renderSessionsSidebar();
      renderChatMessages();
    });
  });
}

function renderChatMessages() {
  const col = document.getElementById('chat-messages');
  const ses = store.getActiveSession();
  if (!ses.messages.length) {
    col.innerHTML = `
      <div class="chat-empty">
        <h1>چطور می‌تونم کمکت کنم؟</h1>
        <div class="sug-grid">
          <button class="sug-btn" data-sug="یک کد تمیز جاوااسکریپت برای مدیریت Rate Limit بنویس"><b>کدنویسی و معماری</b>ساخت الگوریتم و دیباگ کد</button>
          <button class="sug-btn" data-sug="این متن را به فارسی روان و حرفه‌ای ترجمه کن:"><b>ترجمه دقیق</b>فارسی و انگلیسی روان</button>
          <button class="sug-btn" data-sug="تفاوت Fallback و Round-Robin در مسیریابی هوش مصنوعی چیست؟"><b>توضیح مفاهیم</b>ساده، دقیق و کاربردی</button>
          <button class="sug-btn" data-sug-img="یک تصویر سینمایی از یک شهر آینده‌نگر در شب با نورهای نئون"><b>🎨 تولید تصویر</b>ساخت عکس مستقیم در چت</button>
        </div>
      </div>`;
    col.querySelectorAll('[data-sug]').forEach((b) => {
      b.addEventListener('click', () => {
        document.getElementById('msg-input').value = b.dataset.sug;
        document.getElementById('msg-input').focus();
      });
    });
    col.querySelectorAll('[data-sug-img]').forEach((b) => {
      b.addEventListener('click', () => {
        imageMode = true;
        document.getElementById('btn-img-mode').classList.add('active');
        document.getElementById('msg-input').value = b.dataset.sugImg;
        document.getElementById('msg-input').focus();
      });
    });
    return;
  }

  col.innerHTML = ses.messages.map((m) => buildMessageHtml(m)).join('');
  scrollBottom();
}

function buildMessageHtml(m) {
  if (m.role === 'user') {
    const imgs = (m.images || []).map((src) => `<img src="${src}" alt="attachment">`).join('');
    return `<div class="msg user"><div class="bubble">${escHtml(m.content).replace(/\n/g, '<br>')}${imgs ? `<div class="msg-imgs">${imgs}</div>` : ''}</div></div>`;
  }
  const thinkHtml = m.thinking
    ? `<details class="think-box"><summary>💭 فرایند تفکر مدل</summary><div style="margin-top:6px">${escHtml(m.thinking).replace(/\n/g, '<br>')}</div></details>`
    : '';
  const imgHtml = m.imageUrl
    ? `<img class="gen-img" src="${m.imageUrl}" alt="generated"><a class="btn btn-sm btn-ghost" style="margin-top:8px" href="${m.imageUrl}" download="9router-image.png" target="_blank">⬇️ دانلود تصویر</a>`
    : '';
  const metaParts = [];
  if (m.provider) metaParts.push(`${escHtml(m.provider)} / ${escHtml(m.model || '')}`);
  if (m.elapsedMs) metaParts.push(`${(m.elapsedMs / 1000).toFixed(1)}s`);
  if (m.tokens) metaParts.push(`${m.tokens} tok`);
  return `
    <div class="msg ai">
      <div class="ai-wrap">
        <div class="ai-av">9R</div>
        <div class="bubble">${thinkHtml}${renderMarkdown(m.content || '')}${imgHtml}</div>
      </div>
      ${metaParts.length ? `<div class="msg-meta">${metaParts.join(' · ')}</div>` : ''}
    </div>`;
}

function scrollBottom() {
  const s = document.getElementById('chat-scroll');
  s.scrollTo({ top: s.scrollHeight, behavior: 'smooth' });
}

function renderPreviews() {
  const bar = document.getElementById('composer-previews');
  if (!attachedImages.length) { bar.classList.remove('show'); bar.innerHTML = ''; return; }
  bar.classList.add('show');
  bar.innerHTML = attachedImages
    .map((src, i) => `<div class="prev-chip"><img src="${src}"><button data-rm-img="${i}">×</button></div>`)
    .join('');
  bar.querySelectorAll('[data-rm-img]').forEach((b) => {
    b.addEventListener('click', () => {
      attachedImages.splice(Number(b.dataset.rmImg), 1);
      renderPreviews();
    });
  });
}

async function handleSend() {
  const sendBtn = document.getElementById('send-btn');
  if (activeAbort) {
    activeAbort.abort();
    activeAbort = null;
    sendBtn.classList.remove('stop');
    sendBtn.textContent = '↑';
    return;
  }

  const inp = document.getElementById('msg-input');
  const text = inp.value.trim();
  if (!text && !attachedImages.length) return;

  const ses = store.getActiveSession();
  if (!ses.messages.length && text) {
    ses.title = text.slice(0, 36);
  }

  const userMsg = { role: 'user', content: text, images: [...attachedImages] };
  ses.messages.push(userMsg);
  ses.updatedAt = Date.now();
  store.save();

  inp.value = '';
  inp.style.height = '';
  const imgsForRequest = [...attachedImages];
  attachedImages = [];
  renderPreviews();
  renderSessionsSidebar();
  renderChatMessages();

  activeAbort = new AbortController();
  sendBtn.classList.add('stop');
  sendBtn.textContent = '■';

  const col = document.getElementById('chat-messages');
  const liveDiv = document.createElement('div');
  liveDiv.className = 'msg ai';
  liveDiv.innerHTML = `<div class="ai-wrap"><div class="ai-av">9R</div><div class="bubble">▌</div></div><div class="msg-meta"></div>`;
  col.appendChild(liveDiv);
  const bubbleEl = liveDiv.querySelector('.bubble');
  const metaEl = liveDiv.querySelector('.msg-meta');
  scrollBottom();

  try {
    if (imageMode) {
      bubbleEl.innerHTML = `<em style="color:var(--text-3)">🎨 در حال ${imgsForRequest.length ? 'ویرایش' : 'تولید'} تصویر...</em>`;
      const imgRes = await runImageGeneration({
        prompt: text,
        sourceImageDataUrl: imgsForRequest[0] || null,
        signal: activeAbort.signal,
      });
      const aiMsg = {
        role: 'assistant',
        content: imgRes.revisedPrompt || 'تصویر شما آماده شد:',
        imageUrl: imgRes.imageUrl,
        provider: imgRes.provider,
        model: imgRes.model,
        elapsedMs: imgRes.elapsedMs,
      };
      ses.messages.push(aiMsg);
      store.save();
      renderChatMessages();
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

      const res = await runChatCompletion({
        messages: apiMessages,
        signal: activeAbort.signal,
        onStream: ({ type, text: acc, thinking }) => {
          const thinkHtml = thinking
            ? `<details class="think-box" open><summary>💭 در حال تفکر...</summary><div style="margin-top:6px">${escHtml(thinking.slice(-400))}</div></details>`
            : '';
          bubbleEl.innerHTML = `${thinkHtml}${renderMarkdown(acc || '')} ▌`;
          scrollBottom();
        },
      });

      const aiMsg = {
        role: 'assistant',
        content: res.text,
        thinking: res.thinking,
        provider: res.provider,
        model: res.model,
        tokens: res.tokens,
        elapsedMs: res.elapsedMs,
      };
      ses.messages.push(aiMsg);
      store.save();
      renderChatMessages();
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      metaEl.textContent = 'توقف توسط کاربر';
    } else {
      bubbleEl.innerHTML = `<span style="color:var(--danger)">❌ ${escHtml(err.message)}</span>`;
    }
  } finally {
    activeAbort = null;
    sendBtn.classList.remove('stop');
    sendBtn.textContent = '↑';
  }
}

function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.nav-item[data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${tab}`));
  toggleSidebar(false);
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
  }
}

window.__openHtmlPreview = (htmlCode) => {
  const frame = document.getElementById('preview-frame');
  if (frame) frame.srcdoc = htmlCode;
  document.getElementById('modal-preview')?.classList.add('open');
};

// ─── Modals ───────────────────────────────────────────────────────────────────
window.__openAddProviderModal = () => {
  document.getElementById('m-prov-name').value = '';
  document.getElementById('m-prov-url').value = '';
  document.getElementById('m-prov-models').value = '';
  document.getElementById('m-prov-img').checked = false;
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
  renderSessionsSidebar();
  renderChatMessages();

  document.querySelectorAll('.nav-item[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  document.getElementById('btn-menu').addEventListener('click', () => toggleSidebar(true));
  document.getElementById('backdrop').addEventListener('click', () => toggleSidebar(false));
  document.getElementById('btn-new-chat').addEventListener('click', () => {
    store.createSession();
    renderSessionsSidebar();
    switchTab('chat');
    renderChatMessages();
  });
  document.getElementById('btn-theme').addEventListener('click', () => {
    store.state.settings.theme = store.state.settings.theme === 'dark' ? 'light' : 'dark';
    store.save();
    applyTheme();
  });

  document.getElementById('btn-img-mode').addEventListener('click', (e) => {
    imageMode = !imageMode;
    e.currentTarget.classList.toggle('active', imageMode);
    toast(imageMode ? '🎨 حالت تولید/ویرایش تصویر فعال شد' : '💬 حالت گفتگوی متنی فعال شد');
  });

  document.getElementById('btn-attach').addEventListener('click', () => document.getElementById('file-input').click());
  document.getElementById('file-input').addEventListener('change', (e) => {
    Array.from(e.target.files || []).forEach((f) => {
      const r = new FileReader();
      if (f.type.startsWith('image/')) {
        r.onload = (ev) => { attachedImages.push(ev.target.result); renderPreviews(); };
        r.readAsDataURL(f);
      } else {
        r.onload = (ev) => {
          const content = String(ev.target.result || '').slice(0, 40000);
          const inp = document.getElementById('msg-input');
          const ext = f.name.split('.').pop() || 'text';
          inp.value = `${inp.value ? inp.value + '\n\n' : ''}📄 فایل (${f.name}):\n\`\`\`${ext}\n${content}\n\`\`\``;
          inp.dispatchEvent(new Event('input'));
          toast(`فایل ${f.name} پیوست شد`);
        };
        r.readAsText(f);
      }
    });
    e.target.value = '';
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
  msgInput.addEventListener('input', () => {
    msgInput.style.height = 'auto';
    msgInput.style.height = `${Math.min(msgInput.scrollHeight, 160)}px`;
  });
  msgInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  });

  // Modals submit
  document.getElementById('m-prov-save').addEventListener('click', () => {
    const name = document.getElementById('m-prov-name').value.trim();
    const baseUrl = document.getElementById('m-prov-url').value.trim();
    const models = document.getElementById('m-prov-models').value.split(/[\r\n,،]+/).map((s) => s.trim()).filter(Boolean);
    const supportsImages = document.getElementById('m-prov-img').checked;
    if (!name || !baseUrl.startsWith('http')) return toast('نام و Base URL معتبر وارد کنید');
    store.addProvider({ name, baseUrl, models, supportsImages });
    document.getElementById('modal-prov').classList.remove('open');
    switchTab('providers');
    toast('ارائه‌دهنده اضافه شد');
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
  document.getElementById('btn-settings').addEventListener('click', () => {
    document.getElementById('s-sys').value = store.state.settings.systemPrompt;
    document.getElementById('s-temp').value = store.state.settings.temperature;
    document.getElementById('s-proxy').value = store.state.settings.corsProxy || '';
    document.getElementById('modal-settings').classList.add('open');
  });
  document.getElementById('s-save').addEventListener('click', () => {
    store.state.settings.systemPrompt = document.getElementById('s-sys').value.trim();
    store.state.settings.temperature = parseFloat(document.getElementById('s-temp').value) || 0.7;
    store.state.settings.corsProxy = document.getElementById('s-proxy').value.trim();
    store.save();
    document.getElementById('modal-settings').classList.remove('open');
    toast('تنظیمات ذخیره شد');
  });

  document.getElementById('btn-export').addEventListener('click', () => {
    const blob = new Blob([store.exportJson()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `9router-web-backup-${Date.now()}.json`;
    a.click();
  });

  document.getElementById('btn-import').addEventListener('click', () => document.getElementById('import-file').click());
  document.getElementById('import-file').addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = (ev) => {
      try {
        store.importJson(ev.target.result);
        updateTargetPill();
        renderSessionsSidebar();
        switchTab(currentTab);
        toast('پشتیبان با موفقیت بازیابی شد');
      } catch {
        toast('فایل پشتیبان نامعتبر است');
      }
    };
    r.readAsText(f);
    e.target.value = '';
  });

  document.querySelectorAll('[data-close-modal]').forEach((b) => {
    b.addEventListener('click', () => b.closest('.modal-bg')?.classList.remove('open'));
  });
});
