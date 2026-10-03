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
// Immutable media is account-scoped and content-addressed. Snapshots contain
// small references, so each DAG transition never recompresses the same artwork.
const mediaCache = new Map();
let mediaCacheBytes = 0;
const MEDIA_CACHE_BYTES = 32 * 1024 * 1024;
function mediaDir(uid) { return path.join(ROOT, owner(uid), 'assets'); }
function cacheMedia(key, value) {
  if (mediaCache.has(key)) return;
  const size = Buffer.byteLength(value);
  if (size > MEDIA_CACHE_BYTES) return;
  while (mediaCacheBytes + size > MEDIA_CACHE_BYTES && mediaCache.size) {
    const [oldKey, old] = mediaCache.entries().next().value;
    mediaCacheBytes -= Buffer.byteLength(old); mediaCache.delete(oldKey);
  }
  mediaCache.set(key, value); mediaCacheBytes += size;
}
function storeMedia(uid, value) {
  const hash = crypto.createHash('sha256').update(value).digest('hex');
  const target = path.join(mediaDir(uid), `${hash}.txt`);
  if (!fs.existsSync(target)) {
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    try { fs.writeFileSync(target, value, { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  cacheMedia(`${uid}:${hash}`, value);
  return hash;
}
function loadMedia(uid, hash) {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('invalid PPT media reference');
  const key = `${uid}:${hash}`;
  if (mediaCache.has(key)) return mediaCache.get(key);
  let value;
  try { value = fs.readFileSync(path.join(mediaDir(uid), `${hash}.txt`), 'utf8'); }
  catch { throw new Error('PPT media blob missing or unreadable'); }
  if (crypto.createHash('sha256').update(value).digest('hex') !== hash) throw new Error('PPT media checksum mismatch');
  cacheMedia(key, value); return value;
}
function reviveStoredMedia(value, assets, uid) {
  if (!value || typeof value !== 'object') return value;
  if (Object.keys(value).length === 1 && Object.hasOwn(value, MEDIA_REF)) {
    const media = assets ? assets[value[MEDIA_REF]] : loadMedia(uid, value[MEDIA_REF]);
    if (typeof media !== 'string') throw new Error('PPT snapshot media reference is missing');
    return media;
  }
  for (const [key, child] of Object.entries(value)) value[key] = reviveStoredMedia(child, assets, uid);
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
    return parsed?.__pptStorageVersion === 2 ? reviveStoredMedia(parsed.project, null, uid) : parsed?.__pptStorageVersion === 1 ? reviveStoredMedia(parsed.project, parsed.assets || {}, uid) : parsed;
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
  const assetByValue = new Map();
  const reduced = JSON.stringify(project, (_key, value) => {
    if (typeof value !== 'string' || !value.startsWith('data:image/') || value.length < 100) return value;
    let hash = assetByValue.get(value);
    if (!hash) { hash = storeMedia(project.uid, value); assetByValue.set(value, hash); }
    return { [MEDIA_REF]: hash };
  });
  const output = '{"__pptStorageVersion":2,"project":' + reduced + '}';
  const useGzip = Buffer.byteLength(output) > 2_000_000;
  const target = useGzip ? compressed : plain;
  const tmp = `${target}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tmp, useGzip ? gzipSync(output, { level: 1 }) : output, { flag: 'wx', mode: 0o600 });
    fs.renameSync(tmp, target);
    fs.rmSync(useGzip ? plain : compressed, { force: true });
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
  fs.rmSync(path.join(ROOT, owner(uid), 'projects', projectId(id)), { recursive: true, force: true });
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
export function removeTemplate(uid, id) { for (const suffix of ['', '.ir.json', '.cover.svg']) fs.rmSync(templateFile(uid, id)+suffix, { force: true }); }
export function writeTemplateCover(uid, id, svg) {
  const target = templateFile(uid, id)+'.cover.svg', tmp = `${target}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try { fs.writeFileSync(tmp, svg, { flag:'wx', mode:0o600 }); fs.renameSync(tmp,target); }
  finally { fs.rmSync(tmp,{force:true}); }
}
export function readTemplateCover(uid, id) {
  try { return fs.readFileSync(templateFile(uid,id)+'.cover.svg','utf8'); }
  catch(error) { if(error.code==='ENOENT')return null; throw error; }
}

export function writeTemplateIR(uid, id, ir) {
  const target = templateFile(uid, id) + '.ir.json';
  const value = JSON.stringify(ir, (_key, child) => typeof child === 'string' && child.startsWith('data:image/') ? { [MEDIA_REF]: storeMedia(uid, child) } : child);
  const tmp = `${target}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try { fs.writeFileSync(tmp, value, { flag:'wx', mode: 0o600 }); fs.renameSync(tmp, target); }
  finally { fs.rmSync(tmp, { force: true }); }
}
export function readTemplateIR(uid, id, hash) {
  try {
    const ir = JSON.parse(fs.readFileSync(templateFile(uid, id) + '.ir.json', 'utf8'));
    if (ir.schemaVersion !== 1 || ir.parserVersion !== 'pptx-ir-2' || ir.sha256 !== hash) return null;
    return reviveStoredMedia(ir, null, uid);
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
/** Offline account-scoped GC. References in snapshots, template IR and
 * retained revisions all protect immutable blobs; grace covers in-flight writes. */
export function collectUnusedMedia(uid, { graceMs = 86400000, dryRun = true } = {}) {
  if (!Number.isFinite(graceMs) || graceMs < 0) throw new Error('invalid media GC grace');
  const referenced = new Set(), dir = path.join(ROOT, owner(uid));
  function scan(folder) {
    if (!fs.existsSync(folder)) return;
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      if (entry.isSymbolicLink() || entry.name === 'assets') continue;
      const target = path.join(folder, entry.name);
      if (entry.isDirectory()) { scan(target); continue; }
      if (!/\.json(?:\.gz)?$/.test(entry.name)) continue;
      let bytes = fs.readFileSync(target); if (entry.name.endsWith('.gz')) bytes = gunzipSync(bytes);
      JSON.parse(bytes); // fail closed on corrupted metadata; don't collect referenced assets
      const text = bytes.toString('utf8');
      for (const match of text.matchAll(/"__pptStoredMediaRef"\s*:\s*"([a-f0-9]{64})"/g)) referenced.add(match[1]);
      // Old revision journals embed strings instead of references.
      for (const match of text.matchAll(/"(data:image\/[^"\\]+)"/g)) referenced.add(crypto.createHash('sha256').update(match[1]).digest('hex'));
    }
  }
  scan(dir);
  const removed = [];
  if (fs.existsSync(mediaDir(uid))) for (const name of fs.readdirSync(mediaDir(uid))) {
    const hash = name.match(/^([a-f0-9]{64})\.txt$/)?.[1], target = path.join(mediaDir(uid), name);
    if (!hash || referenced.has(hash) || Date.now() - fs.statSync(target).mtimeMs < graceMs) continue;
    removed.push(hash);
    if (!dryRun) { fs.rmSync(target); const key = `${uid}:${hash}`; if (mediaCache.has(key)) { mediaCacheBytes -= Buffer.byteLength(mediaCache.get(key)); mediaCache.delete(key); } }
  }
  return { dryRun, protectedCount: referenced.size, removed };
}

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
