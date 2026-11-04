import type {PptProject} from '@/components/ppt/types';
type GenerationView = Pick<PptProject,'nodes'|'runtime'|'generationStages'|'drafts'|'currentRunId'|'editing'>;
export function currentGenerationDraft(project:GenerationView,id:string,draft=project.drafts?.[id]){
 if(!draft||draft.runId&&draft.runId!==project.currentRunId||draft.epoch!==undefined&&draft.epoch!==Number(project.editing?.epochs?.[id]??project.nodes?.[id]?.epoch??0))return undefined;
 return draft;
}
/** Template skeletons exist before execution; they do not prove a page started. */
export function generationPageStarted(project:GenerationView,id:string){
 return ['running','done','completed','failed'].includes(project.nodes?.[id]?.status||'')||
  ['retrieving','writing','binding','rendering','reviewing','layout','previewing','validating','repairing','ready','failed'].includes(project.generationStages?.pages?.[id]||'')||
  project.runtime?.slides?.[id]?.phase==='render_ready'||Boolean(currentGenerationDraft(project,id));
}

/** SSE and durable snapshots can arrive out of order. Never let an older
 * transient copy hide the newer snapshot for the same writer attempt. */
export function mergeGenerationDrafts(project:GenerationView, transient:NonNullable<PptProject['drafts']>){
 const merged:NonNullable<PptProject['drafts']>={};
 for(const id of new Set([...Object.keys(project.drafts||{}),...Object.keys(transient)])){
  const snapshot=currentGenerationDraft(project,id),live=currentGenerationDraft(project,id,transient[id]);
  if(!snapshot&&!live)continue;
  if(!snapshot||!live){merged[id]=(snapshot||live)!;continue;}
  merged[id]=snapshot.jobId===live.jobId
   ?(Number(snapshot.seq||0)>Number(live.seq||0)?snapshot:live)
   :(String(snapshot.updatedAt||'')>String(live.updatedAt||'')?snapshot:live);
 }
 return merged;
}

export function generationPageStage(project:GenerationView,id:string){
 const stage=project.generationStages?.pages?.[id];if(stage)return stage;
 if(project.runtime?.slides?.[id]?.phase==='render_ready')return 'ready';
 if(project.nodes?.[id]?.status==='running'||currentGenerationDraft(project,id))return 'writing';
 if(['done','completed'].includes(project.nodes?.[id]?.status||''))return 'rendering';
 return 'waiting';
}
