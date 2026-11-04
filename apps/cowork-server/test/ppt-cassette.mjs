/** Model-call cassettes for PPT runs (fixture plan, steps 2-3).
 *
 * Recording (lab service only, scripts/ppt/manual-test-service.mjs):
 * - every model call, success or failure, with its order (seq, runSeq), run,
 *   code identity (commit, backend dirty flag, loaded-code hash), timing, the
 *   prompt hash (never the prompt) and the reply or the error;
 * - for each POST to a project action, the stored project and the request
 *   body as they were before the request. A run rewrites the audit caches and
 *   selection marks it starts from, so its start state exists only here.
 *
 * A cassette joins one request snapshot with the calls of the run it started.
 * Replay sends the same request against the snapshot in a temporary state
 * directory and serves the calls by stage key and occurrence. It reports any
 * call the code now makes that the recording lacks (missing), any recorded
 * call it no longer makes (unused) and prompts that changed (drift).
 * Cassettes hold source text and model replies: they stay under outputs/,
 * not in git. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';

export const RECORD_VERSION = 2;
export const CASSETTE_VERSION = 1;
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const redact = text => String(text ?? '').replace(/sk-[A-Za-z0-9_-]{12,}/g, '[redacted]');
const safeName = key => String(key).replace(/[^a-z0-9_-]/gi, '-').slice(0, 120);
const clean = value => Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined && v !== null));
const MAX_DETAILS = 20_000;

/** Code identity of the recording process. */
export function codeIdentity(root, codeHash) {
  const git = args => spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  const head = git(['rev-parse', 'HEAD']);
  const dirty = git(['status', '--porcelain', '--', 'apps/cowork-server/lib', 'src/lib/ppt-desktop-model-worker.ts', 'src/lib/ai-provider.ts']);
  return clean({ sha: head.status === 0 ? head.stdout.trim() : null, backendDirty: dirty.status === 0 ? Boolean(dirty.stdout.trim()) : null, codeHash });
}

/** The replayable fields of a failed call (bounded, keys redacted). */
export function recordedError(error) {
  let details;
  if (error?.details !== undefined) {
    try { const text = JSON.stringify(error.details, (_k, v) => typeof v === 'string' ? redact(v).slice(0, 2000) : v); details = text.length <= MAX_DETAILS ? JSON.parse(text) : { truncated: true, characters: text.length }; } catch { details = { unserializable: true }; }
  }
  return clean({ name: error?.name, code: error?.code, message: redact(error?.message ?? error).slice(0, 1000), origin: error?.origin, modelStage: error?.modelStage, contractStage: error?.contractStage, diagnostic: error?.diagnostic, details });
}

/** The error a replayed failed call throws. */
export function replayedError(record) {
  return Object.assign(new Error(record.message), clean({ name: record.name, code: record.code, origin: record.origin, modelStage: record.modelStage, contractStage: record.contractStage, diagnostic: record.diagnostic, details: record.details }));
}

/** Wraps a modelCall(project, prompt, activity, log, options): writes one
 * record per call and returns or rethrows exactly what the call did. */
export function createModelRecorder({ dir, identity = {}, runIdOf = project => project?.currentRunId, now = Date.now }) {
  let seq = 0;
  const runSeqs = new Map();
  return modelCall => async (...args) => {
    const [project, prompt, , , options = {}] = args;
    const stage = options?.nodeKey || project?.stage || 'unknown';
    let runId = null;
    try { runId = runIdOf(project) || null; } catch { /* recording never fails the call */ }
    const callSeq = ++seq, runSeq = runId ? runSeqs.set(runId, (runSeqs.get(runId) || 0) + 1).get(runId) : null;
    const started = now();
    const base = {
      version: RECORD_VERSION, seq: callSeq, runId, runSeq, projectId: project?.id, stage,
      promptSha256: sha256(String(prompt)), promptChars: String(prompt).length,
      options: clean({ maxOutputTokens: options?.maxOutputTokens, timeoutMs: options?.timeoutMs, schemaSha256: options?.jsonSchema ? sha256(JSON.stringify(options.jsonSchema)) : undefined }),
      commit: identity, startedAt: new Date(started).toISOString(),
    };
    const write = record => {
      try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, `${started}-s${String(callSeq).padStart(6, '0')}-${safeName(stage)}.json`), JSON.stringify(record, null, 2)); } catch { /* best effort */ }
    };
    try {
      const result = await modelCall(...args);
      write({ ...base, at: new Date(now()).toISOString(), elapsedMs: now() - started, outcome: 'ok', result });
      return result;
    } catch (error) {
      write({ ...base, at: new Date(now()).toISOString(), elapsedMs: now() - started, outcome: 'error', error: recordedError(error) });
      throw error;
    }
  };
}

