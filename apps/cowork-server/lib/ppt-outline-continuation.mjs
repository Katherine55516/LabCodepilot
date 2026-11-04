import {digest} from './ppt/edit-context.mjs';
import {assertPagePreference,outlineFirst,pagePreference} from './ppt-outline-first.mjs';
import {assertRemediationStep} from './ppt-remediation-ladder.mjs';
const invalid=message=>Object.assign(Error(message),{code:'capacity_continuation_invalid',outlineContract:true});
/** A capacity request changes only one unlocked reader task. Text and selected
 * facts stay frozen; complete tables may continue over exact row ranges. */
export function continuationTask(p,raw,index,issues=[]){
 if(!outlineFirst(p)||p.planningContract.pagePreference?.mode!=='adaptive'||index<1)return null;
 const page=raw.slides[index],max=Math.min(3,p.planningContract.pagePreference.max-raw.slides.length+1);
 if(!page||max<2||page.userLocked||p.deck?.slides?.find(s=>s.id===page.id)?.locked||p.editing?.epochs?.[page.id])return null;
 const cards=p.planningContract.logicalCards||[],owners=cards.filter(c=>[...c.sourceUnitIds,...c.optionalSourceUnitIds].some(id=>page.sourceUnitIds?.includes(id)));
 if(owners.length!==1||owners[0].locked)return null;
 const ids=page.sourceUnitIds||[],items=(p.source?.semantic?.inventory?.items||[]).filter(i=>ids.includes(i.id));
 if(ids.length<2&&!items.some(i=>i.rows?.length>2))return null;
 const schema={type:'object',additionalProperties:false,required:['reason','pages'],properties:{reason:{type:'string',minLength:1,maxLength:600},pages:{type:'array',minItems:2,maxItems:max,items:{type:'object',additionalProperties:false,required:['title','focus','sourceUnitIds','sourceArtifactRanges'],properties:{title:{type:'string',minLength:1,maxLength:160},focus:{type:'string',minLength:1,maxLength:360},sourceUnitIds:{type:'array',minItems:1,items:{type:'string',enum:ids}},sourceArtifactRanges:{type:'array',items:{type:'object',additionalProperties:false,required:['sourceUnitId','rowStart','rowEnd'],properties:{sourceUnitId:{type:'string',enum:items.filter(i=>i.rows).map(i=>i.id)},rowStart:{type:'integer',minimum:1},rowEnd:{type:'integer',minimum:2}}}}}}}}};
 if(!items.some(i=>i.rows))schema.properties.pages.items.properties.sourceArtifactRanges={type:'array',maxItems:0,items:{type:'object'}};
 return{index,pageId:page.id,rawHash:digest(raw),max,ids,items,logicalCardId:owners[0].id,schema,prompt:'Repair ONLY this overflowing physical task by meaningful continuation pages. Do not rewrite or delete any approved words, facts, comparison members or conditions. Assign each source exactly once; only a table may repeat across pages with nonoverlapping rowStart inclusive / rowEnd exclusive ranges, covering precisely its existing selected rows. Header repetition is allowed. Preserve bilingual pairs together and formulas with their definitions. Each page needs a distinct incremental purpose and real owned content. Extra pages alone do not fix an indivisible oversized row. No fillers or notes. Return JSON.\n'+JSON.stringify({page,selectedMaterial:items,issues,authorizedMaximum:p.planningContract.pagePreference.max,maximumReplacementPages:max,existingTasks:raw.slides.map(s=>({id:s.id,title:s.title,focus:s.focus})),template:p.templateSpec})+'\nSchema='+JSON.stringify(schema)};
}
export function applyContinuation(p,raw,reply,task){
 if(digest(raw)!==task.rawHash)throw invalid('Stale continuation basis.');
 if(!reply||Object.keys(reply).some(k=>!['reason','pages'].includes(k))||typeof reply.reason!=='string'||!reply.reason.trim()||reply.reason.length>600||!Array.isArray(reply.pages)||reply.pages.length<2||reply.pages.length>task.max)throw invalid('Invalid continuation response.');
 const titles=new Set(),focus=new Set(),byId=new Map(task.items.map(i=>[i.id,i])),occurrences=new Map();
 for(const page of reply.pages){
  if(!page||Object.keys(page).some(k=>!['title','focus','sourceUnitIds','sourceArtifactRanges'].includes(k))||typeof page.title!=='string'||!page.title.trim()||page.title.length>160||typeof page.focus!=='string'||!page.focus.trim()||page.focus.length>360||titles.has(page.title)||focus.has(page.focus)||!Array.isArray(page.sourceUnitIds)||!page.sourceUnitIds.length||new Set(page.sourceUnitIds).size!==page.sourceUnitIds.length||!Array.isArray(page.sourceArtifactRanges))throw invalid('Continuation needs distinct, nonempty reader tasks.');
  titles.add(page.title);focus.add(page.focus);
  for(const range of page.sourceArtifactRanges)if(!range||Object.keys(range).some(k=>!['sourceUnitId','rowStart','rowEnd'].includes(k))||!page.sourceUnitIds.includes(range.sourceUnitId)||!byId.get(range.sourceUnitId)?.rows||!Number.isInteger(range.rowStart)||!Number.isInteger(range.rowEnd)||range.rowStart<1||range.rowStart>=range.rowEnd||range.rowEnd>byId.get(range.sourceUnitId).rows.length)throw invalid('Invalid table continuation range.');
  for(const id of page.sourceUnitIds){if(!task.ids.includes(id))throw invalid('Continuation borrowed outside source.');occurrences.set(id,[...(occurrences.get(id)||[]),page]);}
 }
 for(const id of task.ids){const pages=occurrences.get(id)||[];if(!pages.length)throw invalid('Continuation omitted approved content.');const item=byId.get(id),oldRanges=raw.slides[task.index].sourceArtifactRanges?.filter(r=>r.sourceUnitId===id)||[];
  if(!item?.rows){if(pages.length!==1||pages[0].sourceArtifactRanges.some(r=>r.sourceUnitId===id))throw invalid('Only tables support explicit continuation fragments.');continue;}
  const expected=new Set((oldRanges.length?oldRanges:[{rowStart:1,rowEnd:item.rows.length}]).flatMap(r=>Array.from({length:r.rowEnd-r.rowStart},(_,i)=>r.rowStart+i))),seen=new Set();
  for(const page of pages){const ranges=page.sourceArtifactRanges.filter(r=>r.sourceUnitId===id);if(pages.length>1&&!ranges.length)throw invalid('Repeated table needs exact ranges.');for(const r of ranges.length?ranges:[{rowStart:1,rowEnd:item.rows.length}])for(let n=r.rowStart;n<r.rowEnd;n++){if(!expected.has(n)||seen.has(n))throw invalid('Table rows overlap or escape the approved selection.');seen.add(n);}}
  if(seen.size!==expected.size)throw invalid('Table continuation dropped rows.');
 }
 const pairs=new Map();for(const item of task.items)if(item.languagePairId){const places=(occurrences.get(item.id)||[]).map(page=>reply.pages.indexOf(page));const key=JSON.stringify(places);if(pairs.has(item.languagePairId)&&pairs.get(item.languagePairId)!==key)throw invalid('Continuation split a bilingual pair.');pairs.set(item.languagePairId,key);}
 const next=structuredClone(raw),original=raw.slides[task.index];
 const replacements=reply.pages.map((page,i)=>{const result={...original,...page,id:i?'page_'+digest({parent:original.id,focus:page.focus,ids:page.sourceUnitIds,ranges:page.sourceArtifactRanges}).slice(0,20):original.id};for(const key of ['titleSecondary','titlePair','pageContract','densityFit'])delete result[key];return result;});
 next.slides.splice(task.index,1,...replacements);assertPagePreference(p,next.slides.length);
 // Ladder rung 3: same source content, more pages, within the authorization.
 {const pref=pagePreference(p.planningContract.pagePreference);try{assertRemediationStep('continue',{before:raw.slides,after:next.slides,pagesAuthorized:pref.mode==='fixed'?pref.exact:pref.max});}catch(error){throw invalid(error.message);}}
 for(const entry of next.selection||[]){if(entry.primaryPageIndex>task.index)entry.primaryPageIndex+=replacements.length-1;else if(entry.primaryPageIndex===task.index)entry.primaryPageIndex=task.index+replacements.findIndex(s=>s.sourceUnitIds.includes(entry.sourceUnitId));}
 return{raw:next,change:{from:raw.slides.length,to:next.slides.length,reason:reply.reason,logicalCardId:task.logicalCardId,replacedPageId:original.id,pageIds:replacements.map(s=>s.id),beforeSourceIds:task.ids,afterSourceIds:[...new Set(replacements.flatMap(s=>s.sourceUnitIds))]}};
}

