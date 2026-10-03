import { normalizeAiAction, aiActionPrompt, WRITING_ACTIONS } from './ai-actions.mjs';
import fs from 'node:fs';
import { getProject, saveProject, enqueueProject } from './repository.mjs';
import { typedCommands, materializeTypedCandidate } from './typed-proposal.mjs';
import { ensureDeckV3, materializeLegacySlide } from './ir.mjs';
import { evidenceMeasurements } from '../ppt-evidence.mjs';
import { newId } from './ir.mjs';
import { emitRunProgress } from './run-service.mjs';
import { planKey, slideFingerprint, editError, digest } from './edit-context.mjs';
import { createProposal, applyProposal } from './proposal-service.mjs';
import * as store from '../ppt-store.mjs';
import { findOperation, operationHistory } from './command-history.mjs';
import { commandsConflict } from './command-schema.mjs';
import { routeMutation, impactFor, addConstraint, effectiveConstraints } from './mutation-router.mjs';
import { checkpoint, runtimeState } from './runtime.mjs';
import { invalidateReviews } from './versioning.mjs';
import { promptPolicy } from '../ppt-prompt-contracts.mjs';

const workers = new Set();
export function editingState(project) {
  return project.editing ||= { schemaVersion: 1, epochs: {}, instructions: {}, scopes: {}, intents: {}, contentOpen: false };
}
export function generationEpoch(project, slideId) { return Number(project.editing?.epochs?.[slideId] || 0); }
function event(project, type, payload) { try { emitRunProgress(project, type, payload); } catch {} }
function targetHash(project, id) { return project.deck?.slides?.some(slide => slide.id === id) ? slideFingerprint(project, id) : digest(project.nodes?.[id]?.slide || project.outline?.find(slide => slide.id === id)); }
function summarize(intent) {
  const states = Object.values(intent.perSlideResults).map(result => result.status);
  intent.status = states.includes('proposed') ? 'proposed' : states.every(status => status === 'applied') ? 'applied'
    : states.some(status => status === 'queued' || status === 'applying') ? (states.includes('applying') ? 'applying' : 'queued')
      : states.includes('applied') ? 'partially_applied' : states.includes('conflicted') ? 'conflicted' : states.every(status => status === 'discarded') ? 'discarded' : states.every(status => status === 'superseded') ? 'superseded' : 'failed';
  intent.updatedAt = new Date().toISOString();
}

export function openGenerationScope(uid, projectId, slideId, previousScopeId, scopeName = 'current') {
  return enqueueProject(uid, projectId, () => {
    const project = getProject(uid, projectId);
    if (!project || project.deletedAt || !['generating', 'paused', 'completed', 'quality_blocked'].includes(project.status)) throw editError('presentation is not editable', 409);
    if (!project.outline.some(slide => slide.id === slideId)) throw editError('slide not found', 404);
    const editing = editingState(project);
    const previous = previousScopeId ? editing.scopes[previousScopeId] : null;
    if (previousScopeId && (!previous || previous.runId !== project.currentRunId || previous.planKey !== planKey(project) || previous.currentSlideId !== slideId)) throw editError('the run or plan changed; reselect the scope', 409);
    if (previous && [previous.currentSlideId, ...previous.remainingSlideIds, ...(previous.followingSlideIds || []), ...(previous.sectionSlideIds || []), ...(previous.deckSlideIds || [])].some(id => !project.outline.some(slide => slide.id === id))) throw editError('a frozen target was deleted; reselect the scope', 409);
    if (previous) {
      const candidates = { current: [previous.currentSlideId], remaining: previous.remainingSlideIds, following: previous.followingSlideIds || [], section: previous.sectionSlideIds || [], deck: previous.deckSlideIds || [] }[scopeName];
      if (!candidates) throw editError('invalid scope', 400);
      const targets = candidates.filter(id => !project.runtime?.slides?.[id]?.accepted);
      const ownOperations = new Set(Object.values(editing.intents).filter(intent => intent.actor === uid && intent.scopeSnapshot.id === previous.id)
        .flatMap(intent => Object.values(intent.perSlideResults).flatMap(result => [result.operationId, result.proposalId].filter(Boolean))));
      if (operationHistory(uid, projectId).some(operation => operation.revision > (previous.baseRevision || 0) && !ownOperations.has(operation.id)
        && targets.some(id => commandsConflict(operation.command, { type: 'ai.slidePatch', payload: { slideId: id, patches: [] } }))))
        throw editError('the target was manually edited; explicitly reselect the scope', 409);
    }
    const remaining = project.outline.filter(slide => !slide.manualBlank && !['running', 'done', 'completed'].includes(project.nodes?.[slide.id]?.status)).map(slide => slide.id);
    const selectedIndex = project.outline.findIndex(slide => slide.id === slideId);
    const selectedSection = project.outline[selectedIndex].section || project.outline[selectedIndex].sectionId;
    const following = project.outline.slice(selectedIndex + 1).filter(slide => !slide.manualBlank).map(slide => slide.id);
    const section = project.outline.filter(slide => !slide.manualBlank && selectedSection && (slide.section || slide.sectionId) === selectedSection).map(slide => slide.id);
    const scope = { id: newId('scope'), projectId, runId: project.currentRunId, baseRevision: project.revision, planKey: planKey(project), openedAt: new Date().toISOString(), currentSlideId: slideId,
      remainingSlideIds: previous?.remainingSlideIds || remaining, followingSlideIds: previous?.followingSlideIds || following, sectionSlideIds: previous?.sectionSlideIds || section, deckSlideIds: previous?.deckSlideIds || project.outline.filter(slide => !slide.manualBlank).map(slide => slide.id),
      targetContentHashes: Object.fromEntries(project.outline.map(slide => [slide.id, targetHash(project, slide.id)])) };
    for (const [id, item] of Object.entries(editing.scopes)) if (Date.now() - Date.parse(item.openedAt) > 86400000) delete editing.scopes[id];
    if (Object.keys(editing.scopes).length >= 100) throw editError('too many open scope snapshots', 429);
    editing.scopes[scope.id] = scope; saveProject(project); return scope;
  });
}

