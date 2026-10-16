// Round 7, B3: an outline is compiled, not rejected. Twenty-two fixtures with
// typical planner slips are each accepted by the selection and skeleton
// validators after compilation, and every fix is listed. Source text and rows
// never change and no unit is dropped.
import assert from 'node:assert/strict';
import { compileOutlineCandidate, truncateAtBoundary, summarizeOutlineCorrections } from './lib/ppt-outline-compile.mjs';
import { compileContentSelection, selectionSource } from './lib/ppt-content-selection.mjs';
import { compileSkeleton, inspectSkeletonOwnership } from './lib/ppt-outline-protocol.mjs';

const item = (id, type, text, section = 'Methods', extra = {}) => ({ id, type, text, sectionPath: [section], source_ref: [id], chunkRefs: [], ...extra });
const items = [
  item('intro', 'MechanismBlock', 'The research loop generates candidate formulas and records each decision.', 'Intro'),
  item('def', 'DefinitionBlock', 'An alpha is a signal that predicts relative returns. It is measured by IC.'),
  item('en', 'MechanismBlock', 'Screening removes formulas that repeat known factors.', 'Methods', { languagePairId: 'lp_en', languageRole: 'primary' }),
  item('zh', 'MechanismBlock', '筛选会移除重复已知因子的公式。', 'Methods', { languagePairId: 'lp_en', languageRole: 'translation' }),
  item('aside', 'ExampleBlock', 'A vendor file format example shows the column order.'),
  item('table', 'TableBlock', 'Method | Rule\nA | keep\nB | only if the risk is controlled\nC | drop', 'Results', { rows: [['Method', 'Rule'], ['A', 'keep'], ['B', 'only if the risk is controlled'], ['C', 'drop']] }),
  item('code', 'CodeBlock', 'def screen(x):\n    return x', 'Results'),
  item('rel-a', 'MechanismBlock', 'Turnover raises cost.', 'Results'),
  item('rel-b', 'MechanismBlock', 'Cost lowers the net return.', 'Results'),
  item('close', 'SummaryBlock', 'Keep only formulas that survive cost and overlap checks.', 'Conclusion'),
];
const inventory = { items, relationships: [{ id: 'r1', type: 'cause', unitIds: ['rel-a', 'rel-b'] }] };
const overview = { version: 1, detail: 'balanced', content: 'overview', details: 'notes', language: { mode: 'source', body: 'both' }, knowledge: 'source_only', code: { presentation: 'omit' } };
const project = (policy = overview, extra = {}) => ({ title: 'Alpha research', pages: 5, generationPolicy: policy,
  source: { text: items.map(i => i.text).join('\n'), semantic: { inventory: structuredClone(inventory) } }, ...extra });
const select = (id, destination = 'slides', extra = {}) => ({ sourceUnitId: id, destination, reason: 'Planner choice', ...extra });
const valid = () => ({ version: 2,
  selection: [select('intro'), select('def'), select('en'), select('zh'), select('aside', 'notes'), select('table'), select('code', 'notes'), select('rel-a'), select('rel-b'), select('close')],
  slides: [
    { title: 'Alpha research', focus: 'Cover', sourceUnitIds: [] },
    { title: 'Research loop', focus: 'How the loop works', section: 'Intro', sourceUnitIds: ['intro', 'def'] },
    { title: 'Screening', focus: 'What screening removes', section: 'Methods', sourceUnitIds: ['en', 'zh'] },
    { title: 'Results', focus: 'Rules, cost and return', section: 'Results', sourceUnitIds: ['table', 'rel-a', 'rel-b'] },
    { title: 'Conclusion', focus: 'What survives', section: 'Conclusion', sourceUnitIds: ['close'] },
  ] });