export function continuationRevision(p){return digest({source:p.source?.sha256,run:p.currentRunId,revision:p.revision,plan:p.planRevision,outline:p.outline,epochs:p.editing?.epochs,selection:p.contentSelection?.hash,preference:p.planningContract?.pagePreference});}
/** Called inside the project queue after native and semantic preflight. No
 * writer can commit against the old run/epoch after this atomic replacement. */
export function commitContinuation(current,prepared,change,expected){
 if(current.status!=='generating'||current.runtime?.pauseRequested||continuationRevision(current)!==expected)throw invalid('Continuation revision changed before commit.');
 assertPagePreference(current,prepared.outline.length);
 const affected=new Set(change.pageIds),next=structuredClone(current),prior=new Map(current.outline.map(s=>[s.id,s]));
 for(const page of prepared.outline)if(!affected.has(page.id)&&digest(page)!==digest(prior.get(page.id)))throw invalid('Continuation changed an unaffected page.');
 if(current.outline.some(s=>!prepared.outline.some(n=>n.id===s.id)))throw invalid('Continuation removed an existing page identity.');
 next.outline=prepared.outline;next.pages=prepared.outline.length;next.planning=prepared.planning;next.templateFidelity=prepared.templateFidelity;next.contentSelection=prepared.contentSelection;
 next.editing={...next.editing,epochs:{...next.editing?.epochs}};next.runtime={...next.runtime,slides:{...next.runtime?.slides}};next.nodes={...next.nodes};
 for(const id of affected){
  next.editing.epochs[id]=Number(next.editing.epochs[id]||0)+1;next.nodes[id]={status:'pending',attempts:0};delete next.runtime.slides[id];
  for(const stage of ['source','content','layout','preview','quality']){
   const key=`${stage}:${id}`,trace=next.trace?.stages?.[key];
   if(trace?.status==='failed')next.runtime.capacityFailureHistory=[...(next.runtime.capacityFailureHistory||[]),{...trace,slideId:id,resolvedBy:'capacity-replan',resolvedAt:new Date().toISOString()}].slice(-100);
   if(trace)next.trace.stages[key]={...trace,status:'pending',error:null,start_time:null,end_time:null,duration:null};
   if(next.dagNodes?.[key])next.dagNodes[key]={...next.dagNodes[key],status:'pending',error:null,startedAt:null,completedAt:null,updatedAt:new Date().toISOString()};
  }
 }
 next.revision=Number(next.revision||0)+1;next.planningContract={...next.planningContract,changes:[...(next.planningContract.changes||[]),change],actualPageIds:next.outline.map(s=>s.id),generationContinuations:Number(next.planningContract.generationContinuations||0)+1};
 next.quality={...next.quality,exportable:false,publishEligible:false,reviewState:'stale'};
 delete next.navigationPlan;delete next.navigationDraft;delete next.exportManifest;
 return next;
}
