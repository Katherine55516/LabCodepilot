import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { atomicJson, readJson, projectDataDir, getProject, saveProject, enqueueProject } from './repository.mjs';
import {renderIssues} from './render-audit.mjs';
import {inspectVisibleCopy} from '../ppt-copy-integrity.mjs';
import { buildSlideRenderTree } from './render-tree.mjs';
import { ensureDeckV3,ensureSlideV3 } from './ir.mjs';
import { bindTemplateFidelity } from '../ppt-template-fidelity.mjs';
import { synchronizePlan } from './versioning.mjs';
import { saveRun } from './event-store.mjs';
import { emitRunProgress, currentRun } from './run-service.mjs';
import { editError, digest } from './edit-context.mjs';
import {RENDER_CONTRACT_VERSION} from './render-contract.mjs';
import {applyLayoutRegistry} from '../ppt-layout.mjs';

export function runtimeState(project) {
  project.runtime ||= { schemaVersion: 1, lifecycle: 'active', slides: {}, attempts: {}, checkpoint: null };
  project.runtime.slides ||= {}; project.runtime.attempts ||= {};
  return project.runtime;
}

export function checkpoint(project, reason) {
  const state = runtimeState(project); synchronizePlan(project, reason);
  const snapshot = { schemaVersion: 1, runId: project.currentRunId, reason, at: new Date().toISOString(),
    artifactRevision: project.revision, planRevision: project.planRevision.version, constraintRevision: project.constraints.version,
    inputHash: project.planRevision.hash, mutationIds: Object.keys(project.editing?.intents || {}),
    contentEpochs: structuredClone(project.editing?.epochs || {}), nodes: structuredClone(project.nodes || {}),
    slideStates: structuredClone(state.slides), deck: project.deck, planning: project.planning, constraints: project.constraints,
    outline: project.outline, lastEventSeq: currentRun(project)?.lastSeq || 0 };
  atomicJson(path.join(projectDataDir(project.uid, project.id), 'checkpoint.json'), snapshot, project.uid);
  state.checkpoint = { reason, at: snapshot.at, inputHash: snapshot.inputHash, artifactRevision: snapshot.artifactRevision,
    planRevision: snapshot.planRevision, constraintRevision: snapshot.constraintRevision };
  return snapshot;
}

export function updateSlidePreview(project, slideId, phase = 'render_ready') {
  const node = project.nodes?.[slideId]; if (!node?.slide) return null;
  const planned=project.outline.map((outline,index)=>outline.id===slideId?node.slide:{id:outline.id,title:outline.title,bullets:[],nodes:[],layoutId:outline.role==='cover'?'cover':'summary'});
  const slides=applyLayoutRegistry({slides:planned}).slides.map((slide,index)=>slide.id===slideId?ensureSlideV3(slide,index):slide);
  const candidate={...project,deck:{...project.deck,slides}};
  if(project.templateFidelity?.mode==='preserve')bindTemplateFidelity(candidate,{slideIds:[slideId]});
  const tree = buildSlideRenderTree(candidate, slideId);
  const previewSlide=candidate.deck.slides.find(slide=>slide.id===slideId);
  const quality={issues:[...inspectVisibleCopy([previewSlide]),...renderIssues({slides:[tree]})]};
  const state = runtimeState(project); const previous = state.slides[slideId] || {};
  state.slides[slideId] = { ...previous, phase, epoch: project.editing?.epochs?.[slideId] || 0,
    renderContractVersion:RENDER_CONTRACT_VERSION,
    canonicalSlide:structuredClone(previewSlide),
    quality: { scope:'page_preview',issues: quality.issues.filter(issue => issue.slideId === slideId), pendingDeckReview: true },
    contentHash: digest(node.slide), renderHash: digest(tree), preview: tree, updatedAt: new Date().toISOString() };
  return tree;
}

export function pauseSession(uid, projectId) {
  return enqueueProject(uid, projectId, () => {
    const project = getProject(uid, projectId);
    // S10: only generation pauses; an outline is rewritten with an instruction instead.
    if (!project || project.deletedAt || !['generating', 'paused'].includes(project.status)) throw editError('only generation can be paused; rewrite the outline with an instruction instead', 409);
    const state = runtimeState(project); if (project.status === 'paused' || state.pauseRequested) return project; state.lifecycle = 'pausing'; state.pauseRequested = true; state.resumePhase = 'generating';
    saveProject(project); emitRunProgress(project, 'session.pausing'); return project;
  });
}

