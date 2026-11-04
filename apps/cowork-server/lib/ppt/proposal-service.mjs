import {auditCardPoints,needsRelationAudit} from '../ppt-card-coverage.mjs';
import {missingCardPoints} from '../ppt-outline-cards.mjs';
import {fillComponentCommands} from './component-fill.mjs';
import {CARD_STRUCTURE_STATE,explicitStructureTargets} from './card-structure.mjs';
import {LAYOUT_IDS} from '../ppt-layout.mjs';
import { assertCandidateScope, assertStoredCandidateScope } from './input-scope-service.mjs';
import { normalizeAiAction, aiActionPrompt, proposalMetrics, WRITING_ACTIONS } from './ai-actions.mjs';
import path from 'node:path';
import { atomicJson, readJson, projectDataDir, enqueueProject, getProject } from './repository.mjs';
import { applyCommand, _internals as commands } from './command-service.mjs';
import { normalizeCommand, validateNodeContent } from './command-schema.mjs';
import { findOperation } from './command-history.mjs';
import { newId,ensureSlideV3 } from './ir.mjs';
import { planKey, slideFingerprint, editableCapabilities, editError, digest, pageEditContext, assertPageEditContext } from './edit-context.mjs';
import { buildSlideRenderTree } from './render-tree.mjs';
import { slideSvg } from './exporters/preview.mjs';
import { reviewProject } from './quality-service.mjs';
import { isSourceOwnedNode } from '../ppt-source-artifacts.mjs';
import { missingRequiredEvidence, evidenceMeasurements } from '../ppt-evidence.mjs';
import { retrieveSlideSources } from '../ppt-planning.mjs';
import { cardsFlow } from '../ppt-flow.mjs';
import { promptPolicy, writingGuide, editPromptContext, objectWritingCapacity, cardEditPolicy, cardEditSources } from '../ppt-prompt-contracts.mjs';
import { classifyMutation, routeMutation, impactFor } from './mutation-router.mjs';
import { typedCommands, materializeTypedCandidate } from './typed-proposal.mjs';
import {resolveEditTarget,patchEditTarget,assertTableTextIdentity} from './edit-target.mjs';
import fs from 'node:fs';
import {summaryProjectionProofs} from './source-summary-projection.mjs';

const layouts = new Set(LAYOUT_IDS);
function file(uid, projectId, id) {
  if (!/^proposal_[a-f0-9]+$/u.test(String(id))) throw editError('invalid proposal id', 400);
  return path.join(projectDataDir(uid, projectId), 'proposals', `${id}.json`);
}
// Snapshots keep inline images as account media references (see stringifyWithMediaRefs).
const writeProposal = (uid, projectId, id, value) => atomicJson(file(uid, projectId, id), value, uid);
export function readProposal(uid, projectId, id) {
  const proposal = readJson(file(uid, projectId, id), null, uid);
  if (!proposal) throw editError('proposal not found', 404);
  return proposal;
}
function checkContext(project, proposal) {
  assertPageEditContext(project, proposal);
  if(proposal.mode==='native-content'&&project.runtime?.slides?.[proposal.slideId]?.accepted)throw editError('unlock the page before reflow',409);
  if (planKey(project) !== proposal.planKey || slideFingerprint(project, proposal.slideId) !== proposal.targetContentHash)
    throw editError('the target or its plan changed; preview again', 409);
  if ((proposal.type === 'structure' || proposal.scope === 'deck') && project.revision !== proposal.baseRevision) throw editError('the deck changed after structure planning; preview again', 409);
  if (project.runtime?.slides?.[proposal.slideId]?.accepted && ['content', 'title', 'data', 'structure'].includes(proposal.type || 'content')) throw editError('the page is accepted; unlock it before changing its content', 409);
}
function baseCandidate(project, proposal) {
  if (proposal.commands) {
    const next = materializeTypedCandidate(project, proposal);
    const state = Object.fromEntries(['template', 'templateSpec', 'outline', 'pages', 'pageDecision', 'planning', 'constraints',...CARD_STRUCTURE_STATE].map(key => [key, next[key]]));
    const command = normalizeCommand({ id: proposal.id, type: 'deck.replace', baseRevision: project.revision, payload: { deck: next.deck, projectState: state } }, project);
    return { command, project: next };
  }
  const payload = proposal.scope === 'object'&&!proposal.patches
    ? { slideId: proposal.slideId, nodeId: proposal.nodeId, patch: { content: proposal.content }, replace: true,...(proposal.summaryProjections?.[proposal.nodeId]?{summaryProjection:proposal.summaryProjections[proposal.nodeId]}:{}) }
    : { slideId: proposal.slideId, patches: proposal.patches.map(({ nodeId, content }) => ({ nodeId, content,...(proposal.summaryProjections?.[nodeId]?{summaryProjection:proposal.summaryProjections[nodeId]}:{}) })), ...(proposal.layoutId ? { layoutId: proposal.layoutId } : {}) };
  const command = normalizeCommand({ id: proposal.id, type: `ai.${proposal.patches?'slide':proposal.scope}Patch`, baseRevision: proposal.baseRevision, payload }, project);
  return { command, project: { ...project, deck: commands.applyToDeck(project.deck, command, project).deck } };
}
function candidate(project,proposal){
 const result=baseCandidate(project,proposal);
 if(!proposal.cardPointCoverage)return result;
 result.project.deck.slides.find(s=>s.id===proposal.slideId).cardPointCoverage=structuredClone(proposal.cardPointCoverage);
 // A proof and its visible objects are committed together, with the same
 // revision and scope guard; the writer never controls this metadata.
 result.command=normalizeCommand({id:proposal.id,type:'deck.replace',baseRevision:proposal.baseRevision,payload:{deck:result.project.deck}},project);
 return result;
}

