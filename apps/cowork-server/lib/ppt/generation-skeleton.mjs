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

/** A browser may request the in-flight page just after resume cleared its old
 * component scene. Keep a labelled, non-authoritative current-page preview;
 * future pages and missing IDs remain absent. This never enters export state. */
export function buildPendingSlidePreview(project,slideId) {
 if(!['generating','paused'].includes(project.status))return null;
 const current=(project.outline||[]).find(slide=>!slide.manualBlank&&!['done','completed'].includes(project.nodes?.[slide.id]?.status));
 if(!current||current.id!==slideId)return null;
 const native=buildTemplateSkeleton(project,slideId);if(native)return native;
 const size=project.renderTree?.size||{width:12192000,height:6858000};
 return {id:slideId,slideId,index:project.outline.findIndex(s=>s.id===slideId),layoutId:'pending-page',draft:true,size,background:project.templateSpec?.palette?.background||'#ffffff',elements:[applyRenderContract({id:'pending-title-'+slideId,nodeId:'pending-title-'+slideId,kind:'text',semanticRole:'title',locked:true,bounds:{x:Math.round(size.width*.065),y:Math.round(size.height*.08),width:Math.round(size.width*.87),height:Math.round(size.height*.18)},content:{text:current.title||''},style:{fontSizePt:32,fontWeight:700,fontFamily:project.templateSpec?.fonts?.title,color:project.templateSpec?.palette?.foreground||'#111111',lineHeight:1.18},zIndex:1})]};
}
