/** Source tables that go to the appendix (user decisions 2026-10-31).
 *
 * D1: a table that needs more than one page moves whole, from its first row,
 * to appendix pages before the closing page; its card keeps a line that
 * points there (Fable D 2026-11-01: no truncated head stays in the body).
 * One table per card (quick and standard lengths): a card keeps the table its
 * points cite most; its other tables move to the appendix whole, with the
 * pointer on the card's first remaining page.
 * The source's own appendix (quick and standard): its tables, restored to the
 * body only because they are required, go straight to the appendix, no pointer.
 * A continuation page that also carries points stays in the body without the
 * table, so no point leaves the main flow. An exact page count keeps tables
 * where they are: appendix pages would break the count the author chose.
 * docx 2026-10-31: 21 planned pages became 39-41; one card ran to 9 pages. */
import crypto from 'node:crypto';
import {APPENDIX_SECTION} from './ppt-card-outline.mjs';
import {unmarked,isContinued} from './ppt-continuation-marker.mjs';

const TABLES=new Set(['TableBlock','SummaryTableBlock']);
const LETTERS='ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const tableRange=(slide,id)=>(slide.sourceArtifactRanges||[]).filter(range=>range.sourceUnitId===id&&range.rowStart!==undefined);
const newId=seed=>'page_'+crypto.createHash('sha256').update(JSON.stringify(seed)).digest('hex').slice(0,20);
const chinese=project=>/^zh/u.test(String(project.generationPolicy?.language?.locale||''))||project.generationPolicy?.language?.mode!=='output'&&/^zh/u.test(String(project.inputUnderstanding?.primaryLanguage||''));
// A card's later page follows it in its topic with its unnumbered title or a
// continuation marker; two cards of one topic are two cards (world_models.pdf:
// "VizDoom Take Cover Procedure" joined the next card under its title
// "Temperature Effects on Scores").
const stem=title=>unmarked(String(title||'')).normalize('NFKC').replace(/\s+/gu,' ').trim().toLocaleLowerCase();
const continues=(before,slide)=>Boolean(before&&slide.logicalCardId&&before.logicalCardId===slide.logicalCardId&&(stem(before.title)===stem(slide.title)||isContinued(slide.title)));
// Numbers, Chinese terms and longer words of a table's cells or a point, for
// matching one to the other; short common words ("the", "with") would favour
// the bigger table.
const cellTokens=text=>[...new Set((String(text||'').normalize('NFKC').toLocaleLowerCase().match(/\d+(?:[.,]\d+)*|[\p{L}][\p{L}\p{N}_-]{2,}/gu)||[]).filter(token=>/^\d/u.test(token)||/\p{Script=Han}/u.test(token)||token.length>=5))];
const stripCounter=title=>String(title||'').replace(/\s*·\s*\d+\s*\/\s*\d+\s*$/u,'').trim();
// An appendix title keeps its counter: a long heading is shortened instead (xlsx: six pages of one title).
const shortHeading=(text,zh)=>{const max=zh?14:36,chars=[...text];return chars.length<=max?text:chars.slice(0,max-1).join('').trim()+'…';};

// Only the length setting {exact:N} names a page count; confirming an outline also records pageSource 'user'.
export function exactLength(project){return Boolean(project.planningContract?.settings?.length?.exact||project.planningContract?.length?.exact);}
const lengthPreset=project=>project.planningContract?.deckPlan?.length?.preset||project.planningContract?.length?.preset||project.planningContract?.settings?.length?.preset;
const belowFull=project=>lengthPreset(project)!=='full';

/** A source table of one row (a header and no data, as PDF extraction leaves
 * "ViT-H/14 | 87.5 | 58.4 | 47.6" or "A ∩ B") is not drawn as a table: it
 * rendered as a lone blue header strip (Fable 2026-10-31, JEPA p9/10/12/16/17,
 * CodePilot PDF p17). Its cells, joined, go to the page's speaker notes; a page
 * left with nothing else shows them as one plain line instead.
 * Returns {raw, moved:[{tableId,pageId,to:'notes'|'line'}]}. */
