import {test} from 'node:test';
import {execFileSync} from 'node:child_process';
test('whole-deck semantic grouping and exact field examples preserve source contracts',()=>{
 execFileSync(process.execPath,['apps/cowork-server/selftest-ppt-semantic-preplanning.mjs'],{cwd:process.cwd(),stdio:'pipe',timeout:120000});
});
