import { createHash } from 'node:crypto';
import {mandatorySelectionFacts}from './ppt-content-selection.mjs';
import { inputFramework } from './ppt-input-scope.mjs';
import { visibleSlideText } from './ppt-evidence.mjs';
import { nodeContentText, visibleNodes } from './ppt-visible-content.mjs';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const OBLIGATION_VERSION = 1;
export const visibleEvidenceQuoteId=(slideId,node)=>'quote-'+hash({slideId,nodeId:node.id,text:nodeContentText(node)}).slice(0,24);
/** Explicit quote references select the complete CURRENT visible instance.
 * They are a transport protocol, not a heuristic correction of bad excerpts.
 * Literal excerpts remain supported and are never changed or rebound. */
export function resolveObligationQuoteReferences(audit,project) {
  if(!Array.isArray(audit?.checks))return audit;
  const quotes=new Map((project.deck?.slides||[]).flatMap(slide=>visibleNodes(slide).filter(node=>nodeContentText(node)).map(node=>
    [visibleEvidenceQuoteId(slide.id,node),{slideId:slide.id,nodeId:node.id,text:nodeContentText(node)}])));
  return {...audit,checks:audit.checks.map(check=>({...check,...(Array.isArray(check?.evidence)?{evidence:check.evidence.map(evidence=>{
    if(!evidence?.quoteId)return evidence;
    const quote=quotes.get(evidence.quoteId);
    if(!quote||quote.slideId!==evidence.slideId||quote.nodeId!==evidence.nodeId)throw new Error('obligation evidence quote reference is stale, unknown or bound to another visible instance');
    if(evidence.excerpt!==undefined&&evidence.excerpt!==quote.text)throw new Error('obligation evidence quote reference conflicts with its supplied literal excerpt');
    return {...evidence,excerpt:quote.text};
  })}:{})}))};
}
const qualifier = /\b(?:unless|except|only|solely|limited\s+to|provided\s+that|must|shall|not|never|without|uncertain|conditional|subject\s+to)\b|不得|不能|僅|仅|只有|限于|限於|除非|否則|否则|例外|不確定|不确定|前提|必須|必须|禁止|不保證|不保证/iu;

/** Generated brief topics cannot undo the validated overview/notes scope.
 * Explicit source conditions and page details remain independent obligations. */
export function mainDeckBriefRequirements(project){
  const requirements=project.planning?.brief?.mustInclude||[];
  if(project.generationPolicy?.content!=='overview'||project.generationPolicy?.details!=='notes'||project.contentSelection?.sourceHash!==project.source?.sha256)return requirements;
  const items=project.source?.semantic?.inventory?.items||[];
  return requirements.filter(text=>{
    if(String(project.userRequirements||project.prompt||'').includes(text)||(project.requestedOutline||[]).some(s=>JSON.stringify(s).includes(text)))return true;
    const chunk=project.source?.semantic?.chunks?.find(c=>c.topic===text);
    if(!chunk)return true;
    const units=items.filter(i=>i.chunkRefs?.includes(chunk.id));
    return !units.length||!units.every(i=>i.presentation==='notes_by_contract'&&i.presentationBasis===project.contentSelection.hash);
  });
}

/** Full source spans are authority; plan summaries never replace them. This
 * deterministic registry finds explicit conditions; the critic also reviews
 * the full input for less explicit relations. It is not a semantic extractor. */
