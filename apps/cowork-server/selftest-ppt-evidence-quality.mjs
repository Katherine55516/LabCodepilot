import assert from 'node:assert/strict';
import { withSemanticIndex } from './lib/ppt-semantic.mjs';
import { evidenceMeasurements, evidenceVisible, missingRequiredEvidence, selectEvidenceForSlide } from './lib/ppt-evidence.mjs';
import { buildPlanning, retrieveSlideSources } from './lib/ppt-planning.mjs';
import { inspectContent } from './lib/ppt-content-qa.mjs';
import { finalQualityReport, normalizeModelReview } from './lib/ppt-quality.mjs';
import { catalogTemplateLayouts, templateContentFit } from './lib/ppt-template-scheduler.mjs';
import { _internals as fidelity, inspectTemplateFidelity } from './lib/ppt-template-fidelity.mjs';
import { semanticMediaForSlide } from './lib/ppt-semantic-media.mjs';

const segments = Array.from({ length: 19 }, (_, index) => ({ id: String(index + 1), location: `chapter ${index + 1}`,
  text: `Background section ${index + 1} describes the general training and evaluation workflow.` }));
segments.push({ id: '20', location: 'serving benchmark slide 6',
  text: 'At the matched 1k/1k workload, GB200 delivers about 10,000 TPS/GPU at around 50 TPS/user, roughly 4× H200.' });
const source = withSemanticIndex({ kind: 'file', name: 'benchmark.html', text: segments.map(item => item.text).join('\n'), segments });
const atom = source.semantic.evidenceAtoms.find(item => item.sourceRef === '20' && item.exactText.includes('10,000'));
assert.ok(atom, 'the source sentence with units must become an evidence atom');
assert.equal(atom.kind, 'number');
assert.equal(atom.location, 'serving benchmark slide 6');
assert.ok(atom.measurements.some(item => item.value === '10000' && item.unit === 'tps/gpu'));
assert.ok(evidenceMeasurements('10,000 TPS/GPU').length === 1);
assert.equal(evidenceVisible(atom, 'At 1k/1k load, GB200 delivered approximately 10,000 TPS/GPU.'), false,
  'one value from a multi-value source sentence cannot stand in for complete evidence');
assert.equal(evidenceVisible(atom, 'At 1k/1k load, GB200 delivered about 10,000 TPS/GPU and 50 TPS/user, roughly 4× H200.'), true);
assert.equal(evidenceVisible({ kind: 'example', exactText: String.raw`\mu - r_f\mathbf{1} \propto \Sigma\, w_{mkt}` },
  'μ − r_f1 ∝ Σw_mkt'), true, 'source equations written in LaTeX match equivalent Unicode notation in the rendered slide');
const sortExample={kind:'example',exactText:String.raw`Construction uses independent $2\times3\times3$ sorts on size, I/A, and ROE (27 portfolios).`};
assert.equal(evidenceVisible(sortExample,'Construction uses independent 2×3×3 sorts on size, I/A, and ROE (27 portfolios).'),true,
  'the exact source example remains visible after the production notation adapter');
assert.deepEqual(evidenceMeasurements('Construction uses 2×3×3 sorts and 27 portfolios.'),[],'multiplication operators are not speedup units');
assert.deepEqual(evidenceMeasurements('Throughput is 4× faster.'),[{raw:'4×',value:'4',unit:'×'}],'a true multiplier measurement remains checked');
assert.equal(evidenceVisible(sortExample,'Construction uses independent 2×3 sorts on size, I/A, and ROE (6 portfolios).'),false,
  'notation equivalence must not accept changed dimensions or portfolio counts');

const outline = [
  { id: 'cover', title: 'Compression', focus: 'Compression', role: 'cover', refs: ['1'], chunkRefs: [source.semantic.chunks[0].id] },
  { id: 'evidence', title: 'Serving throughput evidence', focus: 'Compare GB200 with H200 at matched request lengths',
    role: 'metric', refs: ['1'], chunkRefs: [atom.chunkId], requiredEvidenceIds: [atom.id], visualIntent: { type: 'metric' } },
  { id: 'closing', title: 'Summary', focus: 'Measure real serving cost', role: 'closing', refs: ['20'], chunkRefs: [atom.chunkId] },
];
const project = { pages: 3, prompt: 'Explain serving throughput', source };
const planning = buildPlanning(project, { brief: { audience: 'Engineers', presentationUse: 'technical_explainer' } }, outline);
assert.deepEqual(planning.slidePlan[1].requiredEvidenceIds, [atom.id]);
const retrieval = retrieveSlideSources({ ...project, planning }, outline[1], planning.slidePlan[1]);
assert.ok(retrieval.sourceRefs.includes('20'), 'locked evidence may not be cut by the first-12-ref limit');
assert.ok(retrieval.evidenceAtoms.some(item => item.id === atom.id));
assert.equal(retrieval.requiredEvidenceIds[0], atom.id);

