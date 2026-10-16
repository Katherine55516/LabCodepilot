import {automaticPages}from './ppt-density-profile.mjs';
import {deckLanguage}from './ppt-presentation-contract.mjs';
import {supportsSourceLineRanges,hasExplicitSourceLineRanges,inspectSourceLinePlan,sourceLineRange,paginateSourceLines} from './ppt-source-line-ranges.mjs';
/** Outline compilation (round 7, B3): code decides what it can, then corrects
 * the remaining contract slips in a model outline deterministically and lists
 * each correction, instead of rejecting the whole outline.
 *
 * Only structural planning fields change: page ownership, dispositions, pair
 * and relation closure, metadata length and role. Source text, table rows and
 * fonts never change; a unit is never dropped (an uncertain unit stays on a
 * slide rather than going to notes). */
import {selectionConstraints,visibleEquivalentCandidates,comparisonTableSelection,isMandatorySentence,isCriticalCondition} from './ppt-content-selection.mjs';
import {sourceSentences} from './ppt-source-boundaries.mjs';
import {validateSourceArtifactRefs} from './ppt-density-capacity.mjs';
import {distinctPageTitles} from './ppt-page-titles.mjs';

const METADATA_LIMITS={title:160,focus:360,section:80,question:240};
const TABLE_TYPES=new Set(['TableBlock','SummaryTableBlock']);
const DESTINATIONS=new Set(['slides','notes','summary']);

/** Shorten at a sentence, clause or word boundary; never mid-word. */
export function truncateAtBoundary(value,limit){
  const text=String(value||'').replace(/\s+/gu,' ').trim();
  if(text.length<=limit)return text;
  const head=text.slice(0,limit);
  for(const pattern of [/[。！？.!?](?=[^。！？.!?]*$)/u,/[；;，,：:、](?=[^；;，,：:、]*$)/u,/\s(?=\S*$)/u]){
    const at=head.search(pattern);
    if(at>=limit*.5)return head.slice(0,at+(/\s/u.test(head[at])?0:1)).replace(/[，,；;：:、]$/u,'').trim();
  }
  return head.trim();
}

function inventoryOf(project){
  const items=project.originalSourceInventory?.items||project.source?.semantic?.inventory?.items||[];
  return {items,byId:new Map(items.map(item=>[item.id,item])),order:new Map(items.map((item,index)=>[item.id,index]))};
}
const sectionOf=item=>(item?.sectionPath||[]).join('\u0000');
const contentPage=(slide,index,count)=>index>0&&slide.role!=='navigation'&&!(index===count-1&&count>2&&!(slide.sourceUnitIds||[]).length);

/** The content page that best takes an orphan unit: same section first, then
 * the page owning the nearest earlier unit, then the nearest later unit. */
export function nearestOwnerPage(project,slides,unitId){
  const {items,byId,order}=inventoryOf(project),unit=byId.get(unitId),at=order.get(unitId)??0;
  const candidates=slides.map((slide,index)=>({slide,index})).filter(({slide,index})=>contentPage(slide,index,slides.length));
  if(!candidates.length)return Math.min(1,slides.length-1);
  const distance=({slide})=>{
    const ids=slide.sourceUnitIds||[];
    if(!ids.length)return Infinity;
    return Math.min(...ids.map(id=>Math.abs((order.get(id)??at)-at)));
  };
  const sameSection=candidates.filter(({slide})=>(slide.sourceUnitIds||[]).some(id=>sectionOf(byId.get(id))===sectionOf(unit)));
  const pool=sameSection.length?sameSection:candidates.filter(({slide})=>(slide.sourceUnitIds||[]).length);
  if(!pool.length)return candidates[0].index;
  return pool.reduce((best,candidate)=>distance(candidate)<distance(best)?candidate:best).index;
}

