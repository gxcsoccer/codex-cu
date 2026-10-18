import test from 'node:test';
import assert from 'node:assert/strict';
import { CdpConnection } from '../src/cdp.mjs';

class FakeWebSocket {
  constructor() {
    this.sent = [];
    this.listeners = {};
    this.closed = false;
  }
  addEventListener(type, handler) { (this.listeners[type] ??= []).push(handler); }
  emit(type, event) { for (const handler of this.listeners[type] ?? []) handler(event); }
  send(data) { this.sent.push(JSON.parse(data)); }
  close() { this.closed = true; this.emit('close', {}); }
  reply(id, result) { this.emit('message', { data: JSON.stringify({ id, result }) }); }
  fail(id, code, message) { this.emit('message', { data: JSON.stringify({ id, error: { code, message } }) }); }
}

test('correlates requests and responses', async () => {
  const socket = new FakeWebSocket();
  const connection = new CdpConnection(socket);
  const pending = connection.send('Page.navigate', { url: 'https://x.test' }, 'S1');
  assert.deepEqual(socket.sent[0], { id: 1, method: 'Page.navigate', params: { url: 'https://x.test' }, sessionId: 'S1' });
  socket.reply(1, { frameId: 'F' });
  assert.deepEqual(await pending, { frameId: 'F' });
});

test('surfaces CDP errors with codes', async () => {
  const socket = new FakeWebSocket();
  const connection = new CdpConnection(socket);
  const pending = connection.send('Nope');
  socket.fail(1, -32000, 'boom');
  await assert.rejects(pending, (error) => error.code === -32000 && /boom/.test(error.message));
});

test('times out pending commands', async () => {
  const socket = new FakeWebSocket();
  const connection = new CdpConnection(socket, { timeoutMs: 20 });
  await assert.rejects(() => connection.send('Slow'), /CDP timeout/);
  assert.equal(connection.pending.size, 0);
});

test('close rejects in-flight commands', async () => {
  const socket = new FakeWebSocket();
  const connection = new CdpConnection(socket);
  const pending = connection.send('Pending');
  connection.close();
  await assert.rejects(pending, /closed/);
  await assert.rejects(() => connection.send('After'), /closed/);
});

test('dispatches events to subscribers', () => {
  const socket = new FakeWebSocket();
  const connection = new CdpConnection(socket);
  const seen = [];
  connection.on('Page.loadEventFired', (params) => seen.push(params));
  socket.emit('message', { data: JSON.stringify({ method: 'Page.loadEventFired', params: { ts: 1 } }) });
  assert.deepEqual(seen, [{ ts: 1 }]);
});
