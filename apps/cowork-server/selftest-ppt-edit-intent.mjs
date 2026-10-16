import { scopeReview, simulatedExport } from './ppt-scope-test-helpers.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-edit-intent-'));
process.env.COWORK_STATE_DIR = root;
process.env.PPT_NODE_CONCURRENCY = '3';
const [store, repo, ir, commands, proposals, edits, runs, api, templates, history, publish, preview] = await Promise.all([
  import('./lib/ppt-store.mjs'), import('./lib/ppt/repository.mjs'), import('./lib/ppt/ir.mjs'), import('./lib/ppt/command-service.mjs'),
  import('./lib/ppt/proposal-service.mjs'), import('./lib/ppt/generation-edit-service.mjs'), import('./lib/ppt/run-service.mjs'),
  import('./lib/ppt-api.mjs'), import('./lib/ppt-template.mjs'), import('./lib/ppt/command-history.mjs'), import('./lib/ppt/publish-service.mjs'), import('./lib/ppt/template-preview-service.mjs'),
]);
const uid = 'edit-intent-test';
const noop = () => {};
const templateSpec = templates.snapshotTemplate(templates.BUILT_INS.find(item => item.id === 'light'));
function fixture() {
  const bodies=['','The observed mechanism connects the measured exposure to the decision.','The assessment depends on timing alignment and comparable measurement conditions.','Validate assumptions and transaction costs before using the measured signal.'];
  const slides = ['Introduction', 'Mechanism', 'Limitations', 'Conclusion'].map((title, index) => ({ id: `s${index}`, title, bullets: index ? [bodies[index]] : [], layoutId: index === 0 ? 'cover' : index === 3 ? 'conclusion' : 'summary' }));
  const project = ir.ensureProjectV3({ uid, id: store.newId(), title: 'Fixture', prompt: 'Explain a mechanism and its limitations.', template: 'light', templateSpec, pages: 4,
    status: 'completed', stage: 'completed', pageDecision:{mode:'explicit',source:'user',finalPageCount:4}, revision: 1, publishedRevision: 1, outline: slides.map(({ id, title }) => ({ id, title, focus: title, refs: [] })), deck: { slides }, nodes: {}, sourceRevision: 0 });
  repo.saveProject(project); repo.saveRevision(project, 'baseline'); return project;
}
async function waitUntil(check, description) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) { const result = check(); if (result) return result; await new Promise(resolve => setTimeout(resolve, 5)); }
  if(process.env.PPT_SELFTEST_EVIDENCE)fs.writeFileSync(process.env.PPT_SELFTEST_EVIDENCE,JSON.stringify(store.list(uid).map(p=>repo.getProject(uid,p.id)),null,2));
  throw new Error(`timed out: ${description}`);
}
async function request(project, suffix, data, deps) {
  const req = Readable.from(data === undefined ? [] : [Buffer.from(JSON.stringify(data))]); req.method = data === undefined ? 'GET' : 'POST'; req.headers = {};
  let result;
  await api.handlePpt(req, new URL(`http://test/ppt/projects/${project.id}${suffix}`), { uid, deps, activity: noop, log: noop, res: {}, send: (status, body) => { result = { status, body }; return true; } });
  return result;
}
try {
  let project = fixture(); const id = project.id;
  const node = project.deck.slides[1].nodes.find(item => item.semanticRole === 'title');
  const data = { scope: 'object', slideId: 's1', nodeId: node.id, instruction: 'Clarify the title', baseRevision: 1 };
  const proposal = await proposals.createProposal(project, data, { modelCall: async (p, prompt) => prompt.includes('整稿演示文稿内容评审器') ? scopeReview(p) : ({ content: { text: 'How the mechanism works' } }) }, noop, noop);
  assert.match(proposal.beforeSvg, /^<svg/); assert.match(proposal.afterSvg, /How the mechanism works/);
  assert.equal(repo.getProject(uid, id).revision, 1); assert.equal(history.operationHistory(uid, id).length, 0, 'preview must be read-only');
  const otherNode = project.deck.slides[2].nodes.find(item => item.semanticRole === 'title');
  await commands.applyCommand(uid, id, { type: 'node.setContent', baseRevision: 1, payload: { slideId: 's2', nodeId: otherNode.id, content: { text: 'Conditional limitations' } } });
  const applied = await proposals.applyProposal(uid, id, proposal.id);
  assert.equal(applied.project.deck.slides[1].title, 'How the mechanism works');
  assert.equal((await proposals.applyProposal(uid, id, proposal.id)).idempotent, true);
  await commands.applyCommand(uid, id, { type: 'node.setContent', baseRevision: applied.project.revision, payload: { slideId: 's2', nodeId: otherNode.id, content: { text: 'Other page preserved' } } });
  const undone = await commands.undo(uid, id, uid, applied.operation.id);
  assert.equal(undone.project.deck.slides[1].title, 'Mechanism'); assert.equal(undone.project.deck.slides[2].title, 'Other page preserved');
  await assert.rejects(() => commands.undo(uid, id, uid, applied.operation.id), error => error.statusCode === 409);
  project = repo.getProject(uid, id);
  const stale = await proposals.createProposal(project, { ...data, baseRevision: project.revision }, { modelCall: async (p, prompt) => prompt.includes('整稿演示文稿内容评审器') ? scopeReview(p) : ({ content: { text: 'Proposed title' } }) }, noop, noop);
  await commands.applyCommand(uid, id, { type: 'node.setContent', baseRevision: project.revision, payload: { slideId: 's1', nodeId: node.id, content: { text: 'Manual title wins' } } });
  await assert.rejects(() => proposals.applyProposal(uid, id, stale.id), error => error.statusCode === 409);
  project = repo.getProject(uid, id);
  const discarded = await proposals.createProposal(project, { ...data, baseRevision: project.revision }, { modelCall: async (p, prompt) => prompt.includes('整稿演示文稿内容评审器') ? scopeReview(p) : ({ content: { text: 'Discard this title' } }) }, noop, noop);
  await proposals.discardProposal(uid, id, discarded.id);
  await assert.rejects(() => proposals.applyProposal(uid, id, discarded.id), error => error.statusCode === 409);
  const native = { ...project, externalPptx: { mode: 'preserve' } }; let modelCalled = false;
  await assert.rejects(() => proposals.createProposal(native, { ...data, scope: 'slide', mode: 'relayout', baseRevision: project.revision }, { modelCall: async () => { modelCalled = true; } }, noop, noop), error => error.statusCode === 409);
  assert.equal(modelCalled, false, 'native capability check precedes the model request');

  // Source obligations must survive local changes/undo in either template mode.
  const {normalizePaste}=await import('./lib/ppt-source.mjs');
  const {bindSourceArtifacts}=await import('./lib/ppt-source-artifacts.mjs');
  const {inspectObjectIntegrity}=await import('./lib/ppt-object-integrity.mjs');
  const {semanticReviewKey}=await import('./lib/ppt/versioning.mjs');
  let sourceProject=fixture();sourceProject.source=normalizePaste('# Mechanism\n\n$$r=\\alpha+\\beta f$$\n\n| Case | Condition |\n|---|---|\n| Signal | Timing alignment |\n\n## Checklist\n\n- Check assumptions.\n- Check costs.');
  const objects=sourceProject.source.semantic.inventory.items.filter(item=>item.must_preserve_structure);
  sourceProject.planning={slidePlan:objects.map((item,index)=>({slideId:`s${index+1}`,sourceArtifacts:[{sourceUnitId:item.id}]}))};
  objects.forEach((item,index)=>bindSourceArtifacts(sourceProject,sourceProject.deck.slides[index+1],[{sourceUnitId:item.id}],index+1));
  sourceProject.quality={reviewState:'valid',modelReview:{missing:[],repeated:[],conflicts:[],unsupported:[]}};repo.saveProject(sourceProject);
  assert.equal(inspectObjectIntegrity(sourceProject).ledger.fulfilledCount,3);
  const eqSlide=sourceProject.deck.slides.find(slide=>slide.nodes.some(node=>node.sourceArtifact?.type==='EquationBlock'));
  const equation=eqSlide.nodes.find(node=>node.sourceArtifact?.type==='EquationBlock');
  for(const templateMode of ['mapped','preserve']){
    const candidateProject={...sourceProject,...(templateMode==='preserve'?{externalPptx:{mode:'preserve'}}:{})};
    await assert.rejects(()=>proposals.createProposal(candidateProject,{scope:'object',slideId:eqSlide.id,nodeId:equation.id,instruction:'Shorten the equation',baseRevision:1},{modelCall:async()=>({content:{text:'r=alpha'}})},noop,noop),error=>error.statusCode===422,'shortening must not remove the beta relationship in either mode');
  }
  const oldKey=semanticReviewKey(sourceProject);
  const changedSource=await commands.applyCommand(uid,sourceProject.id,{type:'node.setContent',baseRevision:1,payload:{slideId:eqSlide.id,nodeId:equation.id,content:{text:'r=alpha'}}});
  assert.equal(changedSource.project.deck.slides.find(s=>s.id===eqSlide.id).nodes.find(n=>n.id===equation.id).sourceArtifact.sourceUnitId,equation.sourceArtifact.sourceUnitId);
  assert.ok(inspectObjectIntegrity(changedSource.project).issues.some(i=>i.code==='required_source_object_missing'));
  assert.equal(changedSource.project.quality.reviewState,'stale');
  const restoredSource=await commands.undo(uid,sourceProject.id,uid,changedSource.operation.id);
  assert.equal(inspectObjectIntegrity(restoredSource.project).ledger.fulfilledCount,3);
  assert.equal(semanticReviewKey(restoredSource.project),oldKey,'undo must restore the equation, ownership and semantic review input');

  const chartProject = fixture();
  const withChart = await commands.applyCommand(uid, chartProject.id, { type: 'node.insert', baseRevision: 1, payload: { slideId: 's1', node: { type: 'chart', content: { chartType: 'bar', labels: ['A', 'B'], values: [2, 5], unit: '%' }, style: {} } } });
  const chart = withChart.project.deck.slides[1].nodes.find(item => item.type === 'chart');
  await assert.rejects(() => proposals.createProposal(withChart.project, { scope: 'object', slideId: 's1', nodeId: chart.id, instruction: 'Explain the findings', baseRevision: withChart.project.revision }, { modelCall: async () => ({ content: { ...chart.content, values: [2, 7] } }) }, noop, noop), error => error.statusCode === 422 && /chart data/.test(error.message));

  // Simulate a crash after writing the command checkpoint, before writing its journal row.
  const checkpointProject = { ...project, revision: project.revision + 1 };
  const checkpointOperation = { id: 'checkpoint_once', status: 'committed', revision: checkpointProject.revision, kind: 'command', command: { type: 'slide.setLayout', payload: { slideId: 's1' } } };
  repo.checkpointCommit(checkpointProject, checkpointOperation, 'recovery');
  assert.equal(repo.getProject(uid, id).revision, checkpointProject.revision);
  assert.equal(history.operationHistory(uid, id).filter(row => row.id === checkpointOperation.id).length, 1);
  repo.getProject(uid, id); assert.equal(history.operationHistory(uid, id).filter(row => row.id === checkpointOperation.id).length, 1);

  const scopeProject = fixture(); scopeProject.status = 'generating'; scopeProject.revision = 0; scopeProject.nodes = { s0: { status: 'running' }, s1: { status: 'done' }, s2: { status: 'pending' }, s3: { status: 'pending' }, blank: { status: 'done' } };
  scopeProject.outline.push({ id: 'blank', title: 'Manual', manualBlank: true }); edits.editingState(scopeProject).contentOpen = true; repo.saveProject(scopeProject); runs.startRun(scopeProject);
  const scope = await edits.openGenerationScope(uid, scopeProject.id, 's1'); assert.deepEqual(scope.remainingSlideIds, ['s2', 's3']);
  const moved = repo.getProject(uid, scopeProject.id); moved.nodes.s2.status = 'running'; moved.outline.reverse(); repo.saveProject(moved);
  const submitted = await edits.submitGenerationEdit(uid, scopeProject.id, { scopeId: scope.id, scope: 'remaining', instruction: 'Preserve the limitations', idempotencyKey: 'scope_request_once' });
  assert.deepEqual(Object.keys(submitted.intent.perSlideResults), ['s2', 's3']);
  assert.equal(edits.generationEpoch(submitted.project, 's2'), 1); assert.equal(edits.generationEpoch(submitted.project, 's0'), 0);
  assert.equal((await edits.submitGenerationEdit(uid, scopeProject.id, { scopeId: scope.id, scope: 'remaining', instruction: 'Preserve the limitations', idempotencyKey: 'scope_request_once' })).idempotent, true);
  await assert.rejects(() => edits.submitGenerationEdit(uid, scopeProject.id, { scopeId: scope.id, scope: 'remaining', instruction: 'Different instruction', idempotencyKey: 'scope_request_once' }), error => error.statusCode === 409);

  const generating = fixture(); generating.status = 'outline_ready'; generating.deck = null; generating.revision = 0; generating.nodes = {}; repo.saveProject(generating); runs.startRun(generating);
  const releases = new Map(); const calls = new Map(); let holdFirstPage = true;
  const deps = { modelCall: async (snapshot, prompt, _activity, _log, meta) => {
    if (meta.nodeKey?.startsWith('review:')) return scopeReview(snapshot);
    const slideId = meta.nodeKey.split(':')[1]; const epoch = edits.generationEpoch(snapshot, slideId);
    if (!meta.nodeKey.endsWith(':repair')) {
      calls.set(slideId, (calls.get(slideId) || 0) + 1);
      if (holdFirstPage && epoch === 0 && slideId === 's0') await new Promise(resolve => releases.set(slideId, resolve));
    }
    const changed = snapshot.editing?.instructions?.[slideId]?.length;
    return { title: `Distinct ${slideId} ${changed ? 'revised' : 'original'}`, contentBlocks:slideId==='s0'?[]:[{type:'mechanism',body:{s1:'The observed mechanism connects measured exposure to the decision.',s2:'Assessment requires timing alignment and comparable measurement conditions.',s3:'Validate assumptions and transaction costs before using the signal.'}[slideId]}] };
  }, renderPptx: async project => simulatedExport(project), removeContainer: async () => {} };
  assert.equal((await request(generating, '/generate', {}, deps)).status, 202);
  await waitUntil(() => releases.size === 1, 'first page started');
  assert.ok(!repo.getProject(uid, generating.id).nodes.s1 || repo.getProject(uid, generating.id).nodes.s1.status==='pending','later pages start after the real current-page preview');
  const during = await edits.openGenerationScope(uid, generating.id, 's0'); assert.deepEqual(during.remainingSlideIds, ['s1','s2','s3']);
  const currentEdit = await edits.submitGenerationEdit(uid, generating.id, { scopeId: during.id, scope: 'current', instruction: 'Rewrite with a clear claim', idempotencyKey: 'epoch_current_once' });
  const remainingEdit = await edits.submitGenerationEdit(uid, generating.id, { scopeId: during.id, scope: 'remaining', instruction: 'Explain the constraints', idempotencyKey: 'epoch_remaining_once' });
  holdFirstPage = false; for (const release of releases.values()) release();
  const finished = await waitUntil(() => { const value = repo.getProject(uid, generating.id); if (value.status === 'failed') throw new Error(value.error); return ['completed', 'quality_blocked'].includes(value.status) && value; }, 'generation settled');
  assert.match(finished.nodes.s0.slide.title, /revised/); assert.equal(finished.nodes.s3.slide.title, 'Distinct s3 revised');assert.ok(finished.nodes.s3.slide.nodes.some(node=>node.semanticRole==='closing-greeting'&&node.content.text==='Thanks for watching!'));assert.ok(JSON.stringify(finished.nodes.s3.slide).includes('transaction costs'));
  assert.equal(calls.get('s0'), 2, 'superseded epoch must be regenerated'); assert.equal(calls.get('s1'), 1, 'unaffected page is not regenerated');
  assert.equal(finished.editing.intents[currentEdit.intent.id].status, 'applied'); assert.equal(finished.editing.intents[remainingEdit.intent.id].status, 'applied');

  // A scope can be submitted after the content barrier; results are per-page,
  // retries only redo failures and durable proposals resume without another model call.
  const deferred = fixture(); deferred.status = 'generating'; deferred.currentRunId = 'run_deferred';
  deferred.nodes = { s0: { status: 'done' }, s1: { status: 'pending' }, s2: { status: 'pending' }, s3: { status: 'done' } };
  edits.editingState(deferred).contentOpen = false; repo.saveProject(deferred);
  const fixed = await edits.openGenerationScope(uid, deferred.id, 's1');
  const completedDraft = repo.getProject(uid, deferred.id); completedDraft.status = 'completed'; repo.saveProject(completedDraft);
  const batch = await edits.submitGenerationEdit(uid, deferred.id, { scopeId: fixed.id, scope: 'remaining', instruction: 'Clarify both pages', idempotencyKey: 'deferred_batch_once' });
  let failSecond = true; const editedCalls = new Map();
  const editDeps = { modelCall: async (_project, prompt) => {
    if (prompt.includes('整稿演示文稿内容评审器')) return scopeReview(_project);
    const objects = JSON.parse(prompt.split('\nObjects: ')[1].split('\nInstruction: ')[0]);
    const target = objects.find(item => item.content.text)?.nodeId;
    editedCalls.set(target, (editedCalls.get(target) || 0) + 1);
    const secondTitle = completedDraft.deck.slides[2].nodes.find(item => item.semanticRole === 'title').id;
    if (failSecond && target === secondTitle) throw new Error('temporary model failure');
    return { patches: [{ nodeId: target, content: { text: 'Clearer mechanism' } }] };
  } };
  await edits.processGenerationEdits(uid, deferred.id, editDeps, noop, noop);
  let partial = repo.getProject(uid, deferred.id);
  assert.equal(partial.editing.intents[batch.intent.id].status, 'partially_applied');
  assert.equal(partial.editing.intents[batch.intent.id].perSlideResults.s1.status, 'applied');
  assert.equal(partial.editing.intents[batch.intent.id].perSlideResults.s2.status, 'failed');
  assert.equal(partial.publishedRevision, 1, 'generation edits never implicitly publish');
  const firstCalls = [...editedCalls.values()][0]; failSecond = false;
  await edits.retryGenerationEdit(uid, deferred.id, batch.intent.id);
  await edits.processGenerationEdits(uid, deferred.id, editDeps, noop, noop);
  partial = repo.getProject(uid, deferred.id);
  assert.equal(partial.editing.intents[batch.intent.id].status, 'applied');
  assert.equal([...editedCalls.values()][0], firstCalls, 'retry does not repeat successful pages');
  const result = partial.editing.intents[batch.intent.id].perSlideResults.s1;
  result.status = 'applying'; partial.editing.intents[batch.intent.id].status = 'applying'; repo.saveProject(partial);
  const beforeRecovery = partial.revision;
  await edits.processGenerationEdits(uid, deferred.id, { modelCall: async () => { throw new Error('recovery must reuse proposal'); } }, noop, noop);
  assert.equal(repo.getProject(uid, deferred.id).revision, beforeRecovery, 'journaled proposal recovery commits once');
  assert.equal(repo.getProject(uid, deferred.id).editing.intents[batch.intent.id].status, 'applied');

  const legacyRevision = fixture();
  repo.atomicJson(repo.revisionFile(uid, legacyRevision.id, 1), { revision: 1, deck: legacyRevision.deck });
  await commands.applyCommand(uid, legacyRevision.id, { type: 'node.setContent', baseRevision: 1, payload: { slideId: 's1', nodeId: legacyRevision.deck.slides[1].nodes.find(item => item.semanticRole === 'title').id, content: { text: 'New title' } } });
  const restored = await request(legacyRevision, '/revisions/1/restore', {}, {});
  assert.equal(restored.status, 200, JSON.stringify(restored.body));
  assert.equal(restored.body.project.template, 'light');
  assert.deepEqual(restored.body.project.templateSpec, legacyRevision.templateSpec);
  assert.equal(restored.body.project.deck.slides[1].title, 'Mechanism');

  const damaged = path.join(root, 'partial-journal.jsonl');
  fs.writeFileSync(damaged, '{"id":"first"}\n{"id":');
  repo.appendJsonLine(damaged, { id: 'second' });
  assert.deepEqual(repo.readJsonLines(damaged).map(row => row.id), ['first', 'second']);
  const published = fixture(); let renderPath;
  await publish.publishProject(uid, published.id, { modelCall: async p => scopeReview(p), renderPptx: async value => { renderPath = value.renderOutput; return simulatedExport(value,100); } });
  assert.match(renderPath, /^\/workspace\/published-1-artifact_/);
  const previousArtifact = repo.getProject(uid, published.id).publishedArtifactPath;
  const changed = await commands.applyCommand(uid, published.id, { type: 'node.setContent', baseRevision: 1, payload: { slideId: 's1', nodeId: published.deck.slides[1].nodes.find(item => item.semanticRole === 'title').id, content: { text: 'Updated claim' } } });
  const failedExport=await publish.publishProject(uid, published.id, { modelCall: async p => scopeReview(p), renderPptx: async project => { throw new Error('render failure'); } });
  assert.equal(failedExport.published,false);assert.equal(failedExport.project.status,'quality_blocked');assert.match(failedExport.project.error,/render failure/);
  assert.equal(repo.getProject(uid, published.id).publishedArtifactPath, previousArtifact);
  assert.equal(repo.getProject(uid, published.id).publishedRevision, 1);
  assert.equal(repo.getProject(uid, published.id).revision, changed.project.revision);

  const clippedNative=fixture();clippedNative.externalPptx={mode:'preserve',width:9144000,height:6858000};
  clippedNative.deck.slides.forEach((slide,index)=>{slide.nativeSlideIndex=index;slide.nodes.forEach((node,i)=>{node.nativeRef={slideIndex:index,shapeId:i+1};node.geometry={x:508000,y:(i?1270000:254000),width:7620000,height:(i?3810000:762000)};});});
  const clipped=clippedNative.deck.slides[1].nodes.find(node=>node.semanticRole==='body');
  clipped.content={text:'中英 mixed content '.repeat(60)};clipped.type='text';clipped.geometry={x:127000,y:127000,width:1270000,height:254000};clipped.style={fontSizePt:18};
  repo.saveProject(clippedNative);let nativeExportCalled=false;
  const blocked=await publish.publishProject(uid,clippedNative.id,{modelCall:async p=>scopeReview(p),renderImportedPptx:async()=>{nativeExportCalled=true;throw Error('must block before export');}},noop,noop);
  assert.equal(blocked.published,false);assert.equal(nativeExportCalled,false);assert.ok(blocked.project.quality.deterministic.issues.some(i=>i.code==='typography_capacity'));

  const svg = await preview.templatePreview(uid, templates.BUILT_INS.find(item => item.id === 'light'), 1, deps); assert.match(svg, /^<svg/);
  await assert.rejects(() => preview.templatePreview(uid, templates.BUILT_INS.find(item => item.id === 'light'), -1, deps), error => error.statusCode === 400);
  console.log('PPT proposals, read-only previews, idempotency, target undo, checkpoint recovery, fixed scopes and generation epoch fences: OK');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
