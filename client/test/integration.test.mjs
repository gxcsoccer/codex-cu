import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '../src/client.mjs';
import { CodexCuError } from '../src/errors.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const binary = path.resolve(here, '../../service/.build/debug/CodexCU');
const available = fs.existsSync(binary);

async function waitForSocket(socketPath, timeoutMs = 5000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (fs.existsSync(socketPath)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('service did not create the socket');
}

test('client and Swift service interoperate over the real socket', { skip: !available }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-cu-int-'));
  const socketPath = path.join(dir, 'cu.sock');
  const child = spawn(binary, ['--socket', socketPath], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });

  try {
    await waitForSocket(socketPath);
    const client = new Client({ socketPath, timeoutMs: 5000 });
    const version = await client.ping();
    assert.equal(version.serverApiVersion, 'CodexComputerUseIPC-5');

    const { apps } = await client.listApps();
    assert.ok(Array.isArray(apps));
    assert.ok(apps.every((app) => typeof app.bundleIdentifier === 'string' && typeof app.name === 'string'));
    // Headless CI sessions may expose no regular apps; the wire shape is what matters here.
    if (apps.length === 0) console.log('# note: no regular apps in this session');

    await assert.rejects(
      () => client.request('ComputerUseIPCNopeRequest', {}),
      (error) => error instanceof CodexCuError && error.code === -10003,
    );
    client.close();
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(stderr, '');
});
