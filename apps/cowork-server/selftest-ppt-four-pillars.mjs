import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { normalizePaste } from './lib/ppt-source.mjs';
import { inspectRelationFidelity } from './lib/ppt-semantic-relations.mjs';
import { normalizePageContract, pageContractFor, inspectPageContracts, PAGE_JOBS } from './lib/ppt-page-contract.mjs';
import { buildMediaLedger, inspectMediaLedger, mediaBucket } from './lib/ppt-media-ledger.mjs';
import { routeIssue, annotateIssue, newHardErrors, themeBound } from './lib/ppt-repair-routing.mjs';
import { inspectSourceNumbers } from './lib/ppt-source-numbers.mjs';
import { slidePlan } from './lib/ppt-planning.mjs';
import { OUTLINE_SCHEMA } from './lib/ppt-prompt-contracts.mjs';
import { PPT_PROMPT_CONTRACT_VERSION } from './lib/ppt-generation-policy.mjs';
import * as quality from './lib/ppt-quality.mjs';
import * as templates from './lib/ppt-template.mjs';
import { _internals as api } from './lib/ppt-api.mjs';

// ---------------------------------------------------------------- A. relations
const source = normalizePaste(['# Factors', '', '## 1. Definition', '',
  '$$', 'r_{i,t} = \\alpha_i + \\beta_i f_t + \\epsilon_{i,t}', '$$', '',
  'where $f_t$ is the factor return and $\\beta_i$ is the loading of stock $i$ on the factor.', '',
  '## 2. Construction', '',
  'The same factor can be expressed several ways: long-short decile portfolios, rank-weighted dollar-neutral portfolios, long-only tilts versus a benchmark, or factor-mimicking portfolios. These are not interchangeable.', '',
  '## 3. Taxonomy', '',
  '| Family | Signals | Controls |', '|---|---|---|', '| Value | B/P, E/P | Industry |', '| Momentum | 12-1 return | Size |', '| Quality | ROE | Leverage |', '',
  '## 4. Workflow', '',
  '1. Define the hypothesis', '2. Build the signal', '3. Test the portfolio', '4. Monitor live', '',
  'A portfolio with 800% turnover needs low costs.', ''].join('\n'));
const inventory = source.semantic.inventory;
const relation = type => inventory.relationships.filter(item => item.type === type);
assert.equal(relation('matrix').length, 1); assert.deepEqual(relation('matrix')[0].axes, ['Family', 'Signals', 'Controls']);
assert.equal(relation('matrix')[0].rowCount, 3); assert.equal(relation('matrix')[0].columnCount, 3);
assert.equal(relation('alternative').length, 1); assert.equal(relation('alternative')[0].members.length, 4); assert.equal(relation('alternative')[0].interchangeable, false);
assert.equal(relation('definition').length, 1); assert.equal(relation('definition')[0].unitIds.length, 2);
assert.equal(relation('order').length, 1); assert.deepEqual(relation('order')[0].members, ['Define the hypothesis', 'Build the signal', 'Test the portfolio', 'Monitor live']);
assert.ok(inventory.relationships.every(item => item.id && item.relation && Array.isArray(item.steps)), 'legacy relation fields kept');

const alt = relation('alternative')[0], order = relation('order')[0], definition = relation('definition')[0];
const textNode = (id, text, extra = {}) => ({ id, type: 'text', content: { text }, ...extra });
const altText = alt.members.join('\n');
const asSteps = { source, outline: [{ id: 's0' }, { id: 's1', sourceUnitIds: alt.unitIds, visualIntent: { type: 'timeline' } }],
  deck: { slides: [{ id: 's0', nodes: [] }, { id: 's1', layoutId: 'timeline', nodes: [textNode('n1', altText)] }] } };
assert.ok(inspectRelationFidelity(asSteps, asSteps.deck.slides).some(issue => issue.code === 'relation_alternative_as_sequence' && issue.severity === 'error'));
const asComparison = { ...asSteps, outline: [{ id: 's0' }, { id: 's1', sourceUnitIds: alt.unitIds, visualIntent: { type: 'comparison' } }],
  deck: { slides: [{ id: 's0', nodes: [] }, { id: 's1', layoutId: 'comparison', nodes: [textNode('n1', altText)] }] } };
