// Normalizes accessibility text (ours or Codex's) into comparable features.
// The goal is semantic parity, not byte equality: live UI state changes between
// runs, so we compare structure (roles, counts, selection, header) instead.

const NODE_LINE = /^[+~]?\t*(\d+)\s+(.+)$/;

export function normalizeAxText(text = '') {
  const lines = text.split('\n');
  const diffHeader = lines.find((line) => line.startsWith('The following is a diff'));
  const windowMatch = text.match(/Window: "(.*?)", App: (.*?)\./);
  const result = {
    kind: diffHeader ? 'diff' : (windowMatch ? 'full' : 'unknown'),
    window: windowMatch?.[1] ?? null,
    app: windowMatch?.[2] ?? null,
    nodeCount: 0,
    roles: {},
    selectedCount: 0,
    titles: [],
    diff: { removed: [], added: 0, changed: 0, selectedBlock: 0 },
  };

  let inSelectedBlock = false;
  for (const line of lines) {
    if (line.startsWith('Removed element IDs:')) {
      result.diff.removed = parseRanges(line.split(':')[1] ?? '');
      continue;
    }
    if (line === 'Selected:') { inSelectedBlock = true; continue; }
    if (line.startsWith('Note:')) { inSelectedBlock = false; continue; }
    if (!line.trim()) { inSelectedBlock = false; continue; }
    if (line.startsWith('The following is a diff')) continue;
    if (line.startsWith('Window: "')) continue;

    const match = line.match(NODE_LINE);
    if (!match) continue;
    const role = match[2].split(/\s+/)[0];
    result.roles[role] = (result.roles[role] ?? 0) + 1;
    result.nodeCount += 1;
    if (line.includes('(selected')) result.selectedCount += 1;
    if (inSelectedBlock) result.diff.selectedBlock += 1;
    if (line.startsWith('+')) result.diff.added += 1;
    if (line.startsWith('~')) result.diff.changed += 1;
  }
  return result;
}

export function parseRanges(spec) {
  const out = [];
  for (const part of spec.split(',').map((s) => s.trim()).filter(Boolean)) {
    const parts = part.split('-').map(Number);
    const start = parts[0];
    const end = parts.length > 1 ? parts[1] : start;
    if (Number.isNaN(start)) continue;
    out.push([start, Number.isNaN(end) ? start : end]);
  }
  return out;
}

export function roleJaccard(a, b) {
  const keys = new Set([...Object.keys(a.roles), ...Object.keys(b.roles)]);
  let intersection = 0;
  let union = 0;
  for (const key of keys) {
    const left = a.roles[key] ?? 0;
    const right = b.roles[key] ?? 0;
    intersection += Math.min(left, right);
    union += Math.max(left, right);
  }
  return union === 0 ? 1 : intersection / union;
}

export function compareObservations(a, b) {
  const kindsCompatible = a.kind === b.kind;
  const headerMatch = a.window === b.window && a.app === b.app;
  const nodeRatio = a.nodeCount === 0 || b.nodeCount === 0
    ? 0
    : Math.min(a.nodeCount, b.nodeCount) / Math.max(a.nodeCount, b.nodeCount);
  const roles = roleJaccard(a, b);
  const selectedDelta = Math.abs(a.selectedCount - b.selectedCount);

  const score = kindsCompatible
    ? Math.round((0.4 * roles + 0.3 * nodeRatio + 0.2 * (headerMatch ? 1 : 0) + 0.1 * Math.max(0, 1 - selectedDelta / 10)) * 100)
    : 0;

  return {
    score,
    kindsCompatible,
    headerMatch,
    roleSimilarity: Number(roles.toFixed(3)),
    nodeRatio: Number(nodeRatio.toFixed(3)),
    selectedDelta,
    onlyInLeft: Object.keys(a.roles).filter((role) => !(role in b.roles)),
    onlyInRight: Object.keys(b.roles).filter((role) => !(role in a.roles)),
  };
}

export function compareSessions(left, right) {
  const steps = [];
  const length = Math.max(left.steps.length, right.steps.length);
  for (let index = 0; index < length; index += 1) {
    const a = left.steps[index];
    const b = right.steps[index];
    if (!a || !b) { steps.push({ index, status: 'missing', op: a?.op ?? b?.op }); continue; }
    if (a.op !== b.op) { steps.push({ index, status: 'op-mismatch', left: a.op, right: b.op }); continue; }
    if (!a.observation || !b.observation) {
      steps.push({ index, op: a.op, status: a.ok === b.ok ? 'ok' : 'outcome-mismatch' });
      continue;
    }
    const comparison = compareObservations(a.observation, b.observation);
    steps.push({ index, op: a.op, status: 'compared', ...comparison });
  }
  const compared = steps.filter((step) => step.status === 'compared');
  const average = compared.length
    ? Math.round(compared.reduce((sum, step) => sum + step.score, 0) / compared.length)
    : null;
  return { average, steps };
}
