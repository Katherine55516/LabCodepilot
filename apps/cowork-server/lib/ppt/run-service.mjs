import { createRun, appendEvent, getRun, saveRun } from './event-store.mjs';
import { planGenerationDag } from './dag-planner.mjs';
import { getProject, saveProject } from './repository.mjs';

export function startRun(project, kind = 'generation') {
  let run = createRun(project.uid, project.id, { kind, nodes: planGenerationDag(project), status: 'running', stage: 'source', startedAt: new Date().toISOString() });
  ({ run } = appendEvent(run, 'run.started', { kind, stage: run.stage }));
  project.currentRunId = run.id;
  project.runId = run.id;
  project.dagNodes = run.nodes;
  saveProject(project);
  return run;
}

export function currentRun(project) {
  return project?.currentRunId ? getRun(project.uid, project.id, project.currentRunId) : null;
}

export function transitionNode(projectInput, nodeId, status, detail = {}, { useInput = false } = {}) {
  const project = useInput ? projectInput : getProject(projectInput.uid, projectInput.id) || projectInput;
  let run = currentRun(project) || startRun(project);
  const [kind, target] = nodeId.split(':');
  const dependency = target ? ({ source: ['outline'], content: [`source:${target}`], media: ['outline'], layout: [`content:${target}`], preview: [`layout:${target}`], quality: [`preview:${target}`] }[kind] || []) : [];
  const node = run.nodes[nodeId] || { id: nodeId, dependsOn: dependency, attempts: 0 };
  const now = new Date().toISOString();
  run.nodes[nodeId] = {
    ...node,
    status,
    attempts: Number(node.attempts || 0) + (status === 'running' ? 1 : 0),
    startedAt: status === 'running' ? now : node.startedAt,
    completedAt: status === 'completed' ? now : node.completedAt,
    error: status === 'failed' ? String(detail.error || detail.message || 'failed') : null,
    updatedAt: now,
    ...detail,
  };
  run.stage = nodeId;
  if (status === 'running') { run.status = 'running'; run.error = null; }
  if (status === 'failed') { run.status = 'failed'; run.error = run.nodes[nodeId].error; }
  ({ run } = appendEvent(run, `node.${status}`, { nodeId, ...detail }));
  project.currentRunId = run.id;
  project.runId = run.id;
  project.dagNodes = run.nodes;
  project.stage = nodeId;
  saveProject(project);
  return { project, run };
}

export function emitRunProgress(projectInput, type, payload = {}) {
  const project = getProject(projectInput.uid, projectInput.id) || projectInput;
  let run = currentRun(project) || startRun(project);
  ({ run } = appendEvent(run, type, payload));
  return run;
}

export function completeRun(projectInput, detail = {}) {
  const project = getProject(projectInput.uid, projectInput.id) || projectInput;
  let run = currentRun(project);
  if (!run) return null;
  run.status = 'completed'; run.stage = 'published'; run.completedAt = new Date().toISOString(); run.error = null;
  ({ run } = appendEvent(run, 'run.completed', detail));
  project.dagNodes = run.nodes; project.currentRunId = run.id;
  saveProject(project);
  return run;
}

export function cancelRun(projectInput) {
  const project = getProject(projectInput.uid, projectInput.id) || projectInput;
  let run = currentRun(project);
  if (!run || ['completed', 'cancelled'].includes(run.status)) return run;
  run.status = 'cancelled'; run.cancelledAt = new Date().toISOString();
  ({ run } = appendEvent(run, 'run.cancelled'));
  for (const intent of Object.values(project.editing?.intents || {})) {
    for (const result of Object.values(intent.perSlideResults || {})) if (['queued', 'applying'].includes(result.status)) result.status = 'cancelled';
    intent.status = Object.values(intent.perSlideResults || {}).some(result => result.status === 'applied') ? 'partially_applied' : 'cancelled';
  }
  project.status = 'cancelled'; project.stage = 'cancelled'; saveProject(project);
  return run;
}

export function recoverRun(project) {
  const run = currentRun(project);
  if (!run || !['running', 'queued'].includes(run.status)) return run;
  for (const node of Object.values(run.nodes)) if (node.status === 'running') node.status = 'pending';
  run.status = 'queued';
  saveRun(run);
  // The API resumes from the project snapshot. Keep its DAG view in lockstep
  // with the durable run before deciding which page checks to skip.
  project.dagNodes = structuredClone(run.nodes);
  saveProject(project);
  return appendEvent(run, 'run.recovered', { stage: run.stage }).run;
}