export function finishPause(project) {
  const state = runtimeState(project); state.lifecycle = 'paused'; project.status = 'paused';
  const run = currentRun(project); if (run) { run.status = 'paused'; saveRun(run); }
  checkpoint(project, 'pause'); saveProject(project); emitRunProgress(project, 'session.paused');
}

export function resumeSession(uid, projectId) {
  return enqueueProject(uid, projectId, () => {
    const project = getProject(uid, projectId);
    if (!project || project.deletedAt || project.status !== 'paused') throw editError('session is not paused', 409);
    const state = runtimeState(project); state.pauseRequested = false;
    // A project paused while its outline was written (before S10) writes the outline again.
    if (state.resumePhase === 'outlining') { state.lifecycle = 'active'; delete state.resumePhase; project.status = 'failed'; project.stage = 'outline'; project.error = 'Outline pausing was removed; write the outline again.'; saveProject(project); return project; }
    state.lifecycle = 'recovering';
    project.status = 'generating';delete project.taskDeletedAt;
    saveProject(project); // Acquire capacity before changing the durable run status.
    const run = currentRun(project); if (run) { run.status = 'queued'; saveRun(run); } emitRunProgress(project, 'session.resumed'); return project;
  });
}

/** Checkpoints recover only matching plan/epoch results. A newer manual revision always wins. */
export function reconcileCheckpoint(project) {
  synchronizePlan(project);
  const saved = readJson(path.join(projectDataDir(project.uid, project.id), 'checkpoint.json'), null, project.uid);
  if (!saved || saved.runId !== project.currentRunId || saved.inputHash !== project.planRevision.hash || saved.artifactRevision !== project.revision) return project;
  for (const item of project.outline || []) {
    const id = item.id;
    if ((saved.contentEpochs[id] || 0) !== (project.editing?.epochs?.[id] || 0)) continue;
    if (!project.nodes?.[id]?.slide && saved.nodes[id]?.status === 'done') {
      project.nodes ||= {}; project.nodes[id] = saved.nodes[id];
    }
    if (project.nodes?.[id]?.status === 'done' && saved.slideStates[id]?.contentHash === digest(project.nodes[id].slide))
      runtimeState(project).slides[id] ||= saved.slideStates[id];
  }
  return project;
}

export function setPageAccepted(uid, projectId, slideId, accepted, expectedRenderHash, expectedRevision) {
  return enqueueProject(uid, projectId, () => {
    const project = getProject(uid, projectId);
    if (!project || project.deletedAt || !['generating', 'paused', 'completed', 'quality_blocked'].includes(project.status)) throw editError('page is not editable', 409);
    let state = runtimeState(project).slides[slideId];
    if (!state?.preview && ['completed', 'quality_blocked'].includes(project.status)) {
      const tree = buildSlideRenderTree(project, slideId); if (tree) state = project.runtime.slides[slideId] = { phase: 'render_ready', preview: tree, renderHash: digest(tree) };
    }
    if (!state?.preview) throw editError('wait for the rendered page before accepting it', 409);
    if (expectedRenderHash ? expectedRenderHash !== state.renderHash : expectedRevision !== project.revision) throw editError('page changed; refresh before accepting it', 409);
    if (accepted && (project.nodes?.[slideId]?.status === 'running' || Object.values(project.editing?.intents || {}).some(intent => ['queued', 'applying'].includes(intent.perSlideResults?.[slideId]?.status)))) throw editError('wait for the current page edit to finish', 409);
    state.accepted = Boolean(accepted); state.acceptedAt = accepted ? new Date().toISOString() : null;
    checkpoint(project, accepted ? 'page-accepted' : 'page-unlocked'); saveProject(project);
    emitRunProgress(project, 'slide.protection', { slideId, accepted: state.accepted }); return project;
  });
}

/** Local worker ownership. Database leases are required before deploying multiple server writers. */
export function acquireGenerationLease(project) {
  const file = path.join(projectDataDir(project.uid, project.id), 'generation-lease.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const token = crypto.randomUUID();
  for (let attempt = 0; attempt < 2; attempt++) {
    try { fs.writeFileSync(file, JSON.stringify({ pid: process.pid, token, runId: project.currentRunId }), { flag: 'wx', mode: 0o600 });
      return { token, owns: () => readJson(file)?.token === token, release: () => { if (readJson(file)?.token === token) fs.rmSync(file, { force: true }); } };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const prior = readJson(file); let alive = true;
      try { process.kill(prior.pid, 0); } catch (reason) { alive = reason.code !== 'ESRCH'; }
      if (alive) return null;
      fs.rmSync(file, { force: true });
    }
  }
  return null;
}
