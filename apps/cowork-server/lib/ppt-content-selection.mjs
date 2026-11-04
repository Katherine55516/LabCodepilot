import {validProseMedia,proseMediaItem} from './ppt-prose-media.mjs';
import{editorialSelectionScope}from'./ppt-editorial-contract.mjs';
import {obligationSelectionIssues} from './ppt-explanation-obligations.mjs';
import {tableProjection} from './ppt-table-projection.mjs';
import {allowsEditorialSelection} from './ppt-generation-policy.mjs';
import {auditedLanguagePairTargets,languagePairCandidates} from './ppt-language-pair-audit.mjs';
import {projectedSourceItem} from './ppt-language-projection.mjs';
import {sourcePointListKind,isSourceReferenceList}from './ppt-source-list-kinds.mjs';
import {sourceScriptOf}from './ppt-presentation-policy.mjs';
import crypto from 'node:crypto';
import {sourceSentences} from './ppt-source-boundaries.mjs';
import {primaryLanguageEquivalents,concisionApplies,visibleRequiredSentence,overviewMainIdeaUnitIds} from './ppt-outline-concision.mjs';
const hash=v=>crypto.createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
const factualNumber=/[-+]?\d+(?:[.,]\d+)*(?:%|％)?/u;
const mandatorySentence=(item,sentence,index)=>item.type!=='CodeBlock'&&(item.mainIdeaRequired===true&&index===0||critical.test(sentence)||item.type==='DefinitionBlock'&&index===0||factualNumber.test(sentence)&&(item.priority==='high'||['DefinitionBlock','EquationBlock','SummaryBlock','ConstraintBlock'].includes(item.type)||/risk|confidence|sample|threshold|independen|candidate|cost|capacity|turnover|multiple|trial|PBO|ICIR|Sharpe|交易日|独立|獨立|候选|候選|置信|风险|風險|成本|容量|阈值|門檻/iu.test(sentence)));
const critical=/\b(?:unless|except|only|solely|limited to|provided that|must|shall|not|never|without|uncertain|unknown|inference|inferred|likely|not disclosed|risk|limitation|bias|liquidity|transaction cost|data mining)\b|不得|不能|僅|仅|只有|除非|否則|否则|例外|不確定|不确定|前提|必須|必须|禁止|風險|风险|限制|偏誤|偏误|流動性|流动性|推断|推斷|推测|推測|很可能|未公开|未公開|未知/iu;
// Workflow summaries need actual task variety. Recognize only explicit task
// labels, never infer a family from row position or a generated description.
function workflowCoverage(rows){
 if(!/\bworkflows?\b|工作流/iu.test(String(rows[0]?.[0]))||! /\bpipeline\b|管线|管線|流程|步骤|步驟/iu.test(String(rows[0]?.[1])))return {rowGroups:[],requiredRows:[]};
 const families=[
  ['creation',/\b(?:create|creation|generate|generation|import)\b|(?:→|->)\s*(?:deck|slides?|presentation)\b|创建|建立|生成|导入|導入/iu],
  ['mutation',/\b(?:edit|modify|mutation|restyle|replace|add)\b|编辑|編輯|修改|重排|换图|換圖|替换|替換|新增/iu],
  ['collaboration',/\bcollaborat\w*\b|协作|協作|协同|協同/iu],
  ['delivery',/\b(?:publish|export|share|download|deliver)\b|发布|發佈|發布|导出|導出|匯出|分享|交付|下载|下載/iu],
  ['observability',/\b(?:analytics|telemetry|observability|monitoring)\b|统计|統計|监控|監控/iu]
 ];
 const rowGroups=families.map(([family,pattern])=>({family,anyOfRowIndices:rows.flatMap((r,i)=>i&&pattern.test(String(r[0]))?[i]:[])})).filter(group=>group.anyOfRowIndices.length);
 const requiredRows=rows.flatMap((r,i)=>i&&/\bdeterministic\s+(?:compute|computation|calculat\w*)\b|确定性计算|確定性計算/iu.test(r.join(' '))?[i]:[]);
 return {rowGroups:rowGroups.length>1?rowGroups:[],requiredRows};
}
/** A comparison needs a comparison set, not an arbitrary single correct row.
 * Small sets retain every candidate; large sets retain at least two plus risks.
 * Explicit user-authored page scopes remain authoritative. */
export function comparisonTableSelection(project,item){
 const rows=item.rows||[];
 if(project.requestedOutline||rows.length<3||rows[0]?.length<2)return null;
 const header=rows[0].join(' ');
 const labels=rows.slice(1).map(row=>String(row[0]).trim()).filter(Boolean);
 const comparison=/\b(?:models?|methods?|options?|approaches?|architectures?|modes?|types?|workflows?)\b|模型|方法|方案|类型|類型|模式|工作流/iu.test(header)&&new Set(labels).size>1;
 if(!comparison)return null;
 const workflow=workflowCoverage(rows);
 return {minimumDataRows:Math.min(2,rows.length-1),requiredRowIndices:[...new Set([...(rows.length<=9?rows.slice(1).map((_,index)=>index+1):[]),...workflow.requiredRows])],...(workflow.rowGroups.length?{requiredRowGroups:workflow.rowGroups}:{}),basis:'retain-comparison-set'};
}
/** A parser-protected field/value example may show representative ORIGINAL
 * rows in an automatic overview. This never relaxes an explicit must-display
 * request, ordinary tables, processes, geometry or the complete-source mode. */
