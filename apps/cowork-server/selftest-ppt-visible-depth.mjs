import assert from 'node:assert/strict';
import { estimatePageRecommendation, sourceCapacityPlan, retrieveSlideSources } from './lib/ppt-planning.mjs';
import { _internals as api } from './lib/ppt-api.mjs';
import { _internals as fidelity, inspectTemplateSlotDraft, templateSlotPrompt } from './lib/ppt-template-fidelity.mjs';
import { inspectContent } from './lib/ppt-content-qa.mjs';
import { inspectSlideCopy, visibleBodyTarget, templateVisualUnits } from './lib/ppt-presentation-writing.mjs';
import { deckReviewPrompt, repairProject, finalQualityReport } from './lib/ppt-quality.mjs';

const source = { kind: 'file', name: 'course_overview.md', text: Array.from({ length: 14 }, (_, i) => `## ${i + 1}. Chapter ${i + 1}\nDetailed research evidence.`).join('\n'),
  segments: Array.from({ length: 32 }, (_, i) => ({ id: String(i + 1), location: `Paragraph ${i + 1}`, text: `Source statement ${i + 1}` })),
  semantic: { chunks: Array.from({ length: 14 }, (_, i) => ({ id: `c${i}`, topic: `Chapter ${i + 1}`, text: `Source statement ${i + 1}`, sourceRefs: [String(i + 1)], sourceBlocks: [],
    sectionPath: ['Course', `Chapter ${i + 1}`], tokenCount: i === 1 ? 8100 : 200, priority: 'high', contentKind: 'concept', visualCandidates: [] })), blocks: [], evidenceAtoms: [] } };
const project = { inputProfile: { level: 'rich' }, source, prompt: 'Create a rigorous presentation from course_overview.md.' };
const estimate = estimatePageRecommendation(project);
assert.equal(estimate.estimationBasis, 'readable_content_capacity');
assert.equal(estimate.depthPolicy, 'strict');
assert.ok(estimate.recommended > 16);
assert.equal(estimatePageRecommendation({ ...project, pages: 10 }).selected, 10);
assert.equal(estimatePageRecommendation({ ...project, prompt: 'Create an overview of this course' }).estimationBasis, 'overview_chapters');
assert.ok(sourceCapacityPlan(source).sections.find(s => s.title === 'Chapter 2').slides >= 3);
const refs = source.segments.map(s => s.id);
const chunks = source.semantic.chunks.map(c => c.id);
const outline = api.normalizeOutline({ slides: Array.from({ length: 3 }, (_, i) => ({ title: `Page ${i}`, focus: 'Statement', refs: [...refs, 'invalid', '1'], chunkRefs: [...chunks, 'invalid'] })) }, 3, source);
assert.deepEqual(outline[1].refs, refs);
assert.deepEqual(outline[1].chunkRefs, chunks);
assert.ok(retrieveSlideSources(project, outline[1], {}).sourceRefs.includes('32'));

const inch = x => x * 914400;
const nodes = [
  [1, 'Research', .4, .3, 10, .6, 32],
  [2, 'A complete explanation of the pricing mechanism and its important assumptions.', .4, 2, 1.7, 2, 14],
  [3, 'Beta', 3, 2, 1.2, .2, 12],
  [4, 'Body explanation', 4, 2, 6, 3, 16],
].map(([shapeId, text, x, y, w, h, fontSizePt]) => ({ id: `n${shapeId}`, type: 'text', nativeRef: { shapeId }, content: { text },
  nativeTextFrame: { wordWrap: true, margins: [0, 0, 0, 0], paragraphs: [{ text, runs: [{ text, fontSizePt }] }] },
  geometry: { x: inch(x), y: inch(y), width: inch(w), height: inch(h) }, style: { fontSizePt } }));
const slots = fidelity.slotsFor({ nodes });
assert.equal(slots.find(s => s.shapeId === 2).purpose, 'body', 'narrow multiline explanations are not labels');
assert.equal(slots.find(s => s.shapeId === 3).purpose, 'label', 'real short labels remain compact');
const listNode = { ...nodes[2], id: 'list', nativeRef: { shapeId: 5 }, content: { text: 'First detail\nSecond detail' },
 geometry: { ...nodes[2].geometry, y: inch(2.45), height: inch(.7) },
 nativeTextFrame: { wordWrap: true, margins: [0,0,0,0], paragraphs: ['First detail','Second detail'].map(text => ({text,runs:[{text,fontSizePt:12}]})) } };