export function obligationRegistry(project) {
  const framework=inputFramework(project), source=String(project.source?.text || project.prompt || ''), entries=[];
  const add=(text,basis,slideIds=[],span=null)=>{
    text=String(text||'').trim();if(!text)return;
    const id='ob-'+hash({text,basis,span}).slice(0,20),prior=entries.find(e=>e.id===id);
    if(prior){prior.slideIds=[...new Set([...prior.slideIds,...slideIds])];return;}
    entries.push({id,priority:'mandatory',text,basis,sourceSpan:span,slideIds:[...new Set(slideIds)]});
  };
  // Fences and Markdown tables are independently checked as source objects.
  let fenced=false,offset=0;
  for(const line of source.split(/(?<=\n)/u)) {
    if(/^\s*(```|~~~)/u.test(line))fenced=!fenced;
    else if(!fenced&&!/^\s*\|/u.test(line)&&qualifier.test(line)) {
      const chunks=(project.source?.semantic?.chunks||[]).filter(c=>c.text?.includes(line.trim())).map(c=>c.id);
      const owners=(project.planning?.slidePlan||[]).filter(p=>p.sourceChunks?.some(id=>chunks.includes(id))).map(p=>p.slideId);
      add(line,'source_condition',owners,{start:offset,end:offset+line.length,encoding:'utf16'});
    }
    offset+=line.length;
  }
  for(const plan of project.planning?.slidePlan||[])for(const text of plan.requiredDetails||[]) {
    const start=source.indexOf(text);
    add(text,start>=0?'source_detail':'planned_detail',[plan.slideId],start>=0?{start,end:start+text.length,encoding:'utf16'}:null);
  }
  if(project.contentSelection?.entries?.some(e=>e.summaryText||e.visibleEquivalentSourceUnitId))for(const fact of mandatorySelectionFacts({...project,source:{...project.source,semantic:{...project.source.semantic,inventory:project.originalSourceInventory||project.source.semantic.inventory}}})){
    const start=source.indexOf(fact.text),equivalent=project.contentSelection.entries.find(e=>e.sourceUnitId===fact.sourceUnitId)?.visibleEquivalentSourceUnitId,owners=project.outline.filter(o=>o.sourceUnitIds?.includes(equivalent||fact.sourceUnitId)).map(o=>o.id);
    add(fact.text,'source_summary_detail',owners,start>=0?{start,end:start+fact.text.length,encoding:'utf16'}:null);
  }
  for(const text of mainDeckBriefRequirements(project))add(text,'brief_requirement');
  const selected=project.reviewScope?.obligationIds;
  if(selected&&(!Array.isArray(selected)||new Set(selected).size!==selected.length||selected.some(id=>!entries.some(e=>e.id===id))))throw new Error('invalid internal review obligation partition');
  const material={version:OBLIGATION_VERSION,frameworkHash:framework.frameworkHash,entries:selected?entries.filter(e=>selected.includes(e.id)):entries};
  return {...material,registryHash:hash(material)};
}

export function normalizeObligationAudit(value, project) {
  const registry=obligationRegistry(project), checks=value?.checks;
  if(!value||value.registryHash!==registry.registryHash||!['complete','not_evaluated'].includes(value.status)||!Array.isArray(checks)||checks.length!==registry.entries.length||new Set(checks.map(c=>c?.obligationId)).size!==checks.length)
    throw new Error('mandatory obligation audit requires the current registry and every obligation exactly once');
  const slides=project.deck?.slides||[], valid=new Set(registry.entries.map(e=>e.id));
  for(const check of checks) {
    if(!valid.has(check.obligationId)||!['satisfied','missing','altered','not_evaluated'].includes(check.status)||!Array.isArray(check.evidence))throw new Error('invalid mandatory obligation check');
    for(const ref of check.evidence){
      const slide=slides.find(s=>s.id===ref.slideId),node=slide&&visibleNodes(slide).find(n=>n.id===ref.nodeId),legacy=slide&&ref.nodeId===`slide:${slide.id}`&&!slide.nodes?.length;
      if(!node&&!legacy)throw new Error('obligation evidence must name a visible current instance');
      const text=node?nodeContentText(node):visibleSlideText(slide);
      if(check.status==='satisfied'&&(typeof ref.excerpt!=='string'||!ref.excerpt.trim()||!text.includes(ref.excerpt)))throw new Error('obligation evidence excerpt must occur in the current visible instance');
    }
    if(check.status==='satisfied'&&!check.evidence.length)throw new Error('satisfied obligation requires visible instance evidence');
  }
  return {registryHash:registry.registryHash,status:value.status,checks:structuredClone(checks)};
}
/** Diagnostics only. Never substitute a quote, locate evidence automatically,
 * or change an audit verdict; the model must return a newly validated audit. */
export function obligationEvidenceDiagnostics(value, project) {
  const slides=project.deck?.slides||[], issues=[];
  for(const check of Array.isArray(value?.checks)?value.checks:[])for(const ref of Array.isArray(check?.evidence)?check.evidence:[]) {
    if(!ref||typeof ref!=='object')continue;
    const slide=slides.find(s=>s.id===ref.slideId), nodes=slide?visibleNodes(slide):[];
    const node=nodes.find(n=>n.id===ref.nodeId), legacy=slide&&ref.nodeId===`slide:${slide.id}`&&!slide.nodes?.length;
    const text=node?nodeContentText(node):legacy?visibleSlideText(slide):null;
    if(text===null || check.status==='satisfied'&&(typeof ref.excerpt!=='string'||!ref.excerpt.trim()||!text.includes(ref.excerpt)))issues.push({
      obligationId:check.obligationId,slideId:ref.slideId,nodeId:ref.nodeId,providedExcerpt:ref.excerpt,
      actualInstanceText:text,visibleInstances:nodes.map(n=>({nodeId:n.id,text:nodeContentText(n)})).filter(n=>n.text),
    });
  }
  return issues;
}
export function obligationFailures(audit) {
  return (audit?.checks||[]).filter(check=>check.status!=='satisfied').map(check=>({code:'mandatory_content_'+check.status,severity:'error',obligationId:check.obligationId,slideIds:check.evidence.map(e=>e.slideId),detail:'Mandatory source condition/detail was not fully verified',repairable:true}));
}
export function obligationContext(project) {
  return `\nMANDATORY_OBLIGATIONS=${JSON.stringify(obligationRegistry(project))}\nPreserve full conditions, negation, exceptions, units, uncertainty and relationships. Full spans outrank summaries. Planned details must be checked against INPUT_FRAMEWORK, never used as new fact authority. Density is filled with distinct supported content; if capacity is insufficient, reflow/split or report conflict, never truncate an obligation or repeat filler.\n`;
}
