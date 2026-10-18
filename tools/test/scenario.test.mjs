import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { runScenario } from '../scenario.mjs';
import { startMockServer } from '../../client/test/helpers/mock-server.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const tree = readFileSync(path.resolve(here, '../../fixtures/ax/finder-full-tree.txt'), 'utf8');

const handlers = (message) => {
  if (message.method === 'ping') return { result: { serverApiVersion: 'CodexComputerUseIPC-5' } };
  const type = message.params?.requestType;
  if (type === 'ComputerUseIPCAppGetSkyshotRequest') {
    return { result: { text: tree, revision: 1, skyshot: null } };
  }
  return { error: { code: -10009, message: 'permissions not granted' } };
};

test('runs a scenario against a mock service and normalizes observations', async () => {
  const mock = await startMockServer(handlers);
  try {
    const session = await runScenario({
      socketPath: mock.socketPath,
      scenario: { name: 'finder', app: 'com.apple.finder', steps: [{ op: 'getAppState' }] },
    });
    assert.equal(session.steps[0].ok, true);
    assert.equal(session.steps[0].observation.kind, 'full');
    assert.equal(session.steps[0].observation.window, '下载');
  } finally {
    await mock.close();
  }
});

test('records protocol errors per step', async () => {
  const mock = await startMockServer(handlers);
  try {
    const session = await runScenario({
      socketPath: mock.socketPath,
      scenario: { name: 'denied', app: 'com.apple.finder', steps: [{ op: 'click', elementIndex: 1 }] },
    });
    assert.equal(session.steps[0].ok, false);
    assert.equal(session.steps[0].error.code, -10009);
  } finally {
    await mock.close();
  }
});

test('rejects unsupported operations without aborting the run', async () => {
  const mock = await startMockServer(handlers);
  try {
    const session = await runScenario({
      socketPath: mock.socketPath,
      scenario: { name: 'bad', app: 'x', steps: [{ op: 'explode' }] },
    });
    assert.equal(session.steps[0].ok, false);
    assert.match(session.steps[0].error.message, /unsupported scenario op/);
  } finally {
    await mock.close();
  }
});
