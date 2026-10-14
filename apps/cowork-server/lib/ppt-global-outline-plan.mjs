/** Whole-deck topic ledger shared by every bounded source batch. This is
 * planning context, not generated claims or a replacement for source gates. */
import {sectionPageGroups} from './ppt-outline-concision.mjs';
const GLOBAL_RULES=['Assign every major topic a reader question and a distinct core message before writing pages.',
 'Combine nearby short material answering one reader question; do not give every source paragraph its own page.',
 'Plan a page as subject + supported message + relation + evidence/conditions. Keep a formula with its definition and applicable constraint when they fit; a formula alone does not earn a page.',
 'Comparison tables retain their candidate set and common dimensions. A one-row example cannot replace a multi-model comparison. Prefer matching input geometry, model and applicable condition on one comparison page.',
 'Route late technical elaborations to the body topic they explain even when the original pasted heading is stale. Reserve the final page for actual closing decisions/conclusions; do not append a new model formula after the decision table.',
 'Visible text states the actual source-supported subject directly. Never write a promise to explain, a description of what the source establishes, or a claim that source coverage was already handled elsewhere.',
 'Source diagrams preserve branch/parallel/sequence relationships. Field-value schemas and text flowcharts are structured content, not expendable program examples.',
 'For overview/notes, prefer concise audited semantic summaries of prose to retaining all original sentences on slides. Preserve every required definition, condition, number and risk; full original stays in notes.',
 'Give each major section proportionate main-deck space; detailed early sections must not crowd later architectures, training discipline and closing decisions out.',
 'An estimate is provisional. Exact user page counts remain authoritative; source coverage, semantic entailment and actual native capacity decide acceptance.',
 'A physical continuation owns new complete units or disjoint row ranges and states its incremental message.'];
export function globalOutlinePlan(project) {
 const items=project.originalSourceInventory?.items||project.source?.semantic?.inventory?.items||[];
 const groups=new Map();
 for(const item of items){
  const headings=item.sectionPath||[],section=headings[1]||headings[0]||'Source';
  if(!groups.has(section))groups.set(section,{section,sourceUnitIds:[],types:{},characters:0});
  const group=groups.get(section);group.sourceUnitIds.push(item.id);group.types[item.type]=(group.types[item.type]||0)+1;group.characters+=String(item.text||'').length;
 }
 const sections=[...groups.values()],budget=Math.max(1,(project.pages||12)-2);
 // Overview decks share pages between adjacent sections (outline concision,
 // item 6); no section is entitled to a page of its own.
 const pageGroups=sectionPageGroups(project);
 if(pageGroups){
  const share=new Map(pageGroups.flatMap(group=>group.sections.map(section=>[section,{group:group.index+1,pages:Math.round(group.pages/group.sections.length*100)/100}])));
  return {version:1,totalPageEstimate:project.pages,bodyPageEstimate:budget,pageGroups:pageGroups.map(({index,sections,pages})=>({group:index+1,sections,pages})),
   sections:sections.map(section=>({...section,provisionalPages:share.get(section.section)?.pages??0,pageGroup:share.get(section.section)?.group??null})),rules:GLOBAL_RULES};
 }
 const weights=sections.map(s=>Math.log2(2+Math.max(1,s.characters))),total=weights.reduce((a,b)=>a+b,0);
 const minimum=sections.length<=budget?1:0,remainder=Math.max(0,budget-minimum*sections.length);
 const exact=weights.map(w=>remainder*w/Math.max(1,total)),allocated=exact.map(n=>minimum+Math.floor(n));
 const order=exact.map((n,index)=>({index,fraction:n-Math.floor(n)})).sort((a,b)=>b.fraction-a.fraction);
 for(let n=budget-allocated.reduce((a,b)=>a+b,0),i=0;n>0&&order.length;n--,i++)allocated[order[i%order.length].index]++;
 return {version:1,totalPageEstimate:project.pages,bodyPageEstimate:budget,sections:sections.map((section,index)=>({...section,
  provisionalPages:allocated[index],
 })),rules:GLOBAL_RULES};
}
