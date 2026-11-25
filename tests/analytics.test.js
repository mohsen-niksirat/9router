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
const { aggregateUsage } = await import('../js/analytics.js');

test('aggregateUsage: sums tokens per provider/model/period and computes exact cost formula', () => {
  const now = new Date('2026-05-10T15:00:00Z').getTime();
  const MS_DAY = 86_400_000;

  const events = [
    {
      ts: now - 1000,
      providerId: 'prov_openai',
      providerName: 'OpenAI',
      model: 'gpt-4o-mini',
      tokensIn: 1000,
      tokensOut: 500,
      totalTokens: 1500,
    },
    {
      ts: now - 2 * MS_DAY,
      providerId: 'prov_openai',
      providerName: 'OpenAI',
      model: 'gpt-4o-mini',
      tokensIn: 2000,
      tokensOut: 1000,
      totalTokens: 3000,
    },
    {
      ts: now - 3 * MS_DAY,
      providerId: 'prov_ollama',
      providerName: 'Ollama',
      model: 'llama3.1',
      tokensIn: 400,
      tokensOut: 600,
      totalTokens: 1000,
    },
    // Outside 7d window (10 days ago)
    {
      ts: now - 10 * MS_DAY,
      providerId: 'prov_openai',
      providerName: 'OpenAI',
      model: 'gpt-4o-mini',
      tokensIn: 9999,
      tokensOut: 9999,
      totalTokens: 19998,
    },
  ];

  const prices = {
    'prov_openai|gpt-4o-mini': { inPer1M: 0.15, outPer1M: 0.6 },
  };

  const agg7d = aggregateUsage(events, prices, '7d', now);
  assert.equal(agg7d.totalRequests, 3);
  assert.equal(agg7d.totalTokensIn, 3400);
  assert.equal(agg7d.totalTokensOut, 2100);
  assert.equal(agg7d.totalTokens, 5500);

  // Expected cost for OpenAI: (3000 / 1e6) * 0.15 + (1500 / 1e6) * 0.6 = 0.00045 + 0.0009 = 0.00135
  const expectedCost = (3000 / 1e6) * 0.15 + (1500 / 1e6) * 0.6;
  assert.ok(Math.abs(agg7d.totalCost - expectedCost) < 1e-12);
  assert.equal(agg7d.hasAnyPriced, true);

  const openaiRow = agg7d.byProvider.find((p) => p.providerId === 'prov_openai');
  assert.ok(openaiRow);
  assert.equal(openaiRow.totalTokens, 4500);
  assert.ok(Math.abs(openaiRow.cost - expectedCost) < 1e-12);

  // Unpriced model contributes tokens and null cost
  const ollamaRow = agg7d.byProvider.find((p) => p.providerId === 'prov_ollama');
  assert.ok(ollamaRow);
  assert.equal(ollamaRow.totalTokens, 1000);
  assert.equal(ollamaRow.cost, null);

  const ollamaModel = agg7d.byModel.find((m) => m.key === 'prov_ollama|llama3.1');
  assert.ok(ollamaModel);
  assert.equal(ollamaModel.totalTokens, 1000);
  assert.equal(ollamaModel.cost, null);

  // Period '30d' includes the 10-day-old event
  const agg30d = aggregateUsage(events, prices, '30d', now);
  assert.equal(agg30d.totalRequests, 4);
  assert.equal(agg30d.totalTokens, 5500 + 19998);
});

test('aggregateUsage: all-unpriced events return totalCost === null', () => {
  const now = Date.now();
  const events = [
    {
      ts: now - 500,
      providerId: 'prov_ollama',
      providerName: 'Ollama',
      model: 'mistral',
      tokensIn: 250,
      tokensOut: 250,
      totalTokens: 500,
    },
  ];
  const agg = aggregateUsage(events, {}, 'today', now);
  assert.equal(agg.totalRequests, 1);
  assert.equal(agg.totalTokens, 500);
  assert.equal(agg.totalCost, null);
  assert.equal(agg.hasAnyPriced, false);
});

test('store.addUsageEvent: caps stored usageEvents at 1,000 most recent', () => {
  store.state.usageEvents = [];
  const baseTs = Date.now() - 2000 * 1000;
  for (let i = 1; i <= 1050; i++) {
    store.addUsageEvent({
      ts: baseTs + i * 1000,
      providerId: 'prov_openai',
      providerName: 'OpenAI',
      model: 'gpt-4o-mini',
      tokensIn: 10,
      tokensOut: 5,
      totalTokens: 15,
    });
  }
  assert.equal(store.state.usageEvents.length, 1000);
  // Oldest 50 should have been dropped
  assert.equal(store.state.usageEvents[0].ts, baseTs + 51 * 1000);
  assert.equal(store.state.usageEvents[999].ts, baseTs + 1050 * 1000);
});