assert.ok(!inspectRelationFidelity(asComparison, asComparison.deck.slides).some(issue => issue.code === 'relation_alternative_as_sequence'));
const timeline = items => ({ id: 's2', nodes: [{ id: 't', type: 'timeline', sourceArtifact: { sourceUnitId: order.sourceUnitId }, content: { items: items.map(text => ({ text })) } }] });
const reversed = timeline([...order.members].reverse());
assert.ok(inspectRelationFidelity({ source, outline: [] }, [{ id: 's0', nodes: [] }, reversed]).some(issue => issue.code === 'relation_order_changed'));
assert.ok(!inspectRelationFidelity({ source, outline: [] }, [{ id: 's0', nodes: [] }, timeline(order.members)]).some(issue => issue.code === 'relation_order_changed'));
const split = { source, outline: [{ id: 's0' }, { id: 's1', sourceUnitIds: [definition.unitIds[0]] }, { id: 's2', sourceUnitIds: [definition.unitIds[1]] }] };
assert.ok(inspectRelationFidelity(split, [{ id: 's0', nodes: [] }, { id: 's1', nodes: [] }, { id: 's2', nodes: [] }]).some(issue => issue.code === 'relation_definition_split'));

// ---------------------------------------------------------------- B. page contract
assert.match(OUTLINE_SCHEMA, /pageContract/); assert.ok(PPT_PROMPT_CONTRACT_VERSION >= 10);
const normalized = normalizePageContract({ job: 'definition', requiredUnits: [definition.unitIds[0], 'b_9999'], requiredRelations: [definition.id, 'rel_fake'],
  adjacencyPairs: [{ a: definition.unitIds[0], b: 'b_9999' }], compositionCandidates: ['formula-variables', 'svg-art'] }, source);
assert.deepEqual(normalized.requiredUnits, [definition.unitIds[0]], 'unknown IDs are dropped');
assert.deepEqual(normalized.requiredRelations, [definition.id]); assert.equal(normalized.adjacencyPairs.length, 0); assert.deepEqual(normalized.compositionCandidates, ['formula-variables']);
const formulaSlide = { id: 'f', title: 'Factor model', sourceUnitIds: [definition.unitIds[0]] };
const derived = pageContractFor(formulaSlide, source, 'mechanism');
assert.ok(derived.requiredUnits.includes(definition.unitIds[1]), 'the explanation joins the formula');
assert.deepEqual(derived.adjacencyPairs.map(pair => [pair.a, pair.b]), [[definition.unitIds[0], definition.unitIds[1]]]);
assert.ok(derived.compositionCandidates.includes('formula-variables')); assert.ok(!derived.compositionCandidates.includes('big-number'));
const tableUnit = relation('matrix')[0].sourceUnitId;
const tableContract = pageContractFor({ id: 't', sourceUnitIds: [tableUnit] }, source, 'comparison');
assert.deepEqual(tableContract.comparisonAxes, ['Signals', 'Controls']); assert.ok(tableContract.compositionCandidates.includes('table-notes'));
const numberUnit = inventory.items.find(item => /800%/.test(item.text)).id;
assert.ok(pageContractFor({ id: 'n', sourceUnitIds: [numberUnit] }, source, 'evidence').compositionCandidates.includes('big-number'));
const plan = slidePlan([{ id: 'cover', title: 'Factors' }, { ...formulaSlide, focus: 'Model' }, { id: 'end', title: 'End' }], {}, source);
assert.ok(PAGE_JOBS.includes(plan[1].pageContract.job)); assert.ok(plan[1].pageContract.adjacencyPairs.length); assert.equal(plan[0].pageContract.job, 'cover');
const outline = api.normalizeOutline({ slides: [{ title: 'Cover' }, { title: 'Model', pageContract: { requiredUnits: [definition.unitIds[0], 'fake'] } }, { title: 'End' }] }, 3, source);
assert.deepEqual(outline[1].pageContract.requiredUnits, [definition.unitIds[0]]);

const contractProject = { source, planning: { slidePlan: plan }, outline: [{ id: 'cover' }, formulaSlide, { id: 'end' }] };
const formulaOnly = [{ id: 'cover', nodes: [] }, { id: 'f', nodes: [textNode('eq', 'r = alpha + beta f + epsilon')] }, { id: 'end', nodes: [] }];
assert.ok(inspectPageContracts(contractProject, formulaOnly).some(issue => issue.code === 'page_contract_unit_missing'));
const explained = [{ id: 'cover', nodes: [] }, { id: 'f', nodes: [textNode('eq', 'r = alpha + beta f + epsilon'), textNode('x', inventory.items.find(item => item.id === definition.unitIds[1]).text)] }, { id: 'end', nodes: [] }];
assert.ok(!inspectPageContracts(contractProject, explained).some(issue => issue.code === 'page_contract_unit_missing'));
const bigLabel = [{ id: 'cover', nodes: [] }, { id: 'f', nodes: [textNode('big', 'β ≠ α', { style: { fontSizePt: 54 } })] }, { id: 'end', nodes: [] }];
assert.ok(inspectPageContracts(contractProject, bigLabel).some(issue => issue.code === 'big_number_without_source_value'));
const bigUnsourced = [{ id: 'cover', nodes: [] }, { id: 'f', nodes: [textNode('big', '400+', { style: { fontSizePt: 58 } })] }, { id: 'end', nodes: [] }];
assert.ok(inspectPageContracts(contractProject, bigUnsourced).some(issue => issue.code === 'big_number_without_source_value'));
const bigSourced = [{ id: 'cover', nodes: [] }, { id: 'f', nodes: [textNode('big', '800%', { style: { fontSizePt: 58 } }), textNode('title', 'Big title without digits', { semanticRole: 'title', style: { fontSizePt: 48 } })] }, { id: 'end', nodes: [] }];
assert.ok(!inspectPageContracts(contractProject, bigSourced).some(issue => issue.code === 'big_number_without_source_value'), 'sourced number and titles pass');

