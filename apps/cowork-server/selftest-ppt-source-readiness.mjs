// P0-3 input readiness through the real HTTP handler: a required source
// warning blocks /generate until the user acknowledges it for this source hash.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-readiness-'));
process.env.COWORK_STATE_DIR = root;
const [{ handlePpt }, store] = await Promise.all([import('./lib/ppt-api.mjs'), import('./lib/ppt-store.mjs')]);
const uid = 'alice';
const deps = { modelCall: async () => { throw Object.assign(new Error('ppt_cancelled'), { code: 'cancelled' }); }, removeContainer: async () => {} };
async function request(method, pathname, data) {
  const req = Readable.from(data === undefined ? [] : [Buffer.from(JSON.stringify(data))]);
  req.method = method;
  let result;
  await handlePpt(req, new URL(`http://test${pathname}`), { uid, deps, activity: () => {}, log: () => {}, send: (status, body) => { result = { status, body }; return true; }, res: { writeHead() {}, on() {} } });
  return result;
}

const svg = { code: 'source_media_decode', required: true, location: 'HTML inline SVG', message: 'svg_rasterizer_unavailable: LibreOffice (soffice) is not installed in this runtime', cause: 'runtime_dependency_missing' };
const id = store.newId(), now = new Date().toISOString();
store.save({ id, uid, title: 'Readiness', status: 'outline_ready', stage: 'outline', pages: 3, template: 'light', inputKind: 'paste', generationPolicy: { version: 2, detail: 'standard', content: 'overview', selection: 'editorial', archive: 'none', language: { mode: 'source', body: 'both' }, knowledge: 'source_only' },
  source: { kind: 'paste', name: 'paste', sha256: 'source-hash-1', text: 'Incident review. Root cause and actions.', segments: [], images: [], mediaWarnings: [svg] },
  outline: ['Incident', 'Root cause', 'Actions'].map((title, index) => ({ id: 's' + index, title, focus: title, sourceUnitIds: [] })), deck: null, nodes: {}, revision: 0,
  pageDecision: { finalPageCount: 3, source: 'user', mode: 'explicit', includesCover: true }, tags: [], favorite: false, pinned: false, folderId: null, deletedAt: null, createdAt: now, updatedAt: now });

const live = await request('GET', `/ppt/projects/${id}?view=live`);
assert.equal(live.status, 200);
const view = live.body.project.sourceMediaWarnings;
assert.equal(view.length, 1); assert.equal(view[0].required, true); assert.equal(view[0].resolved, false); assert.match(view[0].key, /^source_warning:/);

const blocked = await request('POST', `/ppt/projects/${id}/generate`, {});
assert.equal(blocked.status, 409); assert.equal(blocked.body.code, 'source_warnings_unresolved'); assert.equal(blocked.body.warnings[0].key, view[0].key);

assert.equal((await request('POST', `/ppt/projects/${id}/source-warnings`, { keys: [view[0].key] })).status, 400, 'a reason is required');
assert.equal((await request('POST', `/ppt/projects/${id}/source-warnings`, { keys: ['source_warning:000000000000000000000000'], reason: 'skip' })).status, 409, 'unknown keys are rejected');

const acknowledged = await request('POST', `/ppt/projects/${id}/source-warnings?view=live`, { keys: [view[0].key], reason: 'User skipped the decorative SVG' });
assert.equal(acknowledged.status, 200); assert.equal(acknowledged.body.project.sourceMediaWarnings[0].resolved, true);
const saved = store.get(uid, id);
assert.deepEqual(saved.sourceObjectExclusions.map(item => [item.objectId, item.kind, item.approvedBy, item.sourceHash]), [[view[0].key, 'source_warning', 'user', 'source-hash-1']]);

const next = await request('POST', `/ppt/projects/${id}/generate`, {});
assert.notEqual(next.body?.code, 'source_warnings_unresolved', 'the readiness gate is lifted once acknowledged');
console.log('PPT source readiness gate (generate 409 → acknowledge → gate lifted): OK');
process.exit(0);
