import {test} from 'node:test';
import {execFileSync} from 'node:child_process';
test('unsupported generated summaries recover within their frozen ownership',()=>{
  execFileSync(process.execPath,['apps/cowork-server/selftest-ppt-summary-recovery.mjs'],{cwd:process.cwd(),stdio:'pipe'});
});