function recordSnapshots(project,proposal,next) {
  proposal.snapshots={version:1,before:ensureSlideV3(project.deck.slides.find(s=>s.id===proposal.slideId)),after:ensureSlideV3(next.deck.slides.find(s=>s.id===proposal.slideId))};
  proposal.candidateHash=digest({content:proposal.content,patches:proposal.patches,commands:proposal.commands});
}
function semanticContent(node, input) {
  const content = validateNodeContent(node.type, input);
  if (['text', 'list','timeline'].includes(node.type)) {
    const prose = value => String(node.type === 'text' ? value.text : (value.items || []).map(item => [item.text, item.heading, item.body].filter(Boolean).join(' ')).join(' '));
    const values = value => prose(value).match(/[-+]?\d+(?:[.,]\d+)*(?:%|％)?/gu) || [];
    const next = new Set(values(content));
    const measurements = new Set(evidenceMeasurements(prose(content)).map(item => `${item.value}:${item.unit}`));
    if (evidenceMeasurements(prose(node.content)).some(item => !measurements.has(`${item.value}:${item.unit}`))) throw editError('text optimization must preserve numeric values and units', 422);
    if (values(node.content).some(value => !next.has(value))) throw editError('text optimization must preserve numeric values and units', 422);
  }
  if (node.type === 'chart') {
    const before = validateNodeContent(node.type, node.content);
    if (digest(content) !== digest(before)) throw editError('text optimization cannot change chart data, dimensions, units or type', 422);
  }
  if (node.type === 'table') {
    assertTableTextIdentity(node.content,content);
    const rows = node.content.rows;
    if (content.rows.length !== rows.length || content.rows.some((row, index) => row.length !== rows[index].length || row.some((cell, column) =>
      (index === 0 || column === 0 || /[0-9%％]/u.test(String(rows[index][column]))) && cell !== rows[index][column])))
      throw editError('text optimization cannot change table dimensions, headers or numeric cells', 422);
  }
  if (node.type === 'shape' && content.shape !== (node.content.shape || 'rect')) throw editError('text optimization cannot change the shape type', 422);
  return content;
}

/** The gate's finding in plain words for the editor (Fable D2: no automatic retry). */
function gateReason(issues) {
  const fit = issues.find(issue => ['typography_capacity', 'rendered_title_capacity'].includes(issue.code) && issue.details?.lines);
  if (fit) { const d = fit.details, perLine = d.estimatedHeightPt / d.lines, holds = Math.max(1, Math.floor(d.availableHeightPt / perLine));
    return `the edited text needs ${d.lines} lines and its box holds ${holds}; ask for a shorter version`; }
  return issues.map(issue => issue.message || issue.code).slice(0, 2).join('; ');
}
const FIT_CODES = new Set(['typography_capacity', 'rendered_title_capacity', 'title_overflow']);
/** The retry's instruction: each overflowing object, the lines it needs, the
 * lines its box holds and its current length (Fable D2'). */
