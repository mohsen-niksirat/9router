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
const { extractVariables, substituteVariables } = await import('../js/prompt_utils.js');

test('extractVariables & substituteVariables: handles repeated variables and leaves missing values as-is', () => {
  const tpl = 'زبان: {{lang}} | موضوع: {{topic}} | تکرار: {{ lang }} | بدون‌مقدار: {{missing}}';
  const vars = extractVariables(tpl);
  assert.deepEqual(vars, ['lang', 'topic', 'missing']);

  const filled = substituteVariables(tpl, { lang: 'فارسی', topic: 'معماری نرم‌افزار' });
  assert.equal(
    filled,
    'زبان: فارسی | موضوع: معماری نرم‌افزار | تکرار: فارسی | بدون‌مقدار: {{missing}}'
  );

  // Empty string value leaves placeholder intact
  const partial = substituteVariables('سلام {{name}}', { name: '' });
  assert.equal(partial, 'سلام {{name}}');
});

test('store importJson: old prompt objects without kind/category normalize to kind="prompt" and category="عمومی"', () => {
  const legacyBackup = {
    providers: store.state.providers,
    prompts: [
      { id: 'old_1', title: 'پرامپت قدیمی', text: 'متن تست {{x}}' },
    ],
  };

  store.importJson(JSON.stringify(legacyBackup));
  assert.equal(store.state.prompts.length, 1);
  assert.equal(store.state.prompts[0].kind, 'prompt');
  assert.equal(store.state.prompts[0].category, 'عمومی');
  assert.equal(store.state.prompts[0].title, 'پرامپت قدیمی');
});

test('store.importPromptsJson: rejects malformed JSON without mutating existing prompts', () => {
  const before = JSON.parse(JSON.stringify(store.state.prompts));

  assert.throws(
    () => store.importPromptsJson('{not valid json'),
    (err) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /[\u0600-\u06FF]/);
      return true;
    }
  );

  assert.throws(
    () => store.importPromptsJson(JSON.stringify({ version: 1, prompts: 'not-an-array' })),
    (err) => err instanceof Error
  );

  assert.deepEqual(store.state.prompts, before, 'State must not mutate when importPromptsJson fails');
});
