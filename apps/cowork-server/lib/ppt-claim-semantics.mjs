import {allowsEditorialSelection} from './ppt-generation-policy.mjs';
import {contentSelectionMatchesSource} from './ppt-content-selection.mjs';
/** Explicitly surface claim quantifiers and code-operation scopes to the
 * semantic critic; structured source objects do not certify added prose. */
import {spawnSync} from 'node:child_process';
import {sourceSentences} from './ppt-source-boundaries.mjs';
import {visibleNodes,nodeContentText} from './ppt-visible-content.mjs';
const AST=String.raw`import ast,json,sys
try:
 tree=ast.parse(sys.stdin.read())
 calls=[]
 for n in ast.walk(tree):
  if isinstance(n,ast.Call) and isinstance(n.func,ast.Attribute):
   calls.append({'operation':n.func.attr,'expression':ast.unparse(n),'receiver':ast.unparse(n.func.value)})
 print(json.dumps({'status':'parsed','calls':calls}))
except SyntaxError as e:print(json.dumps({'status':'unparsed','reason':str(e)}))`;
const codeScopesCache=new Map();
export function codeOperationScopes(code,python=process.env.PPT_TEST_PYTHON||process.env.PPT_PYTHON||'python3'){
  const key=digest([python,String(code)]);if(codeScopesCache.has(key))return structuredClone(codeScopesCache.get(key));
  const result=spawnSync(python,['-c',AST],{input:String(code),encoding:'utf8',timeout:5000,maxBuffer:1024*1024});
  try{const parsed=JSON.parse(result.stdout);if(parsed.status==='parsed'){if(codeScopesCache.size>=128)codeScopesCache.delete(codeScopesCache.keys().next().value);codeScopesCache.set(key,parsed);}return structuredClone(parsed);}catch{return {status:'unavailable',reason:'Python AST runtime unavailable'};}
}
export function claimSemanticsChecklist(project){
  const source=project.originalSourceInventory?.items||project.source?.semantic?.inventory?.items||[];
  const codes=source.filter(i=>i.type==='CodeBlock'&&/python|py/i.test(i.language||i.codeLanguage||'python')).map(i=>({sourceUnitId:i.id,sourceRefs:i.source_ref,operations:codeOperationScopes(i.text.replace(/^```[^\n]*\n|\n```$/gu,''))}));
  const claims=(project.deck?.slides||[]).flatMap(s=>(s.nodes||[]).filter(n=>(n.semanticRole==='source-explanation'&&!n.sourceArtifact&&!n.content?.sourceEvidenceIds?.length&&!n.content?.derivedFrom||project.source?.semantic?.inventory?.items?.find(i=>i.id===n.sourceArtifact?.sourceUnitId)?.derivedSummary?.summaryMode==='semantic'||project.source?.semantic?.inventory?.items?.find(i=>i.id===n.sourceArtifact?.sourceUnitId)?.languageProjection?.requiresOriginalEntailment)).map(n=>({slideId:s.id,nodeId:n.id,claimId:n.content?.claimId,text:n.content?.richText?.source||n.content?.text||(n.content?.rows||[]).map(row=>row.join(' | ')).join('\n')||(n.content?.items||[]).map(item=>item.text).join('\n')||'',
    quantifiers:sourceSentences(n.content?.text||'').filter(t=>/only|every|always|must|never|全部|每个|每個|仅|僅|必须|必須|不得|唯一|排他/iu.test(t)),ownedSourceUnitIds:[...new Set([...(project.outline?.find(o=>o.id===s.id)?.sourceUnitIds||[]),...(project.contentSelection?.entries||[]).filter(e=>e.visibleEquivalentSourceUnitId&&project.outline?.find(o=>o.id===s.id)?.sourceUnitIds?.includes(e.visibleEquivalentSourceUnitId)).map(e=>e.sourceUnitId)])]})));
  return {version:1,claims,codeScopes:codes,checks:['entailment against owned source spans','negation, quantifiers, conditions and independence assumptions','Evaluate semantic propositions and causal premises, not literal punctuation or connective matching. Restating a relation in two clearly labelled sentences can be faithful; an omitted additive word is not automatically a lost causal condition. Reject an actually missing premise, changed relation or changed certainty, and explain that concrete semantic change.','For ordinary prose, insignificant whitespace beside quotation marks or typographic punctuation alone is not a semantic conflict. Exact source-table cells, code indentation, formula operators, decimal signs, units, negation and actual conditions still require their independent fidelity checks.','code AST receiver/grouping scope; rank without date-groupby does not imply per-date cross-sectional rank','definitions must agree with their cited source; do not invent a meaning for an acronym','role responsibilities do not imply exclusive permissions','unordered alternatives do not imply a mandatory sequence']};
}

