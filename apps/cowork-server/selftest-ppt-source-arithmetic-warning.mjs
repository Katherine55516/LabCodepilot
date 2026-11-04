// An original product/count that does not multiply out ("2×3×3 … (27
// portfolios)") is a source inconsistency, not lost content (Fable,
// 2026-10-23): an advisory warning that never gates generation. On a card deck
// it blocks publication only where a card shows the contradiction (the count
// with the product), until the author edits the point or keeps the original;
// older decks keep their gate. Lost content (an undecodable image) still
// blocks. The source text is never rewritten.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-arith-'));
process.env.COWORK_STATE_DIR = root;
const [{ handlePpt }, store, arithmetic, readiness, { inspectObjectIntegrity }, { isBlocking, tierCardDeckIssues }] = await Promise.all([import('./lib/ppt-api.mjs'), import('./lib/ppt-store.mjs'), import('./lib/ppt-source-arithmetic.mjs'), import('./lib/ppt-source-readiness.mjs'), import('./lib/ppt-object-integrity.mjs'), import('./lib/ppt-gate-tiers.mjs')]);

const text = 'Construction uses independent $2\\times3\\times3$ sorts on size, I/A, and ROE (27 portfolios).\n\n构建方法采用三者独立的 $2\\times3\\times3$ 分组（27 个组合）。';
const parsed = { kind: 'paste', name: 'paste', sha256: 'arith-hash-1', text, segments: [{ id: '1', text, location: '段落 1' }], images: [], mediaWarnings: [] };

// Pure: one bilingual conflict, advisory, worded from params, idempotent, text unchanged.
const warned = arithmetic.withSourceArithmeticWarnings(parsed);
assert.equal(warned.mediaWarnings.length, 1, 'the same product in two languages is one conflict');
const [warning] = warned.mediaWarnings;
assert.equal(warning.required, false, 'a source inconsistency never gates generation');
assert.equal(warning.cause, 'source_inconsistency');
assert.deepEqual(warning.params, { expression: '2×3×3', calculated: 18, claimed: 27 });
assert.doesNotMatch(warning.message, /\\times/u, 'LaTeX is shown as ×');
assert.equal(arithmetic.withSourceArithmeticWarnings(warned).mediaWarnings.length, 1, 'idempotent');
assert.equal(warned.text, text, 'the original is never rewritten');
assert.equal(arithmetic.withSourceArithmeticWarnings({ ...parsed, text: 'A 2×3×3 sort (18 portfolios).', segments: [{ id: '1', text: 'A 2×3×3 sort (18 portfolios).' }] }).mediaWarnings.length, 0);
assert.ok(isBlocking('source_arithmetic_shown') && !isBlocking('source_arithmetic_conflict'));

// A warning stored as required before (older reads) is not unresolved; an older acknowledgement still counts.
const legacyWarning = { ...warning, required: true, message: '数量不一致：2×3×3 = 18，原文写 27。' };
const legacySource = { ...warned, mediaWarnings: [legacyWarning] };
assert.equal(readiness.unresolvedSourceWarnings({ source: legacySource }).length, 0);
assert.equal(readiness.sourceWarningKey(legacyWarning), readiness.sourceWarningKey(warning), 'the key ignores the worded message');
const oldAck = { source: legacySource, sourceObjectExclusions: [{ objectId: 'source_warning:old-key', kind: 'source_warning', approvedBy: 'user', sourceHash: 'arith-hash-1', reason: 'kept', code: 'source_arithmetic_conflict', location: '段落 1' }] };
assert.equal(readiness.sourceWarningAcknowledged(oldAck, readiness.sourceWarningKey(warning), warning), true, 'an acknowledgement under an older key is honoured');
// Lost content still must be resolved (regression guard).
const decode = { code: 'source_media_decode', required: true, location: 'image 1', message: 'SVG could not be decoded.' };
assert.equal(readiness.unresolvedSourceWarnings({ source: { ...warned, mediaWarnings: [warning, decode] } }).length, 1);

// Through the real handler.
const uid = 'alice';
const deps = { modelCall: async () => { throw Object.assign(new Error('ppt_cancelled'), { code: 'cancelled' }); }, removeContainer: async () => {} };
async function request(method, pathname, data) {
  const req = Readable.from(data === undefined ? [] : [Buffer.from(JSON.stringify(data))]);
  req.method = method;
  let result;
  await handlePpt(req, new URL(`http://test${pathname}`), { uid, deps, activity: () => {}, log: () => {}, send: (status, body) => { result = { status, body }; return true; }, res: { writeHead() {}, on() {} } });
  return result;
}
const now = new Date().toISOString(), policy = { version: 2, detail: 'standard', content: 'overview', selection: 'editorial', archive: 'none', language: { mode: 'source', body: 'both' }, knowledge: 'source_only' };
const items = [{ id: 'u1', type: 'MechanismBlock', text, source_ref: ['1'], chunkRefs: ['c1'] }];
const cardSource = { ...warned, semantic: { inventory: { items, relationships: [] }, chunks: [{ id: 'c1' }] } };
const card = (points, extra = {}) => ({ id: 'page_card', title: 'Construction', focus: 'Construction', section: 'q-factor', cardObjects: [], keyPoints: points, sourceUnitIds: ['u1'], ...extra });
const deck = (points, extra = {}) => ({ uid, title: 'Arithmetic', status: 'outline_ready', stage: 'outline', pages: 2, template: 'light', inputKind: 'paste', generationPolicy: policy, source: cardSource,
  planningContract: { version: 3, flow: 'cards', phase: 'page_plan_ready', logicalCards: [] }, outline: [{ id: 'cover', title: 'q-factor', focus: 'q-factor', keyPoints: [] }, card(points)], deck: null, nodes: {}, revision: 0,
  pageDecision: { finalPageCount: 2, source: 'user', mode: 'explicit', includesCover: true }, tags: [], favorite: false, pinned: false, folderId: null, deletedAt: null, createdAt: now, updatedAt: now, ...extra });
