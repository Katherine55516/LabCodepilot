/** Card blocks sized to the template's components (the hand deck, Fable
 * 2026-11-02 G4: the writer writes as many "short heading + one sentence"
 * blocks as a template content page has components; build.py chose the page
 * first and wrote 2, 3 or 4 blocks to fit it). A leaf module: the card
 * writer and the card splitter use it. */

const COMPONENT_MIN=2,COMPONENT_MAX=6;
/** A content page's components: its heading + description pairs (each a group
 * holding text), else its list or description slots. A sub-title slot
 * ("body" under the title), pictures and decoration never count. */
export function pageComponents(page){
 const roles=(page?.textSlots||[]).map(slot=>slot.role);
 return roles.filter(role=>role==='point-heading').length||roles.filter(role=>role==='point-description'||role==='list').length;
}
/** S: the distinct component counts (2..6) of the uploaded template's content
 * pages, ascending; [] for a built-in theme or a template without any, which
 * keeps the point mode. */
export function componentCounts(project,{offer:useOffer=true}={}){
 if(project?.templateFidelity?.mode!=='preserve')return [];
 // With the template's fill profiles, the counts its fillable cards and step
 // pages hold, so cards are written and cut to pages that exist (3197
 // b894778a, Capabilities: 4-block cards for pages of 3 and 2, none filled).
 const offer=useOffer?(project.planningContract?.fillOffer||[]).filter(entry=>['cards','steps'].includes(entry.kind)):[];
 if(offer.length)return [...new Set(offer.flatMap(entry=>[entry.blocks,...(entry.orFewer?[entry.blocks-entry.orFewer]:[])]).filter(n=>n>=COMPONENT_MIN&&n<=COMPONENT_MAX))].sort((a,b)=>a-b);
 const pages=project.templateFidelity.componentProfile?.pages||[];
 return [...new Set(pages.filter(page=>page?.pageRole?.role==='content').map(pageComponents).filter(n=>n>=COMPONENT_MIN&&n<=COMPONENT_MAX))].sort((a,b)=>a-b);
}
/** How a card of n parallel parts is cut into cards: as few as max(S)
 * allows, sized evenly, larger parts first (7 parts, S={2,3,4}: 4+3; 5: 3+2,
 * never 4+1). n within max(S) stays one card; a part whose size is not in S
 * takes the smallest larger frame (the scheduler removes the extra groups). */
export function componentParts(n,counts){
 const max=Math.max(0,...counts);if(!max||n<=max)return [n];
 const m=Math.ceil(n/max),base=Math.floor(n/m),extra=n%m;
 return Array.from({length:m},(_,k)=>base+(k<extra?1:0));
}
/** The writer's rule for blocks on an uploaded template. */
export function componentRule(counts,{han=false,most=8,cutAbove=Math.max(...counts)}={}){
 if(!counts.length)return '';
 return `This deck uses an uploaded template whose content layouts hold ${counts.join(', ')} parallel components. Write each card that is not a numbered list or a single statement as k blocks, k one of ${counts.join(', ')} (choose the k its content truly has). Write exactly the number of cards asked, never more: one card may carry up to ${most} blocks, and code cuts a card of more than ${cutAbove} into pages and moves blocks past ${most} to the speaker notes: each block is one point whose label is a short heading (at most ${han?'10 Chinese characters':'5 English words'}) and whose text is ONE sentence (at most ${han?'40 Chinese characters':'20 English words'}). Give each card a "lead": one sentence under the title that sets its context (the measure, the condition or the scope; at most ${han?'40 Chinese characters':'20 English words'}, no formula, no number without its unit), or an empty string when the title says it all. `;
}
/** The writer's rule for the template's own pages (fill-template-first, the
 * user 2026-11-03): each page shape it can fill, with its limits. A card the
 * content makes one of these shapes is written to it exactly; any other card
 * is written as usual and takes another page. */
