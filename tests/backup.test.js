import test from 'node:test';
import assert from 'node:assert/strict';

import { encryptBackup, decryptBackup, isEncryptedBackup } from '../js/export_utils.js';

test('encrypted backup round-trip: encrypt -> decrypt returns original object', async () => {
  const payload = {
    providers: [{ id: 'prov_openai', keys: [{ id: 'k1', value: 'sk-test-secret-123456' }] }],
    settings: { temperature: 0.5 },
    teams: [{ id: 't1', name: 'تیم آزمایشی' }],
  };

  const encrypted = await encryptBackup(payload, 'StrongPassphrase!2026');
  assert.equal(isEncryptedBackup(encrypted), true);
  assert.ok(!encrypted.includes('sk-test-secret-123456'));

  const decrypted = await decryptBackup(encrypted, 'StrongPassphrase!2026');
  assert.deepEqual(decrypted, payload);
});

test('encrypted backup: wrong passphrase throws clear error', async () => {
  const encrypted = await encryptBackup({ secret: 'value' }, 'correct-pass');
  await assert.rejects(
    () => decryptBackup(encrypted, 'wrong-pass'),
    (err) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /رمز عبور اشتباه|Incorrect passphrase/);
      return true;
    },
  );
});

test('isEncryptedBackup: rejects plain backups and malformed inputs', () => {
  const plainBackup = JSON.stringify({ providers: [], sessions: [] });
  assert.equal(isEncryptedBackup(plainBackup), false);
  assert.equal(isEncryptedBackup({ providers: [] }), false);
  assert.equal(isEncryptedBackup('{not valid json'), false);
  assert.equal(isEncryptedBackup(null), false);
});
