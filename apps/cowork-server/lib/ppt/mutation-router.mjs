import { digest, editError, editableCapabilities } from './edit-context.mjs';

const TYPES = new Set(['content', 'title', 'layout', 'style', 'asset', 'data', 'structure']);
export function classifyMutation(instruction, requested) {
  if (requested && requested !== 'auto' && requested !== 'relayout') {
    if (!TYPES.has(requested)) throw editError('unsupported mutation type', 400);
    return requested;
  }
  if (requested === 'relayout') return 'layout';
  // Preservation clauses constrain the edit; their nouns are not requested
  // operations ("修正说明，保留字体" must not route to a style model).
  instruction=String(instruction).replace(/(^|[。；;,\n，])\s*(?:保留|保持|維持|不(?:要)?(?:改|修改|改变|更改)|不要(?:修改|改变|更改)|勿(?:修改|改变|更改)|(?:keep|preserve|retain)\b|(?:do not|don’t|don't)\s+(?:change|modify|replace)\b)[^。；;,\n，]*/giu,'$1')
    .replace(/\bwhile\s+(?:keeping|preserving|retaining)\b[^.;\n]*/giu,'');
  if (/拆(?:成|分)?.{0,5}(?:页|slide)|合并.{0,8}(?:页|slide)|删除.{0,5}页|split.{0,10}slide|merge.{0,10}slide|insert.{0,10}slide|新增.{0,5}页/iu.test(instruction)) return 'structure';
  if (/图片|配图|image|photo|illustration/iu.test(instruction) && /换|替|生成|更|replace|generate|swap/iu.test(instruction)) return 'asset';
  if (/配色|颜色|字体|字号|行距|风格|主题|style|theme|colou?r|font|spacing/iu.test(instruction)) return 'style';
  if (/两栏|双栏|布局|版式|排版|columns?|layout|relayout/iu.test(instruction)) return 'layout';
  if (/图表数据|数据值|chart data|numeric values|表格数据/iu.test(instruction)) return 'data';
  if (/标题|headline|title/iu.test(instruction) && !/正文|body|内容整体/iu.test(instruction)) return 'title';
  return 'content';
}

export function routeMutation(project, instruction, options = {}) {
  const type = classifyMutation(instruction, options.type || options.mode);
  const capabilities = editableCapabilities(project);
  if (['layout', 'structure'].includes(type) && !capabilities.relayout) throw editError('native templates preserve their original layout and structure', 409);
  const dimensions = { content: ['content', 'layout', 'qa', 'review'], title: ['title', 'layout', 'qa', 'review'],
    layout: ['layout', 'qa'], style: ['style', 'layout', 'qa'], asset: ['asset', 'layout', 'qa', 'visual-review'],
    data: ['data', 'layout', 'qa', 'review'], structure: ['plan', 'content', 'layout', 'qa', 'review'] }[type];
  return { type, instruction, dimensions, strategy: type === 'structure' ? 'plan-delta' : `${type}-patch`,
    preserve: ['sources', 'locked-nodes', 'accepted-content', ...(type !== 'data' ? ['numbers', 'units', 'conditions'] : [])] };
}

export function impactFor(project, route, slideIds) {
  return { type: route.type, slideIds, nodeIds: [], invalidates: route.dimensions,
    pageCountChanged: route.type === 'structure', contentChanged: ['content', 'title', 'data', 'structure'].includes(route.type),
    planRevision: project.planRevision?.version || 0, constraintRevision: project.constraints?.version || 0 };
}

export function addConstraint(project, intent, slideIds) {
  project.constraints ||= { version: 0, entries: [] };
  const preference = /精简|简短|缩短|short|concise/iu.test(intent.instruction) ? 'brevity'
    : /丰富|扩展|详细|深|enrich|expand|detail/iu.test(intent.instruction) ? 'depth' : intent.type;
  const kind = `${intent.type}:${['brevity','depth'].includes(preference) ? 'length' : preference}`;
  project.constraints.version++;
  for (const slideId of slideIds) {
    // Latest preference supersedes the same kind at the same explicit scope.
    for (const entry of project.constraints.entries) if (entry.slideId === slideId && entry.kind === kind && entry.scope === intent.scope && entry.active) entry.active = false;
    project.constraints.entries.push({ id: `${intent.id}:${slideId}`, slideId, scope: intent.scope, kind,
      type: intent.type, instruction: intent.instruction, active: true, intentId: intent.id, version: project.constraints.version, hard: false });
  }
  return project.constraints;
}

export function effectiveConstraints(project, slideId) {
  const rank = { deck: 0, remaining: 1, following: 1, section: 2, current: 3, object: 4 };
  const selected = new Map();
  for (const entry of project.constraints?.entries || []) if (entry.active && entry.slideId === slideId) {
    const previous = selected.get(entry.kind);
    if (!previous || (rank[entry.scope] || 0) > (rank[previous.scope] || 0) ||
      ((rank[entry.scope] || 0) === (rank[previous.scope] || 0) && entry.version > previous.version)) selected.set(entry.kind, entry);
  }
  return [...selected.values()];
}

export function constraintFingerprint(project, slideId) { return digest(effectiveConstraints(project, slideId)); }