// When a slide carries precise semantic chunk IDs, overlapping segment refs
// must not attach a neighboring chapter's facts or evidence to that slide.
const neighboringAtom = { ...atom, id: 'e_neighboring_chapter', chunkId: 'neighboring-chapter' };
const neighboringChunk = { id: 'neighboring-chapter', sourceRefs: ['20'], topic: 'Velvet quartz',
  text: 'Velvet quartz orchid.' };
const scopedSource = { ...source, semantic: { ...source.semantic,
  chunks: [...source.semantic.chunks, neighboringChunk], evidenceAtoms: [...source.semantic.evidenceAtoms, neighboringAtom] } };
const scopedSlide = { title: 'Serving throughput evidence', focus: 'Compare the serving benchmark',
  chunkRefs: [atom.chunkId], refs: ['20'], visualIntent: { type: 'metric' } };
assert.deepEqual(selectEvidenceForSlide(scopedSource, scopedSlide, 5), [atom.id],
  'chunk IDs take precedence over overlapping segment refs when selecting evidence');
const scopedOutline = [outline[0], { ...outline[1], requiredEvidenceIds: [neighboringAtom.id] }, outline[2]];
const scopedPlanning = buildPlanning({ ...project, source: scopedSource },
  { brief: { audience: 'Engineers', presentationUse: 'technical_explainer' } }, scopedOutline);
assert.deepEqual(scopedPlanning.slidePlan[1].requiredEvidenceIds, [atom.id],
  'an evidence ID from an adjacent chunk is rejected even when it shares a segment ref');
const scopedRetrieval = retrieveSlideSources({ ...project, source: scopedSource }, scopedOutline[1], scopedPlanning.slidePlan[1]);
assert.ok(!scopedRetrieval.chunkIds.includes('neighboring-chapter'),
  'retrieval does not widen a precise chunk selection through an overlapping segment ref');

const missingSlide = { id: 'evidence', title: 'Serving throughput evidence', bullets: ['Throughput improves.'], sourceRefs: ['20'] };
assert.deepEqual(missingRequiredEvidence({ source }, missingSlide, planning.slidePlan[1]).map(item => item.id), [atom.id]);
assert.deepEqual(missingRequiredEvidence({ source }, { ...missingSlide,
  templateSlotTexts: { 4: atom.exactText },
  nodes: [{ type: 'text', nativeRef: { shapeId: 4 }, content: { text: 'Throughput improves.' } }] }, planning.slidePlan[1]).map(item => item.id),
  [atom.id], 'draft slot text cannot override the native text actually exported');
const deck = { slides: [{ id: 'cover', title: 'Compression', bullets: [] }, missingSlide,
  { id: 'closing', title: 'Summary', bullets: [] }] };
const absent = inspectContent({ ...project, outline, planning }, deck);
assert.ok(absent.issues.some(item => item.code === 'required_evidence_missing' && item.severity === 'error'));
assert.ok(absent.issues.some(item => item.code === 'evidence_page_without_evidence'));
assert.equal(absent.metrics.renderedEvidenceCount, 0);
assert.ok(absent.metrics.plannedChunkCoverageRatio > 0);
assert.ok(absent.metrics.coverageRatio < absent.metrics.plannedChunkCoverageRatio, 'source mapping alone cannot count as visible evidence');
deck.slides[1].bullets = ['At the matched 1k/1k workload, GB200 delivers about 10,000 TPS/GPU and around 50 TPS/user, roughly 4× H200.'];
const present = inspectContent({ ...project, outline, planning }, deck);
assert.ok(!present.issues.some(item => ['required_evidence_missing', 'evidence_page_without_evidence', 'visible_numeric_fidelity'].includes(item.code)));
assert.equal(present.metrics.evidenceCoverageRatio, 1);
deck.slides[1].bullets = ['At the matched workload, GB200 delivers 12,000 TPS/GPU.'];
const fabricated = inspectContent({ ...project, outline, planning }, deck);
assert.ok(fabricated.issues.some(item => item.code === 'visible_numeric_fidelity' && item.severity === 'error'));

const quality = finalQualityReport({ issues: [], hardErrors: 0, report: { mode: 'informational', status: 'needs_review', issues: [], metrics: {} } }, [],
  { missing: [], repeated: [], conflicts: [{ slideIds: ['evidence'], detail: 'The benchmark conflicts with its source.' }], unsupported: [] });
assert.equal(quality.status, 'blocked');
assert.equal(quality.publishEligible, false);
assert.equal(quality.editorialReady, false);
assert.throws(() => normalizeModelReview({}, ['evidence']), /all four finding arrays/);
const sourcePage = { id: 'closing', title: 'Sources and limits', bullets: ['Source references are tracked.'], sourceRefs: ['20'] };
assert.ok(inspectContent({ ...project, outline }, { slides: [deck.slides[0], deck.slides[1], sourcePage] }).issues
  .some(item => item.code === 'source_page_without_citation'));

const profiles = [0, 1, 2].map(index => ({ shapeCount: 12, images: index === 1 ? [{ sha: 'large-photo', area: .38 }] : [],
  semantic: { contentSlots: index === 1 ? 7 : 2, semanticUnitCapacity: index === 1 ? 7 : 2,
    ordinalSequence: index === 1 ? [2, 1, 3] : [] } }));