/** The stored project file (compressed or plain) of one project. */
export function projectFile(stateRoot, uid, projectId) {
  const base = path.join(stateRoot, 'ppt', uid, `${projectId}.json`);
  return fs.existsSync(base + '.gz') ? base + '.gz' : fs.existsSync(base) ? base : null;
}

/** Before a project action runs: copy the stored project and keep the body.
 * Returns finish({status, runIdAfter}) to complete the snapshot. */
export function snapshotRequest({ dir, stateRoot, uid, projectId, action, body, runIdBefore = null, now = Date.now }) {
  const source = projectFile(stateRoot, uid, projectId);
  if (!source) return () => {};
  const at = now(), folder = path.join(dir, `${at}-${projectId}-${safeName(action)}`);
  fs.mkdirSync(folder, { recursive: true });
  fs.copyFileSync(source, path.join(folder, path.basename(source).endsWith('.gz') ? 'project.json.gz' : 'project.json'));
  const text = body.toString('utf8'), request = { version: 1, at: new Date(at).toISOString(), uid, projectId, action, runIdBefore, ...(text.length <= 1_000_000 ? { body: text } : { bodySha256: sha256(body), bodyBytes: body.length }) };
  fs.writeFileSync(path.join(folder, 'request.json'), JSON.stringify(request, null, 2));
  // Kept only when the action started a run.
  return ({ status, runIdAfter }) => {
    try {
      if (!runIdAfter || runIdAfter === runIdBefore) fs.rmSync(folder, { recursive: true, force: true });
      else fs.writeFileSync(path.join(folder, 'request.json'), JSON.stringify({ ...request, status, runIdAfter }, null, 2));
    } catch { /* best effort */ }
  };
}

/** A body that can be read again (the request stream is read once). */
export function replayableRequest(req, body) {
  const copy = Readable.from([body]);
  copy.method = req.method; copy.headers = req.headers; copy.url = req.url;
  return copy;
}

// ppt-store keeps large media (images, template renders) as content-addressed
// blobs in assets/ and stores {MEDIA_REF: hash} in the project file.
const MEDIA_REF = '__pptStoredMediaRef';
export function mediaRefs(value, refs = new Set()) {
  if (!value || typeof value !== 'object') return refs;
  if (typeof value[MEDIA_REF] === 'string') refs.add(value[MEDIA_REF]);
  for (const child of Object.values(value)) mediaRefs(child, refs);
  return refs;
}
const readProject = file => JSON.parse((file.endsWith('.gz') ? zlib.gunzipSync(fs.readFileSync(file)) : fs.readFileSync(file)).toString('utf8'));
const storedProject = data => data?.project || data;

/** Outcome of a project after a run, as the replay compares it. */
export function runOutcome(project) {
  const failure = project?.failure, trace = failure?.trace;
  return clean({
    status: project?.status, phase: project?.planningContract?.phase, pages: project?.pages,
    failure: failure ? clean({ code: failure.code, origin: failure.origin, step: trace?.step || failure.contractStage || failure.modelStage, class: trace?.class, sourceUnitIds: trace?.sourceUnitIds, pageIndex: trace?.pageIndex, stopped: trace?.governor?.stopped }) : undefined,
  });
}

