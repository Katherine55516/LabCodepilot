/** A new presentation owns its facts. A report used as a template owns only
 * design unless the user explicitly elects to keep its fixed content. The
 * opaque original and cached import remain unchanged. */
export function templateDesignView(imported, contentImageIds = new Set(),fixedIds = new Set()) {
  const known=new Set(imported.deck.slides.flatMap(slide=>slide.nodes||[]).map(node=>node.id));
  if([...fixedIds].some(id=>!known.has(id)))throw new Error('Selected fixed template object is no longer available; review the current template');
  const view = structuredClone(imported);
  for (const slide of view.deck.slides) for (const node of slide.nodes || []) {
    const role = node.content?.mediaRole;
    const brand = fixedIds.has(node.id);
    if (brand) { node.content = { ...node.content, mediaRole: 'brand', mustPreserve: true }; continue; }
    node.content = { ...node.content, templateDesignOnly: true,mustPreserve:false,...(role==='brand'?{mediaRole:undefined}:{}) };
    // Raster backgrounds can contain old titles/numbers that XML cannot see.
    // Keep design tokens/vector decoration; retain raster only by explicit selection.
    if(['image','foreign'].includes(node.type)){node.content={...node.content,mediaRole:'old_template_content',templateSample:true};continue;}
    const size=view.externalPptx || {},g=node.geometry || {};
    const dataRules=node.type==='shape'&&g.height>0&&g.height<Number(size.height)*.01&&(slide.nodes||[]).some(owner=>['table','chart'].includes(owner.type)&&!fixedIds.has(owner.id)&&owner.geometry&&Math.abs(owner.geometry.x-g.x)<91440&&Math.abs(owner.geometry.width-g.width)<91440&&g.y>=owner.geometry.y&&g.y<Number(size.height)*.94);
    if(dataRules){node.content={...node.content,mediaRole:'old_template_content',templateSample:true,retiredDecorationBasis:'aligned horizontal rules of an unselected old data object'};continue;}
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