function attach(project,slides,unitId,corrections,reason){
  const index=nearestOwnerPage(project,slides,unitId);
  const slide=slides[index];
  slide.sourceUnitIds=[...new Set([...(slide.sourceUnitIds||[]),unitId])];
  corrections.push({code:'ownership_assigned',sourceUnitId:unitId,pageIndex:index,reason});
  return index;
}
function detach(slides,unitId){
  const pages=[];
  slides.forEach((slide,index)=>{
    const ids=slide.sourceUnitIds||[],ranges=slide.sourceArtifactRanges||[];
    if(!ids.includes(unitId)&&!ranges.some(ref=>ref.sourceUnitId===unitId))return;
    slide.sourceUnitIds=ids.filter(id=>id!==unitId);
    if(ranges.length)slide.sourceArtifactRanges=ranges.filter(ref=>ref.sourceUnitId!==unitId);
    if(slide.repeatSourceUnitIds)slide.repeatSourceUnitIds=slide.repeatSourceUnitIds.filter(id=>id!==unitId);
    pages.push(index);
  });
  return pages;
}
const owns=(slide,id)=>(slide.sourceUnitIds||[]).includes(id)||(slide.sourceArtifactRanges||[]).some(ref=>ref.sourceUnitId===id);

/** Page-level fixes: unknown IDs, invalid table ranges, metadata, recaps, cover. */
function compileSlides(project,raw,corrections){
  const {byId}=inventoryOf(project);
  const ids=new Set((project.source?.semantic?.inventory?.items||[]).map(item=>item.id));
  const known=id=>ids.has(id)||byId.has(id);
  const slides=raw.slides.map((slide,pageIndex)=>{
    if(!slide||typeof slide!=='object')return slide;
    const next={...slide};
    if(Array.isArray(next.sourceUnitIds)){
      const unknown=next.sourceUnitIds.filter(id=>!known(id));
      if(unknown.length){next.sourceUnitIds=next.sourceUnitIds.filter(known);corrections.push({code:'unknown_source_ids_removed',pageIndex,sourceUnitIds:unknown});}
    }else if(next.sourceUnitIds===undefined){next.sourceUnitIds=[];}
    if(Array.isArray(next.sourceArtifactRanges)&&next.sourceArtifactRanges.length){
      const items=project.source?.semantic?.inventory?.items||[];
      const valid=[],invalid=[];
      for(const ref of next.sourceArtifactRanges){try{validateSourceArtifactRefs(items,[ref]);valid.push(ref);}catch{invalid.push(ref);}}
      if(invalid.length){
        // An unusable row range falls back to the whole original table.
        next.sourceArtifactRanges=valid;
        next.sourceUnitIds=[...new Set([...next.sourceUnitIds,...invalid.map(ref=>ref.sourceUnitId).filter(known)])];
        corrections.push({code:'table_range_replaced_by_full_table',pageIndex,ranges:invalid});
      }
    }
    if(!next.titleLocked&&!next.title_locked)for(const [field,limit] of Object.entries(METADATA_LIMITS)){
      if(next[field]===undefined&&!['title','focus'].includes(field))continue;
      if(typeof next[field]!=='string'||!next[field].trim()){
        const owned=(next.sourceUnitIds||[]).map(id=>byId.get(id)).find(Boolean);
        const fallback=field==='focus'?next.title||owned?.sectionPath?.at(-1)||owned?.text:next.section||owned?.sectionPath?.at(-1)||next.focus||(pageIndex===0?project.title:'');
        if(['title','focus'].includes(field)&&String(fallback||'').trim()){next[field]=truncateAtBoundary(fallback,limit);corrections.push({code:'metadata_filled',pageIndex,field});}
        else if(!['title','focus'].includes(field)){delete next[field];corrections.push({code:'metadata_removed',pageIndex,field});}
        continue;
      }
      if(next[field].length>limit){next[field]=truncateAtBoundary(next[field],limit);corrections.push({code:'metadata_shortened',pageIndex,field,limit});}
    }
    return next;
  });
  // Recap tags are allowed only for an explicit user recap. Otherwise the
  // unit keeps one primary owner: the earlier page, or this page if none.
  slides.forEach((slide,index)=>{
    const recaps=[...new Set(slide?.repeatSourceUnitIds||[])];
    if(!recaps.length)return;
    const authorized=recaps.filter(id=>project.requestedOutline?.some(s=>s.repeatSourceUnitIds?.includes(id)));
    const removed=recaps.filter(id=>!authorized.includes(id));
    if(!removed.length)return;
    slide.repeatSourceUnitIds=authorized;
    for(const id of removed){
      const earlier=slides.slice(1,index).some(prior=>(prior.sourceUnitIds||[]).includes(id));
      if(earlier)slide.sourceUnitIds=(slide.sourceUnitIds||[]).filter(other=>other!==id);
    }
    corrections.push({code:'recap_tags_removed',pageIndex:index,sourceUnitIds:removed});
  });
  // A title-only cover never owns source units; move them to the next page.
  const cover=slides[0];
  const nativeTitleCover=project.templateFidelity?.mode==='preserve'&&!project.templateFidelity?.slides?.[0]?.slots?.some(slot=>slot.role==='content'&&slot.purpose!=='footnote');
  const builtInCover=project.templateSpec&&project.templateFidelity?.mode!=='preserve';
  const automaticSourceCover=project.templateFidelity?.mode==='preserve'&&project.generationPolicy?.content==='full_source'&&project.generationPolicy?.knowledge==='source_only'&&!project.requestedOutline&&!project.confirmedOutline;
  if(cover&&(builtInCover||nativeTitleCover||automaticSourceCover)&&(cover.sourceUnitIds?.length||cover.sourceArtifactRanges?.length)&&slides.length>1){
    const moved=[...(cover.sourceUnitIds||[])],ranges=[...(cover.sourceArtifactRanges||[])];
    cover.sourceUnitIds=[];cover.sourceArtifactRanges=[];
    const target=slides.findIndex((slide,index)=>index>0&&slide.role!=='navigation');
    const page=slides[target>0?target:1];
    page.sourceUnitIds=[...new Set([...moved,...(page.sourceUnitIds||[])])];
    if(ranges.length)page.sourceArtifactRanges=[...ranges,...(page.sourceArtifactRanges||[])];
    corrections.push({code:'cover_units_moved',pageIndex:target>0?target:1,sourceUnitIds:moved});
  }
  return {...raw,slides};
}