/** Joins a request snapshot with the calls of the run it started. */
export function buildCassette({ live, requestDir, out }) {
  const request = JSON.parse(fs.readFileSync(path.join(requestDir, 'request.json'), 'utf8'));
  const runId = request.runIdAfter;
  if (!runId || runId === request.runIdBefore) throw Error('The request started no run');
  const stateRoot = path.join(live, 'state'), responses = path.join(live, 'model-responses');
  const calls = fs.readdirSync(responses).filter(name => name.endsWith('.json')).map(name => JSON.parse(fs.readFileSync(path.join(responses, name), 'utf8')))
    .filter(record => record.version === RECORD_VERSION && record.runId === runId).sort((a, b) => a.seq - b.seq);
  const snapshotName = fs.existsSync(path.join(requestDir, 'project.json.gz')) ? 'project.json.gz' : 'project.json';
  const before = storedProject(readProject(path.join(requestDir, snapshotName)));
  const afterFile = projectFile(stateRoot, request.uid, request.projectId), after = afterFile && storedProject(readProject(afterFile));
  if (after?.currentRunId !== runId) throw Error('The project has run again since; its outcome is not this run');
  const runDir = path.join(stateRoot, 'ppt', request.uid, 'projects', request.projectId, 'runs');
  const events = fs.readFileSync(path.join(runDir, `${runId}.events.jsonl`), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line).type);
  fs.mkdirSync(path.join(out, 'state', 'templates'), { recursive: true });
  fs.copyFileSync(path.join(requestDir, snapshotName), path.join(out, snapshotName));
  const uidRoot = path.join(stateRoot, 'ppt', request.uid), files = {};
  const copy = rel => { fs.copyFileSync(path.join(uidRoot, rel), path.join(out, 'state', rel)); files[rel] = sha256(fs.readFileSync(path.join(uidRoot, rel))); };
  if (fs.existsSync(path.join(uidRoot, '_templates.json'))) copy('_templates.json');
  for (const name of fs.readdirSync(path.join(uidRoot, 'templates'))) if (name.startsWith(String(before.template))) copy(path.join('templates', name));
  const refs = [...mediaRefs(before)];
  if (refs.length) fs.mkdirSync(path.join(out, 'state', 'assets'), { recursive: true });
  for (const hash of refs) copy(path.join('assets', `${hash}.txt`));
  const cassette = {
    version: CASSETTE_VERSION, builtAt: new Date().toISOString(),
    projectId: request.projectId, uid: request.uid, action: request.action, request: JSON.parse(request.body || '{}'), runId,
    recordedAt: request.at, commit: calls[0]?.commit || null, project: snapshotName, files,
    // Planning requests get a random revision that some stage keys embed (outline:capacity:<revision>).
    requestRevision: after.planningContract?.requestRevision || null,
    outcome: runOutcome(after), events,
    calls: calls.map(record => clean({ seq: record.seq, runSeq: record.runSeq, stage: record.stage, promptSha256: record.promptSha256, startedAt: record.startedAt, at: record.at, elapsedMs: record.elapsedMs, outcome: record.outcome, result: record.outcome === 'ok' ? record.result : undefined, error: record.error })),
  };
  fs.writeFileSync(path.join(out, 'cassette.json.gz'), zlib.gzipSync(JSON.stringify(cassette)));
  return cassette;
}

export function loadCassette(dir) {
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, 'cassette.json.gz'))).toString('utf8'));
}

/** Serves recorded calls by stage key and occurrence.
 *
 * Parallel calls (audit windows, selection batches) finished live in network
 * order, and some code merges their results in completion order. With
 * completion times recorded, replies are released in that order: a reply
 * waits until every call that finished before it live has been released. A
 * call the replay never makes would hold the others forever; when the event
 * loop has been idle for `idleMs` with replies waiting, the earliest waiting
 * reply is released and named in `orderBroken`. */
export function createCassettePlayer(calls, { ordered = calls.length > 0 && calls.every(call => call.at), idleMs = 5000, tickMs = 250, trace = null, substitute = null, aliases = () => [] } = {}) {
  const started = Date.now();
  const queues = new Map(), served = [], missing = [], drift = [], orderBroken = [], substituted = [];
  for (const call of calls) { if (!queues.has(call.stage)) queues.set(call.stage, []); queues.get(call.stage).push(call); }
  const byCompletion = ordered ? [...calls].sort((a, b) => a.at.localeCompare(b.at) || a.seq - b.seq) : [];
  const rank = new Map(byCompletion.map((call, index) => [call, index]));
  const released = new Set(), parked = new Map();
  let next = 0, lastActivity = Date.now(), timer = null, idleTicks = 0;
  const releaseParked = () => { const resume = parked.get(next); if (!resume) return; parked.delete(next); released.add(next); while (released.has(next)) next++; lastActivity = Date.now(); resume(); setTimeout(releaseParked, 0); };
  const watch = () => {
    if (timer) return;
    let expected = Date.now() + tickMs;
    timer = setInterval(() => {
      const lag = Date.now() - expected; expected = Date.now() + tickMs;
      if (!parked.size) { clearInterval(timer); timer = null; return; }
      idleTicks = lag < 50 ? idleTicks + 1 : 0;
      if (Date.now() - lastActivity < idleMs || idleTicks * tickMs < Math.min(idleMs, 2000)) return;
      const earliest = Math.min(...parked.keys());
      orderBroken.push(byCompletion[earliest].stage);
      for (let r = next; r < earliest; r++) released.add(r);
      while (released.has(next) && next < earliest) next++;
      releaseParked();
    }, tickMs); // not unref'd: a parked reply must keep the process alive; it clears when none is parked
  };
  const modelCall = async (project, prompt, _activity, _log, options = {}) => {
    const stage = aliases().reduce((key, [replayed, recorded]) => key.split(replayed).join(recorded), options?.nodeKey || project?.stage || 'unknown'), call = queues.get(stage)?.shift();
    // A call the code now makes on purpose (e.g. a correction retry a fix adds)
    // may be served a stand-in reply, outside the recorded order.
    const standIn = !call && substitute?.(stage, calls);
    if (standIn) { substituted.push(stage); trace?.(`${((Date.now() - started) / 1000).toFixed(1)}s ${stage} (substituted)`); if (standIn.outcome === 'error') throw replayedError(standIn.error); return structuredClone(standIn.result); }
    if (!call) { missing.push(stage); throw Object.assign(new Error(`Cassette has no recorded call for ${stage}`), { code: 'cassette_missing', modelStage: stage }); }
    served.push(stage); lastActivity = Date.now(); trace?.(`${((Date.now() - started) / 1000).toFixed(1)}s ${stage}`);
    if (call.promptSha256 && sha256(String(prompt)) !== call.promptSha256) drift.push(stage);
    if (ordered) {
      const r = rank.get(call);
      if (r === next) { released.add(r); while (released.has(next)) next++; setTimeout(releaseParked, 0); }
      else if (r > next) await new Promise(resolve => { parked.set(r, resolve); watch(); });
      // r < next: the watchdog already skipped past this call; serve it now.
    }
    if (call.outcome === 'error') throw replayedError(call.error);
    return structuredClone(call.result);
  };
  const report = () => ({ served: served.length, missing: [...missing], unused: [...queues.values()].flat().map(call => call.stage), drift: [...drift], orderBroken: [...orderBroken], ...(substituted.length ? { substituted: [...substituted] } : {}) });
  return { modelCall, report };
}