export function schemaExampleSelection(project,item){
 const retained=project.nativeTitleRepairSeed?.selectionAuthorization;
 const sameContract=retained&&retained.sourceHash===project.source?.sha256&&retained.sourceRevision===(project.sourceRevision||0)&&retained.ledgerHash===project.contentSelection?.hash&&hash(retained.policy)===hash(project.generationPolicy)&&retained.userRequirements===String(project.userRequirements||'')&&hash(retained.constraints)===hash(project.constraints?.entries||[]);
 const frozenExample=Boolean((project.confirmedOutline||sameContract)&&contentSelectionMatchesSource(project)&&project.contentSelection.entries.some(e=>e.sourceUnitId===item.id&&e.destination==='summary'&&Array.isArray(e.rowIndices)));
 if(!concisionApplies(project)||project.pageDecision?.mode!=='auto'&&!frozenExample||!allowsEditorialSelection(project)||project.generationPolicy?.knowledge!=='source_only'||String(project.userRequirements||'').trim()||project.constraints?.entries?.some(e=>e.active)||item.explicitMustDisplay||item.sourceStructureOrigin!=='parsed-source-diagram'||item.type!=='TableBlock'||item.diagramSource?.kind!=='schema'||item.diagramSource?.relation!=='field-value'||!item.diagramSource.text||item.rows?.[0]?.length!==2||item.rows.length<3)return null;
 const requiredRowIndices=item.rows.flatMap((row,index)=>{
  const label=String(row[0]||'').replace(/([a-z])([A-Z])/gu,'$1 $2').replace(/[_-]/gu,' ');
  return index&&factualNumber.test(row.slice(1).join(' '))&&/\b(?:min|max|minimum|maximum|threshold|limit|budget|confidence|risk|cost|capacity|fee|slippage|alpha|pbo|ic|icir|sharpe|trials?|samples?|candidates?)\b|阈值|閾值|門檻|置信|风险|風險|成本|费用|費用|容量|预算|預算|上限|下限|最小|最大|最低|最高/iu.test(label)?[index]:[];
 });
 return {minimumDataRows:Math.min(2,item.rows.length-1),requiredRowIndices,basis:project.generationPolicy?.version===2?'parser-protected-field-value-example; exact representative rows; original retained in project':'parser-protected-field-value-example; original rows only; complete original retained in notes'};
}
export function mandatorySelectionFacts(project){
 const validSelection=contentSelectionMatchesSource(project);
 return (project.source?.semantic?.inventory?.items||[]).flatMap(item=>{
  const entry=validSelection&&project.contentSelection.entries.find(e=>e.sourceUnitId===item.id);
  if(referenceNotesContract(project,item)||['notes','excluded'].includes(entry?.destination)&&referenceNotesEligible(project,item))return [];
  // The authorized field example keeps original optional values in notes.
  // Do not reintroduce an omitted example value as a main-deck numeric fact.
  // Ordinary tables, conditions, user scope and stale ledgers keep full audit.
  const selectedExample=entry?.destination==='summary'&&Array.isArray(entry.rowIndices)&&schemaExampleSelection(project,item);
  const text=selectedExample?[item.rows[0],...[...new Set([...entry.rowIndices,...selectedExample.requiredRowIndices])].sort((a,b)=>a-b).map(row=>item.rows[row])].map(row=>row.join(' | ')).join('\n'):item.text||'';
  return sourceSentences(text).filter((s,index)=>mandatorySentence(item,s,index)).map(text=>({sourceUnitId:item.id,text:text.trim()}));
 });
}
/** Shared with the outline compiler so corrections use the same rules. */
export const isMandatorySentence=(item,sentence,index)=>mandatorySentence(item,sentence,index);
export const isCriticalCondition=text=>critical.test(text);
export function visibleEquivalentCandidates(project,item){
 const audited=auditedLanguagePairTargets(project,item);if(audited.length)return audited;
 if(project.languagePairAudit?.version===2&&languagePairCandidates(project).some(pair=>pair.sourceUnitId===item.id))return []; // An explicit false/unresolved audit cannot fall back to heuristic deduplication.
 const policy=project.generationPolicy,items=project.originalSourceInventory?.items||project.source?.semantic?.inventory?.items||[];
 if(policy?.content!=='overview'||!allowsEditorialSelection({generationPolicy:policy})||!item.languagePairId||item.mustDisplay||item.rows||sourcePointListKind(item)||['EquationBlock','CodeBlock','ProcessBlock','ChecklistBlock','TaxonomyBlock'].includes(item.type))return [];
 // Source languages with a single body language: the translation side of a
 // detected pair is carried by its original (outline concision, item 3).
 if(policy.language?.mode==='source')return primaryLanguageEquivalents(project,item,items);
 if(policy.language?.mode!=='output')return [];
 const target=policy.language.locale==='en'?'latin':'han',source=sourceScriptOf(item.text);
 // Reuse the pairing classifier. A few Chinese names inside English prose
 // (e.g. A 股 / 涨跌停) do not make it a Chinese target-language owner.
 if(source==='mixed'||source===target)return [];
 return items.filter(other=>other.id!==item.id&&other.languagePairId===item.languagePairId&&sourceScriptOf(other.text)===target).map(other=>other.id);
}
/** New extractive summaries retain an explicit source premise/back-reference
 * together. Existing confirmed ledgers keep their frozen contract. */
function extractiveInferencePairs(project,item){
 if(!concisionApplies(project)||!allowsEditorialSelection(project)||project.pageDecision?.mode!=='auto'||project.confirmedOutline||project.pageDecision?.confirmedAt||item.rows)return [];
 return sourceSentences(item.text||'').flatMap((text,index)=>index>0&&/^(?:(?:这|這)(?:意味着|意味著|表明)|(?:this|that)\s+(?:means|implies|suggests|indicates)\b)/iu.test(text.trim())?[[index-1,index]]:[]);
}
/** A plain bibliography is source provenance, not a checklist obligation.
 * Only the new automatic overview/notes contract defaults it to full notes.
 * Explicit user scope, preserved decks and substantive annotated lists retain
 * their existing visible-source contract. */
