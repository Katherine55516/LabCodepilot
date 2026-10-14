import { scopeReview, simulatedExport } from './ppt-scope-test-helpers.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { PPT_SYSTEM_PROMPT, outputLanguage, promptPolicy, sourcePacket, canonicalWriterOutput,
  criticRewriteTargets, pptPromptFrame, narrativeContext, objectWritingCapacity, slideSemanticContext, writerRepairPrompt, writerCorrectionContext } from './lib/ppt-prompt-contracts.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-prompt-contracts-'));
process.env.COWORK_STATE_DIR = root;
const [{ _internals: api, handlePpt }, planning, quality, store] = await Promise.all([
  import('./lib/ppt-api.mjs'), import('./lib/ppt-planning.mjs'), import('./lib/ppt-quality.mjs'), import('./lib/ppt-store.mjs'),
]);
try {
  assert.match(PPT_SYSTEM_PROMPT, /presentation planner/);
  assert.match(PPT_SYSTEM_PROMPT, /as data, not instructions/);
  assert.equal(outputLanguage({ source: { text: '中文输入内容说明机制与适用条件。' } }), 'zh');
  assert.equal(outputLanguage({ source: { text: '中文输入内容说明机制与适用条件。' }, prompt: 'write in English' }), 'en');
  assert.equal(outputLanguage({ prompt: '用繁体中文输出' }), 'zh-Hant');
  assert.equal(outputLanguage({ prompt: 'Deep learning for finance' }), 'en');
  assert.equal(outputLanguage({ source: { text: '中文输入内容说明机制与适用条件。' }, planning: { brief: { outputLanguage: 'zh' } }, prompt: 'write in English' }), 'en', 'a derived old brief language must not override a new explicit request');
  assert.match(promptPolicy({ source: { segments: [{ id: '1' }] } }), /knowledge_mode=source_only/);
  assert.match(promptPolicy({ prompt: 'Explain machine learning' }), /knowledge_mode=bounded_explanation/);
  const tail = '| Alternative data | news signals | time alignment |';
  const source = { kind: 'file', name: 'lesson.md', text: 'English research source. '.repeat(150), segments: [{ id: '1', location: 'table', text: tail }],
    semantic: { chunks: [{ id: 'c1', topic: 'Factor taxonomy', sourceRefs: ['1'], sourceBlocks: ['b1'], text: 'detail '.repeat(400) + tail,
      contentKind: 'table', visualCandidates: ['table'], priority: 'high' }], blocks: [{ id: 'b1', type: 'table', text: tail, sourceRefs: ['1'] }],
      evidenceAtoms: [{ id: 'e1', kind: 'formula', exactText: 'condition '.repeat(80) + 'HML=(SH+BH)/2-(SL+BL)/2', sourceRefs: ['1'] }] } };
  const packet = sourcePacket({ chunks: source.semantic.chunks, segments: source.segments, evidenceAtoms: source.semantic.evidenceAtoms,
    requiredEvidenceIds: ['e1'], requiredChunkIds: ['c1'] }, 100);
  assert.ok(packet.chunks[0].text.endsWith(tail));
  assert.ok(packet.evidence[0].text.endsWith('HML=(SH+BH)/2-(SL+BL)/2'));
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(packet)));
  assert.ok(sourcePacket({ chunks: source.semantic.chunks }, 100).omittedFromContext.length);
  source.semantic.inventory={items:[{id:'fixture_source_unit',type:'MechanismBlock',title:'Alternative data',text:source.text,source_ref:['1'],chunkRefs:['c1'],priority:'high'}],relationships:[]};
  const raw = { slides: [
    { title: 'Cover', focus: 'Course', refs: [] },
    { title: 'Taxonomy connects signals and controls', focus: 'Keep the relationship', keyPoints: [{ text: 'Alternative data requires time alignment.', refs: ['1', 'bad'], chunkRefs: ['c1', 'bad'] }] },
    { title: 'Conclusion', focus: 'Use controls', refs: ['1'] },
  ] };
  const outline = api.normalizeOutline(raw, 3, source);
  assert.deepEqual(outline[1].refs, ['1']);
  assert.deepEqual(outline[1].chunkRefs, ['c1']);
  assert.equal(outline[1].keyPoints[0].text, raw.slides[1].keyPoints[0].text);
  const project = { pages: 3, source, prompt: 'USER_REQUIREMENT_SENTINEL: write in English', title: 'Course', outline };
  project.planning = planning.buildPlanning(project, raw, outline);
  assert.equal(project.planning.brief.outputLanguage, 'en');
  assert.equal(planning.inferRole({pageContract:{job:'definition'},visualIntent:{type:'comparison'}},1,3,source),'framework');
  assert.equal(project.planning.slidePlan[1].copyBudget.titleHardUnits, 44);
  const richCourse = { ...project, pages: 3, prompt: 'Create a rigorous tutorial from lesson_overview.md.',
    source: { ...source, semantic: { ...source.semantic, chunks: Array.from({ length: 8 }, (_, i) => ({ ...source.semantic.chunks[0], id: `c${i}` })) } } };
  assert.equal(planning.normalizeBrief({ depth: 'balanced', presentationUse: 'course_walkthrough' }, richCourse).depth, 'detailed', 'a filename containing overview must not suppress course depth');
  assert.match(planning.normalizeBrief(null, { ...project, contentPlan: { coreQuestions: [] } }).evidencePolicy, /只使用已提供来源/);
  assert.match(api.outlinePrompt(project), /USER_REQUIREMENT_SENTINEL/);
  assert.match(api.outlinePrompt(project), /source_directory/);
  assert.match(api.outlinePrompt(project), /fixture_source_unit/);assert.match(source.segments[0].text,/Alternative data/); // Whole excerpts live in immutable storage, not the short directory.
  const writer = api.contentPrompt(project, outline[1], 1);
  assert.match(writer, /ownedPoints/);
  assert.match(writer, /Alternative data requires time alignment/);
  assert.match(writer, /complete mechanism, conditions and comparisons/);
  const schema = JSON.parse(writer.match(/返回唯一 JSON：([^\n]+)。只输出 JSON/)[1]);
  assert.ok(!('bullets' in schema) && !('factSynthesis' in schema) && !('titleCandidates' in schema));
  const next = api.normalizeSlide({ title: outline[1].title, contentBlocks: [{ type: 'constraint', heading: 'Time alignment', body: 'Alternative data requires time alignment so signals are known before the trading decision.' }] }, outline[1], project);
  assert.match(next.bullets[0], /known before/);
  assert.equal(next.copy.blocks.length, 1);
  const cards = api.normalizeSlide({ headline: 'Controls prevent timing leakage', cards: [{ label: 'Controls', detail: 'Align publication times before testing the signal.' }] }, outline[1], project);
  assert.match(cards.bullets[0], /Align publication/);
  const nativeSpec = { slots: [{ shapeId: 1, role: 'title' }, { shapeId: 2, role: 'content', purpose: 'point-heading' },
    { shapeId: 3, role: 'content', purpose: 'point-description', pairedWith: 2 }, { shapeId: 4, role: 'content', purpose: 'list' }] };
  const native = canonicalWriterOutput({ slotTexts: { 1: 'Taxonomy', 2: 'Signals', 3: 'Signals need timing controls.', 4: [{ label: 'Availability', body: 'Use only observations available before the decision.' }] } }, nativeSpec);
  assert.equal(native.title, 'Taxonomy');
  assert.deepEqual(native.contentBlocks.map(b => b.heading), ['Signals', 'Availability']);
  assert.equal(native.contentBlocks[0].body, 'Signals need timing controls.');
  const typedNative=canonicalWriterOutput({slotTexts:{3:'Different timing rules have different consequences.'},slotContentTypes:{3:'contrast'}},nativeSpec);
  assert.equal(typedNative.contentBlocks[0].type,'contrast');
  const aliasInput={sourceCommentary:[{purpose:'constraint',text:'IC 0.03–0.06 is a historical range, not a guarantee.'}],sourceArtifacts:[{sourceUnitId:'frozen',rowStart:1,rowEnd:4}]};const aliasOutput=canonicalWriterOutput(aliasInput);assert.equal(aliasOutput.sourceCommentary[0].type,'constraint');assert.equal(aliasOutput.sourceCommentary[0].text,aliasInput.sourceCommentary[0].text);assert.deepEqual(aliasOutput.sourceArtifacts,aliasInput.sourceArtifacts);assert.equal(aliasInput.sourceCommentary[0].type,undefined);
  assert.equal(canonicalWriterOutput({sourceCommentary:[{purpose:'point-description',text:'Required body'}]}).sourceCommentary[0].type,undefined,'geometry purpose cannot be inferred as semantic content type');
  assert.throws(()=>canonicalWriterOutput({sourceCommentary:[{purpose:'constraint',type:'evidence',text:'Same body'}]}),/conflicting type/);
  assert.throws(()=>canonicalWriterOutput({slotTexts:{3:'Visible explanation'},slotContentTypes:{3:'point-description'}},nativeSpec),/invalid visible native copy type/);
  const replacedNative=canonicalWriterOutput({slotTexts:{3:'Obsolete template body'},slotContentTypes:{3:'point-description'},sourceArtifacts:[{sourceUnitId:'formula'}]},nativeSpec);
  assert.deepEqual(replacedNative.contentBlocks,[],'source-owned compiler replaces native body; old slot copy cannot become visible compatibility content');
  const titleDraft={title:'A qualified title',templateSlotTexts:{1:'A qualified title'},copy:{blocks:[]}};
  assert.match(writerRepairPrompt('prompt',titleDraft,[{code:'under_expanded',repair:'expand_support'}]),/<preserve_valid_title>/);
  assert.doesNotMatch(writerRepairPrompt('prompt',{...titleDraft,templateSlotTexts:{1:'Different title'}},[{code:'template_slot_overflow',slotRole:'title',shapeId:1}]),/<preserve_valid_title>/);
  const nativeTitleRepair=writerRepairPrompt('prompt',titleDraft,[{code:'template_slot_overflow',slotRole:'title',shapeId:1,capacity:6}]);
  assert.match(nativeTitleRepair,/"capacity":6/);assert.match(nativeTitleRepair,/"slotRole":"title"/);assert.match(nativeTitleRepair,/约 6 个中文字符/);
  const repairWithLimits='<final_native_limits>[{"shapeId":1,"role":"title","maxVisualUnits":6},{"shapeId":2,"role":"section","maxVisualUnits":5}]</final_native_limits>';
  const navigationRepair=writerRepairPrompt(repairWithLimits,titleDraft,[{code:'template_slot_overflow',slotRole:'section',shapeId:2,capacity:5}]);
  assert.match(navigationRepair,/<section_slot_repairs>/);assert.match(navigationRepair,/不是锁定的来源原文/);assert.match(navigationRepair,/<preserve_valid_title>/);assert.doesNotMatch(navigationRepair,/<required_native_reflow>/);
  const bodyRepair=writerRepairPrompt(repairWithLimits,titleDraft,[{code:'template_text_fit',slotRole:'content',shapeId:9}]);
  assert.match(bodyRepair,/<required_native_reflow>/);assert.match(bodyRepair,/"slotTextsShapeIds":\[1,2\]/);assert.match(bodyRepair,/原槽位事实、required_visible_evidence/);
  const repairFramework={frameworkHash:'unchanged-framework',material:{sourceText:'Long immutable source. '.repeat(2000),knowledge:'source_only',prompt:'LOCKED_USER_REQUEST: preserve the supplied relationship.'}};
  const longRepair=`当前任务只写第 2 页，共 3 页。\nINPUT_FRAMEWORK=${JSON.stringify(repairFramework)}\n<source_packet>{"evidence":[{"text":"Exact complete source relationship."}]}</source_packet>\n${repairWithLimits}`;
  const focused=writerRepairPrompt(longRepair,titleDraft,[{code:'template_text_fit',slotRole:'content',shapeId:9}]);
  assert.ok(focused.length<longRepair.length/2);assert.match(focused,/unchanged-framework/);assert.match(focused,/LOCKED_USER_REQUEST/);assert.match(focused,/Exact complete source relationship/);assert.match(focused,/not a replacement input framework/);
  assert.equal(repairFramework.material.sourceText.length,'Long immutable source. '.repeat(2000).length);
  const boundRepair=writerRepairPrompt(longRepair+'\n<frozen_source_selection>[{"sourceUnitId":"table","rowStart":1,"rowEnd":5}]</frozen_source_selection>\n<required_visible_evidence>[{"id":"locked-evidence","exactText":"Full locked condition remains visible."}]</required_visible_evidence>\n<source_commentary_budget>{"sourceFits":true,"singleParagraphCjkCharacters":364,"paragraphCount":1}</source_commentary_budget>\n返回唯一 JSON：{"sourceCommentary":["Obsolete expanded instructions"]}。只输出 JSON。',titleDraft,[{category:'missing',detail:'Explain the original relationship.'}]);
  const boundSchema=JSON.parse([...boundRepair.matchAll(/返回唯一 JSON：([^\n]+)。只输出 JSON/g)].at(-1)[1]);
  assert.deepEqual(boundSchema.sourceArtifacts,[{sourceUnitId:'table',rowStart:1,rowEnd:5}]);assert.deepEqual(boundSchema.sourceEvidenceIds,['locked-evidence']);assert.equal(boundSchema.sourceCommentary.length,1);assert.match(boundSchema.sourceCommentary[0].text,/309/);assert.match(boundRepair,/<final_bound_source_repair>/);assert.match(boundRepair,/不能省略真实缺失/);
  const currentSchemaContext=writerCorrectionContext(longRepair+'\n返回唯一 JSON：{"old":true}。只输出 JSON。\n返回唯一 JSON：'+JSON.stringify(boundSchema)+'。只输出 JSON。');
  assert.doesNotMatch(currentSchemaContext,/"old":true/);assert.match(currentSchemaContext,/"sourceUnitId":"table","rowStart":1,"rowEnd":5/);assert.match(currentSchemaContext,/Full locked condition|Exact complete source relationship/);
  const coverRepair=writerRepairPrompt(repairWithLimits,titleDraft,[{code:'template_cover_body'}]);assert.match(coverRepair,/<native_cover_repair>/);assert.match(coverRepair,/"sourceCommentary":\[\]/);
  assert.equal(objectWritingCapacity({ outline: [{ id: 'native' }], templateFidelity: { slides: [{ slots: [{ shapeId: 3, capacity: 90, maxLines: 3 }] }] } }, 'native', { nativeRef: { shapeId: 3 }, templateSlot: { capacity: 20 } }).maxLines, 3);
  assert.match(slideSemanticContext({ title: 'Visible', bullets: ['stale hidden text'], nodes: [{ type: 'text', nativeRef: { shapeId: 1 }, content: { text: 'Actual native explanation' } }] }).visibleText, /Actual native/);
  assert.ok(!slideSemanticContext({ title: 'Visible', bullets: ['stale hidden text'], nodes: [{ type: 'text', nativeRef: { shapeId: 1 }, content: { text: 'Actual native explanation' } }] }).visibleText.includes('stale hidden'));
  assert.throws(() => canonicalWriterOutput({ slotTexts: { 3: 'x'.repeat(5001) } }, nativeSpec), /safety limit/);
  const finding = quality.normalizeModelReview({ missing: [{ slideIds: [outline[1].id], detail: 'Missing control relation', reason: 'shallow', suggestedFix: 'Explain signal timing before the trading decision.' }], repeated: [], conflicts: [], unsupported: [] }, outline.map(s => s.id));
  assert.equal(finding.missing[0].reason, 'shallow');
  assert.match(finding.missing[0].suggestedFix, /timing/);
  assert.equal(quality.finalQualityReport({ strictCoverage: true, hardErrors: 0, issues: [] }, [], finding).status, 'blocked');
  assert.match(quality.deckReviewPrompt({ ...project, deck: { slides: [next] } }), /suggestedFix/);
  const scopedReview=quality.deckReviewPrompt({...project,deck:{slides:[next]},generationPolicy:{content:'overview',details:'notes',language:{mode:'source'}},contentSelection:{sourceHash:'immutable',entries:[{sourceUnitId:'optional',destination:'notes'},{sourceUnitId:'table',destination:'summary',rowIndices:[1,3]}]}});
  assert.match(scopedReview,/presentation_disposition_review/);assert.match(scopedReview,/rowEnd EXCLUSIVE/);assert.match(scopedReview,/allowed notes-only unit is not a slide omission/i);assert.match(scopedReview,/genuine visible witness/);assert.match(scopedReview,/conditions, wrong translations or unsupported additions/);
  const targetProject = { deck: { slides: Array.from({ length: 8 }, (_, i) => ({ id: String(i), nodes: i === 1 ? [{ locked: true, type: 'shape', semanticRole: 'visual', content: {} }] : [] })) },
    runtime: { slides: { 2: { accepted: true } } }, constraints: { entries: [{ active: true, slideId: '3' }] } };
  const allFindings = { missing: Array.from({ length: 8 }, (_, i) => ({ slideIds: [String(i)], detail: 'Missing mechanism' })) };
  assert.deepEqual(criticRewriteTargets(targetProject, allFindings).map(t => t.slideId), ['1'], 'decorative locks do not exclude a native page; accepted and constrained pages do');
  targetProject.deck.slides[1].nodes.push({ locked: true, type: 'text', content: { text: 'User locked text' } });
  assert.equal(criticRewriteTargets(targetProject, allFindings)[0].slideId, '4');
  const bigPlan = { outline: Array.from({ length: 100 }, (_, i) => ({ id: `s${i}`, title: `Page ${i}`, focus: 'Different claim', keyPoints: [{ text: 'unique content '.repeat(50) }] })) };
  const boundedNarrative = narrativeContext(bigPlan, 's98', 10000);
  assert.ok(boundedNarrative[98].ownedPoints.length && boundedNarrative[97].ownedPoints.length);
  assert.ok(JSON.stringify(boundedNarrative).length < 18000);

  // Exercise the real shim without a model or credentials. This validates the
  // framed UTF-8 input/EOF path, not Claude/GPT output quality.
  const fake = path.join(root, 'fake-model.py');
  fs.writeFileSync(fake, '#!/usr/bin/env python3\nimport sys,json\nprint(json.dumps({"args":sys.argv[1:],"text":sys.stdin.read()},ensure_ascii=False))\n');
  fs.chmodSync(fake, 0o700);
  const huge = '完整中文表达与原始公式。'.repeat(16000);
  const run = spawnSync('python3', [new URL('./container/cowork-shim.py',import.meta.url).pathname, '--', '-p', '--system-prompt', PPT_SYSTEM_PROMPT], {
    input: pptPromptFrame(huge), maxBuffer: 4 * 1024 * 1024, encoding: 'utf8',
    env: { ...process.env, COWORK_CLAUDE_BIN: fake, COWORK_WORKSPACE: root, COWORK_SKILLS_DIR: path.join(root, 'no-skills') },
  });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(JSON.parse(run.stdout).text, huge);
  assert.ok(!JSON.parse(run.stdout).args.includes(huge));

  // Full API workflow with simulated model responses: two critic rounds,
  // then publish. A second run pauses mid-rewrite and discards stale output.
  const uid = 'prompt-contract-test';
  let criticCalls = 0, writerRepairs = 0, rendered = 0, pauseDuringReview = false, pauseDuringRewrite = false, conflictDuringRewrite = false, neverFix = false, cancelDuringRewrite = false, criticTransportFailure = false;
  const bodies = ['Define exposure from the loading on the systematic return component. Larger loadings imply stronger sensitivity; interpret that sensitivity under the same model assumptions.', 'Compare return spreads under a consistent holding-period convention.',
    'Align each observation with the information available at the decision time.', 'Control for industry membership before evaluating a cross-sectional signal.',
    'Separate the signal definition from the portfolio weighting rule.', 'Evaluate the mechanism after transaction costs under the same assumptions.'];
  const titles = ['Exposure', 'Return spreads', 'Time alignment', 'Industry controls', 'Portfolio weights', 'Cost evaluation'];
  const deps = { ...api.defaultDeps, modelCall: async (p, prompt, activity, log, options = {}) => {
    if (prompt.includes('叙事规划器')) return { brief: { depth: 'balanced', presentationUse: 'technical_explainer' }, slides: Array.from({ length: 8 }, (_, i) => ({
      id: `s${i}`, title: i === 0 ? 'Research workflow' : i === 7 ? 'Apply the framework' : titles[i - 1],
      focus: i > 0 && i < 7 ? bodies[i - 1] : i === 0 ? 'Explain the workflow' : 'Combine controls and costs', refs: i > 0 && i < 7 ? p.source.segments.filter(s=>s.text.includes(bodies[i-1])).map(s=>s.id) : [],
      keyPoints: i > 0 && i < 7 ? [{ text: bodies[i - 1], refs: p.source.segments.filter(s=>s.text.includes(bodies[i-1])).map(s=>s.id) }] : [],
    })) };
    if ((options.nodeKey || '').startsWith('review:deck')) {
      if(pauseDuringReview){const latest=store.get(uid,p.id);latest.runtime.pauseRequested=true;store.save(latest);throw Object.assign(new Error('ppt_cancelled'),{code:'cancelled'});}
      criticCalls++;
      return { ...scopeReview(p), missing: writerRepairs < 2 || pauseDuringRewrite || conflictDuringRewrite || neverFix || cancelDuringRewrite || criticTransportFailure ? [{ slideIds: ['s1'], detail: 'The mechanism needs its interpretation.', reason: 'shallow', suggestedFix: 'Explain how exposure identifies the systematic return component.' }] : [], repeated: [], conflicts: [], unsupported: [] };
    }
    const i = Number(prompt.match(/第 (\d+) 页/)?.[1]) - 1;
    if ((options.nodeKey || '').includes(':critic:')) {
      writerRepairs++;
      assert.match(prompt, /<findings>/);
      if (criticTransportFailure) throw new Error('ppt_timeout');
      if (pauseDuringRewrite) { const latest = store.get(uid, p.id); latest.runtime.pauseRequested = true; store.save(latest); }
      if (conflictDuringRewrite) { const latest = store.get(uid, p.id); latest.editing.epochs.s1 = (latest.editing.epochs.s1 || 0) + 1; store.save(latest); }
      if (cancelDuringRewrite) { const latest = store.get(uid, p.id); latest.status = 'cancelled'; store.save(latest); }
    }
    const body = i === 1 ? bodies[0].split('. ').slice(0, writerRepairs > 0 ? 2 : 1).join('. ') : bodies[i - 1];
    return { title: p.outline[i].title, contentBlocks: i === 0 ? [] : [{ type: 'definition', heading: '', body: i === 7 ? 'Combine timing alignment, industry controls and transaction costs before evaluating the signal.' : body }] };
  }, renderPptx: async project => { rendered++; return simulatedExport(project); } };
  const request = async (method, url, data) => {
    const req = Readable.from(data ? [Buffer.from(JSON.stringify(data))] : []); req.method = method;
    let result;
    await handlePpt(req, new URL(`http://test${url}`), { uid, deps, activity: () => {}, log: () => {}, readBody: async () => Buffer.from(JSON.stringify(data)),
      send: (status, body) => { result = { status, body }; return true; }, res: { writeHead() {}, on() {} } });
    return result;
  };
  const settled = async (id, states) => {
    for (let i = 0; i < 500; i++) { const p = store.get(uid, id); if (states.includes(p?.status)) return p; await new Promise(r => setTimeout(r, 10)); }
    const last=store.get(uid,id);throw new Error('workflow did not settle: '+JSON.stringify({status:last?.status,stage:last?.stage,error:last?.error,issues:last?.candidateOutline?.issues}));
  };
  const create = () => request('POST', '/ppt/projects', { inputKind: 'paste', text: bodies.join('\n\n'), title: 'Research workflow', pages: 8, template: 'light', model: 'gpt', configId: 'simulation-only' });
  const created = await create(); assert.equal(created.status, 201);
  await settled(created.body.project.id, ['outline_ready']);
  assert.equal((await request('POST', `/ppt/projects/${created.body.project.id}/generate`)).status, 202);
  const finished = await settled(created.body.project.id, ['completed', 'failed', 'quality_blocked']);
  assert.equal(finished.status, 'completed', finished.error);
  assert.equal(writerRepairs, 2); assert.equal(criticCalls, 3,'two repair rounds require three fresh critic assessments'); assert.equal(finished.quality.reviewInputHash,(await import('./lib/ppt/versioning.mjs')).semanticReviewKey(finished),'final assessment must bind the canonical published content'); assert.equal(rendered, 1);
  assert.equal(finished.runtime.criticRepair.rounds, 2);
  assert.equal(finished.runtime.criticRepair.attempts.length, 2);
  assert.equal(finished.dagNodes['review:deck'].result.missing.length, 0);
  assert.equal(finished.dagNodes['content:s1'].criticRound, 2);
  assert.equal(finished.quality.modelReview.missing.length, 0);
  assert.equal(finished.model, 'gpt');
  criticTransportFailure = true;
  const timeoutCreated = await create(); await settled(timeoutCreated.body.project.id, ['outline_ready']);
  await request('POST', `/ppt/projects/${timeoutCreated.body.project.id}/generate`);
  const timedRepair = await settled(timeoutCreated.body.project.id, ['completed', 'failed', 'quality_blocked']);
  assert.equal(timedRepair.status, 'quality_blocked', 'optional repair timeout retains the actual unresolved gate rather than losing the whole working deck');
  assert.equal(Object.values(timedRepair.nodes).filter(n=>n.status==='done').length, 8);
  assert.ok(timedRepair.quality.modelReview.missing.length, 'timeout must not clear critic findings');
  assert.ok(timedRepair.runtime.criticRepair.attempts.some(a=>a.rolledBack && a.violations.some(v=>v.code==='ppt_timeout')));
  assert.ok(!timedRepair.publishedRevision, 'unresolved review remains unpublished');
  assert.equal(rendered, 1, 'failed optional repair never bypasses export gates');
  criticTransportFailure = false;
  pauseDuringReview=true;
  const pausedReviewCreated=await create();await settled(pausedReviewCreated.body.project.id,['outline_ready']);
  await request('POST',`/ppt/projects/${pausedReviewCreated.body.project.id}/generate`);
  const pausedReview=await settled(pausedReviewCreated.body.project.id,['paused','failed']);
  assert.equal(pausedReview.status,'paused','BYOK review cancellation for Pause must not become failed');
  assert.equal(pausedReview.stage,'review:deck','actual review call replaces the stale last writer stage');
  assert.equal(Object.values(pausedReview.nodes).filter(n=>n.status==='done').length,8,'Pause retains completed writer pages');
  assert.equal(rendered,1,'a paused review never publishes');
  pauseDuringReview=false;
  pauseDuringRewrite = true;
  const pausedCreated = await create(); await settled(pausedCreated.body.project.id, ['outline_ready']);
  await request('POST', `/ppt/projects/${pausedCreated.body.project.id}/generate`);
  const paused = await settled(pausedCreated.body.project.id, ['paused', 'failed']);
  assert.equal(paused.status, 'paused', paused.error);
  assert.equal(paused.runtime.criticRepair.rounds, 1);
  assert.equal(paused.runtime.criticRepair.attempts.length, 0, 'a rewrite completed after pause must not commit');
  assert.equal(rendered, 1);
  pauseDuringRewrite = false; conflictDuringRewrite = true;
  const staleCreated = await create(); await settled(staleCreated.body.project.id, ['outline_ready']);
  await request('POST', `/ppt/projects/${staleCreated.body.project.id}/generate`);
  const stale = await settled(staleCreated.body.project.id, ['failed']);
  assert.match(stale.error, /stale rewrite discarded/);
  assert.equal(stale.runtime.criticRepair.attempts.length, 0);
  assert.equal(rendered, 1);
  conflictDuringRewrite = false; neverFix = true;
  const blockedCreated = await create(); await settled(blockedCreated.body.project.id, ['outline_ready']);
  await request('POST', `/ppt/projects/${blockedCreated.body.project.id}/generate`);
  const blocked = await settled(blockedCreated.body.project.id, ['completed', 'quality_blocked', 'failed']);
  assert.equal(blocked.runtime.criticRepair.rounds, 1);
  assert.equal(blocked.runtime.criticRepair.stoppedReason,'no_progress');
  assert.equal(blocked.status, 'quality_blocked', blocked.error);
  assert.equal(blocked.quality.modelReview.missing[0].reason, 'shallow');
  assert.equal(rendered, 1, 'remaining strict-depth findings must not publish at the round limit');
  const blockedRunId=blocked.currentRunId,blockedAttempts=structuredClone(blocked.runtime.criticRepair), reviewsBeforeRetry=criticCalls;
  assert.equal((await request('POST',`/ppt/projects/${blocked.id}/retry`)).status,202);
  const blockedRetry=await settled(blocked.id,['completed','quality_blocked','failed']);
  assert.equal(blockedRetry.status,'quality_blocked','explicit rerun must still enforce unresolved review gates');
  assert.notEqual(blockedRetry.currentRunId,blockedRunId,'quality retry is a distinct durable run');
  assert.ok(criticCalls > reviewsBeforeRetry, 'explicit quality retry invokes an independent model review');
  assert.deepEqual(blockedRetry.runtime.criticRepairHistory.at(-1),blockedAttempts,'prior bounded critic attempts are retained');
  assert.equal(blockedRetry.runtime.criticRepair.rounds,1,'new run still stops when its writer makes no progress');
  assert.equal(rendered,1,'quality retry cannot publish a still-blocked candidate');
  neverFix = false; cancelDuringRewrite = true;
  const cancelledCreated = await create(); await settled(cancelledCreated.body.project.id, ['outline_ready']);
  await request('POST', `/ppt/projects/${cancelledCreated.body.project.id}/generate`);
  const cancelled = await settled(cancelledCreated.body.project.id, ['cancelled']);
  assert.equal(cancelled.runtime.criticRepair.attempts.length, 0);
  assert.equal(rendered, 1);
  console.log('PPT prompt contracts: source/language, canonical copy, protected context, title budgets, critic bounds, locks, pause and UTF-8 shim transport: OK');
} finally { fs.rmSync(root, { recursive: true, force: true }); }

// A real native writer returned legacy object bullets alongside frozen sources.
// Slot/source compilation owns the visible body; no second body is normalized.
const nativeCanonical=canonicalWriterOutput({title:'Known',slotTexts:{3:'Known'},sourceArtifacts:[{sourceUnitId:'known'}],sourceCommentary:[],bullets:[{name:'Duplicate',text:'Already bound'}],factSynthesis:['Already bound']},{slots:[{shapeId:3,role:'title'}]});
assert.deepEqual(nativeCanonical.contentBlocks,[]);assert.equal(nativeCanonical.bullets,undefined);assert.equal(nativeCanonical.factSynthesis,undefined);
console.log('PASS: native body cleanup runs after authoritative source/slot compilation, including unexpected legacy object bullets.');