function overflowFeedback(issues, project, slideId, editable) {
  const lines = issues.map(issue => {
    const d = issue.details || {}, perLine = d.lines ? d.estimatedHeightPt / d.lines : 0, holds = perLine ? Math.max(1, Math.floor(d.availableHeightPt / perLine)) : null;
    const node = editable.find(item => (issue.nodeIds || []).includes(item.id)), now = node ? objectWritingCapacity(project, slideId, node)?.charactersNow : null;
    return `- ${node?.id || (issue.nodeIds || [])[0] || 'object'}: your text needs ${d.lines ?? '?'} lines; its box holds ${holds ?? '?'}${now ? ` (the current text has ${now} characters)` : ''}.`;
  });
  return `Your previous answer did not fit:\n${lines.join('\n')}\nReturn a version that fits, using only the facts already in the text; same JSON shape.`;
}
function validateCandidate(before, after, slideId, type = 'content') {
  const slide = after.deck.slides.find(item => item.id === slideId);
  const contract = before.planning?.slidePlan?.find(item => item.slideId === slideId);
  if ((contract?.titleLocked || (before.deck.slides[0]?.id === slideId && before.deckTitle?.locked)) && slide?.title !== before.deck.slides.find(item => item.id === slideId)?.title)
    throw editError('the cover title is locked', 422);
  const missing = type === 'structure' ? [] : missingRequiredEvidence(after, slide, contract);
  if (missing.length) throw editError('required visible evidence would be lost', 422, { evidenceIds: missing.map(item => item.id) });
  const key = issue => JSON.stringify([issue.code, issue.slideId, issue.nodeIds, issue.message]);
  const prior = reviewProject(before).deterministic.issues, baseline = new Set(prior.filter(issue => issue.severity === 'error').map(key)), standing = new Set(prior.filter(issue => !issue.slideId).map(key));
  const quality = reviewProject(after).deterministic;
  const introduced = quality.issues.filter(issue => issue.severity === 'error' && !baseline.has(key(issue)));
  if (introduced.length) throw editError(`candidate failed the quality gate: ${gateReason(introduced)}`, 422, { issues: introduced });
  const objectsBefore=reviewProject(before).deterministic.objectLedger?.objects||[];
  const objectsAfter=quality.objectLedger?.objects||[];
  // A page edit reports its own page, plus deck-wide notes it newly causes.
  return { issues: quality.issues.filter(issue => issue.slideId ? issue.slideId === slideId : !standing.has(key(issue))), hardErrors: quality.hardErrors, introducedHardErrors: 0,
    objectChanges:objectsAfter.filter(after=>objectsBefore.find(prior=>prior.objectId===after.objectId)?.status!==after.status).map(object=>({objectId:object.objectId,status:object.status})),
    preservedObjectIds:objectsAfter.filter(object=>object.status==='rendered').map(object=>object.objectId) };
}

async function reviewTextCandidate(project,proposal,deps,activity,log,editOutputLanguage){
  delete proposal.summaryProjections;
  delete proposal.cardPointCoverage;
  let result=candidate(project,proposal);
  if(cardsFlow(project)){
    const page=project.outline?.find(p=>p.id===proposal.slideId),slide=result.project.deck.slides.find(s=>s.id===proposal.slideId);
    // Geometry/fact failures keep their existing bounded fit retry. Only a
    // lexical point failure can wait for a fresh scoped semantic proof.
    try{validateCandidate(project,result.project,proposal.slideId);}catch(error){if(!error.details?.issues?.length||!error.details.issues.every(i=>i.code==='card_point_missing'))throw error;}
    if(page&&(missingCardPoints(page,slide,project).length||needsRelationAudit(page))){proposal.cardPointCoverage=await auditCardPoints(project,slide,page,deps,activity,log);result=candidate(project,proposal);}
  }
  const pending=summaryProjectionProofs(project,result.project,proposal.slideId);
  if(Object.keys(pending).length){
    proposal.summaryProjections=pending;result=candidate(project,proposal);
    proposal.scopeAudit=await assertCandidateScope(project,{...result.project,summaryProjectionReview:true,...(editOutputLanguage?{editOutputLanguage}:{})},deps,activity,log);
    proposal.summaryProjections=summaryProjectionProofs(project,result.project,proposal.slideId,'complete',proposal.scopeAudit);result=candidate(project,proposal);
    assertStoredCandidateScope(project,result.project,proposal);
    proposal.quality=validateCandidate(project,result.project,proposal.slideId);
  }else{
    proposal.quality=validateCandidate(project,result.project,proposal.slideId);
    proposal.scopeAudit=await assertCandidateScope(project,{...result.project,...(editOutputLanguage?{editOutputLanguage}:{})},deps,activity,log);
  }
  return result;
}

