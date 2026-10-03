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
  const target = path.join(directory, 'ppt', uid, `${id}.json`);
  assert.ok(fs.existsSync(target), 'media references keep snapshot small without gzip');
  assert.ok(fs.statSync(target).size < 100_000, 'repeated native media should be stored once');
  assert.deepEqual(store.get(uid, id), project);
  assert.equal(store.list(uid).length, 1);
  assert.equal(fs.readdirSync(path.join(directory, 'ppt', uid, 'assets')).length, 1, 'one immutable media blob');
  const restored = store.get(uid, id); restored.slides[0].text = 'changed';
  assert.notEqual(store.get(uid,id).slides[0].text, 'changed', 'reads must not share mutable project state');
  store.remove(uid, id);
  assert.equal(store.get(uid, id), null);
  assert.equal(store.collectUnusedMedia(uid, { graceMs: 0 }).removed.length, 1);
  store.collectUnusedMedia(uid, { graceMs: 0, dryRun: false });
  assert.equal(fs.readdirSync(path.join(directory, 'ppt', uid, 'assets')).length, 0);
  console.log('PPT large snapshot compression, recovery, list and deletion: OK');
} finally { fs.rmSync(directory, { recursive: true, force: true }); }