function referenceNotesEligible(project,item){
 return Boolean(concisionApplies(project)&&allowsEditorialSelection(project)&&!String(project.userRequirements||'').trim()&&!project.constraints?.entries?.some(e=>e.active)&&!item.mustDisplay&&!item.explicitMustDisplay&&isSourceReferenceList(item)&&!critical.test(String(item.text||'').replace(/\]\(https?:\/\/[^)]*\)/gu,']')));
}
export function referenceNotesContract(project,item){return referenceNotesEligible(project,item)&&project.pageDecision?.mode==='auto'&&!project.confirmedOutline&&!project.pageDecision?.confirmedAt;}
export function selectionConstraints(project){
 const inventory=project.originalSourceInventory||project.source?.semantic?.inventory||{items:[],relationships:[]},items=inventory.items;
 const mainIdeas=new Set(overviewMainIdeaUnitIds(project)),editorial=editorialSelectionScope(project);
 const rules=items.map(item=>{
 const mandatorySentenceIndices=referenceNotesContract(project,item)?[]:sourceSentences(item.text||'').flatMap((s,i)=>mandatorySentence(item,s,i)?[i]:[]),inferencePairs=extractiveInferencePairs(project,item);
 const projectedTargets=visibleEquivalentCandidates(project,item);
 // Overview: only definitions and hard conditions pin a unit to the slide;
 // the broader mandatory set still binds any summary (outline concision, item 4).
 const visibleRequired=concisionApplies(project)?sourceSentences(item.text||'').some((s,i)=>visibleRequiredSentence(item,s,i)):mandatorySentenceIndices.length>0;
 const referenceNotes=referenceNotesContract(project,item);
 const requiresMainWithoutProjection=!referenceNotesEligible(project,item)&&(!editorial&&mainIdeas.has(item.id)||item.mainIdeaRequired===true||item.type==='CodeBlock'&&project.generationPolicy?.code?.presentation==='keep'||item.mustDisplay===true||item.explicitMustDisplay===true||!editorial&&(Boolean(sourcePointListKind(item))||['DefinitionBlock','ChecklistBlock','ProcessBlock'].includes(item.type)||visibleRequired));
 const notesBlocked=!projectedTargets.length&&requiresMainWithoutProjection;
 const schema=schemaExampleSelection(project,item);
 const pointKind=sourcePointListKind(item);
 const summaryBlocked=Boolean(pointKind&&pointKind!=='TaxonomyBlock')||item.mustDisplay===true&&!schema||['EquationBlock','CodeBlock','ChecklistBlock'].includes(item.type);
 const codeNotes=item.type==='CodeBlock'&&item.codeKind!=='config'&&allowsEditorialSelection(project)&&project.generationPolicy?.code?.presentation==='omit';
 const comparison=comparisonTableSelection(project,item);
 return {sourceUnitId:item.id,...(pointKind==='TaxonomyBlock'||item.type==='ProcessBlock'?{summaryGraphOnly:true}:{}),allowedDestinations:referenceNotes||codeNotes||projectedTargets.length?['notes']:['slides',...(!notesBlocked?['notes']:[]),...(!summaryBlocked?['summary']:[])],notesWithoutVisibleEquivalentAllowed:referenceNotes||codeNotes||!requiresMainWithoutProjection,...(referenceNotes?{referenceRule:'Complete original link list in speaker notes; evidence qualifiers remain visible with their claims. Not a dedicated references page.'}:{}),...(editorial&&!item.rows&&!sourcePointListKind(item)&&!['EquationBlock','CodeBlock','ProcessBlock','ChecklistBlock'].includes(item.type)?{semanticSummaryRule:'Audit every actually retained assertion and its necessary qualification against the complete original. Distinct optional original claims, derivations, history and examples need not be copied. Complete-source core coverage is checked independently.',extractiveOnly:{mandatorySentenceIndices,...(inferencePairs.length?{extractiveInferencePairs:inferencePairs}:{})}}:{mandatorySentenceIndices,...(inferencePairs.length?{extractiveInferencePairs:inferencePairs,summaryRelationshipRule:'Keep each selected premise and its explicit this-means/implies inference together; semantic summaries must preserve their relationship too.'}:{})}),...(schema?{schemaExample:schema}:{}),...(projectedTargets.length?{visibleEquivalentSourceUnitIds:projectedTargets,notesRequireVisibleEquivalent:requiresMainWithoutProjection}:{}),...(item.rows?{mandatoryRowIndices:[...new Set([...item.rows.flatMap((row,i)=>i&&critical.test(row.join(' '))?[i]:[]),...(comparison?.requiredRowIndices||[]),...(schema?.requiredRowIndices||[])])],...(comparison?{comparisonSet:comparison}:{})}:{})};
});
 const byId=new Map(rules.map(rule=>[rule.sourceUnitId,rule]));
 const pairs=project.generationPolicy?.language?.mode==='source'?[...new Set(items.map(item=>item.languagePairId).filter(Boolean))].map(pair=>({unitIds:items.filter(item=>item.languagePairId===pair).map(item=>item.id)})):[];
 // Related definitions/variables and parallel languages share one disposition.
 // Feed this closure into constrained decoding, rather than reject a individually
 // legal equation-in-notes choice only after the whole outline has been written.
 let changed=true;while(changed){changed=false;
  for(const relation of [...(editorial?[]:inventory.relationships||[]),...pairs]){
   const members=(relation.unitIds||[]).map(id=>byId.get(id)).filter(Boolean);
   if(!members.some(rule=>!rule.allowedDestinations.includes('notes')&&rule.allowedDestinations.some(d=>d==='slides'||d==='summary')))continue;
   for(const rule of members)if(rule.allowedDestinations.includes('notes')&&rule.allowedDestinations.some(d=>d==='slides'||d==='summary')){rule.allowedDestinations=rule.allowedDestinations.filter(d=>d!=='notes');rule.notesWithoutVisibleEquivalentAllowed=false;rule.relatedPrimaryOwnershipRequired=true;changed=true;}
  }
 }
 return project.generationPolicy?.version===2?rules.map(rule=>({...rule,allowedDestinations:rule.allowedDestinations.map(d=>d==='notes'?'excluded':d),...(rule.referenceRule?{referenceRule:'Reference provenance retained in the project; no full-source speaker notes or separate references-only card.'}:{})})):rules;
}
function invalid(message,details){throw Object.assign(new Error('ppt_content_selection_invalid: '+message),{code:'coverage_invalid',outlineContract:true,details});}
/** Exact same disposition/summary/row payload repeated with a different
 * non-visible reason is one contract entry. Conflicting payloads stay invalid. */
