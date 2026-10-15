import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const profile=process.argv.includes('--release')?'release':'debug';
const rust=join(root,'atomis-rs/target',profile,process.platform==='win32'?'atomis.exe':'atomis');
const work=mkdtempSync(join(root,'.parity-tmp/net-'));
let passed=0,failed=0;
function test(name,fn){try{fn();passed++;console.log('PASS '+name);}catch(e){failed++;console.error('FAIL '+name+': '+e.message);}}
function cli(engine,args){const r=spawnSync(engine==='TS'?process.execPath:rust,engine==='TS'?[join(root,'dist/cli.js'),...args]:args,{cwd:root,encoding:'utf8',timeout:15000});assert.equal(r.error,undefined);return r;}
try {
 const file=join(root,'examples/loopback.ato');
 test('loopback generated code/maps agree',()=>{
  for(const engine of ['TS','Rust']){const r=cli(engine,['build',file,'--out',join(work,engine)]);assert.equal(r.status,0,r.stderr);}
  for(const suffix of ['', '.ato.map'])assert.equal(readFileSync(join(work,'TS','loopback.ts'+suffix),'utf8'),readFileSync(join(work,'Rust','loopback.ts'+suffix),'utf8'));
 });
 for(const engine of ['TS','Rust'])test(engine+' binary protocol roundtrip, refusal and cleanup',()=>{
  const before=readdirSync(join(root,'examples')).sort();
  const r=cli(engine,['run',file]);assert.equal(r.status,0,r.stderr);assert.equal(r.stdout,'loopback proto roundtrip\nconnection refusal handled\n');
  assert.deepEqual(readdirSync(join(root,'examples')).sort(),before);
 });
 test('loopback target validation',()=>{const r=cli('TS',['check',file,'--target-check']);assert.equal(r.status,0,r.stderr);});
 // Fixed trusted input, local ephemeral port, client deadline, no external service.
 const timeoutFile=join(work,'timeout.ato');writeFileSync(timeoutFile,'@import { createServer, connect as openConnection } from "node:net"\nconst server = createServer(socket => { socket.on("error", () => {}); socket.resume(); });\nserver.listen(0,"127.0.0.1",() => { const address = server.address(); if(!address || typeof address === "string") throw new Error("address"); const socket = openConnection({host:"127.0.0.1",port:address.port}); socket.on("error",()=>{}); socket.setTimeout(100,()=>{ console.log("timeout handled"); socket.destroy(); server.close(); }); });');
 for(const engine of ['TS','Rust'])test(engine+' actual socket timeout',()=>{const r=cli(engine,['run',timeoutFile]);assert.equal(r.status,0,r.stderr);assert.equal(r.stdout,'timeout handled\n');});
 for(const engine of ['TS','Rust'])test(engine+' absent GhostNet runtime fails',()=>{const r=cli(engine,['run',join(root,'examples/network.ato')]);assert.equal(r.status,1);assert.match(r.stderr,/ghostnet|GhostNode|__atomis_cell/);});
}finally{rmSync(work,{recursive:true,force:true});}
console.log(passed+' passed, '+failed+' failed ('+profile+')');process.exitCode=failed?1:0;