/** The model produces semantic patches. IDs, layout capabilities and commit versions stay server-owned. */
const CARD_EDIT_PROMPT_CHARS = 20000;
export async function createProposal(input, data, deps, activity, log) {
  const project = structuredClone(input);

  if (!Number.isInteger(data.baseRevision) || data.baseRevision !== project.revision) throw editError('refresh the project before previewing', 409);
  const explicit=!WRITING_ACTIONS.includes(data.action)&&classifyMutation(data.instruction,data.type||data.mode)==='structure'&&/合并|merge/iu.test(data.instruction||'')?explicitStructureTargets(project,data.instruction):null;if(explicit)data={...data,...explicit};
  const slide = project.deck?.slides.find(item => item.id === data.slideId);
  if (!slide) throw editError('slide not found', 404);
  const instruction = String(data.instruction || '').trim();
  if (!instruction || instruction.length > 1000) throw editError('instruction must contain 1–1000 characters', 400);
  if (!['slide', 'object', 'deck'].includes(data.scope)) throw editError('invalid scope', 400);
  const multiple=data.scope==='object'&&Array.isArray(data.nodeIds)&&data.nodeIds.length>1;
  if(data.nodeIds!==undefined&&(!Array.isArray(data.nodeIds)||data.nodeIds.length>30||new Set(data.nodeIds).size!==data.nodeIds.length||data.nodeIds.some(id=>typeof id!=='string')||data.scope!=='object'))throw editError('invalid selected component members',400);
  if(multiple&&data.target)throw editError('a text range requires one object',400);
  const action = normalizeAiAction(data.action, data.parameters);
  if (WRITING_ACTIONS.includes(action.action) && data.type && !['auto', 'content', 'title'].includes(data.type)) throw editError('writing actions cannot change layout, assets or data', 400);
  const route = routeMutation(project, instruction, { type: WRITING_ACTIONS.includes(action.action) ? (data.type === 'title' ? 'title' : 'content') : data.type, mode: data.mode });
  const liveEditContext = pageEditContext(project, slide.id, route.type, data.scope);
  if (project.runtime?.slides?.[slide.id]?.accepted && ['content', 'title', 'data', 'structure'].includes(route.type)) throw editError('this page is accepted; unlock it before changing its content', 409);
  if(multiple&&!['content','title'].includes(route.type))throw editError('multiple selected objects support content edits only',409);
  if (['layout', 'style', 'asset', 'data', 'structure'].includes(route.type)||route.strategy==='fill-component') {
    const id = newId('proposal');
    const proposal = { id, liveEditContext, projectId: project.id, slideId: slide.id, scope: data.scope, type: route.type,mode:route.strategy==='fill-component'?'fill-component':data.mode, action: data.action, instruction,
      baseRevision: project.revision, planKey: planKey(project), targetContentHash: slideFingerprint(project, slide.id),
      impact: impactFor(project, route, [slide.id]), modelRef: { configId: project.configId, model: project.model },
      status: 'proposed', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString() };
    proposal.commands = await (route.strategy==='fill-component'?fillComponentCommands:typedCommands)(project, { ...data, type: route.type, proposalId: id }, deps, activity, log);
    let result = candidate(project, proposal);
    if(route.strategy==='fill-component'){proposal.mode='fill-component';result=await reviewTextCandidate(project,proposal,deps,activity,log);}
    else if(proposal.mode==='native-content')result=await reviewTextCandidate(project,proposal,deps,activity,log);
    const structure=proposal.commands[0]?.payload?.cardStructure;if(structure)proposal.structureChange=structure;
    const affected = result.project.deck.slides.filter(item => item.id === (structure?.targetId||slide.id) || !project.deck.slides.some(old => old.id === item.id));
    if (route.type === 'structure') {
      const contract = project.planning?.slidePlan?.find(item => item.slideId === slide.id);
      const preserved = affected.length ? affected : result.project.deck.slides;
      const combined = { ...slide, nodes: preserved.flatMap(item => item.nodes), bullets: preserved.flatMap(item => item.bullets), copy: { blocks: preserved.flatMap(item => item.copy?.blocks || []) } };
      if (missingRequiredEvidence(result.project, combined, contract).length) throw editError('structure change would remove required evidence', 422);
    }
    proposal.quality = validateCandidate(project, result.project, slide.id, route.type);
    recordSnapshots(project,proposal,result.project);
    if (['data', 'structure', 'asset'].includes(route.type)) proposal.scopeAudit = await assertCandidateScope(project, result.project, deps, activity, log);
    const preview = { beforeSvg: slideSvg(buildSlideRenderTree(project, slide.id)),
      afterSvg: affected[0] ? slideSvg(buildSlideRenderTree(result.project, affected[0].id)) : '',
      afterSlides: affected.map(item => ({ slideId: item.id, svg: slideSvg(buildSlideRenderTree(result.project, item.id)) })) };
    proposal.pageDelta = result.project.deck.slides.length - project.deck.slides.length;
    proposal.changedNodeIds = (route.strategy==='fill-component'||proposal.mode==='native-content')?[...new Set([...slide.nodes,...result.project.deck.slides.find(s=>s.id===slide.id).nodes].filter(n=>digest(slide.nodes.find(x=>x.id===n.id))!==digest(result.project.deck.slides.find(s=>s.id===slide.id).nodes.find(x=>x.id===n.id))).map(n=>n.id))]:proposal.commands.flatMap(command => [command.payload.nodeId,...(command.payload.changes||[]).map(change=>change.nodeId)].filter(Boolean));
    proposal.beforeRenderHash = digest(preview.beforeSvg); proposal.afterRenderHash = digest(preview.afterSlides);
    await enqueueProject(project.uid, project.id, () => { checkContext(getProject(project.uid, project.id), proposal); writeProposal(project.uid, project.id, id, proposal); });
    const alternatives=[];
    if(route.type==='layout'&&editableCapabilities(project).relayout&&project.templateFidelity?.mode!=='preserve')for(const layoutId of LAYOUT_IDS.filter(id=>id!==proposal.commands[0]?.payload.layoutId&&(!['chart','table','image-text'].includes(id)||slide.nodes.some(n=>n.type===({chart:'chart',table:'table','image-text':'image'}[id]))))) {
      if(alternatives.length>=2)break;
      const option={...structuredClone(proposal),id:newId('proposal'),commands:proposal.commands.map(command=>command.type==='slide.setLayout'?{...command,payload:{...command.payload,layoutId}}:command)};
      try {const next=candidate(project,option).project;option.quality=validateCandidate(project,next,slide.id,'layout');recordSnapshots(project,option,next);const svg=slideSvg(buildSlideRenderTree(next,slide.id));option.afterRenderHash=digest(svg);await enqueueProject(project.uid,project.id,()=>{checkContext(getProject(project.uid,project.id),option);writeProposal(project.uid,project.id,option.id,option);});alternatives.push({id:option.id,layoutId,afterSvg:svg});}catch(error){if(error.statusCode!==422)throw error;}
    }
    if(alternatives.length){const layoutCandidates=[{id:proposal.id,layoutId:proposal.commands[0].payload.layoutId},...alternatives.map(({id,layoutId})=>({id,layoutId}))];await enqueueProject(project.uid,project.id,()=>{checkContext(getProject(project.uid,project.id),proposal);for(const item of layoutCandidates){const stored=readProposal(project.uid,project.id,item.id);writeProposal(project.uid,project.id,item.id,{...stored,layoutCandidates});}});}
    return { ...proposal, ...preview, alternatives };
  }
  if (data.scope === 'deck') throw editError('deck scope is available for theme and style changes; use a frozen generation scope for multi-page content changes', 409);
  const capabilities = editableCapabilities(project);
  if (data.mode === 'relayout' && !capabilities.relayout) throw editError('native templates do not support relayout', 409);
  const native = !capabilities.relayout;
  const editable = (slide.nodes || []).filter(node => !node.locked && ['text', 'list', 'timeline', 'chart', 'table', 'shape'].includes(node.type)
    && (!native || isSourceOwnedNode(node) || (node.type === 'text' && node.nativeRef)) && (data.scope !== 'object' || (multiple?data.nodeIds.includes(node.id):node.id === data.nodeId))
    && (route.type !== 'title' || ['title', 'template-title'].includes(node.semanticRole)));
  if(multiple&&editable.length!==data.nodeIds.length)throw editError('a selected member is missing, locked or not editable',409);
  if (!editable.length) throw editError('no editable semantic objects in the target', 409);
  if (editable.length > 30) throw editError('select an object to edit this complex page', 422);
  const contract = project.planning?.slidePlan?.find(item => item.slideId === slide.id);
  if(data.target&&data.scope!=='object')throw editError('a member selection requires object scope',400);
  const editTarget=data.target?resolveEditTarget(editable[0],data.target):null;
  const outline = project.outline?.find(item => item.id === slide.id) || slide;
  const writingProject = { ...project, ...(action.action === 'translate' ? { editOutputLanguage: action.parameters.targetLanguage } : {}) };
  // A card deck's edit sees the card policy and the page's cited units only (Fable 2026-10-25).
  const cards = cardsFlow(project);
  const sources = cards ? null : retrieveSlideSources(project, outline, contract || {});
  let context = cards ? cardEditSources(writingProject, outline) : editPromptContext(writingProject, outline, sources, contract || {});
  const writingPolicy = cards ? cardEditPolicy(writingProject, action.action) : promptPolicy(writingProject);
  const schema = data.scope === 'object'&&!multiple ? '{"content":{...}}' : '{"patches":[{"nodeId":"existing ID","content":{...}}]';
  const compact = content => { const {richText,cellRich,rawRows,rawText,displayTransformVersion,...rest} = content || {}; return rest; };
  const objects = JSON.stringify(editable.map(node => ({ nodeId: node.id, type: node.type, content: cards ? compact(node.content) : node.content, ...(cards ? {} : { nativeTextFrame: node.nativeTextFrame }), capacity: objectWritingCapacity(project, slide.id, node) })));
  let prompt = `${aiActionPrompt(action.action, action.parameters)}\n${writingPolicy}\n${cards ? '' : writingGuide(writingProject, contract || {}, native)}\nOnly edit the semantic content of these existing presentation objects. Preserve sources, numeric values, units, conditions, equations, required evidence and locked titles. Keep chart data/type/dimensions and table dimensions/headers/numeric cells unchanged. Keep shape types unchanged. Do not invent facts, repeat neighboring pages, change other pages, theme, styles, IDs or coordinates. Preserve material conditions and uncertainty; keep production/source bookkeeping out of visible copy. Keep each point useful and within its capacity; do not truncate mechanically. ${native ? 'Preserve native text paragraph count and label/body structure.' : ''}\nContext: ${context}\nObjects: ${objects}\nInstruction: ${instruction}\nReturn only JSON: ${schema}${data.scope === 'slide'||multiple ? (data.mode === 'relayout' ? `,"layoutId":"one of ${[...layouts].join(',')}"}` : '}') : ''}.`;
  // A card edit prompt stays under 20,000 characters: the cited units are cut first.
  if (cards && prompt.length > CARD_EDIT_PROMPT_CHARS) { const smaller = cardEditSources(writingProject, outline, Math.max(1000, 8000 - (prompt.length - CARD_EDIT_PROMPT_CHARS))); prompt = prompt.replace(context, smaller); context = smaller; if (typeof log === 'function') log(`ppt ${project.id} ai_edit_prompt_truncated ${slide.id} ${prompt.length} characters`); }
  const id = newId('proposal');
  // One model call, the proposal filled from it, and its review.
  const attempt = async feedback => {
    const answer = await deps.modelCall(project, (editTarget ? `${prompt}\nFrozen target: ${JSON.stringify({...editTarget,text:undefined})}. Only replace this exact selected text: ${JSON.stringify(editTarget.expectedText)}. All other object text is read-only. Return only {"replacement":"new selected text"}. Preserve the source markup outside this range.` : prompt) + feedback, activity, log, { nodeKey: feedback ? `ai:${id}:fit` : `ai:${id}` });
    const proposal = { id, liveEditContext, projectId: project.id, slideId: slide.id, scope: data.scope, type: route.type, impact: impactFor(project, route, [slide.id]), mode: data.mode || 'content', action: action.action, parameters: action.parameters, generationPolicy: project.generationPolicy, promptContractVersion: project.promptContractVersion || 2, instruction,
      baseRevision: project.revision, sourceRevision: project.sourceRevision || 0, planKey: planKey(project), targetContentHash: slideFingerprint(project, slide.id),
      modelRef: { configId: project.configId, model: project.model }, status: 'proposed', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString(),
      ...(data.reviewAdvisoryId ? { reviewAdvisoryId: data.reviewAdvisoryId } : {}) };
    if (data.scope === 'object'&&!multiple) {
      proposal.nodeId = editable[0].id; proposal.before = editable[0].content;
      const patched=editTarget?patchEditTarget(editable[0],editTarget,answer?.replacement):null;
      proposal.content=semanticContent(editable[0],patched||answer?.content||answer);if(patched)proposal.content=patched;
      if(editTarget){proposal.target={...editTarget,text:undefined};proposal.replacement=answer.replacement;}
    } else {
      const raw = answer?.patches ? answer : answer?.content;
      if (!Array.isArray(raw?.patches) || !raw.patches.length) throw editError('AI returned no patches', 422);
      const byId = new Map(editable.map(node => [node.id, node])); const seen = new Set();
      proposal.patches = raw.patches.map(item => {
        const node = byId.get(item?.nodeId);
        if (!node || seen.has(node.id)) throw editError('AI returned an unknown or duplicate target', 422);
        seen.add(node.id);
        return { nodeId: node.id, before: node.content, content: semanticContent(node, item.content) };
      });
      if (raw.layoutId) {
        if (data.mode !== 'relayout' || !layouts.has(raw.layoutId)) throw editError('AI returned an unsupported layout', 422);
        proposal.layoutId = raw.layoutId;
      }
    }
    if(multiple){proposal.targetNodeIds=[...data.nodeIds];if(proposal.patches.some(p=>!data.nodeIds.includes(p.nodeId)))throw editError('patch escaped the component selection',422);}
    const result = await reviewTextCandidate(project,proposal,deps,activity,log,writingProject.editOutputLanguage);
    return { proposal, result };
  };
  // A card candidate that only overflows its box is retried once with the
  // measured limit (Fable D2'; an edit takes ~4 s). Any other gate error, or a
  // second overflow, is the 422 with the measured issue.
  let drafted;
  try { drafted = await attempt(''); }
  catch (error) {
    const issues = error?.details?.issues || [];
    if (!cards || error?.statusCode !== 422 || !issues.length || !issues.every(issue => FIT_CODES.has(issue.code))) throw error;
    drafted = await attempt(`\n${overflowFeedback(issues, project, slide.id, editable)}`);
  }
  const { proposal, result } = drafted;
  proposal.metrics = proposalMetrics(data.scope === 'object'&&!multiple ? [proposal.before] : proposal.patches.map(item => item.before), data.scope === 'object'&&!multiple ? [proposal.content] : proposal.patches.map(item => item.content), action.action, action.parameters);
  recordSnapshots(project,proposal,result.project);
  const preview = { beforeSvg: slideSvg(buildSlideRenderTree(project, slide.id)), afterSvg: slideSvg(buildSlideRenderTree(result.project, slide.id)) };
  proposal.changedNodeIds = data.scope === 'object'&&!multiple ? [proposal.nodeId] : proposal.patches.map(item => item.nodeId);
  proposal.beforeRenderHash = digest(preview.beforeSvg); proposal.afterRenderHash = digest(preview.afterSvg);
  await enqueueProject(project.uid, project.id, () => {
    checkContext(getProject(project.uid, project.id), proposal);
    writeProposal(project.uid, project.id, id, proposal);
  });
  return { ...proposal, ...preview };
}

