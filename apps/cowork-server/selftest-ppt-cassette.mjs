// Fixture plan steps 2-3: model-call cassettes.
// A. Recorder, request snapshot, cassette builder and player on synthetic
//    data: failed calls are recorded and rethrown unchanged; order, run and
//    code identity are kept; replay serves by stage and occurrence and
//    reports missing, unused and drifted calls.
// B. Real cassettes (under outputs/ppt-cassettes; they hold source text and
//    model replies, so they stay out of git): the recorded request replayed
//    offline against its start state reaches the recorded outcome with
//    exactly the recorded model calls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createModelRecorder, snapshotRequest, buildCassette, loadCassette, createCassettePlayer, prepareCassetteState, runCassette, eventCounts, repeatFirstAttempt, RECORD_VERSION } from './test/ppt-cassette.mjs';

// Recordings of runs on the outline-first ledger path (capacity allocation,
// materialization, editorial passes). That path was removed on 2026-10-22
// (Gamma-style card outline, R1-R8): every outline-first project now writes
// cards, so these replays have nothing left to serve. They stay on disk as
// history; a new recording of a card run becomes the next baseline.
const RETIRED = {
  run_a6128e0eea80176cb83fa039: '12_ml_quant 7976bd9a: internal reason trimmed (fdb198d9)',
  run_c5dbf940bef72c495b6c0702: '12_ml_quant 7976bd9a: capacity per topic (2b0a1dc8)',
  run_36648dc2318897ebcbe38f1e: 'cd5a2737: editorial allocation completed (e2410d2d)',
  run_6e3a2c96bcac930ad8e56d46: 'cd5a2737: summary conflicts in source order (82b693f9)',
};
// What a cassette must show after an intended code change, by recorded run.
// Without an entry the replay must reproduce the recorded run exactly.
const EXPECTATIONS = {
  // MCP xlsx on Copy-of-Professional-Portfolio, recorded on 167025b2 (2026-11-02):
  // the writer's points were replaced by the sheets' raw rows, 13 pages became 27.
  run_8efd69b7fae1d60cb73b0b9b: {
    change: 'spreadsheet decks keep the writer\'s points; rebuilt rows never add pages',
    check(replay) {
      const slides = replay.project?.outline || [], items = replay.project?.source?.semantic?.inventory?.items || [];
      assert.equal(replay.outcome.status, 'outline_ready', JSON.stringify(replay.outcome));
      assert.ok(slides.length <= 18 && slides.length < 27, `within the standard length (16 content cards), not the recorded 27: ${slides.length}`);
      const titles = slides.slice(1).map(slide => String(slide.title || '').replace(/\s*·\s*\d+\s*\/\s*\d+$/u, ''));
      assert.equal(new Set(titles).size, titles.length, 'no title repeated: ' + titles.join(' | '));
      const heads = items.filter(item => Array.isArray(item.rows)).map(item => (item.rows[0] || []).map(cell => String(cell).trim()).filter(Boolean));
      const rawRow = text => heads.some(head => head.filter(cell => String(text).includes(cell + '：')).length >= 2);
      const raw = slides.flatMap(slide => (slide.keyPoints || []).map(point => point.text)).filter(rawRow);
      assert.deepEqual(raw, [], 'no point is a raw row');
    },
  },
};

const here = path.dirname(fileURLToPath(import.meta.url));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-cassette-'));
const sha = text => crypto.createHash('sha256').update(text).digest('hex');
const uid = 'cassette-test', id = 'c'.repeat(32);

