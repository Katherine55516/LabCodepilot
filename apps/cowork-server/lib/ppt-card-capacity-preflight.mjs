import {fitObjectPage,objectContinuation,fitThemePage,nativeCardSlots} from './ppt-card-pages.mjs';
import {splitCardPage,listRunPoints} from './ppt-outline-cards.mjs';
import {componentCounts,splitCounts} from './ppt-card-blocks.mjs';
/** A card filled into its own template page (sticky, status filled): no pass splits or merges it. */
const filled=page=>Boolean(page?.templateFill?.sticky&&page.templateFill.status==='filled');

const tableCardNotes=(project,page)=>{
 const preset=project.planningContract?.deckPlan?.length?.preset??project.planningContract?.pagePreference?.preset;
 if(preset==='full'||!(page.keyPoints||[]).length)return false;
 const types=new Map((project.source?.semantic?.inventory?.items||[]).map(item=>[item.id,item.type]));
 return (page.cardObjects||[]).some(id=>['TableBlock','SummaryTableBlock'].includes(types.get(id)));
};
/** Below the full length a page showing a table keeps at most three points
 * beside it, and none that only restates the table: those go to the page's
 * notes (the user, 2026-11-01: CodePilot docx pages held 8 points at 10 pt
 * beside a table, "四层容量证据" repeated its four rows). A numbered list of
 * steps keeps its steps; only its restatements leave. */
export const TABLE_POINTS_MAX=3;
const tokensOf=text=>{const lower=String(text||'').normalize('NFKC').toLocaleLowerCase();return[...(lower.match(/\p{Script=Han}/gu)||[]),...(lower.match(/[a-z0-9][a-z0-9._-]*/gu)||[])];};
const itemsOf=project=>new Map((project.source?.semantic?.inventory?.items||[]).map(item=>[item.id,item]));
export function trimTablePoints(project,page){
 const items=new Map((project.source?.semantic?.inventory?.items||[]).map(item=>[item.id,item]));
 const tables=(page.cardObjects||[]).filter(id=>['TableBlock','SummaryTableBlock'].includes(items.get(id)?.type));
 const own=(page.keyPoints||[]).filter(point=>!point.navigation),nav=(page.keyPoints||[]).filter(point=>point.navigation);
 const table=new Set(tables.flatMap(id=>tokensOf([items.get(id)?.text,...(items.get(id)?.rows||[]).flat()].join('\n'))));
 // A point citing only the shown table whose words are the table's own.
 const restates=point=>{const ids=point.sourceUnitIds||[],words=tokensOf(point.text);return ids.length>0&&ids.every(id=>tables.includes(id))&&words.length>0&&words.filter(word=>table.has(word)).length>=.7*words.length;};
 // A procedure among other points (steps 1-5 beside results) stays whole on
 // the page and the other points go to the notes; the page then holds a
 // numbered list (Fable, 2026-11-01; World Models p4 lost steps 4-5 twice).
 const run=page.numberedPoints?[]:listRunPoints({points:own},items).filter(point=>!restates(point));
 const kept=own.filter(point=>!restates(point));
 let shown=page.numberedPoints?kept:run.length?run:kept.slice(0,TABLE_POINTS_MAX);
 // No bare table page: at least two of the card's points stay visible, a
 // restating point too when nothing else is left (Fable E, 2026-11-01: four
 // 3186 docx pages showed a table and nothing else).
 const minimum=Math.min(2,own.length);
 if(shown.length<minimum)shown=own.filter(point=>shown.includes(point)||own.filter(other=>!shown.includes(other)).slice(0,minimum-shown.length).includes(point));
 const moved=own.filter(point=>!shown.includes(point));
 return moved.length?{page:{...page,keyPoints:[...shown,...nav],notePoints:[...(page.notePoints||[]),...moved],...(run.length?{numberedPoints:true}:{})},restated:own.length-kept.length,moved:moved.length}:null;
}
/** The exact object+commentary or card fit used by generation, without a
 * persisted source plan. Never treat an object-only fit as the whole page. */
