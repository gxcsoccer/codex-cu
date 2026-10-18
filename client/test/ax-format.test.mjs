import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAXEntries, formatAXTree, renderAXDiff, ranges, BROWSER_DIFF_HEADER, SELECTED_NOTE,
} from '../src/ax-format.mjs';

const node = (nodeId, role, parentId, extra = {}) => ({
  nodeId, role: { value: role }, parentId, ignored: false, ...extra,
});

const tree = [
  node('1', 'RootWebArea', undefined, { name: { value: 'Example' } }),
  node('4', 'heading', '1', { name: { value: 'Title' }, properties: [{ name: 'level', value: { value: 1 } }] }),
  node('5', 'button', '1', { name: { value: 'Go' }, properties: [{ name: 'disabled', value: { value: true } }] }),
  node('6', 'textbox', '1', {
    name: { value: 'Name' },
    value: { value: 'typed' },
    properties: [{ name: 'settable', value: { value: true } }, { name: 'url', value: { value: 'https://x.test/' } }],
  }),
  node('7', 'none', '1'),
];

test('formats a tree with depth, states and fields', () => {
  const text = formatAXTree(tree);
  assert.match(text, /^1 RootWebArea Example/);
  assert.match(text, /\n\t5 button Go \(disabled\)/);
  assert.match(text, /\n\t6 textbox Name \(settable\), URL: https:\/\/x\.test\/, Value: typed/);
  assert.doesNotMatch(text, /none/);
});

test('diffs removals, changes and additions', () => {
  const previous = buildAXEntries(tree);
  const current = buildAXEntries([
    node('1', 'RootWebArea', undefined, { name: { value: 'Example' } }),
    node('4', 'heading', '1', { name: { value: 'Title 2' }, properties: [{ name: 'level', value: { value: 1 } }] }),
    node('5', 'button', '1', { name: { value: 'Go' } }),
    node('8', 'link', '1', { name: { value: 'Help' }, properties: [{ name: 'selected', value: { value: true } }, { name: 'url', value: { value: 'https://h.test/' } }] }),
  ]);
  const diff = renderAXDiff(previous, current);
  assert.ok(diff.startsWith(BROWSER_DIFF_HEADER));
  assert.match(diff, /Removed element IDs: 6/);
  assert.match(diff, /~\t4 heading Title 2/);
  assert.match(diff, /~\t5 button Go\n/);
  assert.match(diff, /\+\t8 link Help \(selected\), URL: https:\/\/h\.test\//);
  assert.match(diff, /Selected:\n\t8 link Help/);
  assert.ok(diff.endsWith(SELECTED_NOTE));
});

test('ranges summarize contiguous removal ranges', () => {
  assert.equal(ranges([5, 3, 4, 9, 11, 12]), '3-5, 9, 11-12');
});
