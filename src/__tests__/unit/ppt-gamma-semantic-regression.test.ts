import {test}from 'node:test';
import {execFileSync}from 'node:child_process';
test('Gamma comparison preserves semantic relationships and native formula geometry',()=>{
  execFileSync(process.execPath,['apps/cowork-server/selftest-ppt-gamma-semantic.mjs'],{cwd:process.cwd(),encoding:'utf8',timeout:120000});
});
