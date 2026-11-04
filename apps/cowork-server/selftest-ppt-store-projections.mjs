// The project list reads a small projection of each project; the projection
// cache holds the whole working set, so a list walk over more projects than
// its old 128 entries no longer parses every project on every call (live
// 2026-10-26: 130 projects, list >120 s, the readiness probe stopped 3157).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-store-projections-'));
process.env.COWORK_STATE_DIR = root;
try {
  const store = await import('./lib/ppt-store.mjs');
  assert.equal(store.storeReady(), true, 'the store answers readiness without reading a project');
  const uid = 'projections';
  for (let k = 0; k < 140; k++) store.save({ id: store.newId(), uid, title: `Deck ${k}`, status: 'draft', outline: [], deck: { slides: [] } });
  let parsed = 0;
  const summary = project => { parsed++; return { id: project.id, title: project.title, updatedAt: project.updatedAt }; };
  assert.equal(store.listProjected(uid, 'selftest-summary', summary).length, 140);
  assert.equal(parsed, 140, 'the first list reads each project once');
  parsed = 0;
  assert.equal(store.listProjected(uid, 'selftest-summary', summary).length, 140);
  assert.equal(parsed, 0, 'a second list of 140 projects reads none of them');
  // A fresh process (a restart) lists from the sidecars and reads no project file.
  {const fresh = await import('./lib/ppt-store.mjs?restart=1');
   fresh.registerListProjection('selftest-summary', summary);
   const projectReads = [], read = fs.readFileSync;
   fs.readFileSync = function (target, ...rest) { if (/[a-f0-9]{32}\.json(?:\.gz)?$/u.test(String(target))) projectReads.push(String(target)); return read.call(this, target, ...rest); };
   parsed = 0;
   try {
    const started = Date.now(), listed = fresh.listProjected(uid, 'selftest-summary', summary);
    assert.equal(listed.length, 140);
    // The sidecars predate this projection's registration: one rebuild each, written back.
    assert.equal(parsed, 140, 'a projection missing from the sidecars is rebuilt once');
    projectReads.length = 0;parsed = 0;
    const again = await import('./lib/ppt-store.mjs?restart=2');again.registerListProjection('selftest-summary', summary);
    const t0 = Date.now(), cold = again.listProjected(uid, 'selftest-summary', summary), seconds = (Date.now() - t0) / 1000;
    assert.equal(cold.length, 140);assert.equal(parsed, 0, 'after the rebuild a restart reads no project');assert.deepEqual(projectReads, [], 'no project file is read');
    assert.ok(seconds < 1, `140 projects list in under 1 s from sidecars: ${seconds}s`);
   } finally { fs.readFileSync = read; }
   // A save rewrites the sidecar; a list after it sees the new title without a rebuild.
   const one = fresh.list(uid, { hydrate: false })[0];one.title = 'Renamed deck';fresh.save(one);
   parsed = 0;
   const third = await import('./lib/ppt-store.mjs?restart=3');third.registerListProjection('selftest-summary', summary);
   assert.ok(third.listProjected(uid, 'selftest-summary', summary).some(item => item.title === 'Renamed deck') && parsed === 0, 'save updates the sidecar');
   // An older sidecar version, or one from before the project's last write, is rebuilt.
   const side = path.join(root, 'ppt', uid, one.id + '.summary.json'), record = JSON.parse(fs.readFileSync(side, 'utf8'));
   fs.writeFileSync(side, JSON.stringify({ ...record, version: 0 }));
   parsed = 0;const fourth = await import('./lib/ppt-store.mjs?restart=4');fourth.registerListProjection('selftest-summary', summary);fourth.listProjected(uid, 'selftest-summary', summary);
   assert.equal(parsed, 1, 'an older sidecar version is rebuilt');
   fs.writeFileSync(side, JSON.stringify({ ...record, identity: 'stale' }));
   parsed = 0;const fifth = await import('./lib/ppt-store.mjs?restart=5');fifth.registerListProjection('selftest-summary', summary);fifth.listProjected(uid, 'selftest-summary', summary);
   assert.equal(parsed, 1, 'a sidecar from before the last write is rebuilt');
   // A corrupt project is listed as unreadable; the list does not throw.
   const broken = fresh.list(uid, { hydrate: false })[1];
   const brokenFile = fs.existsSync(path.join(root, 'ppt', uid, broken.id + '.json')) ? path.join(root, 'ppt', uid, broken.id + '.json') : path.join(root, 'ppt', uid, broken.id + '.json.gz');
   fs.writeFileSync(brokenFile, '{not json');
   const sixth = await import('./lib/ppt-store.mjs?restart=6');sixth.registerListProjection('selftest-summary', summary);
   const withBroken = sixth.listProjected(uid, 'selftest-summary', summary);
   assert.ok(withBroken.some(item => item.id === broken.id && item.status === 'unreadable'), 'an unreadable project is listed as such');
   // Removing a project removes its sidecar.
   fresh.remove(uid, one.id);
   assert.ok(!fs.existsSync(side), 'the sidecar goes with its project');}
  console.log('PASS store projections: readiness reads no project; a list over 140 projects is served from the projection cache; a restart lists from sidecars without reading a project; saves update, stale or older sidecars are rebuilt, unreadable projects are listed, removal removes the sidecar');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
