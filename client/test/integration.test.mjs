import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { Client } from '../src/client.mjs';
import { CodexCuError } from '../src/errors.mjs';
import { MAX_FRAME_BYTES } from '../src/framing.mjs';

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
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await new Promise((resolve) => child.once('exit', resolve));
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(stderr, '');
});

async function withService(socketPath, fn, extraArgs = []) {
  const child = spawn(binary, ['--socket', socketPath, ...extraArgs], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  try {
    await waitForSocket(socketPath);
    return await fn(child, () => stderr);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await new Promise((resolve) => child.once('exit', resolve));
    }
  }
}

test('serves concurrent clients', { skip: !available }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-cu-conc-'));
  const socketPath = path.join(dir, 'cu.sock');
  try {
    await withService(socketPath, async () => {
      const first = new Client({ socketPath, timeoutMs: 5000 });
      const second = new Client({ socketPath, timeoutMs: 5000 });
      try {
        const [a, b] = await Promise.all([first.listApps(), second.listApps()]);
        assert.ok(Array.isArray(a.apps));
        assert.ok(Array.isArray(b.apps));
      } finally {
        first.close();
        second.close();
      }
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('closes the connection on an oversized frame', { skip: !available }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-cu-big-'));
  const socketPath = path.join(dir, 'cu.sock');
  try {
    await withService(socketPath, async () => {
      const socket = net.createConnection({ path: socketPath });
      await new Promise((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('error', reject);
      });
      const header = Buffer.alloc(4);
      header.writeUInt32LE(MAX_FRAME_BYTES + 1, 0);
      socket.write(header);
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('server kept the connection open')), 2000);
        socket.once('close', () => { clearTimeout(timer); resolve(); });
        socket.once('error', () => { clearTimeout(timer); resolve(); });
      });
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('policy, audio and appState semantics over the wire', { skip: !available }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-cu-sem-'));
  const socketPath = path.join(dir, 'cu.sock');
  try {
    await withService(socketPath, async () => {
      const client = new Client({ socketPath, timeoutMs: 5000 });
      try {
        const policy = await client.getAppPolicy('com.apple.finder');
        assert.equal(policy.allowed, true);

        await assert.rejects(
          () => client.request('ComputerUseIPCStartAudioRecordingRequest', {}),
          (error) => error instanceof CodexCuError && error.code === -10004,
        );

        await assert.rejects(
          () => client.startApp('com.example.definitely-not-installed'),
          (error) => error instanceof CodexCuError && error.code === -10007,
        );

        // ScreenCaptureKit is unreliable in a headless runner; only exercise the
        // observation path on developer machines.
        if (!process.env.CI) {
          try {
            const state = await client.getAppState('com.apple.finder');
            assert.equal(typeof state.text, 'string');
          } catch (error) {
            assert.ok(error instanceof CodexCuError);
            assert.ok([-10007, -10009].includes(error.code), `unexpected code ${error.code}`);
          }
        }
      } finally {
        client.close();
      }
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('approvals file is honoured over the wire', { skip: !available }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-cu-appr-'));
  const socketPath = path.join(dir, 'cu.sock');
  const approvals = path.join(dir, 'approvals.json');
  fs.writeFileSync(approvals, JSON.stringify({ apps: { 'com.blocked.app': { allowed: false } } }));
  try {
    await withService(socketPath, async () => {
      const client = new Client({ socketPath, timeoutMs: 5000 });
      try {
        assert.equal((await client.getAppPolicy('com.blocked.app')).allowed, false);
        assert.equal((await client.getAppPolicy('com.allowed.app')).allowed, true);
      } finally {
        client.close();
      }
    }, ['--approvals', approvals]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('rejects malformed instructions at startup', { skip: !available }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-cu-instr-'));
  const approvals = path.join(dir, 'instructions.json');
  fs.writeFileSync(approvals, '[]');
  try {
    const result = spawnSync(binary, ['--socket', path.join(dir, 'cu.sock'), '--instructions', approvals], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /fatal:.*instructions/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('audio start is either recorded or rejected for missing TCC', { skip: !available }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-cu-audio-'));
  const socketPath = path.join(dir, 'cu.sock');
  try {
    await withService(socketPath, async () => {
      const client = new Client({ socketPath, timeoutMs: 15000 });
      try {
        try {
          await client.startAudioRecording({ maxDurationMilliseconds: 100 });
          const { url } = await client.stopAudioRecording();
          assert.match(url, /^file:\/\/.*\.wav$/);
        } catch (error) {
          assert.ok(error instanceof CodexCuError);
          assert.equal(error.code, -10009);
          assert.match(error.message, /screen recording permission/);
        }
      } finally {
        client.close();
      }
    }, ['--audio']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
