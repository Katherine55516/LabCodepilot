import {test} from 'node:test';
import {execFileSync} from 'node:child_process';
test('PPT page planning, scoped repair and native typography controls',()=>{execFileSync(process.execPath,['apps/cowork-server/selftest-ppt-user-controls.mjs'],{cwd:process.cwd(),encoding:'utf8',timeout:120000});});
