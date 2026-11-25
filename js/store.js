/**
 * 9Router Web — Local-first BYOK Store (localStorage)
 * Unified Providers & Keys, Visual Node Combos, Chat Sessions, Prompt Library, Settings.
 */

const STORAGE_KEY = 'ninerouter_web_v1';

export const BUILTIN_PROVIDERS = [
  {
    id: 'prov_openrouter',
    slug: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'google/gemini-2.5-flash',
    models: ['google/gemini-2.5-flash', 'deepseek/deepseek-r1', 'anthropic/claude-sonnet-4', 'openai/gpt-4o-mini'],
    color: '#6366f1',
    pinned: true,
    isBuiltin: true,
    supportsImages: false,
    keys: [],
  },
  {
    id: 'prov_openai',
    slug: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-image-1', 'dall-e-3'],
    color: '#10a37f',
    pinned: true,
    isBuiltin: true,
    supportsImages: true,
    keys: [],
  },
  {
    id: 'prov_gemini',
    slug: 'gemini',
    name: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-2.5-flash',
    models: ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro'],
    color: '#3b82f6',
    pinned: true,
    isBuiltin: true,
    supportsImages: false,
    keys: [],
  },
  {
    id: 'prov_groq',
    slug: 'groq',
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'deepseek-r1-distill-llama-70b'],
    color: '#f97316',
    pinned: false,
    isBuiltin: true,
    supportsImages: false,
    keys: [],
  },
  {
    id: 'prov_deepseek',
    slug: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-chat',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    color: '#06b6d4',
    pinned: false,
    isBuiltin: true,
    supportsImages: false,
    keys: [],
  },
];

export const ROUTING_POLICIES = {
  fallback: { label: 'Fallback (Priority)', labelFa: 'فالبک اولویتی', desc: 'Try nodes in chain order; switch automatically on error' },
  round_robin: { label: 'Round-Robin', labelFa: 'راند رابین', desc: 'Distribute requests evenly across connected providers' },
  smart_router: { label: 'Smart Router', labelFa: 'اسمارت روتر', desc: 'Pick the healthiest provider with lowest failure count' },
  least_used: { label: 'Least Used', labelFa: 'کمترین مصرف', desc: 'Pick the provider/key with the fewest tokens used' },
};

const DEFAULT_STATE = {
  providers: BUILTIN_PROVIDERS,
  combos: [
    {
      id: 'combo_default',
      name: 'Smart Default',
      policy: 'fallback',
      nodes: [
        { id: 'n_start', type: 'start', x: 60, y: 150, label: 'User Prompt' },
        { id: 'n_policy', type: 'policy', x: 300, y: 150, policy: 'fallback' },
        { id: 'n_p1', type: 'provider', x: 580, y: 80, providerId: 'prov_openrouter' },
        { id: 'n_p2', type: 'provider', x: 580, y: 220, providerId: 'prov_gemini' },
      ],
      edges: [
        { from: 'n_start', to: 'n_policy' },
        { from: 'n_policy', to: 'n_p1' },
        { from: 'n_policy', to: 'n_p2' },
      ],
    },
  ],
  activeTarget: { type: 'combo', id: 'combo_default' }, // { type: 'combo'|'provider', id }
  sessions: [],
  activeSessionId: null,
  prompts: [
    { id: 'prm_1', title: 'کدنویس ارشد', text: 'تو یک مهندس نرم‌افزار ارشد هستی. کد تمیز، بهینه و بدون توضیح اضافه بده.' },
    { id: 'prm_2', title: 'مترجم روان', text: 'متن زیر را به فارسی بسیار روان، طبیعی و حرفه‌ای ترجمه کن:' },
  ],
  teams: [
    {
      id: 'team_web',
      name: 'تیم ساخت وب‌سایت',
      maxRounds: 1,
      manager: { providerId: '', instructions: 'تو مدیر فنی پروژه هستی. درخواست کاربر را تحلیل کن، برای هر عضو تیم وظیفه دقیق بنویس و در نهایت همه خروجی‌ها را در یک فایل HTML کامل و آماده اجرا جمع‌بندی کن.' },
      workers: [
        { id: 'w_1', role: '🎨 طراح UI/UX', providerId: '', instructions: 'ساختار صفحه، پالت رنگ مدرن، تایپوگرافی و بخش‌های کلیدی رابط کاربری را طراحی و مشخص کن.' },
        { id: 'w_2', role: '💻 برنامه‌نویس Frontend', providerId: '', instructions: 'بر اساس طراحی، کد کامل، واکنش‌گرا و تمیز HTML + CSS + JS را در یک بلوک کد ```html بنویس.' },
        { id: 'w_3', role: '🔍 بازبین و دیباگر', providerId: '', instructions: 'کد تولیدشده را از نظر باگ، زیبایی ظاهری و تجربه کاربری بررسی کن و اصلاحات لازم را پیشنهاد بده.' },
      ],
    },
    {
      id: 'team_research',
      name: 'تیم تحقیق و محتوا',
      maxRounds: 1,
      manager: { providerId: '', instructions: 'تو سردبیر و مدیر تحقیق هستی. موضوع را به بخش‌های کلیدی بشکن، به اعضا بسپار و در نهایت گزارش جامع و خواندنی تحویل بده.' },
      workers: [
        { id: 'w_r1', role: '🔎 پژوهشگر', providerId: '', instructions: 'نکات کلیدی، حقایق مهم و ساختار علمی موضوع را استخراج کن.' },
        { id: 'w_r2', role: '✍️ نویسنده', providerId: '', instructions: 'بر اساس یافته‌های پژوهشگر، متن روان، جذاب و ساختاریافته بنویس.' },
      ],
    },
  ],
  settings: {
    theme: 'dark',
    lang: 'fa',
    systemPrompt: 'تو یک دستیار هوشمند، دقیق و خوش‌برخورد هستی. به زبان کاربر پاسخ بده.',
    temperature: 0.7,
    maxTokens: 4096,
    corsProxy: '',
    webSearch: {
      enabled: false,
      provider: 'tavily',
      apiKey: '',
    },
  },
  rrCursor: 0,
};

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

