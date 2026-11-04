import {countsAgainstLibraryQuota} from './ppt-library.mjs';
import {PPTX_IR_VERSION} from './ppt-native-shape-ids.mjs';
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

function draftFile(uid,id,slideId) {
  if(typeof slideId!=='string'||!/^[A-Za-z0-9_-]{1,80}$/u.test(slideId))throw new Error('invalid draft slide');
  return path.join(ROOT,owner(uid),'drafts',projectId(id),slideId+'.json');
}
export function saveDraft(uid,id,slideId,draft) {
  const target=draftFile(uid,id,slideId),text=JSON.stringify(draft);
  if(Buffer.byteLength(text)>256000)return;
  fs.mkdirSync(path.dirname(target),{recursive:true});
  const temporary=target+'.'+crypto.randomBytes(6).toString('hex')+'.tmp';
  try{fs.writeFileSync(temporary,text,{flag:'wx',mode:0o600});fs.renameSync(temporary,target);}finally{try{fs.unlinkSync(temporary);}catch{}}
}
export function readDraft(uid,id,slideId) {
  try{return JSON.parse(fs.readFileSync(draftFile(uid,id,slideId),'utf8'));}catch{return null;}
}
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
/** JSON with every inline image replaced by its account-scoped media reference.
 * Side files (command checkpoints, operations, revisions, proposals) use it too:
 * a 48-page deck with template photos is ~420 MB hydrated, and a checkpoint
 * holding it plus two decks exceeded V8's string limit (live mlq-r34 restore). */
export function stringifyWithMediaRefs(uid, value) {
  const assetByValue = new Map();
  return JSON.stringify(value, (_key, child) => {
    if (typeof child !== 'string' || !child.startsWith('data:image/') || child.length < 100) return child;
    let hash = assetByValue.get(child);
    if (!hash) { hash = storeMedia(uid, child); assetByValue.set(child, hash); }
    return { [MEDIA_REF]: hash };
  });
}
export function reviveMediaRefs(uid, value) { return reviveStoredMedia(value, null, uid); }
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

// Frequent library/status polling must not repeatedly decompress every native
// deck. Cache only caller-defined, small read projections; full mutable reads
// stay uncached. Atomic-file identity invalidates across processes and restarts.
const projectionCache = new Map(); let projectionBytes = 0;
const PROJECTION_MAX_BYTES = 8 * 1024 * 1024;
// Entries follow the working set: a list walk over more projects than the
// cache holds evicted, in order, each entry it needed next, so every list
// parsed every project (live 2026-10-26: 130 projects, list >120 s, 3157 down).
let projectionEntries = 128;
function invalidateProjections(uid, id) {
  const prefix=file(uid,id)+'\0';
  for(const [key, entry] of projectionCache)if(key.startsWith(prefix)){projectionBytes-=entry.bytes;projectionCache.delete(key);}
}
/** List projections persist beside each project (Fable 2026-10-26): a list
 * reads <id>.summary.json, never the project, so a cold list after a restart
 * costs one small read per project (it parsed all 130 projects, 75 s). The
 * sidecar is written after the project file and names that file's identity; a
 * missing, stale or older sidecar, or one without the asked projection, is
 * rebuilt from the project once and written back. Only projections registered
 * here are kept: small summaries, never live views. */
const SIDECAR_VERSION = 1;
const listProjections = new Map();
export function registerListProjection(cacheKey, projector) { listProjections.set(cacheKey, projector); }
function sidecarFile(uid, id) { return path.join(ROOT, owner(uid), `${projectId(id)}.summary.json`); }
function fileIdentity(target, stat) { return [path.basename(target), stat.size, stat.mtimeMs].join(':'); }
function readSidecar(uid, id) { try { return JSON.parse(fs.readFileSync(sidecarFile(uid, id), 'utf8')); } catch { return null; } }
function writeSidecar(uid, id, project, identity, known = {}) {
  const entries = {};
  for (const [key, projector] of listProjections) {
    try { entries[key] = JSON.parse(stringifyWithMediaRefs(uid, key in known ? known[key] : projector(project))); } catch { /* left to a rebuild */ }
  }
  const target = sidecarFile(uid, id), temporary = target + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
  const text = JSON.stringify({ version: SIDECAR_VERSION, identity, savedAt: new Date().toISOString(), deleted: Boolean(project.deletedAt), entries });
  try { fs.writeFileSync(temporary, text, { flag: 'wx', mode: 0o600 }); fs.renameSync(temporary, target); } finally { try { fs.unlinkSync(temporary); } catch {} }
}
/** A registered projection of a stored project: from its sidecar, else rebuilt
 * once. A project that cannot be read is listed as unreadable, not thrown. */
function sidecarProjection(uid, id, cacheKey, projector, target, stat) {
  const identity = fileIdentity(target, stat), record = readSidecar(uid, id);
  if (record?.version === SIDECAR_VERSION && record.identity === identity && record.entries && cacheKey in record.entries) return record.entries[cacheKey];
  let project;
  try { project = get(uid, id, { hydrate: false }); }
  catch { return { id, title: '', status: 'unreadable', unreadable: true, updatedAt: new Date(stat.mtimeMs).toISOString() }; }
  if (!project) return null;
  const value = projector(project);
  try { writeSidecar(uid, id, project, identity, { [cacheKey]: value }); } catch { /* the list still answers */ }
  return value;
}
/** The store answers readiness without reading any project (Fable 2026-10-26):
 * its directory exists and can be read and written. */