function summaryRepair(project,entry,item,corrections){
  if(entry.destination!=='summary')return entry;
  if(item.mustDisplay===true)return {...entry,destination:'slides'};
  if(item.rows){
    if(entry.summaryText!==undefined||!Array.isArray(entry.rowIndices)){corrections.push({code:'summary_kept_complete',sourceUnitId:item.id});const {summaryText,rowIndices,...rest}=entry;return {...rest,destination:'slides'};}
    const comparison=comparisonTableSelection(project,item);
    const critical=item.rows.slice(1).flatMap((row,i)=>isCriticalCondition(row.join(' '))?[i+1]:[]);
    const valid=entry.rowIndices.filter(r=>Number.isInteger(r)&&r>=1&&r<item.rows.length);
    const rows=[...new Set([...valid,...critical,...(comparison?.requiredRowIndices||[])])].sort((a,b)=>a-b);
    if(comparison&&rows.length<comparison.minimumDataRows)for(let r=1;r<item.rows.length&&rows.length<comparison.minimumDataRows;r++)if(!rows.includes(r))rows.push(r);
    rows.sort((a,b)=>a-b);
    if(!rows.length){corrections.push({code:'summary_kept_complete',sourceUnitId:item.id});const {rowIndices,...rest}=entry;return {...rest,destination:'slides'};}
    if(JSON.stringify(rows)!==JSON.stringify(entry.rowIndices))corrections.push({code:'summary_rows_completed',sourceUnitId:item.id,rowIndices:rows});
    return {...entry,rowIndices:rows};
  }
  if(['EquationBlock','CodeBlock','ProcessBlock','ChecklistBlock'].includes(item.type)){corrections.push({code:'summary_kept_complete',sourceUnitId:item.id});const {sentenceIndices,summaryText,...rest}=entry;return {...rest,destination:'slides'};}
  if(entry.summaryText!==undefined)return entry;
  const sentences=sourceSentences(item.text||'');
  if(!Array.isArray(entry.sentenceIndices)){corrections.push({code:'summary_kept_complete',sourceUnitId:item.id});return {...entry,destination:'slides'};}
  const selected=entry.sentenceIndices.filter(i=>Number.isInteger(i)&&i>=0&&i<sentences.length);
  const required=sentences.flatMap((text,i)=>isMandatorySentence(item,text,i)?[i]:[]);
  const merged=[...new Set([...selected,...required,...(item.type==='DefinitionBlock'?[0]:[])])].sort((a,b)=>a-b);
  if(!merged.length){corrections.push({code:'summary_kept_complete',sourceUnitId:item.id});return {...entry,destination:'slides'};}
  if(JSON.stringify(merged)!==JSON.stringify(entry.sentenceIndices))corrections.push({code:'summary_sentences_completed',sourceUnitId:item.id,sentenceIndices:merged});
  return {...entry,sentenceIndices:merged};
}