import {digest} from './ppt/edit-context.mjs';
const sourceEvidenceTexts=item=>[String(item?.text||''),String(item?.diagramSource?.text||'')].filter(Boolean);
/** Primary ownership governs coverage/repetition. A necessary explanation may
 * use complete prose retained in notes from the SAME semantic chunk, without
 * acquiring another page's primary source ownership or structural coverage. */
export function claimSupportSourceIds(project,owned){
 if(project.generationPolicy?.content!=='overview'||!allowsEditorialSelection(project)||project.generationPolicy?.knowledge!=='source_only'||project.requestedOutline||!contentSelectionMatchesSource(project))return [];
 const items=project.source?.semantic?.inventory?.items||[],chunks=new Set(items.filter(i=>owned.includes(i.id)).flatMap(i=>i.chunkRefs||[]));
 return items.filter(i=>!owned.includes(i.id)&&['notes_by_contract','excluded_by_policy'].includes(i.presentation)&&i.presentationBasis===project.contentSelection.hash&&!i.rows&&!i.diagramSource&&!['CodeBlock','EquationBlock','SourceImage'].includes(i.type)&&project.contentSelection.entries.some(e=>e.sourceUnitId===i.id&&['notes','excluded'].includes(e.destination))&&i.chunkRefs?.some(id=>chunks.has(id))).map(i=>i.id);
}
/** Closing synthesis may cite already visible primary source facts without
 * acquiring coverage ownership. This is an evidence allowlist, never approval. */