export function coalesceEquivalentSelections(raw){
 if(raw?.version!==2||!Array.isArray(raw.selection))return raw;
 const keys=new Set(),selection=[];
 for(const entry of raw.selection){
  const key=JSON.stringify(Object.fromEntries(Object.entries(entry).filter(([field])=>field!=='reason').sort(([a],[b])=>a.localeCompare(b))));
  if(keys.has(key))continue;
  keys.add(key);selection.push(entry);
 }
 return selection.length===raw.selection.length?raw:{...raw,selection,selectionCoalescence:{removedExactDuplicates:raw.selection.length-selection.length,basis:'same-source-disposition-and-complete-payload; reason-metadata-only'}};
}
/** The selection ledger is a separate contract. Original text/rows are never
 * shortened. Notes are explicitly enabled by the creation policy, not inferred
 * from a small requested page count. */
/** Major source topics under the overview editorial scope: the chapter of each
 * reader main-idea unit needs at least one visible source. Returns the topics
 * with none (section, representative and its language pair, all chapter
 * members). Shared by the selection gate and the editorial-selection apply check. */
const topicSectionOf=item=>String(item?.sectionPath?.[item.sectionPath.length>1?1:0]||'');
function absentMajorTopics(project,selection){
 const items=project.originalSourceInventory?.items||project.source?.semantic?.inventory?.items||[],byId=new Map(items.map(item=>[item.id,item]));
 const visible=new Set((selection||[]).filter(entry=>['slides','summary'].includes(entry.destination)).map(entry=>topicSectionOf(byId.get(entry.sourceUnitId))));
 return overviewMainIdeaUnitIds(project).map(id=>byId.get(id)).filter(Boolean).filter(item=>!visible.has(topicSectionOf(item))).map(item=>{const section=topicSectionOf(item);return{section,representativeSourceUnitId:item.id,sourceUnitIds:item.languagePairId?items.filter(peer=>peer.languagePairId===item.languagePairId).map(peer=>peer.id):[item.id],memberIds:items.filter(peer=>topicSectionOf(peer)===section).map(peer=>peer.id)};});
}
/** Source-language rule for a semantic summary (source mode, no single target
 * language): the summary keeps its source unit's script. Returns the conflict
 * or null; shared by the selection gate and the deterministic fallback. */
