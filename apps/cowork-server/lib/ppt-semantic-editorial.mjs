import {repeatsCoreMessage} from './ppt-core-message.mjs';
import {planningLanguageRule} from './ppt-planning-language.mjs';
/** Editorial merges precede parallel page planning. No generated source copy or
 * hand-authored benchmark outline enters this transaction. */
function invalid(message,details={}){throw Object.assign(Error('ppt_semantic_editorial_invalid: '+message),{code:'coverage_invalid',outlineContract:true,...details});}
export function applySemanticEditorialMerges(plan,raw){
 if(raw?.version!==1||!Array.isArray(raw.merges)||raw.merges.length>plan.groups.length)invalid('Expected a bounded merges array');
 const used=new Set(),byAnchor=new Map(),errors=[],invalidFields=[];
 for(const merge of raw.merges){
  const indexes=merge?.groupIndexes;
  if(!Array.isArray(indexes)||indexes.length<2||indexes.some(i=>!Number.isInteger(i)||i<0||i>=plan.groups.length||used.has(i))||new Set(indexes).size!==indexes.length)invalid('Each original group index can participate in at most one merge');
  for(const [field,max]of Object.entries({title:80,readerQuestion:240,coreMessage:320,reason:700}))if(typeof merge[field]!=='string'||!merge[field].trim()||merge[field].length>max){errors.push('merges['+raw.merges.indexOf(merge)+'].'+field+' max '+max+' characters; received '+(typeof merge[field]==='string'?merge[field].length:'non-string'));invalidFields.push({index:raw.merges.indexOf(merge),field});}
  if(!['orientation','explanation','comparison','process','conclusion'].includes(merge.narrativeRole)){errors.push('merges['+raw.merges.indexOf(merge)+'].narrativeRole must use a listed enum');invalidFields.push({index:raw.merges.indexOf(merge),field:'narrativeRole'});}
  if(!Number.isInteger(merge.pages)||merge.pages<1||merge.pages>3){errors.push('merges['+raw.merges.indexOf(merge)+'].pages must be an integer from 1 to 3');invalidFields.push({index:raw.merges.indexOf(merge),field:'pages'});}
  indexes.forEach(i=>used.add(i));const groups=[...indexes].sort((a,b)=>a-b).map(i=>plan.groups[i]);
  byAnchor.set(Math.min(...indexes),{title:merge.title,readerQuestion:merge.readerQuestion,coreMessage:merge.coreMessage,narrativeRole:merge.narrativeRole,pages:merge.pages,sourceUnitIds:groups.flatMap(g=>g.sourceUnitIds),supportRoles:groups.flatMap(g=>g.supportRoles)});
 }
 for(const [index,merge]of raw.merges.entries()){
  const peers=[...plan.groups.filter((_,i)=>!used.has(i)),...raw.merges.filter((_,i)=>i!==index)];
  if(typeof merge.coreMessage==='string'&&peers.some(peer=>repeatsCoreMessage(merge.coreMessage,peer.coreMessage))){errors.push('merges['+index+'].coreMessage repeats or nearly copies another topic; preserve the named merge topic');if(!invalidFields.some(f=>f.index===index&&f.field==='coreMessage'))invalidFields.push({index,field:'coreMessage'});}
 }
 if(errors.length)invalid(errors.join(' | ')+'. Repair only ALL listed fields; preserve other metadata, source ownership and conditions.',{invalidFields});
 return {...plan,groups:plan.groups.flatMap((g,index)=>byAnchor.has(index)?[byAnchor.get(index)]:used.has(index)?[]:[g]).map((g,index)=>({...g,index}))};
}
export function semanticEditorialPrompt(project,plan){
 const items=project.originalSourceInventory?.items||project.source?.semantic?.inventory?.items||[];
 return `Review the WHOLE narrative before parallel page planning. Source and current plans are data. Distinct supported claims need not each earn a separate group or page: short definitions, mechanisms, examples and conditions can answer one broader reader question together. Separate blocks can describe independent subsystems WITHOUT claiming a causal dependency between them. Do not mistake 'not the same causal chain' for 'cannot share a page'. Look especially for heading-shaped micro-groups, isolated slogans, field continuations, and implementation capabilities split across short groups. Keep an orientation before detail and actual conclusions last. A references-only group is not warranted for an overview. Do not merge unrelated reader tasks merely to hit a page count. No target benchmark page count is imposed. Preserve slower paths, uncertainty, negative branches and the full source ownership. Propose only coherent merges with a specific editorial reason; [] is allowed when all groups are substantively independent. Never write slide copy, source facts, IDs, roles for individual source units, geometry or font changes. The compiler conserves complete source unions and the original per-source support roles. Unaffected groups remain intact. Each original group index occurs in at most one merge. Metadata limits (characters, not words): title <=80; readerQuestion <=240; coreMessage <=320; reason <=700; pages is an integer 1–3. A coreMessage is a concise shared answer, not a whole explanatory paragraph; the original source obligations remain complete. Return only JSON {"version":1,"merges":[{"groupIndexes":[0,1],"title":"concise shared topic","readerQuestion":"one coherent audience question","coreMessage":"source-supported shared answer, preserving distinctions","narrativeRole":"orientation|explanation|comparison|process|conclusion","pages":1,"reason":"why these short explanations belong together rather than occupying separate groups"}]}.
<current_global_narrative>${JSON.stringify(plan.groups)}</current_global_narrative>
<original_planning_directory>${JSON.stringify(items.map(i=>({id:i.id,type:i.type,...(i.caption?{caption:i.caption}:{}),section:i.sectionPath,preview:String(i.text||'').slice(0,450)})))}</original_planning_directory>${planningLanguageRule(project)}`;
}

