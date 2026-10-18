import test from 'node:test';
import assert from 'node:assert/strict';
import { Client, API_VERSION } from '../src/client.mjs';
import { CodexCuError, ProtocolError } from '../src/errors.mjs';
import { startMockServer } from './helpers/mock-server.mjs';

const ok = () => ({ result: {} });

test('ping validates the server version', async () => {
  const mock = await startMockServer(() => ({ result: { serverApiVersion: API_VERSION } }));
  const client = new Client({ socketPath: mock.socketPath });
  try {
    const result = await client.ping();
    assert.equal(result.serverApiVersion, API_VERSION);
    assert.equal(mock.requests[0].method, 'ping');
    assert.deepEqual(mock.requests[0].params, { clientApiVersion: API_VERSION });
  } finally {
    client.close();
    await mock.close();
  }
});

test('ping rejects a version mismatch', async () => {
  const mock = await startMockServer(() => ({ result: { serverApiVersion: 'CodexComputerUseIPC-4' } }));
  const client = new Client({ socketPath: mock.socketPath });
  try {
    await assert.rejects(() => client.ping(), /API version mismatch/);
  } finally {
    client.close();
    await mock.close();
  }
});

test('listApps sends the list request and returns apps', async () => {
  const apps = [{ bundleIdentifier: 'com.apple.finder', name: 'Finder', pid: 1 }];
  const mock = await startMockServer(() => ({ result: { apps } }));
  const client = new Client({ socketPath: mock.socketPath, now: () => 1000 });
  try {
    assert.deepEqual(await client.listApps(), { apps });
    const sent = mock.requests[0];
    assert.equal(sent.method, 'request');
    assert.equal(sent.params.requestType, 'ComputerUseIPCListAppsRequest');
    assert.equal(sent.params.deadlineUnixMilliseconds, 121_000);
    assert.deepEqual(sent.params.request, {});
  } finally {
    client.close();
    await mock.close();
  }
});

test('error responses become CodexCuError with a name', async () => {
  const mock = await startMockServer(() => ({ error: { code: -10007, message: 'app not running' } }));
  const client = new Client({ socketPath: mock.socketPath });
  try {
    await assert.rejects(() => client.listApps(), (error) => {
      assert.ok(error instanceof CodexCuError);
      assert.equal(error.code, -10007);
      assert.equal(error.errorName, 'runningApplicationNotFound');
      return true;
    });
  } finally {
    client.close();
    await mock.close();
  }
});

test('invalid responses (result and error) are protocol errors', async () => {
  const mock = await startMockServer(() => ({ result: {}, error: { code: -1, message: 'x' } }));
  const client = new Client({ socketPath: mock.socketPath });
  try {
    await assert.rejects(() => client.listApps(), (error) => error instanceof ProtocolError);
  } finally {
    client.close();
    await mock.close();
  }
});

test('timeouts reject and clean up the pending request', async () => {
  const mock = await startMockServer(() => undefined);
  const client = new Client({ socketPath: mock.socketPath, timeoutMs: 50 });
  try {
    await assert.rejects(() => client.listApps(), /timeout after 50ms/);
    assert.equal(client.pending.size, 0);
  } finally {
    client.close();
    await mock.close();
  }
});

test('notifications without an id are ignored', async () => {
  const mock = await startMockServer((message) => {
    if (message.id === 1) {
      const socket = null;
      return { result: { apps: [] } };
    }
    return undefined;
  });
  const client = new Client({ socketPath: mock.socketPath });
  try {
    const apps = await client.listApps();
    assert.deepEqual(apps, { apps: [] });
  } finally {
    client.close();
    await mock.close();
  }
});

test('audio requests carry the duration and stop returns the service URL', async () => {
  const mock = await startMockServer((message) => {
    if (message.method === 'ping') return { result: { serverApiVersion: API_VERSION } };
    if (message.params?.requestType === 'ComputerUseIPCStartAudioRecordingRequest') return { result: {} };
    return { result: { url: 'file:///tmp/a.wav' } };
  });
  const client = new Client({ socketPath: mock.socketPath });
  try {
    await client.startAudioRecording({ maxDurationMilliseconds: 2000 });
    assert.deepEqual(mock.requests[0].params.request, { maxDurationMilliseconds: 2000 });
    const stopped = await client.stopAudioRecording();
    assert.equal(stopped.url, 'file:///tmp/a.wav');
    assert.deepEqual(mock.requests[1].params.request, {});
  } finally {
    client.close();
    await mock.close();
  }
});

test('getAppState accepts an options object with disableDiff', async () => {
  const mock = await startMockServer((message) => {
    if (message.method === 'ping') return { result: { serverApiVersion: API_VERSION } };
    return { result: { text: 'tree' } };
  });
  const client = new Client({ socketPath: mock.socketPath });
  try {
    await client.getAppState({ app: 'com.apple.finder', disableDiff: true });
    assert.deepEqual(mock.requests[0].params.request, { app: 'com.apple.finder', disableDiff: true });
  } finally {
    client.close();
    await mock.close();
  }
});