export function storeReady() {
  fs.mkdirSync(ROOT, { recursive: true });
  fs.accessSync(ROOT, fs.constants.R_OK | fs.constants.W_OK);
  return true;
}
export function getProjected(uid,id,cacheKey,projector) {
  const compressed=compressedFile(uid,id),target=fs.existsSync(compressed)?compressed:file(uid,id);
  let stat;try{stat=fs.statSync(target);}catch(error){if(error.code==='ENOENT'){invalidateProjections(uid,id);return null;}throw error;}
  const identity=[target,stat.ino,stat.size,stat.mtimeMs,stat.ctimeMs].join(':');
  const key=file(uid,id)+'\0'+cacheKey,cached=projectionCache.get(key);
  if(cached?.identity===identity)return structuredClone(cached.value);
  if(cached){projectionBytes-=cached.bytes;projectionCache.delete(key);}
  let value;
  if(listProjections.has(cacheKey)){value=sidecarProjection(uid,id,cacheKey,listProjections.get(cacheKey),target,stat);if(value===null)return null;}
  else{const project=get(uid,id,{hydrate:false});if(!project)return null;value=projector(project);}
  const bytes=Buffer.byteLength(JSON.stringify(value));
  if(bytes<=PROJECTION_MAX_BYTES){
    while(projectionCache.size>=projectionEntries||projectionBytes+bytes>PROJECTION_MAX_BYTES){const [oldKey,entry]=projectionCache.entries().next().value;projectionBytes-=entry.bytes;projectionCache.delete(oldKey);}
    projectionCache.set(key,{identity,value:structuredClone(value),bytes});projectionBytes+=bytes;
  }
  return value;
}
export function listProjected(uid,cacheKey,projector) {
  if(typeof cacheKey==='function'){projector=cacheKey;cacheKey='legacy-task-summary';}
  let names;try{names=fs.readdirSync(path.join(ROOT,owner(uid)));}catch(error){if(error.code==='ENOENT')return [];throw error;}
  const ids=[...new Set(names.flatMap(name=>name.match(/^([a-f0-9]{32})\.json(?:\.gz)?$/)?.[1]||[]))];
  projectionEntries=Math.max(projectionEntries,Math.ceil(ids.length*1.25));
  return ids.map(id=>getProjected(uid,id,cacheKey,projector)).filter(Boolean).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
}

export function get(uid, id, {hydrate = true} = {}) {
  const compressed = compressedFile(uid, id);
  const target = fs.existsSync(compressed) ? compressed : file(uid, id);
  try {
    const bytes = fs.readFileSync(target);
    const parsed = JSON.parse(target === compressed ? gunzipSync(bytes).toString('utf8') : bytes.toString('utf8'));
    if(!hydrate&&[1,2].includes(parsed?.__pptStorageVersion))return parsed.project;
    return parsed?.__pptStorageVersion === 2 ? reviveStoredMedia(parsed.project, null, uid) : parsed?.__pptStorageVersion === 1 ? reviveStoredMedia(parsed.project, parsed.assets || {}, uid) : parsed;
  }
  catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

export function list(uid, {hydrate = true} = {}) {
  const dir = path.join(ROOT, owner(uid));
  let names;
  try { names = fs.readdirSync(dir); }
  catch (error) { if (error?.code === 'ENOENT') return []; throw error; }
  return [...new Set(names.flatMap(name => {
    const match = name.match(/^([a-f0-9]{32})\.json(?:\.gz)?$/);
    return match ? [match[1]] : [];
  }))].map(id => get(uid, id, {hydrate})).filter(Boolean)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

const libraryQuotaRecord=p=>({id:p.id,updatedAt:p.updatedAt,reserved:countsAgainstLibraryQuota(p)});
registerListProjection('library-quota-record-v1',libraryQuotaRecord);
export function save(project, { touch = true } = {}) {
  // Synchronous check + atomic file replacement serialize reservation changes
  // in the owning service process, including create, retry, resume and restore.
  if(countsAgainstLibraryQuota(project)&&!getProjected(project.uid,project.id,'library-quota-v1',countsAgainstLibraryQuota)){
    const occupied=listProjected(project.uid,'library-quota-record-v1',libraryQuotaRecord).filter(p=>p.id!==project.id&&p.reserved).length;
    if(occupied>=50)throw Object.assign(new Error('PPT library limit is 50 presentations and active reservations; remove a presentation or wait for a task to finish'),{statusCode:409,code:'ppt_library_capacity'});
  }
  invalidateProjections(project.uid,project.id);
  const plain = file(project.uid, project.id);
  const compressed = compressedFile(project.uid, project.id);
  fs.mkdirSync(path.dirname(plain), { recursive: true });
  if (touch) project.updatedAt = new Date().toISOString();
  const reduced = stringifyWithMediaRefs(project.uid, project);
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
  // After the project file is in place: a crash between the two leaves a
  // stale sidecar (rebuilt on the next list), never one without its project.
  try { writeSidecar(project.uid, project.id, project, fileIdentity(target, fs.statSync(target))); }
  catch { fs.rmSync(sidecarFile(project.uid, project.id), { force: true }); }
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
  invalidateProjections(uid,id);
  fs.rmSync(file(uid, id), { force: true });
  fs.rmSync(compressedFile(uid, id), { force: true });
  fs.rmSync(sidecarFile(uid, id), { force: true });
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
    if (ir.schemaVersion !== 1 || ir.parserVersion !== PPTX_IR_VERSION || ir.sha256 !== hash) return null;
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
