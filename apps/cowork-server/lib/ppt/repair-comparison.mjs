/** Immutable actual render snapshots for a validated automatic repair. */
import fs from 'node:fs';import path from 'node:path';import {projectDataDir} from './repository.mjs';import {buildSlideRenderTree} from './render-tree.mjs';import {slideSvg} from './exporters/preview.mjs';import {digest} from './edit-context.mjs';
export function recordRepairComparison(before,after,slideId,findings=[]){
 const a=buildSlideRenderTree(before,slideId),b=buildSlideRenderTree(after,slideId);if(!a||!b)return null;
 const beforeHash=digest(a),afterHash=digest(b),id=digest([beforeHash,afterHash]).slice(0,32),directory=path.join(projectDataDir(after.uid,after.id),'repair-comparisons',id);fs.mkdirSync(directory,{recursive:true});
 for(const [name,tree]of [['before',a],['after',b]])fs.writeFileSync(path.join(directory,name+'.svg'),slideSvg(tree),{mode:0o600});
 const base=`/api/ppt/projects/${after.id}/slides/${slideId}/repair-comparison/${id}`;
 const comparison={id,slideId,revision:after.revision,at:new Date().toISOString(),beforeHash,afterHash,beforeUrl:base+'/before',afterUrl:base+'/after',findings:findings.map(f=>({code:f.code,detail:f.detail||f.message})),basis:'actual measured source-preserving repair, committed after validation'};
 fs.writeFileSync(path.join(directory,'metadata.json'),JSON.stringify(comparison),{mode:0o600});return comparison;
}
export function readRepairComparison(project,slideId,id,part){
 if(!/^[a-f0-9]{32}$/.test(id)||!['before','after'].includes(part))return null;
 const directory=path.join(projectDataDir(project.uid,project.id),'repair-comparisons',id);try{const metadata=JSON.parse(fs.readFileSync(path.join(directory,'metadata.json'),'utf8'));return metadata.slideId===slideId?fs.readFileSync(path.join(directory,part+'.svg')):null;}catch{return null;}
}

/** Record each changed existing page, after the repair transaction passed its gates. */
export function recordRepairSet(before,after,findings=[]){
 if(!after.uid||!after.id)return [];
 const recorded=[];for(const slide of after.deck?.slides||[]){
  if(!before.deck?.slides?.some(s=>s.id===slide.id))continue;
  const a=buildSlideRenderTree(before,slide.id),b=buildSlideRenderTree(after,slide.id);
  if(digest(a)===digest(b))continue;
  const comparison=recordRepairComparison(before,after,slide.id,findings.filter(f=>!f.slideId||f.slideId===slide.id));
  if(comparison){after.runtime||={};after.runtime.slides||={};const state=after.runtime.slides[slide.id]||={};state.repairComparison=comparison;state.repairHistory=[...(state.repairHistory||[]),comparison].slice(-20);recorded.push(comparison);}
 }return recorded;
}
