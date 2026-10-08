import { normalizeAiAction, aiActionPrompt, proposalMetrics, WRITING_ACTIONS } from './ai-actions.mjs';
import path from 'node:path';
import { atomicJson, readJson, projectDataDir, enqueueProject, getProject } from './repository.mjs';
import { applyCommand, _internals as commands } from './command-service.mjs';
import { normalizeCommand, validateNodeContent } from './command-schema.mjs';
import { findOperation } from './command-history.mjs';
import { newId } from './ir.mjs';
import { planKey, slideFingerprint, editableCapabilities, editError, digest } from './edit-context.mjs';
import { buildSlideRenderTree } from './render-tree.mjs';
import { slideSvg } from './exporters/preview.mjs';
import { reviewProject } from './quality-service.mjs';
import { isSourceOwnedNode } from '../ppt-source-artifacts.mjs';
import { missingRequiredEvidence, evidenceMeasurements } from '../ppt-evidence.mjs';
import { retrieveSlideSources } from '../ppt-planning.mjs';
import { promptPolicy, writingGuide, editPromptContext, objectWritingCapacity } from '../ppt-prompt-contracts.mjs';
import { routeMutation, impactFor } from './mutation-router.mjs';
import { typedCommands, materializeTypedCandidate } from './typed-proposal.mjs';

const layouts = new Set(['cover', 'summary', 'editorial', 'big-number', 'comparison', 'chart', 'table', 'image-text', 'timeline', 'conclusion']);
function file(uid, projectId, id) {
  if (!/^proposal_[a-f0-9]+$/u.test(String(id))) throw editError('invalid proposal id', 400);
  return path.join(projectDataDir(uid, projectId), 'proposals', `${id}.json`);
}
export function readProposal(uid, projectId, id) {
  const proposal = readJson(file(uid, projectId, id));
  if (!proposal) throw editError('proposal not found', 404);
  return proposal;
}
function checkContext(project, proposal) {
  if (!project || project.deletedAt || !['completed', 'quality_blocked', 'paused'].includes(project.status)) throw editError('project is not editable', 409);
  if (planKey(project) !== proposal.planKey || slideFingerprint(project, proposal.slideId) !== proposal.targetContentHash)
    throw editError('the target or its plan changed; preview again', 409);
  if ((proposal.type === 'structure' || proposal.scope === 'deck') && project.revision !== proposal.baseRevision) throw editError('the deck changed after structure planning; preview again', 409);
  if (project.runtime?.slides?.[proposal.slideId]?.accepted && ['content', 'title', 'data', 'structure'].includes(proposal.type || 'content')) throw editError('the page is accepted; unlock it before changing its content', 409);
}
function candidate(project, proposal) {
  if (proposal.commands) {
    const next = materializeTypedCandidate(project, proposal);
    const state = Object.fromEntries(['template', 'templateSpec', 'outline', 'pages', 'pageDecision', 'planning', 'constraints'].map(key => [key, next[key]]));
    const command = normalizeCommand({ id: proposal.id, type: 'deck.replace', baseRevision: project.revision, payload: { deck: next.deck, projectState: state } }, project);
    return { command, project: next };
  }
  const payload = proposal.scope === 'object'
    ? { slideId: proposal.slideId, nodeId: proposal.nodeId, patch: { content: proposal.content }, replace: true }
    : { slideId: proposal.slideId, patches: proposal.patches.map(({ nodeId, content }) => ({ nodeId, content })), ...(proposal.layoutId ? { layoutId: proposal.layoutId } : {}) };
  const command = normalizeCommand({ id: proposal.id, type: `ai.${proposal.scope}Patch`, baseRevision: proposal.baseRevision, payload }, project);
  return { command, project: { ...project, deck: commands.applyToDeck(project.deck, command, project).deck } };
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
    const rows = node.content.rows;
    if (content.rows.length !== rows.length || content.rows.some((row, index) => row.length !== rows[index].length || row.some((cell, column) =>
      (index === 0 || column === 0 || /[0-9%％]/u.test(String(rows[index][column]))) && cell !== rows[index][column])))
      throw editError('text optimization cannot change table dimensions, headers or numeric cells', 422);
  }
  if (node.type === 'shape' && content.shape !== (node.content.shape || 'rect')) throw editError('text optimization cannot change the shape type', 422);
  return content;
}

