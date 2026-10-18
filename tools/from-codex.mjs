// Converts a dbtrace Codex session (rollout-derived JSON) into the same
// scenario shape our runner emits, so the two can be compared step by step.
import { readFileSync } from 'node:fs';
import { normalizeAxText } from './normalize.mjs';

export function fromCodexSession(trace) {
  const steps = [];
  for (const step of trace.steps ?? []) {
    const text = step.observation ?? '';
    const observation = normalizeAxText(text);
    if (observation.kind === 'unknown') continue;
    steps.push({ op: 'getAppState', ok: true, observation, sourceTool: step.tool });
  }
  return { scenario: trace.query ?? trace.sessionId ?? 'codex', steps };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [input, out] = process.argv.slice(2);
  if (!input) {
    console.error('usage: node tools/from-codex.mjs <dbtrace-session.json> [out.json]');
    process.exit(2);
  }
  const session = fromCodexSession(JSON.parse(readFileSync(input, 'utf8')));
  const json = JSON.stringify(session, null, 2);
  if (out) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(out, json + '\n');
    console.log(`wrote ${out} (${session.steps.length} steps)`);
  } else {
    console.log(json);
  }
}