// A1. Recorder: success and failure, in call order, with run and code identity.
const live = path.join(temp, 'live'), responses = path.join(live, 'model-responses');
let clock = 1_700_000_000_000;
const providerError = Object.assign(new Error('Provider timed out for key sk-abcdefghijklmnopqrstuv'), { code: 'timeout', modelStage: 'outline:capacity', diagnostic: { kind: 'timeout', elapsedMs: 120000, receivedChars: 0 } });
const record = createModelRecorder({ dir: responses, identity: { sha: 'abc123', backendDirty: false, codeHash: 'h' }, runIdOf: project => project.currentRunId, now: () => (clock += 5) })(async (_p, prompt, _a, _l, options) => {
  if (options.nodeKey === 'outline:capacity') throw providerError;
  return { echo: options.nodeKey, chars: prompt.length };
});
const project = { id, uid, currentRunId: 'run_' + 'a'.repeat(24) };
assert.deepEqual(await record(project, 'secret prompt one', null, null, { nodeKey: 'outline:logical:0', maxOutputTokens: 4096, jsonSchema: { type: 'object' } }), { echo: 'outline:logical:0', chars: 17 });
await assert.rejects(record(project, 'secret prompt two', null, null, { nodeKey: 'outline:capacity' }), error => error === providerError, 'the original error is rethrown unchanged');
assert.deepEqual(await record({ ...project, currentRunId: 'run_' + 'b'.repeat(24) }, 'p3', null, null, { nodeKey: 'outline:logical:0' }), { echo: 'outline:logical:0', chars: 2 });
const files = fs.readdirSync(responses).sort(), records = files.map(name => JSON.parse(fs.readFileSync(path.join(responses, name), 'utf8')));
assert.equal(records.length, 3, 'a failed call is recorded too');
assert.deepEqual(records.map(r => [r.version, r.seq, r.runSeq, r.outcome]), [[RECORD_VERSION, 1, 1, 'ok'], [RECORD_VERSION, 2, 2, 'error'], [RECORD_VERSION, 3, 1, 'ok']]);
assert.equal(records[0].runId, project.currentRunId); assert.equal(records[2].runId, 'run_' + 'b'.repeat(24));
assert.deepEqual(records[1].commit, { sha: 'abc123', backendDirty: false, codeHash: 'h' });
assert.equal(records[0].promptSha256, sha('secret prompt one')); assert.equal(records[0].options.maxOutputTokens, 4096); assert.ok(records[0].options.schemaSha256);
assert.equal(records[1].error.code, 'timeout'); assert.equal(records[1].error.modelStage, 'outline:capacity'); assert.deepEqual(records[1].error.diagnostic, providerError.diagnostic);
assert.ok(records[1].error.message.includes('[redacted]') && !files.some(name => fs.readFileSync(path.join(responses, name), 'utf8').match(/sk-abc|secret prompt/)), 'no key and no prompt text on disk');
assert.ok(records.every(r => Number.isInteger(r.elapsedMs) && r.startedAt && r.at));
assert.match(files[0], /^\d+-s000001-outline-logical-0\.json$/);

// A2. Request snapshot: kept only when the action started a run.
const stateRoot = path.join(live, 'state'), uidRoot = path.join(stateRoot, 'ppt', uid);
fs.mkdirSync(path.join(uidRoot, 'templates'), { recursive: true });
const media = 'f'.repeat(64);
const before = { project: { id, uid, status: 'failed', template: 'tpl1', currentRunId: 'run_' + 'a'.repeat(24), source: { image: { __pptStoredMediaRef: media } } } };
fs.mkdirSync(path.join(uidRoot, 'assets')); fs.writeFileSync(path.join(uidRoot, 'assets', `${media}.txt`), 'data:image/png;base64,AAAA'); fs.writeFileSync(path.join(uidRoot, 'assets', `${'e'.repeat(64)}.txt`), 'another project');
fs.writeFileSync(path.join(uidRoot, `${id}.json.gz`), zlib.gzipSync(JSON.stringify(before)));
fs.writeFileSync(path.join(uidRoot, '_templates.json'), '[]'); fs.writeFileSync(path.join(uidRoot, 'templates', 'tpl1.bin'), 'template bytes'); fs.writeFileSync(path.join(uidRoot, 'templates', 'other.bin'), 'not this one');
const snapshots = path.join(live, 'request-snapshots'), body = Buffer.from(JSON.stringify({ command: 'expand', contentMode: 'standard' }));
let tick = 0;
snapshotRequest({ dir: snapshots, stateRoot, uid, projectId: id, action: 'planning', body, runIdBefore: before.project.currentRunId, now: () => ++tick })({ status: 409, runIdAfter: before.project.currentRunId });
assert.equal(fs.existsSync(snapshots) ? fs.readdirSync(snapshots).length : 0, 0, 'a request that started no run leaves no snapshot');
const runId = 'run_' + 'c'.repeat(24);
snapshotRequest({ dir: snapshots, stateRoot, uid, projectId: id, action: 'planning', body, runIdBefore: before.project.currentRunId, now: () => ++tick })({ status: 202, runIdAfter: runId });
const [snapshotName] = fs.readdirSync(snapshots), requestDir = path.join(snapshots, snapshotName);
const saved = JSON.parse(fs.readFileSync(path.join(requestDir, 'request.json'), 'utf8'));
assert.deepEqual([saved.action, saved.status, saved.runIdBefore, saved.runIdAfter, JSON.parse(saved.body).command], ['planning', 202, before.project.currentRunId, runId, 'expand']);
assert.deepEqual(JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(requestDir, 'project.json.gz')))), before, 'the stored project as it was before the request');

