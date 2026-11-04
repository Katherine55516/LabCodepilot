import {visibleNodes} from './ppt-visible-content.mjs';
import {digest} from './ppt/edit-context.mjs';
const TYPES=['composition','sequence','parallel','comparison','condition','branch','interval','cycle','dependency'];
// Array uniqueness is validated locally below. Qwen rejects uniqueItems in
// its structured-output schema, before reading any input.
export const obligationSchema=id=>({type:'array',maxItems:60,items:{type:'object',additionalProperties:false,required:['label','sourceUnitIds','triggerSourceUnitIds','relationType','placement','evidence'],properties:{label:{type:'string',minLength:1,maxLength:300},sourceUnitIds:{type:'array',minItems:1,items:id},triggerSourceUnitIds:{type:'array',minItems:1,items:id},relationType:{type:'string',enum:TYPES},placement:{type:'string',enum:['same_page','linked_pages']},evidence:{type:'array',minItems:1,items:{type:'object',additionalProperties:false,required:['sourceUnitId','quote'],properties:{sourceUnitId:id,quote:{type:'string',minLength:1,maxLength:2000},start:{type:'integer',minimum:0},end:{type:'integer',minimum:1}}}}}}});

/** Derived contracts cite the immutable original. No inferred causal edges,
 * second page estimate or keyword-based mandatory formula inventory. */
export function obligationProblems(project,values){
 if(values===undefined)return []; // Legacy readings remain explicitly unreviewed.
 if(!Array.isArray(values)||values.length>60)return ['explanationObligations must be an array of at most 60 contracts'];
 const items=project.originalSourceInventory?.items||project.source?.semantic?.inventory?.items||[],known=new Map(items.map(i=>[i.id,i]));
 return values.flatMap((o,index)=>{
  const bad=[];
  if(!o?.label||o.label.length>300||!TYPES.includes(o.relationType)||!['same_page','linked_pages'].includes(o.placement))bad.push('label, relationType or placement');
  if(!Array.isArray(o?.sourceUnitIds)||!o.sourceUnitIds.length||o.sourceUnitIds.some(id=>!known.has(id))||new Set(o.sourceUnitIds).size!==o.sourceUnitIds.length)bad.push('sourceUnitIds');
  if(!Array.isArray(o?.triggerSourceUnitIds)||!o.triggerSourceUnitIds.length||o.triggerSourceUnitIds.some(id=>!known.has(id))||new Set(o.triggerSourceUnitIds).size!==o.triggerSourceUnitIds.length)bad.push('triggerSourceUnitIds');
  if(!Array.isArray(o?.evidence)||!o.evidence.length||o.evidence.some(ref=>!known.has(ref.sourceUnitId)||!Number.isInteger(ref.start)||!Number.isInteger(ref.end)||ref.start<0||ref.end<=ref.start||!ref.quote||known.get(ref.sourceUnitId)?.text?.slice(ref.start,ref.end)!==ref.quote)||o.sourceUnitIds?.some(id=>!o.evidence?.some(ref=>ref.sourceUnitId===id)))bad.push('exact UTF-16 evidence for every required participant');
  return bad.length?[`explanationObligations[${index}] invalid ${bad.join(', ')}`]:[];
 });
}
export function explanationObligations(project){
 const values=project.inputUnderstanding?.explanationObligations;
 if(obligationProblems(project,values).length)return [];
 return (values||[]).map(o=>({...o,id:'obligation_'+digest({source:project.source?.sha256,contract:o}).slice(0,24)}));
}
export function obligationCoverage(project,raw){
 const entries=raw?.selection||project.contentSelection?.entries||[],slides=raw?.slides||project.outline||[];
 const alias=id=>entries.find(e=>e.sourceUnitId===id)?.visibleEquivalentSourceUnitId||id;
 const owners=id=>slides.filter(s=>(s.sourceUnitIds||[]).includes(alias(id))||(s.sourceArtifactRanges||[]).some(r=>r.sourceUnitId===alias(id)));
 return explanationObligations(project).map(o=>{
  const active=o.triggerSourceUnitIds.some(id=>owners(id).length),missing=o.sourceUnitIds.filter(id=>!owners(id).length);
  const shared=slides.filter(s=>o.sourceUnitIds.every(id=>owners(id).includes(s)));
  const split=active&&!missing.length&&o.placement==='same_page'&&!shared.length;
  return {...o,active,status:!active?'outside_selected_scope':missing.length||split?'incomplete':'planned',missingSourceUnitIds:missing,split,ownerSlideIds:[...new Set(o.sourceUnitIds.flatMap(id=>owners(id).map(s=>s.id).filter(Boolean)))],ownerPageIndexes:[...new Set(o.sourceUnitIds.flatMap(id=>owners(id).map(s=>slides.indexOf(s))))]};
 });
}
export function obligationSelectionIssues(project,raw){
 return obligationCoverage(project,raw).filter(o=>o.status==='incomplete').map(o=>({code:'explanation_obligation_incomplete',severity:'error',repairable:true,message:`${o.label}: retain the sourced participants/conditions and their ${o.relationType} relationship${o.split?' together on one page':''}; repair only its owning pages within the confirmed N.`,details:{obligationId:o.id,sourceUnitIds:o.sourceUnitIds,missingSourceUnitIds:o.missingSourceUnitIds,ownerPageIndexes:o.ownerPageIndexes,split:o.split,evidence:o.evidence}}));
}
export function obligationDiagnostics(project,slides){
 const plans=project.planning?.slidePlan||[],coverage=obligationCoverage(project),issues=obligationSelectionIssues(project);
 for(const o of coverage.filter(o=>o.active&&!o.missingSourceUnitIds.length)){
  const alias=id=>project.contentSelection?.entries?.find(e=>e.sourceUnitId===id)?.visibleEquivalentSourceUnitId||id;
  const owners=plans.filter(p=>o.sourceUnitIds.some(id=>(p.sourceUnitIds||[]).includes(alias(id))));
  const present=o.sourceUnitIds.every(id=>slides.some(s=>visibleNodes(s).some(n=>n.sourceArtifact?.sourceUnitId===alias(id)||(n.content?.obligationSourceIds||[]).includes(alias(id)))));
  if(owners.length&&slides.some(s=>owners.some(p=>p.slideId===s.id))&&!present)issues.push({code:'explanation_obligation_not_visible',severity:'error',repairable:true,slideId:owners[0].slideId,message:`Required explanation is not visibly bound: ${o.label}`,details:{obligationId:o.id,sourceUnitIds:o.sourceUnitIds}});
 }
 return {issues,metrics:{explanationObligationReview:project.inputUnderstanding?.explanationObligations===undefined?'not_evaluated':'source_contracts_checked',explanationObligations:coverage}};
}
