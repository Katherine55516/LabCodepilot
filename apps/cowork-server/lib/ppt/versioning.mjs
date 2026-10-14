import {normalizeClaimAudit} from '../ppt-claim-semantics.mjs';
import { obligationRegistry, normalizeObligationAudit } from '../ppt-obligations.mjs';
import { inputFramework, normalizeScopeAudit, scopeAuditIsCurrent } from '../ppt-input-scope.mjs';
import { digest } from './edit-context.mjs';
import { PPT_PROMPT_CONTRACT_VERSION } from '../ppt-generation-policy.mjs';
export const REVIEW_RUBRIC_VERSION = 12;

export function planPayload(project) {
  return { inputFrameworkHash: inputFramework(project).frameworkHash, generationPolicy: project.generationPolicy, sourceRevision: project.sourceRevision || 0, sourceHash: project.source?.sha256 || digest(project.source?.text || project.prompt),
    promptContractVersion: project.promptContractVersion, activePromptContractVersion: PPT_PROMPT_CONTRACT_VERSION, densityProfile: project.planning?.densityProfile, densityPacking: project.planning?.densityPacking,
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
  return digest({ reviewRubricVersion:REVIEW_RUBRIC_VERSION, obligationRegistryHash:obligationRegistry(project).registryHash, inputFrameworkHash: inputFramework(project).frameworkHash, generationPolicy: project.generationPolicy, activePromptContractVersion:PPT_PROMPT_CONTRACT_VERSION, source: project.source?.sha256 || project.source?.text || project.prompt, sourceMedia:project.source?.images?.map(image=>({id:image.id,contentHash:image.imageSha256||digest(image.dataUrl),caption:image.caption,required:image.required})), sourceObjectExclusions:project.sourceObjectExclusions,
    template:project.templateSpec, templateFidelityHash:project.templateFidelity?.sha256,
    planning: project.planning, outline: project.outline, constraints: project.constraints?.entries?.filter(entry => entry.active && ['content','title','data','structure'].includes(entry.type)),
    slides: project.deck?.slides?.map(slide => ({ id: slide.id, role: slide.role, templateOmissions: slide.templateOmissions,
      nodes: slide.nodes?.map(node => ({ id: node.id, type: node.type, content: node.content, semanticRole: node.semanticRole,
        sourceArtifact:node.sourceArtifact,claimId:node.claimId,repeatPurpose:node.repeatPurpose,geometry:node.geometry,style:node.style,
        hidden: Boolean(node.hidden), opacity: Number(node.style?.opacity ?? 1), nativeRef: node.nativeRef })) })) });
}

export function invalidateReviews(project, beforeKey) {
  const inputHash = semanticReviewKey(project);
  if (beforeKey && beforeKey === inputHash) return;
  if (project.quality?.modelReview) project.quality.previousModelReview = project.quality.modelReview;
  project.quality = { ...(project.quality || {}), modelReview: null, reviewState: 'stale', reviewInputHash: null, publishEligible:false, exportable:false, visualVerified:false, exportVerification:null };
  if (project.dagNodes?.['review:deck']) { project.dagNodes['review:deck'].status = 'pending'; delete project.dagNodes['review:deck'].result; }
  project.reviewDependencyHash = inputHash;
}

export function bindReview(project, review, meta = {}) {
  normalizeScopeAudit(review?.scopeAudit, project, (project.deck?.slides || []).map(slide => slide.id));
  normalizeObligationAudit(review?.obligationAudit, project);
  normalizeClaimAudit(review?.claimAudit,project);
  project.quality = { ...(project.quality || {}), modelReview: review, reviewState: 'valid',
    reviewInputHash: semanticReviewKey(project), reviewerModel: { configId: project.configId, model: project.model }, rubricVersion: REVIEW_RUBRIC_VERSION, ...meta };
  return project.quality;
}

export function reviewIsCurrent(project) {
  return Boolean(scopeAuditIsCurrent(project.quality?.modelReview, project) && project.quality.modelReview.evaluation !== 'not_evaluated' && project.quality.rubricVersion === REVIEW_RUBRIC_VERSION && project.quality.reviewState === 'valid' && project.quality.reviewInputHash === semanticReviewKey(project));
}
