import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const {tokenize}=require('../dist/lexer.js');
export function verifyArtifacts(records){
 let count=0;
 for(const row of records){
  const r=row.normal;if(!r?.ok)continue;
  const code=r.code;
  const walk=body=>{for(const s of body){
   if(s.type==='AtomDecl'){
    let line='let '+s.name;if(s.typeAnnotation)line+=': '+s.typeAnnotation;if(s.initializer!==undefined)line+=' = '+s.initializer;
    assert.ok(code.includes(line),row.name+' atom lowering');
   }else if(s.type==='FnDecl'){
    const params=s.params.map(p=>p.name+(p.typeAnnotation?': '+p.typeAnnotation:'')).join(', ');
    assert.ok(code.includes('function '+s.name+'('+params+')'+(s.returnType?': '+s.returnType:'')),row.name+' function signature');
    walk(s.body);
   }else if(s.type==='GuardStmt'){
    assert.ok(code.includes('if (!('+s.condition+'))'),row.name+' guard negation');walk(s.elseBody);
   }else if(s.type==='OutputCall'){
    assert.ok(code.includes('console.log('+s.argument+')'),row.name+' output argument preservation');
    if(s.argument.charCodeAt(0)===96){const first=tokenize(s.argument)[0];assert.equal(first.type,'STRING');assert.equal(first.value,s.argument);}
   }else if(s.type==='TSPassthrough')assert.ok(code.includes(s.raw.trim()),row.name+' raw statement preservation');
  }};
  walk(r.ast.body);count++;
 }
 for(const keyword of ['fn','atom','guard','else','output'])assert.equal(tokenize(keyword)[0].type,'KEYWORD');
 for(const host of ['return','number','string','boolean','true','false'])assert.equal(tokenize(host)[0].type,'IDENT');
 assert.equal(tokenize('->')[0].type,'ARROW');assert.equal(tokenize('>=')[0].type,'OPERATOR');assert.equal(tokenize('+')[0].type,'OPERATOR');
 return count;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const data=JSON.parse(readFileSync(resolve(root,'docs/audit/evidence/keywords-20261016/results.json'),'utf8'));
 console.log(verifyArtifacts(data.records)+' accepted fixtures passed AST/token/emission assertions');
}
