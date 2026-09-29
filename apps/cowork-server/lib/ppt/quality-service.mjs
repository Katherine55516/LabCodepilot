import { deterministicReview, repairProject } from '../ppt-quality.mjs';
import { boundsIntersect, buildRenderTree } from './render-tree.mjs';
import { ensureProjectV3 } from './ir.mjs';
import { visualUnits } from '../ppt-presentation-writing.mjs';
import { estimateTypographyFit } from '../ppt-content-depth.mjs';

function textFitEstimate(element) {
  const items = element.kind === 'text' ? [String(element.content?.text || '')]
    : (element.content?.items || []).map(item => String(item.text || ''));
  const size = Number(element.style?.fontSizePt || 18);
  const widthPt = Number(element.bounds?.width || 0) / 914400 * 72;
  const heightPt = Number(element.bounds?.height || 0) / 914400 * 72;
  return estimateTypographyFit(items, { widthPt, heightPt, fontSizePt: size,
    lineHeight: Number(element.style?.lineHeight || 1.12),
    paragraphSpacingEm: Number(element.style?.paragraphSpacingEm || 0) }, visualUnits);
}

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
      const prose = ['list', 'timeline', 'metric'].includes(element.kind) ||
        (element.kind === 'text' && !['eyebrow', 'subtitle', 'takeaway', 'title'].includes(element.semanticRole));
      if (!element.nativeRef && prose && Number(element.style?.fontSizePt || 0) < 14) {
        issues.push({ code: 'minimum_font_size', severity: 'error', message: `${element.id} 字号低于 14pt`, slideId: slide.id, nodeIds: [element.nodeId].filter(Boolean), repairable: true });
      }
      if (!element.nativeRef && ['text', 'list', 'timeline', 'metric'].includes(element.kind)) {
        if (element.kind === 'list' && element.content?.pointLayout) {
          if (element.content.pointLayout.overflow) issues.push({
            code: 'point_layout_capacity', severity: 'error',
            message: `${element.id} 的要点超过固定页容量；请缩短、换版式或拆页`,
            slideId: slide.id, nodeIds: [element.nodeId].filter(Boolean), repairable: false,
            details: { points: element.content.items?.length || 0, fontSizePt: element.content.pointLayout.fontSizePt,
              suggestedSplitCount: element.content.pointLayout.suggestedSplitCount },
          });
          continue;
        }
        const spacing = Number(element.style?.lineHeight || 1.12);
        if (spacing < .95) issues.push({ code: 'typography_too_compact', severity: 'warning',
          message: `${element.id} 行距低于 0.95，建议调整以便阅读`, slideId: slide.id,
          nodeIds: [element.nodeId].filter(Boolean), repairable: false });
        const fit = textFitEstimate(element);
        if (fit.lines > 1 && fit.estimatedHeightPt > fit.availableHeightPt * 1.2) issues.push({
          code: 'typography_capacity', severity: 'warning',
          message: `${element.id} 正文估计超过文本框容量，应先重组内容或版式`, slideId: slide.id,
          nodeIds: [element.nodeId].filter(Boolean), details: fit, repairable: true,
        });
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
