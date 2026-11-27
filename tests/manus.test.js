import test from 'node:test';
import assert from 'node:assert/strict';

const memStorage = new Map();
globalThis.localStorage = {
  getItem: (k) => (memStorage.has(k) ? memStorage.get(k) : null),
  setItem: (k, v) => memStorage.set(k, String(v)),
  removeItem: (k) => memStorage.delete(k),
  clear: () => memStorage.clear(),
};

const { store, BUILTIN_PROVIDERS } = await import('../js/store.js');
const { runManusTask, parseManusMessages, isManusProvider } = await import('../js/manus.js');

test('prov_manus is in BUILTIN_PROVIDERS and store.load() merges it into existing localStorage without losing user providers or keys', () => {
  const builtinManus = BUILTIN_PROVIDERS.find((p) => p.id === 'prov_manus');
  assert.ok(builtinManus, 'prov_manus should exist in BUILTIN_PROVIDERS');
  assert.equal(builtinManus.apiType, 'manus-v2');
  assert.deepEqual(builtinManus.models, ['standard', 'max', 'lite']);
  assert.equal(isManusProvider(builtinManus), true);

  const preExistingState = {
    providers: [
      {
        id: 'prov_openai',
        slug: 'openai',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        defaultModel: 'gpt-4o',
        models: ['gpt-4o', 'gpt-4o-mini'],
        keys: [
          {
            id: 'k_existing_oai',
            label: 'Primary OpenAI',
            key: 'sk-existing-openai-secret',
            enabled: true,
          },
        ],
      },
      {
        id: 'prov_custom_user',
        slug: 'custom-vllm',
        name: 'My Custom vLLM',
        baseUrl: 'https://vllm.example.org/v1',
        defaultModel: 'qwen-coder',
        models: ['qwen-coder'],
        keys: [
          {
            id: 'k_existing_custom',
            label: 'Custom Key',
            key: 'sk-custom-vllm-secret',
            enabled: true,
          },
        ],
      },
    ],
  };

  localStorage.setItem('ninerouter_web_v1', JSON.stringify(preExistingState));
  const loaded = store.load();

  const mergedManus = loaded.providers.find((p) => p.id === 'prov_manus');
  assert.ok(mergedManus, 'store.load() should merge prov_manus into pre-existing providers');
  assert.equal(mergedManus.apiType, 'manus-v2');
  assert.deepEqual(mergedManus.models, ['standard', 'max', 'lite']);

  const preservedOpenAi = loaded.providers.find((p) => p.id === 'prov_openai');
  assert.ok(preservedOpenAi, 'Existing built-in provider must be preserved');
  assert.equal(preservedOpenAi.keys.length, 1);
  assert.equal(preservedOpenAi.keys[0].key, 'sk-existing-openai-secret');

  const preservedCustom = loaded.providers.find((p) => p.id === 'prov_custom_user');
  assert.ok(preservedCustom, 'Existing custom user provider must be preserved');
  assert.equal(preservedCustom.keys.length, 1);
  assert.equal(preservedCustom.keys[0].key, 'sk-custom-vllm-secret');
});

