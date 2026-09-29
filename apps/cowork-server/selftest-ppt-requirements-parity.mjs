import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

const state = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-parity-'));
process.env.COWORK_STATE_DIR = state;
const [{ handlePpt }, store] = await Promise.all([import('./lib/ppt-api.mjs'), import('./lib/ppt-store.mjs')]);
const uid = 'parity-user';
const deps = { modelCall: async project => ({ slides: Array.from({ length: project.pages }, (_, index) => ({
  title: `第 ${index + 1} 页`, focus: `核心观点 ${index + 1}`, description: `说明 ${index + 1}`, children: [],
})) }) };
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
  const created = await call('POST', '/ppt/projects', { inputKind: 'paste', title: '人工标题', text: '报告正文', pages: 3, configId: 'test', model: 'test' });
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
  assert.equal(project.outline.length, 3);
  assert.equal((await call('POST', `/ppt/projects/${projectId}/outline`, { pages: 4, template: 'violet' })).status, 202);
  project = await outlineReady();
  assert.equal(project.pages, 4);
  assert.equal(project.outline.length, 4);
  const changed = await call('PATCH', `/ppt/projects/${projectId}/outline`, { slides: project.outline.map((slide, index) => ({ ...slide, title: index ? slide.title : '已编辑的封面标题' })), finalPageCount: 4, template: 'blue' });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.project.template, 'blue');
  assert.equal(changed.body.project.outline[0].title, '人工标题', 'locked user title remains unchanged by outline edits');
  const updated = await call('POST', '/ppt/updates', { baseProjectId: ids[0], progressKind: 'prompt', progressText: '本季度最新进展',
    title: '自定义更新版标题', template: 'violet', pages: 6, configId: 'test', model: 'test' });
  assert.equal(updated.status, 201);
  assert.equal(updated.body.project.title, '自定义更新版标题');
  assert.equal(updated.body.project.deckTitle.source, 'user');
  console.log('PPT ordering parity OK');
} finally { fs.rmSync(state, { recursive: true, force: true }); }
