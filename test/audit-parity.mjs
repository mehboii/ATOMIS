import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const profile=process.argv.includes('--release')?'release':'debug';
const rust=join(root,'atomis-rs/target',profile,process.platform==='win32'?'atomis.exe':'atomis');
const work=mkdtempSync(join(tmpdir(),'atomis-parity-'));
const cases=['examples/hello','examples/features','examples/network','atomis-rs/conformance/dup','atomis-rs/conformance/pure','atomis-rs/conformance/typemismatch','atomis-rs/conformance/ghost'];
function run(engine,args){
  const result=spawnSync(engine==='TS'?process.execPath:rust,engine==='TS'?[join(root,'dist/cli.js'),...args]:args,{cwd:root,encoding:'utf8',timeout:5000});
  assert.equal(result.error,undefined);return result;
}
let paired=0;
try{
  for(const stem of cases){
    const source=join(root,stem+'.ato');
    const left=run('TS',['check',source]),right=run('Rust',['check',source]);
    assert.equal(left.status,right.status);assert.equal(left.stdout,right.stdout);assert.equal(left.stderr,right.stderr);paired++;
    if(!stem.endsWith('typemismatch')&&!stem.endsWith('ghost')){
      for(const engine of ['TS','Rust'])assert.equal(run(engine,['build',source,'--out',join(work,engine)]).status,0);
      const file=basename(stem)+'.ts';
      for(const suffix of ['', '.ato.map'])assert.deepEqual(readFileSync(join(work,'TS',file+suffix)),readFileSync(join(work,'Rust',file+suffix)));paired++;
    }
  }
  console.log(`${paired} paired checks passed (code, source maps, diagnostics and exit codes; ${profile})`);
}finally{rmSync(work,{recursive:true,force:true});}
