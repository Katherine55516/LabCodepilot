import {candidateFit} from './ppt-density-packing.mjs';
import {inspectNativeCoverTitle,inspectNativeOutlineTitles,rescheduleTemplateFidelity,restoreNativeTemplateCoverage} from './ppt-template-fidelity.mjs';
import {digest} from './ppt/edit-context.mjs';
export function outlineConfirmationHash(project){
 return digest({sourceHash:project.source?.sha256||'',policy:project.generationPolicy,selectionHash:project.contentSelection?.hash||null,pages:project.pages,template:project.template,slides:(project.outline||[]).map(({id,title,focus,section,sourceUnitIds,sourceArtifactRanges,repeatSourceUnitIds,pageContract,region})=>({id,title,focus,section,sourceUnitIds,sourceArtifactRanges,repeatSourceUnitIds,pageContract,region}))});
}
export function recordOutlineConfirmation(project,{titlesFrozen=true}={}){
 project.confirmedOutline={version:1,hash:outlineConfirmationHash(project),pages:project.pages,sourceHash:project.source?.sha256||'',titlesFrozen,confirmedAt:new Date().toISOString(),basis:titlesFrozen?'explicit confirmation of the current validated outline; no replanning in the editor':'legacy ready-outline generation request; page count and source ownership frozen, existing writer title contract retained'};
 return project;
}
/** Confirmation must keep the measured native assignment, or measure a new one
 * before any writer runs. A role-only reschedule invalidates fitValidated. */
export function confirmNativeOutlineFit(project,{useRenderedLegacyTitles=false}={}){
 if(project.templateFidelity?.mode!=='preserve')return project;
 const fits=()=>project.outline.slice(1).map((slide,i)=>({slide,index:i+1,fit:candidateFit(slide,project,i+1)}));
 const prior=project.templateFidelity;
 const score=(p,index)=>p.runtime?.slides?.[p.outline[index].id]?.accepted&&p.templateFidelity.slideMap[index]!==prior.slideMap[index]?Infinity:candidateFit(p.outline[index],p,index).predictedOverflow;
 let measured=fits();
 if(prior.slides?.length!==project.pages||measured.some(x=>!x.fit.capacity_ok)){
  try{rescheduleTemplateFidelity(project,{scoreSlide:score});}catch(error){project.templateFidelity=prior;throw error;}
  measured=fits();
 }
 try{restoreNativeTemplateCoverage(project,score);}catch(error){project.templateFidelity=prior;throw error;}
 measured=fits();
 // Legacy confirmations explicitly allowed writers to shorten titles. On a
 // generation retry, validate their completed visible titles, retaining the
 // confirmed outline and ownership. Frozen/new titles use the original plan.
 const titleProject=useRenderedLegacyTitles&&project.confirmedOutline?.titlesFrozen===false?{...project,outline:project.outline.map(o=>{const checkpoint=project.nodes?.[o.id];return checkpoint?.status==='done'&&checkpoint.slide?.title?{...o,title:checkpoint.slide.title}:o;})}:project;
 const titleFailures=[...inspectNativeOutlineTitles(titleProject),...inspectNativeCoverTitle(titleProject)];
 if(titleFailures.length){project.templateFidelity=prior;const error=new Error('outline_confirmation_title_capacity: '+JSON.stringify(titleFailures));error.code='capacity_invalid';throw error;}
 const failures=measured.filter(x=>!x.fit.capacity_ok);
 if(failures.length){project.templateFidelity=prior;const error=new Error('outline_confirmation_capacity: '+JSON.stringify(failures.map(({slide,index,fit})=>({slideId:slide.id,page:index+1,overflowEMU:fit.predictedOverflow,sourceUnitIds:slide.sourceUnitIds}))));error.code='capacity_invalid';throw error;}
 project.outline=project.outline.map((slide,index)=>index?{...slide,densityFit:measured[index-1].fit}:slide);
 project.pageDecision={...project.pageDecision,fitValidated:true};return project;
}
