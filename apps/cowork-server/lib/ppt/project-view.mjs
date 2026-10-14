import {presentationPageCounts,presentationTimeline} from '../ppt-page-counts.mjs';
import {pptModelJobs} from '../ppt-model-jobs.mjs';
import {draftsFor} from './draft-store.mjs';
import {buildTemplateSkeleton} from './generation-skeleton.mjs';
import {libraryEligible,taskEligible} from '../ppt-library.mjs';
/** Account-scoped projections; source/checkpoints stay in the repository. */
const meta=['id','title','pages','status','stage','error','failure','model','configId','inputKind','createdAt','updatedAt','revision','publishedRevision','currentRunId','favorite','pinned','tags','folderId','deletedAt','manualOrder','pageDecision','version'];
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
 const result=Object.fromEntries(meta.filter(k=>project[k]!==undefined).map(k=>[k,project[k]]));
 result.libraryEligible=libraryEligible(project);result.taskEligible=taskEligible(project);result.pageCounts=presentationPageCounts(project);result.timeline=presentationTimeline(project);
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
export function liveProjectView(project){
 const size=sizeOf(project),generating=['generating','paused'].includes(project.status)||project.status==='failed'&&project.stage==='generation'&&(project.outline||[]).some(s=>currentSlidePreview(project,s.id));
 const outline=project.outline||[];
 const trees=generating?outline.map((s,index)=>currentSlidePreview(project,s.id)||{id:s.id,slideId:s.id,index,size,elements:[]}):project.renderTree?.slides||[];
 const ready=new Set(trees.filter(s=>s.elements.length).map(s=>s.slideId||s.id));
 const deckSlides=(generating?outline.map(o=>project.deck?.slides?.find(s=>s.id===o.id)||project.runtime?.slides?.[o.id]?.canonicalSlide||project.nodes?.[o.id]?.slide||{id:o.id,title:o.title,nodes:[]}):project.deck?.slides||[]).map(s=>({id:s.id,title:s.title,layout:s.layout,section:s.section,sourceRefs:s.sourceRefs,nodes:ready.has(s.id)||!generating?(s.nodes||[]).map(n=>({...n,content:n.type==='image'?{...n.content,dataUrl:undefined}:n.content})):[]}));
 const stages=generationStages(project);
 return {...taskSummary(project),prompt:'',generationPolicy:project.generationPolicy,promptContractVersion:project.promptContractVersion,quality:project.quality?{status:project.quality.status,deterministic:project.quality.deterministic||{hardErrors:0,issues:[]},modelReview:project.quality.modelReview?Object.fromEntries(['missing','repeated','conflicts','unsupported'].map(key=>[key,project.quality.modelReview[key]||[]])):null,repairs:project.quality.repairs||[],mediaLedger:project.quality.mediaLedger,exportable:project.quality.exportable,publishEligible:project.quality.publishEligible,visualVerified:project.quality.visualVerified,renderedTextVerified:project.quality.renderedTextVerified,acceptanceAxes:project.quality.acceptanceAxes,report:project.quality.report,issueGroups:project.quality.issueGroups}:undefined,outline,generationStages:stages,drafts:generating?draftsFor(project.id,outline.filter(s=>stages.pages[s.id]==='writing').map(s=>s.id),project):{},deck:project.deck||generating?{...project.deck,slides:deckSlides}:null,
  generationSkeletons:generating?Object.fromEntries(outline.filter(s=>!ready.has(s.id)).map(s=>[s.id,buildTemplateSkeleton(project,s.id)]).filter(([,scene])=>scene).map(([id,scene])=>[id,leanSlide(project,scene)])):{},
  outlineProgress:project.outlineBatchTotal?{done:project.outlineBatches?.length||0,total:project.outlineBatchTotal}:undefined,
  postWriterPlan:project.postWriterPlan,contentSelection:project.contentSelection,planning:project.planning?{pageRecommendation:project.planning.pageRecommendation}:undefined,candidateOutline:project.candidateOutline?{...project.candidateOutline,executionPlan:undefined}:undefined,outlineCapacityDiagnostic:project.outlineCapacityDiagnostic,pageBudgetConflict:project.pageBudgetConflict,modelUsage:project.modelUsage?.slice(-1),source:project.status==='outline_ready'?{text:project.source?.text,segments:project.source?.segments||[],truncated:project.source?.truncated}:undefined,template:project.template,templateSpec:project.templateSpec,externalPptx:project.externalPptx?{mode:'preserve'}:undefined,
  templateFidelity:project.templateFidelity?{mode:project.templateFidelity.mode,slides:[]}:undefined,
  nodes:Object.fromEntries(Object.entries(project.nodes||{}).map(([id,n])=>[id,{status:n.status,attempts:n.attempts,epoch:n.epoch}])),
  editing:project.editing?{contentOpen:project.editing.contentOpen,intents:{}}:undefined,
  runtime:project.runtime?{lifecycle:project.runtime.lifecycle,pauseRequested:project.runtime.pauseRequested,slides:Object.fromEntries(outline.map(({id})=>{const {canonicalSlide,...s}=project.runtime.slides?.[id]||{},preview=currentSlidePreview(project,id);return [id,{...s,...(!preview&&['render_ready','validated'].includes(s.phase)?{phase:'queued'}:{}),preview:preview?{available:true}:undefined}];}))}:undefined,
  renderTree:{...(project.renderTree||{}),schemaVersion:3,units:'emu',deckId:project.deck?.deckId||project.id,size,hash:project.renderTree?.hash||String(project.revision),slides:trees.map(s=>leanSlide(project,s))}};
}
