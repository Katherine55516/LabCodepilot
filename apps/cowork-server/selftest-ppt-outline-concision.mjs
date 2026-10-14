// Outline concision (postmortem round 6): page budget, card cost, one body
// language for bilingual sources, narrowed visible requirements, condense
// before growth, section grouping and metrics. Synthetic bilingual tutorial;
// no Alpha Mining branches and no model calls.
import assert from 'node:assert/strict';
import { normalizePaste } from './lib/ppt-source.mjs';
import { withSemanticIndex } from './lib/ppt-semantic.mjs';
import { applyPresentationPolicy } from './lib/ppt-presentation-policy.mjs';
import { normalizeGenerationPolicy, defaultGenerationPolicy } from './lib/ppt-generation-policy.mjs';
import { estimatePageRecommendation } from './lib/ppt-planning.mjs';
import { selectionConstraints, visibleEquivalentCandidates, compileContentSelection } from './lib/ppt-content-selection.mjs';
import { skeletonBatches } from './lib/ppt-outline-protocol.mjs';
import { globalOutlinePlan } from './lib/ppt-global-outline-plan.mjs';
import { majorSections, presentationBudget, sectionPageGroups, outlineGrowth, routeTranslationsToNotes, concisionCost, CARD_UNITS,
  outlineConcisionMetrics, concisionPlannerRule, visibleRequiredSentence } from './lib/ppt-outline-concision.mjs';
import { condenseOverflowingTables, mergeUnderfilledPages, pageLoad, condenseFirstRule } from './lib/ppt-outline-condense.mjs';

// Main-deck bilingual retention and concise notes disposition are independent:
// moving a secondary point must move the complete pair, preserving the other
// bilingual point and every original sentence in the source inventory.
{
  const pairItems = [
    {id:'core-en',text:'The core observation describes the model workflow.',languagePairId:'core',languageRole:'primary'},
    {id:'core-zh',text:'核心观察描述模型的工作流程。',languagePairId:'core',languageRole:'translation'},
    {id:'detail-en',text:'An auxiliary observation describes the data vendor format.',languagePairId:'detail',languageRole:'primary'},
    {id:'detail-zh',text:'辅助观察描述数据供应商的格式。',languagePairId:'detail',languageRole:'translation'},
  ].map(item=>({...item,type:'MechanismBlock',sectionPath:['Overview'],source_ref:[]}));
  const pairProject={generationPolicy:defaultGenerationPolicy(),source:{text:pairItems.map(i=>i.text).join('\n'),semantic:{inventory:{items:pairItems,relationships:[]}}}};
  const raw={version:2,selection:pairItems.map(i=>({sourceUnitId:i.id,destination:'slides',reason:'Main point'})),slides:[{title:'Cover',sourceUnitIds:[]},{title:'Observations',sourceUnitIds:pairItems.map(i=>i.id),densityFit:{predictedOverflow:100}},{title:'Close',sourceUnitIds:[]}]};
  const assess=(project,outline)=>{compileContentSelection(project,outline);return {rawOutline:structuredClone(outline),issues:[],outline:outline.slides};};
  const start=assess(pairProject,raw);
  const result=condenseOverflowingTables(pairProject,start,(project,outline)=>{const candidate=assess(project,outline);candidate.rawOutline.slides[1].densityFit={predictedOverflow:Math.max(0,(outline.slides[1].sourceUnitIds.length-2)*50)};return candidate;});
  assert.ok(result);
  assert.deepEqual(result.rawOutline.slides[1].sourceUnitIds,['core-en','core-zh']);
  assert.deepEqual(result.rawOutline.selection.filter(e=>e.destination==='notes').map(e=>e.sourceUnitId).sort(),['detail-en','detail-zh']);
  assert.deepEqual(pairProject.source.semantic.inventory.items,pairItems,'complete bilingual originals are immutable');
  assert.throws(()=>compileContentSelection(pairProject,{...raw,selection:raw.selection.map(e=>e.sourceUnitId==='detail-en'?{...e,destination:'notes'}:e),slides:raw.slides.map((s,i)=>i===1?{...s,sourceUnitIds:s.sourceUnitIds.filter(id=>id!=='detail-en')}:s)}),/Both source languages/);
}

