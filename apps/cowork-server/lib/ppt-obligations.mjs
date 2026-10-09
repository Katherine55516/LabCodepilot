import { createHash } from 'node:crypto';
import { inputFramework } from './ppt-input-scope.mjs';
import { visibleSlideText } from './ppt-evidence.mjs';
import { nodeContentText, visibleNodes } from './ppt-visible-content.mjs';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const OBLIGATION_VERSION = 1;
const qualifier = /\b(?:unless|except|only\s+if|provided\s+that|must|shall|not|never|without|uncertain|conditional|subject\s+to)\b|不得|不能|仅当|只有|除非|否则|例外|不确定|前提|必须|禁止|不保证/iu;

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
  for(const text of project.planning?.brief?.mustInclude||[])add(text,'brief_requirement');
  const material={version:OBLIGATION_VERSION,frameworkHash:framework.frameworkHash,entries};
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
export function obligationFailures(audit) {
  return (audit?.checks||[]).filter(check=>check.status!=='satisfied').map(check=>({code:'mandatory_content_'+check.status,severity:'error',obligationId:check.obligationId,slideIds:check.evidence.map(e=>e.slideId),detail:'Mandatory source condition/detail was not fully verified',repairable:true}));
}
export function obligationContext(project) {
  return `\nMANDATORY_OBLIGATIONS=${JSON.stringify(obligationRegistry(project))}\nPreserve full conditions, negation, exceptions, units, uncertainty and relationships. Full spans outrank summaries. Planned details must be checked against INPUT_FRAMEWORK, never used as new fact authority. Density is filled with distinct supported content; if capacity is insufficient, reflow/split or report conflict, never truncate an obligation or repeat filler.\n`;
}
