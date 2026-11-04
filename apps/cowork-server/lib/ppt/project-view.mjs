import {projectVersionDetails} from '../ppt-provenance.mjs';
import {planningView,outlineFirst} from '../ppt-outline-first.mjs';
import {digest,editableCapabilities} from './edit-context.mjs';
import {currentPageReassessment} from '../ppt-page-reassessment.mjs';
export function settingsReceipt(project){const values={detail:outlineFirst(project)?project.planningContract.contentMode:project.generationPolicy?.detail,content:project.generationPolicy?.content,language:project.generationPolicy?.language,knowledge:project.generationPolicy?.knowledge,code:project.generationPolicy?.code,executionStrategy:project.executionPolicy?.qualityLevel||'balanced',template:project.template,recommended:project.inputUnderstanding?.recommended,confirmedPages:project.pageDecision?.finalPageCount??null,sourceIdentity:project.inputUnderstanding?.sourceIdentity};return {version:1,hash:digest(values),...values,basis:'persisted_project',exportGate:'same_hard_gates'};}
import {llmPageRecommendation} from '../ppt-page-floor.mjs';
import {sourceWarningView} from '../ppt-source-readiness.mjs';
import {presentationPageCounts,presentationTimeline} from '../ppt-page-counts.mjs';
import {pptModelJobs} from '../ppt-model-jobs.mjs';
import {draftsFor} from './draft-store.mjs';
import {buildTemplateSkeleton} from './generation-skeleton.mjs';
import {libraryEligible,taskEligible,countsAgainstLibraryQuota} from '../ppt-library.mjs';
import {reviewAdvisoryView} from './review-advisories.mjs';
/** Account-scoped projections; source/checkpoints stay in the repository. */
const meta=['id','qualityBlockReason','title','pages','status','stage','error','failure','model','configId','inputKind','createdAt','updatedAt','revision','publishedRevision','currentRunId','favorite','pinned','tags','folderId','deletedAt','taskDeletedAt','presentationDeletedPermanentlyAt','taskRecordOnly','template','manualOrder','pageDecision','version','executionPolicy','generationPolicy','outlineAcceptance','templateContentMode','templateFixedObjectIds','renderUpgradePending'];
/** Structure execution plans contain the entire deck and native frames. Keep
 * those authoritative bytes in the repository; the editor confirms by id. */
export function liveProposalView(proposal){
 if(!proposal?.structureChange)return proposal;
 const {commands,snapshots,...view}=proposal;
 return view;
}
export function currentSlidePreview(project,id){
 const state=project.runtime?.slides?.[id];if(!state?.preview)return null;
 if(Number(state.epoch||0)!==Number(project.editing?.epochs?.[id]||0))return null;
 const partial=state.componentCommit;
 if(partial&&partial.runId===project.currentRunId&&partial.sourceHash===project.source?.sha256&&partial.baseRevision===project.revision&&partial.renderHash===state.renderHash)return state.preview;
 if(project.nodes?.[id]?.slide)return state.preview;
 if(project.status==='completed'&&project.renderTree?.slides?.some(s=>(s.slideId||s.id)===id))return state.preview;
 return null;
}
export function taskSummary(project){
 if(project.taskRecordOnly)return {...project,uid:undefined,libraryEligible:false,taskEligible:taskEligible(project)};
 const result=Object.fromEntries(meta.filter(k=>project[k]!==undefined).map(k=>[k,project[k]]));
 if(outlineFirst(project))result.planningPhase=project.planningContract.phase;
 result.libraryEligible=libraryEligible(project);result.taskEligible=taskEligible(project);result.libraryReserved=countsAgainstLibraryQuota(project);result.coverAvailable=Boolean(result.libraryEligible&&(project.publishedRenderTree?.slides?.[0]?.elements?.length||project.status==='completed'&&project.renderTree?.slides?.[0]?.elements?.length));result.pageCounts=presentationPageCounts(project);result.timeline=presentationTimeline(project);
 const client=pptModelJobs.state(project.uid,project.id);
 result.displayStatus=['outlining','generating'].includes(project.status)&&client.pending&&!client.leased&&Date.now()-client.lastSeen>20000?'waiting_client':project.status;
 const ids=(project.outline||[]).map(s=>s.id),done=id=>['done','completed'].includes(project.nodes?.[id]?.status);
 result.progress={contentReady:ids.filter(done).length,previewReady:ids.filter(id=>currentSlidePreview(project,id)&&['render_ready','validated'].includes(project.runtime.slides[id].phase)&&(done(id)||project.status==='completed')).length,total:project.outline?.length||project.pages||0,phase:project.stage,quality:project.quality?.status||'pending',lastUpdated:project.updatedAt};
 // V-P1-5/7: Home shows a user-facing stage and the page being worked on,
 // never internal node IDs such as review:deck or quality:slide_….
 if(['outlining','generating','paused'].includes(project.status)){
  const stages=generationStages(project);result.deckStage=stages.deck;
  const index=(project.outline||[]).findIndex(slide=>!['ready'].includes(stages.pages[slide.id]));
  if(index>=0)result.currentPage={index:index+1,title:String(project.outline[index].title||'').slice(0,80),stage:stages.pages[project.outline[index].id]};
 }
 result.outline=(project.outline||[]).slice(0,1).map(({title})=>({title}));
 result.deck=project.deck?{slides:project.deck.slides.slice(0,1).map(({title})=>({title}))}:null;
 return result;
}
const sizeOf=p=>p.renderTree?.size||{width:p.templateFidelity?.width||12192000,height:p.templateFidelity?.height||6858000};
function leanSlide(project,slide){
 return {...slide,elements:(slide.elements||[]).map(element=>{
  if(element.kind!=='image'||!element.content?.dataUrl?.startsWith('data:'))return element;
  return {...element,content:{...element.content,dataUrl:`/api/ppt/projects/${project.id}/slides/${slide.slideId||slide.id}/assets/${element.nodeId||element.id}?v=${project.revision}`}};
 })};
}
/** User-facing generation progress (V-P1-5/6): one stage per page and one for
 * the deck, derived from the real DAG/runtime state, never a timer. */
