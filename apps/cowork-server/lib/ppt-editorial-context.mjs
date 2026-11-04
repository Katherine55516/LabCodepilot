import {explanationObligations} from './ppt-explanation-obligations.mjs';
import {digest} from './ppt/edit-context.mjs';
/** Carry the validated group intent through planning/writing/review, without
 * treating generated intent as evidence or changing the confirmed page budget. */
export function withEditorialContext(plans,project){
 const groups=project.semanticGrouping?.groups||project.inputUnderstanding?.groups||[];
 return plans.map(plan=>{
  const owned=new Set(plan.sourceUnitIds||[]),matching=groups.filter(g=>(g.sourceUnitIds||[]).some(id=>owned.has(id)));
  const supplied=plan.questionOrigin==='model';
  const question=supplied?plan.question:matching[0]?.readerQuestion||matching[0]?.question||plan.question;
  return {...plan,question,questionOrigin:supplied?'model':matching.length?'derived_reading_group':'legacy_focus',editorialContext:{version:2,pageQuestion:question,pageMessage:plan.message,
   groups:matching.map(g=>({...(g.id?{id:g.id}:{}),readerQuestion:g.readerQuestion||g.question,coreMessage:g.coreMessage,narrativeRole:g.narrativeRole,
    groupingReason:g.groupingReason,relationEvidence:g.relationEvidence||[],supportRoles:(g.supportRoles||[]).filter(r=>owned.has(r.sourceUnitId))})),
   basis:'validated narrative intent; original source remains factual authority'}};
 });
}

/** Persist the actual whole-deck plan before writers; no page estimates or
 * invented facts. Narrative dependencies are never source causal edges. */
export function editorialBlueprint(project,plans){
 const pages=plans.map((p,index)=>({slideId:p.slideId,index,role:p.role,readerTask:p.question,questionOrigin:p.questionOrigin,
  answer:p.message,explanationObligations:explanationObligations(project).filter(o=>o.sourceUnitIds.some(id=>(p.sourceUnitIds||[]).includes(id))),sourceUnitIds:p.sourceUnitIds||[],requiredRelations:p.pageContract?.requiredRelations||[],
  requiredUnits:p.pageContract?.requiredUnits||[],groupingReason:p.pageContract?.groupingReason||'',
  references:p.pageContract?.references||[],...(index?{narrativePriorSlideId:plans[index-1].slideId}:{})}));
 const identity={source:project.source?.sha256,sourceRevision:project.sourceRevision||0,policy:project.generationPolicy,template:project.templateFidelity?.sha256||project.template,N:project.pages,pages};
 return {version:1,hash:digest(identity),total:pages.length,confirmedTotal:project.pages,includesAllPhysicalRoles:true,pages,
  readingIdentity:project.inputUnderstanding?.sourceIdentity,basis:'Whole model outline compiled before per-page writers; derived questions labelled; not source evidence'};
}

export function editorialDiagnostics(project,slides=project.deck?.slides||[]){
 const issues=[],plans=project.planning?.slidePlan||[],seen=new Map();
 for(const plan of plans){
  if(['cover','closing','navigation','section'].includes(plan.role))continue;
  const page=slides.find(s=>s.id===plan.slideId);if(!page)continue;
  const message=String(plan.message||'').toLowerCase().replace(/[\s\p{P}]/gu,'');
  if(message.length>=20){
   const prior=seen.get(message),outline=project.outline?.find(s=>s.id===plan.slideId);
   if(prior&&!outline?.repeatSourceUnitIds?.length&&!outline?.repeatPurpose)issues.push({code:'editorial_page_message_repeated',severity:'warning',slideIds:[prior,plan.slideId],repairable:true,message:'These pages state the same planned answer. Check their incremental evidence or merge within the confirmed budget; this is a diagnostic, not semantic proof.'});
   else seen.set(message,plan.slideId);
  }
  const task=String(plan.question||'');
  if(/^(?:how (?:to |can |must the reader )?(?:understand|explain)|what must the reader understand about|如何理解|本部分如何)/iu.test(task))issues.push({code:'editorial_generic_reader_task',severity:'warning',slideId:page.id,repairable:true,message:'State the concrete decision/mechanism this page explains, not a generic request to understand its title.'});
  const obligations=explanationObligations(project).filter(o=>o.sourceUnitIds.some(id=>(plan.sourceUnitIds||[]).includes(id)));
  if(new Set(obligations.map(o=>o.id)).size>3)issues.push({code:'editorial_multiple_reader_tasks',severity:'warning',slideId:page.id,repairable:true,message:'Several explanation obligations share this page. Verify an explicit parent task, separate supports and measured readability; do not split automatically.'});
  const priorPlans=plans.filter(p=>p.slideId!==plan.slideId&&p.index<plan.index);
  for(const prior of priorPlans){const ids=plan.sourceUnitIds||[],other=prior.sourceUnitIds||[];if(ids.length&&ids.every(id=>other.includes(id))&&!project.outline?.find(s=>s.id===page.id)?.repeatPurpose)issues.push({code:'editorial_no_incremental_support',severity:'warning',slideId:page.id,slideIds:[prior.slideId,page.id],repairable:true,message:'This page adds no new owned support. Explain its distinct reader task or propose a scoped structure repair; keep confirmed N.'});}
  for(const receipt of page.mediaTasks||[])if(receipt.representationFallback)issues.push({code:'editorial_relation_table_fallback',severity:'warning',slideId:page.id,nodeIds:receipt.nodeIds,sourceUnitIds:receipt.sourceIds,repairable:true,message:'Source relationships remain in a faithful table because of measured capacity or partial scope; relationship visualization is not yet verified.'});
 }
 return issues;
}
