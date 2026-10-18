import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Cua } from '../src/cua.mjs';
import { startMockServer } from './helpers/mock-server.mjs';

function service({ text = 'Window: "W", App: Finder.\n0 标准窗口 W.', screenshotUrl } = {}) {
  return (message) => {
    if (message.method === 'ping') return { result: { serverApiVersion: 'CodexComputerUseIPC-5' } };
    const type = message.params?.requestType;
    if (type === 'ComputerUseIPCListAppsRequest') {
      return { result: { apps: [{ bundleIdentifier: 'com.apple.finder', name: 'Finder' }] } };
    }
    if (type === 'ComputerUseIPCAppGetSkyshotRequest') {
      return { result: { text, revision: 1, skyshot: screenshotUrl
        ? { screenshot: { url: screenshotUrl, mimeType: 'image/png' } } : null } };
    }
    return { result: { ok: true } };
  };
}

test('getApp binds an app and getAXState returns text', async () => {
  const mock = await startMockServer(service());
  const cua = new Cua({ socketPath: mock.socketPath });
  try {
    const app = await cua.getApp('com.apple.finder');
    assert.equal(await app.getAXState(), 'Window: "W", App: Finder.\n0 标准窗口 W.');
    assert.equal(mock.requests.at(-1).params.requestType, 'ComputerUseIPCAppGetSkyshotRequest');
  } finally {
    cua.close();
    await mock.close();
  }
});

test('click/scroll/select/paste map onto the wire actions', async () => {
  const mock = await startMockServer(service());
  const cua = new Cua({ socketPath: mock.socketPath });
  try {
    const app = await cua.getApp('com.apple.finder');
    await app.click(42, { mouseButton: 'right', clickCount: 2 });
    await app.click([640, 480]);
    await app.scroll([10, 20], 'd', { pixels: 800 });
    await app.selectText(7, 'hello', { selectionType: 'cursor_after' });
    await app.paste('world', { format: 'md' });
    await app.pressKey('cmd+g');
  } finally {
    cua.close();
    await mock.close();
  }
  const actions = mock.requests
    .filter((request) => request.params?.requestType === 'ComputerUseIPCAppPerformActionRequest')
    .map((request) => request.params.request.action);
  assert.deepEqual(actions[0], {
    click: { at: { elementID: { _0: '42' } }, clickCount: 2, mouseButton: 1 },
  });
  assert.deepEqual(actions[1], { click: { at: { coordinate: { _0: [640, 480] } }, clickCount: 1, mouseButton: 0 } });
  assert.deepEqual(actions[2].scroll, { at: { coordinate: { _0: [10, 20] } }, direction: 'down', pages: 2 });
  assert.equal(actions[3].selectText.selection, 'cursor_after');
  assert.deepEqual(actions[4].paste, { text: 'world', format: 'md' });
  assert.deepEqual(actions[5], { pressKey: { _0: 'cmd+g' } });
});

test('getScreenshot reads the file URL returned by the service', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cua-shot-'));
  const file = path.join(directory, 'shot.png');
  fs.writeFileSync(file, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const mock = await startMockServer(service({ screenshotUrl: pathToFileURL(file).href }));
  const cua = new Cua({ socketPath: mock.socketPath });
  try {
    const app = await cua.getApp('com.apple.finder');
    const bytes = await app.getScreenshot();
    assert.deepEqual([...bytes], [0x89, 0x50, 0x4e, 0x47]);
  } finally {
    cua.close();
    await mock.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('getState reports apps and no browsers', async () => {
  const mock = await startMockServer(service());
  const cua = new Cua({ socketPath: mock.socketPath });
  try {
    const state = await cua.getState();
    assert.equal(state.apps[0].bundleIdentifier, 'com.apple.finder');
    assert.deepEqual(state.browsers, []);
  } finally {
    cua.close();
    await mock.close();
  }
});

test('window-scoped bindings are rejected explicitly', async () => {
  const mock = await startMockServer(service());
  const cua = new Cua({ socketPath: mock.socketPath });
  try {
    await assert.rejects(() => cua.getApp({ windowId: 1 }), /window-scoped/);
  } finally {
    cua.close();
    await mock.close();
  }
});
