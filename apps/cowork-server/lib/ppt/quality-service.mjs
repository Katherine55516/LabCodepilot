import { deterministicReview, repairProject } from '../ppt-quality.mjs';
import { buildRenderTree } from './render-tree.mjs';
import { ensureProjectV3 } from './ir.mjs';


export function reviewProject(projectInput) {
  const project = ensureProjectV3(projectInput);
  const renderTree = buildRenderTree(project);
  const deterministic = deterministicReview(project);
  deterministic.hardErrors = deterministic.issues.filter(issue => issue.severity === 'error').length;
  return { project: { ...project, renderTree }, renderTree, deterministic };
}

export function repairAndReview(projectInput) {
  const first = reviewProject(projectInput);
  const repaired = repairProject(first.project, first.deterministic);
  return { ...reviewProject(repaired.project), repairs: repaired.repairs };
}
