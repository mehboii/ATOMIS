#!/usr/bin/env node
/**
 * ATOMIS .ato case runner.
 *
 * For every `test/cases/*.ato`, run it through the REAL atomis command
 * (`node dist/cli.js run <file>`), capture stdout, and byte-compare it
 * (after line-ending normalization) against a sibling `<name>.expected`.
 *
 *   - A missing `.expected` is a HARD FAILURE, never a skip — these are real
 *     assertions, so a future regression goes red.
 *   - Comparison is robust to CRLF vs LF: both actual and expected are
 *     normalized to `\n` (and trailing newlines trimmed) before comparing, so a
 *     run can't pass on Windows and fail on Linux/macOS CI (or vice-versa).
 *
 * Usage:
 *   node test/run-cases.js            # check mode (CI / npm test)
 *   node test/run-cases.js --update   # regenerate every .expected from real
 *                                      # atomis output (do not hand-type these)
 */

"use strict";

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..");
const CASES_DIR = path.join(REPO_ROOT, "test", "cases");
const ATOMIS_CLI = path.join(REPO_ROOT, "dist", "cli.js");

const UPDATE = process.argv.includes("--update");

/** Normalize line endings so CRLF (Windows) and LF (Linux/macOS) compare equal. */
function normalize(s) {
  return s.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n+$/, "");
}

/** Run one .ato file through the real atomis command; return its stdout. */
function runAtomis(atoPath) {
  const res = spawnSync(process.execPath, [ATOMIS_CLI, "run", atoPath], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  if (res.error) {
    throw new Error(`failed to launch atomis: ${res.error.message}`);
  }
  return { stdout: res.stdout || "", stderr: res.stderr || "", status: res.status };
}

function main() {
  if (!fs.existsSync(ATOMIS_CLI)) {
    console.error(`run-cases: ${path.relative(REPO_ROOT, ATOMIS_CLI)} not found — run \`npm run build\` first.`);
    process.exit(1);
  }
  if (!fs.existsSync(CASES_DIR)) {
    console.error(`run-cases: ${path.relative(REPO_ROOT, CASES_DIR)} not found.`);
    process.exit(1);
  }

  const cases = fs
    .readdirSync(CASES_DIR)
    .filter((f) => f.endsWith(".ato"))
    .sort();

  if (cases.length === 0) {
    console.error("run-cases: no .ato cases found.");
    process.exit(1);
  }

  let passed = 0;
  let failed = 0;

  for (const file of cases) {
    const atoPath = path.join(CASES_DIR, file);
    const expectedPath = atoPath.replace(/\.ato$/, ".expected");

    let result;
    try {
      result = runAtomis(atoPath);
    } catch (e) {
      console.log(`✗ ${file} — ${e.message}`);
      failed++;
      continue;
    }

    if (result.status !== 0) {
      console.log(`✗ ${file} — atomis exited ${result.status}`);
      if (result.stderr.trim()) console.log(indent(result.stderr.trim()));
      failed++;
      continue;
    }

    if (UPDATE) {
      // Capture EXACT real output (normalized to LF) — never hand-typed.
      fs.writeFileSync(expectedPath, normalize(result.stdout) + "\n", "utf8");
      console.log(`updated ${path.basename(expectedPath)}`);
      passed++;
      continue;
    }

    if (!fs.existsSync(expectedPath)) {
      console.log(`✗ ${file} — missing ${path.basename(expectedPath)}`);
      failed++;
      continue;
    }

    const actual = normalize(result.stdout);
    const expected = normalize(fs.readFileSync(expectedPath, "utf8"));

    if (actual === expected) {
      console.log(`✓ ${file}`);
      passed++;
    } else {
      console.log(`✗ ${file} — output did not match ${path.basename(expectedPath)}`);
      console.log("    expected:");
      console.log(indent(expected, "      "));
      console.log("    actual:");
      console.log(indent(actual, "      "));
      failed++;
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

function indent(s, pad = "    ") {
  return s
    .split("\n")
    .map((line) => pad + line)
    .join("\n");
}

main();