// ---------------------------------------------------------------- C. media ledger
assert.equal(mediaBucket('template_icon'), 'aid'); assert.equal(mediaBucket('template_artwork'), 'decoration'); assert.equal(mediaBucket('evidence'), 'evidence');
assert.equal(mediaBucket('template_icon', { content: { mustPreserve: true } }), 'brand');
const media = n => Array.from({ length: n }, (_, i) => ({ id: `img${i}`, type: 'image', geometry: { x: 0, y: 0, width: 10, height: 10 } }));
const fidelity = { slides: [{ nodes: media(1) }, { nodes: media(2) }, { nodes: media(2) }, { nodes: media(1) }, { nodes: media(1) }] };
const slides = [0, 1, 2, 3, 4].map(i => ({ id: `p${i}`, nodes: [] }));
const assets = [1, 2, 3, 4].flatMap(i => fidelity.slides[i].nodes.map(node => ({ objectId: node.id, slideId: `p${i}`, role: 'template_icon', status: 'retired_by_adaptation', reason: 'topic mismatch' })));
const ledger = buildMediaLedger({ templateFidelity: fidelity }, slides, { templateAssets: assets, objects: [] });
assert.equal(ledger.status, 'profiled'); assert.equal(ledger.buckets.aid.expected, 6); assert.equal(ledger.buckets.aid.kept, 0);
assert.equal(ledger.conservation, 0); assert.equal(ledger.longestTextOnlyRun, 4); assert.equal(ledger.templateMediaShare, 1);
const mediaCodes = inspectMediaLedger(ledger).map(issue => issue.code);
// MD-P0-3 (round 5): below 0.7 effective conservation blocks publishing until the user confirms each removal.
assert.deepEqual(mediaCodes.sort(), ['media_conservation_blocked', 'media_role_dropped', 'media_text_only_run', 'media_weighted_conservation_blocked']);
const keptLedger = buildMediaLedger({ templateFidelity: fidelity }, slides.map(slide => ({ ...slide, nodes: [{ id: 'i', type: 'image' }] })), { templateAssets: assets.map(asset => ({ ...asset, status: 'retained' })), objects: [] });
assert.ok(inspectMediaLedger(keptLedger).every(i=>i.code==='media_text_only_run'&&i.severity==='warning'),'retained illustrative media is conserved but unknown pictures do not prove semantic coverage; density is advisory');
const mapped = buildMediaLedger({}, slides, { objects: [] });
assert.equal(mapped.status, 'template_media_not_profiled'); assert.deepEqual(inspectMediaLedger(mapped), [], 'unprofiled is reported as status, not as a pass or a failure');

// ---------------------------------------------------------------- D. layered repair
assert.equal(routeIssue('relation_alternative_as_sequence').ownerLayer, 'semantic');
assert.equal(routeIssue('page_contract_unit_missing').ownerLayer, 'content');
assert.equal(routeIssue('model_unsupported').ownerLayer, 'scope');
assert.equal(routeIssue('visible_copy_duplicate').ownerLayer, 'content');
assert.equal(routeIssue('media_role_dropped').ownerLayer, 'media');
assert.equal(routeIssue('contrast_foreground').ownerLayer, 'theme');
assert.equal(routeIssue('title_overflow').ownerLayer, 'composition');
assert.equal(routeIssue('big_number_without_source_value').repairKind, 'change_prototype');
assert.ok(routeIssue('planned_source_object_missing').allowedOperations.includes('reallocate_pages'));
assert.ok(!routeIssue('title_overflow').allowedOperations.includes('rewrite_with_source'), 'geometry is not repaired by rewriting facts');
assert.equal(annotateIssue({ code: 'x', ownerLayer: 'plan' }).ownerLayer, 'plan', 'explicit owner kept');
assert.deepEqual(newHardErrors({ issues: [{ code: 'a', severity: 'error', slideId: '1' }] }, { issues: [{ code: 'a', severity: 'error', slideId: '1' }, { code: 'b', severity: 'error', slideId: '2' }, { code: 'c', severity: 'warning' }] }).map(item => item.code), ['b']);

