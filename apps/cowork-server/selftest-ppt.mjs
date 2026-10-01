#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-ppt-test-'));
process.env.COWORK_STATE_DIR = temp;
const store = await import('./lib/ppt-store.mjs');
const { _internals: api, handlePpt } = await import('./lib/ppt-api.mjs');
const { _internals: renderer } = await import('./lib/ppt-render.mjs');

try {
  const uid = 'user-a';
  const id = store.newId();
  const project = store.save({ id, uid, title: 'Quarterly review', status: 'generating', stage: 'content', nodes: {}, updatedAt: '' });
  assert.equal(store.get(uid, id).title, 'Quarterly review');
  assert.equal(store.get('user-b', id), null, 'another account cannot open the project');
  assert.deepEqual(store.list('user-b'), []);
  let reply;
  const send = (status, body) => { reply = { status, body }; return true; };
  await handlePpt({ method: 'GET' }, new URL(`http://localhost/ppt/projects/${id}`), { uid: 'user-b', send });
  assert.equal(reply.status, 404, 'a guessed project ID is hidden from another account');
  await handlePpt({ method: 'GET' }, new URL(`http://localhost/ppt/projects/${id}/export`), { uid, send });
  assert.equal(reply.status, 409, 'unfinished decks cannot be exported');
  assert.equal(store.list(uid).length, 1);
  assert.equal(store.listPending().length, 1, 'pending jobs survive a process restart');
  project.nodes['1'] = { status: 'done', slide: { id: '1', title: 'Cover', bullets: [] } };
  store.save(project);
  assert.equal(store.get(uid, id).nodes['1'].status, 'done');
  assert.throws(() => store.get('../other', id), /invalid uid/);
  assert.throws(() => store.get(uid, '../other'), /invalid project id/);
  assert.equal(api.pages(3), 3);
  assert.equal(api.pages(100), 100);
  assert.throws(() => api.pages(101), /pages/);
  const outline = api.normalizeOutline({ slides: [{ title: 'Cover', focus: 'Intro' }, { title: 'Middle', focus: 'Detail' }, { title: 'End', focus: 'Summary' }] }, 3);
  const deck = api.normalizeDeck(api.parseModelJson('```json\n{"slides":[{"title":"Cover","bullets":[]},{"title":"Middle","bullets":["Point"]},{"title":"End","bullets":[]}]}\n```'), outline);
  assert.equal(deck.slides[1].bullets[0], 'Point');
  assert.throws(() => api.normalizeDeck({ slides: [{ title: 'Cover', bullets: [] }] }, outline), /恰好 3 页/);
  // Exercise the public HTTP state machine with an asynchronous model, including
  // a failed slide, retry checkpoints, editing, revision conflicts, and download.
  let calls = 0;
  let failOnce = true;
  let renders = 0;
  const deps = {
    modelCall: async (_project, prompt) => {
      calls++;
      if (prompt.includes('整稿演示文稿内容评审器')) return { missing: [], repeated: [], conflicts: [], unsupported: [] };
      if (prompt.includes('叙事规划器')) return { slides: [
        { title: '封面', focus: '介绍' }, { title: '进展', focus: '成果' }, { title: '结论', focus: '建议' },
      ] };
      if (prompt.includes('第 2 页') && failOnce) { failOnce = false; throw new Error('temporary model outage'); }
      return { title: `第 ${/第 (\d+) 页/.exec(prompt)?.[1]} 页`, bullets: ['可编辑内容'] };
    },
    renderPptx: async (project) => { renders++; assert.equal(project.deck.slides.length, project.pages); return { bytes: 1234 }; },
    readFile: async () => ({ stream: Readable.from(Buffer.from('pptx-bytes')), size: 10 }),
  };
  const invoke = async (method, pathname, data, account = uid, response) => {
    const request = Readable.from(data === undefined ? [] : [Buffer.from(JSON.stringify(data))]);
    request.method = method;
    let answer;
    await handlePpt(request, new URL(`http://localhost${pathname}`), {
      uid: account, deps, res: response, log: () => {},
      send: (status, value) => { answer = { status, value }; return true; },
    });
    return answer;
  };
  const waitFor = async (projectId, expected) => {
    for (let n = 0; n < 100; n++) {
      const state = store.get(uid, projectId);
      if (state.status === expected) return state;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const state = store.get(uid, projectId);
    throw new Error(`PPT job did not reach ${expected}: ${state?.status} ${state?.error || ''}`);
  };
  const created = await invoke('POST', '/ppt/projects', { prompt: '季度复盘', title: '新项目', pages: 3, configId: 'test-config' });
  assert.equal(created.status, 201);
  const flowId = created.value.project.id;
  assert.equal((await waitFor(flowId, 'outline_ready')).outline.length, 3);
  assert.equal((await invoke('GET', `/ppt/projects/${flowId}`, undefined, 'user-b')).status, 404);
  assert.equal((await invoke('POST', `/ppt/projects/${flowId}/generate`)).status, 202);
  const failed = await waitFor(flowId, 'failed');
  assert.equal(failed.nodes[failed.outline[0].id].status, 'done');
  assert.equal(failed.nodes[failed.outline[1].id].status, 'running');
  assert.equal((await invoke('GET', `/ppt/projects/${flowId}/export`)).status, 409);
  const callsBeforeRetry = calls;
  assert.equal((await invoke('POST', `/ppt/projects/${flowId}/retry`)).status, 202);
  const completed = await waitFor(flowId, 'completed');
  assert.equal(calls - callsBeforeRetry, 2, 'retry reuses the completed slide node');
  assert.equal(completed.deck.slides.length, 3);
  assert.equal(renders, 1);
  const edited = completed.deck.slides.map((s) => ({ ...s }));
  edited[1].title = '更新的标题';
  assert.equal((await invoke('PATCH', `/ppt/projects/${flowId}`, { slides: edited, revision: 0 })).status, 409);
  const saved = await invoke('PATCH', `/ppt/projects/${flowId}`, { slides: edited, revision: 1 });
  assert.equal(saved.status, 200);
  assert.equal(saved.value.project.revision, 2);
  assert.equal(store.get(uid, flowId).deck.slides[1].title, '更新的标题');
  assert.equal(renders, 1, 'compatibility saves create drafts without implicit publication');
  const published = await invoke('POST', `/ppt/projects/${flowId}/publish`);
  assert.equal(published.value.published, true); assert.equal(renders, 2);
  let download = '';
  const response = {
    writeHead(status, headers) { assert.equal(status, 200); assert.equal(headers['content-length'], 10); },
    write(chunk) { download += chunk.toString(); }, end() {}, on() {}, destroy() {},
  };
  await invoke('GET', `/ppt/projects/${flowId}/export`, undefined, uid, response);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(download, 'pptx-bytes');
  if (process.env.PPT_PYTHON) {
    const output = path.join(temp, 'presentation.pptx');
    deck.slides[1].title = '季度业务复盘';
    deck.slides[1].bullets = ['收入增长与客户需求'];
    const render = spawnSync(process.env.PPT_PYTHON, ['-c', renderer.SCRIPT], {
      input: JSON.stringify({ slides: deck.slides, template: 'violet', fonts: { title: 'Noto Sans CJK SC', body: 'Noto Sans CJK SC', titleEastAsia: 'Noto Sans CJK SC', bodyEastAsia: 'Noto Sans CJK SC' } }), encoding: 'utf8', env: { ...process.env, PPT_OUTPUT: output },
    });
    assert.equal(render.status, 0, render.stderr);
    const verify = spawnSync(process.env.PPT_PYTHON, ['-c', 'import sys,zipfile; from pptx import Presentation; p=Presentation(sys.argv[1]); assert len(p.slides)==3; assert p.slides[1].shapes[1].text=="季度业务复盘"; assert "收入增长与客户需求" in p.slides[1].shapes[2].text; z=zipfile.ZipFile(sys.argv[1]); assert b\'<a:ea typeface="Noto Sans CJK SC"\' in z.read("ppt/slides/slide2.xml")', output], { encoding: 'utf8' });
    assert.equal(verify.status, 0, verify.stderr);
    assert.ok(fs.statSync(output).size > 1000);
  }
  console.log('PPT store and IR validation: OK');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