export function cardCapacityHint(project,index,page=project.outline[index]){
 if(index===0||page.cardFrame||page.figurePage)return null;
 if(page.cardFigureLayout&&!fitThemePage(project,index,page)?.fit.capacity_ok)return {figureFallback:true};
 if(page.cardObjects?.length){
  const fit=fitObjectPage(project,index,page,{planned:false});
  if(fit&&fit.kept===(page.keyPoints||[]).length)return null;
  // Below the full length a table card keeps the points that fit beside its
  // table; the rest go to the page's notes, never a points-only page (the user,
  // 2026-10-31: the docx's 10 extra pages were such continuations).
  // A numbered list never splits between the page and its notes: it continues
  // on a "· 2/2" page (Fable, 2026-11-01; World Models p4 lost steps 4-5).
  if(fit&&Number.isInteger(fit.kept)&&tableCardNotes(project,page)&&!page.numberedPoints)return {notesFrom:fit.kept};
  return objectContinuation(project,index,page,{planned:false})||{unfit:true};
 }
 if(!page.keyPoints?.length||nativeCardSlots(project,index,page))return null;
 if(fitThemePage(project,index,page)?.fit.capacity_ok)return null;
 // Split at a complete point, measuring the actual prefix. Prefer a readable
 // group, but do not keep two oversized paragraphs merely to satisfy a count.
 let kept=0;
 for(let k=1;k<page.keyPoints.length;k++)if(fitThemePage(project,index,{...page,keyPoints:page.keyPoints.slice(0,k)})?.fit.capacity_ok)kept=k;
 // At least two points move on: the font ladder can fit all but one, which
 // would leave the continuation a single point.
 if(kept>1&&page.keyPoints.length-kept===1)kept--;
 return kept?{kept}:{unfit:true};
}

/** Re-measure every child after scheduling. Bounded, lossless, and idempotent;
 * indivisible oversized points remain explicit rather than being truncated. */
