import {visibleNodes,nodeContentText} from './ppt-visible-content.mjs';
/** One role projection for old and new card decks. Empty citations alone do
 * not make a page structural: an explicit frame/role is required. */
export function effectivePageRole(project,slide,index=0){
 const outline=project.outline?.find(page=>page.id===slide?.id)||slide||{},plan=project.planning?.slidePlan?.find(page=>page.slideId===slide?.id)||{};
 const frame=outline.cardFrame||slide?.cardFrame||slide?.cardPage?.shape;
 if(frame==='divider')return 'section';
 if(frame==='takeaway')return 'closing';
 if(outline.figurePage)return 'figure';
 const role=outline.role||plan.role||slide?.role;
 if(['cover','section','closing','conclusion'].includes(role))return role==='conclusion'?'closing':role;
 return index===0?'cover':'content';
}
export const isContentPage=(project,slide,index)=>!['cover','section','closing'].includes(effectivePageRole(project,slide,index));
export function visibleSemanticUnits(slide){
 const nodes=visibleNodes(slide).filter(node=>node.sourceArtifact||node.semanticRole==='source-explanation'||node.nativeRef&&node.templateSlot?.role==='content'&&!['footnote','group-heading'].includes(node.templateSlot.purpose));
 if(!slide.nodes?.length)return (slide.copy?.blocks||slide.bullets||[]).length;
 let equations=false;const units=new Set();
 for(const node of nodes){
  const c=node.content||{},source=node.sourceArtifact;if(['source-navigation','source-reading-navigation'].includes(c.derivedFrom))continue;
  if(c.mathMl||source?.type==='EquationBlock'){equations=true;continue;}
  if(c.rows){for(let row=1;row<c.rows.length;row++)units.add(`${source?.sourceUnitId||node.id}:row:${(source?.rowStart||1)+row-1}`);continue;}
  if(c.items){c.items.forEach((item,k)=>units.add(item.languagePairId||`${node.id}:item:${k}`));continue;}
  if(nodeContentText(node).trim())units.add(c.languagePairId||node.templateSlot?.groupId||node.id);
 }
 return units.size+Number(equations);
}
export function claimFragmentKey(slide,claimId){
 const ranges=visibleNodes(slide).filter(n=>n.sourceArtifact?.sourceUnitId===claimId).map(n=>n.sourceArtifact);
 return ranges.length?JSON.stringify(ranges.map(r=>[r.sourceUnitId,r.rowStart??null,r.rowEnd??null,r.lineStart??null,r.lineEnd??null,r.columnStart??null,r.columnEnd??null])):null;
}
export function semanticTokens(value){
 const text=String(value||'').toLocaleLowerCase(),latin=text.match(/[a-z][a-z0-9_-]{2,}|\d+(?:\.\d+)?/gu)||[];
 const han=(text.match(/\p{Script=Han}+/gu)||[]).flatMap(word=>word.length===1?[word]:Array.from({length:word.length-1},(_,i)=>word.slice(i,i+2)));
 return [...new Set([...latin,...han])];
}
