import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),require=createRequire(import.meta.url);
const {compile}=require('../dist/compiler.js'),{validateTarget}=require('../dist/target-check.js');
const work=mkdtempSync(join(root,'.parity-tmp/target-'));
const opts={fileName:join(work,'case.ato'),outputFile:'case.ts',sourceMap:true,targetCheck:true};
let passed=0,failed=0;
function test(name,fn){try{fn();passed++;console.log('PASS '+name);}catch(e){failed++;console.error('FAIL '+name+': '+e.message);}}
function cli(args){const r=spawnSync(process.execPath,[join(root,'dist/cli.js'),...args],{cwd:root,encoding:'utf8',timeout:15000});assert.equal(r.error,undefined);return r;}
try {
 const invalid=[
  ['undefined name','const x = missingName',/Undefined identifier/],
  ['call arity','fn f(x: number) {}\nf()',/TS2554/],
  ['call type','fn f(x: number) {}\nf("bad")',/TS2345/],
  ['raw duplicate','let x = 1; let x = 2;',/already declared/],
  ['type mismatch','const x: number = "bad"',/TS2322/],
  ['invalid operator','const x = true + 1',/TS2365/],
  ['immutable assignment','const x = 1; x = 2;',/Cannot assign to constant/],
  ['missing return','fn f() -> string {}',/TS2355/],
  ['wrong return','fn f() -> number { return "bad" }',/TS2322/],
  ['scope escape','fn f() { const local = 1; }\noutput(local)',/Undefined identifier/],
  ['unresolved import','@import { x } from "atomis-nonexistent-test-package"',/TS2307/],
  ['missing export','@import { nonexistent } from "node:net"',/TS2305/],
  ['invalid regex range','const r = /[z-a]/',/regex|TS1517/],
  ['invalid regex quantifier','const r = /a{4,2}/',/regex|TS1506/],
  ['invalid regex escape','const r = /\\uZZZZ/u',/regex|TS/],
  ['invalid radix','atom x = 0b2',/TS1177/],
 ];
 for(const [name,source,pattern] of invalid)test(name,()=>{
  const r=compile(source,opts);assert.equal(r.analysis.hasErrors,true);assert.equal(r.code,'');assert.equal(r.map,undefined);
  assert.ok(r.analysis.diagnostics.some(d=>pattern.test(d.message)));assert.ok(r.analysis.diagnostics.every(d=>d.line>0&&d.col>0));
 });
 for(const source of ['fn f(x: number = 2) -> number { return x }\noutput(f())','let x = 1;\nfn f() { let x = "inner"; return x }','@import { createServer } from "node:net"\nconst server = createServer();','const r = /[a-z]+/gi;', '@import { basename as leaf } from "node:path"\noutput(leaf("a/b"))','fn f() -> string { match 2 { 1 => return "one", _ => return "other" } }'])test('valid target '+source.slice(0,35),()=>{const r=compile(source,opts);assert.equal(r.analysis.hasErrors,false,JSON.stringify(r.analysis.diagnostics));assert.ok(r.code);});
 test('CLI flags, diagnostics and failed output preservation',()=>{
  const file=opts.fileName,out=join(work,'out');mkdirSync(out);writeFileSync(file,'const x = missingName');
  writeFileSync(join(out,'case.ts'),'preserve');writeFileSync(join(out,'case.ts.ato.map'),'map-preserve');
  for(const args of [['check','--target-check',file],['build',file,'--out',out,'--target-check'],['run',file,'--target-check']]){
   const r=cli(args);assert.equal(r.status,1);assert.match(r.stderr,/Undefined identifier/);assert.ok(r.stderr.includes(file+':1:1'));
  }
  assert.equal(readFileSync(join(out,'case.ts'),'utf8'),'preserve');assert.equal(readFileSync(join(out,'case.ts.ato.map'),'utf8'),'map-preserve');
 });
 test('target check never executes source',()=>{
  const marker=join(work,'must-not-exist');writeFileSync(opts.fileName,'@import { writeFileSync } from "node:fs"\nwriteFileSync('+JSON.stringify(marker)+', "executed")');
  const r=cli(['check',opts.fileName,'--target-check']);assert.equal(r.status,0,r.stderr);assert.equal(existsSync(marker),false);
 });
 test('missing GhostNet runtime is diagnosed',()=>{
  const source=readFileSync(join(root,'examples/network.ato'),'utf8');
  const core=compile(source,{...opts,targetCheck:false});assert.ok(core.analysis.diagnostics.some(d=>d.message==="Undefined identifier 'channel'"));
  // Supply only the missing value declaration to reach the independent target-stage dependency checks. No runtime mock is executed.
  const r=compile('declare const channel: { send(...args: unknown[]): void };\n'+source,{...opts,fileName:join(root,'examples/network.ato')});
  assert.equal(r.analysis.hasErrors,true);assert.equal(r.code,'');assert.ok(r.analysis.diagnostics.some(d=>/ghostnet\/core|GhostNode|__atomis_cell/.test(d.message)));
 });
 test('Rust output can use the standalone target checker',()=>{
  const file=opts.fileName;writeFileSync(file,'const x: number = "bad"');
  const rust=join(root,'atomis-rs/target/debug',process.platform==='win32'?'atomis.exe':'atomis');
  const r=spawnSync(rust,['build',file,'--out',work],{cwd:root,encoding:'utf8',timeout:5000});assert.equal(r.status,0,r.stderr);
  const emitted=readFileSync(join(work,'case.ts'),'utf8');assert.ok(validateTarget(emitted,join(work,'case.ts')).some(d=>/TS2322/.test(d.message)));
  const checked=spawnSync(process.execPath,[join(root,'dist/target-check.js'),join(work,'case.ts')],{cwd:root,encoding:'utf8',timeout:15000});assert.equal(checked.status,1);assert.match(checked.stderr,/TS2322/);
 });
} finally { rmSync(work,{recursive:true,force:true}); }
console.log(passed+' passed, '+failed+' failed');process.exitCode=failed?1:0;