export function oneRowTablesOff(project,raw){
 const items=new Map((project.source?.semantic?.inventory?.items||[]).map(item=>[item.id,item]));
 const oneRow=id=>{const item=items.get(id);return TABLES.has(item?.type)&&Array.isArray(item.rows)&&item.rows.length===1;};
 const moved=[];
 const slides=(raw?.slides||[]).map((slide,index)=>{
  if(!index||slide.cardFrame||slide.region==='appendix')return slide;
  const ids=[...new Set([...(slide.cardObjects||[]),...(slide.sourceArtifactRanges||[]).map(range=>range.sourceUnitId)])].filter(oneRow);
  if(!ids.length)return slide;
  const cardObjects=(slide.cardObjects||[]).filter(id=>!ids.includes(id)),sourceArtifactRanges=(slide.sourceArtifactRanges||[]).filter(range=>!ids.includes(range.sourceUnitId));
  const lines=ids.map(id=>{const item=items.get(id);return {text:item.rows[0].map(cell=>String(cell??'').replace(/\s+/gu,' ').trim()).filter(Boolean).join(' · '),refs:item.source_ref||[],chunkRefs:item.chunkRefs||[],sourceUnitIds:[id]};}).filter(line=>line.text);
  const empty=!(slide.keyPoints||[]).length&&!cardObjects.length&&!sourceArtifactRanges.length&&!(slide.sourceImageIds||[]).length;
  for(const id of ids)moved.push({tableId:id,pageId:slide.id,to:empty?'line':'notes'});
  const rest={...slide,cardObjects,sourceArtifactRanges};
  return empty?{...rest,keyPoints:lines}:{...rest,sourceUnitIds:(slide.sourceUnitIds||[]).filter(id=>!ids.includes(id)),notePoints:[...(slide.notePoints||[]),...lines]};
 });
 return moved.length?{raw:{...raw,slides},moved}:{raw,moved};
}

/** Returns {raw, moved:[{tableId,letter,reason,bodyPages,appendixPages}]}; raw is unchanged when nothing moves.
 * An uncited table (reason uncited_table) has no letter and no appendix page; raw.optionalTables lists it. */
