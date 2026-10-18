import { readFileSync } from 'node:fs';
import { Client } from '../client/src/client.mjs';
import { normalizeAxText } from './normalize.mjs';

const READ_OPS = new Set(['getAppState']);

export async function runScenario({ socketPath, scenario, clientFactory = (options) => new Client(options) }) {
  const client = clientFactory({ socketPath });
  const started = Date.now();
  const steps = [];
  try {
    await client.ping();
    for (const step of scenario.steps) {
      const app = step.app ?? scenario.app;
      const stepStarted = Date.now();
      try {
        let observation = null;
        if (step.op === 'listApps') {
          await client.listApps();
        } else if (step.op === 'getAppState') {
          const state = await client.getAppState(app, { disableDiff: step.disableDiff });
          observation = normalizeAxText(state.text);
        } else if (step.op === 'click') {
          await client.click({ app, elementIndex: step.elementIndex, x: step.x, y: step.y });
        } else if (step.op === 'typeText') {
          await client.typeText({ app, text: step.text });
        } else if (step.op === 'pressKey') {
          await client.pressKey({ app, key: step.key });
        } else {
          throw new Error(`unsupported scenario op: ${step.op}`);
        }
        steps.push({ op: step.op, app, ok: true, durationMs: Date.now() - stepStarted,
          ...(observation ? { observation } : {}) });
      } catch (error) {
        steps.push({ op: step.op, app, ok: false, durationMs: Date.now() - stepStarted,
          error: { code: error.code ?? null, message: error.message } });
      }
    }
  } finally {
    client.close();
  }
  return { scenario: scenario.name, app: scenario.app, durationMs: Date.now() - started, steps };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [scenarioPath, ...rest] = process.argv.slice(2);
  if (!scenarioPath) {
    console.error('usage: node tools/scenario.mjs <scenario.json> [--socket path] [--out file]');
    process.exit(2);
  }
  const flag = (name, fallback) => {
    const index = rest.indexOf(name);
    return index >= 0 ? rest[index + 1] : fallback;
  };
  const scenario = JSON.parse(readFileSync(scenarioPath, 'utf8'));
  const socketPath = flag('--socket', process.env.CODEX_CU_SOCKET ?? '/tmp/codex-cu.sock');
  const session = await runScenario({ socketPath, scenario });
  const json = JSON.stringify(session, null, 2);
  const out = flag('--out');
  if (out) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(out, json + '\n');
    console.log(`wrote ${out}`);
  } else {
    console.log(json);
  }
  process.exit(session.steps.every((step) => step.ok) ? 0 : 1);
}
