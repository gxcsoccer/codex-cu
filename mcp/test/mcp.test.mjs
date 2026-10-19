import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { startMockServer } from '../../client/test/helpers/mock-server.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.resolve(here, '../server.mjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-cu-mcp-'));
const shot = path.join(dir, 'shot.png');
fs.writeFileSync(shot, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

const handler = (message) => {
  if (message.method === 'ping') return { result: { serverApiVersion: 'CodexComputerUseIPC-5' } };
  const type = message.params?.requestType;
  if (type === 'ComputerUseIPCListAppsRequest') return { result: { apps: [{ bundleIdentifier: 'com.test.app', name: 'Test' }] } };
  if (type === 'ComputerUseIPCAppGetSkyshotRequest') {
    return { result: { text: 'Window: "Test", App: Test.\n0 标准窗口 Test', skyshot: { screenshot: { url: `file://${shot}` } }, revision: 1 } };
  }
  if (type === 'ComputerUseIPCAppPolicyRequest') return { result: { allowed: true, decision: 'alwaysAllow' } };
  return { error: { code: -10004, message: 'unsupported' } };
};

function connect(child) {
  const pending = new Map();
  let nextId = 1;
  const rl = createInterface({ input: child.stdout });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    const message = JSON.parse(line);
    if (message.id !== undefined && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    }
  });
  return (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`timeout: ${method}`)); }, 5000);
    pending.set(id, {
      resolve: (value) => { clearTimeout(timer); resolve(value); },
      reject: (error) => { clearTimeout(timer); reject(error); },
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
}

test('MCP server exposes tools and calls the native surface', async () => {
  const mock = await startMockServer(handler);
  const child = spawn(process.execPath, [serverPath, '--socket', mock.socketPath], { stdio: ['pipe', 'pipe', 'pipe'] });
  const call = connect(child);
  try {
    const init = await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    assert.equal(init.serverInfo.name, 'codex-cu');
    assert.ok(init.capabilities.tools);

    const tools = await call('tools/list');
    const names = tools.tools.map((tool) => tool.name);
    for (const expected of ['list_apps', 'get_app_state', 'click', 'browser_ax', 'audio_stop']) {
      assert.ok(names.includes(expected), expected);
    }

    const apps = await call('tools/call', { name: 'list_apps', arguments: {} });
    assert.match(apps.content[0].text, /com\.test\.app/);

    const state = await call('tools/call', { name: 'get_app_state', arguments: { app: 'com.test.app' } });
    const statePayload = JSON.parse(state.content[0].text);
    assert.match(statePayload.text, /Window: "Test"/);
    assert.match(statePayload.screenshotURL, /shot\.png/);

    const policy = await call('tools/call', { name: 'app_policy', arguments: { app: 'com.test.app' } });
    assert.match(policy.content[0].text, /alwaysAllow/);

    await assert.rejects(() => call('tools/call', { name: 'nope', arguments: {} }), /unknown tool/);
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
    await mock.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('--help prints usage', () => {
  const result = spawnSync(process.execPath, [serverPath, '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /usage: mcp\/server\.mjs/);
});
