import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const casesDir = join(__dirname, 'cases');
const cli = join(repoRoot, 'dist', 'cli.js');

const cases = readdirSync(casesDir)
  .filter(f => f.endsWith('.ato'))
  .sort();

if (cases.length === 0) {
  console.error('No .ato test cases found in ' + casesDir);
  process.exit(1);
}

let passed = 0;
let failed = 0;

for (const caseName of cases) {
  const inputPath = join(casesDir, caseName);
  const stem = basename(caseName, '.ato');
  const expectedPath = join(casesDir, stem + '.expected');

  if (!existsSync(expectedPath)) {
    console.log(`? ${caseName} — missing ${stem}.expected`);
    failed++;
    continue;
  }

  const expected = readFileSync(expectedPath, 'utf8').trim();

  let actual;
  try {
    actual = execFileSync(process.execPath, [cli, 'run', inputPath], {
      encoding: 'utf8',
      timeout: 15000,
    }).trim();
  } catch (err) {
    const msg = err.stdout ? err.stdout.trim() : err.message;
    console.log(`✗ ${caseName} — execution error: ${msg}`);
    failed++;
    continue;
  }

  if (actual === expected) {
    console.log(`✓ ${caseName}`);
    passed++;
  } else {
    console.log(`✗ ${caseName}`);
    console.log(`  expected: ${JSON.stringify(expected)}`);
    console.log(`  actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
