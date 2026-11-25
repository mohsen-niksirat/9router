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

export const TEAM_MODES = {
  manager_worker: { label: 'Manager-Worker', labelFa: 'مدیر-متخصص', desc: 'Manager delegates tasks to workers and synthesizes the final output' },
  sequential: { label: 'Sequential', labelFa: 'ترتیبی', desc: 'Agents run one after another, each building on the previous output' },
  parallel: { label: 'Parallel', labelFa: 'موازی', desc: 'All workers run concurrently and the manager merges their outputs' },
  debate_review: { label: 'Debate & Review', labelFa: 'نقد و بازبینی', desc: 'Iterative draft, critique, and revision loop up to maxRounds' },
};

const VALID_TEAM_MODES = new Set(Object.keys(TEAM_MODES));

function clampTemperature(val, fallback = 0.7) {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(2, Math.round(n * 100) / 100));
}

function normalizeAgent(agent = {}, defaults = {}) {
  const role = String(agent.role ?? defaults.role ?? 'متخصص').trim() || 'متخصص';
  const name = String(agent.name ?? defaults.name ?? role).trim() || role;
  return {
    ...(agent.id ? { id: String(agent.id) } : defaults.id ? { id: String(defaults.id) } : {}),
    name,
    role,
    icon: String(agent.icon ?? defaults.icon ?? '🤖').trim() || '🤖',
    providerId: String(agent.providerId ?? defaults.providerId ?? '').trim(),
    model: String(agent.model ?? defaults.model ?? '').trim(),
    keyId: String(agent.keyId ?? defaults.keyId ?? '').trim(),
    temperature: clampTemperature(agent.temperature, defaults.temperature ?? 0.7),
    instructions: String(agent.instructions ?? defaults.instructions ?? ''),
  };
}

