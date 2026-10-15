import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const profile=process.argv.includes('--release')?'release':'debug',rust=join(root,'atomis-rs/target',profile,process.platform==='win32'?'atomis.exe':'atomis');
const work=mkdtempSync(join(tmpdir(),'atomis-limits-'));
let passed=0,failed=0;
function test(name,fn){try{fn();passed++;console.log('PASS '+name);}catch(e){failed++;console.error('FAIL '+name+': '+e.message);}}
function cli(engine,args){const r=spawnSync(engine==='TS'?process.execPath:rust,engine==='TS'?[join(root,'dist/cli.js'),...args]:args,{cwd:root,encoding:'utf8',timeout:5000});assert.equal(r.error,undefined);return r;}
try {
 const cases=[['oversized source',Buffer.alloc(8*1024*1024+1,32),/8 MiB/],['malformed UTF-8',Buffer.from([0xc3,0x28]),/UTF-8/],['regex length','const r = /'+'a'.repeat(32770)+'/',/32768/],['regex depth','const r = /'+'('.repeat(65)+'a'+')'.repeat(65)+'/',/regex group nesting/]];
 for(const [name,source,pattern] of cases)for(const engine of ['TS','Rust'])test(engine+' '+name,()=>{
  const file=join(work,'case.ato'),out=join(work,engine);mkdirSync(out,{recursive:true});writeFileSync(file,source);writeFileSync(join(out,'case.ts'),'preserve');
  for(const args of [['check',file],['build',file,'--out',out],['run',file]]){const r=cli(engine,args);assert.equal(r.status,1);assert.match(r.stderr,pattern);assert.match(r.stderr,/\[1:\d+\]/);}
  assert.equal(readFileSync(join(out,'case.ts'),'utf8'),'preserve');
 });
 for(const [name,source] of [['source at limit',' '.repeat(8*1024*1024)],['regex at limit','const r = /'+'a'.repeat(32768)+'/']])for(const engine of ['TS','Rust'])test(engine+' '+name,()=>{const file=join(work,'boundary.ato');writeFileSync(file,source);const r=cli(engine,['check',file]);assert.equal(r.status,0,r.stderr);});
 for(const engine of ['TS','Rust'])test(engine+' empty file',()=>{const file=join(work,'empty.ato');writeFileSync(file,'');assert.equal(cli(engine,['check',file]).status,0);});
}finally{rmSync(work,{recursive:true,force:true});}
console.log(passed+' passed, '+failed+' failed ('+profile+')');process.exitCode=failed?1:0;