// A3. Builder: the run's calls in seq order, the outcome and events, the template files.
const recordRun = createModelRecorder({ dir: responses, identity: { sha: 'def456' }, runIdOf: p => p.currentRunId });
const runProject = { id, uid, currentRunId: runId };
await recordRun(async () => ({ cards: 1 }))(runProject, 'q1', null, null, { nodeKey: 'outline:logical:0' });
await recordRun(async () => { throw Object.assign(new Error('bad reply'), { code: 'invalid_json' }); })(runProject, 'q2', null, null, { nodeKey: 'outline:capacity' }).catch(() => {});
await recordRun(async () => ({ pages: 3 }))(runProject, 'q3', null, null, { nodeKey: 'outline:capacity:contract' });
const after = { project: { ...before.project, currentRunId: runId, status: 'failed', pages: 3, failure: { code: 'coverage_invalid', origin: 'model_contract', trace: { class: 'planning', step: 'outline:editorial-local:selection', sourceUnitIds: ['b_1'], governor: { stopped: 'oscillation' } } } } };
fs.writeFileSync(path.join(uidRoot, `${id}.json.gz`), zlib.gzipSync(JSON.stringify(after)));
const runs = path.join(uidRoot, 'projects', id, 'runs'); fs.mkdirSync(runs, { recursive: true });
fs.writeFileSync(path.join(runs, `${runId}.events.jsonl`), ['run.started', 'node.running', 'node.failed', 'run.failed'].map(type => JSON.stringify({ type })).join('\n') + '\n');
const out = path.join(temp, 'cassette');
const built = buildCassette({ live, requestDir, out }), loaded = loadCassette(out);
assert.deepEqual(loaded, JSON.parse(JSON.stringify(built)));
assert.deepEqual(built.calls.map(c => [c.stage, c.outcome]), [['outline:logical:0', 'ok'], ['outline:capacity', 'error'], ['outline:capacity:contract', 'ok']], 'only this run, in call order, failures included');
assert.deepEqual(built.request, { command: 'expand', contentMode: 'standard' });
assert.deepEqual(built.outcome, { status: 'failed', pages: 3, failure: { code: 'coverage_invalid', origin: 'model_contract', step: 'outline:editorial-local:selection', class: 'planning', sourceUnitIds: ['b_1'], stopped: 'oscillation' } });
assert.deepEqual(Object.keys(built.files).sort(), ['_templates.json', path.join('assets', `${media}.txt`), path.join('templates', 'tpl1.bin')], 'the template and only the media blobs the snapshot references');
assert.equal(built.commit.sha, 'def456');
assert.deepEqual(built.events, ['run.started', 'node.running', 'node.failed', 'run.failed']);
const prepared = path.join(temp, 'prepared');
prepareCassetteState(out, built, prepared);
assert.deepEqual(JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(prepared, 'ppt', uid, `${id}.json.gz`)))), before, 'replay starts from the snapshot, not the end state');
assert.equal(fs.readFileSync(path.join(prepared, 'ppt', uid, 'assets', `${media}.txt`), 'utf8'), 'data:image/png;base64,AAAA');
fs.writeFileSync(path.join(out, 'state', 'templates', 'tpl1.bin'), 'edited');
assert.throws(() => prepareCassetteState(out, built, path.join(temp, 'prepared2')), /Cassette file changed/);

