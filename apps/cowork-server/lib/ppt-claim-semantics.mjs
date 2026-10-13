/** Explicitly surface claim quantifiers and code-operation scopes to the
 * semantic critic; structured source objects do not certify added prose. */
import {spawnSync} from 'node:child_process';
import {sourceSentences} from './ppt-source-boundaries.mjs';
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
  return {version:1,claims,codeScopes:codes,checks:['entailment against owned source spans','negation, quantifiers, conditions and independence assumptions','code AST receiver/grouping scope; rank without date-groupby does not imply per-date cross-sectional rank','definitions must agree with their cited source; do not invent a meaning for an acronym','role responsibilities do not imply exclusive permissions','unordered alternatives do not imply a mandatory sequence']};
}

import {digest} from './ppt/edit-context.mjs';
export function claimAuditRegistry(project){
 const checklist=claimSemanticsChecklist(project),entries=checklist.claims.filter(c=>c.text.trim()).map(c=>({...c,id:'claim-'+digest([c.slideId,c.nodeId,c.text,c.ownedSourceUnitIds]).slice(0,24),textHash:digest(c.text),writerClaimId:c.claimId,claimId:'claim-'+digest([c.slideId,c.nodeId,c.text,c.ownedSourceUnitIds]).slice(0,24)}));
 const selected=project.reviewScope?.claimIds;
 const scopedEntries=Array.isArray(selected)?entries.filter(entry=>selected.includes(entry.id)):entries;
 const items=project.originalSourceInventory?.items||project.source?.semantic?.inventory?.items||[],ids=new Set(scopedEntries.flatMap(e=>e.ownedSourceUnitIds));
 const sourceQuotes=items.filter(i=>ids.has(i.id)).map(i=>({sourceUnitId:i.id,quoteId:'source-quote-'+digest([i.id,i.text]).slice(0,24),rawHash:digest(i.text),characters:String(i.text||'').length,preview:String(i.text||'').slice(0,180)}));
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
  const supplied=check.sourceEvidence||[];
  if(!Array.isArray(supplied))fail('sourceEvidence must be an array');
  const evidence=supplied.map(e=>{if(!e.quoteId)return e;const q=registry.sourceQuotes.find(q=>q.quoteId===e.quoteId&&q.sourceUnitId===e.sourceUnitId);if(!q)fail('source quote is stale or belongs to another source');const excerpt=e.sourceUnitId==='user_prompt'?String(project.userRequirements||project.prompt||''):String(items.find(i=>i.id===e.sourceUnitId)?.text||'');if(e.excerpt!==undefined&&e.excerpt!==excerpt)fail('source quote conflicts with a literal excerpt');return {...e,excerpt};});
  for(const e of evidence){
   const item=items.find(i=>i.id===e.sourceUnitId),text=e.sourceUnitId==='user_prompt'&&!items.length?String(project.userRequirements||project.prompt||''):String(item?.text||'');
   if(!text||typeof e.excerpt!=='string'||!e.excerpt.trim()||!text.includes(e.excerpt)||item&&!entry.ownedSourceUnitIds.includes(item.id))fail('evidence is not an exact owned source span: '+JSON.stringify({claimId:entry.id,sourceUnitId:e.sourceUnitId,allowedSourceUnitIds:entry.ownedSourceUnitIds,allowedQuotes:registry.sourceQuotes.filter(q=>entry.ownedSourceUnitIds.includes(q.sourceUnitId)).map(q=>({sourceUnitId:q.sourceUnitId,quoteId:q.quoteId})),hint:'Use a current owned sourceUnitId+quoteId without literal excerpt. Unsupported/contradicted claims may use empty evidence; do not borrow another page source.'}));
  }
  if(['entailed','redundant'].includes(check.status)&&!evidence.length)fail('entailed/redundant requires actual owned source evidence: '+JSON.stringify({claimId:entry.id,allowedQuotes:registry.sourceQuotes.filter(q=>entry.ownedSourceUnitIds.includes(q.sourceUnitId)),hint:'Use one current sourceUnitId+quoteId for each supported claim. If no source entails it, return unsupported; do not certify an empty evidence array.'}));
  return {claimId:entry.id,slideId:entry.slideId,nodeId:entry.nodeId,textHash:entry.textHash,status:check.status,reason:check.reason.slice(0,1000),sourceEvidence:evidence};
 });
 return {version:2,registryHash:registry.registryHash,status:value.status,checks};
}
export function claimAuditFailures(audit){return (audit?.checks||[]).filter(c=>c.status!=='entailed').map(c=>({code:c.status==='redundant'?'claim_redundant':'claim_entailment_'+c.status,severity:'error',slideIds:[c.slideId],nodeId:c.nodeId,detail:c.reason}));}
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