export function moveLongTablesToAppendix(project,raw){
 const slides=raw?.slides||[];if(slides.length<3||exactLength(project))return {raw,moved:[]};
 const items=new Map((project.source?.semantic?.inventory?.items||[]).map(item=>[item.id,item]));
 const isTable=id=>TABLES.has(items.get(id)?.type);
 const content=(slide,index)=>index>0&&!slide.cardFrame&&slide.region!=='appendix'&&slide.role!=='closing';
 // Body pages showing each table, in order.
 const shown=new Map();
 slides.forEach((slide,index)=>{if(!content(slide,index))return;
  for(const id of new Set([...(slide.cardObjects||[]),...(slide.sourceArtifactRanges||[]).map(range=>range.sourceUnitId)]))if(isTable(id)){if(!shown.has(id))shown.set(id,[]);shown.get(id).push(index);}});
 const plan=new Map();
 // A table its card's points could not sit beside (Fable E) goes to the
 // appendix whole; the card keeps its points and a pointer.
 slides.forEach((slide,index)=>{if(!content(slide,index))return;
  for(const id of slide.appendixTables||[])if(isTable(id)&&!plan.has(id)){shown.set(id,[...(shown.get(id)||[]),index]);plan.set(id,{reason:'table_page_fit',keepFirst:false,pointer:true,card:[index]});}});
 // The source's own appendix: its tables leave the body entirely.
 if(belowFull(project))for(const [id] of shown)if((items.get(id)?.sectionPath||[]).some(part=>APPENDIX_SECTION.test(String(part).trim())))plan.set(id,{reason:'source_appendix',keepFirst:false,pointer:false});
 // One table per card: the one its points cite most stays; ties keep the first shown.
 if(belowFull(project)){
  const cards=[];let previous=null;
  slides.forEach((slide,index)=>{if(!content(slide,index)||!slide.logicalCardId||slide.figurePage)return;if(continues(previous,slide))cards.at(-1).push(index);else cards.push([index]);previous=slide;});
  for(const pages of cards){
   const tables=[...new Set(pages.flatMap(index=>(slides[index].cardObjects||[]).filter(isTable)))].filter(id=>!plan.has(id));
   if(tables.length<2)continue;
   const cites=id=>pages.reduce((sum,index)=>sum+(slides[index].keyPoints||[]).filter(point=>(point.sourceUnitIds||[]).includes(id)).length,0);
   // A tie (often none cited) keeps the table whose cells the points use most
   // (world_models: the temperature table, not the parameter counts, beside
   // "Best actual score is 1092 ± 556 with τ = 1.15").
   const said=new Set(pages.flatMap(index=>(slides[index].keyPoints||[]).flatMap(point=>cellTokens(point.text))));
   const uses=id=>cellTokens([items.get(id)?.text,...(items.get(id)?.rows||[]).flat()].join('\n')).filter(token=>said.has(token)).length;
   const keep=tables.reduce((best,id)=>cites(id)>cites(best)||cites(id)===cites(best)&&uses(id)>uses(best)?id:best,tables[0]);
   // A table no point cites leaves the deck: the closing page's notes name it
   // (the user, 2026-10-31: 26 of 49 pages were appendix; as cited figures only).
   for(const id of tables)if(id!==keep)plan.set(id,cites(id)?{reason:'one_table_per_card',keepFirst:false,pointer:true,card:pages}:{reason:'uncited_table',keepFirst:false,pointer:false,omit:true});
  }
 }
 // D1: a table that needs more than one page keeps its first page.
 // A table needing more than one page lives in the appendix only; its card
 // keeps its points and a pointer, never a truncated head (Fable D,
 // 2026-11-01: the docx's 49-row API table showed its head on page 15 and in
 // full on four appendix pages).
 for(const [id,pages] of shown)if(!plan.has(id)&&pages.length>=2&&pages.every((page,k)=>!k||page===pages[k-1]+1)&&pages.every(index=>tableRange(slides[index],id).length))plan.set(id,{reason:'long_table',keepFirst:false,pointer:true,card:pages});
 if(!plan.size)return {raw,moved:[]};
 const zh=chinese(project),hant=/^zh-(?:HK|TW|Hant)/iu.test(String(project.generationPolicy?.language?.locale||'')),appendixWord=hant?'附錄':'附录',closing=slides.findIndex(slide=>slide.role==='closing'||slide.cardFrame==='closing');
 const drop=new Set(),edits=new Map(),appendix=[],moved=[],pointers=[];
 const page=index=>edits.get(index)||slides[index];
 let letterIndex=0;
 // One pointer line a page names every moved table ("附录 B、C、D"): three
 // separate lines read as three points (docx 2026-10-31).
 const withPointer=(slide,letter)=>{const letters=[...String(slide.tableAppendix||'').split(',').filter(Boolean),letter],list=letters.join(zh?'、':', ');
  const pointer={text:zh?`${hant?'完整表格見附錄':'完整表格见附录'} ${list}`:`Full table${letters.length>1?'s':''} in Appendix ${list}`,navigation:true,refs:[],chunkRefs:[],sourceUnitIds:[]};
  return {...slide,keyPoints:[...(slide.keyPoints||[]).filter(point=>!point.navigation),pointer],tableAppendix:letters.join(',')};};
 const omitted=[];
 for(const [tableId,how] of plan){
  const pages=shown.get(tableId);
  if(how.omit){
   for(const index of pages){const current=page(index),rest=(current.sourceArtifactRanges||[]).filter(range=>range.sourceUnitId!==tableId),objects=(current.cardObjects||[]).filter(id=>id!==tableId);
    if((current.keyPoints||[]).length||rest.length||objects.length)edits.set(index,{...current,sourceArtifactRanges:rest,cardObjects:objects,sourceUnitIds:(current.sourceUnitIds||[]).filter(id=>id!==tableId)});else drop.add(index);}
   omitted.push(tableId);moved.push({tableId,letter:'',reason:how.reason,bodyPages:0,appendixPages:0});continue;}
  const letter=LETTERS[letterIndex++%LETTERS.length],first=slides[pages[0]];
  // The table's own source heading names its appendix; a heading that already says appendix is not doubled.
  const base=String(items.get(tableId)?.sectionPath?.at(-1)||'').replace(/^(?:附录|附錄|appendix)[\s_:：·-]*/iu,'').replace(/^(?:(?:[A-Z][.)]?)?\d+(?:\.\d+)*(?:[.)]\s*|\s+))+/u,'').trim()||stripCounter(first.title);
  if(how.keepFirst){
   // The pointer takes the room of two rows (at least three stay): an extra
   // line on a full page split it and left the pointer alone (xlsx).
   const head=page(pages[0]);
   edits.set(pages[0],{...withPointer(head,letter),
    sourceArtifactRanges:(head.sourceArtifactRanges||[]).map(range=>range.sourceUnitId===tableId&&range.rowEnd-range.rowStart>3?{...range,rowEnd:Math.max(range.rowStart+3,range.rowEnd-2)}:range)});
  }
  for(const index of how.keepFirst?pages.slice(1):pages){
   const current=page(index),rest=(current.sourceArtifactRanges||[]).filter(range=>range.sourceUnitId!==tableId),objects=(current.cardObjects||[]).filter(id=>id!==tableId);
   // A page that still has points or other objects stays, without this table.
   if((current.keyPoints||[]).length||rest.length||objects.length)edits.set(index,{...current,sourceArtifactRanges:rest,cardObjects:objects,sourceUnitIds:(current.sourceUnitIds||[]).filter(id=>id!==tableId||rest.some(range=>range.sourceUnitId===id))});
   else drop.add(index);
  }
  // The card keeps a body page however its pages went: its first page stays
  // without the table, with points from its notes when it had none, so the
  // reviewed topic remains in the body and the pointer has a home (3200 docx,
  // 2026-11-01: "主要业务 API" lived only in the appendix and failed planning).
  const card=how.card||pages,survives=slides.some((slide,index)=>!drop.has(index)&&content(slide,index)&&slide.logicalCardId&&slide.logicalCardId===slides[card[0]].logicalCardId);
  if(!how.keepFirst&&how.pointer&&!survives){
   const index=card[0],current=page(index),notes=current.notePoints||[];
   drop.delete(index);
   edits.set(index,{...current,cardObjects:(current.cardObjects||[]).filter(id=>id!==tableId),sourceArtifactRanges:(current.sourceArtifactRanges||[]).filter(range=>range.sourceUnitId!==tableId),
    keyPoints:[...(current.keyPoints||[]),...notes.slice(0,3)],notePoints:notes.slice(3),sourceUnitIds:[...new Set([...(current.sourceUnitIds||[]),tableId])]});
  }
  if(!how.keepFirst&&how.pointer)pointers.push({card:how.card||pages,letter});
  // Every appendix page is its own card, so part numbering keeps its counter.
  const parts=pages.map(index=>tableRange(slides[index],tableId)),ranges=parts.some(range=>range.length)?parts.filter(range=>range.length):[[]],heading=shortHeading(base,zh);
  ranges.forEach((range,k)=>{const title=`${zh?appendixWord:'Appendix'} ${letter} · ${heading}${ranges.length>1?` · ${k+1}/${ranges.length}`:''}`;
   appendix.push({id:newId({tableId,k,range}),logicalCardId:`appendix:${tableId}:${k}`,title,focus:title,section:zh?appendixWord:'Appendix',region:'appendix',role:'mechanism',
    visualIntent:first.visualIntent,cardObjects:[tableId],sourceArtifactRanges:range,sourceUnitIds:[tableId],keyPoints:[]});});
  moved.push({tableId,letter,reason:how.reason,bodyPages:how.keepFirst?1:0,appendixPages:ranges.length});
 }
 // A card that lost a table points to it from its first remaining page.
 for(const {card,letter} of pointers){const at=card.find(index=>!drop.has(index));if(at===undefined)continue;
  edits.set(at,withPointer(page(at),letter));}
 // Pages of a card left with points only (their tables moved) merge while the
 // card stays at six points a page: docx kept five pages of one card holding
 // 5, 1, 1 and 2 points.
 const kept=slides.map((slide,index)=>edits.get(index)||slide).filter((_,index)=>!drop.has(index));
 const pointsOnly=slide=>!slide.cardFrame&&slide.region!=='appendix'&&!(slide.cardObjects||[]).length&&!(slide.sourceArtifactRanges||[]).length&&!(slide.sourceImageIds||[]).length&&!slide.figurePage;
 const body=[];
 // Below the full length a points-only page left after its card's table page
 // gives its points back to that page; the capacity pass then keeps those that
 // fit beside the table and moves the rest to the page's notes (user, 2026-10-31).
 const tablePage=slide=>(slide.cardObjects||[]).some(isTable);
 // A page takes the other page's points; one pointer line, last, names both pages' appendices.
 const union=(a,b,key)=>[...new Set([...(a[key]||[]),...(b[key]||[])])];
 const own=slide=>(slide.keyPoints||[]).filter(point=>!point.navigation);
 const absorb=(into,from,first=into)=>{const second=first===into?from:into,letters=[first.tableAppendix,second.tableAppendix].filter(Boolean).join(',').split(',').filter(Boolean);
  const base={...into,keyPoints:[...own(first),...own(second)],tableAppendix:undefined,sourceUnitIds:union(into,from,'sourceUnitIds'),refs:union(into,from,'refs'),chunkRefs:union(into,from,'chunkRefs')};
  return letters.reduce(withPointer,base);};
 for(const slide of kept){const last=body.at(-1);
  const sameCard=continues(last,slide);
  // A page left with only appendix pointers joins the page before it, of any
  // card (CodePilot PDF: "业务接口按处理器执行 · 2/2" held only "完整表格见附录 P、Q、R").
  if(belowFull(project)&&last&&!last.cardFrame&&last.region!=='appendix'&&pointsOnly(slide)&&(slide.keyPoints||[]).length&&slide.keyPoints.every(point=>point.navigation)){body[body.length-1]=absorb(last,slide);continue;}
  if(belowFull(project)&&sameCard&&tablePage(last)&&pointsOnly(slide)){body[body.length-1]=absorb(last,slide);continue;}
  // ...and one just before it, its points first (docx: "· 1/2" held one point and the pointers).
  if(belowFull(project)&&sameCard&&pointsOnly(last)&&tablePage(slide)){body[body.length-1]=absorb(slide,last,last);continue;}
  if(sameCard&&pointsOnly(last)&&pointsOnly(slide)&&(last.keyPoints||[]).length+(slide.keyPoints||[]).length<=6)
   body[body.length-1]=absorb(last,slide);
  else body.push(slide);}
 const at=closing>=0?body.findIndex(slide=>slide.id===slides[closing].id):body.length;
 return {raw:{...raw,slides:[...body.slice(0,at),...appendix,...body.slice(at)],...(omitted.length?{optionalTables:[...new Set([...(raw.optionalTables||[]),...omitted])]}:{})},moved};
}