/** Lays a cassette's start state out under a state root. */
export function prepareCassetteState(dir, cassette, stateRoot) {
  const uidRoot = path.join(stateRoot, 'ppt', cassette.uid);
  for (const sub of ['templates', 'assets']) fs.mkdirSync(path.join(uidRoot, sub), { recursive: true });
  for (const [rel, hash] of Object.entries(cassette.files)) {
    const bytes = fs.readFileSync(path.join(dir, 'state', rel));
    if (sha256(bytes) !== hash) throw Error(`Cassette file changed: ${rel}`);
    fs.writeFileSync(path.join(uidRoot, rel), bytes);
  }
  fs.copyFileSync(path.join(dir, cassette.project), path.join(uidRoot, `${cassette.projectId}${cassette.project.endsWith('.gz') ? '.json.gz' : '.json'}`));
}

/** Sends the recorded request through handlePpt with the cassette as the
 * model and waits until the run settles. The caller sets COWORK_STATE_DIR to
 * the prepared root before importing ppt-api and ppt-store. */
export async function runCassette({ cassette, api, store, timeoutMs = 1_200_000, trace = null, substitute = null }) {
  const { uid, projectId } = cassette;
  // The replayed request gets its own random revision; map it to the recorded one.
  let revision;
  const aliases = () => { if (!cassette.requestRevision) return []; revision ||= store.get(uid, projectId)?.planningContract?.requestRevision; return revision && revision !== cassette.requestRevision ? [[revision, cassette.requestRevision]] : []; };
  const player = createCassettePlayer(cassette.calls, { trace, substitute, aliases });
  let response;
  const req = Readable.from([Buffer.from(JSON.stringify(cassette.request))]); req.method = 'POST';
  await api.handlePpt(req, new URL(`http://local/ppt/projects/${projectId}/${cassette.action}`), {
    uid, deps: { ...api._internals.defaultDeps, modelCall: player.modelCall }, activity: () => {}, log: () => {}, res: {},
    send: (status, body) => { response = { status, error: body?.error }; return true; },
  });
  const started = Date.now();
  let project = store.get(uid, projectId);
  while (['outlining', 'generating'].includes(project?.status) && Date.now() - started < timeoutMs) { await new Promise(resolve => setTimeout(resolve, 25)); project = store.get(uid, projectId); }
  const runDir = path.join(process.env.COWORK_STATE_DIR, 'ppt', uid, 'projects', projectId, 'runs');
  const eventsFile = project?.currentRunId && path.join(runDir, `${project.currentRunId}.events.jsonl`);
  const log = eventsFile && fs.existsSync(eventsFile) ? fs.readFileSync(eventsFile, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
  return { response, project, outcome: runOutcome(project), report: player.report(), events: log.map(event => event.type), eventLog: log.map(({ type, payload }) => ({ type, payload })), elapsedMs: Date.now() - started };
}

/** A stand-in for a correction retry the recording lacks: the model repeats
 * its first reply (the worst case for a correction). */
export function repeatFirstAttempt(stage, calls) {
  const match = /^(outline:editorial-selection:\d+:\d+):([1-9]\d*)$/.exec(stage);
  return match ? calls.find(call => call.stage === `${match[1]}:0`) || null : null;
}

/** Event types with their counts; parallel batches settle in any order. */
export function eventCounts(types) {
  const counts = {};
  for (const type of types) counts[type] = (counts[type] || 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}
