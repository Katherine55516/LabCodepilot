import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-prototype-parity-'));
process.env.COWORK_STATE_DIR = root;
const [store, repo, ir, edits, proposals, templates, api, contracts, planning, actions, policy, commands, render] = await Promise.all([
  import('./lib/ppt-store.mjs'), import('./lib/ppt/repository.mjs'), import('./lib/ppt/ir.mjs'), import('./lib/ppt/generation-edit-service.mjs'),
  import('./lib/ppt/proposal-service.mjs'), import('./lib/ppt-template.mjs'), import('./lib/ppt-api.mjs'), import('./lib/ppt-prompt-contracts.mjs'),
  import('./lib/ppt-planning.mjs'), import('./lib/ppt/ai-actions.mjs'), import('./lib/ppt-generation-policy.mjs'), import('./lib/ppt/command-service.mjs'), import('./lib/ppt/render-tree.mjs')]);
const uid = 'parity-test', noop = () => {};
const config = { version: 1, detail: 'balanced', language: { mode: 'source' }, knowledge: 'source_only' };
async function request(url, data) {
  const req = Readable.from([Buffer.from(JSON.stringify(data))]); req.method = 'POST'; req.headers = {};
  let result; await api.handlePpt(req, new URL(`http://test/ppt/${url}`), { uid, deps: {}, activity: noop, log: noop, res: {}, send: (status, body) => { result = { status, body }; return true; } }); return result;
}
try {
  assert.equal(policy.requestedPageCount('第12页介绍定义'), undefined);
  assert.equal(policy.requestedPageCount('', '整理成12页'), 12);
  assert.equal(policy.requestedPageCount('slide42 / 第12页'), undefined);
  assert.match(contracts.promptPolicy({source:{text:'Le mécanisme dépend de ces conditions.'},generationPolicy:config}), /infer from source text/);
  assert.equal(JSON.parse(contracts.editPromptContext({generationPolicy:config}, {id:'s'}, {}, {})).policy.outputLanguage, 'follow_input');
  assert.throws(() => policy.normalizeGenerationPolicy({ ...config, detail: 'concise' }), /invalid/);
  assert.equal(contracts.outputLanguage({ prompt: 'write in English', source: { text: '中文输入说明机制及成立条件。' } }), 'en', 'legacy directive remains');
  assert.equal(contracts.outputLanguage({ prompt: 'write in English', source: { text: '中文输入说明机制及成立条件。' }, generationPolicy: config }), 'zh');
  assert.equal(contracts.outputLanguage({ source: { text: '中文输入说明机制及成立条件。' }, generationPolicy: config, editOutputLanguage: 'fr' }), 'fr');
  assert.match(contracts.promptPolicy({ prompt: 'Sparse concept', generationPolicy: config }), /knowledge_mode=source_only/);
  assert.match(contracts.promptPolicy({ source: { segments: [{ id: '1' }] }, generationPolicy: { ...config, knowledge: 'source_plus_explanation' } }), /knowledge_mode=general_explanation/);
  assert.equal(planning.normalizeBrief({ depth: 'detailed' }, { pages: 4, prompt: '培训课程', generationPolicy: config }).depth, 'balanced');
  const estimate = await request('page-estimate', { inputKind: 'paste', text: '# Topic\n机制和限制\n整理成12页', generationPolicy: config });
  assert.equal(estimate.status, 200); assert.equal(estimate.body.recommendation.requested, 12);
  assert.equal(store.list(uid).length, 0, 'estimating does not create projects');
  assert.equal((await request('page-estimate', { inputKind: 'prompt', prompt: 'topic', generationPolicy: { ...config, detail: 'concise' } })).status, 400);
  const slides = ['Introduction','Mechanism','Conditions','Conclusion'].map((title, index) => ({ id: `s${index}`, title, bullets: index ? ['Mechanisms retain their source conditions and uncertainty.'] : [], layoutId: index === 0 ? 'cover' : 'summary' }));
  let project = ir.ensureProjectV3({ uid, id: store.newId(), title: 'Parity', prompt: 'Explain mechanisms', pages: 4, template: 'light', templateSpec: templates.snapshotTemplate(templates.BUILT_INS.find(item => item.id === 'light')), generationPolicy: config,
    status: 'completed', revision: 1, currentRunId: 'run_parity', outline: slides.map(({id,title}) => ({id,title,refs:[]})), deck: {slides}, nodes: {} });
  const runs = await import('./lib/ppt/run-service.mjs'); runs.startRun(project); repo.saveProject(project);
  assert.deepEqual(render.SLIDE_SIZE, { width: 12192000, height: 6858000 });
  assert.deepEqual(project.creationContext.generationPolicy, config);
  const node = project.deck.slides[1].nodes.find(item => item.semanticRole === 'title');
  let prompt;
  const proposal = await proposals.createProposal(project, { scope: 'object', slideId: 's1', nodeId: node.id, instruction: 'Translate', type: 'content', action: 'translate', parameters: { targetLanguage: 'fr', mode: 'replace', region: 'France', glossary: 'mechanism=mécanisme' }, baseRevision: 1 }, { modelCall: async (_, value) => { prompt = value; return { content: { text: 'Mécanisme' } }; } }, noop, noop);
  assert.match(prompt, /output_language=Français/); assert.match(prompt, /local_action action="translate"/); assert.match(prompt, /source_only/);
  assert.equal(repo.getProject(uid, project.id).deck.slides[1].title, 'Mechanism', 'candidate is read-only');
  assert.deepEqual(proposal.parameters, { targetLanguage: 'fr', mode: 'replace', region: 'France', glossary: 'mechanism=mécanisme' });
  assert.ok(proposal.metrics.beforeLength > 0); assert.equal(proposal.metrics.unchanged, false);
  let calls = 0;
  await assert.rejects(() => proposals.createProposal(project, { scope: 'object', slideId: 's1', nodeId: node.id, instruction: 'Translate', action: 'translate', parameters: {}, baseRevision: 1 }, { modelCall: async () => calls++ }, noop, noop), /select a translation language/);
  assert.equal(calls, 0);
  assert.throws(() => actions.normalizeAiAction('expand', { lengthRatio: 100 }), /1.1–4/);
  const scope = await edits.openGenerationScope(uid, project.id, 's1');
  const payload = { scopeId: scope.id, scope: 'current', type: 'title', instruction: 'Improve title', action: 'improve', parameters: {}, idempotencyKey: 'parity_first_request', conversationId: project.id };
  await assert.rejects(() => edits.submitGenerationEdit(uid, project.id, { ...payload, type:'layout', action:'translate', parameters:{targetLanguage:'fr'}, idempotencyKey:'invalid_writing_route' }), /writing actions cannot/);
  assert.equal(actions.proposalMetrics([{text:'one two'}], [{text:'one two three four five six'}], 'expand', {lengthRatio:1.5}).approximateTargetMet, false, 'overshoot is not an approximate length match');
  const accepted = await edits.submitGenerationEdit(uid, project.id, payload);
  assert.equal((await edits.submitGenerationEdit(uid, project.id, payload)).idempotent, true);
  await assert.rejects(() => edits.submitGenerationEdit(uid, project.id, { ...payload, action: 'translate', parameters: { targetLanguage: 'en' } }), /different request/);
  await edits.processGenerationEdits(uid, project.id, { modelCall: async () => ({ patches: [{ nodeId: node.id, content: { text: 'Mechanism explained' } }] }) }, noop, noop);
  assert.equal(repo.getProject(uid, project.id).editing.intents[accepted.intent.id].status, 'applied');
  const renewed = await edits.openGenerationScope(uid, project.id, 's1', scope.id);
  assert.deepEqual(renewed.followingSlideIds, scope.followingSlideIds);
  assert.ok(renewed.baseRevision > scope.baseRevision);
  const second = await edits.submitGenerationEdit(uid, project.id, { ...payload, scopeId: renewed.id, instruction: 'Clarify the mechanism', idempotencyKey: 'parity_second_request' });
  await edits.processGenerationEdits(uid, project.id, { modelCall: async () => ({ patches: [{ nodeId: node.id, content: { text: 'How the mechanism works' } }] }) }, noop, noop);
  assert.equal(repo.getProject(uid, project.id).editing.intents[second.intent.id].status, 'applied');
  const third = await edits.openGenerationScope(uid, project.id, 's1', renewed.id);
  await commands.applyCommand(uid, project.id, {id:'manual_parity_update',actor:uid,type:'node.setContent',baseRevision:repo.getProject(uid,project.id).revision,payload:{slideId:'s1',nodeId:node.id,content:{text:'Manual title retained'}}});
  await assert.rejects(() => edits.openGenerationScope(uid,project.id,'s1',third.id), /manually edited/);
  assert.equal(repo.getProject(uid,project.id).deck.slides[1].title,'Manual title retained');
  // A user explicitly reselecting the scope is allowed to work with the new manual baseline.
  await edits.openGenerationScope(uid,project.id,'s1');
  project = repo.getProject(uid, project.id); project.currentRunId = 'run_changed'; repo.saveProject(project);
  await assert.rejects(() => edits.openGenerationScope(uid, project.id, 's1', renewed.id), /run or plan changed/);
  console.log('PPT prototype parity: policy/language/legacy, read-only estimates, action parameters/metrics, fixed-scope multi-turn and idempotency: OK');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
