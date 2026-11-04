/** Durable source-component commits during writing. Model prose stays a draft
 * until page validation. Every commit carries the original revision/epoch,
 * run, lease and source hash, and projects a measured native scene. */
import fs from 'node:fs';
import path from 'node:path';
import {projectDataDir} from './repository.mjs';
import {bindSourceArtifacts} from '../ppt-source-artifacts.mjs';
import {updateSlidePreview} from './runtime.mjs';
import {digest} from './edit-context.mjs';
export function componentLeaseToken(project){
  try{return JSON.parse(fs.readFileSync(path.join(projectDataDir(project.uid,project.id),'generation-lease.json'),'utf8')).token;}catch{return null;}
}
export function commitSourceComponents(project,envelope,{leaseToken=componentLeaseToken}={}){
  const reject=reason=>({status:'rejected',reason});
  const {slideId,runId,epoch,sourceHash,baseRevision,lease}=envelope;
  if(project.status!=='generating'||project.deletedAt||project.runtime?.pauseRequested||project.nodes?.[slideId]?.status!=='running'||project.runtime?.slides?.[slideId]?.accepted||project.currentRunId!==runId)return reject('run_cancelled_or_superseded');
  if(project.revision!==baseRevision||Number(project.editing?.epochs?.[slideId]||0)!==epoch)return reject('user_revision_or_epoch_changed');
  if(!lease||leaseToken(project)!==lease||project.source?.sha256!==sourceHash)return reject('lease_or_source_changed');
  const assigned=project.planning?.slidePlan?.find(s=>s.slideId===slideId)?.sourceArtifacts||[],refs=envelope.refs||[];
  if(!refs.length||refs.some(ref=>!assigned.some(a=>['sourceUnitId','rowStart','rowEnd','lineStart','lineEnd'].every(key=>a[key]===ref[key]))))return reject('unassigned_source_range');
  const saved=project.runtime?.slides?.[slideId]?.componentCommit,previous=saved?.epoch===epoch&&saved?.runId===runId?saved:null;
  const union=[...(previous?.refs||[]),...refs].filter((r,i,all)=>all.findIndex(x=>digest(x)===digest(r))===i);
  if(digest(union)===digest(previous?.refs||[]))return {status:'unchanged'};
  const candidate=structuredClone(project),index=candidate.outline.findIndex(s=>s.id===slideId),outline=candidate.outline[index];
  if(index<0)return reject('page_missing');
  try{
    const slide={...structuredClone(outline),nodes:[],nodeOrder:[],sourceRefs:outline.refs||[]};
    bindSourceArtifacts(candidate,slide,union,index);
    candidate.nodes[slideId]={...candidate.nodes[slideId],slide};
    updateSlidePreview(candidate,slideId,'writing');
    const scene=candidate.runtime.slides[slideId];
    const commit={version:1,slideId,runId,epoch,baseRevision,sourceHash,lease,seq:Number(previous?.seq||0)+1,refs:union,
      mediaTasks:slide.mediaTasks,componentIds:slide.sourceArtifactNodes.map(n=>n.id),componentHash:digest(slide.sourceArtifactNodes),renderHash:scene.renderHash,at:new Date().toISOString(),validation:'immutable source identity + typed math + measured native capacity'};
    // Keep the lease out of client projections; it is a worker ownership token.
    const {lease:_lease,...publicCommit}=commit;
    project.runtime.slides[slideId]={...project.runtime.slides[slideId],...scene,componentCommit:publicCommit};
    return {status:'committed',commit:publicCommit};
  }catch(error){return reject('component_capacity_or_display: '+String(error.message).slice(0,600));}
}
