// Round 7, A5/A6: rich but not redundant pages, no "see notes" placeholders,
// split pages with their own titles, and the closing greeting.
import assert from 'node:assert/strict';
import { distinctPageTitles, inspectDuplicatePageTitles, stripPartMarkers } from './lib/ppt-page-titles.mjs';
import { compileContentSelection, selectionSource } from './lib/ppt-content-selection.mjs';
import { inspectCardRedundancy, inspectSlideCopy } from './lib/ppt-presentation-writing.mjs';
import { enrichUnderfilledPages, mergeUnderfilledPages } from './lib/ppt-outline-condense.mjs';
import { _internals as api } from './lib/ppt-api.mjs';

// A6: continuation markers are removed and split pages are named by their content.
for (const [title, expected] of [['因子评估关卡（续）', '因子评估关卡'], ['因子评估关卡（上）', '因子评估关卡'], ['Evaluation gauntlet (continued)', 'Evaluation gauntlet'], ['评估：第2部分', '评估'], ['Results part 2', 'Results'], ['模型（2/3）', '模型'], ['可持续增长', '可持续增长']])
  assert.equal(stripPartMarkers(title), expected, title);
{
  const items = [
    { id: 'a', type: 'MechanismBlock', text: '数据与样本检验先确认覆盖率和幸存者偏差。', sectionPath: ['T', '7. 评估关卡', '7.1 数据与样本检验'] },
    { id: 'b', type: 'MechanismBlock', text: '成本与容量检验估计换手带来的交易成本。', sectionPath: ['T', '7. 评估关卡', '7.2 成本与容量检验'] },
    { id: 'c', type: 'MechanismBlock', text: '换手越高，净收益越低。', sectionPath: ['T', '7. 评估关卡', '7.2 成本与容量检验'] },
  ];
  const project = { source: { text: '中文教程：评估关卡。'.repeat(4), semantic: { inventory: { items } } }, generationPolicy: { language: { mode: 'source' } } };
  const slides = [{ title: '封面', sourceUnitIds: [] }, { title: '评估关卡', sourceUnitIds: ['a'] }, { title: '评估关卡（续）', sourceUnitIds: ['b'] }, { title: '评估关卡（下）', sourceUnitIds: ['c'] }, { title: '总结', sourceUnitIds: [] }];
  const { slides: titled, corrections } = distinctPageTitles(project, slides);
  assert.equal(titled[1].title, '评估关卡');
  assert.equal(titled[2].title, '评估关卡：成本与容量检验', 'the split page adds its own source heading');
  assert.ok(titled[3].title.startsWith('评估关卡：') && titled[3].title !== titled[2].title, 'a third split page uses its own first clause');
  assert.ok(!titled.some(slide => /续|（上）|（下）/u.test(slide.title)));
  assert.equal(new Set(titled.map(slide => slide.title)).size, titled.length, 'no two pages share a title');
  assert.ok(corrections.some(c => c.code === 'continuation_marker_removed') && corrections.some(c => c.code === 'duplicate_title_distinguished'));
  const locked = distinctPageTitles(project, [slides[0], slides[1], { ...slides[1], titleLocked: true }]).slides;
  assert.equal(locked[2].title, '评估关卡', 'a locked user title is never changed');
  assert.deepEqual(inspectDuplicatePageTitles(titled), []);
  assert.deepEqual(inspectDuplicatePageTitles(slides.map((slide, index) => ({ ...slide, id: 's' + index }))).map(issue => issue.code).sort(), ['continuation_title', 'continuation_title']);
  assert.equal(inspectDuplicatePageTitles([{ id: 'c', title: 'Cover' }, { id: 'x', title: 'Same' }, { id: 'y', title: 'Same' }])[0].code, 'duplicate_page_title');
}
// A5: a selected-row table shows its rows with no "complete table in notes" label.
{
  const table = { id: 't', type: 'TableBlock', text: '', rows: [['Item', 'Value'], ['A', '4'], ['B', '7'], ['C', '9']], sectionPath: ['T', 'Results'] };
  const project = { pages: 3, generationPolicy: { content: 'overview', details: 'notes', language: { mode: 'source' }, knowledge: 'source_only' }, source: { text: 'Rows', semantic: { inventory: { items: [table], relationships: [] } } } };
  const raw = { version: 2, selection: [{ sourceUnitId: 't', destination: 'summary', rowIndices: [1, 2], reason: 'Main rows' }], slides: [{ title: 'Cover', sourceUnitIds: [] }, { title: 'Rules', sourceUnitIds: ['t'] }, { title: 'End', sourceUnitIds: [] }] };
  const ledger = compileContentSelection(project, raw);
  const shown = selectionSource(project, ledger).semantic.inventory.items[0];
  assert.deepEqual(shown.rows, [['Item', 'Value'], ['A', '4'], ['B', '7']]);
  assert.ok(!JSON.stringify(shown).match(/完整表|complete table|见备注|見備註/u), 'no visible notes label');
  assert.equal(shown.derivedSummary.selectedRows, true);
}
// A5: redundant cards and placeholder copy are reported for repair.
{
  const repeated = inspectCardRedundancy({ title: '因子筛选流程', copy: { blocks: [{ heading: '概述', body: '因子筛选流程' }, { heading: '步骤', body: '先检查覆盖率，再检查相关性，最后评估交易成本。' }, { heading: '要点', body: '先检查覆盖率，再检查相关性，最后评估交易成本！' }] } });
  assert.deepEqual(repeated.map(issue => issue.code), ['card_restates_title', 'card_duplicate']);
  assert.deepEqual(inspectCardRedundancy({ title: 'Screening', copy: { blocks: [{ body: 'Coverage is checked first because missing data biases the IC.' }, { body: 'Turnover costs are estimated before acceptance.' }] } }), []);
  const placeholder = inspectSlideCopy({ title: 'Rules', bullets: ['完整表见备注'], copy: { blocks: [] } }, {}, 1, 3);
  assert.equal(placeholder[0].code, 'visible_copy_placeholder');
}
// A5: a thin page takes back related points of its own section from notes.
{
  const items = ['a', 'b', 'c', 'd'].map((id, i) => ({ id, type: 'MechanismBlock', text: `Point ${id} explains the ${id} step of screening in one sentence.`, sectionPath: ['T', i < 3 ? 'Screening' : 'Costs'] }));
  const project = { pages: 4, generationPolicy: { content: 'overview', details: 'notes', language: { mode: 'source' }, knowledge: 'source_only' }, source: { text: items.map(i => i.text).join('\n'), semantic: { inventory: { items, relationships: [] } } } };
  const raw = { version: 2, selection: [{ sourceUnitId: 'a', destination: 'slides', reason: 'Main' }, { sourceUnitId: 'b', destination: 'notes', reason: 'Secondary' }, { sourceUnitId: 'c', destination: 'notes', reason: 'Secondary' }, { sourceUnitId: 'd', destination: 'slides', reason: 'Main' }],
    slides: [{ title: 'Cover', sourceUnitIds: [] }, { title: 'Screening', sourceUnitIds: ['a'] }, { title: 'Costs', sourceUnitIds: ['d'] }, { title: 'End', sourceUnitIds: [] }] };
  const fill = slide => (slide.sourceUnitIds || []).length * .2;
  const assess = (p, outline) => { compileContentSelection(p, outline); return { rawOutline: { ...outline, slides: outline.slides.map(slide => ({ ...slide, densityFit: { usedHeight: fill(slide), availableHeight: 1, predictedOverflow: 0 } })) }, issues: [], outline: outline.slides }; };
  const enriched = await enrichUnderfilledPages(project, assess(project, raw), assess);
  assert.ok(enriched, 'a thin page is enriched');
  const page = enriched.rawOutline.slides[1].sourceUnitIds;
  assert.ok(page.length >= 2 && page.every(id => ['a', 'b', 'c'].includes(id)), 'only units of the same section come back');
  assert.ok(!enriched.rawOutline.slides[2].sourceUnitIds.includes('b'), 'other sections are unchanged');
  assert.ok(enriched.rawOutline.selection.filter(entry => entry.destination === 'slides').length >= 3);
  // Thin neighbours merge even when the deck is within budget (ignoreBudget).
  const thin = { ...raw, selection: raw.selection.map(entry => ({ ...entry, destination: 'slides' })), slides: [raw.slides[0], { title: 'One', sourceUnitIds: ['a'] }, { title: 'Two', sourceUnitIds: ['b'] }, { title: 'Three', sourceUnitIds: ['c', 'd'] }, raw.slides[3]] };
  const merged = await mergeUnderfilledPages(project, assess(project, thin), assess, { low: .55, ignoreBudget: true });
  assert.ok(merged, 'thin neighbours merge even within the page budget');
  assert.deepEqual(merged.rawOutline.slides.map(slide => slide.sourceUnitIds), [[], ['a', 'b', 'c', 'd'], []], 'merging stops once the page is no longer thin (0.8 of capacity)');
}
// A6: a required conclusion keeps its topic and body; a canonical footer carries the greeting.
{
  const outline = [{ id: 'a', title: '概览', focus: 'Open', refs: [] }, { id: 'b', title: '方法', focus: 'Method', refs: [] }, { id: 'c', title: '结论', focus: 'Close', refs: [] }];
  const project = { source: { text: '中文为主的教程内容。'.repeat(5) }, outline, generationPolicy: { language: { mode: 'source' } } };
  const closing = api.normalizeSlide({ title: '结论', bullets: ['只保留通过成本检验的因子。'] }, outline[2], project);
  assert.equal(closing.title, '结论'); assert.deepEqual(closing.bullets, ['只保留通过成本检验的因子。']); assert.ok(closing.nodes.some(node=>node.semanticRole==='closing-greeting'&&node.content.text==='感谢观看'));
  const english = api.normalizeSlide({ title: 'Conclusion', bullets: ['Keep factors that pass cost checks.'] }, outline[2], { ...project, generationPolicy: { language: { mode: 'output', locale: 'en' } } });
  assert.equal(english.title, 'Conclusion');assert.ok(english.nodes.some(node=>node.semanticRole==='closing-greeting'&&node.content.text==='Thanks for watching!'));
}
// A critic "conflict" that only says a title/label covers part of its page is
// a labelling warning; a factual contradiction still blocks.
{
  const { finalQualityReport } = await import('./lib/ppt-quality.mjs');
  const review = conflicts => ({ missing: [], repeated: [], unsupported: [], conflicts, obligationAudit: { status: 'complete', checks: [] } });
  const scope = finalQualityReport({ hardErrors: 0, issues: [] }, [], review([{ slideIds: ['s'], detail: "Slide title 'Mining & Overfitting' conflates Section 1.2 and Section 1.3; the single title only covers part of the page." }]));
  assert.ok(scope.modelIssues.every(issue => issue.code === 'model_title_scope' && issue.severity === 'warning'));
  const fact = finalQualityReport({ hardErrors: 0, issues: [] }, [], review([{ slideIds: ['s'], detail: 'Page 3 says IC is 0.05 while page 5 says 0.10 for the same sample; these contradict.' }]));
  assert.ok(fact.modelIssues.some(issue => issue.code === 'model_conflict' && issue.severity === 'error'));
}
// A short source with five distinct major sections is not packed onto one content page.
{
  const { estimatePageRecommendation } = await import('./lib/ppt-planning.mjs');
  const { normalizePaste } = await import('./lib/ppt-source.mjs');
  const { defaultGenerationPolicy } = await import('./lib/ppt-generation-policy.mjs');
  const text = '# 复盘\n\n' + ['目标', '数据', '结果', '风险', '下一步'].map((name, i) => `## ${i + 1}. ${name}\n${name}部分说明本季度的一项具体做法和它的约束条件。`).join('\n\n');
  const estimate = estimatePageRecommendation({ inputKind: 'paste', source: normalizePaste(text), prompt: '', generationPolicy: defaultGenerationPolicy(), pageDecision: { mode: 'auto' } });
  assert.ok(estimate.recommended >= 4 && estimate.recommended <= estimate.presentationBudget.max, `about one content page per two sections: ${estimate.recommended}`);
}
// Prompt numeric series become a native chart; plain prose does not.
{
  const { sourceChart } = await import('./lib/ppt-source-chart.mjs');
  assert.deepEqual(sourceChart('季度候选因子数量：Q1 120、Q2 150、Q3 180、Q4 210。')?.values, [120, 150, 180, 210]);
  assert.equal(sourceChart('我们的方法：先检查覆盖，再检查成本。'), null);
}
// body=primary: the other-language side of a verified pair is in notes and
// creates no separate slide obligation; the deck-language side still does.
{
  const { obligationRegistry } = await import('./lib/ppt-obligations.mjs');
  const en = 'Every formula must enter the same evaluation queue.', zh = '每条公式必须进入相同的评估队列。';
  const items = [{ id: 'en', type: 'MechanismBlock', text: en, languagePairId: 'p', sectionPath: ['T', 'S'] }, { id: 'zh', type: 'MechanismBlock', text: zh, languagePairId: 'p', sectionPath: ['T', 'S'], presentation: 'notes_by_contract' }];
  const base = { title: 'T', prompt: '', generationPolicy: { content: 'overview', details: 'notes', language: { mode: 'source', body: 'primary' }, knowledge: 'source_only' }, source: { text: en + '\n\n' + zh, sha256: 'h', semantic: { inventory: { items } } }, outline: [{ id: 's1', sourceUnitIds: ['en'] }], planning: { slidePlan: [] },
    contentSelection: { sourceHash: 'h', hash: 'l', entries: [{ sourceUnitId: 'en', destination: 'slides' }, { sourceUnitId: 'zh', destination: 'notes', visibleEquivalentSourceUnitId: 'en' }] } };
  const primary = obligationRegistry(base).entries.map(entry => entry.text);
  assert.ok(primary.includes(en) && !primary.includes(zh), 'only the deck-language side is a slide obligation');
  const both = obligationRegistry({ ...base, generationPolicy: { ...base.generationPolicy, language: { mode: 'source', body: 'both' } }, contentSelection: { ...base.contentSelection, entries: [{ sourceUnitId: 'en', destination: 'slides' }, { sourceUnitId: 'zh', destination: 'slides' }] } }).entries.map(entry => entry.text);
  assert.ok(both.includes(zh), 'body=both keeps both languages as obligations');
}
// A fanned-out ASCII drawing keeps its drawing (monospace), not a flattened " / " line.
{
  const { sourceComponent } = await import('./lib/ppt-density-capacity.mjs');
  const drawing = '        Story\n          ↓\n   ┌──────┼──────┐\n   ↓      ↓      ↓\nslide1  slide2  slide3';
  const component = sourceComponent({ id: 'd', type: 'ComparisonBlock', text: 'Story\nslide1 / slide2 / slide3', diagramSource: { kind: 'ascii', relation: 'parallel', text: drawing } });
  assert.equal(component.content.text, drawing); assert.equal(component.content.codeBlock.language, 'diagram');
  const wide = sourceComponent({ id: 'w', type: 'ComparisonBlock', text: 'a / b', diagramSource: { kind: 'ascii', relation: 'parallel', text: 'x'.repeat(90) } });
  assert.ok(!wide.content.codeBlock, 'a drawing too wide for a slide falls back to its source lines');
  assert.equal(wide.type, 'text'); assert.equal(wide.content.text, 'a / b');
}
console.log('PASS content and titles: no notes placeholders, redundancy checks, thin-page enrichment, distinct split-page titles and deck-language closing greeting');