export async function applyProposal(uid, projectId, id) {
  const proposal = readProposal(uid, projectId, id);
  const existing = findOperation(uid, projectId, id);
  if (existing) return { project: getProject(uid, projectId), operation: existing, idempotent: true };
  if (proposal.status !== 'proposed' || Date.parse(proposal.expiresAt) <= Date.now()) throw editError('proposal is discarded or expired', 409);
  const project = getProject(uid, projectId);
  checkContext(project, proposal);
  assertStoredCandidateScope(project, candidate(project, proposal).project, proposal);
  const result = await applyCommand(uid, projectId, candidate(project, proposal).command, { allowInternal: Boolean(proposal.commands||proposal.summaryProjections||proposal.cardPointCoverage), allowExternalStructure: Boolean(proposal.commands||proposal.cardPointCoverage), ...(proposal.reviewAdvisoryId?{reviewAdvisoryId:proposal.reviewAdvisoryId}:{}), guard: latest => {
    const stored = readProposal(uid, projectId, id);
    if (stored.status !== 'proposed' || Date.parse(stored.expiresAt) <= Date.now()) throw editError('proposal is no longer available', 409);
    checkContext(latest, stored);
    assertStoredCandidateScope(latest, candidate(latest, stored).project, stored);
    validateCandidate(latest, candidate(latest, stored).project, stored.slideId, stored.type);
  } });
  writeProposal(uid, projectId, id, { ...proposal, ...(proposal.snapshots?{snapshots:{...proposal.snapshots,after:structuredClone(result.project.deck.slides.find(s=>s.id===proposal.slideId))}}:{}),status: 'applied', operationId: result.operation.id });
  return result;
}