/** Disposition ledger fixes. Uncertain units stay visible (slides). */
function compileSelection(project,raw,corrections){
  if(raw.version!==2)return raw;
  if(!Array.isArray(raw.selection)) {
    if(project.generationPolicy?.content==='full_source'||project.generationPolicy?.details!=='notes')return raw;
    corrections.push({code:'selection_ledger_completed'});
    raw={...raw,selection:[]};
  }
  const policy=project.generationPolicy;
  const slides=raw.slides.map(slide=>({...slide,sourceUnitIds:[...(slide.sourceUnitIds||[])],...(slide.sourceArtifactRanges?{sourceArtifactRanges:[...slide.sourceArtifactRanges]}:{})}));
  if(policy?.content==='full_source'||policy?.details!=='notes'){
    // This contract has no notes ledger: every unit stays on a slide.
    if(!raw.selection.length)return {...raw,slides};
    corrections.push({code:'selection_removed_for_contract',count:raw.selection.length});
    const {selection,...rest}=raw;return {...rest,slides};
  }
  const {items,byId}=inventoryOf(project);
  const rules=new Map(selectionConstraints(project).map(rule=>[rule.sourceUnitId,rule]));
  const seen=new Set();let entries=[];
  for(const entry of raw.selection){
    if(!entry||!byId.has(entry.sourceUnitId)){corrections.push({code:'unknown_disposition_removed',sourceUnitId:entry?.sourceUnitId});continue;}
    if(seen.has(entry.sourceUnitId)){corrections.push({code:'duplicate_disposition_removed',sourceUnitId:entry.sourceUnitId});continue;}
    seen.add(entry.sourceUnitId);
    let next={...entry};
    if(!DESTINATIONS.has(next.destination)){next.destination='slides';corrections.push({code:'disposition_defaulted',sourceUnitId:next.sourceUnitId,destination:'slides'});}
    if(typeof next.reason!=='string'||!next.reason.trim())next.reason='Compiled default';
    else if(next.reason.length>240)next.reason=truncateAtBoundary(next.reason,240);
    entries.push(next);
  }
  const ownedOnPage=id=>slides.some(slide=>owns(slide,id));
  for(const item of items){
    if(item.presentation||seen.has(item.id))continue;
    const rule=rules.get(item.id);
    const destination=ownedOnPage(item.id)||!rule?.allowedDestinations?.includes('notes')||!rule?.notesWithoutVisibleEquivalentAllowed?'slides':'notes';
    entries.push({sourceUnitId:item.id,destination,reason:'Compiled default: planner gave no disposition'});
    corrections.push({code:'disposition_added',sourceUnitId:item.id,destination});
  }
  const order=new Map(items.map((item,index)=>[item.id,index]));
  entries.sort((a,b)=>(order.get(a.sourceUnitId)??0)-(order.get(b.sourceUnitId)??0));
  const byEntry=()=>new Map(entries.map(entry=>[entry.sourceUnitId,entry]));
  const toSlides=(entry,code)=>{
    if(entry.destination==='slides')return;
    const {visibleEquivalentSourceUnitId,summaryText,sentenceIndices,rowIndices,...rest}=entry;
    Object.keys(entry).forEach(key=>delete entry[key]);Object.assign(entry,{...rest,destination:'slides'});
    corrections.push({code,sourceUnitId:entry.sourceUnitId,destination:'slides'});
  };
  for(const entry of entries){
    const item=byId.get(entry.sourceUnitId),rule=rules.get(entry.sourceUnitId);
    Object.assign(entry,summaryRepair(project,entry,item,corrections));
    if(rule&&!rule.allowedDestinations.includes(entry.destination)){
      if(rule.allowedDestinations.length===1&&rule.allowedDestinations[0]==='notes'){entry.destination='notes';corrections.push({code:'disposition_to_notes_by_contract',sourceUnitId:entry.sourceUnitId});}
      else toSlides(entry,'disposition_not_allowed');
    }
  }
  // Pair and relation closure: a split pair/relation becomes visible together.
  const pairIds=policy.language?.mode==='source'?[...new Set(items.map(item=>item.languagePairId).filter(Boolean))]:[];
  for(let pass=0;pass<4;pass++){
    let changed=false;const map=byEntry();
    // A thin-page enrichment can return a primary paragraph from notes. Link
    // its already-validated translation before pair closure; otherwise closure
    // would incorrectly promote the notes-only translation back onto the slide.
    for(const entry of entries){
      if(entry.destination!=='notes')continue;
      const targets=visibleEquivalentCandidates(project,byId.get(entry.sourceUnitId)||{});
      const target=targets.find(id=>['slides','summary'].includes(map.get(id)?.destination));
      if(target&&entry.visibleEquivalentSourceUnitId!==target){entry.visibleEquivalentSourceUnitId=target;corrections.push({code:'visible_equivalent_corrected',sourceUnitId:entry.sourceUnitId,visibleEquivalentSourceUnitId:target});}
    }
    const carried=entry=>entry?.destination==='notes'&&entry.visibleEquivalentSourceUnitId&&visibleEquivalentCandidates(project,byId.get(entry.sourceUnitId)||{}).includes(entry.visibleEquivalentSourceUnitId);
    for(const pair of pairIds){
      const members=items.filter(item=>item.languagePairId===pair&&!carried(map.get(item.id)));
      const where=new Set(members.map(item=>map.get(item.id)?.destination==='notes'?'notes':'slides'));
      if(where.size>1)for(const item of members){const entry=map.get(item.id);if(entry?.destination==='notes'){toSlides(entry,'language_pair_kept_together');changed=true;}}
    }
    for(const relation of project.originalSourceInventory?.relationships||project.source?.semantic?.inventory?.relationships||[]){
      const members=(relation.unitIds||[]).map(id=>map.get(id)).filter(Boolean);
      const where=new Set(members.map(entry=>entry.destination==='notes'&&!entry.visibleEquivalentSourceUnitId?'notes':'slides'));
      if(where.size>1)for(const entry of members)if(entry.destination==='notes'&&!entry.visibleEquivalentSourceUnitId){toSlides(entry,'relation_kept_together');changed=true;}
    }
    if(!changed)break;
  }
  // Ownership follows the disposition.
  for(const entry of entries){
    const id=entry.sourceUnitId;
    if(entry.destination==='notes'){
      const pages=detach(slides,id);
      if(pages.length)corrections.push({code:'notes_unit_removed_from_page',sourceUnitId:id,pageIndexes:pages});
    }else if(!ownedOnPage(id))attach(project,slides,id,corrections,'visible unit had no page');
  }
  // A projection must point to a real visible owner; otherwise drop it, or
  // keep the unit visible when the contract requires a visible equivalent.
  const map=byEntry();
  for(const entry of entries){
    if(entry.destination!=='notes')continue;
    const rule=rules.get(entry.sourceUnitId),item=byId.get(entry.sourceUnitId);
    const valid=id=>id&&visibleEquivalentCandidates(project,item).includes(id)&&ownedOnPage(id)&&['slides','summary'].includes(map.get(id)?.destination);
    if(entry.visibleEquivalentSourceUnitId&&!valid(entry.visibleEquivalentSourceUnitId)){
      const replacement=visibleEquivalentCandidates(project,item).find(valid);
      if(replacement){entry.visibleEquivalentSourceUnitId=replacement;corrections.push({code:'visible_equivalent_corrected',sourceUnitId:entry.sourceUnitId,visibleEquivalentSourceUnitId:replacement});}
      else{delete entry.visibleEquivalentSourceUnitId;corrections.push({code:'visible_equivalent_removed',sourceUnitId:entry.sourceUnitId});}
    }
    if(!entry.visibleEquivalentSourceUnitId&&rule&&!rule.notesWithoutVisibleEquivalentAllowed){
      const replacement=visibleEquivalentCandidates(project,item).find(valid);
      if(replacement){entry.visibleEquivalentSourceUnitId=replacement;corrections.push({code:'visible_equivalent_corrected',sourceUnitId:entry.sourceUnitId,visibleEquivalentSourceUnitId:replacement});}
      else{toSlides(entry,'notes_needs_visible_owner');attach(project,slides,entry.sourceUnitId,corrections,'unit cannot move to notes without a visible equivalent');}
    }
  }
  return {...raw,slides,selection:entries};
}