// --- A bilingual tutorial: intro + 11 sections, English paragraph + Chinese translation each.
const en = n => `Section ${n} explains how candidate formulas are generated, screened and recorded so that the research loop stays reproducible across 3 stages of review.`;
const zh = n => `第${n}节说明候选公式如何生成、筛选并记录，使研究循环在 3 个审查阶段中保持可复现，便于团队复核与追踪每一步的决定和依据。`;
let md = '# Tutorial — Search | 教程：搜索\n\nThis tutorial covers formula search across 3 stages of review and recording.\n\n本教程介绍跨越 3 个审查与记录阶段的公式搜索方法与流程安排。\n\n';
for (let n = 1; n <= 11; n++) {
  md += `## ${n}. Topic ${n} | 主题${n}\n\n${en(n)}\n\n${zh(n)}\n\n${en(n).replace('explains', 'also shows')}\n\n${zh(n).replace('说明', '也展示')}\n\n`;
  if (n === 4) md += '| Field | Input | Risk |\n| --- | --- | --- |\n' + Array.from({ length: 8 }, (_, r) => `| F${r + 1} | field ${r + 1} | ${r === 5 ? 'must not use future data' : 'low'} |`).join('\n') + '\n\n';
  if (n === 7) md += 'Warning: you must never tune on the test period.\n\n';
}
const raw = withSemanticIndex(normalizePaste(md));
const wizardPolicy = { version: 1, detail: 'balanced', content: 'overview', details: 'notes', knowledge: 'source_only', language: { mode: 'source', body: 'primary' } };
const project = (policy, extra = {}) => { const p = { id: 'p', uid: 'u', inputKind: 'paste', prompt: '', pages: null, pageDecision: { source: 'estimate', mode: 'auto' }, source: raw, generationPolicy: normalizeGenerationPolicy(policy), ...extra }; p.source = applyPresentationPolicy(raw, p); return p; };
const items = raw.semantic.inventory.items;
assert.ok(items.filter(item => item.languageRole === 'translation').length >= 20, 'paragraph pairs are detected');

// --- Explicit legacy primary-only contract is preserved; new defaults keep both.
assert.deepEqual(normalizeGenerationPolicy(wizardPolicy).language, { mode: 'source', body: 'primary' });
assert.deepEqual(normalizeGenerationPolicy({ ...wizardPolicy, language: { mode: 'source', body: 'both' } }).language, { mode: 'source', body: 'both' });
assert.deepEqual(normalizeGenerationPolicy({ ...wizardPolicy, content: 'full_source', details: 'slides', language: {mode:'source'} }).language, { mode: 'source' }, 'full_source keeps both languages');
assert.throws(() => normalizeGenerationPolicy({ ...wizardPolicy, language: { mode: 'output', locale: 'en', body: 'primary' } }), /invalid generation policy/u);
assert.throws(() => normalizeGenerationPolicy({ ...wizardPolicy, language: { mode: 'source', body: 'translated' } }), /invalid generation policy/u);
assert.deepEqual(defaultGenerationPolicy('').language, { mode: 'source', body: 'both' });

// --- Budget (item 1).
const overview = project(wizardPolicy), both = project({ ...wizardPolicy, language: { mode: 'source', body: 'both' } }), full = project({ ...wizardPolicy, content: 'full_source', details: 'slides' });
assert.equal(majorSections(overview.source).length, 12, 'the H1 introduction counts as one major section');
assert.deepEqual(presentationBudget(overview), { version: 1, basis: 'major_sections', sections: 12, contentPages: 6, navigation: 1, target: 8, max: 10 });
assert.equal(presentationBudget(full), null, 'full_source is not budgeted');
assert.equal(presentationBudget(project({ ...wizardPolicy, content: 'course', details: 'slides' })), null);
const estimate = estimatePageRecommendation(overview), estimateBoth = estimatePageRecommendation(both), estimateFull = estimatePageRecommendation(full);
assert.ok(estimate.recommended <= 10 && estimate.range[1] <= 10, 'the estimate never exceeds the budget cap');
assert.ok(estimate.contentCost < estimateBoth.contentCost, 'one body language costs less than two');
assert.ok(estimateFull.recommended > estimate.recommended && !estimateFull.presentationBudget, 'full_source keeps its existing estimate');
assert.match(estimate.reason, /主要小节/u);
assert.deepEqual(outlineGrowth({ ...overview, pageDecision: { initialPageCount: 8 } }, 11), { version: 1, initial: 8, final: 11, limit: 10, basis: 'presentation_budget', needsConfirmation: true });
assert.equal(outlineGrowth({ ...overview, pageDecision: { initialPageCount: 8 } }, 10), null);
assert.equal(outlineGrowth({ ...full, pageDecision: { initialPageCount: 12 } }, 16)?.basis, 'initial_estimate', 'without a budget the initial estimate × 1.25 is the limit');

