import {sourceWarningKey,sourceWarningAcknowledged} from './ppt-source-readiness.mjs';
import {numericRecords} from './ppt-source-numbers.mjs';
import {cardsFlow} from './ppt-flow.mjs';
/** Only unambiguous integer product + directly named resulting portfolio/bucket
 * count is checked. Never correct the immutable source or infer missing units.
 *
 * A conflict is a source inconsistency, not lost content (Fable, 2026-10-23;
 * 04_factor_zoo "2×3×3 … (27 portfolios)" blocked generation although no card
 * showed it): an advisory warning that never gates generation by itself. On a
 * card deck it blocks publication only where a card shows the contradiction
 * (the claimed count with the product: source_arithmetic_shown) until the
 * author edits the point or keeps the original; older decks keep their gate.
 * The same product stated in two languages is one conflict. */
const PATTERN=/(\d+(?:\s*(?:×|\\times)\s*\d+)+)\$?\s*(?:[^.。\n]{0,100}?)?[（(]\s*(\d+)\s*(?:portfolios?|buckets?|个组合|個組合|个分组|個分組)\s*[）)]/giu;
export function formatArithmeticExpression(expression){return String(expression).replace(/\\times/gu,'×').replace(/\s+/gu,'');}
function conflicts(project){
 const segments=project.source?.segments?.length?project.source.segments:[{id:'prompt',text:project.prompt||''}],found=new Map();
 for(const segment of segments)for(const match of String(segment.text||'').matchAll(PATTERN)){
  const numbers=match[1].split(/\s*(?:×|\\times)\s*/u).map(Number),actual=numbers.reduce((a,b)=>a*b,1),claimed=Number(match[2]);
  if(!Number.isSafeInteger(actual)||actual===claimed)continue;
  const display=formatArithmeticExpression(match[1]),id=display+'='+claimed;
  const entry=found.get(id)||{expression:match[1],display,calculated:actual,claimed,excerpt:match[0],sourceRefs:[],locations:[]};
  if(!entry.sourceRefs.includes(segment.id))entry.sourceRefs.push(segment.id);
  if(segment.location&&!entry.locations.includes(segment.location))entry.locations.push(segment.location);
  found.set(id,entry);
 }
 return [...found.values()];
}
/** The source warning for one conflict (stable key across reads): advisory,
 * with the figures as params so the client words it in the reader's language. */
export function arithmeticWarning(conflict){
 return {code:'source_arithmetic_conflict',required:false,cause:'source_inconsistency',location:conflict.locations[0]||'原始输入',sourceRefs:[...conflict.sourceRefs],
  params:{expression:conflict.display,calculated:conflict.calculated,claimed:conflict.claimed},
  message:`Count mismatch: ${conflict.display} = ${conflict.calculated}; the source says ${conflict.claimed}. The source is never changed automatically.`,
  reference:conflict.display+'='+conflict.claimed};
}
/** Adds missing arithmetic warnings to a parsed source (idempotent). */
export function withSourceArithmeticWarnings(source){
 const warnings=conflicts({source}).map(arithmeticWarning);if(!warnings.length)return source;
 const existing=new Set((source.mediaWarnings||[]).map(sourceWarningKey));
 const added=warnings.filter(warning=>!existing.has(sourceWarningKey(warning)));
 return added.length?{...source,mediaWarnings:[...(source.mediaWarnings||[]),...added]}:source;
}
/** Where cards show a conflict: a point that cites a unit of the conflicting
 * source segment and states the claimed count (withExpression when it also
 * writes the product), or a card object whose text holds the statement. */
export function shownArithmeticConflicts(project,pages=project.outline||[]){
 const found=conflicts(project);if(!found.length)return [];
 const items=new Map((project.source?.semantic?.inventory?.items||[]).map(item=>[item.id,item]));
 const prose=text=>String(text||'').replace(/\$[^$\n]+\$/gu,' '),compact=text=>String(text||'').replace(/\\times/gu,'×').replace(/[\s$]+/gu,'');
 const shown=[];
 for(const conflict of found){
  const warning=arithmeticWarning(conflict),key=sourceWarningKey(warning),refs=new Set(conflict.sourceRefs),kept=sourceWarningAcknowledged(project,key,warning);
  pages.forEach((page,pageIndex)=>{
   (page?.keyPoints||[]).forEach((point,pointIndex)=>{
    const cites=(point?.sourceUnitIds||[]).some(id=>(items.get(id)?.source_ref||[]).some(ref=>refs.has(ref)));
    if(cites&&numericRecords(prose(point.text)).some(record=>record.value===String(conflict.claimed)))shown.push({key,pageIndex,slideId:page.id,pointIndex,withExpression:compact(point.text).includes(conflict.display),params:warning.params,kept});
   });
   for(const id of page?.cardObjects||[])if(String(items.get(id)?.text||'').includes(conflict.excerpt))shown.push({key,pageIndex,slideId:page.id,pointIndex:null,withExpression:true,params:warning.params,kept});
  });
 }
 return shown;
}
export function inspectSourceArithmetic(project){
 const cards=cardsFlow(project),shown=cards?shownArithmeticConflicts(project):[];
 return conflicts(project).flatMap(conflict=>{
  const warning=arithmeticWarning(conflict),key=sourceWarningKey(warning),kept=sourceWarningAcknowledged(project,key,warning);
  const details={expression:conflict.display,calculated:conflict.calculated,claimed:conflict.claimed,excerpt:conflict.excerpt,location:conflict.locations[0],sourceRefs:conflict.sourceRefs,acknowledged:kept};
  const keptMessage='The user kept an original product/count that does not multiply out; it is disclosed, not corrected.';
  // Older decks: a writer may paraphrase the statement anywhere, so the gate stays.
  if(!cards)return [{code:'source_arithmetic_conflict',severity:kept?'warning':'error',repairable:false,sourceRef:conflict.sourceRefs[0],
   message:kept?keptMessage:'The original source has an inconsistent product/count; obtain an authoritative correction rather than silently changing its facts.',details}];
  const pages=shown.filter(item=>item.key===key);
  if(!pages.length)return [{code:'source_arithmetic_conflict',severity:'warning',repairable:false,sourceRef:conflict.sourceRefs[0],message:'The source has a count that does not multiply out; no card shows it.',details}];
  return pages.map(page=>page.withExpression&&!kept
   ?{code:'source_arithmetic_shown',severity:'error',repairable:false,slideId:page.slideId,pageIndex:page.pageIndex,sourceRef:conflict.sourceRefs[0],message:`Page ${page.pageIndex+1} shows ${conflict.display} with ${conflict.claimed}, which does not multiply out (${conflict.calculated}); edit the point or keep the original.`,details:{...details,pointIndex:page.pointIndex}}
   :{code:'source_arithmetic_conflict',severity:'warning',repairable:false,slideId:page.slideId,pageIndex:page.pageIndex,sourceRef:conflict.sourceRefs[0],message:kept?keptMessage:`Page ${page.pageIndex+1} states ${conflict.claimed} from a source count that does not multiply out.`,details:{...details,pointIndex:page.pointIndex}});
 });
}
