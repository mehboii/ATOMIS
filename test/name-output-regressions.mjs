import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
mkdirSync(join(root,'.parity-tmp'),{recursive:true});
const work=mkdtempSync(join(root,'.parity-tmp/name-output-'));
const evidence=join(root,'docs/audit/evidence/semantics-20261015');
mkdirSync(evidence,{recursive:true});
const valid=readFileSync(join(root,'examples/first_program.ato'),'utf8');
const input=join(work,'first_program.ato'),out=join(work,'out');
const target=join(out,'first_program.ts'),map=target+'.ato.map';
const rust=join(root,'atomis-rs/target/debug',process.platform==='win32'?'atomis.exe':'atomis');
const records=[];
function call(exe,args){
 const r=spawnSync(exe,args,{cwd:root,encoding:'utf8',timeout:20000});
 const result={exe,args,status:r.status,stdout:r.stdout,stderr:r.stderr,error:r.error?.message};records.push(result);
 assert.equal(r.error,undefined);return result;
}
let count=0;
for(const [exe,prefix,flags] of [[process.execPath,[join(root,'dist/cli.js')],[]],[process.execPath,[join(root,'dist/cli.js')],['--target-check']],[rust,[],[]]]){
 writeFileSync(input,valid);assert.equal(call(exe,[...prefix,'build',input,'--out',out,...flags]).status,0);
 const code=readFileSync(target),mapping=readFileSync(map);
 assert.equal(call(exe,[...prefix,'check',input,...flags]).status,0);
 assert.deepEqual(readFileSync(target),code);assert.deepEqual(readFileSync(map),mapping);
 for(const source of ['output(missing)','fn f(){return missing()}','const fixed=1;fixed=2','if(true){let hidden=1;}\noutput(hidden)','output("unterminated)']){
  writeFileSync(input,source);
  for(const args of [['check',input,...flags],['build',input,'--out',out,...flags]]){
   const result=call(exe,[...prefix,...args]);assert.equal(result.status,1);
   assert.equal(result.stdout,'');assert.ok(result.stderr);
   assert.deepEqual(readFileSync(target),code);assert.deepEqual(readFileSync(map),mapping);count++;
  }
 }
}
writeFileSync(join(evidence,'output-preservation.json'),JSON.stringify({work,assertions:count,records},null,2));
console.log(count+' failed-check/build preservation checks passed (TS, TS target-check, Rust); no execution');
