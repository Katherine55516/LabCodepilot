/** Shared visibility for content QA. Canonical nodes take precedence over
 * draft copy, including when all of the canonical content is invisible. */
export function isVisibleNode(slide, node) {
  return !node.hidden && Number(node.style?.opacity ?? 1) > 0 &&
    !(node.nativeRef && slide.templateOmissions?.some(item => String(item.shapeId) === String(node.nativeRef.shapeId)));
}

export function visibleNodes(slide) {
  return (slide?.nodes || []).filter(node => isVisibleNode(slide, node));
}

export function nodeContentText(node) {
  const content = node.content || {};
  if (node.type === 'table') return (content.rows || []).map(row=>'| '+row.join(' | ')+' |').join('\n');
  if (content.items) return content.items.map(item => item.text || [item.heading || item.label, item.body].filter(Boolean).join(' ')).join('\n');
  return content.text || '';
}