class Store {
  constructor() {
    this.state = this.load();
    this.listeners = new Set();
  }

  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return clone(DEFAULT_STATE);
      const parsed = JSON.parse(raw);
      return {
        ...clone(DEFAULT_STATE),
        ...parsed,
        settings: {
          ...DEFAULT_STATE.settings,
          ...(parsed.settings || {}),
          webSearch: {
            ...DEFAULT_STATE.settings.webSearch,
            ...(parsed.settings?.webSearch || {}),
          },
        },
      };
    } catch {
      return clone(DEFAULT_STATE);
    }
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {}
    for (const fn of this.listeners) fn(this.state);
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  uid(prefix = 'id') {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  }

  // ─── Providers & Keys (Unified) ───────────────────────────────────────────
  addProvider({ name, baseUrl, defaultModel = '', models = [], color = '#f59e0b', supportsImages = false }) {
    let cleanModels = [...new Set(models.map((m) => String(m || '').trim()).filter(Boolean))];
    const cleanDefault = String(defaultModel || '').trim();
    if (cleanDefault && !cleanModels.includes(cleanDefault)) {
      cleanModels = [cleanDefault, ...cleanModels];
    }
    if (!cleanModels.length) cleanModels = ['gpt-4o-mini'];
    const p = {
      id: this.uid('prov'),
      slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '_') || this.uid('c'),
      name: name.trim(),
      baseUrl: baseUrl.trim().replace(/\/+$/, ''),
      defaultModel: cleanDefault || cleanModels[0],
      models: cleanModels,
      color,
      pinned: false,
      isBuiltin: false,
      supportsImages,
      keys: [],
    };
    this.state.providers.unshift(p);
    this.save();
    return p;
  }

  updateProvider(id, patch = {}) {
    const p = this.state.providers.find((x) => x.id === id);
    if (!p) return null;
    const next = { ...patch };
    if (typeof next.name === 'string') next.name = next.name.trim();
    if (typeof next.baseUrl === 'string') next.baseUrl = next.baseUrl.trim().replace(/\/+$/, '');
    if (Array.isArray(next.models)) {
      next.models = [...new Set(next.models.map((m) => String(m || '').trim()).filter(Boolean))];
    }
    if (typeof next.defaultModel === 'string') {
      next.defaultModel = next.defaultModel.trim();
    }
    Object.assign(p, next);
    if (p.defaultModel) {
      if (!Array.isArray(p.models)) p.models = [];
      if (!p.models.includes(p.defaultModel)) {
        p.models = [p.defaultModel, ...p.models];
      }
    } else if (Array.isArray(p.models) && p.models.length) {
      p.defaultModel = p.models[0];
    }
    this.save();
    return p;
  }

  deleteProvider(id) {
    this.state.providers = this.state.providers.filter((x) => x.id !== id);
    for (const c of this.state.combos) {
      const removedNodeIds = new Set(c.nodes.filter((n) => n.providerId === id).map((n) => n.id));
      c.nodes = c.nodes.filter((n) => !removedNodeIds.has(n.id));
      c.edges = c.edges.filter((e) => !removedNodeIds.has(e.from) && !removedNodeIds.has(e.to));
    }
    this.save();
  }

  addKey(providerId, { value, label = '' }) {
    const p = this.state.providers.find((x) => x.id === providerId);
    if (!p) return null;
    const key = {
      id: this.uid('key'),
      value: value.trim(),
      label: label.trim() || `Key #${p.keys.length + 1}`,
      status: 'active', // active | cooldown | dead
      failures: 0,
      tokens: 0,
      lastUsedAt: 0,
    };
    p.keys.push(key);
    this.save();
    return key;
  }

  deleteKey(providerId, keyId) {
    const p = this.state.providers.find((x) => x.id === providerId);
    if (!p) return;
    p.keys = p.keys.filter((k) => k.id !== keyId);
    this.save();
  }

  resetKey(providerId, keyId) {
    const p = this.state.providers.find((x) => x.id === providerId);
    const k = p?.keys.find((x) => x.id === keyId);
    if (!k) return;
    k.status = 'active';
    k.failures = 0;
    this.save();
  }

  // ─── Combos (Node Graph) ──────────────────────────────────────────────────
  createCombo(name = 'New Combo') {
    const combo = {
      id: this.uid('combo'),
      name,
      policy: 'fallback',
      nodes: [
        { id: 'n_start', type: 'start', x: 60, y: 150, label: 'User Prompt' },
        { id: 'n_policy', type: 'policy', x: 300, y: 150, policy: 'fallback' },
      ],
      edges: [{ from: 'n_start', to: 'n_policy' }],
    };
    this.state.combos.push(combo);
    this.save();
    return combo;
  }

  deleteCombo(id) {
    this.state.combos = this.state.combos.filter((c) => c.id !== id);
    if (this.state.activeTarget?.type === 'combo' && this.state.activeTarget.id === id) {
      this.state.activeTarget = this.state.combos[0]
        ? { type: 'combo', id: this.state.combos[0].id }
        : { type: 'provider', id: this.state.providers[0]?.id };
    }
    this.save();
  }

  // ─── Sessions ─────────────────────────────────────────────────────────────
  createSession(title = 'گفتگوی جدید') {
    const s = { id: this.uid('ses'), title, messages: [], pinned: false, folder: '', updatedAt: Date.now() };
    this.state.sessions.unshift(s);
    this.state.activeSessionId = s.id;
    this.save();
    return s;
  }

  getActiveSession() {
    let s = this.state.sessions.find((x) => x.id === this.state.activeSessionId);
    if (!s) s = this.createSession();
    return s;
  }

  deleteSession(id) {
    this.state.sessions = this.state.sessions.filter((x) => x.id !== id);
    if (this.state.activeSessionId === id) {
      this.state.activeSessionId = this.state.sessions[0]?.id || null;
    }
    this.save();
  }

  togglePinSession(id) {
    const s = this.state.sessions.find((x) => x.id === id);
    if (!s) return null;
    s.pinned = !s.pinned;
    this.save();
    return s;
  }

  setSessionFolder(id, folder) {
    const s = this.state.sessions.find((x) => x.id === id);
    if (!s) return null;
    s.folder = String(folder || '').trim();
    this.save();
    return s;
  }

  forkSession(sessionId, upToIndex) {
    const src = this.state.sessions.find((x) => x.id === sessionId);
    if (!src) return null;
    const sliced = clone(src.messages.slice(0, upToIndex + 1));
    const forked = {
      id: this.uid('ses'),
      title: `${src.title} (انشعاب)`,
      messages: sliced,
      pinned: false,
      folder: src.folder || '',
      updatedAt: Date.now(),
    };
    this.state.sessions.unshift(forked);
    this.state.activeSessionId = forked.id;
    this.save();
    return forked;
  }

  // ─── Export / Import Backup ───────────────────────────────────────────────
  exportJson() {
    return JSON.stringify(this.state, null, 2);
  }

  importJson(raw) {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.providers)) throw new Error('Invalid backup file');
    this.state = { ...clone(DEFAULT_STATE), ...parsed };
    this.save();
  }
}

export const store = new Store();

export function maskKey(val) {
  const s = String(val || '');
  if (s.length < 10) return '••••••••';
  return `${s.slice(0, 6)}${'•'.repeat(16)}${s.slice(-4)}`;
}
