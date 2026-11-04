import { enqueueProject, getProject, saveProject } from './repository.mjs';
import { newId } from './ir.mjs';
import { slideFingerprint, planKey, editError } from './edit-context.mjs';
import { createProposal } from './proposal-service.mjs';

/** Image generation is a separate task. Retrying it never regenerates slide content. */
export function startAssetTask(uid, projectId, data) {
  return enqueueProject(uid, projectId, () => {
    const project = getProject(uid, projectId);
    if (!project || project.deletedAt || !['completed', 'quality_blocked'].includes(project.status)) throw editError('wait for the completed editor', 409);
    const node = project.deck?.slides.find(slide => slide.id === data.slideId)?.nodes.find(node => node.id === data.nodeId);
    if (!node || node.type !== 'image' || node.locked || project.externalPptx || project.templateFidelity) throw editError('select an editable image', 409);
    const instruction = String(data.instruction || '').trim(); if (!instruction || instruction.length > 1000) throw editError('invalid image instruction', 400);
    if (data.baseRevision !== project.revision) throw editError('refresh before generating an image', 409);
    const task = { id: newId('asset'), slideId: data.slideId, nodeId: node.id, instruction, status: 'running', attempts: 1,
      baseRevision: project.revision, targetHash: slideFingerprint(project, data.slideId), planKey: planKey(project), createdAt: new Date().toISOString() };
    project.assetTasks ||= {}; if (Object.keys(project.assetTasks).length >= 200) throw editError('too many asset tasks', 429); project.assetTasks[task.id] = task; saveProject(project); return task;
  });
}
export async function finishAssetTask(uid, projectId, taskId, data, deps, activity, log) {
  let snapshot;
  await enqueueProject(uid, projectId, () => {
    const project = getProject(uid, projectId); const task = project?.assetTasks?.[taskId];
    if (!task) throw editError('asset task not found', 404);
    if ((data.attempt || 1) !== task.attempts) throw editError('asset attempt was superseded', 409);
    if (task.status === 'proposed') { snapshot = { task, project }; return; }
    if (task.status !== 'running') throw editError('asset task is not running', 409);
    if (data.error) { task.status = 'failed'; task.error = String(data.error).slice(0, 500); saveProject(project); return; }
    if (task.targetHash !== slideFingerprint(project, task.slideId) || task.planKey !== planKey(project)) { task.status = 'conflicted'; saveProject(project); throw editError('the image target changed while generating; regenerate its preview', 409); }
    snapshot = { project, task: structuredClone(task) };
  });
  if (!snapshot) return { task: getProject(uid, projectId).assetTasks[taskId] };
  const { project, task } = snapshot;
  if ((data.attempt || 1) !== task.attempts) throw editError('asset attempt was superseded', 409);
  if (task.status === 'proposed') { const { proposalPreview } = await import('./proposal-service.mjs'); return { task, proposal: proposalPreview(project, task.proposalId) }; }
  const proposal = await createProposal(project, { type: 'asset', scope: 'object', slideId: task.slideId, nodeId: task.nodeId, instruction: task.instruction, content: data.content, baseRevision: project.revision }, deps, activity, log);
  await enqueueProject(uid, projectId, () => { const latest = getProject(uid, projectId); if (latest?.deletedAt || latest?.assetTasks?.[taskId]?.attempts !== task.attempts || latest.assetTasks[taskId].status !== 'running') throw editError('asset attempt changed before its proposal was saved', 409); Object.assign(latest.assetTasks[taskId], { status: 'proposed', proposalId: proposal.id }); saveProject(latest); });
  return { task: getProject(uid, projectId).assetTasks[taskId], proposal };
}

export function retryAssetTask(uid, projectId, taskId) {
  return enqueueProject(uid, projectId, () => {
    const project = getProject(uid, projectId); const task = project?.assetTasks?.[taskId];
    if (!task) throw editError('asset task not found', 404);
    if (project.deletedAt || !['completed','quality_blocked'].includes(project.status) || task.status !== 'failed') throw editError('only a failed asset task can be retried', 409);
    if (task.targetHash !== slideFingerprint(project, task.slideId) || task.planKey !== planKey(project)) throw editError('target changed; start a new asset preview', 409);
    const node = project.deck.slides.find(slide => slide.id === task.slideId)?.nodes.find(node => node.id === task.nodeId);
    if (!node || node.locked) throw editError('image is no longer editable', 409);
    task.status = 'running'; task.attempts++; task.startedAt = new Date().toISOString(); delete task.error; saveProject(project); return task;
  });
}
