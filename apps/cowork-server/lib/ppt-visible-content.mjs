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
  if (content.items) return content.items.map(item => content.diagram&&(item.heading||item.body)?[item.heading||item.label,item.body].filter(Boolean).join('\n'):item.text || [item.heading || item.label, item.body].filter(Boolean).join(' ')).join('\n');
  return content.text || '';
}

/** Current canonical title wins over cached slide/planning metadata. A hidden
 * or cleared canonical title is not resurrected from that older metadata. */
export function visibleSlideTitle(slide){
 const native=(slide?.nodes||[]).filter(n=>n.semanticRole==='template-title');
 const candidates=native.length?native:(slide?.nodes||[]).filter(n=>n.semanticRole==='title');
 if(candidates.length){const current=candidates.find(n=>isVisibleNode(slide,n));return current?nodeContentText(current):'';}
 return String(slide?.title||'');
}