/** Primary ownership: one owner per non-table unit; visible units owned;
 * one navigation page without source units for long decks. */
function compileOwnership(project,raw,corrections){
  const slides=raw.slides;
  const notes=new Set((raw.selection||[]).filter(entry=>entry.destination==='notes').map(entry=>entry.sourceUnitId));
  const items=(project.originalSourceInventory?.items||project.source?.semantic?.inventory?.items||[]).filter(item=>!item.presentation&&!notes.has(item.id));
  for(const item of items){
    const owners=slides.flatMap((slide,index)=>(slide.sourceUnitIds||[]).includes(item.id)&&!(slide.repeatSourceUnitIds||[]).includes(item.id)?[index]:[]);
    const lineItem=project.source?.semantic?.inventory?.items?.find(source=>source.id===item.id)||item;
    const linePages=owners.map(index=>slides[index]);
    let completeLinePlan=hasExplicitSourceLineRanges(lineItem,linePages)&&inspectSourceLinePlan(lineItem,linePages).complete;
    if(!project.confirmedOutline&&!project.requestedOutline&&supportsSourceLineRanges(lineItem)&&linePages.some(slide=>(slide.sourceArtifactRanges||[]).some(ref=>ref.sourceUnitId===item.id&&(ref.lineStart!==undefined||ref.lineEnd!==undefined)))&&!completeLinePlan){
      // This is an unconfirmed generated proposal. Restore the complete
      // immutable source at one owner; measured pagination will allocate all
      // original lines. Never bless a missing tail just because bounds are valid.
      for(const index of owners)if(slides[index].sourceArtifactRanges)slides[index].sourceArtifactRanges=slides[index].sourceArtifactRanges.filter(ref=>ref.sourceUnitId!==item.id);
      for(const index of owners)if(!slides[index].titleLocked&&!slides[index].title_locked)slides[index].title=String(slides[index].title||'').replace(/\s*\((?:lines |第 )\d+\s*[–-]\s*\d+(?: 行)?\)$/u,'');
      corrections.push({code:'literal_range_restored_to_complete_source',sourceUnitId:item.id,keptPageIndex:owners[0],reason:'generated intervals did not preserve the original lines exactly once in reading order'});
      completeLinePlan=false;
    }
    if(!TABLE_TYPES.has(item.type)&&owners.length>1&&!completeLinePlan){
      for(const index of owners.slice(1)){slides[index].sourceUnitIds=slides[index].sourceUnitIds.filter(id=>id!==item.id);if(slides[index].sourceArtifactRanges)slides[index].sourceArtifactRanges=slides[index].sourceArtifactRanges.filter(ref=>ref.sourceUnitId!==item.id);}
      corrections.push({code:'duplicate_owner_removed',sourceUnitId:item.id,keptPageIndex:owners[0],removedPageIndexes:owners.slice(1)});
    }
    if(!owners.length&&!slides.some(slide=>owns(slide,item.id))&&(project.generationPolicy?.content==='full_source'||item.priority==='high'||raw.selection))attach(project,slides,item.id,corrections,'unit had no page');
  }
  // Reserve structural navigation only while an automatic proposal is
  // mutable. Source ownership and an explicit/frozen total are never traded.
  if(!project.confirmedOutline&&!project.requestedOutline&&automaticPages(project)&&slides.length>=8&&slides.length<100&&items.length>=16&&!slides.some(slide=>slide.role==='navigation')){
    const title=({zh:'目录','zh-Hant':'目錄',de:'Inhalt',fr:'Sommaire',es:'Contenido',ja:'目次',ko:'목차'})[deckLanguage(project)]||'Contents';
    slides.splice(1,0,{title,focus:title,role:'navigation',sourceUnitIds:[],sourceImageIds:[],sourceArtifactRanges:[],keyPoints:[],requiredDetails:[],requiredEvidenceIds:[]});
    corrections.push({code:'navigation_page_reserved',pageIndex:1,reason:'automatic long deck requires derived navigation; all complete source owners retained'});
  }
  const navigation=slides.flatMap((slide,index)=>slide.role==='navigation'?[index]:[]);
  for(const index of navigation.slice(1)){slides[index].role='mechanism';corrections.push({code:'extra_navigation_page_converted',pageIndex:index});}
  if(navigation.length&&(slides[navigation[0]].sourceUnitIds||[]).length){
    const moved=slides[navigation[0]].sourceUnitIds;slides[navigation[0]].sourceUnitIds=[];
    for(const id of moved)attach(project,slides,id,corrections,'navigation page holds no source units');
  }
  return raw;
}

