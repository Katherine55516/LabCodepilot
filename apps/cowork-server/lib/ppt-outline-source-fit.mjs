import {fitThemePage} from './ppt-card-pages.mjs';
import{repairNativePageAssignment}from'./ppt-template-fidelity.mjs';
import{contentCanvas}from'./ppt-density-capacity.mjs';
import{bindSourceArtifacts,bindSourceMedia}from'./ppt-source-artifacts.mjs';
import{writerSourceEvidenceIds}from'./ppt-prompt-contracts.mjs';
import{inspectSkeletonOwnership}from'./ppt-outline-protocol.mjs';
import{inspectDensityOutline}from'./ppt-density-packing.mjs';
import{sourceMediaTasks}from'./ppt-source-media-tasks.mjs';
import{relationalComponent,relationalPlan}from'./ppt-relational-diagram.mjs';
/** Freeze only source objects that the actual writer can bind unchanged. A
 * prose estimate can be rewritten later; an oversized immutable table/code
 * selection cannot. Probe the production binding path without optional copy. */
export function inspectFrozenOutlineSources(project,outline=project.outline||[],planning=project.planning,{onFit,repairNative=false}={}){
 const modern=outline.some(slide=>slide.planningProtocolVersion===2);
 const structural=modern?[...inspectSkeletonOwnership(project,{version:2,slides:outline}),...inspectDensityOutline({slides:outline},project).filter(issue=>issue.code!=='planned_density_overflow')]:[];
 const issues=structural.map(issue=>({...issue,blocking:true}));
 const probe={...project,outline,planning,templateFidelity:project.templateFidelity?structuredClone(project.templateFidelity):undefined};
 const items=project.source?.semantic?.inventory?.items||[],graphParts=new Map();
 // A relation graph is split only when the complete graph, alone on the
 // page, cannot bind as a relation diagram through the same production path.
 const wholeGraphFits=(outlineSlide,item,pageIndex)=>{
  // Cheap bound first: a diagram that overflows the whole content canvas at
  // the smallest allowed font cannot bind in any frame of that page.
  const component=relationalComponent(item),canvas=contentCanvas(probe,pageIndex),base=canvas.fontSizePt;
  const floor=project.generationPolicy?.sourceTypography==='bounded'?Math.min(base,Math.max(16,Math.ceil(base*.9*10)/10)):base;
  if(!component||relationalPlan(component.content,canvas.geometry,floor)?.overflow!==false)return false;
  const whole=[{sourceUnitId:item.id}],slide={...structuredClone(outlineSlide),nodes:[],nodeOrder:[],copy:{blocks:[]}};
  const trial={...probe,templateFidelity:probe.templateFidelity?structuredClone(probe.templateFidelity):undefined,planning:{...planning,slidePlan:planning.slidePlan.map(plan=>plan.slideId===outlineSlide.id?{...plan,sourceArtifacts:whole,mediaTasks:sourceMediaTasks(project.source,{...plan,sourceArtifacts:whole})}:plan)}};
  try{bindSourceArtifacts(trial,slide,whole,pageIndex,[],[]);return (slide.mediaTasks||[]).every(t=>!t.required||t.representationFulfilled!==false);}catch{return false;}
 };
 outline.forEach((outlineSlide,pageIndex)=>{
  const contract=planning?.slidePlan?.find(plan=>plan.slideId===outlineSlide.id),refs=contract?.sourceArtifacts||[],evidence=writerSourceEvidenceIds(probe,pageIndex,contract);
  if(!refs.length&&!evidence.length&&!outlineSlide.sourceImageIds?.length)return;
  for(const ref of refs){
   const item=items.find(i=>i.id===ref.sourceUnitId),rowEnd=ref.rowEnd??item?.rows?.length;
   if(!item?.diagramSource?.graph||item.diagramSource.presentation!=='semantic_graph_rows'||ref.rowStart===undefined||ref.rowStart===1&&rowEnd===item.rows.length)continue;
   if(!graphParts.has(item.id))graphParts.set(item.id,[]);graphParts.get(item.id).push({pageIndex,slideId:outlineSlide.id,rowStart:ref.rowStart,rowEnd});
  }
  const evaluate=(candidate,index)=>{
    const slide={...structuredClone(outlineSlide),nodes:[],nodeOrder:[],copy:{blocks:[]}};
    try{if(outlineSlide.cardFigureLayout){const fit=fitThemePage(candidate,index,outlineSlide)?.fit;if(!fit?.capacity_ok)throw Object.assign(Error('Source figures and all card points must fit together at the scheduled body font.'),{code:'capacity_invalid'});return {fit};}bindSourceArtifacts(candidate,slide,refs,index,[],evidence);bindSourceMedia(candidate,slide,outlineSlide.sourceImageIds||[],index);const unmet=(slide.mediaTasks||[]).filter(t=>t.required&&t.representationFulfilled===false);if(unmet.length)throw Object.assign(Error('Requested editable source media cannot fit faithfully in this layout; a plain table fallback does not fulfill the confirmed relation diagram. A relation graph that cannot fit one page may be split into row ranges on consecutive pages; each part is drawn as a relation diagram with continuation cards.'),{code:'capacity_invalid',details:{reason:'source_media_layout',sourceUnitIds:unmet.flatMap(t=>t.sourceIds||[]),requestedComponents:unmet.map(t=>t.requestedComponentType)}});return {fit:slide.sourceArtifactFit||{capacity_ok:true,fontSizePt:contentCanvas(candidate,index).fontSizePt}};}
    catch(error){return {error,fit:{capacity_ok:false,fontSizePt:error.details?.fontSizePt||contentCanvas(candidate,index).fontSizePt}};}
  };
  let measured=evaluate(probe,pageIndex);
  if(repairNative&&measured.error?.code==='capacity_invalid'){
    const changed=repairNativePageAssignment(probe,pageIndex,(candidate,index)=>evaluate(candidate,index).fit);
    if(changed){project.templateFidelity=structuredClone(probe.templateFidelity);project.templateSlideMap=[...probe.templateFidelity.slideMap];measured=evaluate(probe,pageIndex);}
  }
  if(!measured.error){if(measured.fit.capacity_ok)onFit?.({pageIndex,fit:measured.fit});}
  else {const error=measured.error;issues.push({code:error.details?.reason==='source_media_layout'?'planned_source_media_layout':error.details?.reason==='source_resource_limit'?'planned_source_resource_limit':'planned_frozen_source_capacity',severity:'error',pageIndex,slideId:outlineSlide.id,blocking:true,repairable:true,...(error.details?{details:error.details}:{}),
   message:`Page ${pageIndex+1} cannot fit its complete frozen source objects at the selected font. Before confirmation, repair this page’s explicit source selection, faithful summaries or legal native layout within the current page budget. Code does not recommend a new page count. ${String(error.message).slice(0,900)}`});}
 });
 for(const [sourceUnitId,parts]of graphParts){
  const item=items.find(i=>i.id===sourceUnitId);parts.sort((a,b)=>a.rowStart-b.rowStart);
  const details={sourceUnitIds:[sourceUnitId],parts:parts.map(({pageIndex,rowStart,rowEnd})=>({pageIndex,rowStart,rowEnd}))};
  const gap=parts.find((part,k)=>k>0&&part.pageIndex!==parts[k-1].pageIndex+1);
  if(gap)issues.push({code:'planned_source_graph_split_order',severity:'error',pageIndex:gap.pageIndex,slideId:gap.slideId,blocking:true,repairable:true,details,
   message:`Relation graph ${sourceUnitId} is split into row ranges on pages ${parts.map(p=>p.pageIndex+1).join(', ')}. Place its parts on consecutive pages in row order, so every continuation card leads to the adjacent page.`});
  const roomy=parts.find(part=>wholeGraphFits(outline[part.pageIndex],item,part.pageIndex));
  if(roomy)issues.push({code:'planned_source_graph_split_unneeded',severity:'error',pageIndex:roomy.pageIndex,slideId:roomy.slideId,blocking:true,repairable:true,details,
   message:`Page ${roomy.pageIndex+1} holds rows ${roomy.rowStart}–${roomy.rowEnd-1} of relation graph ${sourceUnitId}, but the complete graph fits this page as one relation diagram at the allowed font. Keep a graph that fits whole on one page; split only a graph that cannot fit.`});
 }
 return issues;
}
