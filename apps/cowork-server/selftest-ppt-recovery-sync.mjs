import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-recovery-sync-'));
process.env.COWORK_STATE_DIR = directory;
const store = await import('./lib/ppt-store.mjs');
const { startRun, transitionNode, recoverRun, completeRun } = await import('./lib/ppt/run-service.mjs');
const { getRun, listEvents } = await import('./lib/ppt/event-store.mjs');
const uid = 'recovery-test', id = store.newId(), nodeId = 'source:slide-one';
try {
  const project = { uid, id, title: 'Recovery', pages: 3, status: 'generating', stage: 'source', revision: 0,
    outline: [{ id: 'slide-one', title: 'One' }], deck: null, nodes: {}, dagNodes: {} };
  store.save(project); startRun(project);
  transitionNode(project, nodeId, 'running');
  assert.equal(store.get(uid, id).dagNodes[nodeId].status, 'running');
  const recovered = recoverRun(store.get(uid, id));
  assert.equal(recovered.nodes[nodeId].status, 'pending');
  assert.equal(store.get(uid, id).dagNodes[nodeId].status, 'pending', 'project and run must agree on recovery');
  transitionNode(store.get(uid, id), nodeId, 'completed', { result: { passed: true } });
  completeRun(store.get(uid, id));
  assert.equal(getRun(uid, id, recovered.id).nodes[nodeId].status, 'completed');
  assert.ok(listEvents(uid, id, recovered.id).some(event => event.type === 'run.recovered'));
  console.log('PPT Run/DAG/Event recovery state synchronization: OK');
} finally { fs.rmSync(directory, { recursive: true, force: true }); }
