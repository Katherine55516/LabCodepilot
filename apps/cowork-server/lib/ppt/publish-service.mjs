import { getProject, saveProject, saveRevision } from './repository.mjs';
import { reviewProject } from './quality-service.mjs';
import { renderImportedPptx } from './import-pptx.mjs';

export async function publishProject(uid, projectId, deps) {
  let project = getProject(uid, projectId);
  if (!project) throw Object.assign(new Error('project not found'), { statusCode: 404 });
  const reviewed = reviewProject(project);
  project = reviewed.project;
  if (project.externalPptx) {
    reviewed.deterministic.issues = reviewed.deterministic.issues.filter(issue => ['render_overflow', 'minimum_font_size', 'font_template', 'font_cjk_coverage'].includes(issue.code));
    reviewed.deterministic.hardErrors = reviewed.deterministic.issues.filter(issue => issue.severity === 'error').length;
  }
  project.quality = { ...(project.quality || {}), deterministic: reviewed.deterministic,
    status: reviewed.deterministic.hardErrors ? 'blocked' : 'passed' };
  if (reviewed.deterministic.hardErrors) {
    project.status = 'quality_blocked'; project.stage = 'repair'; project.error = 'PPT quality gate blocked publish';
    saveProject(project); return { project, published: false };
  }
  if (project.externalPptx) await renderImportedPptx(project);
  else await deps.renderPptx(project);
  project.status = 'completed'; project.stage = 'completed'; project.error = '';
  project.publishedRevision = project.revision; project.publishedAt = new Date().toISOString();
  project.publishedRenderTree = project.renderTree;
  saveProject(project); saveRevision(project, 'publish');
  return { project, published: true };
}
