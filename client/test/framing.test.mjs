import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeFrame, FrameDecoder, MAX_FRAME_BYTES } from '../src/framing.mjs';

test('encodes a 4-byte little-endian length prefix', () => {
  const frame = encodeFrame({ a: 1 });
  const body = frame.subarray(4).toString('utf8');
  assert.equal(frame.readUInt32LE(0), Buffer.byteLength(body));
  assert.deepEqual(JSON.parse(body), { a: 1 });
});

test('decodes frames split across chunks', () => {
  const frame = encodeFrame({ hello: 'world' });
  const decoder = new FrameDecoder();
  assert.deepEqual(decoder.push(frame.subarray(0, 3)), []);
  assert.deepEqual(decoder.push(frame.subarray(3, 7)), []);
  assert.deepEqual(decoder.push(frame.subarray(7)), [{ hello: 'world' }]);
});

test('decodes multiple frames from one chunk', () => {
  const chunks = Buffer.concat([encodeFrame({ n: 1 }), encodeFrame({ n: 2 })]);
  assert.deepEqual(new FrameDecoder().push(chunks), [{ n: 1 }, { n: 2 }]);
});

test('rejects frames above the limit', () => {
  const decoder = new FrameDecoder({ maxFrameBytes: 4 });
  const frame = encodeFrame({ too: 'big' });
  assert.throws(() => decoder.push(frame), /frame too large/);
  assert.throws(() => encodeFrame({ text: 'x'.repeat(MAX_FRAME_BYTES + 1) }), /frame too large/);
});
