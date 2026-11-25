import test from 'node:test';
import assert from 'node:assert/strict';

const memStorage = new Map();
globalThis.localStorage = {
  getItem: (k) => (memStorage.has(k) ? memStorage.get(k) : null),
  setItem: (k, v) => memStorage.set(k, String(v)),
  removeItem: (k) => memStorage.delete(k),
  clear: () => memStorage.clear(),
};

const { store } = await import('../js/store.js');
const { resolveComboChain, extractTextParts } = await import('../js/router.js');

test('resolveComboChain: fallback order follows graph edges and honors per-node model', () => {
  const combo = {
    id: 'combo_test_edges',
    name: 'Edge Order Test',
    policy: 'fallback',
    nodes: [
      { id: 'n_start', type: 'start', x: 0, y: 0 },
      { id: 'n_policy', type: 'policy', x: 100, y: 0, policy: 'fallback' },
      { id: 'n_p1', type: 'provider', x: 200, y: 0, providerId: 'prov_openrouter', model: 'openai/gpt-4o-mini' },
      { id: 'n_p2', type: 'provider', x: 300, y: 0, providerId: 'prov_gemini', model: 'gemini-2.5-pro' },
    ],
    edges: [
      { from: 'n_start', to: 'n_policy' },
      { from: 'n_policy', to: 'n_p2' },
      { from: 'n_p2', to: 'n_p1' },
    ],
  };

  const res = resolveComboChain(combo);
  assert.equal(res.policy, 'fallback');
  assert.deepEqual(
    res.entries.map((e) => e.provider.id),
    ['prov_gemini', 'prov_openrouter'],
  );
  assert.deepEqual(
    res.entries.map((e) => e.model),
    ['gemini-2.5-pro', 'openai/gpt-4o-mini'],
  );
});

test('resolveComboChain: round_robin rotates providers across calls', () => {
  store.state.rrCursor = 0;
  const combo = {
    id: 'combo_test_rr',
    name: 'RR Test',
    policy: 'round_robin',
    nodes: [
      { id: 'n_start', type: 'start' },
      { id: 'n_policy', type: 'policy', policy: 'round_robin' },
      { id: 'n_p1', type: 'provider', providerId: 'prov_openrouter' },
      { id: 'n_p2', type: 'provider', providerId: 'prov_openai' },
      { id: 'n_p3', type: 'provider', providerId: 'prov_gemini' },
    ],
    edges: [
      { from: 'n_start', to: 'n_policy' },
      { from: 'n_policy', to: 'n_p1' },
      { from: 'n_policy', to: 'n_p2' },
      { from: 'n_policy', to: 'n_p3' },
    ],
  };

  const first = resolveComboChain(combo).providers.map((p) => p.id);
  const second = resolveComboChain(combo).providers.map((p) => p.id);
  const third = resolveComboChain(combo).providers.map((p) => p.id);

  assert.deepEqual(first, ['prov_openrouter', 'prov_openai', 'prov_gemini']);
  assert.deepEqual(second, ['prov_openai', 'prov_gemini', 'prov_openrouter']);
  assert.deepEqual(third, ['prov_gemini', 'prov_openrouter', 'prov_openai']);
});

test('resolveComboChain: providers without edges still resolve', () => {
  const combo = {
    id: 'combo_no_edges',
    name: 'No Edges',
    policy: 'fallback',
    nodes: [
      { id: 'n_start', type: 'start' },
      { id: 'n_p1', type: 'provider', providerId: 'prov_groq', model: 'llama-3.3-70b-versatile' },
      { id: 'n_p2', type: 'provider', providerId: 'prov_deepseek', model: 'deepseek-chat' },
    ],
    edges: [],
  };

  const res = resolveComboChain(combo);
  assert.deepEqual(
    res.entries.map((e) => ({ id: e.provider.id, model: e.model })),
    [
      { id: 'prov_groq', model: 'llama-3.3-70b-versatile' },
      { id: 'prov_deepseek', model: 'deepseek-chat' },
    ],
  );
});

test('extractTextParts: Mistral array/thinking/reasoning content never produces [object Object]', () => {
  const mistralContent = [
    {
      type: 'thinking',
      thinking: [
        { type: 'text', text: 'Step 1: analyze. ' },
        { type: 'text', text: 'Step 2: verify.' },
      ],
    },
    { type: 'reasoning', content: 'Extra reasoning.' },
    { type: 'text', text: 'Final answer.' },
  ];

  const parts = extractTextParts(mistralContent);
  assert.equal(parts.thinking, 'Step 1: analyze. Step 2: verify.Extra reasoning.');
  assert.equal(parts.text, 'Final answer.');
  assert.ok(!parts.text.includes('[object Object]'));
  assert.ok(!parts.thinking.includes('[object Object]'));
});

test('extractTextParts: handles strings, null, and nested objects safely', () => {
  assert.deepEqual(extractTextParts(null), { text: '', thinking: '' });
  assert.deepEqual(extractTextParts(undefined), { text: '', thinking: '' });
  assert.deepEqual(extractTextParts('hello'), { text: 'hello', thinking: '' });
  assert.deepEqual(extractTextParts({ type: 'reasoning', text: 'hmm' }), { text: '', thinking: 'hmm' });
});
