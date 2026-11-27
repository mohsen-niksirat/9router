/**
 * 9Router Web — Local-first BYOK Store (localStorage)
 * Unified Providers & Keys, Visual Node Combos, Chat Sessions, Prompt Library, Settings.
 */

import { computeAutoLayout, normalizeTeamLayout } from './team_graph.js';

const STORAGE_KEY = 'ninerouter_web_v1';

export const BUILTIN_PROVIDERS = [
  {
    id: 'prov_apisfreellm',
    slug: 'apisfreellm',
    name: 'APIsFreeLLM (رایگان)',
    baseUrl: 'https://api.apisfreellm.com/v1',
    apiType: 'openai',
    defaultModel: 'free-ai',
    models: ['free-ai'],
    color: '#22c55e',
    pinned: true,
    isBuiltin: true,
    supportsImages: false,
    noKey: true,
    keys: [],
  },
  {
    id: 'prov_manus',
    slug: 'manus',
    name: 'Manus AI',
    baseUrl: 'https://api.manus.ai',
    apiType: 'manus-v2',
    defaultModel: 'standard',
    models: ['standard', 'max', 'lite'],
    color: '#8b5cf6',
    pinned: true,
    isBuiltin: true,
    supportsImages: true,
    noKey: false,
    keys: [],
  },
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
    noKey: false,
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
    noKey: false,
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
    noKey: false,
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
    noKey: false,
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
    noKey: false,
    keys: [],
  },
  {
    id: 'prov_ollama',
    slug: 'ollama',
    name: 'Ollama',
    baseUrl: 'http://localhost:11434/v1',
    defaultModel: 'llama3.1',
    models: ['llama3.1', 'qwen2.5', 'mistral'],
    color: '#a855f7',
    pinned: false,
    isBuiltin: true,
    supportsImages: false,
    noKey: true,
    keys: [],
  },
  {
    id: 'prov_lmstudio',
    slug: 'lmstudio',
    name: 'LM Studio',
    baseUrl: 'http://localhost:1234/v1',
    defaultModel: '',
    models: [],
    color: '#14b8a6',
    pinned: false,
    isBuiltin: true,
    supportsImages: false,
    noKey: true,
    keys: [],
  },
];

export const DEFAULT_MODEL_PRICES = {
  'prov_apisfreellm|free-ai': { inPer1M: 0, outPer1M: 0 },
  'prov_openrouter|google/gemini-2.5-flash': { inPer1M: 0.15, outPer1M: 0.6 },
  'prov_openrouter|deepseek/deepseek-r1': { inPer1M: 0.55, outPer1M: 2.19 },
  'prov_openrouter|anthropic/claude-sonnet-4': { inPer1M: 3.0, outPer1M: 15.0 },
  'prov_openrouter|openai/gpt-4o-mini': { inPer1M: 0.15, outPer1M: 0.6 },
  'prov_openai|gpt-4o-mini': { inPer1M: 0.15, outPer1M: 0.6 },
  'prov_openai|gpt-4o': { inPer1M: 2.5, outPer1M: 10.0 },
  'prov_openai|gpt-4.1-mini': { inPer1M: 0.4, outPer1M: 1.6 },
  'prov_gemini|gemini-2.5-flash': { inPer1M: 0.15, outPer1M: 0.6 },
  'prov_gemini|gemini-2.5-flash-lite': { inPer1M: 0.1, outPer1M: 0.4 },
  'prov_gemini|gemini-2.5-pro': { inPer1M: 1.25, outPer1M: 10.0 },
  'prov_groq|llama-3.3-70b-versatile': { inPer1M: 0.59, outPer1M: 0.79 },
  'prov_groq|llama-3.1-8b-instant': { inPer1M: 0.05, outPer1M: 0.08 },
  'prov_groq|deepseek-r1-distill-llama-70b': { inPer1M: 0.75, outPer1M: 0.99 },
  'prov_deepseek|deepseek-chat': { inPer1M: 0.27, outPer1M: 1.1 },
  'prov_deepseek|deepseek-reasoner': { inPer1M: 0.55, outPer1M: 2.19 },
  'prov_ollama|llama3.1': { inPer1M: 0, outPer1M: 0 },
  'prov_ollama|qwen2.5': { inPer1M: 0, outPer1M: 0 },
  'prov_ollama|mistral': { inPer1M: 0, outPer1M: 0 },
};