test('runManusTask first turn: POST /v2/task.create with x-manus-api-key (no Authorization), polls detail + listMessages?verbose=true, rewrites sandbox paths, and populates BOTH images and attachments', async () => {
  const origFetch = globalThis.fetch;
  const calls = [];
  let detailPolls = 0;

  globalThis.fetch = async (url, init = {}) => {
    const urlStr = String(url);
    const method = (init.method || 'GET').toUpperCase();
    const headers = init.headers || {};
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url: urlStr, method, headers, body });

    if (urlStr.endsWith('/v2/task.create') && method === 'POST') {
      return {
        ok: true,
        status: 200,
        async json() {
          return { task_id: 'task_first_001' };
        },
      };
    }

    if (urlStr.includes('/v2/task.detail?task_id=task_first_001')) {
      detailPolls += 1;
      const status = detailPolls === 1 ? 'running' : 'completed';
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            status,
            usage: { prompt_tokens: 120, completion_tokens: 80, total_tokens: 200 },
          };
        },
      };
    }

    if (urlStr.includes('/v2/task.listMessages?task_id=task_first_001')) {
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            messages: [
              { type: 'user_message', content: 'یک نمودار و فایل PDF بساز' },
              {
                type: 'plan_update',
                steps: [
                  { id: '1', title: 'تحلیل داده‌ها', status: 'done' },
                  { id: '2', title: 'رسم نمودار و ساخت گزارش', status: detailPolls === 1 ? 'in_progress' : 'done' },
                ],
              },
              {
                type: 'tool_used',
                id: 'tool_py_1',
                tool: 'bash',
                brief: 'python3 render_chart.py',
                status: 'done',
              },
              {
                type: 'explanation',
                content: 'نمودار در محیط سندباکس ذخیره شد.',
              },
              ...(detailPolls >= 2
                ? [
                    {
                      type: 'assistant_message',
                      content:
                        'نمودار آماده شد:\n![نمودار فروش](/home/ubuntu/sales_chart.png)\nهمچنین نسخه گزارش: [دانلود گزارش](/home/ubuntu/summary.pdf)',
                      attachments: [
                        {
                          filename: 'sales_chart.png',
                          content_type: 'image/png',
                          path: '/home/ubuntu/sales_chart.png',
                          url: 'https://cdn.manus.ai/files/signed/sales_chart.png?token=abc',
                        },
                        {
                          filename: 'summary.pdf',
                          content_type: 'application/pdf',
                          path: '/home/ubuntu/summary.pdf',
                          url: 'https://cdn.manus.ai/files/signed/summary.pdf?token=def',
                        },
                      ],
                    },
                  ]
                : []),
            ],
          };
        },
      };
    }

    throw new Error(`Unexpected fetch URL: ${urlStr}`);
  };

  try {
    const manusProvider = BUILTIN_PROVIDERS.find((p) => p.id === 'prov_manus');
    const updates = [];
    const res = await runManusTask({
      provider: manusProvider,
      apiKey: 'mn-secret-key-999',
      model: 'max',
      messages: [{ role: 'user', content: 'یک نمودار و فایل PDF بساز' }],
      pollIntervalMs: 1,
      onManusUpdate: (u) => updates.push(u),
    });

    assert.ok(calls.length >= 5, 'Should call task.create + at least 2 polling rounds');
    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].url, 'https://api.manus.ai/v2/task.create');
    assert.equal(calls[0].body.agent_profile, 'max');

    for (const call of calls) {
      const headerNames = Object.keys(call.headers).map((h) => h.toLowerCase());
      assert.ok(headerNames.includes('x-manus-api-key'), 'x-manus-api-key header must be sent');
      assert.equal(call.headers['x-manus-api-key'], 'mn-secret-key-999');
      assert.ok(!headerNames.includes('authorization'), 'Authorization header must NEVER be sent to Manus API v2');
    }

    assert.ok(
      calls.some((c) => c.url.includes('/v2/task.detail?task_id=task_first_001')),
      'Should poll /v2/task.detail',
    );
    assert.ok(
      calls.some((c) => c.url.includes('/v2/task.listMessages') && c.url.includes('verbose=true')),
      'Should poll /v2/task.listMessages with verbose=true',
    );

    assert.equal(res.taskId, 'task_first_001');
    assert.equal(res.manusTaskId, 'task_first_001');
    assert.equal(res.planSteps.length, 2);
    assert.deepEqual(res.planSteps[0], { id: '1', title: 'تحلیل داده‌ها', status: 'done' });
    assert.equal(res.toolEvents.length, 1);
    assert.deepEqual(res.toolEvents[0], {
      id: 'tool_py_1',
      tool: 'bash',
      brief: 'python3 render_chart.py',
      status: 'done',
    });

    assert.ok(!res.text.includes('/home/ubuntu/'), 'Sandbox paths must be rewritten to signed URLs');
    assert.ok(res.text.includes('https://cdn.manus.ai/files/signed/sales_chart.png?token=abc'));
    assert.ok(res.text.includes('https://cdn.manus.ai/files/signed/summary.pdf?token=def'));

    assert.equal(res.images.length, 1, 'Image attachment should populate images for visual display');
    assert.equal(res.images[0].url, 'https://cdn.manus.ai/files/signed/sales_chart.png?token=abc');
    assert.equal(res.images[0].filename, 'sales_chart.png');

    assert.equal(res.attachments.length, 2, 'Both image and PDF must be present in attachments for file download');
    const imgAttachment = res.attachments.find((a) => a.filename === 'sales_chart.png');
    const pdfAttachment = res.attachments.find((a) => a.filename === 'summary.pdf');
    assert.ok(imgAttachment && imgAttachment.isImage === true);
    assert.equal(imgAttachment.url, 'https://cdn.manus.ai/files/signed/sales_chart.png?token=abc');
    assert.ok(pdfAttachment && pdfAttachment.isImage === false);
    assert.ok(updates.length >= 2, 'onManusUpdate should receive live polling updates');
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('runManusTask follow-up turn with existingTaskId: sends POST /v2/task.sendMessage and slices parseManusMessages after latest user_message', async () => {
  const origFetch = globalThis.fetch;
  const calls = [];

  const multiTurnEvents = [
    { type: 'user_message', content: 'نوبت اول: تحقیق اولیه' },
    {
      type: 'plan_update',
      steps: [{ id: 'old_1', title: 'گام قدیمی نوبت اول', status: 'done' }],
    },
    {
      type: 'tool_used',
      id: 'old_tool',
      tool: 'search',
      brief: 'old query',
      status: 'done',
    },
    {
      type: 'assistant_message',
      content: 'پاسخ نوبت اول که نباید در نوبت دوم تکرار شود.',
      attachments: [
        {
          filename: 'old_image.png',
          content_type: 'image/png',
          url: 'https://cdn.manus.ai/files/old_image.png',
        },
      ],
    },
    { type: 'user_message', content: 'نوبت دوم: فقط نتیجه نهایی را در یک جمله بگو' },
    {
      type: 'plan_update',
      steps: [{ id: 'new_1', title: 'جمع‌بندی یک‌خطی', status: 'done' }],
    },
    {
      type: 'tool_used',
      id: 'new_tool',
      tool: 'file_editor',
      brief: 'write final_note.txt',
      status: 'done',
    },
    {
      type: 'assistant_message',
      content: 'نتیجه نهایی نوبت دوم آماده است.',
      question_expectation: {
        options: ['بله، ادامه بده', 'خیر، کافی است'],
      },
    },
  ];

  const slicedDirect = parseManusMessages(multiTurnEvents, true);
  assert.equal(slicedDirect.text, 'نتیجه نهایی نوبت دوم آماده است.');
  assert.equal(slicedDirect.images.length, 0, 'Old turn attachments must be excluded after latest user_message');

  globalThis.fetch = async (url, init = {}) => {
    const urlStr = String(url);
    const method = (init.method || 'GET').toUpperCase();
    const headers = init.headers || {};
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url: urlStr, method, headers, body });

    if (urlStr.endsWith('/v2/task.sendMessage') && method === 'POST') {
      return {
        ok: true,
        status: 200,
        async json() {
          return { task_id: 'task_existing_777' };
        },
      };
    }

    if (urlStr.includes('/v2/task.detail?task_id=task_existing_777')) {
      return {
        ok: true,
        status: 200,
        async json() {
          return { status: 'waiting' };
        },
      };
    }

    if (urlStr.includes('/v2/task.listMessages?task_id=task_existing_777')) {
      return {
        ok: true,
        status: 200,
        async json() {
          return { messages: multiTurnEvents };
        },
      };
    }

    throw new Error(`Unexpected fetch URL in follow-up: ${urlStr}`);
  };

  try {
    const manusProvider = BUILTIN_PROVIDERS.find((p) => p.id === 'prov_manus');
    const res = await runManusTask({
      provider: manusProvider,
      apiKey: 'mn-followup-key',
      model: 'standard',
      existingTaskId: 'task_existing_777',
      messages: [
        { role: 'user', content: 'نوبت اول: تحقیق اولیه' },
        { role: 'assistant', content: 'پاسخ نوبت اول که نباید در نوبت دوم تکرار شود.' },
        { role: 'user', content: 'نوبت دوم: فقط نتیجه نهایی را در یک جمله بگو' },
      ],
      pollIntervalMs: 1,
    });

    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].url, 'https://api.manus.ai/v2/task.sendMessage');
    assert.equal(calls[0].body.task_id, 'task_existing_777');
    assert.equal(
      calls[0].body.message.content[0].text,
      'نوبت دوم: فقط نتیجه نهایی را در یک جمله بگو',
    );
    assert.ok(
      !calls.some((c) => c.url.includes('/v2/task.create')),
      'Follow-up turn must NOT call /v2/task.create',
    );

    assert.equal(res.taskId, 'task_existing_777');
    assert.equal(res.text, 'نتیجه نهایی نوبت دوم آماده است.');
    assert.ok(!res.text.includes('پاسخ نوبت اول'));
    assert.deepEqual(res.planSteps, [{ id: 'new_1', title: 'جمع‌بندی یک‌خطی', status: 'done' }]);
    assert.deepEqual(res.toolEvents, [
      { id: 'new_tool', tool: 'file_editor', brief: 'write final_note.txt', status: 'done' },
    ]);
    assert.deepEqual(res.questionOptions, ['بله، ادامه بده', 'خیر، کافی است']);
  } finally {
    globalThis.fetch = origFetch;
  }
});