// A4. Player: stage + occurrence, recorded errors, missing / unused / drift.
const player = createCassettePlayer([
  { stage: 's', promptSha256: sha('p'), outcome: 'ok', result: { n: 1 } },
  { stage: 's', promptSha256: sha('p'), outcome: 'ok', result: { n: 2 } },
  { stage: 't', outcome: 'error', error: { code: 'timeout', message: 'timed out', modelStage: 't', diagnostic: { kind: 'timeout' } } },
  { stage: 'u', outcome: 'ok', result: {} },
]);
assert.deepEqual(await player.modelCall({}, 'p', null, null, { nodeKey: 's' }), { n: 1 });
assert.deepEqual(await player.modelCall({}, 'changed', null, null, { nodeKey: 's' }), { n: 2 });
await assert.rejects(player.modelCall({}, 'p', null, null, { nodeKey: 't' }), error => error.code === 'timeout' && error.modelStage === 't' && error.diagnostic.kind === 'timeout');
await assert.rejects(player.modelCall({}, 'p', null, null, { nodeKey: 'v' }), error => error.code === 'cassette_missing');
assert.deepEqual(player.report(), { served: 3, missing: ['v'], unused: ['u'], drift: ['s'], orderBroken: [] });
// A5. Parallel replies are released in their recorded completion order. Real
// case: on cd5a2737 (run_6e3a2c96) six summary-audit windows ran 3 at a time and
// auditEditorialSummaries collects conflicts in completion order, so serving
// them in start order changed the next summary-repair prompt.
const at = second => `2026-10-22T11:00:0${second}.000Z`;
const windows = () => createCassettePlayer([
  { seq: 1, stage: 'w:0', at: at(3), outcome: 'ok', result: 'w0' },
  { seq: 2, stage: 'w:1', at: at(1), outcome: 'ok', result: 'w1' },
  { seq: 3, stage: 'w:2', at: at(2), outcome: 'ok', result: 'w2' },
]);
const finished = [], all = windows();
await Promise.all([0, 1, 2].map(async i => { finished.push(await all.modelCall({}, '', null, null, { nodeKey: 'w:' + i })); }));
assert.deepEqual(finished, ['w1', 'w2', 'w0'], 'all started together: completion order');
const pooled = [], bounded = windows();
let cursor = 0;
await Promise.all([0, 1].map(async () => { while (cursor < 3) { const i = cursor++; pooled.push(await bounded.modelCall({}, '', null, null, { nodeKey: 'w:' + i })); } }));
assert.deepEqual(pooled, ['w1', 'w2', 'w0'], 'two at a time: w2 starts after w1 finishes and still precedes w0');
assert.deepEqual(bounded.report().orderBroken, []);
const stuck = createCassettePlayer([
  { seq: 1, stage: 'never', at: at(1), outcome: 'ok', result: 1 },
  { seq: 2, stage: 'later', at: at(2), outcome: 'ok', result: 2 },
], { idleMs: 300, tickMs: 50 });
assert.equal(await stuck.modelCall({}, '', null, null, { nodeKey: 'later' }), 2, 'a call the replay never makes does not hold the others forever');
assert.equal(await stuck.modelCall({}, '', null, null, { nodeKey: 'never' }), 1, 'a skipped call is served when it comes');
assert.deepEqual(stuck.report().orderBroken, ['later']);

// A7. Stage keys that embed the planning request's random revision.
const revised = createCassettePlayer([{ seq: 1, stage: 'outline:capacity:aaaa', outcome: 'ok', result: { pages: 3 } }, { seq: 2, stage: 'outline:capacity:aaaa:contract', outcome: 'ok', result: { pages: 4 } }], { aliases: () => [['bbbb', 'aaaa']] });
assert.deepEqual(await revised.modelCall({}, '', null, null, { nodeKey: 'outline:capacity:bbbb' }), { pages: 3 });
assert.deepEqual(await revised.modelCall({}, '', null, null, { nodeKey: 'outline:capacity:bbbb:contract' }), { pages: 4 });
assert.deepEqual(revised.report().missing, []);
// A6. A correction retry the recording lacks: the model repeats its first reply.
const recordedBatch = [{ seq: 1, stage: 'outline:editorial-selection:0:8:0', outcome: 'ok', result: { version: 2, selection: ['first'] } }];
const repeating = createCassettePlayer(recordedBatch, { substitute: repeatFirstAttempt });
assert.deepEqual(await repeating.modelCall({}, '', null, null, { nodeKey: 'outline:editorial-selection:0:8:0' }), { version: 2, selection: ['first'] });
assert.deepEqual(await repeating.modelCall({}, '', null, null, { nodeKey: 'outline:editorial-selection:0:8:1' }), { version: 2, selection: ['first'] });
await assert.rejects(repeating.modelCall({}, '', null, null, { nodeKey: 'outline:editorial-coverage-audit:0:abc' }), error => error.code === 'cassette_missing', 'only correction retries are substituted');
assert.deepEqual(repeating.report().substituted, ['outline:editorial-selection:0:8:1']);
assert.equal(repeatFirstAttempt('outline:editorial-selection:0:8:0', recordedBatch), null, 'a first attempt is never a stand-in');