const lowContrast = { templateSpec: { ...templates.snapshotTemplate(templates.BUILT_INS[0]), palette: { background: '#ffffff', foreground: '#eeeeee', muted: '#dddddd', accent: '#cccccc' } },
  deck: { slides: [{ id: '1', title: 'Cover', bullets: [], blocks: [], layoutId: 'cover' }] } };
const review = quality.deterministicReview(lowContrast);
assert.ok(review.issues.length && review.issues.every(issue => issue.ownerLayer && issue.repairKind && Array.isArray(issue.allowedOperations)), 'every issue is routed');
assert.ok(review.mediaLedger && review.mediaLedger.status === 'template_media_not_profiled');
const free = quality.repairProject(lowContrast, review);
assert.notEqual(free.project.templateSpec.palette.foreground, '#eeeeee'); assert.ok(free.repairs.every(item => item.ownerLayer));
assert.ok(!free.review.issues.some(issue => issue.code === 'contrast_foreground'));
const bound = { ...lowContrast, bindings: { theme: true } }; assert.ok(themeBound(bound));
const boundRepair = quality.repairProject(bound, quality.deterministicReview(bound));
assert.equal(boundRepair.project.templateSpec.palette.foreground, '#eeeeee', 'bound theme token is not changed');
assert.ok(boundRepair.repairs.some(item => item.operation === 'report_binding_conflict'));
assert.ok(boundRepair.review.issues.some(issue => issue.code === 'contrast_foreground' && issue.ownerLayer === 'theme'));

assert.ok(ledger.entries.every(entry => entry.cropPolicy && Array.isArray(entry.boundUnitIds) && entry.required === false));

// ---------------------------------------------------------------- unsourced numbers
const numberDeck = values => [{ id: 'n0', nodes: [] }, { id: 'n1', nodes: values.map((value, i) => textNode(`v${i}`, value)) }];
const strictProject = { source, prompt: '', generationPolicy: { version: 1, detail: 'balanced', language: { mode: 'source' }, knowledge: 'source_only' } };
const unsourced = inspectSourceNumbers(strictProject, numberDeck(['Harvey et al. (2016) raised the bar to t > 3.0']));
assert.equal(unsourced[0].code, 'source_number_unsupported'); assert.equal(unsourced[0].severity, 'error'); assert.deepEqual(unsourced[0].values.sort(), ['2016', '3.0']);
assert.deepEqual(inspectSourceNumbers(strictProject, numberDeck(['A portfolio with 800% turnover', '01', 'Step 2'])), [], 'sourced values, ordinal badges and single digits pass');
const bounded = inspectSourceNumbers({ ...strictProject, generationPolicy: { ...strictProject.generationPolicy, knowledge: 'source_plus_explanation' } }, numberDeck(['about 400 factors']));
assert.equal(bounded[0].severity, 'warning');
assert.deepEqual(inspectSourceNumbers({ ...strictProject, prompt: 'Use the 2016 study' }, numberDeck(['2016 study'])), [], 'numbers the user supplied are allowed');
assert.equal(routeIssue('source_number_unsupported').ownerLayer, 'scope');

// ---------------------------------------------------------------- real input (optional)
const factorZoo = path.join(process.env.PPT_EVAL_INPUT_DIR || '/Users/dongli/Documents/quant_research/quant_3.0', '04_factor_zoo_overview.md');
if (fs.existsSync(factorZoo)) {
  const zoo = normalizePaste(fs.readFileSync(factorZoo, 'utf8')).semantic.inventory.relationships;
  const alternatives = zoo.filter(item => item.type === 'alternative');
  assert.equal(alternatives.length, 1); assert.equal(alternatives[0].members.length, 5); assert.equal(alternatives[0].interchangeable, false); assert.equal(alternatives[0].unitIds.length, 2);
  const shapes = zoo.filter(item => item.type === 'matrix').map(item => `${item.rowCount}x${item.columnCount}`);
  assert.ok(shapes.includes('8x3') && shapes.includes('7x4') && shapes.includes('8x5'), shapes.join(','));
  assert.ok(zoo.filter(item => item.type === 'definition').length >= 4);
  console.log(`Factor Zoo: ${alternatives[0].members.length} alternatives (not interchangeable), matrices ${shapes.join(' ')}, ${zoo.filter(item => item.type === 'definition').length} formula explanations`);
} else console.log('Factor Zoo fixture not present; skipped real-input relation check');

console.log('PPT four pillars: typed relations, page contract, media ledger, layered repair routing/theme binding: OK');
