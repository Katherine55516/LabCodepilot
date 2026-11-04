import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

const state = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-parity-'));
process.env.COWORK_STATE_DIR = state;
const [{ handlePpt }, store] = await Promise.all([import('./lib/ppt-api.mjs'), import('./lib/ppt-store.mjs')]);
const uid = 'parity-user';
const { cardModel } = await import('./ppt-scope-test-helpers.mjs');
// Card outline and writer doubles (2026-10-23).
const deps = { modelCall: cardModel(async (_project, _prompt, _a, _l, options) => { throw new Error('Unexpected model step ' + options.nodeKey); }) };
async function call(method, route, payload) {
  const req = Readable.from(payload === undefined ? [] : [Buffer.from(JSON.stringify(payload))]);
  req.method = method;
  let result;
  await handlePpt(req, new URL(`http://test${route}`), {
    uid, req, activity: () => {}, deps, log: () => {},
    send: (status, body) => { result = { status, body }; return true; },
    res: { writeHead() {}, on() {}, destroy() {} },
  });
  return result;
}

try {
  const now = '2026-09-23T00:00:00.000Z';
  const ids = Array.from({ length: 4 }, (_, index) => (index + 1).toString(16).padStart(32, '0'));
  for (let index = 0; index < ids.length; index++) {
    store.save({ id: ids[index], uid, title: `项目 ${index}`, status: 'completed', updatedAt: now, createdAt: now,
      pinned: index < 2, deletedAt: null, outline: [], deck: null, tags: [] }, { touch: false });
  }
  const folderIds = Array.from({ length: 4 }, (_, index) => (index + 5).toString(16).padStart(32, '0'));
  store.saveFolders(uid, folderIds.map((id, index) => ({ id, name: `文件夹 ${index}`, pinned: index < 2 })));
  assert.equal((await call('POST', '/ppt/projects/order', { movedId: ids[1], targetId: ids[0] })).status, 200);
  assert.equal((await call('POST', '/ppt/projects/order', { movedId: ids[2], targetId: ids[0] })).status, 409);
  assert.equal((await call('POST', '/ppt/projects/order', { movedId: ids[3], targetId: ids[2] })).status, 200);
  assert.deepEqual((await call('GET', '/ppt/projects?sort=manual')).body.projects.map(project => project.id), [ids[1], ids[0], ids[3], ids[2]]);
  assert.equal(store.get(uid, ids[1]).updatedAt, now, 'manual ordering must not modify recently edited time');
  assert.equal((await call('POST', '/ppt/folders/order', { movedId: folderIds[1], targetId: folderIds[0] })).status, 200);
  assert.equal((await call('POST', '/ppt/folders/order', { movedId: folderIds[2], targetId: folderIds[0] })).status, 409);
  assert.deepEqual((await call('GET', '/ppt/folders')).body.folders.map(folder => folder.id), [folderIds[1], folderIds[0], folderIds[2], folderIds[3]]);
  assert.equal(store.get(uid, ids[1]).pinned, true, 'dragging must not change pin state');
  const created = await call('POST', '/ppt/projects', { readOnlyInput:false,inputKind: 'paste', title: '人工标题', text: '报告正文', pages: 3, configId: 'test', model: 'test' });
  assert.equal(created.status, 201);
  const projectId = created.body.project.id;
  async function outlineReady() {
    for (let attempt = 0; attempt < 100; attempt++) {
      const project = store.get(uid, projectId);
      if (project?.status === 'outline_ready') return project;
      if (project?.status === 'failed') throw new Error(project.error);
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('outline did not finish');
  }
  let project = await outlineReady();
  assert.equal(project.outline[0].title, '人工标题', 'the author\'s title is the cover');
  // Rewriting with other settings keeps the project; the template comes with the settings form.
  assert.equal((await call('POST', `/ppt/projects/${projectId}/planning`, { command: 'outline', length: { exact: 6 }, template: 'violet', semanticRevision: project.planningContract.semanticRevision })).status, 202);
  project = await outlineReady();
  assert.equal(project.template, 'violet');assert.equal(project.pages, project.outline.length);
  const edited = await call('POST', `/ppt/projects/${projectId}/planning`, { command: 'edit', semanticRevision: project.planningContract.semanticRevision, cards: project.outline.map((slide, index) => ({ id: slide.id, title: index ? slide.title : '已编辑的封面标题', points: (slide.keyPoints || []).map(point => point.text), numbered: Boolean(slide.numberedPoints) })) });
  assert.equal(edited.status, 200, JSON.stringify(edited.body).slice(0, 300));
  assert.equal(edited.body.project.outline[0].title, '人工标题', 'locked user title remains unchanged by outline edits');
  project = store.get(uid, projectId);
  assert.equal((await call('PATCH', `/ppt/projects/${projectId}/outline`, { slides: project.outline, finalPageCount: project.outline.length, template: 'blue' })).status, 409, 'a template change goes through the settings form');
  assert.equal((await call('POST', `/ppt/projects/${projectId}/planning`, { command: 'outline', template: 'blue', semanticRevision: project.planningContract.semanticRevision })).status, 202);
  project = await outlineReady();
  assert.equal(project.template, 'blue');assert.equal(project.outline[0].title, '人工标题');
  assert.equal((await call('PATCH', `/ppt/projects/${projectId}/outline`, { slides: project.outline, finalPageCount: project.outline.length })).status, 200);
  const updated = await call('POST', '/ppt/updates', { baseProjectId: ids[0], progressKind: 'prompt', progressText: '本季度最新进展',
    title: '自定义更新版标题', template: 'violet', pages: 6, configId: 'test', model: 'test' });
  assert.equal(updated.status, 201);
  assert.equal(updated.body.project.title, '自定义更新版标题');
  assert.equal(updated.body.project.deckTitle.source, 'user');
  console.log('PPT ordering parity OK');
} finally { fs.rmSync(state, { recursive: true, force: true }); }