{
 const { _internals: fidelity } = await import('./lib/ppt-template-fidelity.mjs');
 const node={geometry:{x:1,y:2},content:{dataUrl:'data:image/png;base64,'+'a'.repeat(2_000_000),crop:[0,0,0,0],paragraphs:[{runs:[{text:'Original',style:{bold:true}}]}]},nativeRef:{shapeId:3}};
 const copied=fidelity.cloneTemplateValue(node);
 assert.deepEqual(copied,structuredClone(node));
 copied.geometry.x=100;copied.content.crop[0]=.2;copied.content.paragraphs[0].runs[0].style.bold=false;copied.nativeRef.shapeId=9;
 assert.equal(node.geometry.x,1);assert.equal(node.content.crop[0],0);assert.equal(node.content.paragraphs[0].runs[0].style.bold,true);assert.equal(node.nativeRef.shapeId,3);
 console.log('PASS native candidate isolation: mutable geometry/style/crop/refs copied; immutable media bytes preserved');
}

{
 const {templateVisualUnits}=await import('./lib/ppt-presentation-writing.mjs');
 const {inspectTemplateSlotDraft}=await import('./lib/ppt-template-fidelity.mjs');
 assert.equal(templateVisualUnits('Thanks for watching!'),11,'closing greeting exactly fits its eleven-unit native title slot');
 assert.ok(templateVisualUnits('Thanks for watching!!')>11,'genuinely oversized copy still overflows');
 const project={templateFidelity:{mode:'preserve',slides:[{nodes:[],slots:[{shapeId:4,role:'title',capacity:11,fontSizePt:37}]}]}};
 assert.equal(inspectTemplateSlotDraft(project,0,{title:'Thanks for watching!'}).filter(i=>i.code==='template_slot_overflow').length,0);
 assert.equal(inspectTemplateSlotDraft(project,0,{title:'Thanks for watching!!'}).filter(i=>i.code==='template_slot_overflow').length,1);
 console.log('PASS exact native capacity: ending at eleven units accepted; twenty-one ASCII characters rejected');
}