export async function discardProposal(uid, projectId, id) {
  return enqueueProject(uid, projectId, () => {
    const proposal = readProposal(uid, projectId, id);
    if (findOperation(uid, projectId, id)) throw editError('proposal has already been applied', 409);
    return writeProposal(uid, projectId, id, { ...proposal, status: 'discarded' });
  });
}

export function proposalPreview(project, id) {
  const proposal = readProposal(project.uid, project.id, id); checkContext(project, proposal);
  const next = candidate(project, proposal).project;
  const affected = next.deck.slides.filter(slide => slide.id === (proposal.structureChange?.targetId||proposal.slideId) || !project.deck.slides.some(old => old.id === slide.id));
  return { ...proposal, beforeSvg: slideSvg(buildSlideRenderTree(project, proposal.slideId)),
    alternatives:(proposal.layoutCandidates||[]).filter(item=>item.id!==id).map(item=>{const option=readProposal(project.uid,project.id,item.id);checkContext(project,option);return {...item,afterSvg:slideSvg(buildSlideRenderTree(candidate(project,option).project,proposal.slideId))};}),
    afterSvg: affected[0] ? slideSvg(buildSlideRenderTree(next, affected[0].id)) : '',
    afterSlides: affected.map(slide => ({ slideId: slide.id, svg: slideSvg(buildSlideRenderTree(next, slide.id)) })) };
}