export function closingEvidenceSourceIds(project,slideId){
 const outline=project.outline?.find(s=>s.id===slideId);
 if(outline?.role!=='closing'||project.generationPolicy?.knowledge!=='source_only'||!project.source?.sha256||project.confirmedOutline?.sourceHash!==project.source.sha256)return [];
 const original=new Set((project.originalSourceInventory?.items||project.source?.semantic?.inventory?.items||[]).map(i=>i.id));
 const witnesses=project.reviewScope?.fullSourceInstances||[];
 return [...new Set((project.outline||[]).filter(o=>o.id!==slideId&&!['cover','navigation','closing'].includes(o.role)).flatMap(o=>{
  const slide=project.deck?.slides?.find(s=>s.id===o.id)||project.nodes?.[o.id]?.slide;
  return (o.sourceUnitIds||[]).filter(id=>original.has(id)&&(slide&&visibleNodes(slide).some(n=>n.sourceArtifact?.sourceUnitId===id&&nodeContentText(n).trim())||witnesses.some(w=>w.slideId===o.id&&w.sourceUnitId===id&&String(w.text||'').trim())));
 }))];
}
export function claimAuditRegistry(project){
 const checklist=claimSemanticsChecklist(project),entries=checklist.claims.filter(c=>c.text.trim()).map(c=>{
  const supportSourceUnitIds=claimSupportSourceIds(project,c.ownedSourceUnitIds),recapEvidenceSourceUnitIds=closingEvidenceSourceIds(project,c.slideId),permittedEvidenceSourceUnitIds=[...new Set([...c.ownedSourceUnitIds,...supportSourceUnitIds,...recapEvidenceSourceUnitIds])],basis=[c.slideId,c.nodeId,c.text,c.ownedSourceUnitIds],id='claim-'+digest(recapEvidenceSourceUnitIds.length?[...basis,supportSourceUnitIds,recapEvidenceSourceUnitIds]:supportSourceUnitIds.length?[...basis,supportSourceUnitIds]:basis).slice(0,24);
  const orderedEvidenceSpans=[];
  if(supportSourceUnitIds.length){
   const originals=project.originalSourceInventory?.items||project.source?.semantic?.inventory?.items||[],allowed=new Set(permittedEvidenceSourceUnitIds),chunks=new Map();
   originals.forEach((item,position)=>{if(allowed.has(item.id))for(const chunk of item.chunkRefs||[]){if(!chunks.has(chunk))chunks.set(chunk,[]);chunks.get(chunk).push({sourceUnitId:item.id,position,text:String(item.text||'')});}});
   for(const [chunkRef,all]of chunks){
    const runs=[];for(const unit of all){if(!runs.length||unit.position!==runs.at(-1).at(-1).position+1)runs.push([]);runs.at(-1).push(unit);}
    for(const units of runs)if(units.length>1&&units.some(unit=>supportSourceUnitIds.includes(unit.sourceUnitId)))orderedEvidenceSpans.push({chunkRef,units,basis:'Exact consecutive allowed source fragments in original order; resolve subject/predicate references jointly, never bridge an excluded source unit or infer an unrelated relationship'});
   }
  }
  return {...c,...(supportSourceUnitIds.length?{supportSourceUnitIds,orderedEvidenceSpans}:{}),...(recapEvidenceSourceUnitIds.length?{recapEvidenceSourceUnitIds}:{}),permittedEvidenceSourceUnitIds,id,textHash:digest(c.text),writerClaimId:c.claimId,claimId:id};
 });
 const selected=project.reviewScope?.claimIds;
 const scopedEntries=Array.isArray(selected)?entries.filter(entry=>selected.includes(entry.id)):entries;
 const items=project.originalSourceInventory?.items||project.source?.semantic?.inventory?.items||[],ids=new Set(scopedEntries.flatMap(e=>e.permittedEvidenceSourceUnitIds||e.ownedSourceUnitIds));
 const sourceQuotes=items.filter(i=>ids.has(i.id)).flatMap(i=>[
  {sourceUnitId:i.id,quoteId:'source-quote-'+digest([i.id,i.text]).slice(0,24),rawHash:digest(i.text),characters:String(i.text||'').length,preview:String(i.text||'').slice(0,180)},
  ...(i.diagramSource?.text&&i.diagramSource.text!==i.text?[{sourceUnitId:i.id,sourceForm:'original_diagram',quoteId:'source-quote-'+digest([i.id,'original_diagram',i.diagramSource.text]).slice(0,24),rawHash:digest(i.diagramSource.text),characters:i.diagramSource.text.length,preview:i.diagramSource.text.slice(0,700)}]:[])
 ]);
 if(!items.length)sourceQuotes.push({sourceUnitId:'user_prompt',quoteId:'source-quote-'+digest(['user_prompt',project.userRequirements||project.prompt||'']).slice(0,24)});
 return {version:2,registryHash:digest(scopedEntries),slideIds:(project.deck?.slides||[]).map(s=>s.id),entries:scopedEntries,sourceQuotes,codeScopes:checklist.codeScopes};
}
export function normalizeClaimAudit(value,project){
 const registry=claimAuditRegistry(project),fail=message=>{throw Error('invalid whole-deck claim audit: '+message);};
 if(!registry.entries.length)return {version:2,registryHash:registry.registryHash,status:'complete',checks:[]};
 if(value?.registryHash!==registry.registryHash||!['complete','not_evaluated'].includes(value.status)||!Array.isArray(value.checks)||value.checks.length!==registry.entries.length)fail('current registry and every visible added claim exactly once required');
 const items=project.originalSourceInventory?.items||project.source?.semantic?.inventory?.items||[],seen=new Set();
 const checks=value.checks.map(check=>{
  const entry=registry.entries.find(e=>e.id===check.claimId);
  if(!entry||seen.has(entry.id)||!['entailed','unsupported','contradicted','redundant','not_evaluated'].includes(check.status))fail('unknown, duplicate or invalid check '+String(check.claimId)+'; expected '+JSON.stringify(registry.entries.map(e=>e.id)));seen.add(entry.id);
  if(check.textHash!==entry.textHash||typeof check.reason!=='string'||!check.reason.trim())fail('current text hash and reason required');
  const permitted=entry.permittedEvidenceSourceUnitIds||entry.ownedSourceUnitIds;
  const supplied=check.sourceEvidence||[];
  if(!Array.isArray(supplied))fail('sourceEvidence must be an array');
  const evidence=supplied.map(e=>{if(!e.quoteId)return e;const q=registry.sourceQuotes.find(q=>q.quoteId===e.quoteId&&q.sourceUnitId===e.sourceUnitId);if(!q)fail('source quote is stale or belongs to another source');const excerpt=e.sourceUnitId==='user_prompt'?String(project.userRequirements||project.prompt||''):String(q.sourceForm==='original_diagram'?items.find(i=>i.id===e.sourceUnitId)?.diagramSource?.text||'':items.find(i=>i.id===e.sourceUnitId)?.text||'');if(e.excerpt!==undefined&&e.excerpt!==excerpt)fail('source quote conflicts with a literal excerpt');return {...e,excerpt};});
  for(const e of evidence){
   const item=items.find(i=>i.id===e.sourceUnitId),texts=e.sourceUnitId==='user_prompt'&&!items.length?[String(project.userRequirements||project.prompt||'')]:sourceEvidenceTexts(item);
   if(!texts.length||typeof e.excerpt!=='string'||!e.excerpt.trim()||!texts.some(text=>text.includes(e.excerpt))||item&&!permitted.includes(item.id))fail('evidence is not an exact owned source span or permitted same-chunk note: '+JSON.stringify({claimId:entry.id,sourceUnitId:e.sourceUnitId,allowedSourceUnitIds:permitted,allowedQuotes:registry.sourceQuotes.filter(q=>permitted.includes(q.sourceUnitId)).map(q=>({sourceUnitId:q.sourceUnitId,quoteId:q.quoteId})),hint:'Use a current primary or same-chunk retained-note sourceUnitId+quoteId without literal excerpt. Unsupported/contradicted claims may use empty evidence; do not borrow another page primary source.'}));
  }
  if(['entailed','redundant'].includes(check.status)&&!evidence.length)fail('entailed/redundant requires actual owned source evidence: '+JSON.stringify({claimId:entry.id,allowedQuotes:registry.sourceQuotes.filter(q=>permitted.includes(q.sourceUnitId)),hint:'Use one current sourceUnitId+quoteId for each supported claim. If no source entails it, return unsupported; do not certify an empty evidence array.'}));
  return {claimId:entry.id,slideId:entry.slideId,nodeId:entry.nodeId,textHash:entry.textHash,status:check.status,reason:check.reason.slice(0,1000),sourceEvidence:evidence};
 });
 return {version:2,registryHash:registry.registryHash,status:value.status,checks};
}
export function claimAuditFailures(audit){return (audit?.checks||[]).filter(c=>c.status!=='entailed').map(c=>({code:c.status==='redundant'?'claim_redundant':'claim_entailment_'+c.status,severity:'error',slideIds:[c.slideId],nodeId:c.nodeId,detail:c.reason}));}
/** Claim-audit failures are mirrored into the review's repeated/unsupported
 * lists (origin 'claim_audit'). The mirror is rebuilt from the given audit, so
 * a claim the independent confirmation found entailed leaves no stale finding
 * (real run 2026-10-22: an overturned verdict still blocked publication). A
 * mirror persisted before the origin tag is recognized by its code and severity. */
