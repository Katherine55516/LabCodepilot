import {applyRenderContract} from './render-contract.mjs';

/** Non-authoritative template scene for the live viewer only. Never placed
 * in runtime.preview, deck nodes, renderHash or an exported presentation. */
export function buildTemplateSkeleton(project, slideId) {
  if(!['generating','paused'].includes(project.status)||project.templateFidelity?.mode!=='preserve')return null;
  const index=(project.outline||[]).findIndex(slide=>slide.id===slideId);
  const spec=project.templateFidelity.slides?.[index],slide=project.outline?.[index];
  if(index<0||!spec)return null;
  const elements=(spec.nodes||[]).flatMap(node=>{
    if(!node.geometry)return [];
    const role=spec.slots?.find(slot=>String(slot.shapeId)===String(node.nativeRef?.shapeId))?.role;
    let content=node.content||{};
    if(node.type==='text'){
      if(!['title','section'].includes(role))return [];
      content={text:role==='title'?slide.title||'':slide.section||''};
    }else if(!['image','shape','foreign'].includes(node.type))return [];
    return [applyRenderContract({id:node.id,nodeId:node.id,kind:node.type==='foreign'?'shape':node.type,
      bounds:node.geometry,content,style:node.style||{},rotation:node.rotation||0,zIndex:node.zIndex||0,
      locked:true,semanticRole:role||node.semanticRole})];
  }).sort((a,b)=>a.zIndex-b.zIndex);
  return {id:slideId,slideId,index,layoutId:'template-skeleton',draft:true,
    size:{width:project.templateFidelity.width,height:project.templateFidelity.height},
    background:spec.background||project.templateSpec?.palette?.background,elements};
}
