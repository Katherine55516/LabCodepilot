/** Pages are written PPT_NODE_CONCURRENCY at a time, but their previews commit in
 * reading order (Fable, merge of main's 10-13 progressive generation, 2026-10-26):
 * a page that finishes early waits, visibly started, for the pages before it; a
 * page that fails releases the pages after it. A built-in template's card pages
 * are placed by code (2026-11-01), so the held writer page is the cover. */
import { cardDeckReply, cardWriterReply, simulatedExport } from './ppt-scope-test-helpers.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-ordered-commit-'));
process.env.COWORK_STATE_DIR = root;
process.env.PPT_NODE_CONCURRENCY = '3';
const [{ handlePpt }, store] = await Promise.all([import('./lib/ppt-api.mjs'), import('./lib/ppt-store.mjs')]);
const uid = 'alice';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label) {
  for (const start = Date.now(); Date.now() - start < 20000; await wait(2)) { const result = check(); if (result) return result; }
  throw new Error(`timeout: ${label}`);
}

// The cover (outline index 0, the one written page) is held until the test
// releases it, or fails; the card pages are placed by code meanwhile.
function harness(failSecond) {
  let releaseSecond; const secondHeld = new Promise(resolve => { releaseSecond = resolve; });
  const returned = new Set();
  const deps = {
    modelCall: async (project, prompt, _activity, _log, options = {}) => {
      const outlineReply = cardDeckReply(project, prompt, options); if (outlineReply) return outlineReply;
      const slideId = String(options.nodeKey || '').match(/^content:([^:]+)/u)?.[1];
      const index = project.outline.findIndex(slide => slide.id === slideId);
      if (index === 0) { await secondHeld; if (failSecond) throw Object.assign(new Error('fixture writer failure'), { code: 'fixture' }); }
      const reply = cardWriterReply(project, prompt, options);
      if (index >= 0) returned.add(index);
      return reply;
    },
    renderPptx: async project => simulatedExport(project, 12345),
    renderPdf: async () => ({ bytes: 100 }),
    extractFile: async () => { throw new Error('unused'); },
    analyzeTemplate: async () => { throw new Error('unused'); },
    removeContainer: async () => {},
    readFile: async () => ({ stream: Readable.from([]), size: 0 }),
  };
  return { deps, returned, release: () => releaseSecond() };
}
async function request(deps, method, pathname, data) {
  const req = Readable.from(data === undefined ? [] : [Buffer.from(JSON.stringify(data))]);
  req.method = method;
  let result;
  await handlePpt(req, new URL(`http://test${pathname}`), { uid, deps, activity: () => {}, log: () => {}, send: (status, body) => { result = { status, body }; return true; }, res: { writeHead() {}, on() {} } });
  return result;
}
// Four sections, so the card outline has at least three written pages before its closing.
const SOURCE = ['Revenue', 'Costs', 'Margins', 'Outlook'].map(topic => `# ${topic}\n\n${topic} changed during the year according to the report. The report explains the main driver behind the change in plain words.\n\nThe second paragraph about ${topic.toLowerCase()} adds the context a reader needs to follow the argument.`).join('\n\n');
async function startDeck(deps, title) {
  const created = await request(deps, 'POST', '/ppt/projects', { readOnlyInput: false, inputKind: 'paste', text: SOURCE, title, pages: 8, template: 'light', configId: 'test' });
  assert.equal(created.status, 201);
  const id = created.body.project.id;
  const planned = await until(() => { const p = store.get(uid, id); if (p?.status === 'failed') throw new Error(p.error); return p?.status === 'outline_ready' && p; }, 'outline');
  assert.equal((await request(deps, 'PATCH', `/ppt/projects/${id}/outline`, { slides: planned.outline, finalPageCount: planned.outline.length })).status, 200);
  assert.equal((await request(deps, 'POST', `/ppt/projects/${id}/generate`)).status, 202);
  return id;
}
// Records the order in which pages become committed ("done").
function watchCommits(id) {
  const order = [];
  const timer = setInterval(() => {
    const p = store.get(uid, id);
    (p?.outline || []).forEach((slide, index) => { if (p.nodes?.[slide.id]?.status === 'done' && !order.includes(index)) order.push(index); });
  }, 1);
  return { order, stop: () => clearInterval(timer) };
}

try {
  // 1. Page 3 finishes first, stays started, and commits after page 2.
  {
    const run = harness(false);
    const id = await startDeck(run.deps, 'Ordered deck');
    const commits = watchCommits(id);
    await until(() => { const p = store.get(uid, id); return p?.nodes?.[p.outline[2]?.id]?.status === 'running' && p; }, 'page 3 started');
    await wait(100);
    const held = store.get(uid, id);
    assert.equal(held.nodes[held.outline[0].id].status, 'running', 'the cover is still being written');
    assert.ok(held.outline.slice(1).every(slide => held.nodes[slide.id]?.status !== 'done'), 'placed card pages show as started, not committed, while the cover runs');
    run.release();
    const done = await until(() => { const p = store.get(uid, id); if (p?.status === 'failed') throw new Error(p.error); return ['completed', 'quality_blocked'].includes(p?.status) && p; }, 'deck done');
    commits.stop();
    assert.deepEqual(commits.order, done.outline.map((_slide, index) => index), 'previews commit in reading order');
  }
  // 2. A failed cover writer releases the pages after it: page 3 still commits.
  {
    const run = harness(true);
    const id = await startDeck(run.deps, 'Failing deck');
    await until(() => { const p = store.get(uid, id); return p?.nodes?.[p.outline[2]?.id]?.status === 'running' && p; }, 'page 3 started');
    run.release();
    await until(() => store.get(uid, id)?.nodes?.[store.get(uid, id).outline[2].id]?.status === 'done', 'page 3 committed after the cover writer failed');
    const after = store.get(uid, id);
    assert.notEqual(after.nodes[after.outline[0].id].status, 'running', 'the failed cover writer no longer holds the deck');
  }
  console.log('PASS ordered commit: previews commit in reading order behind a held cover; a failed cover writer releases the pages after it');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
