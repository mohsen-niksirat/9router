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
const { runChatCompletion } = await import('../js/router.js');

test('local provider (noKey: true): sends completion with NO Authorization header and NO key', async () => {
  store.state.keys = [];
  const ollama = store.state.providers.find((p) => p.id === 'prov_ollama');
  assert.ok(ollama, 'Built-in Ollama provider should exist');
  assert.equal(ollama.noKey, true);

  let capturedUrl = null;
  let capturedHeaders = null;
  const origFetch = globalThis.fetch;

  globalThis.fetch = async (url, init = {}) => {
    capturedUrl = String(url);
    capturedHeaders = init.headers || {};
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      async json() {
        return {
          choices: [{ message: { content: 'سلام از مدل محلی' } }],
          usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
        };
      },
    };
  };

  try {
    const res = await runChatCompletion({
      targetOverride: { type: 'provider', id: 'prov_ollama', model: 'llama3.1' },
      messages: [{ role: 'user', content: 'سلام' }],
    });

    assert.equal(res.text, 'سلام از مدل محلی');
    assert.ok(capturedUrl.endsWith('/chat/completions'));
    const headerKeys = Object.keys(capturedHeaders).map((k) => k.toLowerCase());
    assert.ok(!headerKeys.includes('authorization'), 'Authorization header must NOT be sent for noKey providers');
    assert.equal((ollama.keys || []).length, 0, 'No fake key records should be created');
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('keyed provider (noKey: false) with no keys still fails with Persian error', async () => {
  store.state.keys = [];
  const openai = store.state.providers.find((p) => p.id === 'prov_openai');
  assert.ok(openai, 'Built-in OpenAI provider should exist');
  assert.equal(openai.noKey, false);

  await assert.rejects(
    async () => {
      await runChatCompletion({
        targetOverride: { type: 'provider', id: 'prov_openai', model: 'gpt-4o-mini' },
        messages: [{ role: 'user', content: 'hello' }],
      });
    },
    (err) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /[\u0600-\u06FF]/, 'Error message should be in Persian');
      return true;
    }
  );
});