export function preflightCardCapacity(project,raw,{schedule,maxPasses=12,maxPages=100}={}){
 let next=structuredClone(raw);const changes=[];
 for(let pass=0;pass<maxPasses;pass++){
  project.outline=next.slides;project.pages=next.slides.length;
  schedule?.(project);
  let changed=false;
  for(let index=project.outline.length-1;index>0;index--){
   const page=next.slides[index],trimmed=!page.cardFrame&&page.region!=='appendix'&&tableCardNotes(project,page)?trimTablePoints(project,page):null;
   if(trimmed){next.slides[index]=trimmed.page;changes.push({reason:`"${String(page.title).slice(0,60)}": ${trimmed.moved} point(s) beside the table are in the speaker notes${trimmed.restated?` (${trimmed.restated} restating the table)`:''}.`,pageIds:[page.id]});changed=true;}
   const hint=cardCapacityHint(project,index);
   if(!hint||hint.unfit)continue;
   if(hint.notesFrom!==undefined){
    // An appendix pointer stays on the page; the card's own last points make
    // room for it (docx: "附录 B" went to the notes). Only a pointer that does
    // not fit beside the table even alone goes to the notes as well.
    const page=next.slides[index],nav=page.keyPoints.filter(point=>point.navigation),own=page.keyPoints.filter(point=>!point.navigation),keep=Math.max(0,hint.notesFrom-nav.length),navKept=Math.min(nav.length,hint.notesFrom);
    // Fewer than two of the card's points fit beside its table: the table goes
    // to the appendix with a pointer and the card keeps its points (Fable E).
    const exact=project.planningContract?.settings?.length?.exact||project.planningContract?.length?.exact;
    const tables=(page.cardObjects||[]).filter(id=>['TableBlock','SummaryTableBlock'].includes(itemsOf(project).get(id)?.type));
    if(!exact&&tables.length&&keep<Math.min(2,own.length)){
     next.slides[index]={...page,cardObjects:(page.cardObjects||[]).filter(id=>!tables.includes(id)),sourceArtifactRanges:(page.sourceArtifactRanges||[]).filter(range=>!tables.includes(range.sourceUnitId)),appendixTables:[...(page.appendixTables||[]),...tables]};
     changes.push({reason:`"${String(page.title).slice(0,60)}": its table goes to the appendix so that its points stay on the page.`,pageIds:[page.id]});changed=true;continue;}
    const moved=[...own.slice(keep),...nav.slice(navKept)];
    if(!moved.length)continue;
    next.slides[index]={...page,keyPoints:[...own.slice(0,keep),...nav.slice(0,navKept)],notePoints:[...(page.notePoints||[]),...moved]};
    changes.push({reason:`"${String(page.title).slice(0,60)}": ${moved.length} point(s) that do not fit beside the table are in the speaker notes.`,pageIds:[page.id]});changed=true;continue;}
   // A page filled into its template page is fixed: its blocks were checked against that page's text boxes (fill-template-first).
   if(filled(next.slides[index]))continue;
   const proposal=splitCardPage(project,next,index,{...hint,beforeSchedule:true});
   if(!proposal||proposal.raw.slides.length>maxPages)continue;
   next=proposal.raw;changes.push(proposal.change);changed=true;
  }
  if(!changed)break;
 }
 project.outline=next.slides;project.pages=next.slides.length;schedule?.(project);
 // Before confirmation only: attach a small continuation/qualification to a
 // related adjacent card when the complete object+copy fits its final frame.
 // Exact page budgets and already-confirmed decks keep their chosen structure.
 if(!project.confirmedOutline&&project.pageDecision?.mode!=='explicit'&&!project.planningContract?.settings?.length?.exact){
  const items=new Map((project.source?.semantic?.inventory?.items||[]).map(item=>[item.id,item]));
  const section=page=>new Set((page.sourceUnitIds||[]).map(id=>items.get(id)?.sectionPath?.join('\u0000')).filter(Boolean));
  // A continuation holding a single point (no object, figure or table) goes
  // back to the card's page before it when the merged page is measured to fit,
  // its points stepping down the font ladder if needed (Fable 2026-10-31, World
  // Models p12: "Iterative Training Procedure · 2/2" was one paragraph on an
  // otherwise empty page).
  // A merged unnumbered page holds no more blocks than the uploaded template's
  // largest component; without one the measured fit decides as before (the hand deck, Fable G4; world_models zh on Mood 2026-11-03: a
  // 3+2 split rejoined as five blocks on a four-block template).
  const blocks=Math.max(0,...splitCounts(project))||Infinity,numbered=(a,b)=>Boolean(a.numberedPoints&&b.numberedPoints),within=(a,b,count)=>numbered(a,b)||count<=blocks;
  const bare=page=>!filled(page)&&!page.cardFrame&&!page.figurePage&&page.region!=='appendix'&&!page.cardObjects?.length&&!page.sourceArtifactRanges?.length&&!page.sourceImageIds?.length;
  for(let index=2;index<next.slides.length;index++){
   const page=next.slides[index],prev=next.slides[index-1];
   if(!bare(page)||!bare(prev)||(page.keyPoints||[]).length!==1||page.keyPoints[0].navigation||!(prev.keyPoints||[]).length||!page.logicalCardId||page.logicalCardId!==prev.logicalCardId||!within(prev,page,prev.keyPoints.length+1))continue;
   const union=key=>[...new Set([...(prev[key]||[]),...(page[key]||[])])];
   const merged={...prev,keyPoints:[...prev.keyPoints,...page.keyPoints],sourceUnitIds:union('sourceUnitIds'),refs:union('refs'),chunkRefs:union('chunkRefs'),...(prev.claimIds||page.claimIds?{claimIds:union('claimIds')}:{})};
   const trial={...project,outline:next.slides.map((p,k)=>k===index-1?merged:p).filter((_,k)=>k!==index),pages:next.slides.length-1,templateFidelity:structuredClone(project.templateFidelity)};
   schedule?.(trial);
   if(trial.outline.some((p,k)=>k>0&&cardCapacityHint(trial,k,p)))continue;
   next.slides=trial.outline;project.outline=next.slides;project.pages=next.slides.length;project.templateFidelity=trial.templateFidelity;
   (next.notes||=[]).push({code:'single_point_continuation_merged',message:`"${page.title}" held one point; it joins "${prev.title}".`});
   changes.push({reason:'a one-point continuation measured back onto its card page',replacedPageId:page.id,pageIds:[merged.id]});index--;
  }
  const inventory=project.source?.semantic?.inventory?.items||[],order=new Map(inventory.map((item,k)=>[item.id,k]));
  // Rejoin small equation fragments only inside one contiguous source family.
  // Each candidate includes its COMPLETE (possibly shared) definitions. The
  // schedule and every other page are remeasured before accepting a merge.
  for(let index=1;next.slides.length>6&&index<next.slides.length-1;index++){
   const a=next.slides[index],b=next.slides[index+1],ids=[...(a.cardObjects||[]),...(b.cardObjects||[])];
   if(a.logicalCardId&&b.logicalCardId&&a.logicalCardId!==b.logicalCardId)continue;
   if(filled(a)||filled(b)||!a.cardObjects?.length||!b.cardObjects?.length||ids.length>3||new Set(ids).size!==ids.length||a.cardFrame||b.cardFrame||a.figurePage||b.figurePage||a.sourceArtifactRanges?.length||b.sourceArtifactRanges?.length||!ids.every(id=>items.get(id)?.type==='EquationBlock'))continue;
   const positions=ids.map(id=>order.get(id)).sort((x,y)=>x-y);
   if(inventory.slice(positions[0],positions.at(-1)+1).some(item=>item.type!=='EquationBlock'))continue;
   const definitions=new Map();for(const point of [...(a.keyPoints||[]),...(b.keyPoints||[])]){const key=String(point.text||'').trim(),prior=definitions.get(key);definitions.set(key,prior?{...prior,sourceUnitIds:[...new Set([...(prior.sourceUnitIds||[]),...(point.sourceUnitIds||[])])]}:structuredClone(point));}
   const keyPoints=[...definitions.values()];
   const union=key=>[...new Set([...(a[key]||[]),...(b[key]||[])])];
   const contract={...a.pageContract};for(const key of ['requiredUnits','requiredRelations'])contract[key]=[...new Set([...(a.pageContract?.[key]||[]),...(b.pageContract?.[key]||[])])];
   contract.adjacencyPairs=[...new Map([...(a.pageContract?.adjacencyPairs||[]),...(b.pageContract?.adjacencyPairs||[])].map(pair=>[JSON.stringify(pair),pair])).values()];
   const merged={...a,cardObjects:ids,keyPoints,sourceUnitIds:union('sourceUnitIds'),refs:union('refs'),chunkRefs:union('chunkRefs'),claimIds:union('claimIds'),pageContract:contract};
   const trial={...project,outline:next.slides.map((page,k)=>k===index?merged:page).filter((_,k)=>k!==index+1),pages:next.slides.length-1,templateFidelity:structuredClone(project.templateFidelity)};
   schedule?.(trial);const fit=fitObjectPage(trial,index,merged,{planned:false});
   if(!fit?.fit?.capacity_ok||fit.kept!==keyPoints.length||trial.outline.some((page,k)=>cardCapacityHint(trial,k,page)))continue;
   next.slides=trial.outline;project.outline=next.slides;project.pages=next.slides.length;project.templateFidelity=trial.templateFidelity;
   changes.push({reason:'complete adjacent equation family and definitions measured together',replacedPageId:b.id,pageIds:[a.id]});
   (next.notes||=[]).push({code:'equation_fragments_consolidated',message:'Adjacent equations in one source family share a measured page; all definitions retained.'});index=Math.max(0,index-1);
  }
  for(let index=1;next.slides.length>6&&index<next.slides.length-1;index++){
   const page=next.slides[index];
   if(filled(page)||page.cardFrame||page.figurePage||page.cardObjects?.length||page.sourceImageIds?.length||!page.keyPoints?.length||page.keyPoints.length>2)continue;
   const at=[index-1,index+1].find(k=>{const other=next.slides[k];if(k<1||!other||filled(other)||other.cardFrame||other.figurePage||other.sourceImageIds?.length||(other.keyPoints?.length||0)+page.keyPoints.length>(numbered(other,page)?5:Math.min(5,blocks)))return false;
    return other.logicalCardId===page.logicalCardId||[...section(page)].some(s=>section(other).has(s));});
   if(at===undefined)continue;
   const other=next.slides[at],merged={...other,keyPoints:at<index?[...(other.keyPoints||[]),...page.keyPoints]:[...page.keyPoints,...(other.keyPoints||[])],sourceUnitIds:[...new Set([...(other.sourceUnitIds||[]),...(page.sourceUnitIds||[])])]};
   const trial={...project,outline:next.slides.map((p,k)=>k===at?merged:p).filter((_,k)=>k!==index),pages:next.slides.length-1,templateFidelity:structuredClone(project.templateFidelity)};
   schedule?.(trial);const target=trial.outline.findIndex(p=>p.id===merged.id);
   const fit=merged.cardObjects?.length?fitObjectPage(trial,target,merged,{planned:false}):fitThemePage(trial,target,merged);
   if(!fit?.fit?.capacity_ok||merged.cardObjects?.length&&fit.kept!==merged.keyPoints.length)continue;
   // A schedule change must not break another page while making this one fit.
   if(trial.outline.some((p,k)=>cardCapacityHint(trial,k,p)))continue;
   next.slides=trial.outline;project.outline=next.slides;project.pages=next.slides.length;project.templateFidelity=trial.templateFidelity;
   (next.notes||=[]).push({code:'thin_card_consolidated',message:`"${page.title}" joins "${other.title}"; complete content measured on the rescheduled frames.`});
   changes.push({reason:'measured related thin card consolidation',replacedPageId:page.id,pageIds:[merged.id]});index=Math.max(0,index-1);
  }
 }
 const unresolved=project.outline.flatMap((page,index)=>cardCapacityHint(project,index,page)?[{pageId:page.id,page:index+1}]:[]);
 return {raw:next,changes,unresolved};
}

/** Repair a failure wave and its newly created children before another writer
 * run. A hard failure or exhausted budget never restarts unchanged failures. */
export async function repairCapacityBatch({getProject,repair,maxRepairs=8,needsRepair=cardCapacityHint}){
 const initial=getProject(),queue=initial?.outline.filter(page=>initial.nodes?.[page.id]?.status==='failed').map(page=>page.id)||[];
 let repaired=0;
 while(queue.length&&repaired<maxRepairs){
  const pageId=queue.shift(),before=getProject(),oldIds=new Set(before.outline.map(page=>page.id));
  if(!await repair(pageId))return false;
  repaired++;
  const after=getProject();
  for(const [index,page] of after.outline.entries())if((page.id===pageId||!oldIds.has(page.id))&&needsRepair(after,index)&&!queue.includes(page.id))queue.push(page.id);
 }
 return repaired>0&&queue.length===0;
}