function normalizeTeam(team = {}, index = 0) {
  const mode = VALID_TEAM_MODES.has(team.mode) ? team.mode : 'manager_worker';
  const rawRounds = Number(team.maxRounds);
  const maxRounds = Number.isFinite(rawRounds) && rawRounds >= 1 ? Math.min(10, Math.floor(rawRounds)) : 1;
  const manager = normalizeAgent(team.manager || {}, {
    name: 'مدیر تیم',
    role: 'مدیر هماهنگ‌کننده',
    icon: '🧠',
    temperature: 0.7,
    instructions: '',
  });
  delete manager.id;
  const rawWorkers = Array.isArray(team.workers) ? team.workers : [];
  const workers = rawWorkers.map((w, i) =>
    normalizeAgent(w || {}, {
      id: w?.id || `w_${index}_${i + 1}`,
      name: w?.name || w?.role || `عضو ${i + 1}`,
      role: w?.role || `متخصص ${i + 1}`,
      icon: '🤖',
      temperature: 0.7,
      instructions: '',
    }),
  );
  return {
    id: String(team.id || `team_${index + 1}`),
    name: String(team.name || 'تیم جدید').trim() || 'تیم جدید',
    icon: String(team.icon || '🤖').trim() || '🤖',
    description: String(team.description || '').trim(),
    mode,
    maxRounds,
    hitlPause: Boolean(team.hitlPause),
    manager,
    workers,
  };
}

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
  activeTarget: { type: 'combo', id: 'combo_default' }, // { type: 'combo'|'provider', id, model?, keyId? }
  sessions: [],
  activeSessionId: null,
  prompts: [
    { id: 'prm_1', title: 'کدنویس ارشد', text: 'تو یک مهندس نرم‌افزار ارشد هستی. کد تمیز، بهینه و بدون توضیح اضافه بده.' },
    { id: 'prm_2', title: 'مترجم روان', text: 'متن زیر را به فارسی بسیار روان، طبیعی و حرفه‌ای ترجمه کن:' },
  ],
  teams: [
    {
      id: 'team_web',
      name: 'استودیو ساخت وب‌سایت (Web App Studio)',
      icon: '🌐',
      description: 'طراحی رابط کاربری، پیاده‌سازی فرانت‌اند مدرن و بازبینی کد در یک خروجی HTML آماده اجرا.',
      mode: 'manager_worker',
      maxRounds: 1,
      hitlPause: false,
      manager: {
        name: 'مدیر فنی (Tech Lead)',
        role: 'مدیر پروژه و معمار فرانت‌اند',
        icon: '🧠',
        providerId: '',
        model: '',
        keyId: '',
        temperature: 0.6,
        instructions: 'تو مدیر فنی پروژه هستی. درخواست کاربر را تحلیل کن، برای هر عضو تیم وظیفه دقیق بنویس و در نهایت همه خروجی‌ها را در یک فایل HTML کامل، مدرن، واکنش‌گرا و آماده اجرا (در بلوک ```html) جمع‌بندی کن.',
      },
      workers: [
        {
          id: 'w_web_1',
          name: 'آرش (UI/UX)',
          role: 'طراح UI/UX',
          icon: '🎨',
          providerId: '',
          model: '',
          keyId: '',
          temperature: 0.8,
          instructions: 'ساختار صفحه، سلسله‌مراتب بصری، پالت رنگ مدرن، تایپوگرافی و جزئیات تعاملی رابط کاربری را طراحی و مشخص کن.',
        },
        {
          id: 'w_web_2',
          name: 'سارا (Frontend)',
          role: 'برنامه‌نویس Frontend',
          icon: '💻',
          providerId: '',
          model: '',
          keyId: '',
          temperature: 0.4,
          instructions: 'بر اساس طراحی، کد کامل، تمیز، واکنش‌گرا و بدون وابستگی شکسته HTML + CSS + JS را در یک بلوک کد ```html بنویس.',
        },
        {
          id: 'w_web_3',
          name: 'کیان (QA)',
          role: 'بازبین و دیباگر',
          icon: '🔍',
          providerId: '',
          model: '',
          keyId: '',
          temperature: 0.3,
          instructions: 'کد تولیدشده را از نظر باگ، دسترسی‌پذیری، زیبایی ظاهری، ریسپانسیو و تجربه کاربری بررسی کن و اصلاحات دقیق را ارائه بده.',
        },
      ],
    },
    {
      id: 'team_research',
      name: 'تیم تحقیق عمیق (Deep Research Team)',
      icon: '🔬',
      description: 'پژوهش موازی از زوایای مختلف، تحلیل داده و تدوین گزارش جامع و مستند.',
      mode: 'parallel',
      maxRounds: 1,
      hitlPause: false,
      manager: {
        name: 'سردبیر تحقیق (Lead Analyst)',
        role: 'سردبیر و تحلیل‌گر ارشد',
        icon: '🧭',
        providerId: '',
        model: '',
        keyId: '',
        temperature: 0.5,
        instructions: 'تو سردبیر و مدیر تحقیق هستی. یافته‌های اعضای تیم را یکپارچه کن، تناقض‌ها را شفاف کن و در نهایت یک گزارش جامع، ساختاریافته و قابل استناد تحویل بده.',
      },
      workers: [
        {
          id: 'w_res_1',
          name: 'پژوهشگر مبانی',
          role: 'پژوهشگر علمی و فنی',
          icon: '📚',
          providerId: '',
          model: '',
          keyId: '',
          temperature: 0.4,
          instructions: 'مفاهیم کلیدی، حقایق بنیادی، پیشینه موضوع و ساختار علمی آن را دقیق و خلاصه استخراج کن.',
        },
        {
          id: 'w_res_2',
          name: 'تحلیل‌گر بازار و کاربرد',
          role: 'تحلیل‌گر عملیاتی',
          icon: '📊',
          providerId: '',
          model: '',
          keyId: '',
          temperature: 0.6,
          instructions: 'کاربردهای واقعی، مزایا، محدودیت‌ها، مقایسه گزینه‌ها و روندهای روز مرتبط با موضوع را بررسی کن.',
        },
        {
          id: 'w_res_3',
          name: 'منتقد و راستی‌آزما',
          role: 'ارزیاب ریسک و دقت',
          icon: '⚖️',
          providerId: '',
          model: '',
          keyId: '',
          temperature: 0.3,
          instructions: 'فرض‌های پنهان، ریسک‌ها، نقاط کور و نکات نیازمند احتیاط در این موضوع را شناسایی و فهرست کن.',
        },
      ],
    },
    {
      id: 'team_architect',
      name: 'تیم معماری و بازبینی کد (Code Review & Architect Squad)',
      icon: '🛡️',
      description: 'طراحی معماری، نقد امنیتی و کارایی، و بازنویسی نهایی در چرخه نقد و بازبینی.',
      mode: 'debate_review',
      maxRounds: 2,
      hitlPause: false,
      manager: {
        name: 'معمار ارشد (Principal Architect)',
        role: 'تصمیم‌گیر نهایی معماری',
        icon: '🏛️',
        providerId: '',
        model: '',
        keyId: '',
        temperature: 0.3,
        instructions: 'تو معمار ارشد نرم‌افزار هستی. پیشنهاد اولیه و نقدهای امنیتی/کارایی را جمع‌بندی کن و نسخه نهایی، تمیز و قابل اجرا را همراه با چک‌لیست تصمیمات ارائه بده.',
      },
      workers: [
        {
          id: 'w_arch_1',
          name: 'مهندس پیاده‌سازی',
          role: 'توسعه‌دهنده ارشد',
          icon: '⚙️',
          providerId: '',
          model: '',
          keyId: '',
          temperature: 0.4,
          instructions: 'معماری پیشنهادی یا پیاده‌سازی اولیه را با کد تمیز، ماژولار و خوانا بنویس و در دورهای بعدی بازخورد منتقد را اعمال کن.',
        },
        {
          id: 'w_arch_2',
          name: 'بازبین امنیت و کارایی',
          role: 'منتقد کد و امنیت',
          icon: '🔐',
          providerId: '',
          model: '',
          keyId: '',
          temperature: 0.2,
          instructions: 'کد و معماری را به شکل سخت‌گیرانه از نظر باگ‌های مرزی، آسیب‌پذیری‌های امنیتی، پیچیدگی زمانی و نگهداری‌پذیری نقد کن و اصلاحات مشخص پیشنهاد بده.',
        },
      ],
    },
    {
      id: 'team_content_seo',
      name: 'تیم محتوا و سئو (Content & SEO Team)',
      icon: '✍️',
      description: 'خط تولید ترتیبی از استراتژی کلمات کلیدی تا نگارش مقاله و ویراستاری نهایی سئو.',
      mode: 'sequential',
      maxRounds: 1,
      hitlPause: false,
      manager: {
        name: 'مدیر محتوا (Content Lead)',
        role: 'سردبیر و ناظر کیفیت',
        icon: '📣',
        providerId: '',
        model: '',
        keyId: '',
        temperature: 0.6,
        instructions: 'تو مدیر محتوا هستی. خروجی نهایی را از نظر لحن برند، خوانایی، ساختار هدینگ‌ها و آماده انتشار بودن تایید و جمع‌بندی کن.',
      },
      workers: [
        {
          id: 'w_seo_1',
          name: 'استراتژیست سئو',
          role: 'متخصص SEO و کلمات کلیدی',
          icon: '🎯',
          providerId: '',
          model: '',
          keyId: '',
          temperature: 0.5,
          instructions: 'قصد جستجوی کاربر، کلمات کلیدی اصلی و فرعی، عنوان سئو، متا دیسکریپشن و ساختار تیترهای H1/H2/H3 را طراحی کن.',
        },
        {
          id: 'w_seo_2',
          name: 'نویسنده ارشد',
          role: 'کپی‌رایتر و تولیدکننده محتوا',
          icon: '📝',
          providerId: '',
          model: '',
          keyId: '',
          temperature: 0.8,
          instructions: 'بر اساس بریف سئو، محتوای کامل، جذاب، روان و کاربردی بنویس که هم برای خواننده ارزشمند باشد و هم ساختار سئو را رعایت کند.',
        },
        {
          id: 'w_seo_3',
          name: 'ویراستار و بهینه‌ساز',
          role: 'ویراستار نهایی',
          icon: '✨',
          providerId: '',
          model: '',
          keyId: '',
          temperature: 0.4,
          instructions: 'متن را ویرایش نگارشی کن، جملات اضافی را حذف کن، خوانایی را بالا ببر و در پایان CTA و خلاصه کلیدی اضافه کن.',
        },
      ],
    },
  ],
  teamRuns: [],
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
      const migratedTeams = Array.isArray(parsed.teams) && parsed.teams.length > 0
        ? parsed.teams.map((t, i) => normalizeTeam(t, i))
        : clone(DEFAULT_STATE.teams);
      const teamRuns = Array.isArray(parsed.teamRuns) ? parsed.teamRuns.slice(0, 20) : [];
      return {
        ...clone(DEFAULT_STATE),
        ...parsed,
        teams: migratedTeams,
        teamRuns,
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
    const p = {
      id: this.uid('prov'),
      slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '_') || this.uid('c'),
      name: name.trim(),
      baseUrl: baseUrl.trim().replace(/\/+$/, ''),
      defaultModel: cleanDefault || cleanModels[0] || '',
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
    const prevDefault = p.defaultModel || '';
    const hasModelsPatch = Array.isArray(patch.models);
    const next = { ...patch };
    if (typeof next.name === 'string') next.name = next.name.trim();
    if (typeof next.baseUrl === 'string') next.baseUrl = next.baseUrl.trim().replace(/\/+$/, '');
    if (hasModelsPatch) {
      next.models = [...new Set(next.models.map((m) => String(m || '').trim()).filter(Boolean))];
    }
    if (typeof next.defaultModel === 'string') {
      next.defaultModel = next.defaultModel.trim();
    }
    Object.assign(p, next);
    if (!Array.isArray(p.models)) p.models = [];
    if (hasModelsPatch) {
      const userChangedDefault = typeof next.defaultModel === 'string' && next.defaultModel !== '' && next.defaultModel !== prevDefault;
      if (p.defaultModel && !p.models.includes(p.defaultModel)) {
        if (userChangedDefault) {
          p.models = [p.defaultModel, ...p.models];
        } else {
          p.defaultModel = p.models[0] || '';
        }
      } else if (!p.defaultModel) {
        p.defaultModel = p.models[0] || '';
      }
    } else if (p.defaultModel) {
      if (!p.models.includes(p.defaultModel)) {
        p.models = [p.defaultModel, ...p.models];
      }
    } else {
      p.defaultModel = p.models[0] || '';
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
    if (
      this.state.activeTarget?.type === 'provider' &&
      this.state.activeTarget.id === providerId &&
      this.state.activeTarget.keyId === keyId
    ) {
      this.state.activeTarget.keyId = '';
    }
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

  // ─── Teams & Team Runs (OpenBot Studio) ───────────────────────────────────
  createTeam(data = {}) {
    const team = normalizeTeam(
      {
        id: this.uid('team'),
        name: data.name || 'تیم جدید',
        icon: data.icon || '🤖',
        description: data.description || '',
        mode: data.mode || 'manager_worker',
        maxRounds: data.maxRounds ?? 1,
        hitlPause: Boolean(data.hitlPause),
        manager: data.manager || {
          name: 'مدیر تیم',
          role: 'مدیر هماهنگ‌کننده',
          icon: '🧠',
          providerId: '',
          model: '',
          keyId: '',
          temperature: 0.7,
          instructions: 'تو مدیر این تیم هستی. هدف کاربر را تحلیل کن، وظایف را هدایت کن و خروجی نهایی یکپارچه تحویل بده.',
        },
        workers: Array.isArray(data.workers) ? data.workers : [],
      },
      this.state.teams.length,
    );
    this.state.teams.push(team);
    this.save();
    return team;
  }

  updateTeam(id, patch = {}) {
    const idx = this.state.teams.findIndex((t) => t.id === id);
    if (idx === -1) return null;
    const current = this.state.teams[idx];
    const merged = {
      ...current,
      ...patch,
      id: current.id,
      manager: patch.manager ? { ...current.manager, ...patch.manager } : current.manager,
      workers: Array.isArray(patch.workers) ? patch.workers : current.workers,
    };
    const updated = normalizeTeam(merged, idx);
    this.state.teams[idx] = updated;
    this.save();
    return updated;
  }

  deleteTeam(id) {
    const prevLen = this.state.teams.length;
    this.state.teams = this.state.teams.filter((t) => t.id !== id);
    if (this.state.teams.length === prevLen) return false;
    this.save();
    return true;
  }

  duplicateTeam(id) {
    const src = this.state.teams.find((t) => t.id === id);
    if (!src) return null;
    const copy = clone(src);
    copy.id = this.uid('team');
    copy.name = `${src.name} (کپی)`;
    copy.workers = (copy.workers || []).map((w) => ({ ...w, id: this.uid('w') }));
    const normalized = normalizeTeam(copy, this.state.teams.length);
    this.state.teams.push(normalized);
    this.save();
    return normalized;
  }

  addTeamWorker(teamId, worker = {}) {
    const team = this.state.teams.find((t) => t.id === teamId);
    if (!team) return null;
    const w = normalizeAgent(
      { ...worker, id: worker.id || this.uid('w') },
      {
        id: this.uid('w'),
        name: worker.name || worker.role || `عضو ${team.workers.length + 1}`,
        role: worker.role || `متخصص ${team.workers.length + 1}`,
        icon: '🤖',
        temperature: 0.7,
        instructions: '',
      },
    );
    team.workers.push(w);
    this.save();
    return w;
  }

  updateTeamWorker(teamId, workerId, patch = {}) {
    const team = this.state.teams.find((t) => t.id === teamId);
    if (!team) return null;
    const idx = team.workers.findIndex((w) => w.id === workerId);
    if (idx === -1) return null;
    const current = team.workers[idx];
    const updated = normalizeAgent({ ...current, ...patch, id: current.id }, current);
    team.workers[idx] = updated;
    this.save();
    return updated;
  }

  deleteTeamWorker(teamId, workerId) {
    const team = this.state.teams.find((t) => t.id === teamId);
    if (!team) return false;
    const prevLen = team.workers.length;
    team.workers = team.workers.filter((w) => w.id !== workerId);
    if (team.workers.length === prevLen) return false;
    this.save();
    return true;
  }

  moveTeamWorker(teamId, workerId, dir) {
    const team = this.state.teams.find((t) => t.id === teamId);
    if (!team) return false;
    const step = dir < 0 ? -1 : dir > 0 ? 1 : 0;
    if (!step) return false;
    const idx = team.workers.findIndex((w) => w.id === workerId);
    if (idx === -1) return false;
    const targetIdx = idx + step;
    if (targetIdx < 0 || targetIdx >= team.workers.length) return false;
    const [item] = team.workers.splice(idx, 1);
    team.workers.splice(targetIdx, 0, item);
    this.save();
    return true;
  }

  addTeamRun(run = {}) {
    if (!Array.isArray(this.state.teamRuns)) this.state.teamRuns = [];
    const entry = {
      id: run.id || this.uid('trun'),
      createdAt: run.createdAt || Date.now(),
      ...clone(run),
    };
    if (!entry.id) entry.id = this.uid('trun');
    if (!entry.createdAt) entry.createdAt = Date.now();
    this.state.teamRuns.unshift(entry);
    if (this.state.teamRuns.length > 20) {
      this.state.teamRuns = this.state.teamRuns.slice(0, 20);
    }
    this.save();
    return entry;
  }

  deleteTeamRun(id) {
    if (!Array.isArray(this.state.teamRuns)) return false;
    const prevLen = this.state.teamRuns.length;
    this.state.teamRuns = this.state.teamRuns.filter((r) => r.id !== id);
    if (this.state.teamRuns.length === prevLen) return false;
    this.save();
    return true;
  }

  // ─── Export / Import Backup ───────────────────────────────────────────────
  exportJson() {
    return JSON.stringify(this.state, null, 2);
  }

  importJson(raw) {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.providers)) throw new Error('Invalid backup file');
    const migratedTeams = Array.isArray(parsed.teams) && parsed.teams.length > 0
      ? parsed.teams.map((t, i) => normalizeTeam(t, i))
      : clone(DEFAULT_STATE.teams);
    const teamRuns = Array.isArray(parsed.teamRuns) ? parsed.teamRuns.slice(0, 20) : [];
    this.state = {
      ...clone(DEFAULT_STATE),
      ...parsed,
      teams: migratedTeams,
      teamRuns,
    };
    this.save();
  }
}

export const store = new Store();

export function maskKey(val) {
  const s = String(val || '');
  if (s.length < 10) return '••••••••';
  return `${s.slice(0, 6)}${'•'.repeat(16)}${s.slice(-4)}`;
}