// --- Card cost (item 2).
const paragraph = items.find(item => item.type !== 'TableBlock' && item.text.length > 100);
assert.equal(concisionCost(overview, { ...paragraph, text: 'x'.repeat(2000) }, 900), CARD_UNITS);
assert.equal(concisionCost(full, paragraph, 900), 900);
assert.equal(concisionCost(overview, items.find(item => item.type === 'TableBlock'), 900), 900, 'tables keep their measured cost');
assert.match(concisionPlannerRule(overview), /3–4 cards[\s\S]*about 8 pages[\s\S]*at most 10[\s\S]*original-language unit/u);
assert.equal(concisionPlannerRule(full), '');

// --- One body language (item 3).
const translation = items.find(item => item.languageRole === 'translation'), original = items.find(item => item.languagePairId === translation.languagePairId && item.languageRole === 'primary');
assert.deepEqual(visibleEquivalentCandidates(overview, translation), [original.id]);
assert.deepEqual(visibleEquivalentCandidates(overview, original), []);
assert.deepEqual(visibleEquivalentCandidates(both, translation), [], 'both languages stay visible when chosen');
const rules = new Map(selectionConstraints(overview).map(rule => [rule.sourceUnitId, rule]));
assert.deepEqual(rules.get(translation.id).allowedDestinations, ['notes']);
const routed = routeTranslationsToNotes(overview, { version: 2, slides: [{ title: 'Cover', sourceUnitIds: [] }, { title: 'A', sourceUnitIds: [original.id, translation.id] }, { title: 'B', sourceUnitIds: [] }],
  selection: [{ sourceUnitId: original.id, destination: 'slides', reason: 'r' }, { sourceUnitId: translation.id, destination: 'slides', reason: 'r' }] });
assert.deepEqual(routed.slides[1].sourceUnitIds, [original.id]);
assert.deepEqual(routed.selection.find(entry => entry.sourceUnitId === translation.id), { sourceUnitId: translation.id, destination: 'notes', visibleEquivalentSourceUnitId: original.id, reason: 'Translation kept in speaker notes; the original-language unit carries the slide.' });
const swapped = routeTranslationsToNotes(overview, { version: 2, slides: [{ sourceUnitIds: [] }, { sourceUnitIds: [translation.id] }, { sourceUnitIds: [translation.id] }], selection: [{ sourceUnitId: translation.id, destination: 'slides', reason: 'r' }] });
assert.deepEqual(swapped.slides.map(slide => slide.sourceUnitIds), [[], [original.id], []], 'a translation alone on a page is replaced by its original exactly once');
assert.equal(routeTranslationsToNotes(both, routed), routed, 'no routing when both languages are chosen');

// --- Visible requirement (item 4): numbers no longer pin a unit; hard conditions do.
const numbered = items.find(item => item.languageRole === 'primary' && /candidate[\s\S]*\d/u.test(item.text) && item.type !== 'DefinitionBlock');
assert.ok(rules.get(numbered.id).allowedDestinations.includes('notes'), 'a numbered paragraph may move to notes under overview');
const courseRules = new Map(selectionConstraints(project({ ...wizardPolicy, content: 'course', details: 'notes' })).map(rule => [rule.sourceUnitId, rule]));
assert.ok(!courseRules.get(numbered.id).allowedDestinations.includes('notes'), 'other contracts keep the broad rule');
assert.equal(visibleRequiredSentence({ type: 'WarningBlock' }, 'You must never tune on the test period.', 0), true);
assert.equal(visibleRequiredSentence({ type: 'MechanismBlock' }, 'Search 2,000 candidates without a holdout.', 0), false);
assert.equal(visibleRequiredSentence({ type: 'ExampleBlock' }, 'Only if the risk is controlled.', 0), true, 'a hard condition pins any unit');
assert.equal(visibleRequiredSentence({ type: 'ExampleBlock' }, 'Liquidity risk is not trivial.', 0), false, 'topical risk words and plain negation do not');
assert.equal(visibleRequiredSentence({ type: 'DefinitionBlock' }, 'An alpha is a signal.', 0), true);

// --- Section grouping and batches (item 6).
const groups = sectionPageGroups(overview);
assert.equal(groups.length, 6);
assert.deepEqual(groups.flatMap(group => group.sections), majorSections(overview.source).map(section => section.key), 'groups are consecutive and cover every section once');
assert.ok(groups.every(group => group.sections.length <= 3), 'no group lumps more than three sections');
assert.ok(groups.reduce((sum, group) => sum + group.pages, 0) <= 10 - 2, 'group pages stay within the cap');
const relationProject = { ...overview, source: { ...overview.source, semantic: { ...overview.source.semantic, inventory: { ...overview.source.semantic.inventory,
  relationships: [{ id: 'r1', relation: 'order', unitIds: [groups[1].sourceUnitIds[0], groups[2].sourceUnitIds.at(-1)] }] } } } };
