import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as legacy from '../ppt-store.mjs';
import { migrateProject } from './migrations.mjs';

const ROOT = legacy._internals.ROOT;
const ID = /^[a-zA-Z0-9_-]{1,80}$/;
const queues = new Map();

function safe(value, field) {
  if (!ID.test(String(value || ''))) throw new Error(`invalid ${field}`);
  return String(value);
}

export function projectDataDir(uid, projectId) {
  const owner = legacy._internals.owner(uid);
  const id = legacy._internals.projectId(projectId);
  return path.join(ROOT, owner, 'projects', id);
}

export function atomicJson(target, value) {
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const tmp = `${target}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(value), { flag: 'wx', mode: 0o600 });
    fs.renameSync(tmp, target);
  } finally { try { fs.unlinkSync(tmp); } catch {} }
  return value;
}

export function readJson(target, fallback = null) {
  try { return JSON.parse(fs.readFileSync(target, 'utf8')); }
  catch (error) { if (error?.code === 'ENOENT') return fallback; throw error; }
}

export function getProject(uid, projectId, { persistMigration = false } = {}) {
  const raw = legacy.get(uid, projectId);
  const result = migrateProject(raw);
  if (result.changed && persistMigration) legacy.save(result.project);
  return result.project;
}

export function saveProject(project) {
  return legacy.save(migrateProject(project).project);
}

export function mutateProject(uid, projectId, updater) {
  const project = getProject(uid, projectId);
  if (!project) return null;
  const next = updater(structuredClone(project));
  if (!next) return project;
  return saveProject(next);
}

/** Serialize async workflows per project without holding the queue during model calls. */
export function enqueueProject(uid, projectId, task) {
  const key = `${uid}:${projectId}`;
  const previous = queues.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(task);
  queues.set(key, current);
  current.finally(() => { if (queues.get(key) === current) queues.delete(key); }).catch(() => {});
  return current;
}

export function runFile(uid, projectId, runId) {
  return path.join(projectDataDir(uid, projectId), 'runs', `${safe(runId, 'run id')}.json`);
}

export function eventsFile(uid, projectId, runId) {
  return path.join(projectDataDir(uid, projectId), 'runs', `${safe(runId, 'run id')}.events.jsonl`);
}

export function operationsFile(uid, projectId) {
  return path.join(projectDataDir(uid, projectId), 'operations.jsonl');
}

export function revisionFile(uid, projectId, revision) {
  if (!Number.isInteger(Number(revision)) || Number(revision) < 0) throw new Error('invalid revision');
  return path.join(projectDataDir(uid, projectId), 'revisions', `${Number(revision)}.json`);
}

export function appendJsonLine(target, value) {
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const fd = fs.openSync(target, 'a', 0o600);
  try { fs.writeSync(fd, `${JSON.stringify(value)}\n`); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  return value;
}

export function readJsonLines(target) {
  let text;
  try { text = fs.readFileSync(target, 'utf8'); }
  catch (error) { if (error?.code === 'ENOENT') return []; throw error; }
  const rows = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch { break; }
  }
  return rows;
}

export function saveRevision(project, reason = 'checkpoint') {
  return atomicJson(revisionFile(project.uid, project.id, project.revision), {
    schemaVersion: 1, projectId: project.id, revision: project.revision, reason,
    createdAt: new Date().toISOString(), deck: project.deck, renderTree: project.renderTree || null,
    template: project.template, templateSpec: project.templateSpec,
  });
}

export function readRevision(uid, projectId, revision) {
  return readJson(revisionFile(uid, projectId, revision));
}

export function listRevisions(uid, projectId) {
  const dir = path.join(projectDataDir(uid, projectId), 'revisions');
  let names;
  try { names = fs.readdirSync(dir); }
  catch (error) { if (error?.code === 'ENOENT') return []; throw error; }
  return names.filter(name => /^\d+\.json$/.test(name)).map(name => readJson(path.join(dir, name)))
    .filter(Boolean).sort((a, b) => b.revision - a.revision);
}

export const _internals = { ROOT, queues, safe };
