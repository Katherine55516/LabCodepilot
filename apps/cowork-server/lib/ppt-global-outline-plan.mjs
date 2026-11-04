import {explanationObligations} from './ppt-explanation-obligations.mjs';
/** Whole-deck topic ledger shared by every bounded source batch. This is
 * planning context, not generated claims or a replacement for source gates. */
import {sectionPageGroups,overviewMainIdeaUnitIds} from './ppt-outline-concision.mjs';
import {semanticGroups} from './ppt-semantic-groups.mjs';
const GLOBAL_RULES=['Presentation section labels describe the approved deck narrative; never inherit a moved source unit’s original chapter number as presentation navigation. Keep original section references explicitly identified as source references. For source prose mechanisms, consider a summaryGraph projection with 2–12 extractive nodes (label/body with exact original UTF-16 evidence) and separately source-quoted edges. Use overlap only for two source-supported windows and one shared-information explanation (first two nodes → third); positions are schematic, not measured durations. A cycle must explicitly quote the return/repeat condition and include every directed cycle edge; do not turn paragraph adjacency into a loop. Keep parallel supports edgeless; do not infer a temporal or causal edge from paragraph order. Preserve selected conditions and use the normal independent summary/claim audit. A diagram description should become a sourced mechanism, not visible instructions for drawing. Never fabricate numerical paths or chart data.','Merge only for one specific reader task or clearly separated supports of an explicit parent question, never merely because sections are short. Distinguish composition, chronology and parallel alternatives. Preserve applicability with each relationship. Arrange neighbouring pages to add a mechanism, evidence, boundary or decision; short titles may be direct subjects rather than forced slogans. Under an expanded user budget deepen sourced explanations instead of spreading the same text thinly.','Freeze all physical roles and page tasks under the confirmed total before any independent page writer. Reading groups are not local page budgets.', 'Give each page a substantive reader task and a distinct source-supported answer; do not duplicate focus as a question. Record why merged supports answer one task or why a continuation adds new evidence. Late production, evaluation and tail-table obligations must remain deliberate selections, not leftover quota.','Assign every major topic a reader question and a distinct core message before writing pages.',
 'Combine nearby short material answering one reader question; do not give every source paragraph its own page.',
 'Plan a page as subject + supported message + relation + evidence/conditions. Keep a formula with its definition and applicable constraint when they fit; a formula alone does not earn a page.',
 'Comparison tables retain their candidate set and common dimensions. A one-row example cannot replace a multi-model comparison. Prefer matching input geometry, model and applicable condition on one comparison page.',
 'Route late technical elaborations to the body topic they explain even when the original pasted heading is stale. Reserve the final page for actual closing decisions/conclusions; do not append a new model formula after the decision table.',
 'Visible text states the actual source-supported subject directly. Never write a promise to explain, a description of what the source establishes, or a claim that source coverage was already handled elsewhere.',
 'Source diagrams preserve branch/parallel/sequence relationships. Field-value schemas and text flowcharts are structured content, not expendable program examples.',
 'For editorial overviews, prefer concise audited semantic summaries of prose to copying every sentence. Preserve every required definition, condition, number and risk; originals stay in project source storage. Never substitute automatic notes for visible necessary content.',
 'Every major source topic retains a substantive main-deck explanation. A title, table or archive note alone cannot carry its mechanism. Keep inferred/unknown boundaries and slower/fast-path conditions visible. Group connected topics on existing pages rather than dropping all prose for one topic into notes.',
 'Give each major section proportionate main-deck space; detailed early sections must not crowd later architectures, training discipline and closing decisions out.',
 'An estimate is provisional. Exact user page counts remain authoritative; source coverage, semantic entailment and actual native capacity decide acceptance.',
 'Plan the explanation chain before selecting layouts: reader question, one supported answer, then distinct definition/mechanism/example/condition units. Do not treat source paragraph boundaries or template slots as reader topics.',
 'Keep a same-chunk definition, short schema example and causal explanation together when capacity permits. If the complete example needs continuation, label the actual field groups; a page containing only an abstract definition and a promise to explain later is underdeveloped.',
 'Organize causal comparisons as observed cost, mechanism, explanatory model and applicable condition. Preserve source uncertainty. Source order and inherited numbered headings may be stale; do not jump backward merely to follow a batch boundary.',
 'Choose content shape by relation, not a fixed card count: parallel alternatives share comparison dimensions, sequences retain order, architecture layers retain branching, and an overview may group workflows by reader task while full original rows remain in project source storage under the active archival policy.',
 'A physical continuation owns new complete units or disjoint row ranges and states its incremental message.'];