function sourceLanguageSummaryConflict(project,item,summaryText){
 const policy=project.generationPolicy||{};
 if(!item||typeof summaryText!=='string'||policy.language?.mode!=='source')return null;
 const targetLanguage=policy.language.body==='primary'?project.inputUnderstanding?.primaryLanguage:null;if(targetLanguage)return null;
 const containsParallelProse=/[\u3400-\u9fff]/u.test(item.text)&&((item.text.match(/\b[A-Za-z]{3,}\b/gu)||[]).length>=25);
 const originalScript=policy.version===2&&policy.language.body==='primary'&&containsParallelProse?'mixed':sourceScriptOf(item.text),summaryScript=sourceScriptOf(summaryText);
 return originalScript!=='mixed'&&originalScript!==summaryScript?{sourceUnitId:item.id,originalScript,summaryScript}:null;
}
export function compileContentSelection(project,raw){
 if(!raw?.selection?.length)return null;
 const policy=project.generationPolicy;
 if(policy?.content==='full_source'||!allowsEditorialSelection({generationPolicy:policy}))invalid('This contract does not permit moving source content into notes.');
 const items=project.originalSourceInventory?.items||project.source?.semantic?.inventory?.items||[],byId=new Map(items.map(i=>[i.id,i]));
 const constraintsById=new Map(selectionConstraints(project).map(rule=>[rule.sourceUnitId,rule]));
 // A table can be assigned through exact original row ranges without also
 // requesting the full object in sourceUnitIds. Treat only validated native
 // table ranges as ownership; malformed ranges cannot satisfy this contract.
 const pageOwns=(slide,id)=>(slide.sourceUnitIds||[]).includes(id)||(slide.sourceArtifactRanges||[]).some(ref=>{
  const item=byId.get(ref.sourceUnitId);
  const selection=raw.selection.find(entry=>entry.sourceUnitId===id);
  const rowCount=selection?.destination==='summary'&&Array.isArray(selection.rowIndices)?selection.rowIndices.length+1:item?.rows?.length;
  return ref.sourceUnitId===id&&Array.isArray(item?.rows)&&Number.isInteger(ref.rowStart)&&Number.isInteger(ref.rowEnd)&&ref.rowStart>=1&&ref.rowEnd>ref.rowStart&&ref.rowEnd<=rowCount;
 });
 const owned=new Set(items.filter(item=>raw.slides.some(slide=>pageOwns(slide,item.id))).map(item=>item.id)),seen=new Set(),entries=[];
 const counts=new Map();for(const entry of raw.selection)counts.set(entry.sourceUnitId,(counts.get(entry.sourceUnitId)||0)+1);
 const missingIds=items.filter(item=>!item.presentation&&!counts.has(item.id)).map(item=>item.id),duplicateIds=[...counts].filter(([,count])=>count>1).map(([id])=>id),unknownIds=[...counts.keys()].filter(id=>!byId.has(id));
 if(missingIds.length||duplicateIds.length||unknownIds.length)invalid('Every source unit requires exactly one explicit disposition.',{missingIds,duplicateIds,unknownIds,requiredCorrection:'Replace existing entries by sourceUnitId; do not append a second disposition when correcting one. Return every original ID exactly once.'});
 const conflicts=raw.selection.flatMap(entry=>{
  const rule=constraintsById.get(entry.sourceUnitId),owningPageIndexes=raw.slides.flatMap((slide,index)=>pageOwns(slide,entry.sourceUnitId)?[index]:[]);
  const wrongDestination=!rule?.allowedDestinations.includes(entry.destination),wrongOwnership=['notes','excluded'].includes(entry.destination)?owned.has(entry.sourceUnitId):['slides','summary'].includes(entry.destination)&&!owned.has(entry.sourceUnitId);
  const equivalent=entry.visibleEquivalentSourceUnitId, wrongEquivalent=Boolean(equivalent)&&(!['notes','excluded'].includes(entry.destination)||!rule?.visibleEquivalentSourceUnitIds?.includes(equivalent)||!owned.has(equivalent)||!raw.selection.some(e=>e.sourceUnitId===equivalent&&['slides','summary'].includes(e.destination)));
  return wrongDestination||wrongOwnership||wrongEquivalent?[{sourceUnitId:entry.sourceUnitId,destination:entry.destination,allowedDestinations:rule?.allowedDestinations,visibleEquivalentSourceUnitIds:rule?.visibleEquivalentSourceUnitIds,invalidVisibleEquivalent:wrongEquivalent?equivalent:undefined,owningPageIndexes}]:[];
 });
 if(conflicts.length)invalid('Disposition or primary ownership violates the explicit presentation contract.',{conflicts,requiredCorrection:'Repair ALL listed conflicts together: notes IDs cannot occupy slide.sourceUnitIds or table ranges; slides/summary IDs require an actual owner. Use the allowed destination and a real target-language owner for protected bilingual projection. Do not duplicate entries.'});
 const structuredConflicts=raw.selection.filter(entry=>entry.destination==='summary'&&entry.summaryGraph===undefined&&!byId.get(entry.sourceUnitId)?.rows&&(sourcePointListKind(byId.get(entry.sourceUnitId)||{})||['EquationBlock','CodeBlock','ProcessBlock','ChecklistBlock'].includes(byId.get(entry.sourceUnitId)?.type)));
 if(structuredConflicts.length)invalid('Structured objects require their complete representation or an eligible exact source-quoted graph.',{sourceUnitIds:structuredConflicts.map(e=>e.sourceUnitId),structuredSummaryConflicts:structuredConflicts});
 const summaryConflicts=raw.selection.filter(entry=>entry.destination==='summary'&&entry.summaryText===undefined&&Array.isArray(entry.sentenceIndices)).flatMap(entry=>{const item=byId.get(entry.sourceUnitId);if(!item||item.rows)return [];const sentences=sourceSentences(item.text||''),pairs=extractiveInferencePairs(project,item).filter(pair=>pair.some(index=>entry.sentenceIndices.includes(index))),required=[...new Set([...sentences.flatMap((text,i)=>mandatorySentence(item,text,i)?[i]:[]),...pairs.flat()])];return item.type==='DefinitionBlock'&&!entry.sentenceIndices.includes(0)||required.some(index=>!entry.sentenceIndices.includes(index))?[{...entry,requiredSentenceIndices:required}]:[];});
 if(summaryConflicts.length)invalid('A summary cannot omit its definition, explicit condition/risk or selected premise/inference pair.',{summaryConflicts});
 for(const entry of raw.selection){
  const item=byId.get(entry.sourceUnitId);
  if(!item||seen.has(item.id)||!['slides','notes','excluded','summary'].includes(entry.destination)||typeof entry.reason!=='string'||!entry.reason.trim()||entry.reason.length>240)invalid('Invalid or duplicated source disposition.',entry);
  seen.add(item.id);
  const rule=constraintsById.get(item.id);
  if(!rule?.allowedDestinations.includes(entry.destination))invalid('Disposition violates the explicit source presentation contract.',{entry,allowedDestinations:rule?.allowedDestinations,visibleEquivalentSourceUnitIds:rule?.visibleEquivalentSourceUnitIds,requiredCorrection:'Use an allowed destination. In the single-output-language overview contract, the other-language detected pair belongs in notes; its real target-language primary owner carries the required facts.'});
  if(['slides','summary'].includes(entry.destination)&&!owned.has(item.id)||['notes','excluded'].includes(entry.destination)&&owned.has(item.id))invalid('Slide ownership contradicts the disposition.',{sourceUnitId:item.id,destination:entry.destination,owningPageIndexes:raw.slides.flatMap((slide,index)=>pageOwns(slide,item.id)?[index]:[]),requiredCorrection:['notes','excluded'].includes(entry.destination)?'Remove this ID from ALL slide.sourceUnitIds and sourceArtifactRanges; complete original remains in project source storage under the active archival policy. Preserve visibleEquivalentSourceUnitId and its actual target owner when required.':'Assign this ID to a primary slide.sourceUnitIds or a valid original table row range; keep its current summary and all mandatory facts.'});
  const equivalent=entry.visibleEquivalentSourceUnitId||undefined;
  if(equivalent!==undefined&&(!['notes','excluded'].includes(entry.destination)||!visibleEquivalentCandidates(project,item).includes(equivalent)||!owned.has(equivalent)||!raw.selection.some(e=>e.sourceUnitId===equivalent&&['slides','summary'].includes(e.destination))))invalid('A language projection requires an actual target-language primary owner in the same source pair; pair metadata alone is not entailment proof.',{
    entry,allowedTargetOwners:visibleEquivalentCandidates(project,item).map(id=>({sourceUnitId:id,destination:raw.selection.find(e=>e.sourceUnitId===id)?.destination,owningPageIndexes:raw.slides.flatMap((s,index)=>s.sourceUnitIds?.includes(id)?[index]:[])})),
    requiredCorrection:'Use ONLY an allowed target ID. Its selection destination must be slides or summary AND it must occur in an actual primary slide.sourceUnitIds. The notes source ID must not occur in any slide.sourceUnitIds. Never project both sides to notes or reference the source ID itself.'});
  if(!editorialSelectionScope(project)&&['notes','excluded'].includes(entry.destination)&&!equivalent&&!referenceNotesEligible(project,item)&&(item.type==='CodeBlock'&&project.generationPolicy?.code?.presentation==='keep'||item.mustDisplay===true||item.type==='DefinitionBlock'||item.type==='ChecklistBlock'||item.type==='ProcessBlock'||sourceSentences(item.text||'').some((s,i)=>concisionApplies(project)?visibleRequiredSentence(item,s,i):mandatorySentence(item,s,i))))invalid('A definition or explicit condition/risk needs a main-slide owner.',{sourceUnitId:item.id});
  if(entry.destination==='summary'){
   if(entry.summaryGraph!==undefined){
    if(policy.content!=='overview'||item.rows||['CodeBlock','EquationBlock'].includes(item.type)||entry.summaryText!==undefined||entry.sentenceIndices!==undefined||!validProseMedia(item,entry.summaryGraph))invalid('Prose media requires exact source-quoted nodes and edge evidence; independent entailment remains required.',{...entry,rule:'prose_media_graph'});
   }
   if(item.rows&&entry.summaryText!==undefined)invalid('Tables retain exact selected original cells; semantic summary text is not a table replacement.',entry);
   const schema=schemaExampleSelection(project,item);
   if(item.mustDisplay===true&&!schema)invalid('A must-display unit cannot become a summary.',entry);
   if(item.type==='TableBlock'){
    const selected=entry.rowIndices;
    if(!Array.isArray(selected)||!selected.length||new Set(selected).size!==selected.length||selected.some((r,i)=>!Number.isInteger(r)||r<1||r>=item.rows.length||(i&&r<=selected[i-1])))invalid('Summary tables require ordered original data-row indices.',entry);
    if(schema&&selected.length<schema.minimumDataRows)invalid('A schema example needs at least two complete original fields.',entry);
    if(schema?.requiredRowIndices.some(row=>!selected.includes(row)))invalid('A schema example cannot omit explicit numeric constraint, risk or budget fields.',{sourceUnitId:item.id,requiredRowIndices:schema.requiredRowIndices});
    const comparison=comparisonTableSelection(project,item);
    if(comparison&&(selected.length<comparison.minimumDataRows||comparison.requiredRowIndices.some(row=>!selected.includes(row))))invalid('A table summary must retain its comparison set; a one-row example is not the original model/method comparison.',{entry,sourceUnitId:item.id,requiredRowIndices:comparison.requiredRowIndices,minimumDataRows:comparison.minimumDataRows});
    const missingFamilies=comparison?.requiredRowGroups?.filter(group=>!group.anyOfRowIndices.some(row=>selected.includes(row)))||[];
    if(missingFamilies.length)invalid('A workflow overview must retain representatives of every explicitly labelled task family.',{sourceUnitId:item.id,missingRowGroups:missingFamilies,requiredCorrection:'Select at least one exact original row from each listed task family; retain deterministic-computation provenance rows and complete originals in project source storage.'});
    const omitted=item.rows.slice(1).filter((_,i)=>!selected.includes(i+1));
    if(omitted.some(row=>critical.test(row.join(' '))))invalid('A summary table cannot omit an explicit condition/risk.',entry);
   }else if(entry.summaryGraph===undefined){
    if(sourcePointListKind(item)||['EquationBlock','CodeBlock','ProcessBlock','ChecklistBlock'].includes(item.type))invalid('Structured equations/code/processes require their complete object.',entry);
    const sentences=sourceSentences(item.text||''),selected=entry.sentenceIndices;
    if(entry.summaryText!==undefined){
      if(policy.content!=='overview'||typeof entry.summaryText!=='string'||!entry.summaryText.trim()||entry.summaryText.length>4000||entry.sentenceIndices!==undefined)invalid('Semantic summaries require the explicit overview/notes contract, one nonempty bounded text and no ambiguous sentence selection.',entry);
      const targetLanguage=policy.language?.mode==='source'&&policy.language?.body==='primary'?project.inputUnderstanding?.primaryLanguage:null;
      if(targetLanguage==='en'&&sourceScriptOf(entry.summaryText)==='han'||targetLanguage&&targetLanguage!=='en'&&sourceScriptOf(entry.summaryText)==='latin')invalid('Summary prose must use the reader-confirmed primary language; translate with an audited source projection.',{sourceUnitId:item.id,targetLanguage});
      const languageConflict=sourceLanguageSummaryConflict(project,item,entry.summaryText);
      if(languageConflict)invalid('A source-language summary must retain the source language; bilingual input needs both visible languages.',{...languageConflict,rule:'source_language_summary'});
    }else{
    if(!Array.isArray(selected)||!selected.length||new Set(selected).size!==selected.length||selected.some((r,i)=>!Number.isInteger(r)||r<0||r>=sentences.length||(i&&r<=selected[i-1])))invalid('Text summaries require ordered original sentence indices.',entry);
    if(item.type==='DefinitionBlock'&&!selected.includes(0)||sentences.some((text,i)=>mandatorySentence(item,text,i)&&!selected.includes(i)))invalid('A summary cannot omit its definition or an explicit condition/risk.',entry);
    }
   }
  }
  entries.push({...entry,...(entry.destination==='summary'&&item.rows?{sourceCellMap:[0,...entry.rowIndices].map(row=>item.rows[row].map((_,column)=>({row,column})))}:{}),unitHash:hash(item),sourceRefs:item.source_ref||[]});
 }
 const missing=items.filter(i=>!i.presentation&&!seen.has(i.id));if(missing.length)invalid('Every source unit requires an explicit destination.',missing.map(i=>i.id));
 if(editorialSelectionScope(project)){
  const absent=absentMajorTopics(project,entries);
  if(absent.length)invalid('A major source topic has no actual visible explanation; choose a source from the chapter, not necessarily its first paragraph.',{rule:'major_topic_visible',sourceUnitIds:absent.flatMap(topic=>topic.sourceUnitIds),topicCoverageConflicts:absent.map(({section,representativeSourceUnitId})=>({section,representativeSourceUnitId}))});
 }
 if(policy.language?.mode==='source'){
  const pairs=[...new Set(items.map(item=>item.languagePairId).filter(Boolean))];
  // A single body language (body=primary) keeps a translation in notes when
  // its original is the verified visible equivalent; other splits stay invalid.
  const carried=entry=>['notes','excluded'].includes(entry?.destination)&&entry.visibleEquivalentSourceUnitId&&visibleEquivalentCandidates(project,items.find(item=>item.id===entry.sourceUnitId)||{}).includes(entry.visibleEquivalentSourceUnitId);
  const conflicts=pairs.flatMap(pair=>{const members=items.filter(item=>item.languagePairId===pair&&!carried(entries.find(entry=>entry.sourceUnitId===item.id))),destinations=new Set(members.map(item=>['notes','excluded'].includes(entries.find(entry=>entry.sourceUnitId===item.id)?.destination)?'notes':'slides'));return destinations.size>1?[{languagePairId:pair,sourceUnitIds:members.map(item=>item.id)}]:[];});
  if(conflicts.length)invalid('Both source languages must remain together under the active disposition policy: visible or retained outside the main deck.',{languagePairConflicts:conflicts});
 }
 const relations=(project.originalSourceInventory?.relationships||project.source?.semantic?.inventory?.relationships||[]).map(r=>{
  const destinations=new Set(r.unitIds.map(id=>{const entry=entries.find(e=>e.sourceUnitId===id);return ['notes','excluded'].includes(entry?.destination)&&!entry.visibleEquivalentSourceUnitId?'notes':'slides';}));
  if(destinations.size>1){if(editorialSelectionScope(project))return {relationId:r.id,destination:'editorial_scope',sourceUnitIds:r.unitIds,reviewBasis:'source-evidenced obligations and independent complete-group coverage; heuristic relationship closure does not select content'};invalid('A relationship cannot be split between visible and excluded source ownership.',{relationId:r.id,sourceUnitIds:r.unitIds});}
  return {relationId:r.id,destination:[...destinations][0]||'slides',sourceUnitIds:r.unitIds};
 });
 const obligationIssues=obligationSelectionIssues(project,raw);
 if(obligationIssues.length)invalid('Selected topics lose an indispensable explanation relation/condition.',{issues:obligationIssues});
 const material={version:1,contract:policy.content,sourceHash:hash(project.source?.text||''),requestedPages:project.pages,entries,relations};
 return {...material,hash:hash(material)};
}
export function selectionSource(project,ledger){
 if(!ledger)return project.languageProjection?{...project.source,semantic:{...project.source.semantic,inventory:{...project.source.semantic.inventory,items:project.source.semantic.inventory.items.map(item=>projectedSourceItem(project,item))}}}:project.source;
 const original=project.originalSourceInventory||project.source.semantic.inventory;
 const moved=new Set(ledger.entries.filter(e=>['notes','excluded','summary'].includes(e.destination)).map(e=>e.sourceUnitId));
 return {...project.source,semantic:{...project.source.semantic,inventory:{...original,items:original.items.map(originalItem=>{
 const i=projectedSourceItem(project,originalItem);
 const entry=ledger.entries.find(e=>e.sourceUnitId===i.id);
 if(entry?.destination==='summary'&&entry.summaryGraph)return proseMediaItem(originalItem,entry.summaryGraph,ledger.hash);
 if(entry?.destination==='summary'&&!i.rows){
  if(i.languageProjection&&entry.sentenceIndices)invalid('Explicit translated output requires an audited semantic summary or complete projected object, not untranslated selected sentences.',entry);
  const text=entry.summaryText?.trim()||sourceSentences(originalItem.text).filter((_,at)=>entry.sentenceIndices.includes(at)).join(' ');
  return {...i,type:'SummaryBlock',text,must_preserve_structure:true,derivedSummary:{sourceUnitId:i.id,unitHash:entry.unitHash,sentenceIndices:entry.sentenceIndices,...(entry.summaryText?{summaryMode:'semantic',summaryHash:hash(text),requiresOriginalEntailment:true}:{}),ledgerHash:ledger.hash}};
 }
 if(entry?.destination==='summary'){
  // Selected rows show as they are; the complete table is in speaker notes.
  // No visible "see notes" label on the slide (round 7, A5).
  const projection=tableProjection(project,originalItem,entry);
  if(projection&&project.tableProjectionAudits?.[projection.hash]?.status!=='accepted')invalid('The approved table-cell projection audit is missing or stale.',entry);
  let rows=projection?projection.rows:[0,...entry.rowIndices].map(r=>[...i.rows[r]]);
  if(projection&&i.languageProjection&&project.generationPolicy?.language?.body==='primary')rows=rows.map((row,index)=>row.map((cell,column)=>index===0||column===0?i.rows[index===0?0:entry.rowIndices[index-1]][column]:cell));
  const partial=entry.rowIndices.length<i.rows.length-1;
  return {...i,type:'SummaryTableBlock',rows,text:rows.map(r=>r.join(' | ')).join('\n'),title:i.title,must_preserve_structure:true,derivedSummary:{label:project.generationPolicy?.version===2?'':partial?'Selected original rows':'',selectedRows:partial,completeComparison:!partial,sourceUnitId:i.id,unitHash:entry.unitHash,sourceCellMap:entry.sourceCellMap,...(projection?{projectionHash:projection.hash,rowIds:projection.rowIds,columnKeys:projection.columnKeys,summaryMode:'cell-paraphrase',requiresOriginalEntailment:true}:{}),ledgerHash:ledger.hash}};
 }
 const listKind=i.diagramSource?null:sourcePointListKind(i);
 const exactMain=project.generationPolicy?.knowledge==='source_only'&&entry?.destination==='slides';
 // A selected member of a source-language pair needs a real visible witness,
 // just like the paired summary. A planner claim ID alone is not rendered copy.
 const pairBound=project.generationPolicy?.language?.mode==='source'&&i.languagePairId&&entry?.destination==='slides';
 const visibleItem=pairBound?{...i,must_preserve_structure:true,sourceLanguageBinding:{languagePairId:i.languagePairId,ledgerHash:ledger.hash,basis:'selected_source_language_member'}}:i;
 return moved.has(i.id)?{...i,presentation:project.generationPolicy?.version===2?'excluded_by_policy':'notes_by_contract',presentationBasis:ledger.hash,must_preserve_structure:false,priority:'normal'}:listKind?{...visibleItem,type:listKind,must_preserve_structure:true,sourceListTyping:{originalType:i.type,basis:'explicit_source_list'}}:exactMain?{...visibleItem,must_preserve_structure:true,selectedSourceBinding:{basis:'source_only slides disposition binds the complete selected unit; summaries require their separate audited contract',ledgerHash:ledger.hash}}:visibleItem;}),relationships:original.relationships.filter(r=>!r.unitIds.some(id=>{const e=ledger.entries.find(e=>e.sourceUnitId===id);return ['notes','excluded'].includes(e?.destination)&&!e.visibleEquivalentSourceUnitId;})).map(r=>({...r,unitIds:[...new Set(r.unitIds.map(id=>ledger.entries.find(e=>e.sourceUnitId===id)?.visibleEquivalentSourceUnitId||id))]}))}}};
}
/** File-byte identity and the text/selection contract use different hashes.
 * Validate the ledger against its own immutable text and unit-hash domain. */