function validateCandidate(before, after, slideId, type = 'content') {
  const slide = after.deck.slides.find(item => item.id === slideId);
  const contract = before.planning?.slidePlan?.find(item => item.slideId === slideId);
  if ((contract?.titleLocked || (before.deck.slides[0]?.id === slideId && before.deckTitle?.locked)) && slide?.title !== before.deck.slides.find(item => item.id === slideId)?.title)
    throw editError('the cover title is locked', 422);
  const missing = type === 'structure' ? [] : missingRequiredEvidence(after, slide, contract);
  if (missing.length) throw editError('required visible evidence would be lost', 422, { evidenceIds: missing.map(item => item.id) });
  const key = issue => JSON.stringify([issue.code, issue.slideId, issue.nodeIds, issue.message]);
  const baseline = new Set(reviewProject(before).deterministic.issues.filter(issue => issue.severity === 'error').map(key));
  const quality = reviewProject(after).deterministic;
  const introduced = quality.issues.filter(issue => issue.severity === 'error' && !baseline.has(key(issue)));
  if (introduced.length) throw editError('candidate failed the quality gate', 422, { issues: introduced });
  const objectsBefore=reviewProject(before).deterministic.objectLedger?.objects||[];
  const objectsAfter=quality.objectLedger?.objects||[];
  return { issues: quality.issues.filter(issue => !issue.slideId || issue.slideId === slideId), hardErrors: quality.hardErrors, introducedHardErrors: 0,
    objectChanges:objectsAfter.filter(after=>objectsBefore.find(prior=>prior.objectId===after.objectId)?.status!==after.status).map(object=>({objectId:object.objectId,status:object.status})),
    preservedObjectIds:objectsAfter.filter(object=>object.status==='rendered').map(object=>object.objectId) };
}

