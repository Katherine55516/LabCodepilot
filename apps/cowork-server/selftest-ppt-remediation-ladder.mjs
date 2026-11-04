// F3 of the capacity/remediation fixture plan: one ordered ladder of fixes for
// a page that does not fit (relayout -> shrink to the readable floor ->
// continuation pages within the authorization -> compression only when
// editorial selection allows, keeping numbers/units/years/citations -> a
// template switch only as a suggestion), with a positive and a negative case
// for every rung.
import assert from 'node:assert/strict';
import { LADDER, nextRemediation, readableFloorPt, mustKeepTokens, assertRemediationStep } from './lib/ppt-remediation-ladder.mjs';
import { failureTrace } from './lib/ppt-failure-trace.mjs';
const page = (id, ids, text = 'Body') => ({ id, sourceUnitIds: ids, nodes: [{ type: 'text', content: { text } }] });
const deck = [page('cover', []), page('p1', ['a', 'b'], 'Momentum works only after costs.')];
const overview = { generationPolicy: { version: 2, content: 'overview', selection: 'editorial' } };
const fullSource = { generationPolicy: { version: 2, content: 'full_source' } };
const rejects = (rung, args, pattern) => assert.throws(() => assertRemediationStep(rung, args), error => error.code === 'remediation_invalid' && pattern.test(error.message));

// Order.
assert.deepEqual(LADDER, ['relayout', 'shrink', 'continue', 'compress', 'suggest_template']);
const base = { layoutId: 'summary', fontSizePt: 18, pages: 10, pagesAuthorized: 12, continuations: 0, editorialSelection: true };
assert.equal(nextRemediation(base).rung, 'relayout');
assert.equal(nextRemediation({ ...base, tried: ['relayout'] }).rung, 'shrink');
assert.equal(nextRemediation({ ...base, tried: ['relayout'], fontSizePt: 17 }).rung, 'continue', 'at the readable floor the next fix is a new page, not smaller type');
assert.equal(nextRemediation({ ...base, tried: ['relayout', 'shrink', 'continue'] }).rung, 'compress');
assert.equal(nextRemediation({ ...base, tried: ['relayout'], fontSizePt: 17, pages: 12 }).rung, 'compress', 'no continuation beyond the authorized pages');
assert.equal(nextRemediation({ ...base, tried: ['relayout'], fontSizePt: 17, continuations: 2 }).rung, 'compress', 'at most two automatic continuations');
const last = nextRemediation({ ...base, tried: ['relayout'], fontSizePt: 17, pages: 12, editorialSelection: false });
assert.deepEqual([last.rung, last.automatic], ['suggest_template', false], 'full-source content ends at a suggestion, never an automatic template switch');
assert.equal(nextRemediation({ ...base, native: true, nativeBaselinePt: 14, fontSizePt: 14, tried: ['relayout'] }).rung, 'continue', 'a native template keeps its own type size');

// Floors.
assert.equal(readableFloorPt({ layoutId: 'summary' }), 17);
assert.equal(readableFloorPt({ layoutId: 'table' }), 13);
assert.equal(readableFloorPt({ layoutId: 'summary', native: true, nativeBaselinePt: 14 }), 14);

// Rung 1: relayout keeps size and wording.
assert.ok(assertRemediationStep('relayout', { before: deck, after: structuredClone(deck), fontBefore: 18, fontAfter: 18 }));
rejects('relayout', { before: deck, after: deck, fontBefore: 18, fontAfter: 16 }, /keeps the type size/);
rejects('relayout', { before: deck, after: [deck[0], page('p1', ['a', 'b'], 'Momentum works.')], fontBefore: 18, fontAfter: 18 }, /keeps the wording/);
rejects('relayout', { before: deck, after: [deck[0], page('p1', ['a'])] }, /may not add or remove source content/);

// Rung 2: shrink stays above the floor and keeps wording.
assert.ok(assertRemediationStep('shrink', { before: deck, after: structuredClone(deck), fontBefore: 18, fontAfter: 17, floorPt: 17 }));
rejects('shrink', { before: deck, after: structuredClone(deck), fontBefore: 18, fontAfter: 15, floorPt: 17 }, /readable floor \(17pt\); continue on a new page/);
rejects('shrink', { before: deck, after: structuredClone(deck), fontBefore: 18, fontAfter: 18, floorPt: 17 }, /must reduce/);

