// Observational evidence for remaining gaps. These are not passing assertions
// that bless defects. No generated code is executed.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const require=createRequire(import.meta.url), ts=require('typescript');
const {compile}=require('../dist/compiler.js');
const work=mkdtempSync(join(tmpdir(),'atomis-target-'));
const opts={fileName:'case.ato',outputFile:'case.ts',sourceMap:false};
const probes={
  'regex brace passthrough':'const re = /}/;',
  'regex Result corruption':'const re = /Ok(1)/;',
  'Result whitespace':'output(Ok (1))',
  'Result template interpolation':'output(`${Ok(1)}`)',
  'GhostNet lexical scope':'fn setup() { node "n" {} }\nchannel "c" {}\nconnect "c" -> "n" via tcp',
  'match repeated evaluation':'match get() { 0 => output(0), 1 => output(1) }',
  'match wildcard ordering':'match x { _ => output(0), 1 => output(1) }',
  'cell nested await':'@cell #x { guard true else { await Promise.resolve() } }',
  'passthrough undefined name':'const x = missingName + 1',
  'invalid numeric literal':'atom x = 0b2',
  'invalid string escape':'output("\\xZZ")',
  'import alias':'@import { encode as enc } from "proto"',
  'reactivity':'atom x = 1',
};
const output=[];
try {
  for (const [name,source] of [...Object.entries(probes),...['hello','features','network'].map(n=>[`example ${n}`,readFileSync(new URL(`../examples/${n}.ato`,import.meta.url),'utf8')])]) {
    try {
      const r=compile(source,opts); const file=join(work,'case.ts'); writeFileSync(file,r.code);
      const program=ts.createProgram([file],{noEmit:true,strict:true,target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.Node16,moduleResolution:ts.ModuleResolutionKind.Node16});
      const diagnostics=ts.getPreEmitDiagnostics(program).map(d=>({code:d.code,message:ts.flattenDiagnosticMessageText(d.messageText,' ')}));
      output.push({name,source,atomisDiagnostics:r.analysis.diagnostics,generated:r.code,targetDiagnostics:diagnostics});
    }catch(e){output.push({name,source,error:e.message});}
  }
  console.log(JSON.stringify(output,null,2));
}finally{rmSync(work,{recursive:true,force:true});}