/** Source evidence belongs with body facts, not the topic-only cover or
 * generated navigation/thanks. Normalize automatic proposals before capacity
 * assessment; confirmed or explicitly requested assignments stay frozen. */
export function compileSourceMediaOwnership(project,raw,corrections=[]){
 if(project.confirmedOutline||project.requestedOutline||!project.source?.images?.length)return raw;
 const slides=raw.slides;
 const targets=slides.map((slide,index)=>({slide,index})).filter(({slide,index})=>index>0&&slide.role!=='navigation'&&(index<slides.length-1||(slide.sourceUnitIds||[]).length));
 if(!targets.length)return raw;
 const items=inventoryOf(project).byId;
 for(const image of project.source.images){
  if(image.role&&image.role!=='source_content')continue;
  const invalid=slides.flatMap((slide,index)=>(slide.sourceImageIds||[]).includes(image.id)&&!targets.some(target=>target.index===index)?[index]:[]);
  const hasOwner=targets.some(({slide})=>slide.sourceImageIds?.includes(image.id));
  if(!invalid.length&&(hasOwner||!image.required&&!image.mustPreserve))continue;
  for(const index of invalid)slides[index].sourceImageIds=slides[index].sourceImageIds.filter(id=>id!==image.id);
  if(hasOwner){corrections.push({code:'ownership_assigned',sourceImageId:image.id,fromPageIndices:invalid,reason:'removed source-media duplicate from topic-only page; complete body owner retained'});continue;}
  const refs=new Set([...(image.sourceRefs||[]),...(image.sourceRef?[image.sourceRef]:[])]);
  const words=String(image.caption||image.fileName||'').toLowerCase().match(/[a-z]{3,}|[\p{Script=Han}]{2,}/gu)||[];
  const score=({slide})=>{const owned=(slide.sourceUnitIds||[]).map(id=>items.get(id)).filter(Boolean),text=[slide.title,slide.focus,...owned.map(item=>item.text)].join(' ').toLowerCase();return owned.reduce((sum,item)=>sum+(item.sourceRefs||[]).filter(ref=>refs.has(ref)).length*10,0)+words.filter(word=>text.includes(word)).length+(owned.length?1:0);};
  const target=targets.reduce((best,candidate)=>score(candidate)>score(best)?candidate:best);
  target.slide.sourceImageIds=[...new Set([...(target.slide.sourceImageIds||[]),image.id])];
  corrections.push({code:'ownership_assigned',sourceImageId:image.id,pageIndex:target.index,fromPageIndices:invalid,reason:'source evidence assigned to related body before measured media capacity validation'});
 }
 return raw;
}

/** Compile a version-2 outline. Returns the corrected outline and the list of
 * corrections; never throws for a correctable slip. */
export function compileOutlineCandidate(project,raw){
  const corrections=[];
  if(raw?.version!==2||!Array.isArray(raw.slides)||raw.slides.length<3||project.nativeTitleRepairSeed)return {raw,corrections};
  let next=compileSlides(project,structuredClone(raw),corrections);
  next=compileSelection(project,next,corrections);
  next=compileOwnership(project,next,corrections);
  next=compileSourceMediaOwnership(project,next,corrections);
  if(next.slides.some(slide=>!slide||!Array.isArray(slide.sourceUnitIds)))return {raw,corrections:[]};
  // Every page has its own title (round 7, A6).
  const titled=distinctPageTitles(project,next.slides);
  next={...next,slides:titled.slides};corrections.push(...titled.corrections);
  return {raw:next,corrections};
}

/** Short user-facing grouping of corrections for the confirmation page. */
export function summarizeOutlineCorrections(corrections=[]){
  const counts=new Map();
  for(const correction of corrections)counts.set(correction.code,(counts.get(correction.code)||0)+1);
  return [...counts].map(([code,count])=>({code,count}));
}