export function generationStages(project){
 const dag=project.dagNodes||{},running=key=>dag[key]?.status==='running';
 const pages=Object.fromEntries((project.outline||[]).map(slide=>{
  const id=slide.id,runtime=project.runtime?.slides?.[id],node=project.nodes?.[id];
  const preview=currentSlidePreview(project,id),repairing=preview&&['render_ready','validated'].includes(runtime?.phase)&&(running('layout:'+id)||running('preview:'+id)||node?.status==='running');
  const stage=repairing?'repairing':['render_ready','validated'].includes(runtime?.phase)&&preview?'ready':running('quality:'+id)?'validating':running('preview:'+id)?'previewing':running('layout:'+id)?'layout':node?.status==='running'?'writing':running('source:'+id)?'retrieving':node?.status==='failed'?'failed':'waiting';
  return [id,stage];
 }));
 const deck=running('publish:deck')?'publishing':Object.keys(dag).some(key=>/^review:deck/.test(key)&&dag[key]?.status==='running')||running('quality')||running('review')?'reviewing':running('repair')?'repairing':project.status==='outlining'?'outlining':project.status==='generating'?'writing':project.status;
 return {deck,pages};
}
/** Project responses never revive the old code-calibrated recommendation.
 * This projection is pure: published decks and stored checkpoints stay intact. */
export function readingPlanningView(project){
 const read=llmPageRecommendation(project);if(!read)return {};
 return {pageBudget:{version:2,authority:'llm_reading',mode:project.pageDecision?.mode||'auto',recommended:read.recommended,range:{min:read.min,max:read.max},reason:read.reason,...(project.pageDecision?.mode==='explicit'?{requested:project.pages}:{})},planning:{...project.planning,pageRecommendation:{...project.planning?.pageRecommendation,recommended:read.recommended,range:[read.min,read.max],reason:read.reason,reasonBase:read.reason,selected:project.pages,compressionRisk:Number(project.pages)<read.min,feasibleWithoutCompression:Number(project.pages)>=read.min,provisional:false,estimationBasis:'agent_read_complete_input'}}};
}
/** A project's template fidelity as a read returns it by default (Fable D5,
 * 2026-11-01: a 3186 GET was 31-35 MB, 20 MB of it the template's slides,
 * source catalog and component profile). The small fields stay, the three
 * large ones become counts; ?include=templateFidelity returns them whole. */
