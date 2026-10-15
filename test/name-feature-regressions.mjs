import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,existsSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),require=createRequire(import.meta.url);
const {compile}=require('../dist/compiler.js');
const cases=JSON.parse(readFileSync(join(root,'test/name-cases.json'),'utf8'));
const evidence=join(root,'docs/audit/evidence/semantics-20261015');
mkdirSync(evidence,{recursive:true});
mkdirSync(join(root,'.parity-tmp'),{recursive:true});
const work=mkdtempSync(join(root,'.parity-tmp/names-'));
const rust=join(root,'atomis-rs/target/debug',process.platform==='win32'?'atomis.exe':'atomis');
const records=[];let passed=0,failed=0;
function cli(exe,args){const r=spawnSync(exe,args,{cwd:root,encoding:'utf8',timeout:20000});assert.equal(r.error,undefined);return {args,status:r.status,stdout:r.stdout,stderr:r.stderr};}
for(const c of cases){
 const row={...c};records.push(row);
 try{
  const file=join(work,c.name+'.ato');writeFileSync(file,c.source);
  const opts={fileName:file,outputFile:join(work,c.name+'.ts'),sourceMap:true};
  const plain=compile(c.source,opts);row.core={errors:plain.analysis.hasErrors,diagnostics:plain.analysis.diagnostics};
  assert.equal(!plain.analysis.hasErrors,c.core,'core verdict');
  if(!c.core){assert.equal(plain.code,'');assert.equal(plain.map,undefined);assert.ok(plain.analysis.diagnostics.some(d=>d.severity==='error'&&!/^TS\d/.test(d.message)));}
  const checked=compile(c.source,{...opts,targetCheck:true});row.target={errors:checked.analysis.hasErrors,diagnostics:checked.analysis.diagnostics};
  assert.equal(!checked.analysis.hasErrors,c.target,'target verdict');
  if(!c.target){assert.equal(checked.code,'');assert.equal(checked.map,undefined);}
  row.rust=cli(rust,['check',file]);assert.equal(row.rust.status,c.core?0:1,'Rust verdict');
  row.ts=cli(process.execPath,[join(root,'dist/cli.js'),'check',file]);assert.equal(row.ts.status,c.core?0:1,'TS CLI verdict');
  assert.equal(row.rust.stderr,row.ts.stderr,'core diagnostic parity');
  row.checkedCLI=cli(process.execPath,[join(root,'dist/cli.js'),'check',file,'--target-check']);assert.equal(row.checkedCLI.status,c.target?0:1,'checked CLI verdict');
  if(!c.core)assert.equal(row.ts.stderr,row.checkedCLI.stderr,'Atomis diagnostics independent of target flag');
  assert.equal(existsSync(opts.outputFile),false,'check writes no TS');assert.equal(existsSync(opts.outputFile+'.ato.map'),false,'check writes no map');
  passed++;console.log('PASS '+c.name);global.gc?.();
 }catch(e){failed++;row.failure=e.stack;console.error('FAIL '+c.name+': '+e.message);}
}
writeFileSync(join(evidence,'name-feature-results.json'),JSON.stringify({work,passed,failed,records},null,2));
console.log(passed+' passed, '+failed+' failed; no generated program executed');
process.exitCode=failed?1:0;
