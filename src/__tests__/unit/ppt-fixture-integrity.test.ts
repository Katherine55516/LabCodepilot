import {test}from'node:test';
import {execFileSync}from'node:child_process';
test('canonical export, source cards, empty workflow and fragment topic regressions',()=>{
 execFileSync(process.execPath,['apps/cowork-server/selftest-ppt-fixture-integrity.mjs'],{cwd:process.cwd(),encoding:'utf8',timeout:30000});
});
