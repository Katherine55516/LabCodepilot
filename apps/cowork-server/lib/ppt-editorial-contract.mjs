import {createHash} from 'node:crypto';
import {normalizeProseMediaEvidence}from'./ppt-prose-media.mjs';
/** A complete reading is not a commitment to print every read source unit.
 * New editorial plans bind only the model's explicit decisions; confirmed and
 * legacy plans retain their historical source contracts. */
export function editorialOwnershipContract(project){
 return Boolean(project?.generationPolicy?.version===2&&project.generationPolicy.content==='overview'&&project.inputUnderstanding?.readManifest?.status==='complete_delivery'&&!project.confirmedOutline&&!project.requestedOutline&&!project.update);
}
/** Source-scoped exclusions remain authorized after confirmation only for the
 * exact ledger that passed the independent complete-group coverage review. */
export function editorialSelectionScope(project){
 return editorialOwnershipContract(project)||Boolean(project?.generationPolicy?.version===2&&project.generationPolicy.content==='overview'&&project.editorialCoverageAcceptance?.status==='accepted'&&project.editorialCoverageAcceptance.sourceHash===project.source?.sha256&&project.editorialCoverageAcceptance.ledgerHash===project.contentSelection?.hash);
}
export function bindEditorialOwners(project,raw){
 if(!editorialOwnershipContract(project)||raw?.version!==2||!Array.isArray(raw.selection)||!Array.isArray(raw.slides))return {raw,corrections:[]};
 const next=structuredClone(raw),corrections=[];
 const items=project.originalSourceInventory?.items||project.source?.semantic?.inventory?.items||[];
 for(const entry of next.selection)if(entry.summaryGraph){const item=items.find(i=>i.id===entry.sourceUnitId);if(item)entry.summaryGraph=normalizeProseMediaEvidence(item,entry.summaryGraph);}
 const conflicts=[];for(const entry of next.selection){if(!['slides','summary'].includes(entry.destination)||entry.primaryPageIndex===undefined)continue;const owners=next.slides.flatMap((s,i)=>(s.sourceUnitIds||[]).includes(entry.sourceUnitId)||(s.sourceArtifactRanges||[]).some(r=>r.sourceUnitId===entry.sourceUnitId)?[i]:[]);if(owners.length&&!owners.includes(entry.primaryPageIndex))conflicts.push({sourceUnitId:entry.sourceUnitId,primaryPageIndex:entry.primaryPageIndex,owningPageIndexes:owners});}
 if(conflicts.length)throw Object.assign(Error('ppt_editorial_ownership_conflict: page declarations disagree; repair only explicit ownership'),{code:'coverage_invalid',outlineContract:true,details:{editorialOwnershipConflicts:conflicts}});
 for(const entry of next.selection){
  if(!['slides','summary'].includes(entry.destination)||entry.primaryPageIndex===undefined)continue;
  const index=entry.primaryPageIndex,slide=next.slides[index];
  if(!Number.isInteger(index)||index<=0||!slide||['cover','navigation'].includes(slide.role))throw Object.assign(Error('ppt_content_selection_invalid: selected source needs an explicit existing content page'),{code:'coverage_invalid',outlineContract:true,details:{sourceUnitId:entry.sourceUnitId,destination:entry.destination,primaryPageIndex:index}});
  const owners=next.slides.flatMap((s,i)=>(s.sourceUnitIds||[]).includes(entry.sourceUnitId)||(s.sourceArtifactRanges||[]).some(r=>r.sourceUnitId===entry.sourceUnitId)?[i]:[]);
  if(owners.length&&!owners.includes(index))throw Object.assign(Error('ppt_content_selection_invalid: explicit page index conflicts with the supplied source ownership'),{code:'coverage_invalid',outlineContract:true,details:{sourceUnitId:entry.sourceUnitId,destination:entry.destination,primaryPageIndex:index,owningPageIndexes:owners}});
  if(!owners.length){slide.sourceUnitIds=[...(slide.sourceUnitIds||[]),entry.sourceUnitId];corrections.push({code:'explicit_editorial_owner_bound',sourceUnitId:entry.sourceUnitId,pageIndex:index,basis:'model supplied primaryPageIndex; no inferred owner or extra selection'});}
 }
 return {raw:next,corrections};
}
export function editorialOwnershipAudit(before,after){
 const ids=raw=>new Set((raw?.slides||[]).flatMap(s=>[...(s.sourceUnitIds||[]),...(s.sourceArtifactRanges||[]).map(r=>r.sourceUnitId)]));
 const a=ids(before),b=ids(after);return {version:1,before:a.size,after:b.size,added:[...b].filter(id=>!a.has(id)),removed:[...a].filter(id=>!b.has(id))};
}

/** Explicit failed-outline retry may reuse a retained, UNVALIDATED candidate.
 * It is never an approval; source, inventory, model, hash and N must match. */
