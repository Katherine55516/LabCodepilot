import { getProject, saveProject, saveRevision, enqueueProject } from './repository.mjs';
import { newId } from './ir.mjs';
import { reviewProject } from './quality-service.mjs';
import { renderImportedPptx } from './import-pptx.mjs';
import { reviewSemantic } from './semantic-review-service.mjs';
import { semanticReviewKey } from './versioning.mjs';
import { finalQualityReport } from '../ppt-quality.mjs';
import { acceptExportVerification, blockExportVerification } from '../ppt-export-integrity.mjs';

export async function publishProject(uid, projectId, deps, activity, log) {
  const snapshot = getProject(uid, projectId);
  if (!snapshot || snapshot.deletedAt || !['completed', 'quality_blocked'].includes(snapshot.status)) throw Object.assign(new Error('project is not ready to publish'), { statusCode: 409 });
  const inputHash = semanticReviewKey(snapshot);
  await reviewSemantic(snapshot, deps, activity, log);
  return enqueueProject(uid, projectId, () => publishLocked(uid, projectId, deps, snapshot, inputHash));
}

async function publishLocked(uid, projectId, deps, snapshot, inputHash) {
  let project = getProject(uid, projectId);
  if (!project) throw Object.assign(new Error('project not found'), { statusCode: 404 });
  if (!['completed', 'quality_blocked'].includes(project.status) || project.deletedAt) throw Object.assign(new Error('project is not ready to publish'), { statusCode: 409 });
  if (semanticReviewKey(project) !== inputHash) throw Object.assign(new Error('content changed during review; publish again'), { statusCode: 409 });
  project.quality = snapshot.quality;
  const reviewed = reviewProject(project);
  project = reviewed.project;
  // Native fidelity changes a rule's applicability at inspection time. It must
  // never remove findings here: a clean critic cannot override visible loss.
  project.quality = { ...(project.quality || {}), ...finalQualityReport(reviewed.deterministic, [], project.quality?.modelReview || { evaluation: 'not_evaluated', missing: [], repeated: [], conflicts: [], unsupported: [] }) };
  if (!project.quality.publishEligible) {
    project.status = 'quality_blocked'; project.stage = 'repair'; project.error = 'PPT quality gate blocked publish';
    saveProject(project); return { project, published: false };
  }
  const output = `/workspace/published-${project.revision}-${newId('artifact')}.pptx`;
  const candidate = { ...project, renderOutput: output };
  try {
    const exportInfo=project.externalPptx ? await (deps.renderImportedPptx || renderImportedPptx)(candidate) : await deps.renderPptx(candidate);
    acceptExportVerification(project,exportInfo);
  } catch(error) {
    blockExportVerification(project,error);saveProject(project);return {project,published:false};
  }
  project.publishedArtifactPath = output;
  delete project.renderUpgradePending;
  project.status = 'completed'; project.stage = 'completed'; project.error = '';
  project.publishedRevision = project.revision; project.publishedAt = new Date().toISOString();
  project.publishedRenderTree = project.renderTree;
  saveProject(project); saveRevision(project, 'publish');
  return { project, published: true };
}
