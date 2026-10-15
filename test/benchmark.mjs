// Local measurement only; no generated source or network operations are executed.
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(import.meta.url), {compile}=require('../dist/compiler.js');
const profile=process.argv.includes('--release')?'release':'debug';
const rust=join(root,'atomis-rs/target',profile,process.platform==='win32'?'atomis.exe':'atomis');
const work=mkdtempSync(join(tmpdir(),'atomis-bench-'));
const options={fileName:'bench.ato',outputFile:'bench.ts',sourceMap:false};
const stats=xs=>{const s=xs.slice().sort((a,b)=>a-b);return {samples:s.length,minMs:s[0],medianMs:s[Math.floor(s.length/2)],maxMs:s.at(-1)};};
const report={node:process.version,platform:process.platform,arch:process.arch,profile,workloads:[],notes:['Wall-clock measurements on this host only; no language comparisons.','API timings warmed once; CLI timings include startup, file read, compile and process exit.','RSS is sampled total Node process memory including benchmark and V8; not compiler allocation accounting.','Runtime, networking throughput and native Rust RSS were not measured.']};
try {
 for(const count of [100,1000,10000]){
  const source=Array.from({length:count},(_,i)=>'atom v'+i+' = '+i).join('\n');
  const file=join(work,'bench.ato');writeFileSync(file,source);
  compile(source,options);const api=[];let output,rss=0;
  for(let i=0;i<20;i++){const start=performance.now();output=compile(source,options);api.push(performance.now()-start);rss=Math.max(rss,process.memoryUsage().rss);}
  const cli={};
  for(const engine of ['TS','Rust']){const samples=[];for(let i=0;i<5;i++){
   const start=performance.now();const r=spawnSync(engine==='TS'?process.execPath:rust,engine==='TS'?[join(root,'dist/cli.js'),'check',file]:['check',file],{cwd:root,encoding:'utf8',timeout:10000});
   if(r.error||r.status!==0)throw Error(engine+' benchmark failed: '+(r.error??r.stderr));samples.push(performance.now()-start);
  }cli[engine]=stats(samples);}
  report.workloads.push({declarations:count,sourceBytes:Buffer.byteLength(source),outputBytes:Buffer.byteLength(output.code),sampledNodeRssBytes:rss,apiTS:stats(api),cli});
 }
 console.log(JSON.stringify(report,null,2));
}finally{rmSync(work,{recursive:true,force:true});}