const related = sectionPageGroups(relationProject);
assert.ok(related.some(group => group.sourceUnitIds.includes(groups[1].sourceUnitIds[0]) && group.sourceUnitIds.includes(groups[2].sourceUnitIds.at(-1))), 'a typed relation never spans two groups');
const batches = skeletonBatches({ ...overview, pages: 8, planningNativeCapacity: { target: 671 } });
assert.equal(batches.length, groups.length, 'one planner call per page group');
assert.deepEqual(batches.flatMap(batch => batch.allowedIds).sort(), items.map(item => item.id).sort(), 'every unit belongs to exactly one batch');
assert.match(batches[0].prompt, /Only plan page group 1\/6[\s\S]*Start with the deck cover[\s\S]*navigation/u);
assert.match(batches[3].prompt, /Do not create a cover/u);
const plan = globalOutlinePlan({ ...overview, pages: 8 });
assert.equal(plan.pageGroups.length, 6);
assert.ok(plan.sections.some(section => section.provisionalPages < 1), 'sections share pages; no per-section floor');
const legacyPlan = globalOutlinePlan({ ...full, pages: 20 });
assert.ok(!legacyPlan.pageGroups && legacyPlan.sections.every(section => section.provisionalPages >= 1), 'full_source keeps its section plan');

// --- Condense before growth (item 5).
const table = items.find(item => item.type === 'TableBlock'), stubAssess = (_project, outline) => ({ rawOutline: { ...outline, slides: outline.slides.map(slide => ({ ...slide, densityFit: { predictedOverflow: 0, targetVisualUnits: 671 } })) }, outline: outline.slides, issues: [] });
const tableRules = new Map(selectionConstraints(overview).map(rule => [rule.sourceUnitId, rule]));
const overflowing = { rawOutline: { version: 2, selection: [{ sourceUnitId: table.id, destination: 'slides', reason: 'r' }], slides: [{ title: 'Cover', sourceUnitIds: [] }, { title: 'Models', sourceUnitIds: [table.id], densityFit: { predictedOverflow: 400 } }, { title: 'End', sourceUnitIds: [] }] }, issues: [{ code: 'planned_density_overflow' }] };
const condensed = condenseOverflowingTables(overview, overflowing, stubAssess);
const summary = condensed.rawOutline.selection.find(entry => entry.sourceUnitId === table.id);
assert.equal(summary.destination, 'summary');
assert.ok(tableRules.get(table.id).mandatoryRowIndices.every(row => summary.rowIndices.includes(row)), 'condition/risk rows stay on the slide');
assert.ok(summary.rowIndices.length < table.rows.length - 1 && summary.rowIndices.every((row, i, all) => !i || row > all[i - 1]));
assert.equal(condenseOverflowingTables(full, overflowing, stubAssess), null, 'full_source is never condensed');
const units = id => ({ sourceUnitIds: [id] });
const thin = { rawOutline: { version: 2, selection: [], slides: [{ title: 'Cover', sourceUnitIds: [] }, { title: 'Nav', role: 'navigation', sourceUnitIds: [] },
  ...groups.slice(0, 6).flatMap(group => [units(group.sourceUnitIds[0]), units(group.sourceUnitIds[1])]).map((slide, i) => ({ ...slide, title: 'P' + i })), { title: 'End', sourceUnitIds: [] }] }, issues: [] };
const merged = mergeUnderfilledPages(overview, thin, stubAssess);
assert.ok(merged && merged.rawOutline.slides.length < thin.rawOutline.slides.length && merged.rawOutline.slides.length >= presentationBudget(overview).target, 'underfilled neighbours merge down toward the budget target');
assert.ok(merged.rawOutline.slides.some(slide => slide.mergedFrom?.length >= 2));
assert.equal(mergeUnderfilledPages(full, thin, stubAssess), null);
assert.ok(pageLoad(overview, units(translation.id), [{ sourceUnitId: translation.id, destination: 'notes' }]) === 0, 'notes cost nothing');
assert.match(condenseFirstRule(overview), /\(1\) move secondary units to speaker notes[\s\S]*\(3\) only then split[\s\S]*10 pages/u);

// --- Metrics (item 7).
const outline = [{ title: 'Cover' }, { title: 'Nav', role: 'navigation' }, ...Array.from({ length: 10 }, (_, i) => ({ title: 'P' + i, sourceUnitIds: [], densityFit: { targetVisualUnits: 671 } })), { title: 'End' }];
const metrics = outlineConcisionMetrics(overview, outline, () => 200);
assert.equal(metrics.withinBudget, false);
assert.deepEqual(metrics.warnings, ['over_budget', 'underfilled']);
assert.equal(metrics.majorSections, 12);
console.log('PPT outline concision: budget, card cost, single-language body, visible rule, grouping, condense/merge and metrics: passed');
