import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
const { compile } = require('../dist/compiler.js');
const { tokenize } = require('../dist/lexer.js');
const { rewriteResultSugar } = require('../dist/transformer.js');
const ts = require('typescript');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(join(tmpdir(), 'atomis audit '));
const options = { fileName: 'case.ato', outputFile: 'case.ts', sourceMap: false };
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`PASS ${name}`); }
  catch (e) { failed++; console.error(`FAIL ${name}: ${e.message}`); }
}
function syntax(code) {
  const file = ts.createSourceFile('case.ts', code, ts.ScriptTarget.Latest, true);
  assert.deepEqual(file.parseDiagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), []);
}
const rust = join(root, 'atomis-rs/target/debug', process.platform === 'win32' ? 'atomis.exe' : 'atomis');
const engines = [['TS', process.execPath, [join(root, 'dist/cli.js')]], ['Rust', rust, []]];
function cli(exe, prefix, args, cwd = root) {
  return spawnSync(exe, [...prefix, ...args], { cwd, encoding: 'utf8', timeout: 5000 });
}

try {
  test('npm entry point exports the compiler', () => assert.equal(require('../dist/index.js').compile,compile));
  test('compile blocks semantic errors', () => {
    const r = compile('atom x: number = "bad"', options);
    assert.equal(r.analysis.hasErrors, true); assert.equal(r.code, ''); assert.equal(r.map, undefined);
  });
  for (const text of ['"Ok(1) Result<T,E>"', "'Err(2)'", '`Ok(3)`', '// Ok(4)', '/* Err(5) */']) {
    test(`Result preserves ${text}`, () => assert.equal(rewriteResultSugar(text), text));
  }
  test('Result balances strings in arguments', () => {
    const code = compile('output(Ok(")"))', options).code; syntax(code);
    assert.ok(code.includes('value: ")"'));
  });
  test('nested Result calls', () => {
    const code = compile('output(Ok(Ok(1)))', options).code;
    assert.ok(!code.includes('Ok(')); syntax(code);
  });
  test('Result type nested and array grouping', () => {
    const code = compile('let x: Result<Result<number,string>,Error>[] = []', options).code;
    assert.ok(!code.includes('Result<')); assert.match(code, /\)\[\]/); syntax(code);
  });
  test('import literal retains escaping', () => syntax(compile('@import { a } from \'has"quote\'', options).code));
  test('import source escape meanings are preserved', () => {
    for(const literal of ['"a\\n"','"a\\\"b"',"'a\"b'","'a\\\'b'"]){
      const source='import {a} from '+literal;
      const before=ts.createSourceFile('before.ts',source,ts.ScriptTarget.Latest,true).statements[0].moduleSpecifier.text;
      const code=compile('@'+source,options).code;syntax(code);
      assert.equal(ts.createSourceFile('after.ts',code,ts.ScriptTarget.Latest,true).statements[0].moduleSpecifier.text,before);
    }
  });
  test('empty source', () => assert.equal(compile('', options).code, '\n'));
  test('whole-expression literal type checks', () => {
    for (const source of ["atom x: string = 1 + 'x'", "atom x: number = '42'.length", 'atom x: boolean = 1 < 2']) assert.equal(compile(source,options).analysis.hasErrors,false);
  });
  test('trailing comments and statement boundaries are preserved', () => {
    assert.equal(compile('let x = 1 // keep', options).code, 'let x = 1 // keep\n');
    assert.equal(compile('let x = 1 // +\natom y = 2', options).code, 'let x = 1 // +\nlet y = 2\n');
  });
  test('nested cell await and literal await', () => {
    assert.ok(compile('@cell #x { guard true else { await Promise.resolve() } }',options).code.includes('async () =>'));
    assert.ok(!compile('@cell #x { output("await") }',options).code.includes('async () =>'));
  });
  test('atom terminates at enclosing brace', () => syntax(compile('fn f() { atom x = 1 }\natom y: number;',options).code));
  test('deterministic output and map', () => {
    const source = 'atom x = 1\r\noutput(x)';
    assert.deepEqual(compile(source, { ...options, sourceMap: true }), compile(source, { ...options, sourceMap: true }));
  });
  test('Unicode token spans and CRLF', () => {
    const source = '"😀"\r\natom x = 1'; const tokens = tokenize(source);
    for (const t of tokens.filter(t => t.type !== 'EOF')) assert.equal(source.slice(t.start, t.end), t.value);
    const atom = tokens.find(t => t.value === 'atom'); assert.equal(atom.line, 2); assert.equal(atom.col, 1);
  });
  test('templates ignore braces in interpolation strings and comments', () => {
    for (const source of ['`${"{"}`', '`${`{${1}}`}`', '`${1 /* { */}`']) {
      const tokens=tokenize(source); assert.equal(tokens[0].type,'STRING'); assert.equal(tokens[0].value,source); assert.equal(tokens.length,2);
    }
  });
  test('generated GhostNet names cannot collide', () => {
    for (const source of ['node "a-b" {}\nnode "a_b" {}','node "same" {}\nchannel "same" {}']) assert.equal(compile(source,options).analysis.hasErrors,true);
  });
  test('Result generic recursion is bounded', () => assert.throws(() => compile('let x: '+'Result<'.repeat(300)+'number'+',Error>'.repeat(300),options),/nesting/));
  test('vendored protocol validates version and trailing bytes', () => {
    const {encode,decode}=require('proto');
    const value={version:2,id:1,body:{Ack:{ack_of:1,status:'Received',sent_at:0}}};
    assert.throws(()=>decode(encode(value))); value.version=1;
    const bytes=encode(value); const extra=new Uint8Array(bytes.length+1); extra.set(bytes); assert.throws(()=>decode(extra));
  });
  test('vendored vault handle does not resurrect', () => {
    const {vault_unlock,vault_free}=require('ghostvault');
    const stale=vault_unlock(new Uint8Array([1])); vault_free(stale);
    for(let i=0;i<=65535;i++) { const h=vault_unlock(new Uint8Array([2])); assert.notEqual(h,stale); vault_free(h); }
  });
  for (const source of ['atom x =', 'atom x:', 'fn f(a b) {}', 'fn f(1) {}', 'fn f() -> {}', 'guard else {}', 'match x { => 1 }', 'node "x" { key: }', '@render { rubbish }']) {
    test(`reject malformed construct ${source}`, () => assert.throws(() => compile(source, options)));
  }
  const constructs = [
    ['fn f(x: number = 2) -> number { return x * (3 + 4) }', 'function f'],
    ['async fn f() { await Promise.resolve() }', 'async function'],
    ['pure fn f() { return 1 }', '/** @pure */'],
    ['guard true else { output("no") }', 'if (!(true))'],
    ['match x { 0 => output("zero"), _ => output("other") }', 'else'],
    ['@meta { name: demo }', '__atomis_meta'],
    ['@cell #one { output(1) }', '__atomis_cell'],
    ['@render { view Hello { <div /> } }', 'function Hello'],
    ['node relay "n" {}\nchannel "c" {}\nmesh "m" {}\nconnect "c" -> "n" via tcp\nencrypt { algorithm: aes256 }', 'setEncryptionPolicy'],
    ['const a = [1,2];\nfor (const x of a) { console.log(x) }', 'for (const x'],
  ];
  for (const [source, expected] of constructs) test(`conformance ${expected}`, () => assert.ok(compile(source, options).code.includes(expected)));
  for (const [name, exe, prefix] of engines) {
    test(`${name} help`, () => { const r = cli(exe, prefix, ['--help']); assert.equal(r.status, 0); assert.match(r.stdout, /Usage/); });
    test(`${name} missing file`, () => assert.equal(cli(exe, prefix, ['check', join(work, 'missing.ato')]).status, 1));
    test(`${name} version and invalid flags`, () => {
      assert.equal(cli(exe,prefix,['--version']).stdout.trim(),'0.1.0');
      for (const args of [['build','--out'],['build','--bogus'],['check','a.ato','--out','x']]) assert.equal(cli(exe,prefix,args).status,1);
    });
    test(`${name} trusted run with spaces and shell metacharacters`, () => {
      const dir=join(root,'.parity-tmp','audit runtime'); mkdirSync(dir,{recursive:true});
      const file=join(dir,`${name} & trusted.ato`);
      const oldTemp=file.replace(/\.ato$/,'.__atomis__.ts');
      writeFileSync(file,'output(6 * 7)'); writeFileSync(oldTemp,'preserve');
      try {
        const result=cli(exe,prefix,['run',file]); assert.equal(result.error,undefined); assert.equal(result.status,0,result.stderr); assert.equal(result.stdout,'42\n');
        assert.equal(readFileSync(oldTemp,'utf8'),'preserve'); assert.equal(readFileSync(file,'utf8'),'output(6 * 7)');
      } finally { rmSync(file,{force:true}); rmSync(oldTemp,{force:true}); }
    });
    test(`${name} rejects source overwrite`, () => {
      const file = join(work, `${name}.txt`); writeFileSync(file, 'output(1)');
      assert.equal(cli(exe, prefix, ['build', file]).status, 1); assert.equal(readFileSync(file, 'utf8'), 'output(1)');
      assert.equal(cli(exe, prefix, ['run', file]).status, 1); assert.equal(readFileSync(file, 'utf8'), 'output(1)');
    });
    for (const source of ['}', '@cell #x\n}', '"unterminated', '/* unterminated', '`unterminated']) {
      test(`${name} rejects ${JSON.stringify(source)} without hanging`, () => {
        const file = join(work, 'invalid.ato'); writeFileSync(file, source);
        const r = cli(exe, prefix, ['check', file]); assert.equal(r.error, undefined); assert.equal(r.status, 1);
        assert.match(r.stderr, /\[\d+:\d+\]/);
      });
    }
    test(`${name} bounded nesting`, () => {
      const file = join(work, 'deep.ato'); writeFileSync(file, 'fn f() {'.repeat(300) + '}'.repeat(300));
      const r = cli(exe, prefix, ['check', file]); assert.equal(r.error, undefined); assert.equal(r.status, 1); assert.match(r.stderr, /nesting/i);
    });
    test(`${name} paths with spaces, map and target execution`, () => {
      const file = join(work, 'hello world.ato'); const out = join(work, name);
      writeFileSync(file, 'fn twice(x: number) -> number { return x * 2 }\noutput(twice(21))');
      const r = cli(exe, prefix, ['build', file, '--out', out], work); assert.equal(r.status, 0, r.stderr);
      const code = readFileSync(join(out, 'hello world.ts'), 'utf8'); syntax(code);
      assert.ok(existsSync(join(out, 'hello world.ts.ato.map')));
      const map = JSON.parse(readFileSync(join(out, 'hello world.ts.ato.map'), 'utf8')); assert.equal(map.version, 3);
      assert.deepEqual(map.sourcesContent, [readFileSync(file, 'utf8')]);
      // Only the fixed, trusted arithmetic fixture above is executed, with a timeout.
      const js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
      const result = cli(process.execPath, [], ['-e', js]); assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, '42\n');
    });
  }
  // Watch is exercised through real add/change events; generated source is never run.
  for (const [name,exe,prefix] of engines) {
    const input=join(work,`${name}-watch`), out=join(work,`${name}-watch-out`); mkdirSync(input);
    const child=spawn(exe,[...prefix,'watch',input,'--out',out],{cwd:root,stdio:'ignore'});
    const waitFor=async predicate=>{const start=Date.now();while(Date.now()-start<10000){if(predicate())return;await new Promise(r=>setTimeout(r,100));}throw new Error('watch event timed out');};
    try {
      await new Promise(r=>setTimeout(r,600)); const source=join(input,'event.ato'), output=join(out,'event.ts');
      writeFileSync(source,'output(1)'); await waitFor(()=>existsSync(output)&&readFileSync(output,'utf8').includes('console.log(1)'));
      writeFileSync(source,'output(2)'); await waitFor(()=>readFileSync(output,'utf8').includes('console.log(2)'));
      passed++;console.log(`PASS ${name} watch add/change`);
    } catch(e){failed++;console.error(`FAIL ${name} watch add/change: ${e.message}`);}
    finally { child.kill(); await new Promise(r=>{child.once('close',r);setTimeout(r,2000);}); }
  }
} finally { rmSync(work, { recursive: true, force: true }); }
console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