/** Manual candidate edits always get a new identity and fresh source/quality proof. */
export async function reviseProposal(project,id,data,deps,activity,log) {
  const old=readProposal(project.uid,project.id,id);checkContext(project,old);
  if(old.status!=='proposed'||old.commands)throw editError('only a pending text candidate can be edited',409);
  const next={...structuredClone(old),id:newId('proposal'),parentProposalId:id,createdAt:new Date().toISOString()};
  const slide=project.deck.slides.find(s=>s.id===old.slideId);
  if(old.scope==='object'&&!old.patches) {
    const node=slide.nodes.find(n=>n.id===old.nodeId);
    const patched=old.target?patchEditTarget(node,old.target,data.replacement):null;next.content=semanticContent(node,patched||data.content);if(patched){next.content=patched;next.replacement=data.replacement;}
  }else {
    if(!Array.isArray(data.patches)||data.patches.length!==old.patches.length)throw editError('preserve candidate target IDs',422);
    const byId=new Map(data.patches.map(p=>[p.nodeId,p]));if(byId.size!==old.patches.length)throw editError('duplicate candidate target',422);
    next.patches=old.patches.map(p=>{const input=byId.get(p.nodeId);if(!input)throw editError('candidate target changed',422);return {...p,content:semanticContent(slide.nodes.find(n=>n.id===p.nodeId),input.content)};});
  }
  const after=(await reviewTextCandidate(project,next,deps,activity,log)).project;recordSnapshots(project,next,after);
  await enqueueProject(project.uid,project.id,()=>{checkContext(getProject(project.uid,project.id),old);writeProposal(project.uid,project.id,next.id,next);writeProposal(project.uid,project.id,id,{...old,status:'superseded'});});
  return proposalPreview(project,next.id);
}

