// F5 of the capacity/remediation fixture plan: an estimate is advice. A
// planning-time overflow blocks only when measured against the real content
// box (or under the frozen-reference rule, classified as a planning rule);
// an unmeasured estimate is a review note. The first reading estimate can
// never authorize fewer pages than the approved topics.
import assert from 'node:assert/strict';
import { overflowSource, densityAcceptanceWarning, inspectDensityOutline } from './lib/ppt-density-packing.mjs';
import { classifyFailure } from './lib/ppt-failure-trace.mjs';
import * as engine from './lib/ppt-outline-first.mjs';

// Where a planning-time overflow comes from.
assert.equal(overflowSource({ measurementBasis: 'shared_line_estimator', predictedOverflow: 120000, usedHeight: 3, availableHeight: 2 }), 'geometry');
assert.equal(overflowSource({ measurementBasis: 'shared_line_estimator', predictedOverflow: 1, bindingLimit: 'at most 10 frozen source references per page', usedHeight: 1, availableHeight: 2 }), 'reference_count');
assert.equal(overflowSource({ measurementBasis: 'missing_display_plan', predictedOverflow: 1 }), 'unmeasured');
assert.equal(overflowSource({ measurementBasis: 'invalid_content_geometry', predictedOverflow: 1 }), 'unmeasured');

// The issue carries its origin and measurement basis.
const slide = (id, fit) => ({ id, title: id, sourceUnitIds: ['a'], densityFit: { fontSizePt: 14, layoutId: 'summary', ...fit } });
const issues = inspectDensityOutline({ slides: [{ id: 'cover' }, slide('measured', { predictedOverflow: 50000, measurementBasis: 'shared_line_estimator', usedHeight: 3, availableHeight: 2 }), slide('estimate', { predictedOverflow: 1, measurementBasis: 'missing_display_plan' })] }, {}).filter(i => i.code === 'planned_density_overflow');
assert.deepEqual(issues.map(i => [i.pageIndex, i.details.overflowSource, i.details.measurement]), [[1, 'geometry', 'shared_line_estimator'], [2, 'unmeasured', 'missing_display_plan']]);

// Acceptance: measured overflow blocks; an unmeasured estimate is a review note.
const [measured, estimate] = issues.map(densityAcceptanceWarning);
assert.equal(measured.blocking, true); assert.equal(measured.resolution, 'fit_inside_page');
assert.equal(estimate.blocking, undefined, 'an estimate never blocks confirmation'); assert.equal(estimate.requiresReview, true); assert.equal(estimate.resolution, 'measure_after_layout');
assert.equal(densityAcceptanceWarning({ code: 'outline_repeated_claim', details: { pageIndex: 3 } }).resolution, 'review_in_outline');

// Classification follows the origin.
const err = details => Object.assign(new Error('Candidate exceeds measured capacity'), { code: 'planned_density_overflow', details });
assert.equal(classifyFailure(err(issues[0].details)), 'true_overflow');
assert.equal(classifyFailure(err(issues[1].details)), 'unverified_capacity');
assert.equal(classifyFailure(err({ overflowSource: 'reference_count', measurement: 'shared_line_estimator', overflowEMU: 1 })), 'planning', 'the frozen-reference limit is a planning rule, not an overflow verdict');

// The reading estimate never limits the pages: a card outline gets one card per
// topic at least (R1: no page authorization), and the view still says when
// the first estimate was below the topic count.
const cards = Array.from({ length: 10 }, (_, i) => ({ title: 'T' + i, sourceUnitIds: [], optionalSourceUnitIds: [], dependsOn: [] }));
const p = { inputUnderstanding: { recommended: 3, min: 3, max: 3 }, planningContract: { version: 3, phase: 'semantic_ready', logicalCards: cards, pagePreference: null } };
assert.equal(engine.minimumPages(p), 10);
assert.equal(engine.assertPagePreferenceCoversCards, undefined, 'page authorization is gone');
const view = engine.planningView(p);
assert.deepEqual([view.minimumPages, view.readingEstimateBelowTopics], [10, true]);
assert.equal(engine.planningView({ ...p, inputUnderstanding: { recommended: 12, min: 10, max: 14 } }).readingEstimateBelowTopics, false);

console.log('PPT estimate advisory: overflow origin, unmeasured estimates never block, classification, no page authorization: OK');
process.exit(0);
