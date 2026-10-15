import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(import.meta.url), {compile}=require('../dist/compiler.js'), ts=require('typescript');
const profile=process.argv.includes('--release')?'release':'debug';
const rust=join(root,'atomis-rs/target',profile,process.platform==='win32'?'atomis.exe':'atomis');
const work=mkdtempSync(join(tmpdir(),'atomis-semantics-'));
const options={fileName:'case.ato',outputFile:'case.ts',sourceMap:true};
const invalid=[
 ['duplicate atom','atom x = 1\natom x = 2',/already declared/],
 ['duplicate function','fn f() {}\nfn f() {}',/already declared/],
 ['mixed declaration','atom f = 1\nfn f() {}',/already declared/],
 ['duplicate parameter','fn f(x: number, x: number) {}',/already declared/],
 ['parameter/local conflict','fn f(x: number) { atom x = 2 }',/already declared/],
 ['node escapes function','fn setup() { node "n" {} }\nchannel "c" {}\nconnect "c" -> "n" via tcp',/out-of-scope node/],
 ['channel escapes guard','node "n" {}\nguard false else { channel "c" {} }\nconnect "c" -> "n" via tcp',/out-of-scope channel/],
 ['node escapes cell','@cell #setup { node "n" {} }\nchannel "c" {}\nconnect "c" -> "n" via tcp',/out-of-scope node/],
 ['sibling function scope','fn setup() { node "n" {} }\nfn use() { channel "c" {}\nconnect "c" -> "n" via tcp }',/out-of-scope node/],
];
const valid=[
 ['atom shadowing','atom x = 1\nfn f() { atom x = 2 }'],
 ['nested local connection','fn setup() { node "n" {}\nchannel "c" {}\nconnect "c" -> "n" via tcp }'],
 ['outer capture','node "n" {}\nchannel "c" {}\nfn use() { connect "c" -> "n" via tcp }'],
 ['nested guard capture','node "n" {}\nchannel "c" {}\nguard false else { connect "c" -> "n" via tcp }'],
 ['nested cell capture','node "n" {}\nchannel "c" {}\n@cell #use { connect "c" -> "n" via tcp }'],
 ['forward lexical capture','fn use() { connect "c" -> "n" via tcp }\nnode "n" {}\nchannel "c" {}'],
];
let passed=0,failed=0;
function test(name,fn){try{fn();passed++;console.log('PASS '+name);}catch(e){failed++;console.error('FAIL '+name+': '+e.message);}}
function cli(engine,args){const r=spawnSync(engine==='TS'?process.execPath:rust,engine==='TS'?[join(root,'dist/cli.js'),...args]:args,{cwd:root,encoding:'utf8',timeout:5000});assert.equal(r.error,undefined);return r;}
try{
 test('features example strict target and actual returned values',()=>{
  const source=readFileSync(join(root,'examples/features.ato'),'utf8');
  const result=compile(source,options);assert.equal(result.analysis.hasErrors,false);
  const target=join(work,'features.ts');writeFileSync(target,result.code);
  const program=ts.createProgram([target],{strict:true,noEmit:true,types:[],target:ts.ScriptTarget.ES2020});
  assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d=>ts.flattenDiagnosticMessageText(d.messageText,' ')),[]);
  // Execute only the inspected example and fixed assertions; VM is not a security sandbox.
  const {runInNewContext}=require('node:vm');
  const js=ts.transpileModule(result.code,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
  const actual=runInNewContext(js+'\nJSON.stringify([label(0),label(1),label(2),classify(-1).ok,classify(1).ok,parsed.value])',Object.create(null),{timeout:1000});
  assert.equal(actual,'["zero","one","many",false,true,42]');
 });
 for(const [name,source,pattern] of invalid)test(name,()=>{
  const result=compile(source,options);assert.equal(result.analysis.hasErrors,true);assert.equal(result.code,'');assert.equal(result.map,undefined);
  assert.ok(result.analysis.diagnostics.some(d=>d.severity==='error'&&pattern.test(d.message)));
  const file=join(work,'case.ato');writeFileSync(file,source);
  const left=cli('TS',['check',file]),right=cli('Rust',['check',file]);
  assert.equal(left.status,1);assert.equal(right.status,1);assert.equal(left.stderr,right.stderr);assert.match(left.stderr,pattern);for(const d of result.analysis.diagnostics) assert.ok(left.stderr.includes(':'+d.line+':'+d.col+' error '+d.message));
  for(const engine of ['TS','Rust']) {
   const out=join(work,engine), target=join(out,'case.ts');
   mkdirSync(out,{recursive:true}); writeFileSync(target,'preserve');
   assert.equal(cli(engine,['build',file,'--out',out]).status,1);
   assert.equal(readFileSync(target,'utf8'),'preserve');
  }
 });
 for(const [name,source] of valid)test(name,()=>{
  const result=compile(source,options);assert.equal(result.analysis.hasErrors,false);
  const file=join(work,'case.ato');writeFileSync(file,source);
  const prelude='declare class GhostNode { constructor(config: unknown); }\ndeclare class GhostChannel { constructor(config: unknown); connect(node: GhostNode, transport: string): void; }\ndeclare function __atomis_cell(name: string, body: () => void): void;\n';
  const target=join(work,'target.ts');writeFileSync(target,prelude+result.code);
  const program=ts.createProgram([target],{strict:true,noEmit:true,types:[],target:ts.ScriptTarget.ES2020});
  assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d=>ts.flattenDiagnosticMessageText(d.messageText,' ')),[]);
  for(const engine of ['TS','Rust']){assert.equal(cli(engine,['check',file]).status,0);assert.equal(cli(engine,['build',file,'--out',join(work,engine)]).status,0);}
  for(const suffix of ['', '.ato.map'])assert.equal(readFileSync(join(work,'TS','case.ts'+suffix),'utf8'),readFileSync(join(work,'Rust','case.ts'+suffix),'utf8'));
 });
}finally{rmSync(work,{recursive:true,force:true});}
console.log(passed+' passed, '+failed+' failed ('+profile+')');process.exitCode=failed?1:0;
