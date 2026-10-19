import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');

test('app bundle plist is valid and carries the TCC usage keys', () => {
  const result = spawnSync('bash', [path.join(root, 'scripts/build-app.sh'), '--print-plist'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /com\.codex-cu\.agent/);
  assert.match(result.stdout, /CodexCU/);
  assert.match(result.stdout, /NSAccessibilityUsageDescription/);
  assert.match(result.stdout, /NSScreenCaptureUsageDescription/);

  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'codex-cu-plist-')), 'Info.plist');
  fs.writeFileSync(file, result.stdout);
  const lint = spawnSync('plutil', ['-lint', file], { encoding: 'utf8' });
  assert.equal(lint.status, 0, lint.stdout);
  fs.rmSync(path.dirname(file), { recursive: true, force: true });
});

test('skill frontmatter names the skill and points at the MCP tools', () => {
  const skill = fs.readFileSync(path.join(root, 'skill/codex-cu/SKILL.md'), 'utf8');
  assert.match(skill, /^---\nname: codex-cu\n/);
  assert.match(skill, /description: .*MCP/);
  assert.match(skill, /get_app_state/);
  assert.match(skill, /browser_ax/);
});