const catalog = catalogTemplateLayouts(profiles);
assert.ok(templateContentFit(catalog[1], { role: 'evidence', semanticUnitBudget: 2 }) >
  templateContentFit(catalog[1], { role: 'evidence', semanticUnitBudget: 7 }), 'large empty regions must be penalized');
assert.equal(catalog[1].orderedFlowCompatible, false);
const numbered = [
  { type: 'text', content: { text: '2' }, nativeRef: { shapeId: 12 }, geometry: { x: 100, y: 100 } },
  { type: 'text', content: { text: '1' }, nativeRef: { shapeId: 13 }, geometry: { x: 300, y: 100 } },
  { type: 'text', content: { text: '3' }, nativeRef: { shapeId: 14 }, geometry: { x: 100, y: 400 } },
];
assert.deepEqual([...fidelity.ordinalReadingOrder(numbered, { height: 1000 })], [[12, '1'], [13, '2'], [14, '3']]);
const mediaProject = { ...project, templateFidelity: { width: 960, height: 540 },
  templateSpec: { palette: { background: '#1c1c1c', accent: '#937331', foreground: '#f5f6fc' } },
  outline: [{ visualIntent: { type: 'process' } }] };
const diagram = semanticMediaForSlide(mediaProject, 0, { geometry: { width: 500, height: 360 } });
assert.equal(diagram,null,'unlabelled decorative rectangles must not be counted as semantic evidence');
const reusedMedia = { templateFidelity: { mode: 'preserve', width: 100, height: 100,
  slides: Array.from({ length: 4 }, (_, index) => ({ index, shapeCount: 1, imageCount: 1, nodes:[{type:'image',nativeRef:{shapeId:7},content:{imageSha256:'same-photo'},geometry:{x:0,y:0,width:70,height:60}}], slots: [], variant: { kind: 'original' } })) },
  outline: Array.from({ length: 4 }, () => ({ visualIntent: { type: 'metric' } })),
  deck: { slides: Array.from({ length: 4 }, (_, index) => ({ id: `m${index}`, nodes: [{ type: 'image',
    nativeRef: { slideIndex: index, shapeId: 7 }, content: { imageSha256: 'same-photo' },
    geometry: { x: 0, y: 0, width: 70, height: 60 } }] })) } };
const mediaIssues = inspectTemplateFidelity(reusedMedia);
assert.ok(mediaIssues.some(item => item.code === 'template_dominant_media_reuse'));
const missingNativeSnapshot=structuredClone(reusedMedia);delete missingNativeSnapshot.templateFidelity.slides[0].nodes;assert.ok(inspectTemplateFidelity(missingNativeSnapshot).some(i=>i.code==='template_asset_loss')); 
assert.ok(mediaIssues.some(item => item.code === 'template_semantic_media_mismatch'));
const calloutImage = { type: 'image', geometry: { x: 70, y: 550, width: 1425, height: 165 },
  content: { dataUrl: 'data:image/png;base64,placeholder' } };
const calloutText = { type: 'text', geometry: { x: 86, y: 580, width: 1390, height: 100 },
  content: { text: 'A new source-grounded callout.' } };
assert.equal(fidelity.safeDecorativeMedia(calloutImage, { width: 1600, height: 900 },
  { nodes: [calloutImage, calloutText] }), true, 'a wide raster banner behind editable text keeps its styling');
assert.equal(fidelity.textOverlayCalloutPanel(calloutImage, { width: 1600, height: 900 },
  { nodes: [calloutImage, calloutText] }), true, 'a text-backed callout retains its original high-contrast panel instead of receiving an unrelated generated image');
console.log('PPT evidence atoms, retrieval, visible QA, publish gate and template read order: OK');

// A v2 page owns its selected source units, not every formula in a coarse chapter chunk.
const scopeExample={text:'y = a + b\nA separate explanation.',semantic:{chunks:[{id:'chapter',text:'y = a + b\nA separate explanation.'}],inventory:{items:[{id:'formula',type:'EquationBlock',text:'y = a + b',chunkRefs:['chapter'],source_ref:['1']},{id:'explanation',type:'MechanismBlock',text:'A separate explanation.',chunkRefs:['chapter'],source_ref:['1']}],relationships:[]},evidenceAtoms:[]}};
const scopedPlans=buildPlanning({source:scopeExample,pages:3},{},[{id:'cover',title:'Cover'},{id:'body',title:'Worked explanation',focus:'Explain the condition',planningProtocolVersion:2,sourceUnitIds:['explanation'],chunkRefs:['chapter']},{id:'end',title:'Closing'}]).slidePlan;
assert.deepEqual(scopedPlans[1].requiredDetails,[],"neighboring formula must not become this page's mandatory detail");
const ownedFormulaPlans=buildPlanning({source:scopeExample,pages:3},{},[{id:'cover',title:'Cover'},{id:'body',title:'Worked example',planningProtocolVersion:2,sourceUnitIds:['formula'],chunkRefs:['chapter']},{id:'end',title:'Closing'}]).slidePlan;
assert.ok(ownedFormulaPlans[1].requiredDetails.includes('y = a + b'),'actual owned formula remains required');
