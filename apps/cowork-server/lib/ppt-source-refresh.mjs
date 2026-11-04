import crypto from 'node:crypto';
import {normalizePaste} from './ppt-source.mjs';
import {applyPresentationPolicy} from './ppt-presentation-policy.mjs';
import {compileContentSelection,selectionSource} from './ppt-content-selection.mjs';
import {sourceRichText} from './ppt-rich-text.mjs';
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const content=item=>({type:item.type,text:item.text,rows:item.rows,diagramSource:item.diagramSource,languagePairId:item.languagePairId,languageRole:item.languageRole,must_preserve_structure:item.must_preserve_structure});
const reject=message=>{throw Object.assign(new Error(message),{statusCode:409});};
function mapIds(value,ids){
 if(typeof value==='string')return ids.get(value)||value;
 if(Array.isArray(value))return value.map(v=>mapIds(v,ids));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[ids.get(k)||k,mapIds(v,ids)]));
 return value;
}
/** Explicit retry migration of derived parsing only. Input bytes, user plan,
 * template assignment and unaffected completed pages remain authoritative. */
export function refreshDerivedSource(project,assess){
 if(project.inputKind!=='paste'||!['failed','quality_blocked'].includes(project.status)||!project.candidateOutline?.accepted||!project.contentSelection)
  reject('Source refresh requires an unpublished failed paste project with an accepted outline.');
 if(project.revision>0||project.publishedRevision||Object.values(project.editing?.epochs||{}).some(v=>v>0)||Object.values(project.runtime?.slides||{}).some(s=>s.accepted))
  reject('Preserve user edits or accepted pages; derived source refresh cannot overwrite them.');
 const next=structuredClone(project),source=normalizePaste(project.source.text);
 if(source.sha256!==project.source.sha256)reject('Reparsed source hash differs; no input change is allowed.');
 source.images=structuredClone(project.source.images||[]);
 next.source=applyPresentationPolicy(source,next);next.originalSourceInventory=structuredClone(next.source.semantic.inventory);
 const previous=project.originalSourceInventory||project.source.semantic.inventory;
 if(hash(previous.items.map(i=>i.id))!==hash(next.originalSourceInventory.items.map(i=>i.id)))reject('Source IDs changed; reopen scoped source planning.');
 const raw=structuredClone(project.candidateOutline.executionPlan);
 next.contentSelection=compileContentSelection(next,raw);next.source=selectionSource(next,next.contentSelection);
 const displayChanged=new Set((project.deck?.slides||[]).flatMap(s=>(s.sourceArtifactNodes||[]).filter(n=>n.sourceArtifact&&n.content?.richText?.source&&sourceRichText(n.content.richText.source).plainText!==n.content.richText.plainText).map(n=>n.sourceArtifact.sourceUnitId)));
 const changed=next.source.semantic.inventory.items.filter(item=>displayChanged.has(item.id)||hash(content(item))!==hash(content(project.source.semantic.inventory.items.find(i=>i.id===item.id)||{}))).map(i=>i.id);
 if(!changed.length)return {project,changedSourceIds:[],affectedSlideIds:[]};
 // Measure the accepted slots. Do not borrow authority to pick other layouts.
 const assessed=assess({...next,nativeTitleRepairSeed:{basis:'derived semantic refresh retains accepted layout and plan'}},raw,{finalRepack:true});
 if(assessed.issues.length||assessed.outline.length!==project.outline.length)reject('Refreshed source needs scoped planning repair; accepted page budget was preserved.');
 for(let i=0;i<project.outline.length;i++){
  const old=project.outline[i],fresh=assessed.outline[i];
  if(hash({title:old.title,ids:old.sourceUnitIds,ranges:old.sourceArtifactRanges})!==hash({title:fresh.title,ids:fresh.sourceUnitIds,ranges:fresh.sourceArtifactRanges}))
   reject('Refresh would change the accepted title or source ownership.');
 }
 const ids=new Map(assessed.outline.map((s,i)=>[s.id,project.outline[i].id]));
 next.planning=mapIds(assessed.planning,ids);
 const affected=project.outline.filter(s=>s.sourceUnitIds?.some(id=>changed.includes(id))).map(s=>s.id);
 next.outline=project.outline.map((s,i)=>({...s,densityFit:assessed.outline[i].densityFit}));
 for(const id of affected){
  next.nodes[id]={status:'pending',attempts:0};
  if(next.runtime?.slides?.[id])next.runtime.slides[id]={...next.runtime.slides[id],phase:'content',preview:undefined,renderHash:undefined,accepted:false};
 }
 next.sourceRefreshHistory=[...(project.sourceRefreshHistory||[]),{at:new Date().toISOString(),sourceHash:source.sha256,changedSourceIds:changed,affectedSlideIds:affected,priorInventoryHash:hash(project.source.semantic.inventory),nextInventoryHash:hash(next.source.semantic.inventory),basis:'Same immutable input, corrected derived diagram semantics; stable page IDs, titles, original ranges and native assignment retained'}];
 next.renderTree=undefined;
 return {project:next,changedSourceIds:changed,affectedSlideIds:affected};
}
