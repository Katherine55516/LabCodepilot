import {auditedLanguagePairTargets} from './ppt-language-pair-audit.mjs';
import {projectedSourceItem} from './ppt-language-projection.mjs';
import {sourcePointListKind}from './ppt-source-list-kinds.mjs';
import {sourceScriptOf}from './ppt-presentation-policy.mjs';
import crypto from 'node:crypto';
import {sourceSentences} from './ppt-source-boundaries.mjs';
import {primaryLanguageEquivalents,concisionApplies,visibleRequiredSentence} from './ppt-outline-concision.mjs';
const hash=v=>crypto.createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
const factualNumber=/[-+]?\d+(?:[.,]\d+)*(?:%|％)?/u;
const mandatorySentence=(item,sentence,index)=>item.type!=='CodeBlock'&&(critical.test(sentence)||item.type==='DefinitionBlock'&&index===0||factualNumber.test(sentence)&&(item.priority==='high'||['DefinitionBlock','EquationBlock','SummaryBlock','ConstraintBlock'].includes(item.type)||/risk|confidence|sample|threshold|independen|candidate|cost|capacity|turnover|multiple|trial|PBO|ICIR|Sharpe|交易日|独立|獨立|候选|候選|置信|风险|風險|成本|容量|阈值|門檻/iu.test(sentence)));
const critical=/\b(?:unless|except|only|solely|limited to|provided that|must|shall|not|never|without|uncertain|unknown|inference|inferred|likely|not disclosed|risk|limitation|bias|liquidity|transaction cost|data mining)\b|不得|不能|僅|仅|只有|除非|否則|否则|例外|不確定|不确定|前提|必須|必须|禁止|風險|风险|限制|偏誤|偏误|流動性|流动性|推断|推斷|推测|推測|很可能|未公开|未公開|未知/iu;
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
 return {minimumDataRows:Math.min(2,rows.length-1),requiredRowIndices:rows.length<=9?rows.slice(1).map((_,index)=>index+1):[],basis:'retain-comparison-set'};
}
export function mandatorySelectionFacts(project){return (project.source?.semantic?.inventory?.items||[]).flatMap(item=>sourceSentences(item.text||'').filter((s,index)=>mandatorySentence(item,s,index)).map(text=>({sourceUnitId:item.id,text:text.trim()})));}
export function visibleEquivalentCandidates(project,item){
 const audited=auditedLanguagePairTargets(project,item);if(audited.length)return audited;
 const policy=project.generationPolicy,items=project.originalSourceInventory?.items||project.source?.semantic?.inventory?.items||[];
 if(policy?.content!=='overview'||policy.details!=='notes'||!item.languagePairId||item.mustDisplay||item.rows||sourcePointListKind(item)||['EquationBlock','CodeBlock','ProcessBlock','ChecklistBlock','TaxonomyBlock'].includes(item.type))return [];
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
export function selectionConstraints(project){
 const inventory=project.originalSourceInventory||project.source?.semantic?.inventory||{items:[],relationships:[]},items=inventory.items;
 const rules=items.map(item=>{
 const mandatorySentenceIndices=sourceSentences(item.text||'').flatMap((s,i)=>mandatorySentence(item,s,i)?[i]:[]);
 const projectedTargets=visibleEquivalentCandidates(project,item);
 // Overview: only definitions and hard conditions pin a unit to the slide;
 // the broader mandatory set still binds any summary (outline concision, item 4).
 const visibleRequired=concisionApplies(project)?sourceSentences(item.text||'').some((s,i)=>visibleRequiredSentence(item,s,i)):mandatorySentenceIndices.length>0;
 const requiresMainWithoutProjection=Boolean(sourcePointListKind(item))||item.type==='CodeBlock'&&project.generationPolicy?.code?.presentation==='keep'||item.mustDisplay===true||['DefinitionBlock','ChecklistBlock','ProcessBlock'].includes(item.type)||visibleRequired;
 const notesBlocked=!projectedTargets.length&&requiresMainWithoutProjection;
 const summaryBlocked=Boolean(sourcePointListKind(item))||item.mustDisplay===true||['EquationBlock','CodeBlock','ProcessBlock','ChecklistBlock'].includes(item.type);
 const codeNotes=item.type==='CodeBlock'&&project.generationPolicy?.details==='notes'&&project.generationPolicy?.code?.presentation==='omit';
 const comparison=comparisonTableSelection(project,item);
 return {sourceUnitId:item.id,allowedDestinations:codeNotes||projectedTargets.length?['notes']:['slides',...(!notesBlocked?['notes']:[]),...(!summaryBlocked?['summary']:[])],notesWithoutVisibleEquivalentAllowed:codeNotes||!requiresMainWithoutProjection,mandatorySentenceIndices,...(projectedTargets.length?{visibleEquivalentSourceUnitIds:projectedTargets,notesRequireVisibleEquivalent:requiresMainWithoutProjection}:{}),...(item.rows?{mandatoryRowIndices:[...new Set([...item.rows.flatMap((row,i)=>i&&critical.test(row.join(' '))?[i]:[]),...(comparison?.requiredRowIndices||[])])],...(comparison?{comparisonSet:comparison}:{})}:{})};
});
 const byId=new Map(rules.map(rule=>[rule.sourceUnitId,rule]));
 const pairs=project.generationPolicy?.language?.mode==='source'?[...new Set(items.map(item=>item.languagePairId).filter(Boolean))].map(pair=>({unitIds:items.filter(item=>item.languagePairId===pair).map(item=>item.id)})):[];
 // Related definitions/variables and parallel languages share one disposition.
 // Feed this closure into constrained decoding, rather than reject a individually
 // legal equation-in-notes choice only after the whole outline has been written.
 let changed=true;while(changed){changed=false;
  for(const relation of [...(inventory.relationships||[]),...pairs]){
   const members=(relation.unitIds||[]).map(id=>byId.get(id)).filter(Boolean);
   if(!members.some(rule=>!rule.allowedDestinations.includes('notes')&&rule.allowedDestinations.some(d=>d==='slides'||d==='summary')))continue;
   for(const rule of members)if(rule.allowedDestinations.includes('notes')&&rule.allowedDestinations.some(d=>d==='slides'||d==='summary')){rule.allowedDestinations=rule.allowedDestinations.filter(d=>d!=='notes');rule.notesWithoutVisibleEquivalentAllowed=false;rule.relatedPrimaryOwnershipRequired=true;changed=true;}
  }
 }
 return rules;
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
export function compileContentSelection(project,raw){
 if(!raw?.selection?.length)return null;
 const policy=project.generationPolicy;
 if(policy?.content==='full_source'||policy?.details!=='notes')invalid('This contract does not permit moving source content into notes.');
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
  const wrongDestination=!rule?.allowedDestinations.includes(entry.destination),wrongOwnership=entry.destination==='notes'?owned.has(entry.sourceUnitId):['slides','summary'].includes(entry.destination)&&!owned.has(entry.sourceUnitId);
  const equivalent=entry.visibleEquivalentSourceUnitId, wrongEquivalent=Boolean(equivalent)&&(entry.destination!=='notes'||!rule?.visibleEquivalentSourceUnitIds?.includes(equivalent)||!owned.has(equivalent)||!raw.selection.some(e=>e.sourceUnitId===equivalent&&['slides','summary'].includes(e.destination)));
  return wrongDestination||wrongOwnership||wrongEquivalent?[{sourceUnitId:entry.sourceUnitId,destination:entry.destination,allowedDestinations:rule?.allowedDestinations,visibleEquivalentSourceUnitIds:rule?.visibleEquivalentSourceUnitIds,invalidVisibleEquivalent:wrongEquivalent?equivalent:undefined,owningPageIndexes}]:[];
 });
 if(conflicts.length)invalid('Disposition or primary ownership violates the explicit presentation contract.',{conflicts,requiredCorrection:'Repair ALL listed conflicts together: notes IDs cannot occupy slide.sourceUnitIds or table ranges; slides/summary IDs require an actual owner. Use the allowed destination and a real target-language owner for protected bilingual projection. Do not duplicate entries.'});
 const summaryConflicts=raw.selection.filter(entry=>entry.destination==='summary'&&entry.summaryText===undefined&&Array.isArray(entry.sentenceIndices)).flatMap(entry=>{const item=byId.get(entry.sourceUnitId);if(!item||item.rows)return [];const sentences=sourceSentences(item.text||'');return item.type==='DefinitionBlock'&&!entry.sentenceIndices.includes(0)||sentences.some((text,i)=>mandatorySentence(item,text,i)&&!entry.sentenceIndices.includes(i))?[{...entry,requiredSentenceIndices:sentences.flatMap((text,i)=>mandatorySentence(item,text,i)?[i]:[])}]:[];});
 if(summaryConflicts.length)invalid('A summary cannot omit its definition or an explicit condition/risk.',{summaryConflicts});
 for(const entry of raw.selection){
  const item=byId.get(entry.sourceUnitId);
  if(!item||seen.has(item.id)||!['slides','notes','summary'].includes(entry.destination)||typeof entry.reason!=='string'||!entry.reason.trim()||entry.reason.length>240)invalid('Invalid or duplicated source disposition.',entry);
  seen.add(item.id);
  const rule=constraintsById.get(item.id);
  if(!rule?.allowedDestinations.includes(entry.destination))invalid('Disposition violates the explicit source presentation contract.',{entry,allowedDestinations:rule?.allowedDestinations,visibleEquivalentSourceUnitIds:rule?.visibleEquivalentSourceUnitIds,requiredCorrection:'Use an allowed destination. In the single-output-language overview contract, the other-language detected pair belongs in notes; its real target-language primary owner carries the required facts.'});
  if(['slides','summary'].includes(entry.destination)&&!owned.has(item.id)||entry.destination==='notes'&&owned.has(item.id))invalid('Slide ownership contradicts the disposition.',{sourceUnitId:item.id,destination:entry.destination,owningPageIndexes:raw.slides.flatMap((slide,index)=>pageOwns(slide,item.id)?[index]:[]),requiredCorrection:entry.destination==='notes'?'Remove this ID from ALL slide.sourceUnitIds and sourceArtifactRanges; complete original remains in speaker notes. Preserve visibleEquivalentSourceUnitId and its actual target owner when required.':'Assign this ID to a primary slide.sourceUnitIds or a valid original table row range; keep its current summary and all mandatory facts.'});
  const equivalent=entry.visibleEquivalentSourceUnitId||undefined;
  if(equivalent!==undefined&&(entry.destination!=='notes'||!visibleEquivalentCandidates(project,item).includes(equivalent)||!owned.has(equivalent)||!raw.selection.some(e=>e.sourceUnitId===equivalent&&['slides','summary'].includes(e.destination))))invalid('A language projection requires an actual target-language primary owner in the same source pair; pair metadata alone is not entailment proof.',{
    entry,allowedTargetOwners:visibleEquivalentCandidates(project,item).map(id=>({sourceUnitId:id,destination:raw.selection.find(e=>e.sourceUnitId===id)?.destination,owningPageIndexes:raw.slides.flatMap((s,index)=>s.sourceUnitIds?.includes(id)?[index]:[])})),
    requiredCorrection:'Use ONLY an allowed target ID. Its selection destination must be slides or summary AND it must occur in an actual primary slide.sourceUnitIds. The notes source ID must not occur in any slide.sourceUnitIds. Never project both sides to notes or reference the source ID itself.'});
  if(entry.destination==='notes'&&!equivalent&&(item.type==='CodeBlock'&&project.generationPolicy?.code?.presentation==='keep'||item.mustDisplay===true||item.type==='DefinitionBlock'||item.type==='ChecklistBlock'||item.type==='ProcessBlock'||sourceSentences(item.text||'').some((s,i)=>concisionApplies(project)?visibleRequiredSentence(item,s,i):mandatorySentence(item,s,i))))invalid('A definition or explicit condition/risk needs a main-slide owner.',{sourceUnitId:item.id});
  if(entry.destination==='summary'){
   if(item.rows&&entry.summaryText!==undefined)invalid('Tables retain exact selected original cells; semantic summary text is not a table replacement.',entry);
   if(item.mustDisplay===true)invalid('A must-display unit cannot become a summary.',entry);
   if(item.type==='TableBlock'){
    const selected=entry.rowIndices;
    if(!Array.isArray(selected)||!selected.length||new Set(selected).size!==selected.length||selected.some((r,i)=>!Number.isInteger(r)||r<1||r>=item.rows.length||(i&&r<=selected[i-1])))invalid('Summary tables require ordered original data-row indices.',entry);
    const comparison=comparisonTableSelection(project,item);
    if(comparison&&(selected.length<comparison.minimumDataRows||comparison.requiredRowIndices.some(row=>!selected.includes(row))))invalid('A table summary must retain its comparison set; a one-row example is not the original model/method comparison.',{entry,sourceUnitId:item.id,requiredRowIndices:comparison.requiredRowIndices,minimumDataRows:comparison.minimumDataRows});
    const omitted=item.rows.slice(1).filter((_,i)=>!selected.includes(i+1));
    if(omitted.some(row=>critical.test(row.join(' '))))invalid('A summary table cannot omit an explicit condition/risk.',entry);
   }else{
    if(sourcePointListKind(item)||['EquationBlock','CodeBlock','ProcessBlock','ChecklistBlock'].includes(item.type))invalid('Structured equations/code/processes require their complete object.',entry);
    const sentences=sourceSentences(item.text||''),selected=entry.sentenceIndices;
    if(entry.summaryText!==undefined){
      if(policy.content!=='overview'||typeof entry.summaryText!=='string'||!entry.summaryText.trim()||entry.summaryText.length>4000||entry.sentenceIndices!==undefined)invalid('Semantic summaries require the explicit overview/notes contract, one nonempty bounded text and no ambiguous sentence selection.',entry);
      const originalScript=sourceScriptOf(item.text),summaryScript=sourceScriptOf(entry.summaryText);
      if(policy.language?.mode==='source'&&originalScript!=='mixed'&&originalScript!==summaryScript)invalid('A source-language summary must retain the source language; bilingual input needs both visible languages.',{sourceUnitId:item.id,originalScript,summaryScript});
    }else{
    if(!Array.isArray(selected)||!selected.length||new Set(selected).size!==selected.length||selected.some((r,i)=>!Number.isInteger(r)||r<0||r>=sentences.length||(i&&r<=selected[i-1])))invalid('Text summaries require ordered original sentence indices.',entry);
    if(item.type==='DefinitionBlock'&&!selected.includes(0)||sentences.some((text,i)=>mandatorySentence(item,text,i)&&!selected.includes(i)))invalid('A summary cannot omit its definition or an explicit condition/risk.',entry);
    }
   }
  }
  entries.push({...entry,...(entry.destination==='summary'&&item.rows?{sourceCellMap:[0,...entry.rowIndices].map(row=>item.rows[row].map((_,column)=>({row,column})))}:{}),unitHash:hash(item),sourceRefs:item.source_ref||[]});
 }
 const missing=items.filter(i=>!i.presentation&&!seen.has(i.id));if(missing.length)invalid('Every source unit requires an explicit destination.',missing.map(i=>i.id));
 if(policy.language?.mode==='source'){
  const pairs=[...new Set(items.map(item=>item.languagePairId).filter(Boolean))];
  // A single body language (body=primary) keeps a translation in notes when
  // its original is the verified visible equivalent; other splits stay invalid.
  const carried=entry=>entry?.destination==='notes'&&entry.visibleEquivalentSourceUnitId&&visibleEquivalentCandidates(project,items.find(item=>item.id===entry.sourceUnitId)||{}).includes(entry.visibleEquivalentSourceUnitId);
  const conflicts=pairs.flatMap(pair=>{const members=items.filter(item=>item.languagePairId===pair&&!carried(entries.find(entry=>entry.sourceUnitId===item.id))),destinations=new Set(members.map(item=>entries.find(entry=>entry.sourceUnitId===item.id)?.destination==='notes'?'notes':'slides'));return destinations.size>1?[{languagePairId:pair,sourceUnitIds:members.map(item=>item.id)}]:[];});
  if(conflicts.length)invalid('Both source languages must remain together: both visible or both in complete source notes.',{languagePairConflicts:conflicts});
 }
 const relations=(project.originalSourceInventory?.relationships||project.source?.semantic?.inventory?.relationships||[]).map(r=>{
  const destinations=new Set(r.unitIds.map(id=>{const entry=entries.find(e=>e.sourceUnitId===id);return entry?.destination==='notes'&&!entry.visibleEquivalentSourceUnitId?'notes':'slides';}));
  if(destinations.size>1)invalid('A relationship cannot be split between slides and notes.',{relationId:r.id,sourceUnitIds:r.unitIds});
  return {relationId:r.id,destination:[...destinations][0]||'slides',sourceUnitIds:r.unitIds};
 });
 const material={version:1,contract:policy.content,sourceHash:hash(project.source?.text||''),requestedPages:project.pages,entries,relations};
 return {...material,hash:hash(material)};
}
export function selectionSource(project,ledger){
 if(!ledger)return project.languageProjection?{...project.source,semantic:{...project.source.semantic,inventory:{...project.source.semantic.inventory,items:project.source.semantic.inventory.items.map(item=>projectedSourceItem(project,item))}}}:project.source;
 const original=project.originalSourceInventory||project.source.semantic.inventory;
 const moved=new Set(ledger.entries.filter(e=>['notes','summary'].includes(e.destination)).map(e=>e.sourceUnitId));
 return {...project.source,semantic:{...project.source.semantic,inventory:{...original,items:original.items.map(originalItem=>{
 const i=projectedSourceItem(project,originalItem);
 const entry=ledger.entries.find(e=>e.sourceUnitId===i.id);
 if(entry?.destination==='summary'&&!i.rows){
  if(i.languageProjection&&entry.sentenceIndices)invalid('Explicit translated output requires an audited semantic summary or complete projected object, not untranslated selected sentences.',entry);
  const text=entry.summaryText?.trim()||sourceSentences(originalItem.text).filter((_,at)=>entry.sentenceIndices.includes(at)).join(' ');
  return {...i,type:'SummaryBlock',text,must_preserve_structure:true,derivedSummary:{sourceUnitId:i.id,unitHash:entry.unitHash,sentenceIndices:entry.sentenceIndices,...(entry.summaryText?{summaryMode:'semantic',summaryHash:hash(text),requiresOriginalEntailment:true}:{}),ledgerHash:ledger.hash}};
 }
 if(entry?.destination==='summary'){
  const label=project.generationPolicy.language?.locale==='en'?'Selected rows; complete table in notes':project.generationPolicy.language?.locale==='zh-HK'?'摘要：完整表見備註':'摘要：完整表见备注';
  const rows=[0,...entry.rowIndices].map(r=>[...i.rows[r]]);
  const partial=entry.rowIndices.length<i.rows.length-1;
  if(partial)rows[0][0]+='\n'+label;
  return {...i,type:'SummaryTableBlock',rows,text:rows.map(r=>r.join(' | ')).join('\n'),title:partial?(i.title||'Table')+' — selected source rows':i.title,must_preserve_structure:true,derivedSummary:{label:partial?label:'',completeComparison:!partial,sourceUnitId:i.id,unitHash:entry.unitHash,sourceCellMap:entry.sourceCellMap,ledgerHash:ledger.hash}};
 }
 const listKind=i.diagramSource?null:sourcePointListKind(i);
 const exactMain=project.generationPolicy?.knowledge==='source_only'&&entry?.destination==='slides';
 // A selected member of a source-language pair needs a real visible witness,
 // just like the paired summary. A planner claim ID alone is not rendered copy.
 const pairBound=project.generationPolicy?.language?.mode==='source'&&i.languagePairId&&entry?.destination==='slides';
 const visibleItem=pairBound?{...i,must_preserve_structure:true,sourceLanguageBinding:{languagePairId:i.languagePairId,ledgerHash:ledger.hash,basis:'selected_source_language_member'}}:i;
 return moved.has(i.id)?{...i,presentation:'notes_by_contract',presentationBasis:ledger.hash,must_preserve_structure:false,priority:'normal'}:listKind?{...visibleItem,type:listKind,must_preserve_structure:true,sourceListTyping:{originalType:i.type,basis:'explicit_source_list'}}:exactMain?{...visibleItem,must_preserve_structure:true,selectedSourceBinding:{basis:'source_only slides disposition binds the complete selected unit; summaries require their separate audited contract',ledgerHash:ledger.hash}}:visibleItem;}),relationships:original.relationships.filter(r=>!r.unitIds.some(id=>{const e=ledger.entries.find(e=>e.sourceUnitId===id);return e?.destination==='notes'&&!e.visibleEquivalentSourceUnitId;})).map(r=>({...r,unitIds:[...new Set(r.unitIds.map(id=>ledger.entries.find(e=>e.sourceUnitId===id)?.visibleEquivalentSourceUnitId||id))]}))}}};
}
export function selectionNotes(project){
 const ledger=project.contentSelection;if(!ledger)return [];
 if(project.generationPolicy?.content==='full_source'||project.generationPolicy?.details!=='notes'||hash(project.source?.text||'')!==ledger.sourceHash)invalid('Selection authorization or immutable source hash changed.');
 for(const entry of ledger.entries){const original=project.originalSourceInventory?.items?.find(i=>i.id===entry.sourceUnitId);if(!original||hash(original)!==entry.unitHash)invalid('Original source inventory changed.',entry);}
 const items=project.originalSourceInventory?.items||[];
 return ledger.entries.filter(e=>['notes','summary'].includes(e.destination)).map(e=>{
  const item=items.find(i=>i.id===e.sourceUnitId);
  if(!item||hash(item)!==e.unitHash)invalid('Source unit changed after selection.',e);
  return {sourceUnitId:item.id,unitHash:e.unitHash,reason:e.reason,text:item.rows?item.rows.map(r=>r.join(' | ')).join('\n'):item.text};
 });
}
export function exactPageConflict(project,raw){
 if(project.pageDecision?.mode!=='explicit')return [];
 const requested=project.pageDecision.finalPageCount||project.pages,actual=raw.slides?.length||0;
 return actual!==requested?[{code:'exact_page_budget_conflict',severity:'error',repairable:false,message:`Requested ${requested} total slides including cover, conclusion and appendix; candidate contains ${actual}. Choose an authorized content disposition or change the page budget. Fonts and source rows remain intact.`,details:{requested,actual,contract:project.generationPolicy?.content,overflow:(raw.slides||[]).filter(s=>s.densityFit?.predictedOverflow>0).map(s=>({title:s.title,sourceUnitIds:s.sourceUnitIds,measurement:s.densityFit}))}}]:[];
}

export function selectionNotesBySlide(project){
 const notes=selectionNotes(project),slides=project.deck?.slides||[],items=project.originalSourceInventory?.items||[];
 const groups=new Map();
 for(const note of notes){
  const item=items.find(i=>i.id===note.sourceUnitId),section=item?.sectionPath?.at(-1);
  const index=Math.max(0,slides.findIndex(s=>(s.sourceUnitIds||project.outline?.find(o=>o.id===s.id)?.sourceUnitIds||[]).some(id=>items.find(i=>i.id===id)?.sectionPath?.at(-1)===section)));
  if(!groups.has(index))groups.set(index,[]);groups.get(index).push({sourceUnitId:note.sourceUnitId,text:`[Source ${note.sourceUnitId}; ${note.unitHash}]\nDisposition: ${note.reason}\n${note.text}`});
 }
 const result=[...groups].map(([index,parts])=>({index,sourceUnitIds:parts.map(p=>p.sourceUnitId),text:`Content selection ledger ${project.contentSelection.hash}\n`+parts.map(p=>p.text).join('\n\n')}));
 if(project.generationPolicy?.content==='overview'&&project.generationPolicy?.details==='notes'&&slides.length&&String(project.source?.text||'')){
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
