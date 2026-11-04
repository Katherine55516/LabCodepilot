import { scopeReview, simulatedExport } from './ppt-scope-test-helpers.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-runtime-'));
process.env.COWORK_STATE_DIR = root; process.env.PPT_NODE_CONCURRENCY = '2';
const repo = await import('./lib/ppt/repository.mjs');
const store = await import('./lib/ppt-store.mjs');
const ir = await import('./lib/ppt/ir.mjs');
const templates = await import('./lib/ppt-template.mjs');
const runtime = await import('./lib/ppt/runtime.mjs');
const edits = await import('./lib/ppt/generation-edit-service.mjs');
const proposals = await import('./lib/ppt/proposal-service.mjs');
const commands = await import('./lib/ppt/command-service.mjs');
const version = await import('./lib/ppt/versioning.mjs');
const render = await import('./lib/ppt/render-tree.mjs');
const publish = await import('./lib/ppt/publish-service.mjs');
const api = await import('./lib/ppt-api.mjs');
const runs = await import('./lib/ppt/run-service.mjs');
const assets = await import('./lib/ppt/asset-task-service.mjs');
const router = await import('./lib/ppt/mutation-router.mjs');
const capacity = await import('./lib/model-capacity.mjs');
const quality = await import('./lib/ppt-quality.mjs');
const parsing = await import('./lib/ppt-semantic.mjs');
const uid = 'runtime-test', noop = () => {}, checks = [];
const clearReview = { missing: [], repeated: [], conflicts: [], unsupported: [] };
function fixture() {
 const slides = ['Overview', 'Mechanisms', 'Conditions', 'Conclusion'].map((title, index) => ({ id: `s${index}`, title, layoutId: index === 0 ? 'cover' : index === 3 ? 'conclusion' : 'editorial', bullets: index === 1 ? ['Source evidence establishes this mechanism.', 'Stated limitations bound its applicability.', 'A distinct condition informs this decision.', 'Additional context explains its interpretation.'] : index === 2 ? ['Record the owner before accepting a result.', 'Verify the measurement against its baseline.', 'Check failures before advancing the queue.', 'Escalate a missing dependency to its owner.'] : index === 3 ? ['Approve the decision after reviewing evidence.', 'Assign the action to the responsible team.', 'Track delivery against the agreed deadline.', 'Revisit the outcome when new facts arrive.'] : [] }));
 const project = ir.ensureProjectV3({ id: store.newId(), uid, title: 'Runtime fixture', prompt: 'Explain mechanisms and conditions', pages: 4, template: 'light', templateSpec: templates.snapshotTemplate(templates.BUILT_INS.find(item => item.id === 'light')), model: 'user-selected-model', configId: 'user-selected-config', status: 'completed', stage: 'completed', revision: 1, publishedRevision: 1, outline: slides.map(slide => ({ id: slide.id, title: slide.title, focus: slide.title, role: slide.layoutId === 'cover' ? 'cover' : 'evidence', section: 'mechanisms', refs: [] })), deck: { slides }, nodes: Object.fromEntries(slides.map(slide => [slide.id, { status: 'done', slide }])) });
 project.renderTree = render.buildRenderTree(project); version.synchronizePlan(project); version.bindReview(project, scopeReview(project)); repo.saveProject(project); repo.saveRevision(project, 'baseline'); return project;
}
async function request(project, suffix, data, deps = {}) {
 const req = Readable.from(data === undefined ? [] : [Buffer.from(JSON.stringify(data))]); req.method = data === undefined ? 'GET' : 'POST'; req.headers = {}; let output;
 await api.handlePpt(req, new URL(`http://test/ppt/projects/${project.id}${suffix}`), { uid, deps, activity: noop, log: noop, res: {}, send: (status, body) => { output = { status, body }; return true; } }); return output;
}
async function until(check) { const start = Date.now(); while (Date.now() - start < 15000) { const result = check(); if (result) return result; await new Promise(resolve => setTimeout(resolve, 5)); } throw new Error('timeout'); }
try {
 // A title mutation's semantic scope excludes body and chart data.
 const titleProject = fixture(); const beforeBody = structuredClone(titleProject.nodes.s1.slide.bullets);
 const changed = await edits.transformGeneratedSlide(titleProject, 's1', { type: 'title', instruction: 'Shorter title' }, { modelCall: async (p, prompt) => { assert.equal(p.model, 'user-selected-model'); assert.match(prompt, /only this slide title/); return { content: { text: 'Mechanism' } }; } }, noop, noop);
 assert.deepEqual(changed.bullets, beforeBody); assert.equal(changed.title, 'Mechanism'); checks.push('title-only preserves body and selected model');
 // Protected page content is never included in an expanded generation scope.
 const protectedProject = fixture(); protectedProject.status = 'generating'; edits.editingState(protectedProject).contentOpen = true; runs.startRun(protectedProject);
 runtime.updateSlidePreview(protectedProject, 's1'); repo.saveProject(protectedProject);
 await runtime.setPageAccepted(uid, protectedProject.id, 's1', true, protectedProject.runtime.slides.s1.renderHash);
 const snapshot = await edits.openGenerationScope(uid, protectedProject.id, 's0');
 const submitted = await edits.submitGenerationEdit(uid, protectedProject.id, { scopeId: snapshot.id, scope: 'deck', instruction: 'Expand content', type: 'content', idempotencyKey: 'protect-content-once' });
 assert(!submitted.intent.perSlideResults.s1); assert.deepEqual(submitted.project.nodes.s1.slide.bullets, beforeBody); checks.push('expanded scopes exclude protected pages');
 // Frozen pending vs following semantics remain distinct as workers start.
 const scopeProject = fixture(); scopeProject.status = 'generating'; scopeProject.nodes.s0.status = 'running'; scopeProject.nodes.s1.status = 'done'; scopeProject.nodes.s2.status = 'running'; scopeProject.nodes.s3.status = 'pending'; edits.editingState(scopeProject).contentOpen = true; runs.startRun(scopeProject);
 const frozen = await edits.openGenerationScope(uid, scopeProject.id, 's1'); assert.deepEqual(frozen.remainingSlideIds, ['s3']); assert.deepEqual(frozen.followingSlideIds, ['s2', 's3']);
 const moved = repo.getProject(uid, scopeProject.id); moved.nodes.s3.status = 'running'; repo.saveProject(moved);
 const intent = await edits.submitGenerationEdit(uid, scopeProject.id, { scopeId: frozen.id, scope: 'remaining', instruction: 'Keep conditions', idempotencyKey: 'frozen-pending-once' }); assert.deepEqual(Object.keys(intent.intent.perSlideResults), ['s3']); checks.push('parallel scopes preserve frozen targets');
 // Late AI cannot overwrite manual content, including an image task.
 const staleProject = fixture(), title = staleProject.deck.slides[1].nodes.find(node => node.semanticRole === 'title');
 const preview = await proposals.createProposal(staleProject, { scope: 'object', type: 'title', slideId: 's1', nodeId: title.id, instruction: 'Clarify title', baseRevision: 1 }, { modelCall: async (p, prompt) => prompt.includes('整稿演示文稿内容评审器') ? scopeReview(p) : ({ content: { text: 'Clear mechanism' } }) }, noop, noop);
 await commands.applyCommand(uid, staleProject.id, { type: 'node.setContent', baseRevision: 1, payload: { slideId: 's1', nodeId: title.id, content: { text: 'Manual wins' } } });
 await assert.rejects(() => proposals.applyProposal(uid, staleProject.id, preview.id), error => error.statusCode === 409); checks.push('late proposals reject manual edit conflicts');
 const imageProject = fixture();
 const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jV3sAAAAASUVORK5CYII=';
 const imageAdded = await commands.applyCommand(uid, imageProject.id, { type: 'node.insert', baseRevision: 1, payload: { slideId: 's1', node: { type: 'image', content: { dataUrl: png, text: 'Diagram' }, geometry: { x: 8000000, y: 1800000, width: 3000000, height: 2200000 } } } });
 const image = imageAdded.project.deck.slides[1].nodes.find(node => node.type === 'image'); const imageBefore = imageAdded.project.deck.slides[1].nodes.find(node => node.semanticRole === 'body').content;
 const task = await assets.startAssetTask(uid, imageProject.id, { slideId: 's1', nodeId: image.id, instruction: 'Replace illustration', baseRevision: imageAdded.project.revision });
 await assets.finishAssetTask(uid, imageProject.id, task.id, { error: 'provider unavailable' }, {}, noop, noop); assert.equal(repo.getProject(uid, imageProject.id).assetTasks[task.id].status, 'failed');
 const retried = await assets.retryAssetTask(uid, imageProject.id, task.id);
 assert.equal(retried.id, task.id); assert.equal(retried.attempts, 2);
 await assert.rejects(() => assets.finishAssetTask(uid, imageProject.id, task.id, { attempt: 1, error: 'late failure' }, {}, noop, noop), error => error.statusCode === 409);
 const imagePreview = await assets.finishAssetTask(uid, imageProject.id, retried.id, { attempt: retried.attempts, content: { dataUrl: png, text: 'Updated illustration' } }, { modelCall: async (p,_prompt,_a,_l,meta) => { assert(meta.nodeKey.startsWith('review:'),'image retry must only invoke semantic audit'); return scopeReview(p); } }, noop, noop);
 assert.equal(repo.getProject(uid, imageProject.id).revision, imageAdded.project.revision); await proposals.applyProposal(uid, imageProject.id, imagePreview.proposal.id);
 assert.deepEqual(repo.getProject(uid, imageProject.id).deck.slides[1].nodes.find(node => node.semanticRole === 'body').content, imageBefore); checks.push('asset retry only replaces image after preview confirmation');
 const recovery = fixture(); runs.startRun(recovery); runtime.updateSlidePreview(recovery, 's1'); runtime.checkpoint(recovery, 'test'); repo.saveProject(recovery);
 const damaged = repo.getProject(uid, recovery.id); delete damaged.nodes.s1; delete damaged.runtime.slides.s1; runtime.reconcileCheckpoint(damaged);
 assert.equal(damaged.nodes.s1.status, 'done'); assert(damaged.runtime.slides.s1.preview); damaged.revision++; delete damaged.nodes.s1; runtime.reconcileCheckpoint(damaged); assert(!damaged.nodes.s1, 'newer revisions must not be overwritten'); checks.push('checkpoint recovery preserves valid results and newer revisions');
 const splitProject = fixture(); const body = splitProject.deck.slides[1].nodes.find(node => node.semanticRole === 'body');
 const split = await proposals.createProposal(splitProject, { scope: 'slide', type: 'structure', action: 'split', count: 2, slideId: 's1', instruction: 'Split this slide', baseRevision: 1 }, { modelCall: async (p, prompt) => prompt.includes('整稿演示文稿内容评审器') ? scopeReview(p) : ({ groups: [{ title: 'Mechanism', itemIds: body.content.items.slice(0, 2).map(item => item.id) }, { title: 'Conditions', itemIds: body.content.items.slice(2).map(item => item.id) }] }) }, noop, noop);
 assert.equal(split.pageDelta, 1); assert.equal(split.afterSlides.length, 2);
 const splitApplied = await proposals.applyProposal(uid, splitProject.id, split.id); assert.equal(splitApplied.project.pages, 5); assert.equal(splitApplied.project.pageDecision.finalPageCount, 5); assert.equal(splitApplied.project.outline.length, 5); assert.equal(splitApplied.project.planning.slidePlan.length, 5);
 const itemsAfter = splitApplied.project.deck.slides.slice(1, 3).flatMap(slide => slide.nodes.find(node => node.semanticRole === 'body').content.items); assert.deepEqual(itemsAfter.map(item => item.id), body.content.items.map(item => item.id));
 assert.equal(splitApplied.project.renderTree.slides[2].index, 2); assert(splitApplied.project.planRevision.version > splitProject.planRevision.version);
 const undone = await commands.undo(uid, splitProject.id, uid, splitApplied.operation.id); assert.equal(undone.project.pages, 4); assert.deepEqual(undone.project.deck.slides[1].bullets, splitProject.deck.slides[1].bullets); checks.push('split synchronizes content page budget contracts narrative render order and undo');
 assert.equal(repo.readRevision(uid, splitProject.id, splitApplied.project.revision).pageDecision.finalPageCount, 5);
 const restoredSplit = await request(splitProject, `/revisions/${splitApplied.project.revision}/restore`, {});
 assert.equal(restoredSplit.status, 200); assert.equal(restoredSplit.body.project.pageDecision.finalPageCount, 5); assert.equal(restoredSplit.body.project.pages, 5);
 const sourced = fixture(); sourced.deck.slides[1].bullets[0] = 'Latency is 12 ms under the stated measurement conditions.';
 sourced.deck.slides[1].nodes.find(node => node.semanticRole === 'body').content.items[0].text = sourced.deck.slides[1].bullets[0];
 sourced.source = parsing.withSemanticIndex({ kind: 'text', text: sourced.deck.slides[1].bullets.join('\n'), segments: [{ id: 'source_1', text: sourced.deck.slides[1].bullets.join('\n'), location: 'test source' }] });
 const atom = sourced.source.semantic.evidenceAtoms[0];
 assert(atom, 'source fixture must include an actual evidence atom');
 sourced.planning = { ...sourced.planning, slidePlan: sourced.outline.map(item => ({ slideId: item.id, requiredEvidenceIds: item.id === 's1' ? [atom.id] : [] })) };
 sourced.deck.slides[1].sourceRefs = ['source_1']; sourced.outline[1].refs = ['source_1']; version.synchronizePlan(sourced); repo.saveProject(sourced);
 const sourcedBody = sourced.deck.slides[1].nodes.find(node => node.semanticRole === 'body');
 const sourcedSplit = await proposals.createProposal(repo.getProject(uid, sourced.id), { scope: 'slide', type: 'structure', action: 'split', count: 2, slideId: 's1', instruction: 'Split supported mechanisms', baseRevision: 1 }, { modelCall: async (p, prompt) => prompt.includes('整稿演示文稿内容评审器') ? scopeReview(p) : ({ groups: [{ title: 'Mechanism', itemIds: sourcedBody.content.items.slice(0,2).map(item => item.id) }, { title: 'Conditions', itemIds: sourcedBody.content.items.slice(2).map(item => item.id) }] }) }, noop, noop);
 const sourcedApplied = await proposals.applyProposal(uid, sourced.id, sourcedSplit.id);
 assert(sourcedApplied.project.planning.slidePlan.some(contract => contract.requiredEvidenceIds.includes(atom.id)), 'split must keep required source evidence in a child contract');
 const chartPrompt = structuredClone(fixture()); chartPrompt.deck.slides[1].nodes.push({ id: 'chart_review', type: 'chart', content: { chartType: 'bar', labels: ['First', 'Second'], values: [12, 34], unit: '%' } });
 assert.match(quality.deckReviewPrompt(chartPrompt), /"values":\[12,34\],"unit":"%"/);
 // Geometry/style affect visibility and object retention, so invalidate review.
 const reviewProject = fixture(); assert(version.reviewIsCurrent(reviewProject));
 reviewProject.dagNodes={'review:deck':{id:'review:deck',status:'completed'}};repo.saveProject(reviewProject);
 const styled = await commands.applyCommand(uid, reviewProject.id, { type: 'node.setStyle', baseRevision: 1, payload: { slideId: 's1', nodeId: reviewProject.deck.slides[1].nodes[0].id, style: { fontWeight: 700 } } }); assert(!version.reviewIsCurrent(styled.project));
 const revised = await commands.applyCommand(uid, reviewProject.id, { type: 'node.setContent', baseRevision: 2, payload: { slideId: 's1', nodeId: reviewProject.deck.slides[1].nodes[0].id, content: { text: 'Changed semantic claim' } } }); assert.equal(revised.project.quality.reviewState, 'stale'); assert(!version.reviewIsCurrent(revised.project));
 let reviews = 0, exported;
 const published = await publish.publishProject(uid, reviewProject.id, { modelCall: async (project) => { assert.equal(project.configId, 'user-selected-config'); reviews++; return scopeReview(project); }, renderPptx: async project => { exported = project; return simulatedExport(project); } }, noop, noop);
 assert.equal(reviews, 1); assert.equal(published.published, true); assert.equal(exported.renderTree.hash, published.project.renderTree.hash); assert.equal(published.project.publishedRevision, published.project.revision); checks.push('semantic changes invalidate review; preview and export share revision and render tree');
 assert.equal(published.project.dagNodes['review:deck'].status,'completed');assert.equal(published.project.dagNodes['review:deck'].projectRevision,published.project.revision);assert.equal(published.project.dagNodes['review:deck'].inputHash,version.semanticReviewKey(published.project));checks.push('editor publish carries the fresh validated review back to the DAG at the current revision');
 const slots = capacity.createCapacity(1), first = await slots.acquire(); const order = [];
 const second = slots.acquire().then(release => { order.push(2); return release; }), third = slots.acquire().then(release => { order.push(3); return release; });
 assert.equal(slots.snapshot().queued, 2); assert.equal(slots.tryAcquire(), null); first(); const secondRelease = await second; secondRelease(); (await third)(); assert.deepEqual(order, [2, 3]); assert.equal(slots.snapshot().active, 0); checks.push('capacity shortage queues FIFO rather than failing generation');
 // Pause is a safe boundary; restore resumes cached pages, not an automatic restart of a paused run.
 const live = fixture(); live.status = 'outline_ready'; live.deck = null; live.nodes = {}; live.revision = 0; repo.saveProject(live); runs.startRun(live);
 const releases = []; let contentCalls = 0;
 const deps = { modelCall: async (project, prompt, _a, _l, meta) => { if (meta.nodeKey.startsWith('review:')) return scopeReview(project); contentCalls++; if (!meta.nodeKey.endsWith(':repair') && releases.length < 2) await new Promise(resolve => releases.push(resolve)); const id = meta.nodeKey.split(':')[1]; return { title: `Claim ${id}`, bullets: id === 's0' ? [] : [`Distinct explanation for ${id} provides supported mechanism and conditions.`] }; }, renderPptx: async project => simulatedExport(project) };
 assert.equal((await request(live, '/generate', {}, deps)).status, 202); await until(() => releases.length === 2); await runtime.pauseSession(uid, live.id); releases.forEach(release => release()); await until(() => repo.getProject(uid, live.id).status === 'paused');
 const paused = repo.getProject(uid, live.id); const cached = Object.values(paused.nodes).filter(node => node.status === 'done').length; assert(cached >= 1); assert.equal(runs.currentRun(paused).status, 'paused'); const beforeResume = contentCalls;
 assert.equal((await request(live, '/resume', {}, deps)).status, 202);
 const done = await until(() => { const p = repo.getProject(uid, live.id); if (p.status === 'failed') throw new Error(p.error); return ['completed', 'quality_blocked'].includes(p.status) && p; }); assert(done.runtime.slides.s1.preview); assert(contentCalls - beforeResume <= (4 - cached) * 2); checks.push('pause/resume reuses completed page content and real previews');
 // A later title edit must stay minimal even when an older depth preference remains active.
 const minimal = fixture(); minimal.status = 'paused'; edits.editingState(minimal).contentOpen = true; runtime.runtimeState(minimal).pauseRequested = true; runs.startRun(minimal);
 const older = { id: 'intent_old', scope: 'current', type: 'content', instruction: 'Expand supported detail', perSlideResults: { s1: { phase: 'content', epoch: 0, status: 'applied' } }, status: 'applied' };
 minimal.editing.intents[older.id] = older; router.addConstraint(minimal, older, ['s1']); repo.saveProject(minimal);
 const minimalScope = await edits.openGenerationScope(uid, minimal.id, 's1');
 await edits.submitGenerationEdit(uid, minimal.id, { scopeId: minimalScope.id, scope: 'current', instruction: 'Shorten only the title', type: 'title', idempotencyKey: 'minimal-after-depth' });
 let nonTitleCalls = 0;
 const minimalDeps = { modelCall: async (_p, _prompt, _a, _l, meta) => { if (meta.nodeKey.startsWith('review:')) return scopeReview(_p); if (meta.nodeKey.endsWith(':title')) return { content: { text: 'Minimal mechanism' } }; nonTitleCalls++; throw new Error('title mutation must not regenerate body'); }, renderPptx: async project => simulatedExport(project) };
 await request(minimal, '/resume', {}, minimalDeps);
 const minimalDone = await until(() => { const p = repo.getProject(uid, minimal.id); if (p.status === 'failed') throw new Error(p.error); return ['completed','quality_blocked'].includes(p.status) && p; });
 assert.equal(nonTitleCalls, 0); assert.deepEqual(minimalDone.deck.slides[1].bullets, minimal.deck.slides[1].bullets); assert.equal(minimalDone.deck.slides[1].title, 'Minimal mechanism');
 // A manual paused draft edit wins over both node cache and queued AI on resume.
 const manual = fixture(); manual.status = 'paused'; edits.editingState(manual).contentOpen = true; runtime.runtimeState(manual).pauseRequested = true; runs.startRun(manual); repo.saveProject(manual);
 const manualScope = await edits.openGenerationScope(uid, manual.id, 's1');
 const manualIntent = await edits.submitGenerationEdit(uid, manual.id, { scopeId: manualScope.id, scope: 'current', instruction: 'Shorten title', type: 'title', idempotencyKey: 'manual-resume-once' });
 const manualTitle = manual.deck.slides[1].nodes.find(node => node.semanticRole === 'title');
 const manualResult = await commands.applyCommand(uid, manual.id, { type: 'node.setContent', baseRevision: manual.revision, payload: { slideId: 's1', nodeId: manualTitle.id, content: { text: 'Manual mechanism decision' } } });
 assert.equal(manualResult.project.editing.intents[manualIntent.intent.id].status, 'conflicted');
 const manualDeps = { modelCall: async (_p, _prompt, _a, _l, meta) => { assert(meta.nodeKey.startsWith('review:'), 'manual cached page must not be regenerated'); return scopeReview(_p); }, renderPptx: async project => simulatedExport(project) };
 await request(manual, '/resume', {}, manualDeps);
 const manualDone = await until(() => { const p = repo.getProject(uid, manual.id); if (p.status === 'failed') throw new Error(p.error); return ['completed','quality_blocked'].includes(p.status) && p; });
 assert.equal(manualDone.deck.slides[1].title, 'Manual mechanism decision');
 assert.deepEqual(manualDone.deck.slides[1].bullets, manual.deck.slides[1].bullets);
 // Quality-blocked/completed editor commands must survive the next generation retry.
 for(const status of ['quality_blocked','completed']){
  const cached=fixture();cached.confirmedOutline={titlesFrozen:true,hash:'previous-confirmed-hash'};cached.status=status;runs.startRun(cached);runtime.runtimeState(cached);repo.saveProject(cached);
  const title=cached.deck.slides[1].nodes.find(n=>n.semanticRole==='title');
  const edited=await commands.applyCommand(uid,cached.id,{type:'node.setContent',baseRevision:cached.revision,payload:{slideId:'s1',nodeId:title.id,content:{text:'Retained reviewed topic'}}});
  assert.equal(edited.project.nodes.s1.slide.title,'Retained reviewed topic');
  assert.equal(edited.project.outline[1].title,'Retained reviewed topic');
  assert.equal(edited.project.outline[1].titleLocked,true);
  assert.equal(edited.project.outlineTitleEditHistory.at(-1).before,'Mechanisms');
  assert.equal(edited.project.outlineTitleEditHistory.at(-1).confirmation.hash,'previous-confirmed-hash');
  const rewritten=api._internals.normalizeSlide({title:'Retained reviewed topic',contentBlocks:[],blocks:[]},edited.project.outline[1],edited.project,[]);
  assert.equal(rewritten.title,'Retained reviewed topic','critic writer normalizes against the effective manual title');
  assert.equal(api._internals.normalizeSlide({title:'Mechanisms',contentBlocks:[],blocks:[]},edited.project.outline[1],edited.project,[]).title,'Retained reviewed topic','critic cannot restore the stale pre-edit title');
  assert.equal(repo.getProject(uid,cached.id).runtime.slides.s1.canonicalSlide.title,'Retained reviewed topic');
  await request(edited.project,'/retry',{},manualDeps);
  const reviewed=await until(()=>{const p=repo.getProject(uid,cached.id);if(p.status==='failed')throw Error(p.error);return ['completed','quality_blocked'].includes(p.status)&&p;});
  assert.equal(reviewed.deck.slides[1].title,'Retained reviewed topic');
 }
 checks.push('quality-blocked and completed manual titles survive retry without body regeneration');
 // Live manual edits advance the epoch and never turn pending placeholders into previews.
 const liveManual=fixture();liveManual.status='generating';edits.editingState(liveManual).contentOpen=true;runtime.runtimeState(liveManual);runs.startRun(liveManual);
 delete liveManual.nodes.s2;delete liveManual.runtime.slides.s2;
 runtime.updateSlidePreview(liveManual,'s1');liveManual.runtime.slides.s1.quality={issues:[],pendingDeckReview:true};repo.saveProject(liveManual);
 const liveTitle=liveManual.deck.slides[1].nodes.find(n=>n.semanticRole==='title');
 const liveChanged=await commands.applyCommand(uid,liveManual.id,{type:'node.setContent',baseRevision:liveManual.revision,payload:{slideId:'s1',nodeId:liveTitle.id,content:{text:'Manual live mechanism'}}});
 assert.equal(liveChanged.project.nodes.s1.slide.title,'Manual live mechanism');assert.equal(liveChanged.project.editing.epochs.s1,1);assert(!liveChanged.project.runtime.slides.s2?.preview);
 await assert.rejects(()=>commands.applyCommand(uid,liveManual.id,{type:'node.setStyle',baseRevision:liveChanged.project.revision,payload:{slideId:'s2',nodeId:liveManual.deck.slides[2].nodes[0].id,style:{fontWeight:700}}}),e=>e.statusCode===409);
 checks.push('live verified objects preserve epoch and pending pages never acquire false previews');
 // Live text editing must not invent a summary layout before canonical migration.
 const coverLive=fixture();coverLive.status='generating';edits.editingState(coverLive).contentOpen=true;runtime.runtimeState(coverLive);runs.startRun(coverLive);coverLive.nodes.s0.slide=structuredClone(coverLive.deck.slides[0]);delete coverLive.nodes.s0.slide.layoutId;delete coverLive.nodes.s0.slide.layoutRef;runtime.updateSlidePreview(coverLive,'s0');coverLive.runtime.slides.s0.quality={issues:[]};repo.saveProject(coverLive);
 const coverTitle=coverLive.nodes.s0.slide.nodes.find(n=>n.semanticRole==='title'),beforeCover=coverLive.runtime.slides.s0.preview.elements.find(n=>n.nodeId===coverTitle.id).bounds;
 const coverChange=await commands.applyCommand(uid,coverLive.id,{type:'node.setContent',baseRevision:coverLive.revision,payload:{slideId:'s0',nodeId:coverTitle.id,content:{text:'Manual cover title'}}});
 assert.equal(coverChange.project.deck.slides[0].layoutId,'cover');assert.deepEqual(coverChange.project.runtime.slides.s0.preview.elements.find(n=>n.nodeId===coverTitle.id).bounds,beforeCover);checks.push('live title save retains the actual cover layout and geometry');
 // A structure request submitted while paused becomes a durable preview after the barrier, never an automatic command.
 const planned = fixture(); planned.status = 'paused'; edits.editingState(planned).contentOpen = true; runtime.runtimeState(planned).pauseRequested = true; runs.startRun(planned); repo.saveProject(planned);
 const plannedScope = await edits.openGenerationScope(uid, planned.id, 's1');
 const plannedIntent = await edits.submitGenerationEdit(uid, planned.id, { scopeId: plannedScope.id, scope: 'current', instruction: 'Split into two slides', type: 'structure', idempotencyKey: 'paused-structure-once' });
 const beforePlanRevision = planned.revision;
 const plannedDeps = { modelCall: async (p, prompt, _a, _l, meta) => { if (meta.nodeKey.startsWith('review:')) return scopeReview(p); const items = p.deck.slides.find(slide => slide.id === 's1').nodes.find(node => node.semanticRole === 'body').content.items; return { groups: [{ title: 'Mechanism', itemIds: items.slice(0,2).map(item => item.id) }, { title: 'Boundaries', itemIds: items.slice(2).map(item => item.id) }] }; }, renderPptx: async project => simulatedExport(project) };
 await request(planned, '/resume', {}, plannedDeps);
 const proposed = await until(() => { const p = repo.getProject(uid, planned.id); const intent = p.editing.intents[plannedIntent.intent.id]; if (['failed','conflicted'].includes(intent.status)) throw new Error(JSON.stringify(intent)); return intent.status === 'proposed' && p; });
 assert.equal(proposed.revision, beforePlanRevision); assert.equal(proposed.pages, 4);
 const structureId = proposed.editing.intents[plannedIntent.intent.id].perSlideResults.s1.proposalId;
 const acceptedProposal = await request(planned, `/proposals/${structureId}/apply`, {}, plannedDeps); assert.equal(acceptedProposal.status, 200); assert.equal(acceptedProposal.body.project.pages, 5); assert.equal(acceptedProposal.body.project.editing.intents[plannedIntent.intent.id].status, 'applied');
 assert.equal(router.routeMutation(fixture(), '仅缩短标题').type, 'title');
 assert.equal(router.routeMutation(fixture(), '请换成双栏').type, 'layout');
 console.log(JSON.stringify({ checks: checks.length, passed: checks }, null, 2));
} finally { fs.rmSync(root, { recursive: true, force: true }); }
