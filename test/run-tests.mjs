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

// Normalize line endings so a run can't pass on Windows (CRLF) yet fail on
// Linux/macOS CI (LF), or vice-versa. Applied to BOTH expected and actual.
const normalize = (s) => s.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();

for (const caseName of cases) {
  const inputPath = join(casesDir, caseName);
  const stem = basename(caseName, '.ato');
  const expectedPath = join(casesDir, stem + '.expected');

  if (!existsSync(expectedPath)) {
    console.log(`? ${caseName} — missing ${stem}.expected`);
    failed++;
    continue;
  }

  const expected = normalize(readFileSync(expectedPath, 'utf8'));

  let actual;
  try {
    actual = normalize(execFileSync(process.execPath, [cli, 'run', inputPath], {
      encoding: 'utf8',
      timeout: 15000,
    }));
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
