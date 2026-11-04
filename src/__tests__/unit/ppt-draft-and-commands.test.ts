import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { draftChange, draftEstimateKey, draftPlanKey, draftSourceKey } from '../../lib/ppt-draft-keys';

// node:test runs each file in its own process; the store reads this at import.
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-draft-commands-'));
process.env.COWORK_STATE_DIR = stateDir;
test.after(() => fs.rmSync(stateDir, { recursive: true, force: true }));
const m = (name: string) => import('../../../apps/cowork-server/lib/' + name + '.mjs');

const input = { fileVersion: 0, prompt: 'Explain vector search', text: '', importMode: 'generate', supplementMode: 'prompt', templateContentMode: 'design_only', templateFixedObjectIds: [] as string[], imageIds: [] as string[] };
const plan = { policy: { version: 2, detail: 'standard', language: { mode: 'source' } }, template: 'blue', templateVersion: 1 };

test('title and model are not draft input; input changes make the draft stale, plan changes reuse it', () => {
  const source = draftSourceKey(input), planKey = draftPlanKey(plan);
  const analyzed = { source, plan: planKey, pages: 6 };
  assert.deepEqual(draftChange(analyzed, { source, plan: planKey, pages: 6 }, true), { stale: false, needsRead: false, needsReplan: false }, 'title/model edits change neither key');
  assert.deepEqual(draftChange(analyzed, { source: draftSourceKey({ ...input, prompt: 'Explain vector search caches' }), plan: planKey, pages: 6 }, true), { stale: true, needsRead: true, needsReplan: false });
  assert.deepEqual(draftChange(analyzed, { source, plan: draftPlanKey({ ...plan, template: 'light' }), pages: 6 }, true), { stale: false, needsRead: false, needsReplan: true }, 'a new template re-plans the same draft');
  assert.deepEqual(draftChange(analyzed, { source, plan: draftPlanKey({ ...plan, policy: { ...plan.policy, detail: 'detailed' } }), pages: 6 }, false), { stale: false, needsRead: true, needsReplan: true }, 'before an outline, a plan change re-reads the same draft');
  assert.deepEqual(draftChange(analyzed, { source, plan: planKey, pages: 8 }, true), { stale: false, needsRead: false, needsReplan: true });
  assert.deepEqual(draftChange(null, { source, plan: planKey, pages: 6 }, false), { stale: false, needsRead: true, needsReplan: false });
});

test('the page estimate is kept across a depth change and dropped when code presentation changes it', () => {
  const estimate = draftEstimateKey(plan);
  assert.equal(draftEstimateKey({ ...plan, policy: { ...plan.policy, detail: 'detailed' } }), estimate);
  assert.notEqual(draftEstimateKey({ ...plan, policy: { ...plan.policy, code: { presentation: 'keep' } } }), estimate);
  assert.notEqual(draftEstimateKey({ ...plan, template: 'light' }), estimate);
});

type Sent = { status: number; body: { error?: string; code?: string; project?: { status: string; model?: string; configId?: string; title?: string } } };
async function call(method: string, pathname: string, payload?: unknown): Promise<Sent> {
  const { handlePpt } = await m('ppt-api');
  const req = Object.assign(Readable.from(payload === undefined ? [] : [Buffer.from(JSON.stringify(payload))]), { method, headers: { 'content-type': 'application/json' } });
  let sent!: Sent;
  await handlePpt(req, new URL('http://test' + pathname), { uid: 'draft-user', send: (status: number, body: Sent['body']) => { sent = { status, body }; return true; }, activity: () => {}, log: () => {} });
  return sent;
}
let counter = 0;
async function draft(status: string, extra: Record<string, unknown> = {}) {
  const store = await m('ppt-store');
  const id = String(++counter).padStart(32, 'd');
  store.save({ uid: 'draft-user', id, title: 'Vector search review', prompt: 'p', inputKind: 'prompt', status, stage: status === 'outlining' ? 'outline' : status, template: 'blue',
    configId: 'byok:first', model: 'model-a', pages: 6, outline: [{ id: 's1', title: 'Kept outline page' }], nodes: {}, revision: 0, deck: null, createdAt: new Date().toISOString(), ...extra });
  return id;
}

test('the model changes on the same draft before generation, and the outline is kept', async () => {
  const store = await m('ppt-store');
  const id = await draft('outline_ready');
  const changed = await call('PATCH', `/ppt/projects/${id}`, { configId: 'byok:second', model: 'model-b' });
  assert.equal(changed.status, 200);
  const saved = store.get('draft-user', id);
  assert.deepEqual([saved.configId, saved.model, saved.outline[0].title], ['byok:second', 'model-b', 'Kept outline page']);
  const failedOutline = await draft('failed', { stage: 'outline' });
  assert.equal((await call('PATCH', `/ppt/projects/${failedOutline}`, { configId: 'byok:second', model: 'model-b' })).status, 200, 'a failed reading/outline can be retried with another model');
  const generating = await draft('generating');
  assert.equal((await call('PATCH', `/ppt/projects/${generating}`, { configId: 'byok:second', model: 'model-b' })).status, 409);
});

