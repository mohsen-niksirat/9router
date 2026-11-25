import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeAutoLayout,
  deriveEdges,
  normalizeTeamLayout,
} from '../js/team_graph.js';

const memStorage = new Map();
globalThis.localStorage = {
  getItem: (k) => (memStorage.has(k) ? memStorage.get(k) : null),
  setItem: (k, v) => memStorage.set(k, String(v)),
  removeItem: (k) => memStorage.delete(k),
  clear: () => memStorage.clear(),
};

const { store } = await import('../js/store.js');

test('computeAutoLayout: returns positions for goal, manager, every worker, and output; deterministic and ordered left-to-right', () => {
  const team = {
    id: 'team_layout_1',
    workers: [
      { id: 'w_alpha', name: 'Alpha' },
      { id: 'w_beta', name: 'Beta' },
      { id: 'w_gamma', name: 'Gamma' },
      { id: 'w_delta', name: 'Delta' },
    ],
  };

  const first = computeAutoLayout(team);
  const second = computeAutoLayout(team);

  assert.deepEqual(first, second, 'computeAutoLayout must be deterministic for the same input');

  const expectedKeys = ['goal', 'manager', 'w_alpha', 'w_beta', 'w_gamma', 'w_delta', 'output'];
  for (const key of expectedKeys) {
    assert.ok(first.nodes[key], `missing position for node "${key}"`);
    assert.equal(typeof first.nodes[key].x, 'number');
    assert.equal(typeof first.nodes[key].y, 'number');
    assert.ok(Number.isFinite(first.nodes[key].x));
    assert.ok(Number.isFinite(first.nodes[key].y));
  }

  // Workers ordered left-to-right (x ascending) by team.workers array order
  const xs = team.workers.map((w) => first.nodes[w.id].x);
  for (let i = 0; i < xs.length - 1; i++) {
    assert.ok(
      xs[i] < xs[i + 1],
      `expected worker ${team.workers[i].id} (x=${xs[i]}) to be left of ${team.workers[i + 1].id} (x=${xs[i + 1]})`
    );
  }
});

test('deriveEdges: exact edge sets for manager_worker, sequential, parallel, and debate_review (with 3+ critics)', () => {
  const baseTeam = {
    workers: [
      { id: 'w1', name: 'Author' },
      { id: 'w2', name: 'Critic 1' },
      { id: 'w3', name: 'Critic 2' },
      { id: 'w4', name: 'Critic 3' },
    ],
  };

  // 1. manager_worker
  assert.deepEqual(deriveEdges(baseTeam, 'manager_worker'), [
    { from: 'goal', to: 'manager', kind: 'input' },
    { from: 'manager', to: 'w1', kind: 'delegate' },
    { from: 'manager', to: 'w2', kind: 'delegate' },
    { from: 'manager', to: 'w3', kind: 'delegate' },
    { from: 'manager', to: 'w4', kind: 'delegate' },
    { from: 'w1', to: 'output', kind: 'synthesize' },
    { from: 'w2', to: 'output', kind: 'synthesize' },
    { from: 'w3', to: 'output', kind: 'synthesize' },
    { from: 'w4', to: 'output', kind: 'synthesize' },
  ]);

  // 2. sequential
  assert.deepEqual(deriveEdges(baseTeam, 'sequential'), [
    { from: 'goal', to: 'manager', kind: 'input' },
    { from: 'manager', to: 'w1', kind: 'step' },
    { from: 'w1', to: 'w2', kind: 'step' },
    { from: 'w2', to: 'w3', kind: 'step' },
    { from: 'w3', to: 'w4', kind: 'step' },
    { from: 'w4', to: 'output', kind: 'synthesize' },
  ]);

  // 3. parallel
  assert.deepEqual(deriveEdges(baseTeam, 'parallel'), [
    { from: 'goal', to: 'manager', kind: 'input' },
    { from: 'manager', to: 'w1', kind: 'parallel' },
    { from: 'manager', to: 'w2', kind: 'parallel' },
    { from: 'manager', to: 'w3', kind: 'parallel' },
    { from: 'manager', to: 'w4', kind: 'parallel' },
    { from: 'w1', to: 'output', kind: 'synthesize' },
    { from: 'w2', to: 'output', kind: 'synthesize' },
    { from: 'w3', to: 'output', kind: 'synthesize' },
    { from: 'w4', to: 'output', kind: 'synthesize' },
  ]);

  // 4. debate_review with 3 critics (author -> every critic -> output)
  assert.deepEqual(deriveEdges(baseTeam, 'debate_review'), [
    { from: 'goal', to: 'manager', kind: 'input' },
    { from: 'manager', to: 'w1', kind: 'draft' },
    { from: 'w1', to: 'w2', kind: 'critique' },
    { from: 'w2', to: 'output', kind: 'revise' },
    { from: 'w1', to: 'w3', kind: 'critique' },
    { from: 'w3', to: 'output', kind: 'revise' },
    { from: 'w1', to: 'w4', kind: 'critique' },
    { from: 'w4', to: 'output', kind: 'revise' },
  ]);
});

test('store normalizer: team imported without layout gains one automatically; existing layout positions stay untouched', () => {
  const customLayout = {
    nodes: {
      goal: { x: 15, y: 25 },
      manager: { x: 310, y: 45 },
      w_keep_1: { x: 120, y: 260 },
      w_keep_2: { x: 480, y: 275 },
      output: { x: 320, y: 490 },
    },
  };

  const backup = {
    providers: store.state.providers,
    teams: [
      {
        id: 'team_no_layout',
        name: 'No Layout Team',
        manager: { name: 'Lead', role: 'Manager' },
        workers: [
          { id: 'w_auto_1', name: 'Dev', role: 'Engineer' },
          { id: 'w_auto_2', name: 'QA', role: 'Tester' },
        ],
      },
      {
        id: 'team_with_layout',
        name: 'Custom Layout Team',
        manager: { name: 'Lead', role: 'Manager' },
        workers: [
          { id: 'w_keep_1', name: 'Designer', role: 'UI' },
          { id: 'w_keep_2', name: 'Backend', role: 'API' },
        ],
        layout: customLayout,
      },
    ],
  };

  store.importJson(JSON.stringify(backup));

  const autoTeam = store.state.teams.find((t) => t.id === 'team_no_layout');
  assert.ok(autoTeam?.layout?.nodes, 'team without layout should gain layout.nodes automatically');
  const expectedAuto = computeAutoLayout(autoTeam);
  assert.deepEqual(autoTeam.layout, expectedAuto);

  const keptTeam = store.state.teams.find((t) => t.id === 'team_with_layout');
  assert.deepEqual(
    keptTeam.layout,
    customLayout,
    'team with existing layout must keep its { x, y } positions untouched'
  );

  // Also verify normalizeTeamLayout preserves existing and fills missing
  const partial = normalizeTeamLayout({
    workers: [
      { id: 'w_keep_1', name: 'Designer' },
      { id: 'w_new_3', name: 'New Worker' },
    ],
    layout: { nodes: { manager: { x: 999, y: 888 }, w_keep_1: { x: 120, y: 260 } } },
  });
  assert.deepEqual(partial.nodes.manager, { x: 999, y: 888 });
  assert.deepEqual(partial.nodes.w_keep_1, { x: 120, y: 260 });
  assert.ok(partial.nodes.w_new_3 && Number.isFinite(partial.nodes.w_new_3.x));
  assert.ok(partial.nodes.goal && partial.nodes.output);
});
