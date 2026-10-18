import { readFileSync } from 'node:fs';
import { compareSessions } from './normalize.mjs';

export function compareFiles(leftPath, rightPath) {
  const left = JSON.parse(readFileSync(leftPath, 'utf8'));
  const right = JSON.parse(readFileSync(rightPath, 'utf8'));
  return compareSessions(left, right);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [left, right] = process.argv.slice(2);
  if (!left || !right) {
    console.error('usage: node tools/compare.mjs <ours.json> <codex.json>');
    process.exit(2);
  }
  const result = compareFiles(left, right);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.average !== null && result.average >= 60 ? 0 : 1);
}