const groupedSlots = fidelity.slotsFor({ nodes: [...nodes, listNode] });
assert.equal(groupedSlots.find(s=>s.shapeId===5).groupId, 3, 'narrow card labels remain attached to their list explanations');
assert.equal(groupedSlots.find(s=>s.shapeId===3).purpose, 'point-heading');
const groupedProfile = fidelity.profileSourceSlide({ nodes: [...nodes, listNode] }, { width: inch(13), height: inch(8) });
assert.equal(groupedProfile.semantic.semanticUnitCapacity, new Set(groupedSlots.filter(s=>s.role==='content'&&s.purpose!=='footnote').map(s=>s.groupId)).size);

const spec = { nodes, slots };
const contract = { slideId: 'body', role: 'mechanism', depth: 'detailed', requiredSupport: ['implication'] };
const deckProject = { pages: 3, inputProfile: { level: 'rich' }, source: { text: '', segments: [] }, templateFidelity: { mode: 'preserve', slides: [spec, spec, spec] },
  planning: { slidePlan: [contract], coverage: [], brief: { depthPolicy: 'strict' } } };
const shallow = { id: 'body', title: 'Research', bullets: [], nodes: [], copy: { blocks: [], takeaway: 'Hidden implication' }, factSynthesis: { implications: ['Hidden implication'] },
  templateSlotTexts: { 2: 'Costs matter.', 3: 'Beta', 4: 'A small explanation.' } };
assert.ok(inspectTemplateSlotDraft(deckProject, 1, shallow).some(i => i.code === 'template_copy_sparse'));
const omitted = { ...shallow, templateOmissions: [{ shapeId: 4, reason: 'Remove the important body region' }] };
assert.ok(inspectTemplateSlotDraft(deckProject, 1, omitted).some(i => i.code === 'template_copy_sparse'), 'omission cannot bypass body budget');
assert.match(templateSlotPrompt(deckProject, 1), /可见目标/);
const nativeOutline = [{ id: 'cover', title: 'Cover', focus: 'Cover', refs: [] }, { id: 'body', title: 'Research', focus: 'Pricing mechanism', refs: [] }, { id: 'end', title: 'End', focus: 'Summary', refs: [] }];
const longBody = 'A source-supported mechanism explains the pricing conditions. '.repeat(12);
const normalizedBody = api.normalizeSlide({ title: 'Research', slotTexts: { 4: longBody } }, nativeOutline[1], { ...deckProject, outline: nativeOutline });
assert.equal(normalizedBody.templateSlotTexts['4'], longBody, 'native bodies over 500 characters must not be silently clipped');
assert.throws(() => api.normalizeSlide({ title: 'Research', slotTexts: { 4: 'x'.repeat(5001) } }, nativeOutline[1], { ...deckProject, outline: nativeOutline }), /safety limit/);
assert.ok(!inspectTemplateSlotDraft(deckProject, 1, { ...shallow, templateSlotTexts: { ...shallow.templateSlotTexts, 3: 'I/A' } }).some(i => i.code === 'template_text_fragment' && i.shapeId === 3), 'financial ratio labels are not unfinished English articles');

const wrapped = { ...nodes[2], id:'wrapped', nativeRef:{shapeId:6}, style:{fontSizePt:16}, content:{text:'Main\nCompetitors'},
 geometry:{x:inch(.7),y:inch(2),width:inch(2.1),height:inch(.6)}, nativeTextFrame:{wordWrap:true,margins:[0,0,0,0],paragraphs:['Main','Competitors'].map(text=>({text,runs:[{text,fontSizePt:16}]}))} };
