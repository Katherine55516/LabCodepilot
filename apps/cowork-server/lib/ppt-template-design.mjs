/** A new presentation owns its facts. A report used as a template owns only
 * design unless the user explicitly elects to keep its fixed content. The
 * opaque original and cached import remain unchanged. */
export function templateDesignView(imported, contentImageIds = new Set()) {
  const view = structuredClone(imported);
  for (const slide of view.deck.slides) for (const node of slide.nodes || []) {
    const role = node.content?.mediaRole;
    const brand = role === 'brand' || /(?:\blogo\b|\bbrand\b|标志|標誌)/iu.test(node.nativeRef?.name || '');
    if (brand) { node.content = { ...node.content, mediaRole: 'brand', mustPreserve: true }; continue; }
    node.content = { ...node.content, templateDesignOnly: true };
    const size=view.externalPptx || {},g=node.geometry || {};
    const area=g.width*g.height/Math.max(1,size.width*size.height);
    const sideBackground=(g.x<=size.width*.035 || g.x+g.width>=size.width*.965) && g.y<=size.height*.035 && g.height>=size.height*.9 && g.width>=size.width*.25 && g.width<=size.width*.55;
    const background=role==='template_decoration' || area>=.8 || sideBackground;
    const foregroundPicture=node.type==='image' && !background && area>.005;
    const opaqueContent=node.type==='foreign' && !background && area>.005;
    if (!node.content.mustPreserve && (['chart','table'].includes(node.type) || contentImageIds.has(node.id) || foregroundPicture || opaqueContent))
      node.content = { ...node.content, mediaRole: 'old_template_content', templateSample: true };
  }
  return view;
}

export function isOrdinalSequence(nodes) {
  const candidates=nodes.filter(node=>node.type==='text' && /^\s*\d{1,2}\s*$/u.test(node.content?.text || ''));
  const numbers=candidates.map(node=>Number(node.content.text));
  return candidates.length>=2 && new Set(numbers).size===numbers.length && numbers.every(n=>n>=1 && n<=numbers.length)
    ? new Set(candidates.map(node=>node.id)) : new Set();
}