function accept(p, raw) {
  const { raw: compiled, corrections } = compileOutlineCandidate(p, raw);
  const ledger = compileContentSelection(p, compiled);
  const selected = ledger ? { ...p, contentSelection: ledger, originalSourceInventory: p.source.semantic.inventory, source: selectionSource(p, ledger) } : p;
  const skeleton = compileSkeleton(selected, compiled);
  const ownership = inspectSkeletonOwnership(selected, skeleton).filter(issue => issue.code !== 'navigation_budget_missing');
  assert.deepEqual(ownership, [], 'ownership is complete after compilation');
  return { compiled, corrections, ledger };
}
const has = (corrections, code) => assert.ok(corrections.some(c => c.code === code), `expected correction ${code}: ${JSON.stringify(corrections)}`);
const cases = [
  ['entire disposition ledger missing', raw => { delete raw.selection; }, 'selection_ledger_completed'],
  ['disposition ledger has the wrong type', raw => { raw.selection = 'not an array'; }, 'selection_ledger_completed'],
  ['missing disposition', raw => { raw.selection = raw.selection.filter(e => e.sourceUnitId !== 'aside'); }, 'disposition_added'],
  ['duplicate disposition', raw => { raw.selection.push(select('intro', 'notes')); }, 'duplicate_disposition_removed'],
  ['unknown disposition ID', raw => { raw.selection.push(select('ghost')); }, 'unknown_disposition_removed'],
  ['unknown page ID', raw => { raw.slides[1].sourceUnitIds.push('ghost'); }, 'unknown_source_ids_removed'],
  ['notes unit on a page', raw => { raw.slides[3].sourceUnitIds.push('aside'); }, 'notes_unit_removed_from_page'],
  ['visible unit without a page', raw => { raw.slides[3].sourceUnitIds = ['table', 'rel-a', 'rel-b'].filter(id => id !== 'table'); raw.slides[2].sourceUnitIds.push('table'); raw.slides[2].sourceUnitIds = raw.slides[2].sourceUnitIds.filter(id => id !== 'table'); }, 'ownership_assigned'],
  ['split language pair', raw => { raw.selection.find(e => e.sourceUnitId === 'zh').destination = 'notes'; raw.slides[2].sourceUnitIds = ['en']; }, 'language_pair_kept_together'],
  ['split relation', raw => { raw.selection.find(e => e.sourceUnitId === 'rel-b').destination = 'notes'; raw.slides[3].sourceUnitIds = ['table', 'rel-a']; }, 'relation_kept_together'],
  ['title too long', raw => { raw.slides[2].title = 'Screening '.repeat(40); }, 'metadata_shortened'],
  ['empty focus', raw => { raw.slides[2].focus = ''; }, 'metadata_filled'],
  ['section too long', raw => { raw.slides[3].section = 'Results and cost analysis, '.repeat(6); }, 'metadata_shortened'],
  ['unauthorized recap', raw => { raw.slides[4].sourceUnitIds.push('intro'); raw.slides[4].repeatSourceUnitIds = ['intro']; }, 'recap_tags_removed'],
  ['cover owns units', raw => { raw.slides[0].sourceUnitIds = ['intro']; raw.slides[1].sourceUnitIds = ['def']; }, 'cover_units_moved', { templateSpec: { kind: 'builtin' } }],
  ['summary omits a definition sentence', raw => { Object.assign(raw.selection.find(e => e.sourceUnitId === 'def'), { destination: 'summary', sentenceIndices: [1] }); }, 'summary_sentences_completed'],
  ['table summary omits a condition row', raw => { Object.assign(raw.selection.find(e => e.sourceUnitId === 'table'), { destination: 'summary', rowIndices: [1] }); }, 'summary_rows_completed'],
  ['code summary', raw => { Object.assign(raw.selection.find(e => e.sourceUnitId === 'code'), { destination: 'summary', sentenceIndices: [0] }); }, 'disposition_to_notes_by_contract'],
  ['unknown destination', raw => { raw.selection.find(e => e.sourceUnitId === 'close').destination = 'appendix'; }, 'disposition_defaulted'],
  ['definition moved to notes', raw => { raw.selection.find(e => e.sourceUnitId === 'def').destination = 'notes'; raw.slides[1].sourceUnitIds = ['intro']; }, 'disposition_not_allowed'],
  ['wrong visible equivalent', raw => { Object.assign(raw.selection.find(e => e.sourceUnitId === 'aside'), { visibleEquivalentSourceUnitId: 'intro' }); }, 'visible_equivalent_removed'],
  ['duplicate primary owner', raw => { raw.slides[2].sourceUnitIds.push('intro'); }, 'duplicate_owner_removed'],
  ['navigation page with units and a second navigation page', raw => { raw.slides.splice(1, 0, { title: 'Contents', focus: 'Contents', role: 'navigation', sourceUnitIds: ['intro'] }); raw.slides[2].sourceUnitIds = ['def']; raw.slides[4].role = 'navigation'; }, 'extra_navigation_page_converted'],
  ['invalid table range', raw => { raw.slides[3].sourceArtifactRanges = [{ sourceUnitId: 'table', rowStart: 3, rowEnd: 9 }]; }, 'table_range_replaced_by_full_table'],
];
for (const [name, mutate, code, extra] of cases) {
  const raw = valid(); mutate(raw);
  const p = project(overview, extra || {});
  const before = JSON.stringify(p.source);
  const { corrections, ledger } = accept(p, raw);
  has(corrections, code);
  assert.equal(JSON.stringify(p.source), before, `${name}: source is immutable`);
  const visible = new Set(ledger.entries.filter(e => e.destination !== 'notes').map(e => e.sourceUnitId));
  const notes = new Set(ledger.entries.filter(e => e.destination === 'notes').map(e => e.sourceUnitId));
  assert.ok(items.every(i => visible.has(i.id) || notes.has(i.id)), `${name}: every unit keeps one disposition`);
}
// The definition sentence 0 is restored rather than demoted.
{
  const raw = valid(); Object.assign(raw.selection.find(e => e.sourceUnitId === 'intro'), { destination: 'summary', sentenceIndices: [] });
  const { corrections } = accept(project(), raw);
  has(corrections, 'summary_kept_complete');
}
// full_source has no notes ledger: a stray selection is removed, every unit stays visible.
{
  const full = { ...overview, content: 'full_source', details: 'slides' };
  const raw = valid(); raw.slides[3].sourceUnitIds.push('aside', 'code');
  const { corrections, ledger } = accept(project(full), raw);
  has(corrections, 'selection_removed_for_contract'); assert.equal(ledger, null);
}
// A clean outline needs no corrections.
assert.deepEqual(compileOutlineCandidate(project(), valid()).corrections, []);
// Boundaries.
assert.equal(truncateAtBoundary('One sentence here. Another sentence that is long.', 30), 'One sentence here.');
assert.equal(truncateAtBoundary('alpha beta gamma delta epsilon', 18), 'alpha beta gamma');
assert.ok(truncateAtBoundary('因子筛选的第一步是检查覆盖率，第二步是检查重复，第三步是检查成本。', 20).length <= 20);
assert.deepEqual(summarizeOutlineCorrections([{ code: 'a' }, { code: 'a' }, { code: 'b' }]), [{ code: 'a', count: 2 }, { code: 'b', count: 1 }]);
console.log(`PASS outline compile: ${cases.length + 2} slip fixtures accepted with listed corrections; source immutable; clean outline unchanged`);

