import { scopeReview } from './ppt-scope-test-helpers.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { spawnSync } from 'node:child_process';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-density-'));
process.env.COWORK_STATE_DIR = root;
const [{ normalizePaste }, planning, capacity, packing, profile, qa, artifacts, api, store, templates] = await Promise.all([
  import('./lib/ppt-source.mjs'), import('./lib/ppt-planning.mjs'), import('./lib/ppt-density-capacity.mjs'),
  import('./lib/ppt-density-packing.mjs'), import('./lib/ppt-density-profile.mjs'), import('./lib/ppt-density-qa.mjs'),
  import('./lib/ppt-source-artifacts.mjs'), import('./lib/ppt-api.mjs'), import('./lib/ppt-store.mjs'), import('./lib/ppt-template.mjs')]);
const config = { version: 1, detail: 'balanced', language: { mode: 'source' }, knowledge: 'source_only' };
const auto = { source: 'estimate', mode: 'auto', confirmedAt: null };
let checks = 0; const checked = () => checks++;
try {
  for (const domain of ['Research measurement', 'Business operating review', 'Product service architecture']) {
    const prose = 'The owner compares the recorded result with the agreed condition before the decision. ';
    const text = `# ${domain}\n\n` + Array.from({ length: 14 }, (_, i) => `## Chapter ${i + 1}\n\n${prose.repeat(3)}`).join('\n\n');
    const source = normalizePaste(text), base = { inputKind: 'paste', source, generationPolicy: config };
    const r = planning.estimatePageRecommendation(base);
    assert.equal(r.estimationBasis, 'gamma_density_capacity');
    assert.ok(r.recommended < 16, 'remove 14 chapter + 2 mandatory page floor');
    assert.equal(planning.estimatePageRecommendation({ inputKind: 'prompt', prompt: text, generationPolicy: config }).recommended, r.recommended);
    assert.equal(planning.estimatePageRecommendation({ source: { ...source, kind: 'file' }, generationPolicy: config }).recommended, r.recommended);
    assert.ok(planning.estimatePageRecommendation({ ...base, generationPolicy: { ...config, detail: 'detailed' } }).contentCost > r.contentCost);
    const flat = normalizePaste(`# ${domain}\n\n${Array(14).fill(prose.repeat(3)).join('\n\n')}`);
    assert.equal(planning.estimatePageRecommendation({ ...base, source: flat }).recommended, r.recommended);
    assert.equal(planning.estimatePageRecommendation({ ...base, pages: 10 }).selected, 10);
    checked();
  }
  assert.equal(profile.automaticPages({ pageDecision: { ...auto, confirmedAt: '2026-10-06' } }), false);
  assert.equal(profile.automaticPages({ pageDecision: auto, externalPptx: {} }), false);
  assert.equal(profile.automaticPages({ pageDecision: auto, update: {} }), false);
  const richShort = { prompt: 'Explain platform architecture', inputKind: 'prompt' };
  assert.ok(planning.estimatePageRecommendation({ ...richShort, generationPolicy: { detail: 'detailed' } }).recommended > planning.estimatePageRecommendation(richShort).recommended); checked();
  const source = normalizePaste('# Validation\n\n## Comparison\n\n| Object | Condition |\n|---|---|\n| Queue | Before execution |\n| Result | After review |\n\n## Checklist\n\n- Verify owner.\n- Confirm evidence.\n- Record decision.\n\n## Summary\n\nValidation connects the result to evidence and the responsible owner.');
  const table = source.semantic.inventory.items.find(i => i.type === 'TableBlock');
  const checklist = source.semantic.inventory.items.find(i => i.type === 'ChecklistBlock');
  const base = { id: 'test', source, pages: 8, pageDecision: auto, templateSpec: templates.snapshotTemplate(templates.BUILT_INS[2]) };
  const body = (id, text) => ({ id, section: 'Validation', title: id, focus: text, question: 'How is the decision validated?',
    keyPoints: [{ text, refs: table.source_ref, chunkRefs: table.chunkRefs }], refs: table.source_ref, chunkRefs: table.chunkRefs });
  const raw = { slides: [{ id: 'cover', title: 'Validation', focus: 'Validation overview', refs: [] },
    body('a', 'The owner compares the recorded result with the agreed condition.'),
    body('b', 'Review happens before the decision; record the evidence and responsibility.'),
    { id: 'end', title: 'Validation summary', focus: 'Retain evidence and responsibility.', keyPoints: [{ text: 'Retain evidence and responsibility.' }], refs: [] }] };
  raw.slides[1].sourceUnitIds=[table.id,checklist.id];
  raw.slides[2].sourceUnitIds=[];
  raw.slides[3].sourceUnitIds=[source.semantic.inventory.items.find(i=>i.type==='SummaryBlock').id];
  const packed = packing.packOutline(base, raw);
  assert.equal(packed.slides.length, 3); assert.equal(packed.densityPacking.mergeCount, 1);
  assert.equal(packed.slides[1].keyPoints.length, 2); assert.ok(packed.slides[1].densityFit.capacity_ok);
  assert.deepEqual(packed.slides[1].chunkRefs, [...new Set([...table.chunkRefs,...checklist.chunkRefs])]); checked();
  assert.equal(packing.packOutline(base, {slides:raw.slides.map((s,i)=>i===2?{...s,question:'A different reader question'}:s)}).slides.length, 4); checked();
  assert.equal(packing.packOutline({ ...base, pageDecision: { source: 'user', mode: 'explicit' } }, raw).slides.length, 4);
  assert.throws(() => packing.packOutline(base, { slides: raw.slides.map(s => ({ ...s, sourceUnitIds: ['unknown'] })) }), /unknown source/); checked();
  const {coverageMapV2}=await import('./lib/ppt-content-inventory.mjs');
  const ownership=coverageMapV2({...source,semantic:{...source.semantic,inventory:{...source.semantic.inventory,items:[table,{...checklist,chunkRefs:table.chunkRefs}]}}},[{id:'owned',sourceUnitIds:[table.id],chunkRefs:table.chunkRefs}]);
  assert.deepEqual(ownership.detail.find(item=>item.sourceUnitId===table.id).slideIds,['owned']);
  assert.deepEqual(ownership.detail.find(item=>item.sourceUnitId===checklist.id).slideIds,[]); checked();
  const components = [capacity.sourceComponent(table), capacity.sourceComponent(checklist), { type: 'text', content: { text: 'The owner reviews the condition before deciding.' } }];
  const fit = capacity.fitComponents(components, base);
  assert.ok(fit.capacity_ok); assert.ok(fit.boxes.every(b => b.height < fit.canvas.height), 'natural heights, not full-height white rectangles');
  assert.ok(fit.boxes.every(b => b.y + b.height <= fit.canvas.y + fit.canvas.height));
  assert.equal(capacity.fitComponents([{ type: 'text', content: { text: 'Long explanation '.repeat(1000) } }], base).capacity_ok, false);
  assert.ok(capacity.fitComponents(components, { templateFidelity: { width: 5000000, height: 3000000 } }).predictedOverflow > 0); checked();
  const plan = { slidePlan: [{ slideId: 'main', sourceArtifacts: [table, checklist].map(i => ({ sourceUnitId: i.id })) }] };
  const slide = { id: 'main', sourceRefs: table.source_ref, nodes: [] };
  artifacts.bindSourceArtifacts({ ...base, planning: plan }, slide, [table, checklist].map(i => ({ sourceUnitId: i.id })), 1, ['Review the condition before deciding.']);
  assert.equal(slide.nodes.length, 3); assert.deepEqual(slide.nodes.find(n => n.type === 'table').content.rows, table.rows);
  assert.ok(slide.nodes.some(n => n.semanticRole === 'source-explanation'));
  assert.equal(slide.nodes.find(n=>n.type==='table').style.tableHeaderColor,'#ffffff'); checked();
  assert.throws(() => artifacts.bindSourceArtifacts({ ...base, planning: { slidePlan: [{ slideId: 'main', sourceArtifacts: [{ sourceUnitId: table.id, rowStart: 1, rowEnd: 2 }] }] } }, { id: 'main', nodes: [] }, [{ sourceUnitId: table.id }], 1), /differs from page contract/); checked();
  const visible = qa.inspectDensity(base, [ { id: 'cover', nodes: [] }, slide ]).metrics.visibleDensityPerSlide[1];
  assert.ok(visible.actualTextChars > 40); assert.ok(visible.visibleVisualUnits > 0);
  const hidden = { ...slide, nodes: slide.nodes.map(n => ({ ...n, hidden: true })), copy: { blocks: [{ body: 'fake depth '.repeat(500) }] } };
  assert.equal(qa.inspectDensity(base, [{ id: 'cover' }, hidden]).metrics.visibleDensityPerSlide[1].actualTextChars, 0); checked();
  const thin = id => ({ id, nodes: [{ type: 'text', semanticRole: 'body', content: { text: 'The result requires review before the decision.' } }] });
  const qr = qa.inspectDensity({ ...base, source: { ...source, text: source.text.repeat(30) }, outline: [raw.slides[0], { ...raw.slides[1], id: 'a' }, { id: 'middle', question: 'An unrelated question' }, { ...raw.slides[2], id: 'b' }] }, [{ id: 'cover' }, thin('a'), thin('middle'), thin('b')]);
  assert.ok(qr.issues.some(i => i.code === 'gamma_density_underfill'));
  assert.ok(qr.metrics.densityMergeCandidates.some(m => m.slideIds.join(',') === 'a,b')); checked();
  const uid = 'density-test';
  const deps = { ...api._internals.defaultDeps, extractFile: async () => ({ ...source, kind: 'file' }), modelCall: async (p, prompt) => {
    assert.match(prompt, /gamma-reference-v1/);
    if (p.pageDecision.mode === 'auto') { assert.match(prompt, /初步建议，不是最终页数命令/); assert.ok(!prompt.includes(`slides 必须恰好 ${p.pages}`)); }
    return { brief: { presentationUse: 'course_walkthrough' }, ...raw };
  } };
  async function request(method, route, data) {
    const req = Readable.from(data ? [Buffer.from(JSON.stringify(data))] : []); req.method = method;
    let result; await api.handlePpt(req, new URL(`http://test/ppt/${route}`), { uid, deps, activity: () => {}, log: () => {}, res: {}, send: (status, body) => { result = { status, body }; return true; } }); return result;
  }
  async function settle(id) {
    for (let n = 0; n < 400; n++) { const p = store.get(uid, id); if (p && ['outline_ready','failed'].includes(p.status)) return p; await new Promise(r => setTimeout(r, 10)); }
    throw new Error('outline did not settle');
  }
  for (const kind of ['paste','file','prompt']) {
    const created = await request('POST', 'projects', { inputKind: kind, text: source.text, prompt: kind === 'prompt' ? source.text : 'Explain the supplied material',
      ...(kind === 'file' ? { fileName: 'validation.html', fileBase64: Buffer.from('<html><body>'+source.text+'</body></html>').toString('base64') } : {}), generationPolicy: config, template: 'light', model: 'simulated', configId: 'simulation' });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const ready = await settle(created.body.project.id);
    assert.equal(ready.status, 'outline_ready', ready.error); assert.equal(ready.pages, 3);
    assert.equal(ready.pageDecision.mode, 'auto'); assert.equal(ready.pageDecision.confirmedAt, null);
    assert.equal(ready.planning.densityPacking.mergeCount, 1); checked();
    await request('DELETE', `projects/${ready.id}`);
  }
  const explicit = await request('POST', 'projects', { inputKind: 'paste', text: source.text, prompt: 'Explain validation', pages: 4, template: 'light', configId: 'simulation' });
  const fixed = await settle(explicit.body.project.id); assert.equal(fixed.pages, 4); assert.equal(fixed.pageDecision.mode, 'explicit'); checked();
  // Entire existing generation/review/publish pipeline, model simulated but
  // source-owned structures and the native PowerPoint exporter are real.
  const summary = source.semantic.inventory.items.find(item => item.type === 'SummaryBlock');
  const exportDir = process.env.PPT_DENSITY_OUTPUT_DIR || root;
  fs.mkdirSync(exportDir, {recursive:true});
  const smokeRaw = {slides:raw.slides.map((s,i) => i===1 ? {...s,sourceUnitIds:[table.id]} : i===2 ? {...s,sourceUnitIds:[checklist.id]} : i===3 ? {...s,sourceUnitIds:[summary.id],keyPoints:[{text:summary.text}]} : s)};
  const { buildRenderTree } = await import('./lib/ppt/render-tree.mjs');
  const renderer = (await import('./lib/ppt-render.mjs'))._internals;
  const python = process.env.PPT_TEST_PYTHON || 'python3';
  deps.modelCall = async (p, prompt, activity, log, options={}) => {
    if(prompt.includes('叙事规划器'))return {brief:{presentationUse:'course_walkthrough'},...smokeRaw};
    if(options.nodeKey?.startsWith('review:deck'))return scopeReview(p);
    const index=Number(prompt.match(/第 (\d+) 页/)?.[1])-1;
    return index===1 ? {title:p.outline[index].title,sourceArtifacts:[table,checklist].map(item=>({sourceUnitId:item.id})),sourceCommentary:['The owner compares the recorded result with the agreed condition before the decision.']} :
      {title:p.outline[index].title,contentBlocks:index===0?[]:[{type:'implication',heading:'Validation',body:summary.text}]};
  };
  deps.renderPptx = async p => {
    const filename = path.join(exportDir,'density-native-smoke.pptx');
    const {exportManifest}=await import('./lib/ppt-export-integrity.mjs');
    const data = {exportManifest:exportManifest(p),slides:p.deck.slides,renderTree:buildRenderTree(p),palette:p.templateSpec.palette,fonts:p.templateSpec.fonts};
    if(process.env.PPT_DENSITY_OUTPUT_DIR)fs.writeFileSync(path.join(exportDir,'density-render-payload.json'),JSON.stringify(data,null,2));
    const result=spawnSync(python,['-c',renderer.SCRIPT],{input:JSON.stringify(data),env:{...process.env,PPT_OUTPUT:filename},encoding:'utf8',maxBuffer:2000000});
    assert.equal(result.status,0,result.stderr);
    return JSON.parse(result.stdout);
  };
  const native=await request('POST','projects',{inputKind:'paste',text:source.text,prompt:'Explain validation',generationPolicy:config,template:'light',configId:'simulation'});
  const ready=await settle(native.body.project.id);assert.equal(ready.pages,3);assert.equal(ready.status,'outline_ready',ready.error);
  assert.equal((await request('POST',`projects/${ready.id}/generate`)).status,202);
  let published;
  for(let n=0;n<600;n++){published=store.get(uid,ready.id);if(['completed','quality_blocked','failed'].includes(published.status))break;await new Promise(r=>setTimeout(r,10));}
  assert.equal(published.status,'completed',JSON.stringify({error:published.error,quality:published.quality}));
  assert.ok(published.pageDecision.confirmedAt);assert.equal(published.pages,3);assert.ok(published.pageDecision.fitValidated);
  const inspectScript="import sys,json\nfrom pptx import Presentation\np=Presentation(sys.argv[1]);t=[s.table for slide in p.slides for s in slide.shapes if s.has_table]\nprint(json.dumps({'pages':len(p.slides),'tables':[[[c.text for c in r.cells] for r in v.rows] for v in t],'texts':[s.text for slide in p.slides for s in slide.shapes if s.has_text_frame],'headerColors':[str(v.cell(0,0).text_frame.paragraphs[0].runs[0].font.color.rgb) for v in t]}))";
  const inspected=spawnSync(python,['-c',inspectScript,path.join(exportDir,'density-native-smoke.pptx')],{encoding:'utf8'});
  assert.equal(inspected.status,0,inspected.stderr);const exported=JSON.parse(inspected.stdout);assert.equal(exported.pages,3);assert.deepEqual(exported.tables[0],table.rows);
  assert.ok(exported.texts.includes('The owner compares the recorded result with the agreed condition before the decision.'));
  assert.equal(exported.headerColors[0],'FFFFFF');
  fs.writeFileSync(path.join(exportDir,'density-native-smoke.json'),JSON.stringify({pageDecision:published.pageDecision,densityPacking:published.planning.densityPacking,quality:published.quality,exported},null,2));checked();
  const sourceNodes=published.deck.slides[1].nodes.filter(artifacts.isSourceOwnedNode);
  const preserved={...published,templateFidelity:{mode:'preserve',width:12192000,height:6858000,slides:[{},{}]},deck:{...published.deck,slides:[{...published.deck.slides[1],templateSlideIndex:1}]}};
  const preservedTree=buildRenderTree(preserved);
  assert.ok(preservedTree.slides[0].elements.some(n=>n.semanticRole==='source-explanation'));
  const importer=(await import('./lib/ppt/import-pptx.mjs'))._internals;
  const preservedPath=path.join(exportDir,'density-preserved-smoke.pptx');
  const nativeResult=spawnSync(python,['-c',importer.EXPORT_SCRIPT],{input:JSON.stringify({original:path.join(exportDir,'density-native-smoke.pptx'),fonts:published.templateSpec.fonts,slides:[{nativeSlideIndex:1,nodes:[],sourceArtifacts:sourceNodes}]}),env:{...process.env,PPT_OUTPUT:preservedPath},encoding:'utf8'});
  assert.equal(nativeResult.status,0,nativeResult.stderr);
  const preservedInspect=spawnSync(python,['-c',inspectScript,preservedPath],{encoding:'utf8'});
  assert.equal(preservedInspect.status,0,preservedInspect.stderr);
  const preservedExport=JSON.parse(preservedInspect.stdout);
  assert.equal(preservedExport.pages,3);assert.deepEqual(preservedExport.tables.at(-1),table.rows);
  assert.equal(preservedExport.headerColors.at(-1),'FFFFFF');
  assert.equal(preservedExport.texts.filter(text=>text==='The owner compares the recorded result with the agreed condition before the decision.').length,2,'existing and newly exported native explanation both survive');checked();
  const empty = await request('POST', 'page-estimate', { inputKind: 'paste', text: '', prompt: '', template: 'light' });
  assert.equal(empty.status, 200); checked();
  assert.match(api._internals.outlinePrompt({ ...base, source: null, prompt: 'Explain validation' }), /初步建议，不是最终页数命令/);
  assert.ok(!api._internals.outlinePrompt({ ...base, source: null, prompt: 'Explain validation' }).includes('slides 必须恰好 8')); checked();
  console.log(`PPT Gamma density: ${checks} scenario groups passed (cross-domain/routes, explicit/auto, physical fit, native structures, visible QA, API file recalibration).`);
} finally { fs.rmSync(root, { recursive: true, force: true }); }