fs.rmSync(temp, { recursive: true, force: true });
console.log('PASS cassette recorder, request snapshot, builder and player (completion order, correction stand-ins)');

// B. Every real cassette under outputs/ppt-cassettes (or PPT_CASSETTE_DIR).
const cassetteRoot = path.join(here, '../../outputs/ppt-cassettes');
const reals = (process.env.PPT_CASSETTE_DIR ? [process.env.PPT_CASSETTE_DIR] : fs.existsSync(cassetteRoot) ? fs.readdirSync(cassetteRoot).map(name => path.join(cassetteRoot, name)).sort() : [])
  .filter(dir => fs.existsSync(path.join(dir, 'cassette.json.gz')));
if (!reals.length) console.log(`SKIP real cassette replay: none at ${process.env.PPT_CASSETTE_DIR || cassetteRoot} (cassettes hold source text; they stay under outputs/)`);
// ppt-store reads COWORK_STATE_DIR once at import: one state root, so one cassette, per process.
if (reals.length > 1) {
  for (const real of reals) {
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { env: { ...process.env, PPT_CASSETTE_DIR: real }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
    process.stdout.write(child.stdout.split('\n').filter(line => !line.startsWith('PASS cassette recorder')).join('\n'));
    assert.equal(child.status, 0, `cassette ${path.basename(real)} failed`);
  }
  process.exit(0);
}
let imported;
for (const real of reals) {
  const runId = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(real, 'cassette.json.gz')))).runId;
  if (RETIRED[runId]) { console.log(`RETIRED cassette ${path.basename(real)}: ledger outline path removed (${RETIRED[runId]})`); continue; }
  const cassette = loadCassette(real), state = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-cassette-replay-'));
  prepareCassetteState(real, cassette, state);
  process.env.COWORK_STATE_DIR = state;
  imported = { api: await import('./lib/ppt-api.mjs'), store: await import('./lib/ppt-store.mjs') };
  const replay = await runCassette({ cassette, ...imported, substitute: EXPECTATIONS[cassette.runId]?.substitute, trace: process.env.PPT_CASSETTE_TRACE ? line => console.error(line) : null });
  console.log(JSON.stringify({ cassette: path.basename(real), runId: cassette.runId, recordedCalls: cassette.calls.length, ...replay.report, elapsedMs: replay.elapsedMs, outcome: replay.outcome }));
  assert.equal(replay.response?.status, 202, JSON.stringify(replay.response));
  const expected = EXPECTATIONS[cassette.runId];
  if (expected) {
    expected.check(replay, cassette);
    fs.rmSync(state, { recursive: true, force: true });
    console.log(`PASS real cassette ${path.basename(real)} after "${expected.change}": ${replay.report.served} recorded calls replayed, the recorded ${cassette.outcome.failure?.code} is gone; the run now ends at ${replay.outcome.failure?.step || replay.outcome.status} (${replay.outcome.failure?.code || ''}) in ${replay.elapsedMs} ms`);
    continue;
  }
  assert.deepEqual(replay.report.missing, [], 'the code makes no model call the recording lacks');
  assert.deepEqual(replay.report.unused, [], 'every recorded call is made again');
  assert.deepEqual(replay.outcome, cassette.outcome, 'the recorded outcome is reached offline');
  assert.deepEqual(eventCounts(replay.events), eventCounts(cassette.events), 'the same run events');
  fs.rmSync(state, { recursive: true, force: true });
  console.log(`PASS real cassette ${path.basename(real)}: ${cassette.calls.length} recorded calls replayed offline in ${replay.elapsedMs} ms to ${cassette.outcome.failure?.code || cassette.outcome.status}`);
}
process.exit(0);