export function proposalHistory(project) {
  const dir=path.join(projectDataDir(project.uid,project.id),'proposals');
  return (fs.existsSync(dir)?fs.readdirSync(dir):[]).filter(name=>/^proposal_[a-f0-9]+\.json$/u.test(name)).map(name=>readJson(path.join(dir,name),null,project.uid)).filter(p=>p?.snapshots&&p.status==='applied').map(p=>({id:p.id,slideId:p.slideId,instruction:p.instruction,createdAt:p.createdAt,candidateHash:p.candidateHash}));
}
export function proposalVersion(project,id,side) {
  const proposal=readProposal(project.uid,project.id,id);
  if(!['before','after'].includes(side)||!proposal.snapshots?.[side])throw editError('version snapshot unavailable',404);
  const next=structuredClone(project),index=next.deck.slides.findIndex(s=>s.id===proposal.slideId);if(index<0)throw editError('target page no longer exists',409);
  next.deck.slides[index]=structuredClone(proposal.snapshots[side]);
  return {id,side,readOnly:true,hash:digest(proposal.snapshots[side]),svg:slideSvg(buildSlideRenderTree(next,proposal.slideId))};
}
/** Derived ordering/graph caches can be regenerated by publication. Restoring
 * a page compares every actual changed object and all editable metadata;
 * source content, geometry, styles and explicit locks remain strict guards. */
export function restoreEditablePageSnapshot(current,before,after,target){
 const slide=structuredClone(current);
  const changed=new Set([...before.nodes,...after.nodes].filter(n=>digest(before.nodes.find(x=>x.id===n.id))!==digest(after.nodes.find(x=>x.id===n.id))).map(n=>n.id));
  for(const id of changed) {
    const current=slide.nodes.find(n=>n.id===id),a=before.nodes.find(n=>n.id===id),b=after.nodes.find(n=>n.id===id);
    if(digest(current)!==digest(a)&&digest(current)!==digest(b))throw editError('a later manual edit changed this target; restore would overwrite it',409);
    slide.nodes=slide.nodes.filter(n=>n.id!==id);const wanted=target.nodes.find(n=>n.id===id);if(wanted)slide.nodes.splice(Math.min(target.nodes.findIndex(n=>n.id===id),slide.nodes.length),0,structuredClone(wanted));
  }
  for(const key of new Set([...Object.keys(before),...Object.keys(after)]))if(!['nodes','nodeOrder','componentGraph'].includes(key)&&digest(before[key])!==digest(after[key])) {
    if(digest(slide[key])!==digest(before[key])&&digest(slide[key])!==digest(after[key]))throw editError('page metadata changed after this operation',409);
    if(target[key]===undefined)delete slide[key];else slide[key]=structuredClone(target[key]);
  }
  slide.nodeOrder=slide.nodes.map(node=>node.id);delete slide.componentGraph;return slide;
}
export async function restoreProposalVersion(project,id,data) {
  const proposal=readProposal(project.uid,project.id,id),side=data.side;
  if(project.runtime?.slides?.[proposal.slideId]?.accepted&&(['title','content','data'].includes(proposal.type)||proposal.mode==='native-content'))throw editError('unlock the accepted page before restoring its content',409);
  if(data.baseRevision!==project.revision)throw editError('refresh before restoring a version',409);
  if(proposal.status!=='applied'||!['before','after'].includes(side)||!proposal.snapshots||proposal.type==='structure'||proposal.scope==='deck')throw editError('this operation requires whole-deck revision history',409);
  const {before,after}=proposal.snapshots,target=proposal.snapshots[side],deck=structuredClone(project.deck),slide=deck.slides.find(s=>s.id===proposal.slideId);
  if(!slide||planKey(project)!==proposal.planKey)throw editError('page plan changed since this operation',409);
  deck.slides[deck.slides.findIndex(s=>s.id===slide.id)]=restoreEditablePageSnapshot(slide,before,after,target);
  validateCandidate(project,{...project,deck},proposal.slideId,proposal.type);
  return applyCommand(project.uid,project.id,{type:'deck.replace',baseRevision:project.revision,payload:{deck}},{allowInternal:true,allowExternalStructure:true,guard:latest=>{if(latest.revision!==project.revision)throw editError('project changed while restoring',409);}});
}
