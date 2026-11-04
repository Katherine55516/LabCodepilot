import {test} from 'node:test';import {execFileSync} from 'node:child_process';
test('template-first reader/interval and proposal target contracts',()=>{
 for(const script of ['selftest-ppt-template-first.mjs','selftest-ppt-proposal-targets.mjs','selftest-ppt-existing-media-edit.mjs'])execFileSync(process.execPath,['apps/cowork-server/'+script],{encoding:'utf8',timeout:60000});
});
