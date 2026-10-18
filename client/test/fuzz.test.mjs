import test from 'node:test';
import assert from 'node:assert/strict';
import { FrameDecoder, encodeFrame } from '../src/framing.mjs';

function rng(seed = 0x9e3779b9) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state & 0xff;
  };
}

test('FrameDecoder survives random bytes without hanging', () => {
  const next = rng();
  for (let round = 0; round < 200; round += 1) {
    const decoder = new FrameDecoder({ maxFrameBytes: 1024 });
    const length = (next() << 8) | next();
    const chunk = Buffer.from(Array.from({ length }, () => next()));
    try {
      const frames = decoder.push(chunk);
      assert.ok(Array.isArray(frames));
    } catch (error) {
      assert.match(error.message, /frame too large|Unexpected end|JSON/i);
    }
  }
});

test('FrameDecoder round-trips random-sized valid frames', () => {
  const next = rng(42);
  for (let round = 0; round < 50; round += 1) {
    const payload = { n: round, blob: 'x'.repeat(next()) };
    const frame = encodeFrame(payload);
    const split = 1 + (next() % Math.max(1, frame.length - 1));
    const decoder = new FrameDecoder();
    const first = decoder.push(frame.subarray(0, split));
    const second = decoder.push(frame.subarray(split));
    assert.deepEqual([...first, ...second], [payload]);
  }
});