const HEAVY_FIDELITY=Object.freeze(['slides','sourceCatalog','componentProfile']);
export function templateFidelitySummary(fidelity){
 if(!fidelity||typeof fidelity!=='object')return fidelity;
 const summary=Object.fromEntries(Object.entries(fidelity).filter(([key])=>!HEAVY_FIDELITY.includes(key)));
 const count=value=>Array.isArray(value)?value.length:value&&typeof value==='object'?Object.keys(value).length:0;
 return {...summary,summary:true,counts:Object.fromEntries(HEAVY_FIDELITY.map(key=>[key,count(fidelity[key])]))};
}
export function liveProjectView(project){
 const size=sizeOf(project),generating=['generating','paused'].includes(project.status)||project.status==='failed'&&project.stage==='generation'&&(project.outline||[]).some(s=>currentSlidePreview(project,s.id));
 const outline=project.outline||[];
 const trees=generating?outline.map((s,index)=>currentSlidePreview(project,s.id)||{id:s.id,slideId:s.id,index,size,elements:[]}):project.renderTree?.slides||[];
 const ready=new Set(trees.filter(s=>s.elements.length).map(s=>s.slideId||s.id));
 const deckSlides=(generating?outline.map(o=>project.deck?.slides?.find(s=>s.id===o.id)||project.runtime?.slides?.[o.id]?.canonicalSlide||project.nodes?.[o.id]?.slide||{id:o.id,title:o.title,nodes:[]}):project.deck?.slides||[]).map(s=>({id:s.id,title:s.title,layout:s.layout,section:s.section,sourceRefs:s.sourceRefs,...(s.speakerNotes?{speakerNotes:s.speakerNotes}:{}),nodes:ready.has(s.id)||!generating?(s.nodes||[]).map(n=>({...n,content:n.type==='image'?{...n.content,dataUrl:undefined}:n.content})):[]}));
 const stages=generationStages(project),projection=readingPlanningView(project);
 const pageBudget=projection.pageBudget||project.pageBudget;
 const recommendation=projection.planning?.pageRecommendation||project.planning?.pageRecommendation;
 return {...taskSummary(project),versionDetails:projectVersionDetails(project),publishedRenderContractVersion:project.publishedRenderTree?.renderContractVersion??(project.quality?.exportVerification?.revision===project.publishedRevision?project.quality?.exportVerification?.renderContractVersion:undefined),planningContract:planningView(project),prompt:'',settingsReceipt:settingsReceipt(project),generationPolicy:project.generationPolicy,promptContractVersion:project.promptContractVersion,quality:project.quality?{status:project.quality.status,exportVerification:project.quality.exportVerification,reviewState:project.quality.reviewState,deterministic:project.quality.deterministic||{hardErrors:0,issues:[]},modelReview:project.quality.modelReview?{evaluation:project.quality.modelReview.evaluation,...Object.fromEntries(['missing','repeated','conflicts','unsupported'].map(key=>[key,project.quality.modelReview[key]||[]]))}:null,repairs:project.quality.repairs||[],mediaLedger:project.quality.mediaLedger,exportable:project.quality.exportable,publishEligible:project.quality.publishEligible,visualVerified:project.quality.visualVerified,renderedTextVerified:project.quality.renderedTextVerified,acceptanceAxes:project.quality.acceptanceAxes,report:project.quality.report,issueGroups:project.quality.issueGroups,...reviewAdvisoryView(project)}:undefined,outline,generationStages:stages,drafts:generating?draftsFor(project.id,outline.filter(s=>stages.pages[s.id]==='writing'||project.status==='paused'&&s.id===outline.find(item=>!ready.has(item.id)&&!item.manualBlank)?.id).map(s=>s.id),project):{},deck:project.deck||generating?{...project.deck,slides:deckSlides}:null,
  // Gamma page by page (round 7, A2/A7): only the page being written gets a
  // structure skeleton; later pages are listed by title, not drawn.
  generationSkeletons:generating?Object.fromEntries(outline.filter(s=>!ready.has(s.id)&&!s.manualBlank).slice(0,1).map(s=>[s.id,buildTemplateSkeleton(project,s.id)]).filter(([,scene])=>scene).map(([id,scene])=>[id,leanSlide(project,scene)])):{},
  generationMedia:generating?Object.fromEntries(outline.filter(s=>!ready.has(s.id)&&!s.manualBlank).slice(0,1).map(s=>[s.id,(s.sourceImageIds||[]).flatMap(id=>{const image=project.source?.images?.find(item=>item.id===id);return image&&Number.isFinite(image.width)&&image.width>0&&Number.isFinite(image.height)&&image.height>0?[{id,caption:String(image.caption||image.alt||'').slice(0,1000),width:image.width,height:image.height}]:[];})])):{},
  outlineProgress:project.outlineBatchTotal?{done:project.outlineBatches?.length||0,total:project.outlineBatchTotal}:undefined,
  // The card outline as it forms (P1/P2, 2026-10-31); only for the current outline request.
  outlineForming:project.status==='outlining'&&project.outlineForming?.revision===project.planningContract?.requestRevision?project.outlineForming:undefined,
  runtimeWarnings:project.runtimeWarnings?.length?project.runtimeWarnings:undefined,
  sourceAssets:project.source?.images?.map(image=>({id:image.id,caption:image.caption||image.fileName||image.id,width:image.width,height:image.height,required:Boolean(image.required||image.mustPreserve),slideIds:(project.outline||[]).filter(slide=>slide.sourceImageIds?.includes(image.id)).map(slide=>slide.id)})),sourceMediaWarnings:sourceWarningView(project),executionHistory:project.executionHistory?.slice(-100),postWriterPlan:project.postWriterPlan,contentSelection:outlineFirst(project)&&project.contentSelection?{...project.contentSelection,entries:project.contentSelection.entries.map(entry=>({...entry,sourceExcerpt:(project.originalSourceInventory?.items||project.source?.semantic?.inventory?.items||[]).find(item=>item.id===entry.sourceUnitId)?.text?.slice(0,1200)}))}:project.contentSelection,planning:recommendation?{pageRecommendation:recommendation}:undefined,candidateOutline:!outlineFirst(project)&&project.candidateOutline?{...project.candidateOutline,executionPlan:undefined}:undefined,outlineAcceptance:project.outlineAcceptance,outlineCorrections:project.outlineCorrections,outlineCapacityDiagnostic:project.outlineCapacityDiagnostic,pageBudgetConflict:project.pageBudgetConflict,modelUsage:project.modelUsage?.slice(-1),source:(['input_ready','outline_ready'].includes(project.status)||project.status==='failed'&&project.stage==='outline'&&!project.confirmedOutline)?{text:project.source?.text,segments:project.source?.segments||[],truncated:project.source?.truncated}:undefined,template:project.template,templateSpec:project.templateSpec,externalPptx:project.externalPptx?{mode:'preserve'}:undefined,
  templateFidelity:project.templateFidelity?{mode:project.templateFidelity.mode,slides:[]}:undefined,
  // What local AI edits may change on this deck (the editor gates relayout on it; Fable 2026-11-01).
  editCapabilities:{relayout:editableCapabilities(project).relayout},
  nodes:Object.fromEntries(Object.entries(project.nodes||{}).map(([id,n])=>[id,{status:n.status,attempts:n.attempts,epoch:n.epoch}])),
  inputUnderstanding:project.inputUnderstanding?{sourceIssues:project.inputUnderstanding.sourceIssues||[],recommended:project.inputUnderstanding.recommended,min:project.inputUnderstanding.min,max:project.inputUnderstanding.max,reason:project.inputUnderstanding.reason,basis:project.inputUnderstanding.basis,sourceIdentity:project.inputUnderstanding.sourceIdentity,primaryLanguage:project.inputUnderstanding.primaryLanguage}:undefined,pageBudget,pageReassessment:currentPageReassessment(project)||undefined,
  editing:project.editing?{contentOpen:project.editing.contentOpen,epochs:project.editing.epochs,conversationVersion:JSON.stringify(Object.values(project.editing.intents||{}).map(item=>[item.id,item.status,item.perSlideResults])),intents:{}}:undefined,
  requirements:project.requirements?.map(({id,text,scope,phase,at})=>({id,text,scope,phase,at})),
  runtime:project.runtime?{lifecycle:project.runtime.lifecycle,pauseRequested:project.runtime.pauseRequested,resumePhase:project.runtime.resumePhase,slides:Object.fromEntries(outline.map(({id})=>{const {canonicalSlide,...s}=project.runtime.slides?.[id]||{},preview=currentSlidePreview(project,id);return [id,{...s,...(!preview&&['render_ready','validated'].includes(s.phase)?{phase:'queued'}:{}),preview:preview?{available:true}:undefined}];}))}:undefined,
  renderTree:{...(project.renderTree||{}),schemaVersion:3,units:'emu',deckId:project.deck?.deckId||project.id,size,hash:project.renderTree?.hash||String(project.revision),slides:trees.map(s=>leanSlide(project,s))}};
}