/** The model produces semantic patches. IDs, layout capabilities and commit versions stay server-owned. */
export async function createProposal(input, data, deps, activity, log) {
  const project = structuredClone(input);
  if (!['completed', 'quality_blocked', 'paused'].includes(project.status)) throw editError('project is not editable', 409);
  if (!Number.isInteger(data.baseRevision) || data.baseRevision !== project.revision) throw editError('refresh the project before previewing', 409);
  const slide = project.deck?.slides.find(item => item.id === data.slideId);
  if (!slide) throw editError('slide not found', 404);
  const instruction = String(data.instruction || '').trim();
  if (!instruction || instruction.length > 1000) throw editError('instruction must contain 1–1000 characters', 400);
  if (!['slide', 'object', 'deck'].includes(data.scope)) throw editError('invalid scope', 400);
  const action = normalizeAiAction(data.action, data.parameters);
  if (WRITING_ACTIONS.includes(action.action) && data.type && !['auto', 'content', 'title'].includes(data.type)) throw editError('writing actions cannot change layout, assets or data', 400);
  const route = routeMutation(project, instruction, { type: WRITING_ACTIONS.includes(action.action) ? (data.type === 'title' ? 'title' : 'content') : data.type, mode: data.mode });
  if (project.runtime?.slides?.[slide.id]?.accepted && ['content', 'title', 'data', 'structure'].includes(route.type)) throw editError('this page is accepted; unlock it before changing its content', 409);
  if (['layout', 'style', 'asset', 'data', 'structure'].includes(route.type)) {
    const id = newId('proposal');
    const proposal = { id, projectId: project.id, slideId: slide.id, scope: data.scope, type: route.type, action: data.action, instruction,
      baseRevision: project.revision, planKey: planKey(project), targetContentHash: slideFingerprint(project, slide.id),
      impact: impactFor(project, route, [slide.id]), modelRef: { configId: project.configId, model: project.model },
      status: 'proposed', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString() };
    proposal.commands = await typedCommands(project, { ...data, type: route.type, proposalId: id }, deps, activity, log);
    const result = candidate(project, proposal);
    const affected = result.project.deck.slides.filter(item => item.id === slide.id || !project.deck.slides.some(old => old.id === item.id));
    if (route.type === 'structure') {
      const contract = project.planning?.slidePlan?.find(item => item.slideId === slide.id);
      const preserved = affected.length ? affected : result.project.deck.slides;
      const combined = { ...slide, nodes: preserved.flatMap(item => item.nodes), bullets: preserved.flatMap(item => item.bullets), copy: { blocks: preserved.flatMap(item => item.copy?.blocks || []) } };
      if (missingRequiredEvidence(result.project, combined, contract).length) throw editError('structure change would remove required evidence', 422);
    }
    proposal.quality = validateCandidate(project, result.project, slide.id, route.type);
    const preview = { beforeSvg: slideSvg(buildSlideRenderTree(project, slide.id)),
      afterSvg: affected[0] ? slideSvg(buildSlideRenderTree(result.project, affected[0].id)) : '',
      afterSlides: affected.map(item => ({ slideId: item.id, svg: slideSvg(buildSlideRenderTree(result.project, item.id)) })) };
    proposal.pageDelta = result.project.deck.slides.length - project.deck.slides.length;
    proposal.changedNodeIds = proposal.commands.flatMap(command => [command.payload.nodeId].filter(Boolean));
    proposal.beforeRenderHash = digest(preview.beforeSvg); proposal.afterRenderHash = digest(preview.afterSlides);
    await enqueueProject(project.uid, project.id, () => { checkContext(getProject(project.uid, project.id), proposal); atomicJson(file(project.uid, project.id, id), proposal); });
    return { ...proposal, ...preview };
  }
  if (data.scope === 'deck') throw editError('deck scope is available for theme and style changes; use a frozen generation scope for multi-page content changes', 409);
  const capabilities = editableCapabilities(project);
  if (data.mode === 'relayout' && !capabilities.relayout) throw editError('native templates do not support relayout', 409);
  const native = !capabilities.relayout;
  const editable = (slide.nodes || []).filter(node => !node.locked && ['text', 'list', 'timeline', 'chart', 'table', 'shape'].includes(node.type)
    && (!native || isSourceOwnedNode(node) || (node.type === 'text' && node.nativeRef)) && (data.scope !== 'object' || node.id === data.nodeId)
    && (route.type !== 'title' || ['title', 'template-title'].includes(node.semanticRole)));
  if (!editable.length) throw editError('no editable semantic objects in the target', 409);
  if (editable.length > 30) throw editError('select an object to edit this complex page', 422);
  const contract = project.planning?.slidePlan?.find(item => item.slideId === slide.id);
  const outline = project.outline?.find(item => item.id === slide.id) || slide;
  const sources = retrieveSlideSources(project, outline, contract || {});
  const writingProject = { ...project, ...(action.action === 'translate' ? { editOutputLanguage: action.parameters.targetLanguage } : {}), prompt: `${project.prompt || ''}\n${instruction}` };
  const context = editPromptContext(writingProject, outline, sources, contract || {});
  const writingPolicy = promptPolicy(writingProject);
  const schema = data.scope === 'object' ? '{"content":{...}}' : '{"patches":[{"nodeId":"existing ID","content":{...}}]';
  const prompt = `${aiActionPrompt(action.action, action.parameters)}\n${writingPolicy}\n${writingGuide(writingProject, contract || {}, native)}\nOnly edit the semantic content of these existing presentation objects. Preserve sources, numeric values, units, conditions, equations, required evidence and locked titles. Keep chart data/type/dimensions and table dimensions/headers/numeric cells unchanged. Keep shape types unchanged. Do not invent facts, repeat neighboring pages, change other pages, theme, styles, IDs or coordinates. Preserve material conditions and uncertainty; keep production/source bookkeeping out of visible copy. Keep each point useful and within its capacity; do not truncate mechanically. ${native ? 'Preserve native text paragraph count and label/body structure.' : ''}\nContext: ${context}\nObjects: ${JSON.stringify(editable.map(node => ({ nodeId: node.id, type: node.type, content: node.content, nativeTextFrame: node.nativeTextFrame, capacity: objectWritingCapacity(project, slide.id, node) })))}\nInstruction: ${instruction}\nReturn only JSON: ${schema}${data.scope === 'slide' ? (data.mode === 'relayout' ? `,"layoutId":"one of ${[...layouts].join(',')}"}` : '}') : ''}.`;
  const id = newId('proposal');
  const answer = await deps.modelCall(project, prompt, activity, log, { nodeKey: `ai:${id}` });
  const proposal = { id, projectId: project.id, slideId: slide.id, scope: data.scope, type: route.type, impact: impactFor(project, route, [slide.id]), mode: data.mode || 'content', action: action.action, parameters: action.parameters, generationPolicy: project.generationPolicy, promptContractVersion: project.promptContractVersion || 2, instruction,
    baseRevision: project.revision, sourceRevision: project.sourceRevision || 0, planKey: planKey(project), targetContentHash: slideFingerprint(project, slide.id),
    modelRef: { configId: project.configId, model: project.model }, status: 'proposed', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString() };
  if (data.scope === 'object') {
    proposal.nodeId = editable[0].id; proposal.before = editable[0].content;
    proposal.content = semanticContent(editable[0], answer?.content || answer);
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
  const result = candidate(project, proposal);
  proposal.metrics = proposalMetrics(data.scope === 'object' ? [proposal.before] : proposal.patches.map(item => item.before), data.scope === 'object' ? [proposal.content] : proposal.patches.map(item => item.content), action.action, action.parameters);
  proposal.quality = validateCandidate(project, result.project, slide.id);
  const preview = { beforeSvg: slideSvg(buildSlideRenderTree(project, slide.id)), afterSvg: slideSvg(buildSlideRenderTree(result.project, slide.id)) };
  proposal.changedNodeIds = data.scope === 'object' ? [proposal.nodeId] : proposal.patches.map(item => item.nodeId);
  proposal.beforeRenderHash = digest(preview.beforeSvg); proposal.afterRenderHash = digest(preview.afterSvg);
  await enqueueProject(project.uid, project.id, () => {
    checkContext(getProject(project.uid, project.id), proposal);
    atomicJson(file(project.uid, project.id, id), proposal);
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
  const result = await applyCommand(uid, projectId, candidate(project, proposal).command, { allowInternal: Boolean(proposal.commands), allowExternalStructure: Boolean(proposal.commands), guard: latest => {
    const stored = readProposal(uid, projectId, id);
    if (stored.status !== 'proposed' || Date.parse(stored.expiresAt) <= Date.now()) throw editError('proposal is no longer available', 409);
    checkContext(latest, stored);
    validateCandidate(latest, candidate(latest, stored).project, stored.slideId, stored.type);
  } });
  atomicJson(file(uid, projectId, id), { ...proposal, status: 'applied', operationId: result.operation.id });
  return result;
}

export async function discardProposal(uid, projectId, id) {
  return enqueueProject(uid, projectId, () => {
    const proposal = readProposal(uid, projectId, id);
    if (findOperation(uid, projectId, id)) throw editError('proposal has already been applied', 409);
    return atomicJson(file(uid, projectId, id), { ...proposal, status: 'discarded' });
  });
}

export function proposalPreview(project, id) {
  const proposal = readProposal(project.uid, project.id, id); checkContext(project, proposal);
  const next = candidate(project, proposal).project;
  const affected = next.deck.slides.filter(slide => slide.id === proposal.slideId || !project.deck.slides.some(old => old.id === slide.id));
  return { ...proposal, beforeSvg: slideSvg(buildSlideRenderTree(project, proposal.slideId)),
    afterSvg: affected[0] ? slideSvg(buildSlideRenderTree(next, affected[0].id)) : '',
    afterSlides: affected.map(slide => ({ slideId: slide.id, svg: slideSvg(buildSlideRenderTree(next, slide.id)) })) };
}
