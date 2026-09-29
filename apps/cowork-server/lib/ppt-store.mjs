/** Server-owned, per-account PPT metadata. The editable deck is the source of truth;
 * /workspace/presentation.pptx is a regenerable export artifact in the project's
 * Cowork volume. Keeping metadata here makes the library available on every device. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';

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
function compressedFile(uid, id) { return `${file(uid, id)}.gz`; }
const MEDIA_REF = '__pptStoredMediaRef';
function reviveStoredMedia(value, assets) {
  if (!value || typeof value !== 'object') return value;
  if (Object.keys(value).length === 1 && Object.hasOwn(value, MEDIA_REF)) {
    const media = assets[value[MEDIA_REF]];
    if (typeof media !== 'string') throw new Error('PPT snapshot media reference is missing');
    return media;
  }
  for (const [key, child] of Object.entries(value)) value[key] = reviveStoredMedia(child, assets);
  return value;
}
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
  const compressed = compressedFile(uid, id);
  const target = fs.existsSync(compressed) ? compressed : file(uid, id);
  try {
    const bytes = fs.readFileSync(target);
    const parsed = JSON.parse(target === compressed ? gunzipSync(bytes).toString('utf8') : bytes.toString('utf8'));
    return parsed?.__pptStorageVersion === 1 ? reviveStoredMedia(parsed.project, parsed.assets || {}) : parsed;
  }
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
  return [...new Set(names.flatMap(name => {
    const match = name.match(/^([a-f0-9]{32})\.json(?:\.gz)?$/);
    return match ? [match[1]] : [];
  }))].map(id => get(uid, id)).filter(Boolean)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function save(project, { touch = true } = {}) {
  const plain = file(project.uid, project.id);
  const compressed = compressedFile(project.uid, project.id);
  fs.mkdirSync(path.dirname(plain), { recursive: true });
  if (touch) project.updatedAt = new Date().toISOString();
  const json = JSON.stringify(project);
  const useGzip = Buffer.byteLength(json) > 2_000_000 || fs.existsSync(compressed);
  const target = useGzip ? compressed : plain;
  const tmp = `${target}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    let output = json;
    if (useGzip) {
      const assetByValue = new Map(); const assets = {};
      const reduced = JSON.stringify(project, (_key, value) => {
        if (typeof value !== 'string' || !value.startsWith('data:image/') || value.length < 100) return value;
        let id = assetByValue.get(value);
        if (id === undefined) { id = String(assetByValue.size); assetByValue.set(value, id); assets[id] = value; }
        return { [MEDIA_REF]: id };
      });
      output = JSON.stringify({ __pptStorageVersion: 1, assets }) .slice(0, -1) + ',"project":' + reduced + '}';
    }
    fs.writeFileSync(tmp, useGzip ? gzipSync(output, { level: 1 }) : output, { flag: 'wx', mode: 0o600 });
    fs.renameSync(tmp, target);
    if (useGzip) fs.rmSync(plain, { force: true });
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
  fs.rmSync(compressedFile(uid, id), { force: true });
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
export function readTemplate(uid, id) { return fs.readFileSync(templateFile(uid, id)); }
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