export function submitGenerationEdit(uid, projectId, data) {
  return enqueueProject(uid, projectId, () => {
    const project = getProject(uid, projectId);
    if (!project || project.deletedAt) throw editError('project not found', 404);
    const editing = editingState(project);
    const key = String(data.idempotencyKey || '');
    if (!/^[a-zA-Z0-9_-]{8,80}$/u.test(key)) throw editError('invalid idempotency key', 400);
    const instruction = String(data.instruction || '').trim();
    if (!instruction || instruction.length > 1000) throw editError('instruction must contain 1–1000 characters', 400);
    const action = normalizeAiAction(data.action, data.parameters);
    if (WRITING_ACTIONS.includes(action.action) && data.type && !['auto', 'title', 'content'].includes(data.type)) throw editError('writing actions cannot change layout, assets or data', 400);
    const requestHash = digest({ instruction, scope: data.scope, scopeId: data.scopeId, type: data.type || 'auto', action: action.action || null, parameters: action.parameters, count: data.count ?? null, conversationId: data.conversationId || null });
    const existing = Object.values(editing.intents).find(intent => intent.idempotencyKey === key);
    if (existing) {
      if (existing.requestHash ? existing.requestHash !== requestHash : existing.instruction !== instruction || existing.scope !== data.scope || existing.scopeSnapshot.id !== data.scopeId || (data.type && data.type !== 'auto' && data.type !== existing.type)) throw editError('idempotency key was used for a different request', 409);
      return { project, intent: existing, idempotent: true };
    }
    const snapshot = editing.scopes[data.scopeId];
    if (!snapshot || Date.now() - Date.parse(snapshot.openedAt) > 86400000) throw editError('scope snapshot expired; reopen the panel', 409);
    if (!['current', 'remaining', 'following', 'section', 'deck'].includes(data.scope)) throw editError('invalid scope', 400);
    if (!['generating', 'paused', 'completed', 'quality_blocked'].includes(project.status) || project.currentRunId !== snapshot.runId || planKey(project) !== snapshot.planKey)
      throw editError('the run or plan changed; reopen the panel', 409);
    const candidates = { current: [snapshot.currentSlideId], remaining: snapshot.remainingSlideIds, following: snapshot.followingSlideIds, section: snapshot.sectionSlideIds, deck: snapshot.deckSlideIds }[data.scope] || [];
    const targets = candidates.filter(id => !project.runtime?.slides?.[id]?.accepted);
    if (!targets.length) throw editError('the snapshot contains no pending AI pages', 409);
    if (targets.some(id => !project.outline.some(slide => slide.id === id))) throw editError('a target page was deleted', 409);
    if (Object.keys(editing.intents).length >= 200) throw editError('too many generation edit requests', 429);
    const route = routeMutation(project, instruction, { type: WRITING_ACTIONS.includes(action.action) ? (data.type === 'title' ? 'title' : 'content') : data.type });
    if (route.type === 'asset' || route.type === 'data') throw editError('select an image, chart or table in the completed editor for this object change', 409);
    if (route.type === 'structure' && data.scope !== 'current') throw editError('review one structure change at a time on the current page', 409);
    const inline = ['generating', 'paused'].includes(project.status) && editing.contentOpen && route.type !== 'structure';
    const intent = { id: newId('intent'), idempotencyKey: key, actor: uid, scope: data.scope, scopeSnapshot: snapshot, instruction, requestHash, action: action.action, parameters: action.parameters, conversationId: String(data.conversationId || '').slice(0, 100), count: data.count,
      type: route.type, impact: impactFor(project, route, targets), modelRef: { configId: project.configId, model: project.model }, status: 'queued', targetEpochs: {}, perSlideResults: {}, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    addConstraint(project, intent, targets);
    for (const id of targets) {
      if (!inline && project.status !== 'generating' && operationHistory(uid, projectId).some(operation => operation.revision > (snapshot.baseRevision || 0)
        && commandsConflict(operation.command, { type: 'ai.slidePatch', payload: { slideId: id, patches: [] } })))
        throw editError('the target was edited after opening this panel', 409);
      if (inline) {
        const instructions = editing.instructions[id] || [];
        if (instructions.join('\n').length + instruction.length > 8000) throw editError('too many accumulated instructions for this page', 422);
        editing.instructions[id] = effectiveConstraints(project, id).filter(item => ['title', 'content'].includes(item.type)).map(item => { const active = editing.intents[item.intentId] || (item.intentId === intent.id ? intent : null); return [aiActionPrompt(active?.action, active?.parameters), item.instruction].filter(Boolean).join('\n'); });
        const epoch = generationEpoch(project, id) + 1; editing.epochs[id] = epoch; intent.targetEpochs[id] = epoch;
        for (const earlier of Object.values(editing.intents)) {
          const result = earlier.perSlideResults[id];
          if (result && ['queued', 'applying'].includes(result.status) && result.phase === 'content') { result.status = 'superseded'; summarize(earlier); }
        }
        project.nodes[id] = { ...project.nodes[id], status: 'pending', epoch };
      }
      intent.perSlideResults[id] = { status: 'queued', phase: inline ? 'content' : 'draft', epoch: generationEpoch(project, id), expectedHash: inline ? undefined : (['generating','paused'].includes(project.status) ? null : targetHash(project, id)) };
    }
    editing.intents[intent.id] = intent; saveProject(project);
    invalidateReviews(project); checkpoint(project, `intent:${intent.id}`); saveProject(project);
    event(project, 'edit.accepted', { intentId: intent.id, slideIds: targets, targetEpochs: intent.targetEpochs });
    return { project, intent, idempotent: false };
  });
}

/** Called within the generation page commit queue. */
export function contentEditResult(project, slideId, epoch, status, error) {
  for (const intent of Object.values(project.editing?.intents || {})) {
    const result = intent.perSlideResults[slideId];
    if (!result || result.phase !== 'content' || result.epoch !== epoch || !['queued', 'applying'].includes(result.status)) continue;
    Object.assign(result, { status, milestone: status === 'applied' ? 'render_ready' : status, ...(error ? { error } : {}) }); summarize(intent);
    event(project, status === 'applied' ? 'edit.applied' : status === 'applying' ? 'edit.started' : 'edit.failed', { intentId: intent.id, slideId, epoch, error });
  }
}

export function recoverContentEdits(project) {
  for (const intent of Object.values(project.editing?.intents || {})) {
    for (const [slideId, result] of Object.entries(intent.perSlideResults)) if (result.phase === 'content' && result.epoch === generationEpoch(project, slideId)
      && ['queued', 'applying', 'failed'].includes(result.status)) {
      result.status = project.nodes?.[slideId]?.status === 'done' ? 'applied' : 'queued'; delete result.error;
    }
    summarize(intent);
  }
}

export function retryGenerationEdit(uid, projectId, intentId) {
  return enqueueProject(uid, projectId, () => {
    const project = getProject(uid, projectId); const intent = project?.editing?.intents?.[intentId];
    if (!intent) throw editError('intent not found', 404);
    if (!['completed', 'quality_blocked'].includes(project.status)) throw editError('finish or retry the generation run first', 409);
    for (const [id, result] of Object.entries(intent.perSlideResults)) if (['failed', 'conflicted'].includes(result.status)) {
      Object.assign(result, { status: 'queued', phase: 'draft', proposalId: undefined, error: undefined, expectedHash: targetHash(project, id) });
    }
    summarize(intent); saveProject(project); return { project, intent };
  });
}

/** Resume only submitted intents. Unsubmitted UI drafts never enter this worker. */
export async function processGenerationEdits(uid, projectId, deps, activity, log = () => {}) {
  const key = `${uid}:${projectId}`; if (workers.has(key)) return;
  workers.add(key);
  let drained = false;
  try {
    for (;;) {
      const work = await enqueueProject(uid, projectId, () => {
        const project = getProject(uid, projectId);
        if (!project || project.deletedAt || !['completed', 'quality_blocked'].includes(project.status)) return null;
        for (const intent of Object.values(project.editing?.intents || {})) for (const [slideId, result] of Object.entries(intent.perSlideResults)) {
          if (!['queued', 'applying'].includes(result.status) || result.phase !== 'draft') continue;
          if (result.expectedHash && result.expectedHash !== targetHash(project, slideId) && !(result.proposalId && findOperation(uid, projectId, result.proposalId))) {
            result.status = 'conflicted'; result.error = 'target changed before edit started'; summarize(intent); saveProject(project); event(project, 'edit.failed', { intentId: intent.id, slideId, error: result.error }); continue;
          }
          result.expectedHash ||= targetHash(project, slideId); result.status = 'applying'; summarize(intent); saveProject(project);
          event(project, 'edit.started', { intentId: intent.id, slideId });
          return { project, intent: structuredClone(intent), slideId, result: structuredClone(result) };
        }
        return null;
      });
      if (!work) { drained = true; break; }
      let status = 'applied', error, operationId;
      try {
        let proposalId = work.result.proposalId;
        if (!proposalId) {
          const proposal = await createProposal(work.project, { scope: 'slide', type: work.intent.type, action: work.intent.action, parameters: work.intent.parameters, count: work.intent.count, slideId: work.slideId, instruction: work.intent.instruction, baseRevision: work.project.revision }, deps, activity, log);
          proposalId = proposal.id;
          await enqueueProject(uid, projectId, () => {
            const latest = getProject(uid, projectId); const result = latest?.editing?.intents?.[work.intent.id]?.perSlideResults[work.slideId];
            if (!result || result.status !== 'applying') throw editError('intent is no longer active', 409);
            result.proposalId = proposalId; saveProject(latest);
          });
        }
        if (work.intent.type === 'structure') status = 'proposed';
        else operationId = (await applyProposal(uid, projectId, proposalId)).operation.id;
      } catch (reason) { status = reason.statusCode === 409 ? 'conflicted' : 'failed'; error = String(reason.message || reason).slice(0, 500); }
      await enqueueProject(uid, projectId, () => {
        const latest = getProject(uid, projectId); const intent = latest?.editing?.intents?.[work.intent.id];
        if (!intent || (intent.perSlideResults[work.slideId]?.status !== 'applying' && !operationId)) return;
        Object.assign(intent.perSlideResults[work.slideId], { status, error, operationId, revision: latest.revision }); summarize(intent); saveProject(latest);
        event(latest, status === 'applied' ? 'edit.applied' : 'edit.failed', { intentId: intent.id, slideId: work.slideId, revision: latest.revision, error });
      });
    }
  } finally {
    workers.delete(key);
    // A submission can arrive while the last empty queue read is resolving.
    // Recheck after releasing ownership so that wake-up cannot be lost.
    const latest = getProject(uid, projectId);
    if (drained && latest && !latest.deletedAt && ['completed', 'quality_blocked'].includes(latest.status) &&
      Object.values(latest.editing?.intents || {}).some(intent => Object.values(intent.perSlideResults || {}).some(result => result.phase === 'draft' && ['queued', 'applying'].includes(result.status))))
      queueMicrotask(() => void processGenerationEdits(uid, projectId, deps, activity, log).catch(error => log(String(error))));
  }
}

/** Existing generated copy is a baseline for minimal changes, never a new full-page draft. */
export async function transformGeneratedSlide(project, slideId, mutation, deps, activity, log) {
  runtimeState(project).attempts[`edit:${slideId}:${mutation.intentId}`] = { type: mutation.type, modelRef: { configId: project.configId, model: project.model }, inputHash: digest(project.nodes[slideId].slide), constraintRevision: project.constraints?.version, startedAt: new Date().toISOString() };
  const original = project.nodes[slideId].slide;
  const content = structuredClone(original);
  if (mutation.type === 'title') {
    if (project.deckTitle?.locked && project.outline[0]?.id === slideId) throw editError('the cover title is locked', 409);
    const contract = project.planning?.slidePlan?.find(item => item.slideId === slideId) || {};
    const answer = await deps.modelCall(project, `${promptPolicy({ ...project, prompt: `${project.prompt || ''}\n${mutation.instruction}` })}\nEdit only this slide title. Preserve its claim, numbers, units and terminology. Do not return or change the body. Original: ${content.title}\nBody claim (reference only): ${JSON.stringify(content.copy?.blocks || content.bullets)}\nTitle capacity: ${JSON.stringify(contract.copyBudget || {})}\nInstruction: ${mutation.instruction}\nReturn only JSON {"content":{"text":"revised title"}}`, activity, log, { nodeKey: `content:${slideId}:title` });
    const title = answer?.content?.text || answer?.title;
    if (typeof title !== 'string' || !title.trim() || title.length > 160) throw editError('invalid revised title', 422);
    const originalNumbers = content.title.match(/[-+]?\d+(?:[.,]\d+)*(?:%|％)?/gu) || [];
    const shownMeasurements = new Set(evidenceMeasurements(title).map(item => `${item.value}:${item.unit}`));
    if (evidenceMeasurements(content.title).some(item => !shownMeasurements.has(`${item.value}:${item.unit}`))) throw editError('title edits must preserve numeric values and units', 422);
    if (originalNumbers.some(value => !title.includes(value))) throw editError('title edits must preserve numeric values and units', 422);
    content.title = title.trim();
    if (content.copy) content.copy = { ...content.copy, headline: content.title };
    for (const slot of project.templateFidelity?.slides?.[project.outline.findIndex(item => item.id === slideId)]?.slots || [])
      if (slot.role === 'title' && content.templateSlotTexts) content.templateSlotTexts[String(slot.shapeId)] = content.title;
  } else if (['layout', 'style'].includes(mutation.type)) {
    const baseline = { ...project, deck: ensureDeckV3({ slides: [content] }) };
    const proposal = { id: newId('proposal'), slideId, type: mutation.type, instruction: mutation.instruction };
    proposal.commands = await typedCommands(baseline, { scope: 'slide', slideId, type: mutation.type, instruction: mutation.instruction, proposalId: proposal.id }, deps, activity, log);
    return materializeLegacySlide(materializeTypedCandidate(baseline, proposal).deck.slides[0]);
  }
  if (mutation.type === 'title' && content.nodes) for (const node of content.nodes.filter(item => ['title', 'template-title'].includes(item.semanticRole))) node.content = { ...node.content, text: content.title };
  return content;
}

export function recoverGenerationEdits(deps, activity, log) {
  let owners = []; try { owners = fs.readdirSync(store._internals.ROOT); } catch {}
  for (const uid of owners) { let projects = []; try { projects = store.list(uid); } catch {}
    for (const project of projects) if (!project.deletedAt && Object.values(project.editing?.intents || {}).some(intent => ['queued', 'applying'].includes(intent.status)))
      void processGenerationEdits(project.uid, project.id, deps, activity, log).catch(error => log(String(error)));
  }
}

export async function recordIntentProposal(uid, projectId, proposalId, status, operationId) {
  return enqueueProject(uid, projectId, () => {
    const project = getProject(uid, projectId); if (!project) return;
    for (const intent of Object.values(project.editing?.intents || {})) {
      for (const result of Object.values(intent.perSlideResults)) if (result.proposalId === proposalId) Object.assign(result, { status, operationId, revision: project.revision });
      summarize(intent);
    }
    for (const task of Object.values(project.assetTasks || {})) if (task.proposalId === proposalId) Object.assign(task, { status, operationId });
    saveProject(project); return project;
  });
}