{
 const item=(id,text)=>({id,type:'MechanismBlock',text,sectionPath:['T','Methods']});
 const project={templateFidelity:{mode:'preserve'},generationPolicy:{content:'overview',details:'notes',language:{mode:'source',body:'primary'}},source:{text:'Mechanism and conditions.',semantic:{inventory:{items:[item('a','A complete source mechanism.'),item('b','A related source condition.')],relationships:[]}}}};
 const raw={version:2,selection:[{sourceUnitId:'a',destination:'slides',reason:'Main'},{sourceUnitId:'b',destination:'slides',reason:'Main'}],slides:[{title:'Cover',sourceUnitIds:[]},{title:'Mechanism',sourceUnitIds:['a'],densityFit:{usedHeight:.4,availableHeight:1}},{title:'Conditions',sourceUnitIds:['b'],densityFit:{usedHeight:.7,availableHeight:1}},{title:'End',sourceUnitIds:[]}]};
 const start={rawOutline:raw,issues:[]};let measured=false;
 const merged=await mergeUnderfilledPages(project,start,async(_project,candidate)=>{measured=true;return {rawOutline:{...candidate,slides:candidate.slides.map(s=>({...s,densityFit:{usedHeight:.8,availableHeight:1,predictedOverflow:0}}))},issues:[]};},{low:.55,ignoreBudget:true});
 assert.ok(measured,'a thin native page is tested beside a fuller neighbour using actual merged measurement');assert.equal(merged.rawOutline.slides.length,3);assert.deepEqual(merged.rawOutline.slides[1].sourceUnitIds,['a','b']);
 const rejected=await mergeUnderfilledPages(project,start,async()=>({rawOutline:{...raw,slides:raw.slides.map(s=>({...s,densityFit:{predictedOverflow:1}}))},issues:[]}),{low:.55,ignoreBudget:true});assert.equal(rejected,null,'real capacity failure still prevents the merge');
 console.log('PASS thin native merge: actual combined layout replaces incompatible ratio sums; source ownership retained, overflows rejected');
}