// A lead filling under a third of its band leaves the band near empty (Fable Q6 b,
// 2026-11-03: Capabilities p2 one short line in a wide band): a third to all of it, or none.
export function fillOfferRule(offer,{han=false}={}){
 if(!offer?.length)return '';
 const unit=han?'Chinese characters':'characters';
 const name=entry=>entry.kind==='steps'?`${entry.blocks}${entry.orFewer?` (or ${entry.blocks-entry.orFewer})`:''} numbered steps`:entry.kind==='compare'?'two named sides compared side by side (visualIntent "comparison", 2 blocks; only when the source compares two named things, as a two-sided table does, never for aspects such as upsides and limits)':entry.kind==='title-body'?'one statement (1 block)':entry.kind==='text-figure'?'one statement beside a figure (1 block, a figure its units name)':`${entry.blocks}${entry.orFewer?` (or ${entry.blocks-entry.orFewer})`:''} parallel blocks`;
 const pages=offer.map(entry=>`${name(entry)}: ${entry.headingChars?`heading ≤ ${entry.headingChars} ${unit}`:'no heading (the label empty)'}, sentence ${Math.ceil(entry.bodyChars/2)}–${entry.bodyChars} ${unit} (a page is filled only when each sentence reaches half its box)${entry.leadChars?`, lead ${Math.ceil(entry.leadChars/3)}–${entry.leadChars} ${unit}${entry.leadColumns>1?` per column (${entry.leadColumns} short sentences, one per column)`:' (one or two sentences)'} or empty`:', no lead'}${entry.figures?`, up to ${entry.figures} figure(s)`:''}`).join('; ');
 return `The template's own pages are filled first. Its pages hold: ${pages}. When a card's content truly has one of these shapes, write it to that shape exactly: that many blocks, each heading (the point's label) and one-sentence text within its limits, the lead within its limit or empty. Never pad, merge or split an idea to reach a shape; a card that has none of these shapes is written as usual and takes another page. `;
}
/** Whether the template's step pages give each step a heading: then a
 * numbered step carries a short name as its label (Mood t4: four tall step
 * boxes showed one short line each). */
export const stepHeadings=offer=>(offer||[]).some(entry=>entry.kind==='steps'&&entry.headingChars>0);
/** A point that is only a heading: a short phrase with no sentence (3197
 * 1d8eb0d2 p15: "梦境训练的优势" and "独立VAE的局限" for a 3,000-character
 * unit). At most 12 Chinese characters or 5 words, no clause punctuation. */
export function bareHeading(text){
 const value=String(text||'').trim();if(!value)return true;
 if(/[，。；：！？,;:.!?]/u.test(value.replace(/\d[.,]\d/gu,'')))return false;
 const han=(value.match(/\p{Script=Han}/gu)||[]).length;
 return han>value.length/3?[...value].length<=12:value.split(/\s+/u).length<=5;
}
/** Whether a card says too little of the sources it cites to stand for them
 * (Fable 2026-11-03, the cited-unit guard; 3197 1d8eb0d2 p15: 14 characters
 * for a 3,125-character unit): written text under 4% of cited sources of
 * 800+ characters, a Chinese character counted as three Latin ones. */
export function thinForSources(project,points){
 const units=new Map((project?.source?.semantic?.inventory?.items||[]).map(item=>[item.id,item]));
 const ids=[...new Set((points||[]).flatMap(point=>Array.isArray(point?.sourceUnitIds)?point.sourceUnitIds:[]))];
 const cited=ids.reduce((sum,id)=>sum+String(units.get(id)?.text||'').length,0);
 const weight=text=>{const value=String(text||''),han=(value.match(/\p{Script=Han}/gu)||[]).length;return han*3+value.length-han;};
 const written=(points||[]).reduce((sum,point)=>sum+weight(point?.text)+weight(point?.label),0);
 return cited>=800&&written<cited*.04;
}
/** The counts a card is cut and merged by: the template's own layouts and its
 * fillable pages together. A card is never cut below the template's largest
 * layout only because the fillable pages are smaller (3197 0b5a7f1b,
 * Capabilities: fill pages of 2 and 3 cut four short points into 2 + 2, and
 * both halves fell back as sparse theme pages). */
export function splitCounts(project){
 return [...new Set([...componentCounts(project,{offer:false}),...componentCounts(project)])].sort((a,b)=>a-b);
}