export function contentSelectionMatchesSource(project){
 const ledger=project.contentSelection,items=project.originalSourceInventory?.items||project.source?.semantic?.inventory?.items||[];
 if(!ledger||ledger.sourceHash!==hash(project.source?.text||'')||!Array.isArray(ledger.entries))return false;
 const material={version:ledger.version,contract:ledger.contract,sourceHash:ledger.sourceHash,requestedPages:ledger.requestedPages,entries:ledger.entries,relations:ledger.relations};
 return ledger.hash===hash(material)&&ledger.entries.every(e=>{const item=items.find(i=>i.id===e.sourceUnitId);return item&&hash(item)===e.unitHash;});
}
export function selectionNotes(project){
 if(project.generationPolicy?.version===2)return [];
 const ledger=project.contentSelection;if(!ledger)return [];
 if(project.generationPolicy?.content==='full_source'||!allowsEditorialSelection(project)||hash(project.source?.text||'')!==ledger.sourceHash)invalid('Selection authorization or immutable source hash changed.');
 for(const entry of ledger.entries){const original=project.originalSourceInventory?.items?.find(i=>i.id===entry.sourceUnitId);if(!original||hash(original)!==entry.unitHash)invalid('Original source inventory changed.',entry);}
 const items=project.originalSourceInventory?.items||[];
 return ledger.entries.filter(e=>['notes','excluded','summary'].includes(e.destination)).map(e=>{
  const item=items.find(i=>i.id===e.sourceUnitId);
  if(!item||hash(item)!==e.unitHash)invalid('Source unit changed after selection.',e);
  return {sourceUnitId:item.id,unitHash:e.unitHash,reason:e.reason,text:item.rows?item.rows.map(r=>r.join(' | ')).join('\n'):item.text};
 });
}
export function exactPageConflict(project,raw){
 if(project.generationPolicy?.version!==2&&project.pageDecision?.mode!=='explicit')return [];
 const requested=project.pageDecision?.finalPageCount||project.pages||raw.slides?.length,actual=raw.slides?.length||0;
 return actual!==requested?[{code:'exact_page_budget_conflict',severity:'error',repairable:false,message:`Requested ${requested} total slides including cover, conclusion and appendix; candidate contains ${actual}. Choose an authorized content disposition or change the page budget. Fonts and source rows remain intact.`,details:{requested,actual,contract:project.generationPolicy?.content,overflow:(raw.slides||[]).filter(s=>s.densityFit?.predictedOverflow>0).map(s=>({title:s.title,sourceUnitIds:s.sourceUnitIds,measurement:s.densityFit}))}}]:[];
}

