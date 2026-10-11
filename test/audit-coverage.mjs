// Aggregate V8 function execution observations. This is not line/branch coverage.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const ownDist=resolve(dirname(fileURLToPath(import.meta.url)),'../dist').toLowerCase();
const directory=process.argv[2]; if(!directory) throw new Error('Provide NODE_V8_COVERAGE output directory');
const modules=new Map();
for(const name of readdirSync(directory).filter(n=>n.endsWith('.json'))){
  const report=JSON.parse(readFileSync(`${directory}/${name}`,'utf8'));
  for(const script of report.result ?? []){
    if(!script.url.startsWith('file:') || dirname(fileURLToPath(script.url)).toLowerCase()!==ownDist)continue;
    const match=script.url.match(/\/dist\/(lexer|parser|analyzer|transformer|emitter|compiler|cli|index)\.js$/);
    if(!match)continue;
    const module=match[1];if(!modules.has(module))modules.set(module,new Map());
    const functions=modules.get(module);
    for(const fn of script.functions){
      const key=`${fn.functionName}@${fn.ranges[0]?.startOffset}`;
      functions.set(key,(functions.get(key)??0)+fn.ranges.reduce((sum,r)=>sum+r.count,0));
    }
  }
}
console.log(JSON.stringify([...modules].sort().map(([module,functions])=>({module,observedFunctions:functions.size,executedFunctions:[...functions.values()].filter(n=>n>0).length,unexecutedFunctions:[...functions].filter(([,n])=>n===0).map(([name])=>name)})),null,2));
