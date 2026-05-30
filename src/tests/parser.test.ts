/**
 * @file parser.test.ts
 * @module atomis/tests/parser
 *
 * Unit tests for the Atomis parser using Node's built-in `assert`.
 * Run after building: `node dist/tests/parser.test.js`.
 */

import * as assert from "assert";
import {
  AtomDecl,
  CellBlock,
  ChannelDecl,
  ConnectStmt,
  EncryptDecl,
  FnDecl,
  GuardStmt,
  ImportDecl,
  MatchExpr,
  MeshDecl,
  NodeDecl,
  OutputCall,
  Program,
} from "../ast";
import { tokenize } from "../lexer";
import { parse } from "../parser";

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

/** Parse a source string into a Program AST. */
function p(src: string): Program {
  return parse(tokenize(src), src);
}

console.log("parser.test.ts");

test("parses an atom declaration with type and initializer", () => {
  const ast = p("atom activeNodes: Node[] = []");
  const atom = ast.body[0] as AtomDecl;
  assert.strictEqual(atom.type, "AtomDecl");
  assert.strictEqual(atom.name, "activeNodes");
  assert.strictEqual(atom.typeAnnotation, "Node[]");
  assert.strictEqual(atom.initializer, "[]");
});

test("parses a fn declaration with params and return type", () => {
  const ast = p("fn sendMsg(text: string) -> void { return }");
  const fn = ast.body[0] as FnDecl;
  assert.strictEqual(fn.type, "FnDecl");
  assert.strictEqual(fn.name, "sendMsg");
  assert.strictEqual(fn.params.length, 1);
  assert.strictEqual(fn.params[0].name, "text");
  assert.strictEqual(fn.params[0].typeAnnotation, "string");
  assert.strictEqual(fn.returnType, "void");
});

test("parses a pure fn", () => {
  const ast = p("pure fn add(a: number, b: number) -> number { return a + b }");
  assert.strictEqual(ast.body[0].type, "PureFnDecl");
});

test("parses a guard statement", () => {
  const ast = p("fn f() -> void { guard text.length > 0 else { return } }");
  const fn = ast.body[0] as FnDecl;
  const guard = fn.body[0] as GuardStmt;
  assert.strictEqual(guard.type, "GuardStmt");
  assert.strictEqual(guard.condition, "text.length > 0");
  assert.strictEqual(guard.elseBody.length, 1);
});

test("parses a match expression with a wildcard arm", () => {
  const ast = p("match x { 1 => a, 2 => b, _ => c }");
  const m = ast.body[0] as MatchExpr;
  assert.strictEqual(m.type, "MatchExpr");
  assert.strictEqual(m.discriminant, "x");
  assert.strictEqual(m.arms.length, 3);
  assert.strictEqual(m.arms[2].isWildcard, true);
});

test("parses a node declaration with kind, id and config", () => {
  const ast = p(`node relay "node-01" { type: esp32, transport: [bluetooth, tcp] }`);
  const node = ast.body[0] as NodeDecl;
  assert.strictEqual(node.type, "NodeDecl");
  assert.strictEqual(node.kind, "relay");
  assert.strictEqual(node.id, "node-01");
  assert.strictEqual(node.config[0].key, "type");
  assert.strictEqual(node.config[0].value, `"esp32"`); // bare word quoted
  assert.strictEqual(node.config[1].value, `["bluetooth", "tcp"]`);
});

test("parses a channel declaration and preserves boolean values", () => {
  const ast = p(`channel "ghostchat" { e2e: true, persist: false }`);
  const ch = ast.body[0] as ChannelDecl;
  assert.strictEqual(ch.type, "ChannelDecl");
  assert.strictEqual(ch.id, "ghostchat");
  assert.strictEqual(ch.config[0].value, "true");
  assert.strictEqual(ch.config[1].value, "false");
});

test("parses a mesh declaration", () => {
  const ast = p(`mesh "m1" { region: us }`);
  const mesh = ast.body[0] as MeshDecl;
  assert.strictEqual(mesh.type, "MeshDecl");
  assert.strictEqual(mesh.id, "m1");
});

test("parses a connect statement", () => {
  const ast = p(`connect "ghostchat" -> "node-01" via bluetooth`);
  const c = ast.body[0] as ConnectStmt;
  assert.strictEqual(c.type, "ConnectStmt");
  assert.strictEqual(c.channel, "ghostchat");
  assert.strictEqual(c.node, "node-01");
  assert.strictEqual(c.transport, "bluetooth");
});

test("parses an encrypt declaration", () => {
  const ast = p(`encrypt { algorithm: aes256, forward_secrecy: true }`);
  const e = ast.body[0] as EncryptDecl;
  assert.strictEqual(e.type, "EncryptDecl");
  assert.strictEqual(e.config[0].key, "algorithm");
  assert.strictEqual(e.config[1].value, "true");
});

test("parses an @import decorator", () => {
  const ast = p(`@import { mesh, GhostChannel } from "ghostnet/core"`);
  const imp = ast.body[0] as ImportDecl;
  assert.strictEqual(imp.type, "ImportDecl");
  assert.deepStrictEqual(imp.names, ["mesh", "GhostChannel"]);
  assert.strictEqual(imp.module, "ghostnet/core");
});

test("parses an inline @cell block until a blank line", () => {
  const ast = p(`@cell #scan\nx = await scan()\noutput(\`done\`)\n\nfn after() -> void {}`);
  const cell = ast.body[0] as CellBlock;
  assert.strictEqual(cell.type, "CellBlock");
  assert.strictEqual(cell.name, "scan");
  assert.strictEqual(cell.isAsync, true);
  assert.strictEqual(cell.body.length, 2);
  // The fn after the blank line is a separate top-level statement.
  assert.strictEqual(ast.body[1].type, "FnDecl");
});

test("treats unknown TypeScript as passthrough", () => {
  const ast = p(`const greeting: string = "hi";`);
  assert.strictEqual(ast.body[0].type, "TSPassthrough");
});

test("does not treat channel.send(...) as a channel declaration", () => {
  const ast = p(`channel.send("ghostchat", text)`);
  assert.strictEqual(ast.body[0].type, "TSPassthrough");
});

test("parses output() as an OutputCall", () => {
  const ast = p("output(`Found ${n} peers`)");
  const out = ast.body[0] as OutputCall;
  assert.strictEqual(out.type, "OutputCall");
  assert.strictEqual(out.argument, "`Found ${n} peers`");
});

console.log(`\nparser: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