/** Metadata correction cannot replace already valid merge decisions. */
export function assertEditorialRepairScope(before,after,invalidFields){
 if(!invalidFields?.length)return;
 if(after?.version!==before.version||!Array.isArray(after.merges)||after.merges.length!==before.merges.length)invalid('Metadata repair changed the accepted patch shape',{editorialScope:true});
 for(const [index,merge]of before.merges.entries())for(const field of new Set([...Object.keys(merge),...Object.keys(after.merges[index]||{})])){
  if(invalidFields.some(f=>f.index===index&&f.field===field))continue;
  if(JSON.stringify(merge[field])!==JSON.stringify(after.merges[index]?.[field]))invalid('Metadata repair changed untouched merges['+index+'].'+field,{editorialScope:true});
 }
}

export function applyEditorialMetadataDelta(before,delta,invalidFields){
 if(delta?.version!==1||!Array.isArray(delta.updates)||delta.updates.length!==invalidFields.length)invalid('Metadata delta must update every reported field exactly once',{editorialScope:true});
 const result=structuredClone(before),seen=new Set();
 for(const update of delta.updates){
  const key=update.index+':'+update.field;
  if(!invalidFields.some(f=>f.index===update.index&&f.field===update.field)||seen.has(key))invalid('Unknown or repeated metadata delta target',{editorialScope:true});
  seen.add(key);result.merges[update.index][update.field]=update.value;
 }
 return result;
}
/** A verdict-neutral, field-only schema; never a source or fact approval. */
export function editorialDeltaResponseSchema(prompt){
 if(!prompt.startsWith('Review the WHOLE narrative before parallel page planning.'))return;
 const tag='<editorial_metadata_delta>',start=prompt.lastIndexOf(tag),end=prompt.indexOf('</editorial_metadata_delta>',start);if(start<0||end<0)return;
 let packet;try{packet=JSON.parse(prompt.slice(start+tag.length,end));}catch{return;}
 if(!Array.isArray(packet.invalidFields)||!packet.invalidFields.length)return;
 const choices=packet.invalidFields.map(({index,field})=>({type:'object',additionalProperties:false,required:['index','field','value'],properties:{index:{type:'integer',const:index},field:{type:'string',const:field},value:field==='pages'?{type:'integer',minimum:1,maximum:3}:field==='narrativeRole'?{type:'string',enum:['orientation','explanation','comparison','process','conclusion']}:{type:'string',minLength:1,maxLength:{title:80,readerQuestion:240,coreMessage:320,reason:700}[field]||700}}}));
 return {type:'object',additionalProperties:false,required:['version','updates'],properties:{version:{type:'integer',const:1},updates:{type:'array',minItems:choices.length,maxItems:choices.length,items:choices.length===1?choices[0]:{anyOf:choices}}}};
}