export function globalOutlinePlan(project) {
 const items=project.originalSourceInventory?.items||project.source?.semantic?.inventory?.items||[];
 const groups=new Map();
 for(const item of items){
  const headings=item.sectionPath||[],section=headings[1]||headings[0]||'Source';
  if(!groups.has(section))groups.set(section,{section,sourceUnitIds:[],types:{},characters:0});
  const group=groups.get(section);group.sourceUnitIds.push(item.id);group.types[item.type]=(group.types[item.type]||0)+1;group.characters+=String(item.text||'').length;
 }
 const sections=[...groups.values()];
 // Roles consume pages only when actually planned. An unplanned cover/thanks
 // must not steal two pages from a user-confirmed budget.
 const frames=(project.outline||[]).filter(s=>['cover','navigation','section','closing'].includes(s.role)&&!(s.sourceUnitIds||[]).length);
 const budget=Math.max(0,(project.pages||12)-frames.length);
 const bundles=new Map();
 for(const item of items)for(const chunk of item.chunkRefs||[]){
  if(!bundles.has(chunk))bundles.set(chunk,{chunkRef:chunk,sourceUnitIds:[],types:[]});
  const bundle=bundles.get(chunk);bundle.sourceUnitIds.push(item.id);if(!bundle.types.includes(item.type))bundle.types.push(item.type);
 }
 const semanticBundles=[...bundles.values()].filter(b=>b.sourceUnitIds.length>1&&b.types.length>1).map(b=>({...b,basis:'actual same-chunk source companions; planning hint, not a semantic equivalence or permission to omit'}));
 // Overview decks share pages between adjacent sections (outline concision,
 // item 6); no section is entitled to a page of its own.
 const narrative=semanticGroups(project);
 if(narrative)return {version:2,totalPageEstimate:project.pages,bodyPageEstimate:budget,mainIdeaSourceUnitIds:overviewMainIdeaUnitIds(project),narrativeGroups:narrative,sections,semanticBundles,explanationObligations:explanationObligations(project),rules:GLOBAL_RULES,basis:'Validated actual whole-deck semantic grouping before outline batches; planning, not factual evidence'};
 if(project.generationPolicy?.version===2&&project.inputUnderstanding?.groups?.length)return {version:2,totalPageEstimate:project.pages,bodyPageEstimate:budget,mainIdeaSourceUnitIds:overviewMainIdeaUnitIds(project),narrativeGroups:project.inputUnderstanding.groups.map(g=>({...g,readerQuestion:g.question})),sections,semanticBundles,explanationObligations:explanationObligations(project),rules:GLOBAL_RULES,basis:'Validated complete-input reader groups; allocate the confirmed budget by explanation, never source character weights'};
 const pageGroups=sectionPageGroups(project);
 if(pageGroups){
  const share=new Map(pageGroups.flatMap(group=>group.sections.map(section=>[section,{group:group.index+1,pages:Math.round(group.pages/group.sections.length*100)/100}])));
  return {version:1,totalPageEstimate:project.pages,bodyPageEstimate:budget,pageGroups:pageGroups.map(({index,sections,pages})=>({group:index+1,sections,pages})),
   sections:sections.map(section=>({...section,provisionalPages:share.get(section.section)?.pages??0,pageGroup:share.get(section.section)?.group??null})),semanticBundles,explanationObligations:explanationObligations(project),rules:GLOBAL_RULES};
 }
 const weights=sections.map(s=>Math.log2(2+Math.max(1,s.characters))),total=weights.reduce((a,b)=>a+b,0);
 const minimum=sections.length<=budget?1:0,remainder=Math.max(0,budget-minimum*sections.length);
 const exact=weights.map(w=>remainder*w/Math.max(1,total)),allocated=exact.map(n=>minimum+Math.floor(n));
 const order=exact.map((n,index)=>({index,fraction:n-Math.floor(n)})).sort((a,b)=>b.fraction-a.fraction);
 for(let n=budget-allocated.reduce((a,b)=>a+b,0),i=0;n>0&&order.length;n--,i++)allocated[order[i%order.length].index]++;
 return {version:1,totalPageEstimate:project.pages,bodyPageEstimate:budget,mainIdeaSourceUnitIds:overviewMainIdeaUnitIds(project),sections:sections.map((section,index)=>({...section,
  provisionalPages:allocated[index],
 })),semanticBundles,explanationObligations:explanationObligations(project),rules:GLOBAL_RULES};
}
