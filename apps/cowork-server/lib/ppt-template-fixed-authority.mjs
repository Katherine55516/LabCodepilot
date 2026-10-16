import {nodeContentText,visibleNodes} from './ppt-visible-content.mjs';
/** User-approved template copy is display authority for that exact object only.
 * It cannot supply facts for new body claims, invented IDs or changed text. */
export function approvedFixedTemplateCopy(project,node){
 if(project.templateContentMode!=='keep_fixed'||!node.nativeRef||!node.content?.mustPreserve||!project.templateFidelity?.sha256)return null;
 const ref=node.nativeRef,sourceIndex=ref.sourceSlideIndex??project.templateFidelity.slideMap?.[ref.slideIndex];
 if(!Number.isInteger(sourceIndex))return null;
 const original=project.templateFidelity.sourceCatalog?.[sourceIndex]?.nodes?.find(base=>base.nativeRef?.shapeId===ref.shapeId);
 if(!original||!original.content?.mustPreserve||!project.templateFixedObjectIds?.includes(original.id))return null;
 const text=nodeContentText(original);
 if(!text||nodeContentText(node)!==text)return null;
 return {originalObjectId:original.id,sourceSlideIndex:sourceIndex,shapeId:ref.shapeId,templateSha256:project.templateFidelity.sha256,text};
}
export function fixedTemplateCopyContext(project){
 return (project.deck?.slides||[]).flatMap(slide=>visibleNodes(slide).flatMap(node=>{
  const authority=approvedFixedTemplateCopy(project,node);return authority?[{slideId:slide.id,nodeId:node.id,...authority}]:[];
 }));
}

export function unmappedFixedTemplatePages(project){
 if(project.templateContentMode!=='keep_fixed'||project.templateFidelity?.mode!=='preserve')return [];
 const selected=new Set(project.templateFixedObjectIds||[]),map=project.templateFidelity.slideMap||[];
 return (project.templateFidelity.sourceCatalog||[]).flatMap((slide,index)=>slide.nodes?.some(node=>selected.has(node.id))&&!map.includes(index)?[index+1]:[]);
}
