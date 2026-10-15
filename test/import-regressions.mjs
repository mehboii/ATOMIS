import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),require=createRequire(import.meta.url),{compile}=require('../dist/compiler.js');
const profile=process.argv.includes('--release')?'release':'debug',rust=join(root,'atomis-rs/target',profile,process.platform==='win32'?'atomis.exe':'atomis');
const work=mkdtempSync(join(root,'.parity-tmp/imports-'));
let passed=0,failed=0;
function test(name,fn){try{fn();passed++;console.log('PASS '+name);}catch(e){failed++;console.error('FAIL '+name+': '+e.message);}}
function cli(engine,args){const r=spawnSync(engine==='TS'?process.execPath:rust,engine==='TS'?[join(root,'dist/cli.js'),...args]:args,{cwd:root,encoding:'utf8',timeout:15000});assert.equal(r.error,undefined);return r;}
try {
 for(const source of ['@import { basename as leaf } from "node:path"\noutput(leaf("a/b"))','@import { basename as leaf, sep, } from "node:path"\noutput(leaf("a/b"))'])test('alias parity and runtime '+source.split('\n')[0],()=>{
  const file=join(work,'case.ato');writeFileSync(file,source);
  const result=compile(source,{fileName:file,outputFile:'case.ts',targetCheck:true});assert.equal(result.analysis.hasErrors,false,JSON.stringify(result.analysis.diagnostics));assert.ok(result.code.includes('basename as leaf'));
  for(const engine of ['TS','Rust']){assert.equal(cli(engine,['build',file,'--out',join(work,engine)]).status,0);const r=cli(engine,['run',file]);assert.equal(r.status,0,r.stderr);assert.equal(r.stdout,'b\n');}
  for(const suffix of ['', '.ato.map'])assert.equal(readFileSync(join(work,'TS','case.ts'+suffix),'utf8'),readFileSync(join(work,'Rust','case.ts'+suffix),'utf8'));
 });
 for(const source of ['@import { a b } from "proto"','@import { a as } from "proto"','@import { 42 } from "proto"','@import { a + b } from "proto"','@import { a } "proto"'])test('malformed import '+source,()=>{
  assert.throws(()=>compile(source,{fileName:'case.ato',outputFile:'case.ts'}));const file=join(work,'case.ato');writeFileSync(file,source);
  for(const engine of ['TS','Rust']){const r=cli(engine,['check',file]);assert.equal(r.status,1);assert.match(r.stderr,/\[\d+:\d+\]/);}
 });
 for(const source of ['@import { basename as leaf } from "node:path"\natom leaf = 1','@import { basename as leaf, dirname as leaf } from "node:path"'])test('duplicate imported local '+source.split('\n')[0],()=>{
  const r=compile(source,{fileName:'case.ato',outputFile:'case.ts'});assert.equal(r.analysis.hasErrors,true);assert.equal(r.code,'');
  const file=join(work,'case.ato');writeFileSync(file,source);const left=cli('TS',['check',file]),right=cli('Rust',['check',file]);assert.equal(left.status,1);assert.equal(right.status,1);assert.equal(left.stderr,right.stderr);
 });
}finally{rmSync(work,{recursive:true,force:true});}
console.log(passed+' passed, '+failed+' failed ('+profile+')');process.exitCode=failed?1:0;