const save = project => { const id = store.newId(); store.save({ id, ...project }); return id; };

// A card deck whose cards do not show the statement: no gate, a review note.
{const id = save(deck([{ text: 'Sorts on size, investment and profitability', sourceUnitIds: ['u1'] }]));
 const project = store.get(uid, id);
 assert.deepEqual(arithmetic.shownArithmeticConflicts(project), []);
 assert.deepEqual(arithmetic.inspectSourceArithmetic(project).map(issue => [issue.code, issue.severity]), [['source_arithmetic_conflict', 'warning']]);
 assert.ok(!inspectObjectIntegrity(project, []).issues.some(issue => issue.code === 'required_source_media_decode'), 'not lost content');
 const generate = await request('POST', `/ppt/projects/${id}/generate`, {});
 assert.notEqual(generate.body?.code, 'source_warnings_unresolved', 'generation is never held for it');
 const view = (await request('GET', `/ppt/projects/${id}?view=live`)).body.project;
 assert.equal(view.sourceMediaWarnings[0].required, false); assert.deepEqual(view.planningContract.sourceNotes, []);}

// A card that shows the count with its product: that page blocks publication until kept.
{const id = save(deck([{ text: 'Independent $2\\times3\\times3$ sorts (27 portfolios) | 独立的 2×3×3 分组（27 个组合）', sourceUnitIds: ['u1'] }]));
 let project = store.get(uid, id);
 const [shown] = arithmetic.shownArithmeticConflicts(project);
 assert.deepEqual([shown.pageIndex, shown.slideId, shown.pointIndex, shown.withExpression], [1, 'page_card', 0, true]);
 const [issue] = arithmetic.inspectSourceArithmetic(project);
 assert.deepEqual([issue.code, issue.severity, issue.slideId], ['source_arithmetic_shown', 'error', 'page_card']);
 assert.equal(tierCardDeckIssues([issue])[0].severity, 'error', 'an integrity finding on a card deck');
 const view = (await request('GET', `/ppt/projects/${id}?view=live`)).body.project;
 assert.deepEqual(view.planningContract.sourceNotes.map(note => [note.pageId, note.pointIndex, note.withExpression, note.resolved]), [['page_card', 0, true, false]]);
 const kept = await request('POST', `/ppt/projects/${id}/source-warnings?view=live`, { keys: [view.sourceMediaWarnings[0].key], reason: 'User kept the original count statement unchanged' });
 assert.equal(kept.status, 200, JSON.stringify(kept.body)); assert.equal(kept.body.project.sourceMediaWarnings[0].kept, true);
 project = store.get(uid, id);
 assert.deepEqual(arithmetic.inspectSourceArithmetic(project).map(item => [item.code, item.severity]), [['source_arithmetic_conflict', 'warning']], 'a kept original is disclosed, not blocking');
 assert.equal(project.source.text, text);}

// The count alone (no product) is a note on that page.
{const id = save(deck([{ text: 'The q-factor uses 27 portfolios', sourceUnitIds: ['u1'] }]));
 assert.deepEqual(arithmetic.inspectSourceArithmetic(store.get(uid, id)).map(issue => [issue.code, issue.severity, issue.slideId]), [['source_arithmetic_conflict', 'warning', 'page_card']]);}

// Older decks: generation is not held, but publication keeps its gate until kept.
{const legacy = deck([], { planningContract: undefined, outline: ['q-factor', 'Construction', 'Rationale'].map((title, index) => ({ id: 's' + index, title, focus: title, sourceUnitIds: [] })), pages: 3 });
 const id = save({ ...legacy, source: warned });
 assert.equal(arithmetic.inspectSourceArithmetic(store.get(uid, id))[0].severity, 'error');
 assert.notEqual((await request('POST', `/ppt/projects/${id}/generate`, {})).body?.code, 'source_warnings_unresolved');}
console.log('PPT source arithmetic conflict: advisory, never holds generation; a card that shows it blocks until edited or kept; older decks keep their publish gate; lost content still blocks: OK');
process.exit(0);
