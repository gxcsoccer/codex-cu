import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.resolve(here, '../../scripts/install.sh');

test('prints a valid LaunchAgent plist', { skip: process.platform !== 'darwin' }, () => {
  const output = execFileSync('bash', [script, '--print-plist'], { encoding: 'utf8' });
  assert.match(output, /<key>Label<\/key><string>com\.codex-cu\.service<\/string>/);
  assert.match(output, /<string>--socket<\/string>/);
  assert.match(output, /computeruse\.sock/);
  assert.match(output, /<key>RunAtLoad<\/key><true\/>/);
  assert.match(output, /<key>KeepAlive<\/key><true\/>/);

  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'plist-')), 'service.plist');
  fs.writeFileSync(file, output);
  const lint = execFileSync('plutil', ['-lint', file], { encoding: 'utf8' });
  assert.match(lint, /OK/);
});

test('rejects unknown flags', { skip: process.platform !== 'darwin' }, () => {
  assert.throws(() => execFileSync('bash', [script, '--nope'], { stdio: 'pipe' }));
});
