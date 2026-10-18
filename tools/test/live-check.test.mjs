import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runLiveChecks } from '../../scripts/live-check.mjs';
import { startMockServer } from '../../client/test/helpers/mock-server.mjs';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'live-check-'));
const shot = path.join(directory, 'shot.png');
fs.writeFileSync(shot, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

const handler = (message) => {
  if (message.method === 'ping') return { result: { serverApiVersion: 'CodexComputerUseIPC-5' } };
  if (message.params?.requestType === 'ComputerUseIPCListAppsRequest') {
    return { result: { apps: [{ bundleIdentifier: 'com.apple.finder', name: 'Finder' }] } };
  }
  if (message.params?.requestType === 'ComputerUseIPCAppGetSkyshotRequest') {
    return { result: { text: 'Window: "W", App: Finder.\n0 标准窗口 W.', skyshot: { screenshot: { url: pathToFileURL(shot).href } } } };
  }
  return { error: { code: -10004, message: 'unsupported' } };
};

test('live check reports passes and skips without failing', async () => {
  const mock = await startMockServer(handler);
  try {
    const results = await runLiveChecks({ socketPath: mock.socketPath });
    const byName = Object.fromEntries(results.map((result) => [result.name, result.status]));
    assert.equal(byName.ping, 'pass');
    assert.equal(byName.listApps, 'pass');
    assert.equal(byName.getAppState, 'pass');
    assert.equal(byName.screenshot, 'pass');
    assert.equal(byName.audio, 'skip');
    assert.equal(byName.browser, 'skip');
  } finally {
    await mock.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
