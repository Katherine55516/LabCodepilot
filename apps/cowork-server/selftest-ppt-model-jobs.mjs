import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { createPptModelJobs } from './lib/ppt-model-jobs.mjs';
const queue = createPptModelJobs({ timeoutMs: 5000 });
const project = { uid: 'alice', id: 'p', configId: 'byok:provider-a', model: 'ppt应用测试' };
const pending = queue.request(project, 'Actual production prompt');
const [{ id }] = queue.list('alice');
assert.deepEqual(queue.list('bob'), []);
assert.equal(queue.claim('bob', id), null);
const job = queue.claim('alice', id);
assert.equal(job.model, project.model);
assert.equal(job.prompt, 'Actual production prompt');
assert.equal(Object.hasOwn(job, 'apiKey'), false);
assert.equal(queue.claim('alice', id), null);
assert.equal(queue.complete('bob', id, { lease: job.lease, text: '{}' }), false);
assert.equal(queue.complete('alice', id, { lease: 'wrong', text: '{}' }), false);
assert.equal(queue.complete('alice', id, { lease: job.lease, text: '{"slides":[]}' }), true);
assert.equal(await pending, '{"slides":[]}');
assert.equal(queue.complete('alice', id, { lease: job.lease, text: '{}' }), false);
assert.deepEqual(queue.list('alice'), []);
// The advertised provider concurrency is per account, including multiple
// projects/tabs; each tab's local worker limit cannot enforce this on its own.
const multi=createPptModelJobs({timeoutMs:5000}),requests=Array.from({length:4},(_,i)=>multi.request({...project,id:'project-'+i},'prompt '+i));
const leased=[];for(let i=0;i<3;i++){const next=multi.list('alice')[0];leased.push(multi.claim('alice',next.id));}
assert.deepEqual(multi.list('alice'),[],'a fourth tab cannot create a fourth provider call');
assert.equal(multi.state('alice','project-3').pending,1);
multi.complete('alice',leased[0].id,{lease:leased[0].lease,text:'{}'});
const fourth=multi.claim('alice',multi.list('alice')[0].id);assert.ok(fourth,'a finished lease releases the shared slot');
for(const job of [...leased.slice(1),fourth])multi.complete('alice',job.id,{lease:job.lease,text:'{}'});
await Promise.all(requests);
await assert.rejects(queue.request({ ...project, configId: 'managed-a' }, 'prompt'));
const timeoutQueue = createPptModelJobs({ timeoutMs: 20 });
await assert.rejects(timeoutQueue.request(project, 'prompt'), error=>error.code==='timeout');
const error = queue.request(project, 'prompt');
const errorJob = queue.claim('alice', queue.list('alice')[0].id);
queue.complete('alice', errorJob.id, { lease: errorJob.lease, error: 'secret must never escape' });
await assert.rejects(error, e => !e.message.includes('secret'));
const bounded = createPptModelJobs({ limit: 1 });
const first = bounded.request(project, 'prompt');
await assert.rejects(bounded.request(project, 'second'), /full/);
const claim = bounded.claim('alice', bounded.list('alice')[0].id);
bounded.complete('alice', claim.id, { lease: claim.lease, text: '{}' }); await first;
// The server owns the finite stage budget; custom queue deadlines remain authoritative.
for (const [stage, size, expected] of [['review:deck',200000,420000],['review:deck',199999,420000],['review:deck:batch:2',90000,420000],['review:deck',89999,240000],['review:deck:batch:0',200000,420000],['outline',120000,420000],['outline',119999,240000],['content:s1',200000,240000]]) {
 const result=queue.request(project,'x'.repeat(size),()=>true,{stage,timeoutMs:999999});
 const budgetJob=queue.claim('alice',queue.list('alice')[0].id);
 assert.equal(budgetJob.options.timeoutMs,expected);
 queue.complete('alice',budgetJob.id,{lease:budgetJob.lease,text:'{}'});await result;
}
const queueDelay=createPptModelJobs({timeoutMs:250});
const delayed=queueDelay.request(project,'queued task');
await new Promise(resolve=>setTimeout(resolve,100));
const delayedJob=queueDelay.claim('alice',queueDelay.list('alice')[0].id);
await new Promise(resolve=>setTimeout(resolve,180));
assert.equal(queueDelay.complete('alice',delayedJob.id,{lease:delayedJob.lease,text:'{}'}),true,'queue wait must not consume claimed execution budget');
assert.equal(await delayed,'{}');
const customDeadline=createPptModelJobs({timeoutMs:20});
await assert.rejects(customDeadline.request(project,'x'.repeat(200000),()=>true,{stage:'review:deck'}),e=>e.code==='timeout');
// Exercise the production modelCall and public HTTP routes, not only a queue double.
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-model-bridge-'));
process.env.COWORK_STATE_DIR = temp;
const store = await import('./lib/ppt-store.mjs');
const { handlePpt, _internals } = await import('./lib/ppt-api.mjs');
try {
  const p = store.save({ ...project, id: store.newId(), status: 'generating', updatedAt: '' });
  const invoke = async (method, pathname, account = 'alice', data) => {
    const req = Readable.from(data === undefined ? [] : [Buffer.from(JSON.stringify(data))]); req.method = method;
    let reply;
    await handlePpt(req, new URL(`http://localhost${pathname}`), { uid: account, send: (status, body) => { reply = { status, body }; return true; } });
    return reply;
  };
  const generated = _internals.defaultDeps.modelCall(p, 'Server outline prompt', null, () => {});
  const capabilities = await invoke('GET', '/ppt/capabilities');
  assert.equal(capabilities.body.byok.protocolVersion, 1);
  assert.equal(capabilities.body.byok.credentialLocation, 'desktop');
  assert.equal((await invoke('POST', '/ppt/capabilities')).status, 405);
  assert.equal((await invoke('GET', '/ppt/model-jobs', 'bob')).body.jobs.length, 0);
  const [{ id: jobId }] = (await invoke('GET', '/ppt/model-jobs')).body.jobs;
  assert.equal((await invoke('POST', `/ppt/model-jobs/${jobId}/claim`, 'bob')).status, 409);
  const claimed = await invoke('POST', `/ppt/model-jobs/${jobId}/claim`);
  assert.equal(claimed.body.prompt, 'Server outline prompt');
  assert.equal(claimed.body.configId, p.configId);
  assert.equal((await invoke('POST', `/ppt/model-jobs/${jobId}/complete`, 'alice', { lease: 'wrong', text: '{}' })).status, 409);
  assert.equal((await invoke('POST', `/ppt/model-jobs/${jobId}/complete`, 'alice', { lease: claimed.body.lease, text: '```json\n{"slides":[]}\n```' })).status, 200);
  assert.deepEqual(await generated, { slides: [] });
  assert.equal((await invoke('POST', `/ppt/model-jobs/${jobId}/complete`, 'alice', { lease: claimed.body.lease, text: '{}' })).status, 409);
  assert.equal((await invoke('POST', '/ppt/model-jobs')).status, 405);
  assert.equal((await invoke('GET', '/ppt/model-jobs', 'managed')).status, 403);
  const cancelled = _internals.defaultDeps.modelCall(p, 'Cancelled page prompt', null, () => {}, { nodeKey: 'content:s1' });
  const rejection = assert.rejects(cancelled, /cancelled/);
  store.save({ ...p, status: 'paused' });
  await rejection;
  assert.deepEqual((await invoke('GET', '/ppt/model-jobs')).body.jobs, []);
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
console.log('PPT desktop model queue: production modelCall/HTTP, ownership, claims, replay, cancellation, timeouts, limits and secret-free errors passed');