{
 const pair=[{id:'en-returned',type:'MechanismBlock',text:'The mechanism returns the original source evidence to a related page.',languagePairId:'intro',languageRole:'primary',sectionPath:['T']},{id:'zh-notes',type:'MechanismBlock',text:'机制将原始来源证据放回相关页面。',languagePairId:'intro',languageRole:'translation',sectionPath:['T']}];
 const project={generationPolicy:{content:'overview',details:'notes',language:{mode:'source',body:'primary'}},source:{text:pair[0].text.repeat(8)+'\n'+pair[1].text,semantic:{inventory:{items:pair,relationships:[]}}}};
 const raw={version:2,selection:[{sourceUnitId:'en-returned',destination:'slides',reason:'Fill the related page'},{sourceUnitId:'zh-notes',destination:'notes',reason:'Complete original in notes'}],slides:[{title:'Cover',focus:'Introduce',sourceUnitIds:[]},{title:'Source mechanism',focus:'Explain the original mechanism',sourceUnitIds:['en-returned']},{title:'Close',focus:'Conclude',sourceUnitIds:[]}]};
 const compiled=compileOutlineCandidate(project,raw);
 const carried=compiled.raw.selection.find(e=>e.sourceUnitId==='zh-notes');assert.equal(carried.destination,'notes');assert.equal(carried.visibleEquivalentSourceUnitId,'en-returned');assert.ok(!compiled.raw.slides.some(s=>s.sourceUnitIds.includes('zh-notes')));
 const {compileContentSelection}=await import('./lib/ppt-content-selection.mjs');assert.doesNotThrow(()=>compileContentSelection(project,compiled.raw));
 console.log('PASS returning a primary point from notes links its translation before pair closure; one visible owner and complete original notes retained');
}

// A report cover can contain old body slots without becoming a safe new body
// page. Move automatic full-source ownership before measuring/freeze; user
// assignments are left intact and all moved source IDs remain exactly once.
const nativeAuto=project({...overview,content:'full_source'}, {templateFidelity:{mode:'preserve',slides:[{slots:[{role:'content',purpose:'body'}]}]}});
const coverRaw=valid();coverRaw.slides[0].sourceUnitIds=['intro'];coverRaw.slides[1].sourceUnitIds=['def'];
const autoCompiled=compileOutlineCandidate(nativeAuto,coverRaw);assert.deepEqual(autoCompiled.raw.slides[0].sourceUnitIds,[]);assert.equal(autoCompiled.raw.slides.flatMap(s=>s.sourceUnitIds).filter(id=>id==='intro').length,1);has(autoCompiled.corrections,'cover_units_moved');
const explicitNative=compileOutlineCandidate({...nativeAuto,requestedOutline:coverRaw.slides},coverRaw);assert.deepEqual(explicitNative.raw.slides[0].sourceUnitIds,['intro'],'explicit source assignment is frozen');
