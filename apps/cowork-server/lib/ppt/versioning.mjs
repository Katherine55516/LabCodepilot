import { digest } from './edit-context.mjs';

export function planPayload(project) {
  return { sourceRevision: project.sourceRevision || 0, sourceHash: project.source?.sha256 || digest(project.source?.text || project.prompt),
    brief: project.planning?.brief, storyArc: project.planning?.storyArc, contracts: project.planning?.slidePlan,
    coverage: project.planning?.coverage, outline: project.outline, pageDecision: project.pageDecision,
    template: project.templateSpec, modelRef: { configId: project.configId, model: project.model } };
}

export function synchronizePlan(project, reason = 'planning') {
  const payload = planPayload(project); const hash = digest(payload);
  if (project.planRevision?.hash !== hash) {
    project.planHistory ||= [];
    const snapshot = { version: (project.planRevision?.version || 0) + 1, hash, reason, createdAt: new Date().toISOString(), ...structuredClone(payload) };
    project.planHistory.push(snapshot); project.planRevision = snapshot;
    project.planHistory = project.planHistory.slice(-32);
  }
  project.constraints ||= { version: 0, entries: [] };
  project.modelPolicy = { mode: 'user_selected', model: project.model, configId: project.configId };
  return project.planRevision;
}

export function semanticReviewKey(project) {
  return digest({ source: project.source?.sha256 || project.source?.text || project.prompt,
    planning: project.planning, outline: project.outline, constraints: project.constraints?.entries?.filter(entry => entry.active && ['content','title','data','structure'].includes(entry.type)),
    slides: project.deck?.slides?.map(slide => ({ id: slide.id, role: slide.role,
      nodes: slide.nodes?.map(node => ({ id: node.id, type: node.type, content: node.content, semanticRole: node.semanticRole })) })) });
}

export function invalidateReviews(project, beforeKey) {
  const inputHash = semanticReviewKey(project);
  if (beforeKey && beforeKey === inputHash) return;
  if (project.quality?.modelReview) project.quality.previousModelReview = project.quality.modelReview;
  project.quality = { ...(project.quality || {}), modelReview: null, reviewState: 'stale', reviewInputHash: null };
  if (project.dagNodes?.['review:deck']) { project.dagNodes['review:deck'].status = 'pending'; delete project.dagNodes['review:deck'].result; }
  project.reviewDependencyHash = inputHash;
}

export function bindReview(project, review, meta = {}) {
  project.quality = { ...(project.quality || {}), modelReview: review, reviewState: 'valid',
    reviewInputHash: semanticReviewKey(project), reviewerModel: { configId: project.configId, model: project.model }, rubricVersion: 1, ...meta };
  return project.quality;
}

export function reviewIsCurrent(project) {
  return Boolean(project.quality?.modelReview && project.quality.reviewState === 'valid' && project.quality.reviewInputHash === semanticReviewKey(project));
}
