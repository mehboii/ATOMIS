import assert from 'node:assert/strict';
import {verifyArtifacts} from './keyword-artifacts.mjs';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,existsSync} from 'node:fs';
import {dirname,resolve,join,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),require=createRequire(import.meta.url);
const {compile}=require('../dist/compiler.js'),{tokenize}=require('../dist/lexer.js'),{parse}=require('../dist/parser.js'),{analyze}=require('../dist/analyzer.js');
const {ParseError}=require('../dist/parser.js');
const cases=JSON.parse(readFileSync(join(root,'test/keyword-cases.json'),'utf8'));
const evidence=join(root,'docs/audit/evidence/keywords-20261016');mkdirSync(join(evidence,'cases'),{recursive:true});
mkdirSync(join(root,'.parity-tmp'),{recursive:true});const work=mkdtempSync(join(root,'.parity-tmp/keyword-suite-'));
const rust=join(root,'atomis-rs/target/debug',process.platform==='win32'?'atomis.exe':'atomis');
const records=[],commands=[];let passed=0,failed=0;
function cli(exe,args){const r=spawnSync(exe,args,{cwd:root,encoding:'utf8',timeout:20000});const x={exe,args,status:r.status,stdout:r.stdout,stderr:r.stderr,error:r.error?.message};commands.push(x);assert.equal(r.error,undefined);return x;}
function inspect(source,file,targetCheck){
 try{
  const tokens=tokenize(source),ast=parse(tokens,source),structural=analyze(ast);
  const r=compile(source,{fileName:file,outputFile:join(work,'out',basename(file).replace(/\.ato$/,'.ts')),targetCheck});
  return {ok:!r.analysis.hasErrors,stage:structural.hasErrors?'Atomis structural semantics':r.analysis.hasErrors?(r.analysis.diagnostics.some(d=>/^TS\d/.test(d.message))?'TypeScript target validation':'Atomis value-reference semantics'):'accepted',diagnostics:r.analysis.diagnostics,code:r.code,map:r.map,ast,tokens};
 }catch(e){if(!(e instanceof ParseError))throw e;return {ok:false,stage:'lexer/parser',error:e.message,errorClass:e.name,line:e.line,col:e.col};}
}
for(const c of cases){
 const slug=c.group+'-'+c.name,file=join(evidence,'cases',slug+'.ato');writeFileSync(file,c.source+'\n');
 const row={...c,file};records.push(row);
 try{
  const fixture=readFileSync(file,'utf8');row.source=fixture;
  const plain=inspect(fixture,file,false),checked=inspect(fixture,file,true);
  row.normal={...plain,tokens:undefined};row.target={...checked,tokens:undefined,ast:undefined};
  verifyArtifacts([{name:slug,normal:plain}]);
  assert.equal(plain.ok,c.core,'normal verdict');assert.equal(checked.ok,c.target,'target verdict');
  if(!plain.ok&&plain.stage!=='lexer/parser'){assert.equal(plain.code,'');assert.equal(plain.map,undefined);}
  if(!checked.ok&&checked.stage!=='lexer/parser'){assert.equal(checked.code,'');assert.equal(checked.map,undefined);}
  row.tsCheck=cli(process.execPath,[join(root,'dist/cli.js'),'check',file]);
  row.rustCheck=cli(rust,['check',file]);assert.equal(row.tsCheck.status,c.core?0:1);assert.equal(row.rustCheck.status,c.core?0:1);
  assert.equal(row.tsCheck.stderr,row.rustCheck.stderr,'core diagnostic/location parity');
  const rustOut=join(work,'rust'),tsOut=join(work,'checked');mkdirSync(rustOut,{recursive:true});mkdirSync(tsOut,{recursive:true});
  const generated=basename(file).replace(/\.ato$/,'.ts'),rpath=join(rustOut,generated),tpath=join(tsOut,generated);
  const control=compile('atom saved = 1\noutput(saved)',{fileName:file,outputFile:rpath});
  writeFileSync(rpath,control.code);writeFileSync(rpath+'.ato.map',control.map);
  row.rustBuild=cli(rust,['build',file,'--out',rustOut]);assert.equal(row.rustBuild.status,c.core?0:1);
  if(c.core){
   assert.equal(readFileSync(rpath,'utf8'),plain.code,'emitted TS parity');assert.equal(readFileSync(rpath+'.ato.map','utf8'),plain.map,'map parity');
   if(!c.target)row.uncheckedRustReplacedControl=readFileSync(rpath,'utf8')!==control.code;
  }else{
   assert.equal(readFileSync(rpath,'utf8'),control.code);assert.equal(readFileSync(rpath+'.ato.map','utf8'),control.map);row.rustPreserved=true;
  }
  if(!c.target){
   writeFileSync(tpath,control.code);writeFileSync(tpath+'.ato.map',control.map);
   row.targetCheck=cli(process.execPath,[join(root,'dist/cli.js'),'check',file,'--target-check']);
   row.targetBuild=cli(process.execPath,[join(root,'dist/cli.js'),'build',file,'--out',tsOut,'--target-check']);
   assert.equal(row.targetCheck.status,1);assert.equal(row.targetBuild.status,1);assert.equal(row.targetBuild.stdout,'');
   assert.equal(readFileSync(tpath,'utf8'),control.code);assert.equal(readFileSync(tpath+'.ato.map','utf8'),control.map);row.targetPreserved=true;
   if(!c.core){
    row.normalBuild=cli(process.execPath,[join(root,'dist/cli.js'),'build',file,'--out',tsOut]);assert.equal(row.normalBuild.status,1);
    assert.equal(readFileSync(tpath,'utf8'),control.code);assert.equal(readFileSync(tpath+'.ato.map','utf8'),control.map);row.normalPreserved=true;
   }
  }
  if(c.core&&!c.target){
   row.uncheckedTsBuild=cli(process.execPath,[join(root,'dist/cli.js'),'build',file,'--out',tsOut]);assert.equal(row.uncheckedTsBuild.status,0);
   assert.equal(readFileSync(tpath,'utf8'),plain.code);row.uncheckedTsReplacedControl=readFileSync(tpath,'utf8')!==control.code;
  }
  passed++;console.log('PASS '+slug);
 }catch(e){failed++;row.failure=e.stack;console.error('FAIL '+slug+': '+e.message);}
 global.gc?.();
}
// The complete program is deliberately rechecked only after all independent cases.
const exactFile=join(root,'examples/keyword_verification.ato'),exact=readFileSync(exactFile,'utf8');
const whole={source:exact};
try{
 whole.normal=cli(process.execPath,[join(root,'dist/cli.js'),'check',exactFile]);
 whole.target=cli(process.execPath,[join(root,'dist/cli.js'),'check',exactFile,'--target-check']);
 whole.rustCheck=cli(rust,['check',exactFile]);
 whole.tsBuild=cli(process.execPath,[join(root,'dist/cli.js'),'build',exactFile,'--target-check','--out',join(work,'whole-ts')]);
 whole.rustBuild=cli(rust,['build',exactFile,'--out',join(work,'whole-rust')]);
 for(const r of Object.values(whole).filter(r=>r&&typeof r==='object'&&'status'in r))assert.equal(r.status,0);
 const tsFile=join(work,'whole-ts/keyword_verification.ts'),rsFile=join(work,'whole-rust/keyword_verification.ts');
 whole.generated=readFileSync(tsFile,'utf8');assert.equal(whole.generated,readFileSync(rsFile,'utf8'));
 assert.equal(readFileSync(tsFile+'.ato.map','utf8'),readFileSync(rsFile+'.ato.map','utf8'));
 whole.tsValidation=cli(process.execPath,[join(root,'dist/target-check.js'),tsFile]);
 whole.rustValidation=cli(process.execPath,[join(root,'dist/target-check.js'),rsFile]);
 assert.equal(whole.tsValidation.status,0);assert.equal(whole.rustValidation.status,0);
 for(const fragment of ['function describe(total: number, threshold: number): string','if (!(total >= threshold)) { return "Below target" }','let total: number = first + second','let reached: boolean = total >= threshold','console.log(describe(total, threshold))'])assert.ok(whole.generated.includes(fragment),fragment);
 writeFileSync(join(evidence,'generated.ts'),whole.generated);
 writeFileSync(join(evidence,'generated.map.json'),readFileSync(tsFile+'.ato.map'));
 whole.ok=true;
}catch(e){whole.ok=false;whole.failure=e.stack;failed++;console.error('FAIL full program '+e.message);}
writeFileSync(join(evidence,'results.json'),JSON.stringify({work,passed,failed,records,whole,commands,runtime:{executed:false,stdout:null,stderr:null,exitCode:null}},null,2));
console.log(passed+' independent cases passed, '+failed+' failures; full program '+(whole.ok?'passed compilation/target checks':'failed')+'; runtime unverified');
process.exitCode=failed?1:0;
