import { EventEmitter } from 'node:events';
import { appendJsonLine, atomicJson, eventsFile, readJson, readJsonLines, runFile } from './repository.mjs';
import { newId } from './ir.mjs';

const buses = new Map();

function bus(runId) {
  if (!buses.has(runId)) buses.set(runId, new EventEmitter());
  return buses.get(runId);
}

export function createRun(uid, projectId, input = {}) {
  const now = new Date().toISOString();
  const run = {
    schemaVersion: 1,
    id: input.id || newId('run'),
    uid,
    projectId,
    kind: input.kind || 'generation',
    status: input.status || 'queued',
    stage: input.stage || 'queued',
    createdAt: input.createdAt || now,
    updatedAt: now,
    startedAt: input.startedAt || null,
    completedAt: null,
    cancelledAt: null,
    lastSeq: 0,
    lastAppliedSeq: 0,
    nodes: input.nodes || {},
    error: null,
  };
  atomicJson(runFile(uid, projectId, run.id), run);
  return run;
}

export function getRun(uid, projectId, runId) {
  return readJson(runFile(uid, projectId, runId));
}

export function saveRun(run) {
  run.updatedAt = new Date().toISOString();
  return atomicJson(runFile(run.uid, run.projectId, run.id), run);
}

export function listEvents(uid, projectId, runId, after = 0) {
  return readJsonLines(eventsFile(uid, projectId, runId)).filter(event => event.seq > Number(after || 0));
}

export function appendEvent(runInput, type, payload = {}) {
  const fresh = getRun(runInput.uid, runInput.projectId, runInput.id);
  // The caller owns the next run state (node/status changes); the durable copy
  // only contributes the sequence cursor so appending an event cannot roll the
  // state transition back to the previous snapshot.
  const run = { ...(fresh || {}), ...structuredClone(runInput), lastSeq: Number(fresh?.lastSeq || runInput.lastSeq || 0) };
  const event = {
    schemaVersion: 1,
    id: newId('evt'),
    runId: run.id,
    projectId: run.projectId,
    seq: Number(run.lastSeq || 0) + 1,
    type,
    at: new Date().toISOString(),
    payload,
  };
  appendJsonLine(eventsFile(run.uid, run.projectId, run.id), event);
  run.lastSeq = event.seq;
  run.lastAppliedSeq = event.seq;
  saveRun(run);
  bus(run.id).emit('event', event);
  return { run, event };
}

export function subscribe(runId, listener) {
  const emitter = bus(runId);
  emitter.on('event', listener);
  return () => {
    emitter.off('event', listener);
    if (!emitter.listenerCount('event') && !emitter.listenerCount('transient')) buses.delete(runId);
  };
}

/** Transient, non-durable notifications (streaming drafts). Not sequenced,
 * not replayed and never written to the run's event log. */
export function publishTransient(runId, type, payload = {}) {
  if (!buses.has(runId)) return;
  bus(runId).emit('transient', { type, at: new Date().toISOString(), payload });
}
export function subscribeTransient(runId, listener) {
  const emitter = bus(runId);
  emitter.on('transient', listener);
  return () => { emitter.off('transient', listener); if (!emitter.listenerCount('event') && !emitter.listenerCount('transient')) buses.delete(runId); };
}
export const _internals = { buses, bus };