const wrappedList = {...listNode, nativeRef:{shapeId:7},geometry:{x:inch(.7),y:inch(2.7),width:inch(2.1),height:inch(1.5)},style:{fontSizePt:13}};
const inlineCaption = {...nodes[2],nativeRef:{shapeId:8},content:{text:'Current status'},style:{fontSizePt:11},geometry:{x:inch(2.65),y:inch(2.03),width:inch(3),height:inch(.25)}};
const wrappedSlots=fidelity.slotsFor({nodes:[nodes[0],wrapped,wrappedList,inlineCaption]});
assert.equal(wrappedSlots.find(s=>s.shapeId===6).purpose,'point-heading','wrapped short headings are not two list facts');
assert.equal(wrappedSlots.find(s=>s.shapeId===7).groupId,6);
assert.equal(wrappedSlots.find(s=>s.shapeId===8).pairedWith,6,'inline card caption remains paired with its heading');
const groupLabel={...nodes[2],nativeRef:{shapeId:9},content:{text:'Critical Elements'},style:{fontSizePt:19.5},geometry:{x:inch(.7),y:inch(3.8),width:inch(10),height:inch(.34)}};
const smallHeaders=[.9,3.9].map((x,i)=>({...nodes[2],nativeRef:{shapeId:10+i},content:{text:'Card heading'},style:{fontSizePt:16},geometry:{x:inch(x),y:inch(5.2),width:inch(2.4),height:inch(.28)}}));
const labelSlots=fidelity.slotsFor({nodes:[nodes[0],groupLabel,...smallHeaders]});
assert.equal(labelSlots.find(s=>s.shapeId===9).purpose,'group-heading','wide subsection labels do not consume independent facts');
assert.equal(fidelity.profileSourceSlide({nodes:[nodes[0],groupLabel,...smallHeaders]},{width:inch(13),height:inch(8)}).semantic.semanticUnitCapacity,2);
const reclaimSize={width:inch(13),height:inch(8)};
const removedChart={id:'old-chart',type:'image',nativeRef:{shapeId:30},geometry:{x:inch(1),y:inch(2),width:inch(4),height:inch(2.5)},content:{}};
const reclaimBody={...nodes[3],nativeRef:{shapeId:31},content:{text:'A detailed account of the old sales process with several explanations.'},style:{fontSizePt:13,fontWeight:400},geometry:{x:inch(5.1),y:inch(2),width:inch(5.8),height:inch(1)}};
const overlapBody={...nodes[3],nativeRef:{shapeId:32},geometry:{x:inch(5.1),y:inch(3.4),width:inch(2),height:inch(.6)}};
const reclaimSource={source:{text:'Unrelated equity factor tutorial'}};
assert.equal(fidelity.reclaimedMediaTextFrames(reclaimSource,{nodes:[nodes[0],removedChart,reclaimBody]},reclaimSize).size,1,'plain body may reclaim empty media space');
assert.equal(fidelity.reclaimedMediaTextFrames(reclaimSource,{nodes:[nodes[0],removedChart,reclaimBody,overlapBody]},reclaimSize).size,0,'reclaim cannot cover retained text');
const shortBold={...reclaimBody,content:{text:'Probability to Close'},style:{fontSizePt:14.5,fontWeight:700},geometry:{...reclaimBody.geometry,height:inch(.3)}};
assert.equal(fidelity.reclaimedMediaTextFrames(reclaimSource,{nodes:[nodes[0],removedChart,shortBold]},reclaimSize).size,0,'short bold headings are not body-space donors');
assert.equal(fidelity.slotsFor({nodes:[nodes[0],shortBold]}).find(s=>s.shapeId===31).purpose,'label');
const tableSource={text:'',segments:[],semantic:{chunks:[{id:'taxonomy',sourceBlocks:['table']}],evidenceAtoms:[],blocks:[{id:'table',type:'table',text:'| Type | Meaning |\n|---|---|\n'+['Alpha','Beta','Gamma','Delta','Epsilon','Zeta','Eta','Theta'].map(label=>`| ${label} | source-supported explanation |`).join('\n')}]}};
const tableDeck={source:tableSource,planning:{brief:{depthPolicy:'strict'}},outline:[{id:'types',chunkRefs:['taxonomy']}],deck:{slides:[{id:'types',title:'Eight types',nodes:[{...nativeNode(),content:{text:'Alpha Beta Gamma Delta Epsilon Zeta'}}]}]}};
function nativeNode(){return {id:'table-copy',type:'text',nativeRef:{shapeId:99},templateSlot:{mapped:true,role:'content',purpose:'body'}};}
const missingRows=inspectContent(tableDeck);
assert.deepEqual(missingRows.issues.find(i=>i.code==='source_table_rows_missing').missingRows,['Eta','Theta']);
assert.equal(missingRows.metrics.renderedTableRows,6);
assert.equal(inspectContent({...tableDeck,compressionApproved:true}).issues.find(i=>i.code==='source_table_rows_missing').severity,'warning');
const tableIntent={...tableDeck,outline:[{...tableDeck.outline[0],visualIntent:{type:'table'}}],deck:{slides:[{...tableDeck.deck.slides[0],title:'Types'}]}};
assert.equal(inspectContent(tableIntent).issues.find(i=>i.code==='source_table_rows_missing').severity,'error','table intent retains every source row without a numeric title');
assert.ok(inspectContent({...tableIntent,deck:{slides:[{...tableIntent.deck.slides[0],title:'Seven types'}]}}).issues.some(i=>i.code==='source_table_cardinality'));
const translated={...tableDeck,deck:{slides:[{...tableDeck.deck.slides[0],nodes:[{...nativeNode(),content:{text:'已经翻译为中文的各个类别说明。'.repeat(10)}}]}]}};
assert.equal(inspectContent(translated).issues.find(i=>i.code==='source_table_rows_missing').severity,'warning','English exact-name checks cannot block translated bodies');
const splitTable={...tableDeck,outline:[...tableDeck.outline,{id:'more',chunkRefs:['taxonomy']}],deck:{slides:[...tableDeck.deck.slides,{id:'more',title:'Remaining types',nodes:[{...nativeNode(),content:{text:'Eta Theta'}}]}]}};
assert.ok(!inspectContent(splitTable).issues.some(i=>i.code==='source_table_rows_missing'),'mapped split pages can collectively preserve a table');

