import {pageCapacity,sourceDensityPlan} from './ppt-density-packing.mjs';
import {measureComponent,sourceComponent} from './ppt-density-capacity.mjs';
/** Offline full-source geometry scenario; never a v2 recommendation. */
const OMITTED = new Set(['notes_by_contract','excluded_by_policy']);
export function measuredPageEstimate(project){
 const items=project?.source?.semantic?.inventory?.items||[];
 if(!items.length)return null;
 const capacity=pageCapacity(project,Math.min(2,Math.max(1,(Number(project.pages)||3)-2)));
 const available=capacity.geometry.height*.9;
 if(!(available>0))return null;
 const largeArtifacts=[];let large=0,small=0;
 for(const item of items){
  if(!item.must_preserve_structure||OMITTED.has(item.presentation))continue;
  let fraction;try{fraction=measureComponent(sourceComponent(item),capacity.geometry,capacity.fontSizePt).height/available;}catch{continue;}
  if(!Number.isFinite(fraction))continue;
  if(fraction>1){const pages=Math.ceil(fraction);large+=pages;largeArtifacts.push({sourceUnitId:item.id,type:item.type,pages});}
  else small+=fraction;
 }
 const structuralBodyPages=large+Math.ceil(small);
 let plan=null;try{plan=sourceDensityPlan(project.source,{...project,pages:undefined});}catch{plan=null;}
 return {version:1,basis:'measured_native_capacity',fontSizePt:capacity.fontSizePt,structuralBodyPages,
  // Cover and closing frame the measured body pages.
  structuralPages:structuralBodyPages?structuralBodyPages+2:0,
  largeArtifacts:largeArtifacts.sort((a,b)=>b.pages-a.pages).slice(0,8),
  codeEstimate:plan?{recommended:plan.recommended,range:plan.range}:null};
}
/** The reading model is the sole estimate authority. Whole-source geometry
 * is a different scenario, not a second recommendation or a range floor. */
export function reconcilePageBudget(model,_measured){return {...model,adjusted:false};}
export function llmPageRecommendation(project){
 const r=project?.generationPolicy?.version===2&&project.inputUnderstanding;
 return r&&[r.recommended,r.min,r.max].every(n=>Number.isInteger(n)&&n>=3&&n<=100)&&r.min<=r.recommended&&r.recommended<=r.max?{recommended:r.recommended,min:r.min,max:r.max,reason:r.reason}:null;
}
/** Rebuild old calibrated budgets without rewriting confirmed decks or source. */
export function applyReadingPageBudget(project,key){
 const r=llmPageRecommendation(project);if(!r)return;
 const explicit=project.pageDecision?.mode==='explicit';
 project.pageBudget={version:2,authority:'llm_reading',mode:explicit?'explicit':'auto',recommended:r.recommended,range:{min:r.min,max:r.max},sourceIdentity:key,reason:r.reason,modelEstimate:{recommended:r.recommended,min:r.min,max:r.max},confirmed:Boolean(project.pageDecision?.confirmedAt||project.confirmedOutline),...(explicit?{requested:project.pages}:{})};
 if(!explicit&&!project.pageDecision?.confirmedAt&&!project.confirmedOutline){project.pages=r.recommended;project.pageDecision={...project.pageDecision,mode:'auto',source:'estimate',initialPageCount:r.recommended,finalPageCount:r.recommended,estimatedBeforeParse:false,awaitingInputRead:false,agentRead:true};}
}
/** Why an automatic outline outgrew its budget: structures shown complete. */
export function outlineGrowthCauses(project,slides=[]){
 const items=new Map((project?.originalSourceInventory?.items||project?.source?.semantic?.inventory?.items||[]).map(item=>[item.id,item]));
 const structural=id=>Boolean(items.get(id)?.must_preserve_structure);
 const owners=new Map();
 slides.forEach((slide,index)=>{for(const id of slide.sourceUnitIds||[])if(structural(id))owners.set(id,[...(owners.get(id)||[]),index]);});
 const splitArtifacts=[...owners].filter(([,pages])=>pages.length>1).map(([sourceUnitId,pages])=>({sourceUnitId,type:items.get(sourceUnitId).type,pages:pages.length,title:String(slides[pages[0]]?.title||'').replace(/\s*[（(][^()（）]*(?:rows?|行|lines?)[^()（）]*[)）]\s*$/iu,'').slice(0,80)}));
 const dedicatedStructuralPages=slides.filter(slide=>(slide.sourceUnitIds||[]).length===1&&structural(slide.sourceUnitIds[0])).length;
 return {splitArtifacts:splitArtifacts.sort((a,b)=>b.pages-a.pages).slice(0,6),dedicatedStructuralPages,
  measuredStructuralPages:project?.pageBudget?.measured?.structuralPages||null,modelEstimate:project?.pageBudget?.modelEstimate?.recommended||null};
}
