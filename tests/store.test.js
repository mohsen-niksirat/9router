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

test('store team normalization: invalid mode, maxRounds clamping, and temperature clamping', () => {
  const team = store.createTeam({
    name: 'Test Team',
    mode: 'nonexistent_mode',
    maxRounds: 99,
    manager: { name: 'Mgr', role: 'Lead', temperature: 5.5 },
    workers: [
      { id: 'w1', name: 'W1', role: 'Dev', temperature: -2 },
      { id: 'w2', name: 'W2', role: 'QA', temperature: 'not-a-number' },
    ],
  });

  assert.equal(team.mode, 'manager_worker');
  assert.equal(team.maxRounds, 10);
  assert.equal(team.manager.temperature, 2);
  assert.equal(team.workers[0].temperature, 0);
  assert.equal(team.workers[1].temperature, 0.7);

  const updated = store.updateTeam(team.id, { maxRounds: -3 });
  assert.equal(updated.maxRounds, 1);
});

test('store importJson: old backup team missing new fields normalizes without losing workers', () => {
  const legacyBackup = {
    providers: store.state.providers,
    teams: [
      {
        id: 'legacy_team_1',
        name: 'Legacy Squad',
        manager: { name: 'Old Manager', role: 'Boss' },
        workers: [
          { name: 'Worker A', role: 'Coder' },
          { name: 'Worker B', role: 'Reviewer' },
        ],
      },
    ],
  };

  store.importJson(JSON.stringify(legacyBackup));
  assert.equal(store.state.teams.length, 1);
  const t = store.state.teams[0];
  assert.equal(t.id, 'legacy_team_1');
  assert.equal(t.mode, 'manager_worker');
  assert.equal(t.maxRounds, 1);
  assert.equal(t.hitlPause, false);
  assert.equal(t.workers.length, 2);
  assert.equal(t.workers[0].name, 'Worker A');
  assert.equal(t.workers[1].name, 'Worker B');
  assert.equal(t.workers[0].temperature, 0.7);
});

test('store addTeamRun: caps history at 20 and truncates oversized text visibly', () => {
  store.state.teamRuns = [];
  for (let i = 1; i <= 25; i++) {
    store.addTeamRun({ id: `run_${i}`, prompt: `Prompt ${i}`, finalText: `Result ${i}` });
  }
  assert.equal(store.state.teamRuns.length, 20);
  assert.equal(store.state.teamRuns[0].id, 'run_25');
  assert.equal(store.state.teamRuns[19].id, 'run_6');

  const bigText = 'A'.repeat(120000);
  const bigHtml = '<div>' + 'B'.repeat(210000) + '</div>';
  const entry = store.addTeamRun({
    id: 'run_big',
    fullReportMd: bigText,
    finalText: bigText,
    finalHtml: bigHtml,
  });

  assert.equal(entry.truncated, true);
  assert.ok(entry.fullReportMd.includes('[توجه: به دلیل محدودیت حافظه مرورگر، بخشی از متن کوتاه شد]'));
  assert.ok(entry.finalText.includes('[توجه: به دلیل محدودیت حافظه مرورگر، بخشی از متن کوتاه شد]'));
  assert.ok(entry.finalHtml.includes('[توجه: به دلیل محدودیت حافظه مرورگر، بخشی از متن کوتاه شد]'));
  assert.ok(entry.fullReportMd.length < bigText.length);
  assert.ok(entry.finalHtml.length < bigHtml.length);
});
