import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { encodeFrame, FrameDecoder } from '../../src/framing.mjs';

export async function startMockServer(handler) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-cu-'));
  const socketPath = path.join(dir, 'test.sock');
  const requests = [];
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    const decoder = new FrameDecoder();
    socket.on('data', async (chunk) => {
      for (const message of decoder.push(chunk)) {
        requests.push(message);
        const response = await handler(message, socket);
        if (response) socket.write(encodeFrame({ jsonrpc: '2.0', id: message.id, ...response }));
      }
    });
    socket.on('error', () => {});
  });
  await new Promise((resolve) => server.listen(socketPath, resolve));
  return {
    socketPath,
    requests,
    close: () => new Promise((resolve) => {
      for (const socket of sockets) socket.destroy();
      server.close(() => {
        fs.rmSync(dir, { recursive: true, force: true });
        resolve();
      });
    }),
  };
}
