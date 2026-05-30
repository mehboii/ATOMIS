/**
 * @file lexer.test.ts
 * @module atomis/tests/lexer
 *
 * Unit tests for the Atomis lexer using Node's built-in `assert`.
 * Run after building: `node dist/tests/lexer.test.js`.
 */

import * as assert from "assert";
import { Lexer, Token, TokenType, tokenize } from "../lexer";

/** Minimal test runner: tracks pass/fail and exits non-zero on failure. */
let passed = 0;
let failed = 0;

/**
 * Register and immediately run a test case.
 * @param name Test description.
 * @param fn Test body (throws on failure).
 */
function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${name}\n    ${(err as Error).message}`);
  }
}

/** Tokenize and drop trivia (NEWLINE/COMMENT/EOF) for terse assertions. */
function meaningful(src: string): Token[] {
  return tokenize(src).filter(
    (t) =>
      t.type !== TokenType.NEWLINE &&
      t.type !== TokenType.EOF &&
      t.type !== TokenType.COMMENT,
  );
}

console.log("lexer.test.ts");

test("tokenizes a simple atom declaration", () => {
  const toks = meaningful("atom x = 5");
  assert.strictEqual(toks[0].type, TokenType.KEYWORD);
  assert.strictEqual(toks[0].value, "atom");
  assert.strictEqual(toks[1].type, TokenType.IDENT);
  assert.strictEqual(toks[1].value, "x");
  assert.strictEqual(toks[2].value, "=");
  assert.strictEqual(toks[3].type, TokenType.NUMBER);
  assert.strictEqual(toks[3].value, "5");
});

test("recognizes Atomis keywords", () => {
  for (const kw of ["fn", "pure", "match", "guard", "node", "channel", "mesh", "connect", "encrypt"]) {
    const toks = meaningful(kw);
    assert.strictEqual(toks[0].type, TokenType.KEYWORD, `${kw} should be a KEYWORD`);
  }
});

test("distinguishes -> (ARROW) from => (OPERATOR)", () => {
  const arrow = meaningful("->");
  assert.strictEqual(arrow[0].type, TokenType.ARROW);
  const fat = meaningful("=>");
  assert.strictEqual(fat[0].type, TokenType.OPERATOR);
  assert.strictEqual(fat[0].value, "=>");
});

test("tokenizes decorators", () => {
  const toks = meaningful("@cell @render @import @meta");
  assert.deepStrictEqual(
    toks.map((t) => t.value),
    ["@cell", "@render", "@import", "@meta"],
  );
  assert.ok(toks.every((t) => t.type === TokenType.DECORATOR));
});

test("captures double and single quoted strings", () => {
  const toks = meaningful(`"hello" 'world'`);
  assert.strictEqual(toks[0].type, TokenType.STRING);
  assert.strictEqual(toks[0].value, `"hello"`);
  assert.strictEqual(toks[1].value, `'world'`);
});

test("captures template literals with interpolation as one token", () => {
  const toks = meaningful("`Found ${count} peers`");
  assert.strictEqual(toks.length, 1);
  assert.strictEqual(toks[0].type, TokenType.STRING);
  assert.strictEqual(toks[0].value, "`Found ${count} peers`");
});

test("handles nested braces inside interpolation", () => {
  const toks = meaningful("`${ {a:1}.a }`");
  assert.strictEqual(toks.length, 1);
  assert.strictEqual(toks[0].value, "`${ {a:1}.a }`");
});

test("skips line and block comments as COMMENT tokens", () => {
  const all = tokenize("// hi\n/* block */ atom");
  const comments = all.filter((t) => t.type === TokenType.COMMENT);
  assert.strictEqual(comments.length, 2);
  const kw = all.find((t) => t.value === "atom");
  assert.strictEqual(kw?.type, TokenType.KEYWORD);
});

test("emits NEWLINE tokens", () => {
  const all = tokenize("a\nb");
  assert.ok(all.some((t) => t.type === TokenType.NEWLINE));
});

test("recognizes braces as LBRACE/RBRACE", () => {
  const toks = meaningful("{ }");
  assert.strictEqual(toks[0].type, TokenType.LBRACE);
  assert.strictEqual(toks[1].type, TokenType.RBRACE);
});

test("tokenizes multi-character operators greedily", () => {
  const toks = meaningful("a === b && c");
  assert.strictEqual(toks[1].value, "===");
  assert.strictEqual(toks[3].value, "&&");
});

test("tokenizes numbers including floats and hex", () => {
  const toks = meaningful("3.14 0xFF 42");
  assert.strictEqual(toks[0].value, "3.14");
  assert.strictEqual(toks[1].value, "0xFF");
  assert.strictEqual(toks[2].value, "42");
  assert.ok(toks.every((t) => t.type === TokenType.NUMBER));
});

test("records source positions and offsets", () => {
  const toks = tokenize("atom x");
  assert.strictEqual(toks[0].line, 1);
  assert.strictEqual(toks[0].col, 1);
  assert.strictEqual(toks[0].start, 0);
  assert.strictEqual(toks[0].end, 4);
});

test("always terminates with an EOF token", () => {
  const toks = new Lexer("anything").tokenize();
  assert.strictEqual(toks[toks.length - 1].type, TokenType.EOF);
});

console.log(`\nlexer: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