const USAGE_MAX_EVENTS = 1000;
const USAGE_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

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
  const normalized = {
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
  normalized.layout = normalizeTeamLayout({ ...normalized, layout: team.layout });
  return normalized;
}

function normalizeProvider(p = {}) {
  return {
    ...p,
    apiType: p.apiType === 'manus-v2' || /api\.manus\.ai/i.test(String(p.baseUrl || '')) ? 'manus-v2' : 'openai',
    models: Array.isArray(p.models) ? p.models : [],
    keys: Array.isArray(p.keys) ? p.keys : [],
    noKey: Boolean(p.noKey),
  };
}

function mergeBuiltinProviders(rawProviders) {
  if (!Array.isArray(rawProviders)) {
    return clone(BUILTIN_PROVIDERS).map((p) => normalizeProvider(p));
  }
  const migrated = rawProviders.map((p) => normalizeProvider(p));
  const existingIds = new Set(migrated.map((p) => p.id));
  const existingSlugs = new Set(migrated.map((p) => String(p.slug || '').toLowerCase()).filter(Boolean));
  for (const bp of BUILTIN_PROVIDERS) {
    const bpSlug = String(bp.slug || '').toLowerCase();
    const isDuplicateManus =
      bpSlug === 'manus' &&
      (existingSlugs.has('manus') ||
        migrated.some((p) => p.apiType === 'manus-v2' || /api\.manus\.ai/i.test(String(p.baseUrl || ''))));
    if (!existingIds.has(bp.id) && !isDuplicateManus && !(bpSlug && existingSlugs.has(bpSlug))) {
      migrated.push(normalizeProvider(clone(bp)));
    }
  }
  return migrated;
}

function normalizePrompt(p = {}, index = 0) {
  const kind = p.kind === 'system' ? 'system' : 'prompt';
  const category = String(p.category || '').trim() || 'عمومی';
  return {
    id: String(p.id || `prm_${index + 1}`),
    title: String(p.title || '').trim() || 'پرامپت بدون عنوان',
    text: String(p.text || ''),
    category,
    kind,
  };
}

function pruneUsageEvents(events, now = Date.now()) {
  if (!Array.isArray(events)) return [];
  const cutoff = now - USAGE_MAX_AGE_MS;
  const recent = events.filter((e) => e && typeof e === 'object' && Number(e.ts) >= cutoff);
  return recent.length > USAGE_MAX_EVENTS ? recent.slice(-USAGE_MAX_EVENTS) : recent;
}

function normalizeModelPrices(raw) {
  const merged = { ...clone(DEFAULT_MODEL_PRICES) };
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw)) {
      if (!k || !v || typeof v !== 'object') continue;
      const inPer1M = Number(v.inPer1M);
      const outPer1M = Number(v.outPer1M);
      merged[k] = {
        inPer1M: Number.isFinite(inPer1M) && inPer1M >= 0 ? inPer1M : 0,
        outPer1M: Number.isFinite(outPer1M) && outPer1M >= 0 ? outPer1M : 0,
      };
    }
  }
  return merged;
}

