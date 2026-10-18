import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const binary = path.resolve(here, '../../service/.build/debug/CodexCU');
const available = fs.existsSync(binary);

test('--help prints usage and exits 0', { skip: !available }, () => {
  const result = spawnSync(binary, ['--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /usage: CodexCU/);
  assert.match(result.stdout, /--audio/);
});

test('unknown flags exit 2', { skip: !available }, () => {
  const result = spawnSync(binary, ['--nonsense'], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /unknown argument/);
});

test('missing flag values exit 2', { skip: !available }, () => {
  for (const flag of ['--socket', '--approvals', '--instructions', '--launch-timeout']) {
    const result = spawnSync(binary, [flag], { encoding: 'utf8' });
    assert.equal(result.status, 2, flag);
  }
});