export const isClaimAuditMirror=item=>item?.origin==='claim_audit'||Boolean(item?.severity)&&/^claim_(?:entailment_|redundant$)/u.test(item?.code||'');
export function withClaimAuditFindings(review,claimAudit){
 const mirror=isClaimAuditMirror;
 const failures=claimAuditFailures(claimAudit).map(f=>({...f,origin:'claim_audit'}));
 return {...review,...(claimAudit?{claimAudit}:{}),
  repeated:[...(review.repeated||[]).filter(item=>!mirror(item)),...failures.filter(f=>f.code==='claim_redundant')],
  unsupported:[...(review.unsupported||[]).filter(item=>!mirror(item)),...failures.filter(f=>f.code!=='claim_redundant').map(f=>({...f,reason:'unsupported_fact'}))]};
}
/** Narrow deterministic contradiction: a direct pandas column rank has no
 * date grouping. Other code/aliases remain critic work, never guessed here. */
export function inspectCodeClaimScopes(project){
 const registry=claimAuditRegistry(project),items=project.source?.semantic?.inventory?.items||[],issues=[];
 for(const claim of registry.entries){
  const scopes=registry.codeScopes.filter(c=>claim.ownedSourceUnitIds.includes(c.sourceUnitId));
  // Grouping belongs to this rank receiver, not to any other call in the
  // function. Alpha's vol20.rank and date-grouped alpha_rank coexist.
  const code=scopes.find(c=>{
    if(c.operations.status!=='parsed'||!/pd\.DataFrame|import pandas/.test(items.find(i=>i.id===c.sourceUnitId)?.text||''))return false;
    const ranks=c.operations.calls.filter(a=>a.operation==='rank');
    return ranks.some(a=>! /\.groupby\(/.test(a.receiver)&&(
      /df\[/.test(a.receiver)&&ranks.length===1||
      /^[A-Za-z_]\w*$/.test(a.receiver)&&new RegExp('\\b'+a.receiver+'\\b','u').test(claim.text)));
  });
  if(!code)continue;
  for(const sentence of sourceSentences(claim.text))if(/rank|排名|秩变换|秩變換/iu.test(sentence)&&/per.?date|within (?:each|a) date|by date|cross.sectional|按(?:交易)?(?:日|日期)|每日|每个交易日|每個交易日|横截面|橫截面/iu.test(sentence)&&!/does not|do not|not (?:per|within|by|cross)|并非|並非|不是|不(?:会|會|按)|未按/iu.test(sentence))issues.push({code:'source_code_scope_conflict',severity:'error',slideId:claim.slideId,nodeId:claim.nodeId,sourceUnitId:code.sourceUnitId,repairable:true,message:'Visible explanation claims date-grouped rank, but the owned pandas AST performs direct whole-column rank with no groupby. Preserve code and correct only the explanation.',sourceOperations:code.operations.calls});
 }
 return issues;
}
