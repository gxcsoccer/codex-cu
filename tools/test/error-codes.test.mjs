import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ERROR_CODES, ERROR_NAMES, CodexCuError } from '../../client/src/errors.mjs';

const swift = readFileSync(
  fileURLToPath(new URL('../../service/Sources/CodexCUCore/Errors.swift', import.meta.url)),
  'utf8',
);
const swiftCodes = Object.fromEntries(
  [...swift.matchAll(/case\s+(\w+)\s*=\s*(-?\d+)/g)].map((match) => [match[1], Number(match[2])]),
);

test('client and service error taxonomies match', () => {
  assert.deepEqual(swiftCodes, ERROR_CODES);
});

test('every code maps to a stable name', () => {
  for (const [name, code] of Object.entries(ERROR_CODES)) {
    assert.equal(ERROR_NAMES.get(code), name);
    const error = new CodexCuError({ code, message: 'x' });
    assert.equal(error.errorName, name);
  }
  const unknown = new CodexCuError({ code: -99999, message: 'x' });
  assert.equal(unknown.errorName, 'jsonRPCError');
});