assert.ok(!inspectTemplateSlotDraft(deckProject,1,{...shallow,templateSlotTexts:{...shallow.templateSlotTexts,3:'Risk I/A'}}).some(i=>i.code==='template_text_fragment'&&i.shapeId===3),'ratio suffixes in a named label are complete');
assert.ok(visibleBodyTarget(1000, 'detailed') >= 400);
assert.ok(inspectSlideCopy(shallow, contract, 1, 3, { templatePreserved: true }).some(i => i.missingSupport?.includes('implication')));
const native = nodes.slice(1).map(node => ({ ...node, content: { text: node.nativeRef.shapeId === 3 ? 'Beta' : 'Costs matter.' }, templateSlot: { mapped: true, role: 'content', purpose: 'body', groupId: node.nativeRef.shapeId } }));
const qa = inspectContent({ ...deckProject, deck: { slides: [{ id: 'cover', title: 'Cover' }, { ...shallow, nodes: native }, { id: 'end', title: 'End' }] } });
assert.ok(qa.issues.some(i => i.code === 'copy_generic_filler'));
assert.equal(qa.metrics.semanticUnitsPerSlide.find(s => s.slideId === 'body').units, 3);
assert.equal(qa.metrics.visibleContentUnitsPerSlide.find(s => s.slideId === 'body').units,templateVisualUnits(native.map(node=>node.content.text).join(' ')), 'native QA and physical slot budgets share one unit scale');
assert.ok(qa.metrics.visibleContentUnitsPerSlide.find(s => s.slideId === 'body').units < 30, 'QA measures exported nodes, not stale drafts');
const longText = 'Evidence '.repeat(35) + 'TAIL_REQUIRED_CONDITION';
const reviewProject = { ...deckProject, deck: { slides: [{ ...shallow, nodes: [{ ...native[0], content: { text: longText } }], sourceRefs: ['32'] }] },
  source: { segments: [{ id: '32', location: 'Late paragraph', text: 'Late required evidence' }] } };
assert.match(deckReviewPrompt(reviewProject), /TAIL_REQUIRED_CONDITION/);
assert.match(deckReviewPrompt(reviewProject), /Late required evidence/);
const singleRefEvidence = { ...reviewProject, planning: { slidePlan: [{slideId: 'body', requiredEvidenceIds: ['late']} ] },
  deck: { slides: [{...reviewProject.deck.slides[0],sourceRefs: []}] }, source: { ...reviewProject.source,
    semantic: { evidenceAtoms: [{id:'late',kind:'condition',sourceRef:'32',exactText:'A distinct exact excerpt'}] } } };
assert.match(deckReviewPrompt(singleRefEvidence), /Late required evidence/, 'required evidence with only a single sourceRef retains its full source context');
const repaired = repairProject({ ...deckProject, deck: { slides: [{ ...shallow, copy: { blocks: [] }, nodes: native, layoutId: 'summary' }] } }, { issues: [] });
assert.ok(!repaired.repairs.some(r => r.action === 'materialized source-grounded takeaway'), 'native template repairs must not claim an invisible takeaway');
const coverageQa = inspectContent({ ...deckProject, planning: { ...deckProject.planning, coverage: [{ chunkId: 'c1', priority: 'high', action: 'unmapped', topic: 'Required' }] }, deck: { slides: [] } });
assert.ok(coverageQa.issues.some(i => i.code === 'source_coverage' && i.severity === 'error'));
assert.equal(finalQualityReport({ strictCoverage: true, hardErrors: 0, issues: [] }, [], { missing: [{ slideIds: ['body'], detail: 'Required mechanism absent' }], repeated: [], conflicts: [], unsupported: [] }).publishEligible, false);
console.log('PPT chapter capacity, complete provenance, native visible depth and reviewer context: OK');
