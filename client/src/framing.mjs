// 4-byte little-endian length + UTF-8 JSON, matching the original native pipe.
export const MAX_FRAME_BYTES = 8 * 1024 * 1024;

export function encodeFrame(value) {
  const json = Buffer.from(JSON.stringify(value), 'utf8');
  if (json.length > MAX_FRAME_BYTES) {
    throw new Error(`frame too large: ${json.length} > ${MAX_FRAME_BYTES}`);
  }
  const frame = Buffer.allocUnsafe(4 + json.length);
  frame.writeUInt32LE(json.length, 0);
  json.copy(frame, 4);
  return frame;
}

export class FrameDecoder {
  constructor({ maxFrameBytes = MAX_FRAME_BYTES } = {}) {
    this.buffer = Buffer.alloc(0);
    this.maxFrameBytes = maxFrameBytes;
  }

  push(chunk) {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : Buffer.from(chunk);
    const out = [];
    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32LE(0);
      if (length > this.maxFrameBytes) throw new Error(`frame too large: ${length} > ${this.maxFrameBytes}`);
      if (this.buffer.length < 4 + length) break;
      const body = this.buffer.subarray(4, 4 + length);
      this.buffer = this.buffer.subarray(4 + length);
      out.push(JSON.parse(body.toString('utf8')));
    }
    return out;
  }
}
