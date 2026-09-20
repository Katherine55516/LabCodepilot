import { deterministicReview, repairProject } from '../ppt-quality.mjs';
import { boundsIntersect, buildRenderTree } from './render-tree.mjs';
import { ensureProjectV3 } from './ir.mjs';

function renderIssues(tree) {
  const issues = [];
  for (const slide of tree.slides) {
    const editable = slide.elements.filter(element => !element.locked);
    for (let i = 0; i < editable.length; i++) for (let j = i + 1; j < editable.length; j++) {
      if (boundsIntersect(editable[i].bounds, editable[j].bounds)) issues.push({
        code: 'render_overlap', severity: 'error', message: `${editable[i].id} 与 ${editable[j].id} 重叠`,
        slideId: slide.id, nodeIds: [editable[i].nodeId, editable[j].nodeId].filter(Boolean), repairable: true,
      });
    }
    for (const element of editable) {
      const b = element.bounds;
      if (b.x < 0 || b.y < 0 || b.x + b.width > slide.size.width || b.y + b.height > slide.size.height) {
        issues.push({ code: 'render_overflow', severity: 'error', message: `${element.id} 超出页面边界`, slideId: slide.id, nodeIds: [element.nodeId].filter(Boolean), repairable: true });
      }
      if (['text', 'list', 'timeline', 'metric'].includes(element.kind) && Number(element.style?.fontSizePt || 0) < 10) {
        issues.push({ code: 'minimum_font_size', severity: 'error', message: `${element.id} 字号低于 10pt`, slideId: slide.id, nodeIds: [element.nodeId].filter(Boolean), repairable: true });
      }
    }
  }
  return issues;
}

export function reviewProject(projectInput) {
  const project = ensureProjectV3(projectInput);
  const renderTree = buildRenderTree(project);
  const deterministic = deterministicReview(project);
  deterministic.issues.push(...renderIssues(renderTree));
  deterministic.hardErrors = deterministic.issues.filter(issue => issue.severity === 'error').length;
  return { project: { ...project, renderTree }, renderTree, deterministic };
}

export function repairAndReview(projectInput) {
  const first = reviewProject(projectInput);
  const repaired = repairProject(first.project, first.deterministic);
  return { ...reviewProject(repaired.project), repairs: repaired.repairs };
}
