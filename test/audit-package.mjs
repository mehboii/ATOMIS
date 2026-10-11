import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
const location=resolve(process.argv[2]??'.parity-tmp/audit-package/package');
const installed=process.argv.includes('--installed');
const require=createRequire(join(location,'package.json'));
const pkg=JSON.parse(readFileSync(join(location,'package.json'),'utf8'));
assert.equal(pkg.version,'0.1.0');
assert.ok(require(location).compile('output(1)',{fileName:'x.ato',outputFile:'x.ts',sourceMap:false}).code.includes('console.log(1)'));
assert.equal(require(location).compile('let x = 1 // +\natom y = 2',{fileName:'x.ato',outputFile:'x.ts',sourceMap:false}).code,'let x = 1 // +\nlet y = 2\n');
assert.ok(!readdirSync(location).some(n=>n.startsWith('.audit-fix')));
if(installed){
  for(const name of ['ts-node','typescript','chalk','chokidar','proto','ghostvault']) {
    const path=require.resolve(name); assert.ok(path.startsWith(resolve(location,'..','..')),`dependency fell back to parent project: ${path}`);
  }
  const project=resolve(location,'..','..');
  const file=join(project,'trusted.ato');writeFileSync(file,'output(21 * 2)');
  const result=spawnSync(process.execPath,[join(location,'dist/cli.js'),'run',file],{cwd:project,encoding:'utf8',timeout:10000});
  assert.equal(result.error,undefined);assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,'42\n');
}
console.log(`Local ${installed?'production installation':'extracted tarball'} verified (${pkg.name} ${pkg.version})`);