// Rung 3: continuation adds pages within the authorization, same content.
const split = [deck[0], page('p1', ['a']), page('p1b', ['b'])];
assert.ok(assertRemediationStep('continue', { before: deck, after: split, pagesAuthorized: 12 }));
rejects('continue', { before: deck, after: split, pagesAuthorized: 2 }, /exceeds the authorized 2 pages/);
rejects('continue', { before: deck, after: [deck[0], page('p1', ['a']), page('p1b', [])], pagesAuthorized: 12 }, /may not add or remove source content/);

// Rung 4: compression only under editorial selection, keeping hard facts.
const source = 'Fama and French (1993) report a 4.2% premium after 30 bps costs over 1963-2020 [12].';
assert.deepEqual(mustKeepTokens(source), ['Fama and French (1993)', '4.2%', '30 bps', '1963', '2020', '[12]']);
assert.ok(assertRemediationStep('compress', { project: overview, sourceText: source, summaryText: 'Fama and French (1993): 4.2% premium net of 30 bps, 1963–2020 [12].' }));
rejects('compress', { project: overview, sourceText: source, summaryText: 'Fama and French report a premium after costs.' }, /dropped numbers, units, years or citations: Fama and French \(1993\), 4\.2%/);
rejects('compress', { project: fullSource, sourceText: source, summaryText: source }, /requires an editorial selection policy/);

// Rung 5: a template switch never changes the deck automatically.
assert.ok(assertRemediationStep('suggest_template', { before: deck, after: structuredClone(deck) }));
rejects('suggest_template', { before: deck, after: split }, /only suggested/);

// The failure trace recommends the next rung for capacity failures.
const measured = Object.assign(new Error('Native frame overflows'), { code: 'capacity_invalid', details: { measurement: 'source_component_contract', overflowEMU: 254000, fontSizePt: 14, layoutId: 'summary', pageIndex: 4 } });
const native = failureTrace({ stage: 'generation', error: measured, project: { ...overview, templateFidelity: { mode: 'preserve' }, outline: Array(10).fill({}), planningContract: { pagePreference: { mode: 'adaptive', max: 16 } } } });
assert.deepEqual([native.class, native.nextRemedy.rung, native.nextRemedy.automatic], ['true_overflow', 'relayout', true]);
assert.equal(failureTrace({ stage: 'outline', error: Object.assign(new Error('Page 3 owns no source units'), { code: 'planning_contract_invalid' }) }).nextRemedy, undefined, 'planning failures get no capacity remedy');

// Keep-facts stays advisory (decision 2026-10-21): recorded in the failure
// trace, never a gate. The failure's own class is unchanged.
const candidate = { generationPolicy: overview.generationPolicy, source: { semantic: { inventory: { items: [{ id: 'u1', text: source }, { id: 'u2', text: 'Momentum earns 0.8% per month [3].' }] } } },
  candidateOutline: { executionPlan: { selection: [{ sourceUnitId: 'u1', destination: 'summary', summaryText: 'Fama and French (1993) report a premium after costs.' }, { sourceUnitId: 'u2', destination: 'summary', summaryText: 'Momentum earns 0.8% per month [3].' }, { sourceUnitId: 'u1', destination: 'slides' }] } } };
const advised = failureTrace({ stage: 'outline', error: Object.assign(new Error('Summaries changed meaning'), { code: 'coverage_invalid' }), project: candidate });
assert.equal(advised.class, 'planning');
assert.deepEqual(advised.advisories, { keepFacts: [{ sourceUnitId: 'u1', missing: ['4.2%', '30 bps', '1963', '2020', '[12]'] }] });
assert.equal(failureTrace({ stage: 'outline', error: new Error('x'), project: { ...candidate, candidateOutline: { executionPlan: { selection: [candidate.candidateOutline.executionPlan.selection[1]] } } } }).advisories, undefined, 'nothing dropped, nothing recorded');

console.log('PPT remediation ladder: order, readable floors, positive and negative case per rung, trace recommendation: OK');
process.exit(0);
