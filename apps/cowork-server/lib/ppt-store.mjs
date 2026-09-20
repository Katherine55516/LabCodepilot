/** Server-owned, per-account PPT metadata. The editable deck is the source of truth;
 * /workspace/presentation.pptx is a regenerable export artifact in the project's
 * Cowork volume. Keeping metadata here makes the library available on every device. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.join(process.env.COWORK_STATE_DIR || '/data/cowork-state', 'ppt');
const ID = /^[a-f0-9]{32}$/;
const UID = /^[a-zA-Z0-9._:-]{1,128}$/;

function owner(uid) {
  if (!UID.test(uid) || uid.includes('..') || uid === '.' || uid === '..') throw new Error('invalid uid');
  return uid;
}
function projectId(id) {
  if (!ID.test(id)) throw new Error('invalid project id');
  return id;
}
function file(uid, id) { return path.join(ROOT, owner(uid), `${projectId(id)}.json`); }
function sourceFile(uid, id) { return path.join(ROOT, owner(uid), 'sources', `${projectId(id)}.bin`); }
function foldersFile(uid) { return path.join(ROOT, owner(uid), '_folders.json'); }
function templatesFile(uid) { return path.join(ROOT, owner(uid), '_templates.json'); }
function templatePinsFile(uid) { return path.join(ROOT, owner(uid), '_template-pins.json'); }
function templateFile(uid, id) { return path.join(ROOT, owner(uid), 'templates', `${projectId(id)}.bin`); }
function inputFile(uid, id, kind) {
  if (!['base', 'progress'].includes(kind)) throw new Error('invalid input kind');
  return path.join(ROOT, owner(uid), 'inputs', `${projectId(id)}-${kind}.bin`);
}
export function newId() { return crypto.randomBytes(16).toString('hex'); }

export function get(uid, id) {
  const target = file(uid, id);
  try { return JSON.parse(fs.readFileSync(target, 'utf8')); }
  catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

export function list(uid) {
  const dir = path.join(ROOT, owner(uid));
  let names;
  try { names = fs.readdirSync(dir); }
  catch (error) { if (error?.code === 'ENOENT') return []; throw error; }
  return names.filter((name) => ID.test(name.slice(0, -5)) && name.endsWith('.json'))
    .map((name) => get(uid, name.slice(0, -5))).filter(Boolean)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function save(project) {
  const target = file(project.uid, project.id);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  project.updatedAt = new Date().toISOString();
  try {
    fs.writeFileSync(tmp, JSON.stringify(project), { flag: 'wx', mode: 0o600 });
    fs.renameSync(tmp, target);
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* renamed */ }
  }
  return project;
}

export function writeSource(uid, id, bytes) {
  const target = sourceFile(uid, id);
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const tmp = `${target}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try { fs.writeFileSync(tmp, bytes, { flag: 'wx', mode: 0o600 }); fs.renameSync(tmp, target); }
  finally { try { fs.unlinkSync(tmp); } catch {} }
}
export function readSource(uid, id) { return fs.readFileSync(sourceFile(uid, id)); }
export function removeSource(uid, id) { fs.rmSync(sourceFile(uid, id), { force: true }); }
export function remove(uid, id) {
  fs.rmSync(file(uid, id), { force: true });
  removeSource(uid, id);
  for (const kind of ['base', 'progress']) fs.rmSync(inputFile(uid, id, kind), { force: true });
}
export function writeInput(uid, id, kind, bytes) {
  const target = inputFile(uid, id, kind);
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const tmp = `${target}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try { fs.writeFileSync(tmp, bytes, { flag: 'wx', mode: 0o600 }); fs.renameSync(tmp, target); }
  finally { try { fs.unlinkSync(tmp); } catch {} }
}
export function readInput(uid, id, kind) { return fs.readFileSync(inputFile(uid, id, kind)); }
export function listFolders(uid) {
  try { const value = JSON.parse(fs.readFileSync(foldersFile(uid), 'utf8')); return Array.isArray(value) ? value : []; }
  catch (error) { if (error?.code === 'ENOENT') return []; throw error; }
}
export function saveFolders(uid, folders) {
  const target = foldersFile(uid);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try { fs.writeFileSync(tmp, JSON.stringify(folders), { flag: 'wx', mode: 0o600 }); fs.renameSync(tmp, target); }
  finally { try { fs.unlinkSync(tmp); } catch {} }
  return folders;
}
export function listTemplates(uid) {
  try { const value = JSON.parse(fs.readFileSync(templatesFile(uid), 'utf8')); return Array.isArray(value) ? value : []; }
  catch (error) { if (error?.code === 'ENOENT') return []; throw error; }
}
export function listTemplatePins(uid) {
  try { const value = JSON.parse(fs.readFileSync(templatePinsFile(uid), 'utf8')); return Array.isArray(value) ? value : []; }
  catch (error) { if (error?.code === 'ENOENT') return []; throw error; }
}
export function saveTemplatePins(uid, ids) {
  const target = templatePinsFile(uid);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try { fs.writeFileSync(tmp, JSON.stringify(ids), { flag: 'wx', mode: 0o600 }); fs.renameSync(tmp, target); }
  finally { try { fs.unlinkSync(tmp); } catch {} }
}
export function saveTemplates(uid, templates) {
  const target = templatesFile(uid);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try { fs.writeFileSync(tmp, JSON.stringify(templates), { flag: 'wx', mode: 0o600 }); fs.renameSync(tmp, target); }
  finally { try { fs.unlinkSync(tmp); } catch {} }
  return templates;
}
export function writeTemplate(uid, id, bytes) {
  const target = templateFile(uid, id);
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const tmp = `${target}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try { fs.writeFileSync(tmp, bytes, { flag: 'wx', mode: 0o600 }); fs.renameSync(tmp, target); }
  finally { try { fs.unlinkSync(tmp); } catch {} }
}
export function removeTemplate(uid, id) { fs.rmSync(templateFile(uid, id), { force: true }); }

export function listPending() {
  let uids;
  try { uids = fs.readdirSync(ROOT); }
  catch (error) { if (error?.code === 'ENOENT') return []; throw error; }
  return uids.flatMap((uid) => {
    try { return list(uid).filter((p) => p.status === 'ingesting' || p.status === 'outlining' || p.status === 'generating'); }
    catch { return []; }
  });
}

export const _internals = { ROOT, owner, projectId };
