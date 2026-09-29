import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-long-storage-'));
process.env.COWORK_STATE_DIR = directory;
const store = await import('./lib/ppt-store.mjs');
const uid = 'long-deck-test';
const id = store.newId();
try {
  const project = { id, uid, title: '100 slides', updatedAt: '', slides: [] };
  store.save(project);
  assert.equal(store.get(uid, id).title, project.title);
  const image = 'data:image/png;base64,' + 'a'.repeat(30_000);
  project.slides = Array.from({ length: 100 }, (_, index) => ({ id: `s${index}`, image, text: `页 ${index}` }));
  store.save(project);
  const target = path.join(directory, 'ppt', uid, `${id}.json.gz`);
  assert.ok(fs.existsSync(target), 'large project should use compressed snapshot');
  assert.ok(fs.statSync(target).size < 100_000, 'repeated native media should be stored once');
  assert.deepEqual(store.get(uid, id), project);
  assert.equal(store.list(uid).length, 1);
  store.remove(uid, id);
  assert.equal(store.get(uid, id), null);
  console.log('PPT large snapshot compression, recovery, list and deletion: OK');
} finally { fs.rmSync(directory, { recursive: true, force: true }); }
