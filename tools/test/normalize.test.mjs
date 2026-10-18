import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { normalizeAxText, compareObservations, compareSessions, parseRanges } from '../normalize.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(path.resolve(here, '../../fixtures/ax', name), 'utf8');

test('normalizes a full tree captured from Codex', () => {
  const normalized = normalizeAxText(fixture('finder-full-tree.txt'));
  assert.equal(normalized.kind, 'full');
  assert.equal(normalized.window, '下载');
  assert.equal(normalized.app, '访达');
  assert.ok(normalized.nodeCount > 40);
  assert.equal(normalized.roles['标准窗口'], 1);
  assert.ok(normalized.roles.row >= 1);
  assert.ok(normalized.selectedCount >= 1);
});

test('normalizes a diff captured from Codex', () => {
  const normalized = normalizeAxText(fixture('finder-diff.txt'));
  assert.equal(normalized.kind, 'diff');
  assert.deepEqual(normalized.diff.removed, [[227, 230]]);
  assert.ok(normalized.diff.added > 0);
  assert.ok(normalized.diff.selectedBlock > 0);
  assert.ok(normalized.selectedCount > 0);
});

test('parses removed ID ranges', () => {
  assert.deepEqual(parseRanges('1-4, 9, 12-13'), [[1, 4], [9, 9], [12, 13]]);
});

test('identical observations score 100', () => {
  const a = normalizeAxText(fixture('finder-full-tree.txt'));
  const b = normalizeAxText(fixture('finder-full-tree.txt'));
  const comparison = compareObservations(a, b);
  assert.equal(comparison.score, 100);
  assert.equal(comparison.headerMatch, true);
  assert.equal(comparison.roleSimilarity, 1);
});

test('different kinds are not comparable', () => {
  const full = normalizeAxText(fixture('finder-full-tree.txt'));
  const diff = normalizeAxText(fixture('finder-diff.txt'));
  const comparison = compareObservations(full, diff);
  assert.equal(comparison.kindsCompatible, false);
  assert.equal(comparison.score, 0);
});

test('session comparison aligns steps and reports missing ones', () => {
  const observation = normalizeAxText(fixture('finder-full-tree.txt'));
  const left = { steps: [{ op: 'getAppState', ok: true, observation }, { op: 'click', ok: true }] };
  const right = { steps: [{ op: 'getAppState', ok: true, observation }] };
  const comparison = compareSessions(left, right);
  assert.equal(comparison.average, 100);
  assert.equal(comparison.steps[1].status, 'missing');
});
