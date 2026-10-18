// Browser accessibility formatting. The original browser stack reuses the same
// tree/diff layout as the native service (the WASM contains the same strings:
// "Secondary Actions", "Removed element IDs: ", "Selected:", the Selected note
// and the browser-specific diff header). This module reproduces that layout from
// CDP Accessibility.getFullAXTree nodes.

const BROWSER_DIFF_HEADER =
  'The following is a diff from the previous accessibility tree with ~ and + representing changed and added elements, respectively. Removed elements are summarized by ID range.';

const SELECTED_NOTE =
  'Note: Pay special attention to the content selected by the user. If the user asks a question or refers to the content they are looking at on-screen, they might be referring to the selected content (but they might be referring to something else that\'s visible, too).';

const STATE_ORDER = ['disabled', 'selected', 'focused', 'expanded', 'collapsed', 'settable', 'required', 'readonly', 'checked', 'mixed'];

function properties(node) {
  return Object.fromEntries((node.properties ?? []).map((property) => [property.name, property.value?.value]));
}

function statesFor(node) {
  const props = properties(node);
  const states = [];
  if (props.disabled === true) states.push('disabled');
  if (props.selected === true) states.push('selected');
  if (props.focused === true) states.push('focused');
  if (props.expanded === true) states.push('expanded');
  if (props.expanded === false) states.push('collapsed');
  if (props.settable === true) states.push('settable');
  if (props.required === true) states.push('required');
  if (props.readonly === true) states.push('readonly');
  if (props.checked === true || props.checked === 'true') states.push('checked');
  if (props.checked === 'mixed') states.push('mixed');
  return STATE_ORDER.filter((state) => states.includes(state));
}

function valueOf(node) {
  const value = node.value?.value;
  if (value === undefined || value === null || value === '') return { value: '', isNumber: false };
  return { value: String(value), isNumber: typeof value === 'number' };
}

/** One node, without leading indentation. */
export function axLine(entry) {
  let text = `${entry.id} ${entry.role}`;
  if (entry.name) text += ` ${entry.name}`;
  if (entry.states.length > 0) text += ` (${entry.states.join(', ')})`;
  if (entry.description) text += ` Description: ${entry.description}`;
  if (entry.url) text += `, URL: ${entry.url}`;
  if (entry.value !== '') text += entry.valueIsNumber ? ` ${entry.value}` : `, Value: ${entry.value}`;
  return text;
}

const isEmitted = (node) => Boolean(node) && !node.ignored && node.role?.value !== 'none';

export function buildAXEntries(nodes) {
  const byId = new Map();
  for (const node of nodes) byId.set(String(node.nodeId), node);
  // Depth counts only ancestors that are part of the output; ignored/presentational
  // wrappers are transparent, matching the native AX walk.
  const depth = (node) => {
    let current = node;
    let levels = 0;
    const seen = new Set();
    while (current?.parentId && byId.has(String(current.parentId)) && !seen.has(String(current.parentId))) {
      seen.add(String(current.parentId));
      current = byId.get(String(current.parentId));
      if (isEmitted(current)) levels += 1;
    }
    return levels;
  };
  const entries = [];
  for (const node of nodes) {
    if (!isEmitted(node)) continue;
    const role = node.role?.value ?? 'unknown';
    if (role === 'InlineTextBox') continue;
    const { value, isNumber } = valueOf(node);
    const props = properties(node);
    const numericNodeId = Number(node.nodeId);
    entries.push({
      // Stable identity across observations: the DOM node behind the AX node.
      id: node.backendDOMNodeId ?? (Number.isFinite(numericNodeId) ? numericNodeId : node.nodeId),
      depth: depth(node),
      role,
      name: node.name?.value ?? '',
      description: node.description?.value ?? '',
      url: typeof props.url === 'string' ? props.url : '',
      value,
      valueIsNumber: isNumber,
      states: statesFor(node),
      backendDOMNodeId: node.backendDOMNodeId,
    });
  }
  return entries;
}

function indented(entry) {
  return `${'\t'.repeat(entry.depth)}${axLine(entry)}`;
}

export function formatEntries(entries) {
  return entries.map(indented).join('\n');
}

export function formatAXTree(nodes) {
  return formatEntries(buildAXEntries(nodes));
}

export function axSignature(entry) {
  return [
    entry.depth, entry.role, entry.name, entry.description, entry.url,
    entry.value, entry.valueIsNumber, entry.states.join(','),
  ].join('|');
}

export function ranges(ids) {
  const sorted = [...ids].sort((a, b) => a - b);
  if (sorted.length === 0) return '';
  const parts = [];
  let start = sorted[0];
  let end = sorted[0];
  for (const id of sorted.slice(1)) {
    if (id === end + 1) end = id;
    else { parts.push(start === end ? `${start}` : `${start}-${end}`); start = id; end = id; }
  }
  parts.push(start === end ? `${start}` : `${start}-${end}`);
  return parts.join(', ');
}

export function renderAXDiff(previous, current) {
  const lines = [BROWSER_DIFF_HEADER];
  const previousById = new Map(previous.map((entry) => [entry.id, entry]));
  const currentIds = new Set(current.map((entry) => entry.id));
  const removed = previous.filter((entry) => !currentIds.has(entry.id)).map((entry) => entry.id);
  if (removed.length > 0) lines.push(`Removed element IDs: ${ranges(removed)}`);

  for (const entry of current) {
    const old = previousById.get(entry.id);
    if (old && axSignature(old) === axSignature(entry)) continue;
    lines.push(`${old ? '~' : '+'}\t${axLine(entry)}`);
  }

  const selected = current.filter((entry) => entry.states.includes('selected'));
  if (selected.length > 0) {
    lines.push('', 'Selected:');
    for (const entry of selected) lines.push(`\t${axLine(entry)}`);
    lines.push('', SELECTED_NOTE);
  }
  return lines.join('\n');
}

export { BROWSER_DIFF_HEADER, SELECTED_NOTE };
