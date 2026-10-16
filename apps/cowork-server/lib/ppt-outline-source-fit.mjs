import{bindSourceArtifacts,bindSourceMedia}from'./ppt-source-artifacts.mjs';
import{writerSourceEvidenceIds}from'./ppt-prompt-contracts.mjs';
import{inspectSkeletonOwnership}from'./ppt-outline-protocol.mjs';
import{inspectDensityOutline}from'./ppt-density-packing.mjs';
/** Freeze only source objects that the actual writer can bind unchanged. A
 * prose estimate can be rewritten later; an oversized immutable table/code
 * selection cannot. Probe the production binding path without optional copy. */
export function inspectFrozenOutlineSources(project,outline=project.outline||[],planning=project.planning){
 const modern=outline.some(slide=>slide.planningProtocolVersion===2);
 const structural=modern?[...inspectSkeletonOwnership(project,{version:2,slides:outline}),...inspectDensityOutline({slides:outline},project).filter(issue=>issue.code!=='planned_density_overflow')]:[];
 const issues=structural.map(issue=>({...issue,blocking:true}));
 const probe={...project,outline,planning,templateFidelity:project.templateFidelity?structuredClone(project.templateFidelity):undefined};
 outline.forEach((outlineSlide,pageIndex)=>{
  const contract=planning?.slidePlan?.find(plan=>plan.slideId===outlineSlide.id),refs=contract?.sourceArtifacts||[],evidence=writerSourceEvidenceIds(probe,pageIndex,contract);
  if(!refs.length&&!evidence.length&&!outlineSlide.sourceImageIds?.length)return;
  const slide={...structuredClone(outlineSlide),nodes:[],nodeOrder:[],copy:{blocks:[]}};
  try{bindSourceArtifacts(probe,slide,refs,pageIndex,[],evidence);bindSourceMedia(probe,slide,outlineSlide.sourceImageIds||[],pageIndex);}
  catch(error){issues.push({code:'planned_frozen_source_capacity',severity:'error',pageIndex,slideId:outlineSlide.id,blocking:true,repairable:true,
   message:`Page ${pageIndex+1} cannot fit its complete frozen source objects at the selected font. Repartition original objects or increase the page budget before confirmation. ${String(error.message).slice(0,900)}`});}
 });
 return issues;
}
