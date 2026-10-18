// Minimal CDP WebSocket server for integration tests: HTTP /json/version plus a
// text-frame JSON-RPC loop. No external dependencies.
import http from 'node:http';
import crypto from 'node:crypto';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function decodeFrame(buffer) {
  if (buffer.length < 2) return null;
  const first = buffer[0];
  const second = buffer[1];
  const opcode = first & 0x0f;
  const masked = (second & 0x80) !== 0;
  let length = second & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < 4) return null;
    length = buffer.readUInt16BE(2);
    offset = 4;
  } else if (length === 127) {
    if (buffer.length < 10) return null;
    length = Number(buffer.readBigUInt64BE(2));
    offset = 10;
  }
  const maskOffset = offset;
  if (masked) offset += 4;
  if (buffer.length < offset + length) return null;
  let payload = buffer.subarray(offset, offset + length);
  if (masked) {
    const mask = buffer.subarray(maskOffset, maskOffset + 4);
    payload = Buffer.from(payload.map((byte, index) => byte ^ mask[index % 4]));
  }
  return { opcode, payload, length: offset + length };
}

function encodeFrame(text) {
  const payload = Buffer.from(text);
  let header;
  if (payload.length < 126) {
    header = Buffer.from([0x81, payload.length]);
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81; header[1] = 126; header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81; header[1] = 127; header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  return Buffer.concat([header, payload]);
}

export async function startCdpServer({ handler }) {
  const calls = [];
  const server = http.createServer((request, response) => {
    if (request.url === '/json/version') {
      const port = server.address().port;
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({
        Browser: 'MockChrome/1.0',
        Protocol_Version: '1.3',
        webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser`,
      }));
      return;
    }
    if (request.url === '/json/list') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify([{ id: 'T1', type: 'page', url: 'https://mock.test/' }]));
      return;
    }
    response.statusCode = 404;
    response.end();
  });

  server.on('upgrade', (request, socket, head) => {
    const accept = crypto.createHash('sha1')
      .update(`${request.headers['sec-websocket-key']}${GUID}`)
      .digest('base64');
    socket.write([
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${accept}`,
      '', '',
    ].join('\r\n'));

    let buffer = Buffer.alloc(0);
    const processBuffer = () => {
      for (;;) {
        const frame = decodeFrame(buffer);
        if (!frame) break;
        buffer = buffer.subarray(frame.length);
        if (frame.opcode === 0x8) { socket.end(); return; }
        if (frame.opcode !== 0x1) continue;
        const message = JSON.parse(frame.payload.toString('utf8'));
        if (process.env.CDP_DEBUG) console.error('cdp<-', message.method);
        calls.push(message);
        Promise.resolve(handler(message)).then((response) => {
          if (response) {
            if (process.env.CDP_DEBUG) console.error('cdp->', message.method);
            socket.write(encodeFrame(JSON.stringify({ id: message.id, ...response })));
          }
        });
      }
    };
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      processBuffer();
    });
    socket.on('error', () => {});
    if (head && head.length) { buffer = Buffer.concat([buffer, head]); processBuffer(); }
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    endpoint: `http://127.0.0.1:${server.address().port}`,
    calls,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