test('a superseded draft is retired: no task record, no library slot, no further run', async () => {
  const store = await m('ppt-store');
  const { countsAgainstLibraryQuota } = await m('ppt-library');
  for (const status of ['outline_ready', 'input_ready', 'outlining', 'failed']) {
    const id = await draft(status);
    const discarded = await call('POST', `/ppt/projects/${id}/discard`, {});
    assert.equal(discarded.status, 200, status);
    const saved = store.get('draft-user', id);
    assert.equal(saved.status, 'cancelled', status);
    assert.ok(saved.taskDeletedAt && saved.discardedAt, status);
    assert.equal(countsAgainstLibraryQuota(saved), false, status);
  }
  const generating = await draft('generating');
  assert.equal((await call('POST', `/ppt/projects/${generating}/discard`, {})).status, 409, 'a confirmed generation is never discarded by the wizard');
  const published = await draft('completed', { deck: { slides: [{ id: 's1', nodes: [] }] }, publishedRevision: 1 });
  assert.equal((await call('POST', `/ppt/projects/${published}/discard`, {})).status, 409);
});

test('the PPT proxy allows the discard route', async () => {
  const { isPptProxyPath } = await import('../../lib/ppt-proxy-path');
  assert.equal(isPptProxyPath(['projects', 'a'.repeat(32), 'discard']), true);
});

test('command errors carry codes that tell a revision conflict from a rejected edit', async () => {
  const store = await m('ppt-store');
  const { ensureDeckV3 } = await m('ppt/ir');
  const { applyCommand } = await m('ppt/command-service');
  const id = 'c'.repeat(32), geometry = { x: 914400, y: 914400, width: 3657600, height: 914400 };
  store.save({ uid: 'draft-user', id, title: 'T', prompt: 'p', inputKind: 'prompt', status: 'completed', stage: 'completed', template: 'violet', pages: 1, outline: [{ id: 's1', title: 'A' }], nodes: { s1: { status: 'done' } }, revision: 1,
    deck: ensureDeckV3({ slides: [{ id: 's1', title: 'A', bullets: [], nodes: [{ id: 'n1', type: 'text', content: { text: 'Hello' }, geometry, style: {} }, { id: 'n2', type: 'text', locked: true, content: { text: 'Locked' }, geometry, style: {} }] }] }) });
  const move = (x: number) => ({ type: 'nodes.setGeometry', baseRevision: 1, payload: { slideId: 's1', changes: [{ nodeId: 'n1', geometry: { ...geometry, x } }] } });
  await applyCommand('draft-user', id, move(1_000_000));
  await assert.rejects(applyCommand('draft-user', id, move(1_100_000)), (error: { statusCode: number; code: string }) => error.statusCode === 409 && error.code === 'revision_conflict');
  await assert.rejects(applyCommand('draft-user', id, { type: 'nodes.setGeometry', baseRevision: 2, payload: { slideId: 's1', changes: [{ nodeId: 'n2', geometry }] } }),
    (error: { statusCode: number; code: string }) => error.statusCode === 409 && error.code === 'node_locked');
});

type QProject = { revision: number; note?: string };
function fakeServer(options: { failOn?: (body: { type: string; payload: unknown }) => Error | null } = {}) {
  let revision = 1, inFlight = 0, maxInFlight = 0;
  const sent: { type: string; baseRevision: number; payload: unknown }[] = [];
  const send = async (body: { id: string; type: string; baseRevision: number; payload: unknown }) => {
    inFlight++; maxInFlight = Math.max(maxInFlight, inFlight); sent.push(body);
    await new Promise(resolve => setTimeout(resolve, 5));
    inFlight--;
    const failure = options.failOn?.(body);
    if (failure) throw failure;
    // Like the server: a stale base revision is a conflict.
    if (body.baseRevision !== revision) throw Object.assign(new Error('command conflicts with newer changes'), { status: 409, code: 'revision_conflict' });
    return { project: { revision: ++revision } };
  };
  return { send, sent, maxInFlight: () => maxInFlight };
}
const geometryCommand = (x: number) => ({ slideId: 's1', changes: [{ nodeId: 'n1', geometry: { x, y: 0, width: 10, height: 10 } }] });