const DEFAULT_STATE = {
  providers: BUILTIN_PROVIDERS.map((p) => normalizeProvider(p)),
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
  activeTarget: { type: 'provider', id: 'prov_apisfreellm', model: 'free-ai' }, // { type: 'combo'|'provider', id, model?, keyId? }
  sessions: [],
  activeSessionId: null,
  prompts: [
    { id: 'prm_1', title: 'کدنویس ارشد', text: 'تو یک مهندس نرم‌افزار ارشد هستی. کد تمیز، بهینه و بدون توضیح اضافه بده.', category: 'کدنویسی', kind: 'system' },
    { id: 'prm_2', title: 'مترجم روان', text: 'متن زیر را به فارسی بسیار روان، طبیعی و حرفه‌ای ترجمه کن:', category: 'ترجمه', kind: 'prompt' },
    { id: 'prm_3', title: 'بازبین کد و امنیت', text: 'کد زیر را از نظر باگ‌های احتمالی، آسیب‌پذیری‌های امنیتی، کارایی و خوانایی بررسی کن و اصلاحات پیشنهادی را با دلیل دقیق بنویس:\n', category: 'کدنویسی', kind: 'prompt' },
    { id: 'prm_4', title: 'مترجم تخصصی فنی', text: 'تو یک مترجم ارشد متون فنی و مهندسی نرم‌افزار هستی. اصطلاحات تخصصی استاندارد را حفظ کن، لحن را دقیق و طبیعی نگه دار و از ترجمه تحت‌اللفظی پرهیز کن.', category: 'ترجمه', kind: 'system' },
    { id: 'prm_5', title: 'نویسنده مقاله و بلاگ', text: 'درباره موضوع زیر یک مقاله ساختاریافته، جذاب و کاربردی با تیترهای مشخص، مثال‌های واقعی و جمع‌بندی کوتاه بنویس:\n', category: 'تولید محتوا', kind: 'prompt' },
    { id: 'prm_6', title: 'خلاصه‌ساز و تحلیل‌گر متن', text: 'متن زیر را تحلیل کن و خروجی را در سه بخش «خلاصه اجرایی»، «نکات کلیدی» و «اقدامات پیشنهادی» ارائه بده:\n', category: 'تحلیل', kind: 'prompt' },
    { id: 'prm_7', title: 'تحلیل‌گر استراتژیک داده', text: 'تو یک تحلیل‌گر ارشد داده و محصول هستی. پاسخ‌ها را ساختاریافته، مبتنی بر شواهد، همراه با مقایسه گزینه‌ها، ریسک‌ها و پیشنهاد عملی ارائه بده.', category: 'تحلیل', kind: 'system' },
  ],
  usageEvents: [],
  modelPrices: DEFAULT_MODEL_PRICES,
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

DEFAULT_STATE.teams = DEFAULT_STATE.teams.map((t, i) => normalizeTeam(t, i));

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

const RUN_TRUNCATE_NOTE = '\n\n[توجه: به دلیل محدودیت حافظه مرورگر، بخشی از متن کوتاه شد]';
const MAX_RUN_TEXT_LEN = 100000;
const MAX_RUN_HTML_LEN = 200000;

function capRunField(val, maxLen) {
  if (typeof val !== 'string' || val.length <= maxLen) {
    return { value: val, truncated: false };
  }
  return { value: val.slice(0, maxLen) + RUN_TRUNCATE_NOTE, truncated: true };
}

class Store {
  constructor() {
    this.state = this.load();
    this.listeners = new Set();
    this._storageErrorNotified = false;
  }

  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        const fresh = clone(DEFAULT_STATE);
        this.state = fresh;
        return fresh;
      }
      const parsed = JSON.parse(raw);
      const migratedProviders = Array.isArray(parsed.providers)
        ? mergeBuiltinProviders(parsed.providers)
        : clone(DEFAULT_STATE.providers);
      const migratedPrompts = Array.isArray(parsed.prompts)
        ? parsed.prompts.map((p, i) => normalizePrompt(p, i))
        : clone(DEFAULT_STATE.prompts);
      const migratedTeams = Array.isArray(parsed.teams) && parsed.teams.length > 0
        ? parsed.teams.map((t, i) => normalizeTeam(t, i))
        : clone(DEFAULT_STATE.teams);
      const teamRuns = Array.isArray(parsed.teamRuns) ? parsed.teamRuns.slice(0, 20) : [];
      const usageEvents = pruneUsageEvents(parsed.usageEvents);
      const modelPrices = normalizeModelPrices(parsed.modelPrices);
      const nextState = {
        ...clone(DEFAULT_STATE),
        ...parsed,
        providers: migratedProviders,
        prompts: migratedPrompts,
        teams: migratedTeams,
        teamRuns,
        usageEvents,
        modelPrices,
        settings: {
          ...DEFAULT_STATE.settings,
          ...(parsed.settings || {}),
          webSearch: {
            ...DEFAULT_STATE.settings.webSearch,
            ...(parsed.settings?.webSearch || {}),
          },
        },
      };
      this.state = nextState;
      return nextState;
    } catch {
      const fallback = clone(DEFAULT_STATE);
      this.state = fallback;
      return fallback;
    }
  }

  save() {
    let ok = true;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
      this._storageErrorNotified = false;
    } catch {
      ok = false;
      if (!this._storageErrorNotified) {
        this._storageErrorNotified = true;
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
          window.dispatchEvent(new CustomEvent('ninerouter:storage-error', {
            detail: { message: 'حافظه مرورگر پر شده است. لطفاً تاریخچه یا چت‌های قدیمی را پاک کنید.' },
          }));
        }
      }
    }
    for (const fn of this.listeners) fn(this.state);
    return ok;
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  uid(prefix = 'id') {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  }

  // ─── Providers & Keys (Unified) ───────────────────────────────────────────
  addProvider({ name, baseUrl, apiType, defaultModel = '', models = [], color = '#f59e0b', supportsImages = false, noKey = false }) {
    const cleanBaseUrl = baseUrl.trim().replace(/\/+$/, '');
    const resolvedApiType = apiType === 'manus-v2' || /api\.manus\.ai/i.test(cleanBaseUrl) ? 'manus-v2' : 'openai';
    let cleanModels = [...new Set(models.map((m) => String(m || '').trim()).filter(Boolean))];
    if (resolvedApiType === 'manus-v2' && !cleanModels.length) {
      cleanModels = ['standard', 'max', 'lite'];
    }
    const cleanDefault = String(defaultModel || '').trim();
    if (cleanDefault && !cleanModels.includes(cleanDefault)) {
      cleanModels = [cleanDefault, ...cleanModels];
    }
    const p = {
      id: this.uid('prov'),
      slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '_') || this.uid('c'),
      name: name.trim(),
      baseUrl: cleanBaseUrl,
      apiType: resolvedApiType,
      defaultModel: cleanDefault || cleanModels[0] || '',
      models: cleanModels,
      color,
      pinned: false,
      isBuiltin: false,
      supportsImages,
      noKey: Boolean(noKey),
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
    if (next.noKey !== undefined) next.noKey = Boolean(next.noKey);
    if (hasModelsPatch) {
      next.models = [...new Set(next.models.map((m) => String(m || '').trim()).filter(Boolean))];
    }
    if (typeof next.defaultModel === 'string') {
      next.defaultModel = next.defaultModel.trim();
    }
    Object.assign(p, next);
    p.apiType =
      (next.apiType ?? p.apiType) === 'manus-v2' || /api\.manus\.ai/i.test(String(p.baseUrl || ''))
        ? 'manus-v2'
        : 'openai';
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
    const workerIdMap = new Map();
    copy.workers = (copy.workers || []).map((w) => {
      const newId = this.uid('w');
      workerIdMap.set(w.id, newId);
      return { ...w, id: newId };
    });
    if (copy.layout && copy.layout.nodes && typeof copy.layout.nodes === 'object') {
      const remappedNodes = {};
      for (const [k, pos] of Object.entries(copy.layout.nodes)) {
        const targetKey = workerIdMap.has(k) ? workerIdMap.get(k) : k;
        remappedNodes[targetKey] = { ...pos };
      }
      copy.layout = { nodes: remappedNodes };
    }
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
    team.layout = normalizeTeamLayout(team);
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
    if (team.layout?.nodes && Object.prototype.hasOwnProperty.call(team.layout.nodes, workerId)) {
      delete team.layout.nodes[workerId];
    }
    this.save();
    return true;
  }

  setTeamNodePosition(teamId, nodeKey, x, y) {
    const team = this.state.teams.find((t) => t.id === teamId);
    if (!team) return null;
    const key = String(nodeKey || '').trim();
    const nx = Number(x);
    const ny = Number(y);
    if (!key || !Number.isFinite(nx) || !Number.isFinite(ny)) return null;
    if (!team.layout || !team.layout.nodes || typeof team.layout.nodes !== 'object') {
      team.layout = normalizeTeamLayout(team);
    }
    team.layout.nodes[key] = { x: Math.round(nx), y: Math.round(ny) };
    this.save();
    return team.layout.nodes[key];
  }

  resetTeamLayout(teamId) {
    const team = this.state.teams.find((t) => t.id === teamId);
    if (!team) return null;
    team.layout = computeAutoLayout(team);
    this.save();
    return team.layout;
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

    let wasTruncated = Boolean(entry.truncated);
    const mdCap = capRunField(entry.fullReportMd, MAX_RUN_TEXT_LEN);
    entry.fullReportMd = mdCap.value;
    if (mdCap.truncated) wasTruncated = true;

    const textCap = capRunField(entry.finalText, MAX_RUN_TEXT_LEN);
    entry.finalText = textCap.value;
    if (textCap.truncated) wasTruncated = true;

    const htmlCap = capRunField(entry.finalHtml, MAX_RUN_HTML_LEN);
    entry.finalHtml = htmlCap.value;
    if (htmlCap.truncated) wasTruncated = true;

    if (wasTruncated) entry.truncated = true;

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

  // ─── Usage Ledger & Model Prices ──────────────────────────────────────────
  addUsageEvent(evt = {}) {
    if (!Array.isArray(this.state.usageEvents)) this.state.usageEvents = [];
    const tokensIn = Math.max(0, Math.round(Number(evt.tokensIn) || 0));
    const tokensOut = Math.max(0, Math.round(Number(evt.tokensOut) || 0));
    const rawTotal = Math.max(0, Math.round(Number(evt.totalTokens) || 0));
    const entry = {
      ts: Number(evt.ts) || Date.now(),
      providerId: String(evt.providerId || ''),
      providerName: String(evt.providerName || ''),
      model: String(evt.model || ''),
      tokensIn,
      tokensOut,
      totalTokens: rawTotal || (tokensIn + tokensOut),
      estimated: Boolean(evt.estimated),
    };
    this.state.usageEvents.push(entry);
    if (this.state.usageEvents.length > USAGE_MAX_EVENTS) {
      this.state.usageEvents = this.state.usageEvents.slice(-USAGE_MAX_EVENTS);
    }
    this.save();
    return entry;
  }

  setModelPrice(key, { inPer1M = 0, outPer1M = 0 } = {}) {
    const cleanKey = String(key || '').trim();
    if (!cleanKey) return null;
    if (!this.state.modelPrices || typeof this.state.modelPrices !== 'object') {
      this.state.modelPrices = {};
    }
    const inVal = Number(inPer1M);
    const outVal = Number(outPer1M);
    const entry = {
      inPer1M: Number.isFinite(inVal) && inVal >= 0 ? inVal : 0,
      outPer1M: Number.isFinite(outVal) && outVal >= 0 ? outVal : 0,
    };
    this.state.modelPrices[cleanKey] = entry;
    this.save();
    return entry;
  }

  deleteModelPrice(key) {
    const cleanKey = String(key || '').trim();
    if (!cleanKey || !this.state.modelPrices || !Object.prototype.hasOwnProperty.call(this.state.modelPrices, cleanKey)) {
      return false;
    }
    delete this.state.modelPrices[cleanKey];
    this.save();
    return true;
  }

  // ─── Prompt Library Pro ───────────────────────────────────────────────────
  addPrompt(data = {}) {
    if (!Array.isArray(this.state.prompts)) this.state.prompts = [];
    const prompt = normalizePrompt(
      {
        ...data,
        id: this.uid('prm'),
      },
      this.state.prompts.length,
    );
    this.state.prompts.unshift(prompt);
    this.save();
    return prompt;
  }

  updatePrompt(id, patch = {}) {
    if (!Array.isArray(this.state.prompts)) return null;
    const idx = this.state.prompts.findIndex((p) => p.id === id);
    if (idx === -1) return null;
    const current = this.state.prompts[idx];
    const updated = normalizePrompt({ ...current, ...patch, id: current.id }, idx);
    this.state.prompts[idx] = updated;
    this.save();
    return updated;
  }

  deletePrompt(id) {
    if (!Array.isArray(this.state.prompts)) return false;
    const prevLen = this.state.prompts.length;
    this.state.prompts = this.state.prompts.filter((p) => p.id !== id);
    if (this.state.prompts.length === prevLen) return false;
    this.save();
    return true;
  }

  duplicatePrompt(id) {
    if (!Array.isArray(this.state.prompts)) return null;
    const idx = this.state.prompts.findIndex((p) => p.id === id);
    if (idx === -1) return null;
    const src = this.state.prompts[idx];
    const copy = normalizePrompt(
      {
        ...clone(src),
        id: this.uid('prm'),
        title: `${src.title} (کپی)`,
      },
      this.state.prompts.length,
    );
    this.state.prompts.splice(idx + 1, 0, copy);
    this.save();
    return copy;
  }

  exportPromptsJson() {
    const prompts = Array.isArray(this.state.prompts) ? this.state.prompts : [];
    return JSON.stringify({ version: 1, prompts }, null, 2);
  }

  importPromptsJson(jsonStr) {
    if (typeof jsonStr !== 'string' || !jsonStr.trim()) {
      throw new Error('متن JSON خالی است. لطفاً فایل یا متن معتبر پرامپت‌ها را وارد کنید.');
    }
    let parsed;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      throw new Error('فرمت JSON نامعتبر است. لطفاً ساختار فایل را بررسی کنید.');
    }
    const rawList = Array.isArray(parsed) ? parsed : (parsed && typeof parsed === 'object' && Array.isArray(parsed.prompts) ? parsed.prompts : null);
    if (!rawList) {
      throw new Error('ساختار فایل پرامپت‌ها نامعتبر است؛ آرایه‌ای از پرامپت‌ها مورد انتظار است.');
    }
    if (rawList.length === 0) {
      throw new Error('فایل واردشده هیچ پرامپتی ندارد.');
    }
    const validated = [];
    for (let i = 0; i < rawList.length; i++) {
      const item = rawList[i];
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw new Error(`آیتم شماره ${i + 1} در فایل پرامپت‌ها ساختار معتبر ندارد.`);
      }
      if (typeof item.title !== 'string' || !item.title.trim()) {
        throw new Error(`پرامپت شماره ${i + 1} عنوان معتبر ندارد.`);
      }
      if (typeof item.text !== 'string' || !item.text.trim()) {
        throw new Error(`پرامپت شماره ${i + 1} متن معتبر ندارد.`);
      }
      if (item.kind !== undefined && item.kind !== 'prompt' && item.kind !== 'system') {
        throw new Error(`نوع (kind) پرامپت شماره ${i + 1} نامعتبر است؛ فقط prompt یا system مجاز است.`);
      }
      validated.push(normalizePrompt({ ...item, id: this.uid('prm') }, i));
    }
    if (!Array.isArray(this.state.prompts)) this.state.prompts = [];
    this.state.prompts = [...validated, ...this.state.prompts];
    this.save();
    return validated;
  }

  // ─── Export / Import Backup ───────────────────────────────────────────────
  exportJson() {
    return JSON.stringify(this.state, null, 2);
  }

  importJson(raw) {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.providers)) throw new Error('Invalid backup file');
    const migratedProviders = mergeBuiltinProviders(parsed.providers);
    const migratedPrompts = Array.isArray(parsed.prompts)
      ? parsed.prompts.map((p, i) => normalizePrompt(p, i))
      : clone(DEFAULT_STATE.prompts);
    const migratedTeams = Array.isArray(parsed.teams) && parsed.teams.length > 0
      ? parsed.teams.map((t, i) => normalizeTeam(t, i))
      : clone(DEFAULT_STATE.teams);
    const teamRuns = Array.isArray(parsed.teamRuns) ? parsed.teamRuns.slice(0, 20) : [];
    const usageEvents = pruneUsageEvents(parsed.usageEvents);
    const modelPrices = normalizeModelPrices(parsed.modelPrices);
    this.state = {
      ...clone(DEFAULT_STATE),
      ...parsed,
      providers: migratedProviders,
      prompts: migratedPrompts,
      teams: migratedTeams,
      teamRuns,
      usageEvents,
      modelPrices,
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