{
 const {bindNotesDisclosures}=await import('./lib/ppt-notes-disclosure.mjs');
 const project={deck:{slides:[{id:'s',nodes:[{id:'generated',content:{derivedFrom:'notes-disclosure',text:'Source details in speaker notes'}},{id:'user',content:{text:'Keep this user note'}}],nodeOrder:['generated','user']}]},source:{text:'Original source'},notes:{complete:'Complete original source notes'}};
 const originalNotes=JSON.stringify(project.notes);bindNotesDisclosures(project);
 assert.deepEqual(project.deck.slides[0].nodeOrder,['user']);assert.equal(project.deck.slides[0].nodes[0].content.text,'Keep this user note');assert.equal(JSON.stringify(project.notes),originalNotes);
 console.log('PASS notes banner removal: legacy generated placeholder and its empty frame removed; original notes and user content retained');
}

const {distinctPageTitles:distinctMixed}=await import('./lib/ppt-page-titles.mjs');
const mixedTopics={generationPolicy:{language:{mode:'output',locale:'en'}},source:{semantic:{inventory:{items:[{id:'principle',sectionPath:['Architecture'],text:'核心思想：模型负责 semantic decisions；软件负责 geometric decisions。'},{id:'overview',sectionPath:['Core Conclusions'],text:'Gamma 的研究。'}]}}}};
const mixedResult=distinctMixed(mixedTopics,[{title:'Architecture',sourceUnitIds:[]},{title:'Architecture',sourceUnitIds:['principle'],focus:'核心思想：模型负责 semantic decisions。'},{title:'Architecture',sourceUnitIds:['overview'],focus:'Gamma 的研究。'}]);
assert.equal(mixedResult.slides[1].title,'Architecture: semantic decisions');assert.equal(mixedResult.slides[2].title,'Architecture: Core Conclusions');assert.ok(mixedResult.slides.every(s=>!/[：:]$/u.test(s.title)&&!/[\p{Script=Han}]/u.test(s.title)));

// Diagram branches cannot become an accidental exhaustive topic assertion.
const routerSource={text:'# Gamma\n\n## Multi-model Orchestration',semantic:{inventory:{items:[{id:'router',type:'ComparisonBlock',sectionPath:['Gamma','Multi-model Orchestration'],text:'MODEL ROUTER\nfast LLM classify rewrite / strong LLM planning research / vision model media image',diagramSource:{kind:'ascii',text:'MODEL ROUTER\n  fast LLM    strong LLM    vision model\n  classify    planning      media'}}]}}};
const routerBefore=JSON.stringify(routerSource),routerTitles=distinctPageTitles({source:routerSource,generationPolicy:{language:{mode:'source'}}},[{title:'Gamma'},{title:'Multi-model Orchestration'},{title:'Multi-model Orchestration',sourceUnitIds:['router'],focus:'Describe routing.'}]);
assert.equal(routerTitles.slides[2].title,'Multi-model Orchestration: MODEL ROUTER diagram');
assert.ok(!routerTitles.slides[2].title.includes('classify'));assert.equal(JSON.stringify(routerSource),routerBefore);