test('commands are sent one at a time, each based on the revision the previous one returned', async () => {
  const { PptCommandQueue } = await import('../../lib/ppt-command-queue');
  const server = fakeServer(), seen: number[] = [];
  const queue = new PptCommandQueue<QProject>(1, { send: server.send, onProject: project => seen.push(project.revision), onError: error => assert.fail(error.message) });
  const results = await Promise.all([queue.enqueue('node.setLocked', { slideId: 's1', nodeId: 'a' }), queue.enqueue('node.setZIndex', { slideId: 's1', nodeId: 'a' }), queue.enqueue('slide.setNotes', { slideId: 's1' })]);
  assert.deepEqual(server.sent.map(body => body.baseRevision), [1, 2, 3]);
  assert.equal(server.maxInFlight(), 1);
  assert.deepEqual(results.map(project => project?.revision), [2, 3, 4]);
  assert.deepEqual(seen, [2, 3, 4]);
  assert.equal(queue.revision, 4);
});

test('a burst of moves sends the in-flight move and only the latest waiting one, with optimistic positions meanwhile', async () => {
  const { PptCommandQueue } = await import('../../lib/ppt-command-queue');
  const server = fakeServer();
  const queue = new PptCommandQueue<QProject>(1, { send: server.send, onProject: () => {}, onError: error => assert.fail(error.message) });
  const moves = [10, 20, 30, 40].map(x => queue.enqueue('nodes.setGeometry', geometryCommand(x), [{ nodeId: 'n1', bounds: { x, y: 0, width: 10, height: 10 } }]));
  assert.equal(queue.overlay().get('n1')?.bounds?.x, 40, 'the latest position shows at once');
  const results = await Promise.all(moves);
  assert.deepEqual(server.sent.map(body => (body.payload as ReturnType<typeof geometryCommand>).changes[0].geometry.x), [10, 40]);
  assert.deepEqual(results.map(project => project?.revision), [2, 3, 3, 3], 'replaced moves resolve with the move that carried them');
  assert.equal(queue.overlay().size, 0, 'answered edits leave no optimistic state');
  assert.ok(queue.idle);
});

test('a rejected edit rolls back its optimistic state and the queue continues', async () => {
  const { PptCommandQueue } = await import('../../lib/ppt-command-queue');
  const server = fakeServer({ failOn: body => body.type === 'node.setRotation' ? Object.assign(new Error('node is locked'), { status: 409, code: 'node_locked' }) : null });
  const errors: string[] = [];
  const queue = new PptCommandQueue<QProject>(1, { send: server.send, onProject: () => {}, onError: error => errors.push(error.code || '') });
  const rotate = queue.enqueue('node.setRotation', { slideId: 's1', nodeId: 'n1', rotation: 15 }, [{ nodeId: 'n1', rotation: 15 }]);
  const next = queue.enqueue('node.setZIndex', { slideId: 's1', nodeId: 'n2' });
  assert.equal(queue.overlay().get('n1')?.rotation, 15);
  assert.equal(await rotate, null);
  assert.equal((await next)?.revision, 2, 'the next edit still runs on the unchanged revision');
  assert.deepEqual(errors, ['node_locked']);
  assert.equal(queue.overlay().size, 0);
});

test('a revision conflict drops the edits queued behind it; undo-like tasks run in order', async () => {
  const { PptCommandQueue, isRevisionConflict } = await import('../../lib/ppt-command-queue');
  const server = fakeServer();
  const errors: boolean[] = [];
  const queue = new PptCommandQueue<QProject>(1, { send: server.send, onProject: () => {}, onError: error => errors.push(isRevisionConflict(error)) });
  queue.observe(0);
  assert.equal(queue.revision, 1, 'an older revision never moves the base back');
  queue.revision = 0; // another writer moved the project on
  const stale = queue.enqueue('node.setLocked', { slideId: 's1', nodeId: 'a' }, [{ nodeId: 'a', rotation: 1 }]);
  const behind = queue.enqueue('node.setZIndex', { slideId: 's1', nodeId: 'a' }, [{ nodeId: 'a', rotation: 2 }]);
  assert.deepEqual([await stale, await behind], [null, null]);
  assert.deepEqual(errors, [true]);
  assert.equal(server.sent.length, 1);
  assert.equal(queue.overlay().size, 0);
  queue.observe(1);
  const edit = queue.enqueue('node.setLocked', { slideId: 's1', nodeId: 'a' });
  let undoStartedAt = 0;
  const undo = queue.run(async () => { undoStartedAt = queue.revision; return { revision: 9 }; });
  await Promise.all([edit, undo]);
  assert.equal(undoStartedAt, 2, 'undo waits for the edit queued before it to be answered');
  assert.equal(queue.revision, 9);
});