export function selectionNotesBySlide(project){
 const notes=selectionNotes(project),slides=project.deck?.slides||[],items=project.originalSourceInventory?.items||[];
 const groups=new Map();
 for(const note of notes){
  const item=items.find(i=>i.id===note.sourceUnitId),section=item?.sectionPath?.at(-1);
  const ownedIndexes=slides.flatMap((s,index)=>(s.sourceUnitIds||project.outline?.find(o=>o.id===s.id)?.sourceUnitIds||[]).includes(note.sourceUnitId)?[index]:[]);
  const indexes=ownedIndexes.length?ownedIndexes:[Math.max(0,slides.findIndex(s=>(s.sourceUnitIds||project.outline?.find(o=>o.id===s.id)?.sourceUnitIds||[]).some(id=>items.find(i=>i.id===id)?.sectionPath?.at(-1)===section)))];
  for(const index of indexes){if(!groups.has(index))groups.set(index,[]);groups.get(index).push({sourceUnitId:note.sourceUnitId,text:`[Source ${note.sourceUnitId}; ${note.unitHash}]\nDisposition: ${note.reason}\n${note.text}`});}
 }
 const result=[...groups].map(([index,parts])=>({index,sourceUnitIds:parts.map(p=>p.sourceUnitId),text:`Content selection ledger ${project.contentSelection.hash}\n`+parts.map(p=>p.text).join('\n\n')}));
 if(project.generationPolicy?.version!==2&&project.generationPolicy?.content==='overview'&&allowsEditorialSelection(project)&&slides.length&&String(project.source?.text||'')){
  // Unit notes alone omit headings and any unit already shown verbatim on a
  // slide. The overview/notes contract also preserves the COMPLETE immutable
  // original, including both languages, all code and source navigation.
  const original=String(project.source?.text||'');
  let cover=result.find(note=>note.index===0);
  if(!cover){cover={index:0,sourceUnitIds:[],text:project.contentSelection?`Content selection ledger ${project.contentSelection.hash}`:`Original source archive SHA256 ${hash(original)}`};result.unshift(cover);}
  cover.sourceUnitIds=[...new Set([...cover.sourceUnitIds,...items.map(item=>item.id)])];
  cover.completeOriginalSource={sha256:hash(original),characters:original.length,utf8Bytes:Buffer.byteLength(original)};
  cover.text+=`\n\n[Complete original source; SHA256 ${hash(original)}]\n${original}\n[End complete original source]`;
 }
 return result;
}
