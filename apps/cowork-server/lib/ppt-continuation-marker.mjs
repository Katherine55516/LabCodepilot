/** Continuation markers that would cut a title (Fable 2026-10-26, live
 * pdf-gph7 p6): the page keeps its whole title and its section label, else its
 * speaker notes, say it continues. A leaf module: the label binder and the
 * export manifest use it without importing the card page binder. */
import {cardsFlow} from './ppt-flow.mjs';
/** A split card's pages are numbered "<base> · k/n", part 1 included (Fable
 * 2026-10-27; it replaces the "(cont.)"/"（续）" title marker on option D, and
 * no "continued" eyebrow is added). The old marker is still read: the title
 * passes set it, and the numbering pass turns a run of them into counters. */
export const PART_COUNTER=/\s+·\s+(\d+)\s*\/\s*(\d+)\s*$/u;
const LEGACY=/(?:\s*\(cont\.\)|（续）)\s*$/u;
const halvesOf=title=>String(title||'').split(/\s+\|\s+/u);
/** A later part: the old marker, or a counter past 1. */
export const isContinued=title=>halvesOf(title).some(half=>LEGACY.test(half)||Number(half.match(PART_COUNTER)?.[1])>1);
/** The title without its marker or counter. */
export const unmarked=title=>halvesOf(title).map(half=>half.replace(LEGACY,'').replace(PART_COUNTER,'').trim()).join(' | ');
/** Each language half numbered "k/n". */
export const numberedTitle=(base,k,n)=>halvesOf(unmarked(base)).map(half=>`${half} · ${k}/${n}`).join(' | ');
/** The outline with each page's card id, taken by page id from the plan's
 * raw slides when the page has none (the live outline drops it; 3222
 * mood-board p9-11: a counter across a figure page was never verified). */
export function withCardIds(project,outline=project?.outline||[]){
 const ids=new Map((project?.planningContract?.cardOutline?.raw?.slides||[]).map(slide=>[slide.id,slide.logicalCardId]));
 // A figure page split off during generation is in no plan: it takes the card of the page it came from (3222 deal-review p7).
 const card=page=>page?.logicalCardId||ids.get(page?.id)||(page?.restoredFrom?ids.get(page.restoredFrom)||outline.find(other=>other?.id===page.restoredFrom)?.logicalCardId:undefined);
 return outline.map(page=>page&&!page.logicalCardId&&card(page)?{...page,logicalCardId:card(page)}:page);
}
/** The numbered runs of an outline, verified: consecutive card pages (no
 * divider; figure pages of the same card between them are skipped) whose
 * titles share one base and count 1..n; pages lists their indexes. */
export function cardPartRuns(outline=[]){
 const runs=[];
 for(let i=1;i<outline.length;i++){
  const page=outline[i],match=String(page?.title||'').split(/\s+\|\s+/u)[0].match(PART_COUNTER);
  if(!match||page.figurePage||page.cardFrame==='divider'||Number(match[1])!==1)continue;
  const n=Number(match[2]),base=unmarked(page.title),pages=[i];if(n<2)continue;
  for(let k=i+1;k<outline.length&&pages.length<n;k++){const part=outline[k];
   if(part?.figurePage&&part.logicalCardId&&part.logicalCardId===page.logicalCardId)continue;
   if(!part||part.figurePage||part.cardFrame==='divider'||String(part.title)!==numberedTitle(base,pages.length+1,n))break;pages.push(k);}
  if(pages.length===n)runs.push({start:i,end:pages.at(-1),n,base,pages});
 }
 return runs;
}
/** A card page continuing the previous page's card without a title marker
 * (the marker would cut its title): its label, else its notes, say so. */
export function unmarkedContinuation(project,index){
 const page=project.outline?.[index],previous=project.outline?.[index-1];
 // A row page carries its own counter ("(2/5)").
 if(!cardsFlow(project)||index<2||!page||page.cardFrame==='divider'||isContinued(page.title)||/\(\s*\d+\s*\/\s*\d+\s*\)\s*$/u.test(String(page.title||'')))return false;
 const stem=title=>unmarked(String(title||'')).replace(/\s*\(\s*\d+\s*\/\s*\d+\s*\)\s*$/u,'').normalize('NFKC').replace(/\s+/gu,' ').trim().toLocaleLowerCase();
 return Boolean(stem(page.title))&&stem(page.title)===stem(previous?.title);
}
/** Speaker notes of unmarked continuations without a label (export manifest). */
export function continuationNotes(project){
 const zh=String(project.inputUnderstanding?.primaryLanguage||'en').startsWith('zh');
 return (project.deck?.slides||[]).flatMap((slide,index)=>unmarkedContinuation(project,index)&&!String(slide.section||'').trim()?[{index,sourceUnitIds:[],text:zh?'续上页。':'Continued from the previous page.'}]:[]);
}