export function retryEditorialCandidate(project){
 if(!editorialOwnershipContract(project)||project.stage!=='outline')return null;
 const candidate=project.candidateOutline,raw=candidate?.executionPlan,hash=value=>createHash('sha256').update(value).digest('hex');
 if(candidate?.accepted||raw?.version!==2||raw.slides?.length!==project.pages||candidate.model!==project.model||candidate.sourceHash!==hash(project.source?.text||project.prompt||'')||candidate.inventoryHash!==hash(JSON.stringify(project.source?.semantic?.inventory||null))||candidate.hash!==hash(JSON.stringify(raw)))return null;
 return structuredClone(raw);
}

export function applyEditorialOwnerRepair(raw,delta,task){
 if(delta?.version!==2||!Array.isArray(delta.assignments)||delta.assignments.length!==task.ids.length||new Set(delta.assignments.map(a=>a.sourceUnitId)).size!==task.ids.length)throw Object.assign(Error('editorial_ownership_delta_invalid'),{code:'schema_invalid',outlineContract:true});
 const next=structuredClone(raw);
 for(const a of delta.assignments){const page=next.slides[a.primaryPageIndex];if(!task.ids.includes(a.sourceUnitId)||!Number.isInteger(a.primaryPageIndex)||a.primaryPageIndex<=0||!page||['cover','navigation'].includes(page.role)||Object.keys(a).some(k=>!['sourceUnitId','primaryPageIndex'].includes(k)))throw Object.assign(Error('editorial_ownership_delta_invalid'),{code:'schema_invalid',outlineContract:true});
  const existing=next.slides.flatMap((s,i)=>s.sourceUnitIds?.includes(a.sourceUnitId)||s.sourceArtifactRanges?.some(r=>r.sourceUnitId===a.sourceUnitId)?[i]:[]);
  if(existing.length>1&&!existing.includes(a.primaryPageIndex))throw Object.assign(Error('editorial_ownership_delta_invalid: preserve table fragment owners'),{code:'schema_invalid',outlineContract:true});
  if(!existing.includes(a.primaryPageIndex)){const ranges=next.slides.flatMap(s=>s.sourceArtifactRanges?.filter(r=>r.sourceUnitId===a.sourceUnitId)||[]);for(const s of next.slides){s.sourceUnitIds=(s.sourceUnitIds||[]).filter(id=>id!==a.sourceUnitId);if(s.sourceArtifactRanges)s.sourceArtifactRanges=s.sourceArtifactRanges.filter(r=>r.sourceUnitId!==a.sourceUnitId);}page.sourceUnitIds=[...(page.sourceUnitIds||[]),a.sourceUnitId];if(ranges.length)page.sourceArtifactRanges=[...(page.sourceArtifactRanges||[]),...ranges];}
  next.selection.find(e=>e.sourceUnitId===a.sourceUnitId).primaryPageIndex=a.primaryPageIndex;
 }
 return next;
}

/** Prompt projection only. Internal validators retain the complete flat rule.
 * Selection permission is distinct from a chosen object's row/claim contract. */
export function editorialPromptRules(project,rules){
 if(!editorialOwnershipContract(project))return rules;
 return rules.map(rule=>{const {sourceUnitId,allowedDestinations,notesWithoutVisibleEquivalentAllowed,visibleEquivalentSourceUnitIds,semanticSummaryRule,...ifSelected}=rule;return{sourceUnitId,allowedDestinations,canBeOmitted:allowedDestinations.includes('excluded'),...(notesWithoutVisibleEquivalentAllowed!==undefined?{mayOmitWithoutSubstitute:notesWithoutVisibleEquivalentAllowed}:{}),...(visibleEquivalentSourceUnitIds?{visibleEquivalentSourceUnitIds}:{}),...(semanticSummaryRule?{summaryFaithfulness:semanticSummaryRule}:{}),ifSelected};});
}

/** A unique locator covering an entire currently projected table is redundant
 * ownership bookkeeping. Partial or repeated ranges are genuine frozen splits. */
export function wholeEditorialTableRanges(project,raw){
 const ranges=raw.slides.flatMap((slide,pageIndex)=>(slide.sourceArtifactRanges||[]).map(range=>({pageIndex,range}))),items=project.source?.semantic?.inventory?.items||[];
 if(ranges.some(({pageIndex,range})=>{const item=items.find(i=>i.id===range.sourceUnitId);return !item?.rows||range.rowStart!==1||range.rowEnd!==item.rows.length||Object.keys(range).some(k=>!['sourceUnitId','rowStart','rowEnd'].includes(k))||!raw.slides[pageIndex].sourceUnitIds?.includes(item.id)||raw.slides.filter(s=>s.sourceUnitIds?.includes(item.id)).length!==1||ranges.filter(r=>r.range.sourceUnitId===item.id).length!==1;}))return null;
 return ranges;
}
