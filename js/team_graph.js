/**
 * 9Router Web — Pure Team Graph Layout & Edge Derivation (DOM-free)
 * Deterministic auto-layout, mode-derived execution edges, and layout normalizer.
 */

export const TEAM_NODE_WIDTH = 210;
export const TEAM_NODE_HEIGHT = 110;

const H_GAP = 40;
const V_GAP = 60;
const PADDING_X = 40;
const PADDING_Y = 36;

/**
 * Compute deterministic, non-overlapping node positions for a team.
 * Places `goal` top-left, `manager` top-center, `workers` in 1 row (or 2+ rows when > 4)
 * ordered left-to-right by `team.workers` array order, and `output` bottom-center.
 *
 * @param {object} team
 * @returns {{ nodes: Record<string, { x: number, y: number }> }}
 */
export function computeAutoLayout(team = {}) {
  const workers = Array.isArray(team?.workers) ? team.workers.filter((w) => w && w.id) : [];
  const count = workers.length;

  let rows = [];
  if (count > 0) {
    const maxPerRow = count <= 4 ? count : Math.min(4, Math.ceil(count / 2));
    for (let i = 0; i < count; i += maxPerRow) {
      rows.push(workers.slice(i, i + maxPerRow));
    }
  }

  const maxCols = rows.reduce((m, r) => Math.max(m, r.length), 0);
  // Reserve at least 3 columns so `goal` (top-left) and `manager` (top-center) never overlap.
  const effectiveCols = Math.max(3, maxCols);
  const stageWidth = effectiveCols * TEAM_NODE_WIDTH + (effectiveCols - 1) * H_GAP;
  const centerX = Math.round(PADDING_X + (stageWidth - TEAM_NODE_WIDTH) / 2);

  const nodes = {
    goal: { x: PADDING_X, y: PADDING_Y },
    manager: { x: centerX, y: PADDING_Y },
  };

  rows.forEach((row, rowIdx) => {
    const rowWidth = row.length * TEAM_NODE_WIDTH + (row.length - 1) * H_GAP;
    const startX = Math.round(PADDING_X + (stageWidth - rowWidth) / 2);
    const y = PADDING_Y + (rowIdx + 1) * (TEAM_NODE_HEIGHT + V_GAP);
    row.forEach((w, colIdx) => {
      nodes[w.id] = {
        x: startX + colIdx * (TEAM_NODE_WIDTH + H_GAP),
        y,
      };
    });
  });

  const outputY = PADDING_Y + (rows.length + 1) * (TEAM_NODE_HEIGHT + V_GAP);
  nodes.output = { x: centerX, y: outputY };

  return { nodes };
}

/**
 * Derive directed graph edges strictly from team execution semantics.
 *
 * @param {object} team
 * @param {string} [mode]
 * @returns {Array<{ from: string, to: string, kind: string }>}
 */
export function deriveEdges(team = {}, mode) {
  const activeMode = mode || team?.mode || 'manager_worker';
  const workers = Array.isArray(team?.workers) ? team.workers.filter((w) => w && w.id) : [];

  const edges = [{ from: 'goal', to: 'manager', kind: 'input' }];

  if (workers.length === 0) {
    edges.push({ from: 'manager', to: 'output', kind: 'synthesize' });
    return edges;
  }

  if (activeMode === 'sequential') {
    edges.push({ from: 'manager', to: workers[0].id, kind: 'step' });
    for (let i = 0; i < workers.length - 1; i++) {
      edges.push({ from: workers[i].id, to: workers[i + 1].id, kind: 'step' });
    }
    edges.push({ from: workers[workers.length - 1].id, to: 'output', kind: 'synthesize' });
    return edges;
  }

  if (activeMode === 'parallel') {
    for (const w of workers) {
      edges.push({ from: 'manager', to: w.id, kind: 'parallel' });
    }
    for (const w of workers) {
      edges.push({ from: w.id, to: 'output', kind: 'synthesize' });
    }
    return edges;
  }

  if (activeMode === 'debate_review') {
    const author = workers[0];
    edges.push({ from: 'manager', to: author.id, kind: 'draft' });
    if (workers.length === 1) {
      edges.push({ from: author.id, to: 'output', kind: 'revise' });
      return edges;
    }
    const critics = workers.slice(1);
    for (const critic of critics) {
      edges.push({ from: author.id, to: critic.id, kind: 'critique' });
      edges.push({ from: critic.id, to: 'output', kind: 'revise' });
    }
    return edges;
  }

  // Default: manager_worker
  for (const w of workers) {
    edges.push({ from: 'manager', to: w.id, kind: 'delegate' });
  }
  for (const w of workers) {
    edges.push({ from: w.id, to: 'output', kind: 'synthesize' });
  }
  return edges;
}

/**
 * Normalize a team's persisted layout:
 * - Keeps any existing valid `{ x, y }` entries in `team.layout?.nodes` untouched.
 * - Fills missing keys (`goal`, `manager`, each `worker.id`, `output`) from `computeAutoLayout(team)`.
 * - Drops stale worker keys no longer in `team.workers`.
 *
 * @param {object} team
 * @returns {{ nodes: Record<string, { x: number, y: number }> }}
 */
export function normalizeTeamLayout(team = {}) {
  const auto = computeAutoLayout(team);
  const existing = team?.layout?.nodes && typeof team.layout.nodes === 'object' ? team.layout.nodes : {};
  const nodes = {};

  for (const key of Object.keys(auto.nodes)) {
    const pos = existing[key];
    if (pos && typeof pos === 'object' && Number.isFinite(Number(pos.x)) && Number.isFinite(Number(pos.y))) {
      nodes[key] = { x: Number(pos.x), y: Number(pos.y) };
    } else {
      nodes[key] = { x: auto.nodes[key].x, y: auto.nodes[key].y };
    }
  }

  return { nodes };
}
