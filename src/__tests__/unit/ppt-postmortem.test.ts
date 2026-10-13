import {it} from 'node:test';import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import path from 'node:path';
it('PPT short protocol, multilingual policies, complete native cells and editorial blockers preserve generic contracts',()=>{
 const output=execFileSync(process.execPath,[path.resolve('apps/cowork-server/selftest-ppt-postmortem.mjs')],{encoding:'utf8'});assert.match(output,/passed/);
});
it('PPT batched planner retains failed candidates and resumes only matching scoped checkpoints',()=>{
 const output=execFileSync(process.execPath,[path.resolve('apps/cowork-server/selftest-ppt-postmortem-api.mjs')],{encoding:'utf8',timeout:30000});assert.match(output,/passed/);
});
