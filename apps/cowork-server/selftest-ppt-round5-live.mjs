// Round 5 live generation (V-P0-2/3/4, V-P1-5/6): streaming drafts are
// transient and non-authoritative, progress needs the job lease, stages come
// from real DAG/runtime state.
import assert from 'node:assert/strict';
import { draftFromPartialJson, updateDraft, draftsFor, clearDraft } from './lib/ppt/draft-store.mjs';
import { createPptModelJobs } from './lib/ppt-model-jobs.mjs';
import { publishTransient, subscribeTransient, subscribe } from './lib/ppt/event-store.mjs';
import { generationStages, liveProjectView } from './lib/ppt/project-view.mjs';

// Draft extraction: complete identified objects only; source references resolve to owned inventory text.
const partial = '{"title":"核心张力：挖掘能力与过拟合","blocks":[{"id":"block-1","heading":"看别处效应","body":"候选极多时，最优 IC 是全体比较的\\"极值\\""},{"sourceUnitId":"b_1"},{"body":"须靠样本外验证与多重比较修';
const draft = draftFromPartialJson(partial, [{ id: 'b_1', text: 'Searching 10^6 candidate formulas against 15 years of data.' }]);
assert.equal(draft.title, '核心张力：挖掘能力与过拟合');
assert.deepEqual(draft.blocks.map(b => b.text), ['候选极多时，最优 IC 是全体比较的"极值"', 'Searching 10^6 candidate formulas against 15 years of data.']);
assert.equal(draft.typing, '须靠样本外验证与多重比较修');
assert.deepEqual(draftFromPartialJson('{"tit'), { title: '', blocks: [], typing: '' }, 'an unterminated key yields nothing');

// Progress requires the lease and never resolves the job.
const queue = createPptModelJobs({ timeoutMs: 60000 }), seen = [];
const project = { id: 'p1', uid: 'u1', configId: 'byok:local', model: 'm' };
const pending = queue.request(project, 'prompt', () => true, { stage: 'content:slide_a', onProgress: value => seen.push(value) });
const [{ id }] = queue.list('u1'), job = queue.claim('u1', id);
assert.equal(queue.progress('u1', id, { lease: 'wrong', chars: 5, text: 'x' }), false);
assert.equal(queue.progress('u2', id, { lease: job.lease, chars: 5, text: 'x' }), false);
assert.equal(queue.progress('u1', id, { lease: job.lease, chars: 12, text: '{"title":"A"'.padEnd(70000, ' ') }), true);
assert.equal(seen.length, 1); assert.equal(seen[0].text.length, 60000, 'partial text is bounded');
let settled = false; pending.then(() => { settled = true; });
await new Promise(resolve => setTimeout(resolve, 20));
assert.equal(settled, false, 'progress does not complete the job');
queue.complete('u1', id, { lease: job.lease, text: '{"title":"A"}' });
assert.equal(await pending, '{"title":"A"}');

// Transient drafts reach subscribers but are not durable sequenced events.
const runId = 'run_draft_test', transient = [], durable = [];
const offDurable = subscribe(runId, event => durable.push(event)), offTransient = subscribeTransient(runId, event => transient.push(event));
publishTransient(runId, 'slide.draft', { slideId: 's1', draft: { title: 'T' } });
assert.equal(transient.length, 1); assert.equal(durable.length, 0);
assert.equal(transient[0].payload.slideId, 's1'); assert.equal(transient[0].seq, undefined);
offDurable(); offTransient();
publishTransient(runId, 'slide.draft', {}); // no listeners: silently dropped

// updateDraft throttles notifications but always keeps the newest draft for snapshots.
const live = { id: 'p2', currentRunId: 'run_p2', source: { semantic: { inventory: { items: [] } } } }, notes = [];
const off = subscribeTransient('run_p2', event => notes.push(event));
updateDraft(live, 's1', { text: '{"title":"First"', chars: 16 }, { throttleMs: 10000 });
updateDraft(live, 's1', { text: '{"title":"First","blocks":[{"id":"block-2","body":"Second"}', chars: 40 }, { throttleMs: 10000 });
assert.equal(notes.length, 1, 'throttled');
assert.deepEqual(draftsFor('p2', ['s1']).s1.blocks.map(b => b.text), ['Second'], 'snapshot holds the latest draft');
clearDraft('p2', 's1'); assert.deepEqual(draftsFor('p2', ['s1']), {}); off();

// Stages come from real DAG/runtime state; render-ready pages being re-laid out are "repairing".
const outline = ['a', 'b', 'c', 'd', 'e', 'f'].map(id => ({ id, title: id }));
const state = { status: 'generating', outline,
  nodes: { a: { status: 'done',slide:{id:'a',nodes:[]} }, b: { status: 'running' }, c: { status: 'done',slide:{id:'c',nodes:[]} }, d: { status: 'done' }, e: { status: 'failed' } },
  runtime: { slides: { a: { phase: 'render_ready', preview: { id: 'a', slideId: 'a', elements: [{ kind: 'text' }] } }, c: { phase: 'render_ready', preview: { id: 'c', slideId: 'c', elements: [{ kind: 'text' }] } }, d: { phase: 'content_ready' } } },
  dagNodes: { 'layout:c': { status: 'running' }, 'quality:d': { status: 'running' }, 'source:f': { status: 'running' } } };
assert.deepEqual(generationStages(state).pages, { a: 'ready', b: 'writing', c: 'repairing', d: 'validating', e: 'failed', f: 'retrieving' });
assert.equal(generationStages(state).deck, 'writing');
assert.equal(generationStages({ ...state, dagNodes: { 'review:deck:critic:1': { status: 'running' } } }).deck, 'reviewing');
assert.equal(generationStages({ ...state, dagNodes: { 'publish:deck': { status: 'running' } } }).deck, 'publishing');

// The live view carries stages, and drafts only for pages still being written.
updateDraft({ id: 'p3', currentRunId: null, source: {} }, 'b', { text: '{"title":"Writing B"', chars: 18 });
updateDraft({ id: 'p3', currentRunId: null, source: {} }, 'a', { text: '{"title":"Stale A"', chars: 18 });
const view = liveProjectView({ ...state, id: 'p3', uid: 'u', title: 'T', pages: 6,currentRunId:null });
assert.equal(view.generationStages.pages.b, 'writing');
assert.deepEqual(Object.keys(view.drafts), ['b'], 'a ready page never shows a stale draft');
console.log('Round 5 live generation: drafts, progress lease, transient channel, stages and live view: passed');

const withMedia=liveProjectView({...state,id:'media-draft',uid:'u',outline:outline.map(s=>s.id==='b'?{...s,sourceImageIds:['source-photo','unknown']}:s),source:{images:[{id:'source-photo',caption:'Observed comparison',width:640,height:480,dataUrl:'never-send-image-bytes-here'}]}});
assert.deepEqual(withMedia.generationMedia,{b:[{id:'source-photo',caption:'Observed comparison',width:640,height:480}]});
assert.ok(!JSON.stringify(withMedia.generationMedia).includes('never-send-image-bytes-here'));
console.log('Draft source media: current-page assignment, exact aspect ratio and caption; image bytes remain outside the transient draft');
