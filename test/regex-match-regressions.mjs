import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),require=createRequire(import.meta.url);
const {compile}=require('../dist/compiler.js'),{tokenize}=require('../dist/lexer.js'),ts=require('typescript');
const {runInNewContext}=require('node:vm');
const profile=process.argv.includes('--release')?'release':'debug';
const rust=join(root,'atomis-rs/target',profile,process.platform==='win32'?'atomis.exe':'atomis');
const work=mkdtempSync(join(tmpdir(),'atomis-regex-match-'));
const opts={fileName:'case.ato',outputFile:'case.ts',sourceMap:false};
let passed=0,failed=0;
function test(name,fn){try{fn();passed++;console.log('PASS '+name);}catch(e){failed++;console.error('FAIL '+name+': '+e.message);}}
function cli(engine,args){const r=spawnSync(engine==='TS'?process.execPath:rust,engine==='TS'?[join(root,'dist/cli.js'),...args]:args,{cwd:root,encoding:'utf8',timeout:5000});assert.equal(r.error,undefined);return r;}
function pair(source){
 const file=join(work,'case.ato');writeFileSync(file,source);
 const result=compile(source,opts);assert.equal(result.analysis.hasErrors,false);
 for(const engine of ['TS','Rust']){const r=cli(engine,['build',file,'--out',join(work,engine)]);assert.equal(r.status,0,r.stderr);}
 const code=readFileSync(join(work,'TS','case.ts'),'utf8');
 for(const suffix of ['', '.ato.map'])assert.equal(readFileSync(join(work,'TS','case.ts'+suffix),'utf8'),readFileSync(join(work,'Rust','case.ts'+suffix),'utf8'));
 const target=join(work,'target.ts');writeFileSync(target,code);
 const program=ts.createProgram([target],{noEmit:true,strict:true,types:[],target:ts.ScriptTarget.ES2020});
 assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d=>ts.flattenDiagnosticMessageText(d.messageText,' ')),[]);
 return result.code;
}
// Only this inspected fixed corpus executes. VM is not a hostile-code sandbox.
function evaluate(code,expression){const js=ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;return runInNewContext(js+'\nJSON.stringify('+expression+')',Object.create(null),{timeout:1000});}
try{
 const literals=['/}/','/Ok(1)|Err(2)|Result<T,E>/','/\\w+\\s\\d/gi','/\\\\/','/\\//','/[a-z\\d/]+/gim','/^(?:ab|cd){2,4}?(x)$/s','/\\u{1F600}/u','/^x$/y','/a/gimsuy','/[\\]{}()]/','/(?<word>a+)\\k<word>/u'];
 for(const literal of literals)test('regex preserved '+literal,()=>{
  const code=pair('fn value() { return '+literal+' }');assert.ok(code.includes(literal));
  const slash=literal.lastIndexOf('/'),expected=new RegExp(literal.slice(1,slash),literal.slice(slash+1));
  assert.equal(evaluate(code,'[value().source,value().flags,value().test("abc/Ok1😀")]'),JSON.stringify([expected.source,expected.flags,expected.test('abc/Ok1😀')]));
  assert.equal(tokenize(literal)[0].type,'REGEX');
 });
 test('regex in sugar, control flow and interpolation',()=>{
  const tick=String.fromCharCode(96);
  const code=pair('atom r = /Ok(1)/\nfn value() { return Ok(/Err(2)/) }\nfn text() { return '+tick+'}'+tick+' }\nif (true) /Ok(1)/.test("Ok1");');
  assert.equal(evaluate(code,'[r.source,value().value.source,text()]'),'["Ok(1)","Err(2)","}"]');
 });
 test('division and /= retain behavior',()=>{
  const code=pair('fn value() { return 8 }\nlet n = value() / 2;\nn /= 2;\nconst obj = {value:8};\nconst q = obj.value / 2;\nconst methods = {return: 8, if: () => 8};\nconst a = methods.return / 2;\nconst b = methods.if() / 2;');
  assert.equal(evaluate(code,'[n,q,a,b]'),'[2,4,4,4]');
 });
 test('cell async detection includes awaited patterns',()=>{
  const code=pair('declare function __atomis_cell(name: string, callback: () => void): void;\n@cell #x { match 1 { await Promise.resolve(1) => console.log(1) } }');
  assert.ok(code.includes('async () =>'));
 });
 const matches=[
  ['single evaluation and pattern order','let count = 0;\nlet events: number[] = [];\nfn value() { count++; return 2 }\nfn pattern(n: number) { events.push(n); return n }\nlet chosen = "none";\nmatch value() { pattern(1) => chosen = "one", pattern(2) => chosen = "two", pattern(3) => chosen = "three", _ => chosen = "wild" }','[count,events,chosen]','[1,[1,2],"two"]'],
  ['first overlap wins','let chosen = "none";\nmatch 1 { 1 => chosen = "first", 1 => chosen = "second", _ => chosen = "wild" }','chosen','"first"'],
  ['unmatched does nothing','let chosen = "none";\nmatch 2 { 1 => chosen = "one" }','chosen','"none"'],
  ['wildcard only evaluates discriminant','let count = 0;\nfn value() { count++; return 1 }\nmatch value() { _ => count++ }','count','2'],
  ['return and nested parsed match','fn value(x: number) -> string { guard x >= 0 else { match x { -1 => return "negative", _ => return "other" } }\nmatch x { 1 => return "one", _ => return "wild" } }','[value(-1),value(-2),value(1),value(2)]','["negative","other","one","wild"]'],
  ['no generated identifier collision','let __atomis_match_0 = 8;\nlet chosen = 0;\nmatch 8 { __atomis_match_0 => chosen = __atomis_match_0 }','chosen','8'],
  ['independent arm bindings','match 1 { 1 => { const local = 1; }, _ => { const local = 2; } }','1','1'],
  ['break exits match','let chosen = 0;\nmatch 1 { 1 => { chosen = 1; break; chosen = 2; }, _ => chosen = 3 }','chosen','1'],
 ];
 for(const [name,source,expression,expected] of matches)test(name,()=>assert.equal(evaluate(pair(source),expression),expected));
 for(const source of ['const r = /open','const r = /[abc/','const r = /(abc/','const r = /abc)/','const r = /a/gg','const r = /a/z','const r = /a/d','const r = /a\\\n/','match { _ => 1 }','match x {}','match x { 1 => }','match x { _ => 1, 1 => 2 }','match x { _ => 1, _ => 2 }'])test('reject '+JSON.stringify(source),()=>{
  assert.throws(()=>compile(source,opts));const file=join(work,'case.ato');writeFileSync(file,source);
  const results=['TS','Rust'].map(engine=>cli(engine,['check',file]));for(const r of results){assert.equal(r.status,1);assert.match(r.stderr,/\[\d+:\d+\]/);}
  assert.equal(results[0].stderr,results[1].stderr);
  for(const engine of ['TS','Rust']){const out=join(work,engine);mkdirSync(out,{recursive:true});writeFileSync(join(out,'case.ts'),'preserve');assert.equal(cli(engine,['build',file,'--out',out]).status,1);assert.equal(readFileSync(join(out,'case.ts'),'utf8'),'preserve');}
 });
}finally{rmSync(work,{recursive:true,force:true});}
console.log(passed+' passed, '+failed+' failed ('+profile+')');process.exitCode=failed?1:0;
