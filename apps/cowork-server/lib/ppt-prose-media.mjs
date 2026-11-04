import {sourcePointListKind}from'./ppt-source-list-kinds.mjs';
import {digest}from'./ppt/edit-context.mjs';
import {sourceDisplayText}from'./ppt-source-text.mjs';
const span={type:'object',additionalProperties:false,required:['quote'],properties:{start:{type:'integer',minimum:0},end:{type:'integer',minimum:1},quote:{type:'string',minLength:1,maxLength:3000}}};
export const proseMediaSchema={type:'object',additionalProperties:false,required:['kind','nodes','edges'],properties:{kind:{type:'string',enum:['parallel','sequence','branch','dependency','overlap','cycle']},nodes:{type:'array',minItems:2,maxItems:12,items:{type:'object',additionalProperties:false,required:['id','label','body','evidence'],properties:{id:{type:'string',maxLength:80},label:{type:'string',minLength:1,maxLength:160},body:{type:'string',maxLength:1200},evidence:span}}},edges:{type:'array',maxItems:24,items:{type:'object',additionalProperties:false,required:['from','to','evidence'],properties:{from:{type:'string'},to:{type:'string'},evidence:span}}}}};
/** Bind only a unique verbatim quote; never fuzzy-match or invent evidence. */
export function normalizeProseMediaEvidence(item,value){
 if(!value||typeof value!=='object')return value;
 const bind=e=>{if(!e||typeof e.quote!=='string'||!e.quote)return e;const source=String(item.text||'');if(Number.isInteger(e.start)&&Number.isInteger(e.end)&&e.start>=0&&e.end>e.start&&source.slice(e.start,e.end)===e.quote)return e;const start=source.indexOf(e.quote);return start>=0&&source.indexOf(e.quote,start+1)<0?{...e,start,end:start+e.quote.length}:e;};
 return {...value,...(Array.isArray(value.nodes)?{nodes:value.nodes.map(n=>({...n,evidence:bind(n.evidence)}))}:{}),...(Array.isArray(value.edges)?{edges:value.edges.map(e=>({...e,evidence:bind(e.evidence)}))}:{})};
}
export function validProseMedia(item,value){
 if(!value||!['parallel','sequence','branch','dependency','overlap','cycle'].includes(value.kind)||!Array.isArray(value.nodes)||value.nodes.length<2||value.nodes.length>12||!Array.isArray(value.edges)||value.edges.length>24)return false;
 const contains=(quote,value)=>{const q=sourceDisplayText(quote),v=sourceDisplayText(value);return q.includes(v)||/^[A-Z][a-z]{2,}(?:[ ,;:-][a-z -]+)*[.!?]?$/u.test(v)&&q.includes(v[0].toLowerCase()+v.slice(1));};
 const ids=new Set(value.nodes.map(n=>n.id)),exact=e=>Number.isInteger(e?.start)&&Number.isInteger(e?.end)&&e.start>=0&&e.end>e.start&&item.text?.slice(e.start,e.end)===e.quote&&Boolean(e.quote);
 if(ids.size!==value.nodes.length||value.nodes.some(n=>!n.id||!n.label||!exact(n.evidence)||![n.label,n.body||''].every(v=>contains(n.evidence.quote,v))))return false;
 if(value.edges.some(e=>!ids.has(e.from)||!ids.has(e.to)||e.from===e.to||!exact(e.evidence)))return false;
 if(sourcePointListKind(item)){
  const starts=[...item.text.matchAll(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/gmu)].map(m=>m.index);
  if(starts.some((start,i)=>!value.nodes.some(n=>n.evidence.start>=start&&n.evidence.end<=(starts[i+1]??item.text.length))))return false;
 }
 if(value.kind==='parallel'&&value.edges.length||value.kind!=='parallel'&&!value.edges.length)return false;
 if(value.kind==='overlap'&&(value.nodes.length!==3||value.edges.length!==2||value.edges.some(e=>e.to!==value.nodes[2].id)||new Set(value.edges.map(e=>e.from)).size!==2||value.edges.some(e=>e.from===value.nodes[2].id)))return false;
 if(value.kind==='cycle'&&(value.edges.length!==value.nodes.length||value.nodes.some((n,i)=>!value.edges.some(e=>e.from===n.id&&e.to===value.nodes[(i+1)%value.nodes.length].id))))return false;
 return true;
}
/** Extractive nodes and exact edge quotes make geometry a presentation of a
 * proposed source relationship. Semantic entailment still requires the normal
 * independent claim audit; this is not a model-free causal proof. */
export function proseMediaItem(item,projection,ledgerHash){
 if(!validProseMedia(item,projection))throw Error('Invalid source-quoted prose media projection');
 const graph={version:1,parserVersion:3,basis:'source_quoted_prose',layoutRelation:projection.kind,sourceHash:digest(item.text),nodes:projection.nodes.map(n=>({id:n.id,label:n.label,body:n.body?[n.body]:[],sourceSpans:[n.evidence]})),edges:projection.edges.map(e=>({...e,sourceConnectorIndex:0})),labelsComplete:true,unresolvedConnectors:0};
 const byId=new Map(graph.nodes.map(n=>[n.id,n]));
 const rows=[['Component','Explanation','Related component'],...graph.nodes.map(n=>[n.label,n.body.join('\n'),graph.edges.filter(e=>e.from===n.id).map(e=>'→ '+byId.get(e.to).label).join('\n')])];
 graph.rowsHash=digest(rows);
 return {...item,type:'SummaryTableBlock',rows,text:rows.map(r=>r.join(' | ')).join('\n'),tableRepresentation:'diagram',must_preserve_structure:true,
  diagramSource:{kind:'prose',originalType:item.type,originalSectionPath:item.sectionPath,text:item.text,presentation:'semantic_graph_rows',graph,proofHash:digest({text:item.text,projection,rows}),projection},
  derivedSummary:{sourceUnitId:item.id,summaryMode:'semantic',summaryGraphHash:digest(graph),ledgerHash,requiresOriginalEntailment:true}};
}
export function validProseProjection(item){
 const d=item.diagramSource;if(d?.kind!=='prose')return false;
 if(!validProseMedia({type:d.originalType,sectionPath:d.originalSectionPath,text:d.text},d.projection))return false;
 const expected=proseMediaItem({id:item.id,type:d.originalType,sectionPath:d.originalSectionPath,text:d.text},d.projection,item.derivedSummary?.ledgerHash);
 return digest(expected.rows)===digest(item.rows)&&digest(expected.diagramSource.graph)===digest(d.graph)&&expected.diagramSource.proofHash===d.proofHash;
}
