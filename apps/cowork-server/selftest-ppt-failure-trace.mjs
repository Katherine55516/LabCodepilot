// F1/F4 of the capacity/remediation fixture plan: every failure is classified
// (true overflow / unverified capacity / false rejection / planning / no
// progress / transport) and traced with its evidence; a repair that returns the
// same failure twice stops instead of spending the remaining passes.
import assert from 'node:assert/strict';
import { classifyFailure, failureTrace, failureSignature, failureSourceIds, recordRepairPass } from './lib/ppt-failure-trace.mjs';
import { tagContractStage } from './lib/ppt-contract-call.mjs';
const err = (code, message, details = {}, extra = {}) => Object.assign(new Error(message), { code, details, ...extra });

// Classes.
const measured = err('capacity_invalid', 'Native frame overflows', { measurement: 'source_component_contract', units: 'emu', bounds: { x: 0, y: 0, width: 8_534_400, height: 2_670_000 }, pageIndex: 3, slideId: 's3', fontSizePt: 14, overflowEMU: 254_000, sourceUnitIds: ['b_0154'] });
assert.equal(classifyFailure(measured), 'true_overflow');
assert.equal(classifyFailure(err('planned_density_overflow', 'Predicted overflow', { pageIndex: 2, overflowEMU: 100 })), 'unverified_capacity', 'a planning-time prediction is not a typesetting verdict');
assert.equal(classifyFailure(err('capacity_invalid', 'Capacity', { measurement: 'estimated' })), 'unverified_capacity');
assert.equal(classifyFailure(err('planning_metadata_invalid', 'Invalid public allocation reason', { field: 'allocation reason' })), 'false_rejection');
assert.equal(classifyFailure(err('planning_contract_invalid', 'Page 11 owns no source units', { pageIndex: 10 })), 'planning');
assert.equal(classifyFailure(err('coverage_invalid', 'ppt_content_selection_invalid: Complete-source review found omitted core topics', { editorialCoverageConflicts: [{ missingSourceUnitIds: ['b_0201', 'b_0202'] }] })), 'planning');
assert.equal(classifyFailure(err('timeout', 'Model request timed out')), 'transport');
assert.equal(classifyFailure(err('coverage_invalid', 'same', {}, { noProgress: true })), 'remediation_no_progress');

// Trace fields come from the failure's own evidence.
const trace = failureTrace({ stage: 'outline', error: measured, project: { template: 'tpl', templateFidelity: { mode: 'preserve' } }, repairs: [{ pass: 0, kind: 'summary', outcome: 'progress', code: 'coverage_invalid' }] });
assert.deepEqual({ cls: trace.class, page: trace.pageIndex, slide: trace.slideId, width: trace.available.widthPt, height: trace.available.heightPt, font: trace.font.sizePt, overflow: trace.height.overflowPt, measurement: trace.measurement, ids: trace.sourceUnitIds, mode: trace.template.mode },
  { cls: 'true_overflow', page: 3, slide: 's3', width: 672, height: 210.2, font: 14, overflow: 20, measurement: 'source_component_contract', ids: ['b_0154'], mode: 'preserve' });
assert.deepEqual(trace.repairs, [{ pass: 0, kind: 'summary', outcome: 'progress', code: 'coverage_invalid' }]);
assert.ok(!('available' in failureTrace({ stage: 'input', error: err('timeout', 'x') })), 'no empty evidence fields');
assert.deepEqual(failureSourceIds({ editorialCoverageConflicts: [{ missingSourceUnitIds: ['b_0201', 'b_0202'] }], invalid: ['b_0010'] }), ['b_0010', 'b_0201', 'b_0202']);

// Signatures: same code + sources + page ⇒ same failure, regardless of digits in the wording.
const a = err('coverage_invalid', 'Review found 2 omitted topics', { sourceUnitIds: ['b_0202', 'b_0201'] });
assert.equal(failureSignature(a), failureSignature(err('coverage_invalid', 'Review found 3 omitted topics', { sourceUnitIds: ['b_0201', 'b_0202'] })));
assert.notEqual(failureSignature(a), failureSignature(err('coverage_invalid', 'Review found 2 omitted topics', { sourceUnitIds: ['b_0141'] })));

// No-progress: one retry of the same kind is allowed; the second identical failure stops.
let log = [];
assert.deepEqual(recordRepairPass(log, { pass: 0, kind: 'selection', before: a, after: a }), { stop: false, noProgress: false });
assert.deepEqual(recordRepairPass(log, { pass: 1, kind: 'selection', before: a, after: a }), { stop: true, noProgress: true });
assert.deepEqual(log.map(e => e.outcome), ['same_failure', 'same_failure']);
log = [];
const other = err('coverage_invalid', 'x', { sourceUnitIds: ['b_0141'] });
assert.equal(recordRepairPass(log, { pass: 0, kind: 'selection', before: a, after: a }).stop, false);
assert.equal(recordRepairPass(log, { pass: 1, kind: 'summary', before: a, after: a }).stop, false, 'a different repair kind is a new strategy');
assert.equal(recordRepairPass(log, { pass: 2, kind: 'summary', before: a, after: other }).stop, false, 'a changed failure is progress');
assert.deepEqual(recordRepairPass(log, { pass: 3, kind: 'summary', before: other, after: null }), { stop: true, noProgress: false });
assert.deepEqual(recordRepairPass([], { pass: 0, kind: 'selection', before: a, unchanged: true }), { stop: true, noProgress: true }, 'an identical repaired outline is no progress');

// The failed planning step. Real case: the cd5a2737 re-plan on 2026-10-22 failed in
// the scoped editorial repair (coverage_invalid, b_0117/b_0119/b_0120/b_0214/b_0212)
// and its record named only "outline": no step, and an empty diagnostic.
const scoped = err('coverage_invalid', 'ppt_content_selection_invalid: Selected topics lose an indispensable explanation relation/condition.', { sourceUnitIds: ['b_0117', 'b_0119', 'b_0120', 'b_0214', 'b_0212'] }, { outlineContract: true });
assert.equal(tagContractStage(scoped, 'outline:editorial-local:selection'), scoped);
assert.equal(scoped.contractStage, 'outline:editorial-local:selection');
tagContractStage(scoped, 'outline:assess');
assert.equal(scoped.contractStage, 'outline:editorial-local:selection', 'the innermost, more specific step wins');
const transport = err('timeout', 'Provider timed out', {}, { modelStage: 'outline:editorial-capacity:2' });
tagContractStage(transport, 'outline:editorial-local:selection');
assert.equal(transport.contractStage, undefined, 'a transport failure keeps its own model stage');
assert.equal(tagContractStage(scoped, undefined), scoped); assert.equal(tagContractStage(null, 'x'), null);
const tagged = failureTrace({ stage: 'outline', error: { ...scoped, message: scoped.message, afterStep: 'outline:editorial-local:selection:0:table-original-cells:0' } });
assert.equal(tagged.step, 'outline:editorial-local:selection');
assert.equal(tagged.afterStep, undefined, 'a named step needs no last-call context');
const untagged = failureTrace({ stage: 'outline', error: { code: 'semantic_page_empty', message: 'Page 8 owns no source units', details: { pageIndex: 7 }, afterStep: 'outline:selection:3' } });
assert.equal(untagged.step, undefined); assert.equal(untagged.afterStep, 'outline:selection:3', 'without a named step the last model call is kept as context');

console.log('PPT failure trace: classes, evidence fields, stable signatures and no-progress stopping: OK');
process.exit(0);
