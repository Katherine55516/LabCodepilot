import {syncPageNumbers} from '../ppt-page-numbers.mjs';
/** Deterministic card merges. Preserve the chosen template frames and every
 * reviewed point/image; no writing model, title invention or font reduction. */
import {outlineConfirmationHash} from '../ppt-outline-confirmation.mjs';
import {editError,isCodeCardPage,CARD_STRUCTURE_STATE} from './edit-context.mjs';
import {bindThemeCardPage,fitThemePage} from '../ppt-card-pages.mjs';
import {bindSourceMedia} from '../ppt-source-artifacts.mjs';
import {refreshPlanning} from '../ppt-planning.mjs';
import {nodeContentText} from '../ppt-visible-content.mjs';
import {ensureDeckV3} from './ir.mjs';
const unique=list=>[...new Set(list.filter(Boolean))];
export {CARD_STRUCTURE_STATE} from './edit-context.mjs';
export function explicitStructureTargets(project,instruction){
 const pages=[...String(instruction).matchAll(/(?:页面|第)\s*(\d+)\s*页?/gu)].map(match=>Number(match[1])-1);
 if(pages.length!==2)return null;
 if(pages.some(index=>index<0||index>=project.deck.slides.length))throw editError('selected structure page is outside the deck',422);
 return {slideId:project.deck.slides[pages[0]].id,mergeSlideId:project.deck.slides[pages[1]].id};
}
export function cardStructureCommands(project,data){
 const index=project.deck.slides.findIndex(slide=>slide.id===data.slideId),other=data.mergeSlideId?project.deck.slides.findIndex(slide=>slide.id===data.mergeSlideId):index+1;
 const action=data.action||(/合并|merge/iu.test(data.instruction)?'merge':/删除|delete/iu.test(data.instruction)?'delete':'');
 if(!['merge','delete'].includes(action))throw editError('card structure currently supports merging adjacent cards or removing a chapter divider',409);
 if(project.deck.slides.length<=3||index<=0||index>=project.deck.slides.length-1||action==='merge'&&(other!==index+1||other>=project.deck.slides.length-1))throw editError('select adjacent content pages; keep the opening and closing pages',409);
 const ids=action==='merge'?[data.slideId,project.deck.slides[other].id]:[data.slideId];
 for(const id of ids){const slide=project.deck.slides.find(s=>s.id===id);
  if(!isCodeCardPage(project,id))throw editError('ppt_structure_native_bound '+JSON.stringify(ids.map(id=>{const k=project.outline.findIndex(page=>page.id===id),page=project.outline[k];return {page:k+1,title:page.title,kind:page.figurePage?'figure':page.cardFrame==='divider'?'divider':isCodeCardPage(project,id)?'card':'native'};})),409);
  if(slide.locked||project.runtime?.slides?.[id]?.accepted||slide.nodes.some(n=>!n.nativeRef&&(n.manualOverlay||n.userGeometry||n.userStyle||n.locked&&n.semanticRole!=='page-number'||!n.sourceArtifact&&!['card-page','page-number','title-hierarchy','source-navigation'].includes(n.content?.derivedFrom))))throw editError('unlock protected or manually formatted card objects before restructuring',409);
 }
 // A completed card may have been edited since its outline. Refuse a stale
 // reconstruction rather than overwrite those edits with the outline's copy.
 if(action==='merge'&&project.outline[index]?.cardFrame!=='divider')for(const id of ids){
  const at=project.outline.findIndex(p=>p.id===id),page=project.outline[at],live=project.deck.slides[at],baseline=structuredClone(live);
  if(page.figurePage)bindSourceMedia(project,baseline,page.sourceImageIds||[],at);else bindThemeCardPage(project,baseline,at,page);
  const key=slide=>(slide.nodes||[]).filter(n=>n.sourceArtifact||n.content?.derivedFrom==='card-page').map(n=>[n.type,nodeContentText(n),n.type==='image'?n.content.dataUrl:null]);
  if(JSON.stringify(key(live))!==JSON.stringify(key(baseline)))throw editError('the card has edits newer than its outline; keep both pages to preserve those edits',409);
 }
 const next=structuredClone(project),page=next.outline[index],following=next.outline[other];
 let target=index,removed=other,operation='merge-cards';
 if(page.cardFrame==='divider'){
  if(action==='delete'&&next.outline[index+1]?.cardFrame==='divider')throw editError('select a divider followed by a content card',409);
  target=index+1;removed=index;operation='remove-divider';
  next.outline[target]={...next.outline[target],section:page.title||page.section||next.outline[target].section};
 }else if(action==='delete')throw editError('only chapter dividers can be removed without discarding reviewed card content',409);
 else if(page.figurePage&&following.figurePage){
  next.outline[index]={...page,sourceImageIds:unique([...(page.sourceImageIds||[]),...(following.sourceImageIds||[])])};operation='merge-figures';
 }else if(!page.figurePage&&!following.figurePage&&!page.cardFrame&&!following.cardFrame&&!page.cardObjects?.length&&!following.cardObjects?.length){
  next.outline[index]={...page,keyPoints:[...(page.keyPoints||[]),...(following.keyPoints||[])],sourceUnitIds:unique([...(page.sourceUnitIds||[]),...(following.sourceUnitIds||[])]),refs:unique([...(page.refs||[]),...(following.refs||[])]),sourceImageIds:unique([...(page.sourceImageIds||[]),...(following.sourceImageIds||[])]),...((page.sourceImageIds?.length||following.sourceImageIds?.length)?{cardFigureLayout:true}:{})};
 }else throw editError('merge two content cards or two figure pages; a chapter divider can be removed before its next card',409);
 const targetId=next.outline[target].id,removedId=next.outline[removed].id;
 // Remove the corresponding frame instead of rescheduling unrelated pages.
 next.outline.splice(removed,1);next.deck.slides.splice(removed,1);
 for(const key of ['slides','slideMap'])if(Array.isArray(next.templateFidelity?.[key]))next.templateFidelity[key].splice(removed,1);
 if(Array.isArray(next.templateSlideMap))next.templateSlideMap.splice(removed,1);
 for(const [k,frame]of (next.templateFidelity?.slides||[]).entries()){frame.index=k;for(const node of frame.nodes||[])if(node.nativeRef)node.nativeRef.slideIndex=k;}
 next.pages=next.outline.length;next.pageDecision={...next.pageDecision,source:'user',finalPageCount:next.pages};
 const at=next.outline.findIndex(p=>p.id===targetId),merged=next.outline[at],slide=next.deck.slides[at];
 for(const [k,s]of next.deck.slides.entries()){
  // The preserved renderer matches native nodes against this output index.
  // sourceSlideIndex and slideMap still identify the original template asset.
  if(Number.isInteger(s.templateSlideIndex))s.templateSlideIndex=k;
  if(Number.isInteger(s.nativeSlideIndex))s.nativeSlideIndex=k;
  for(const key of ['nodes','sourceArtifactNodes','templateComponentClones'])for(const node of s[key]||[])if(node.nativeRef)node.nativeRef.slideIndex=k;
 }
 if(operation==='merge-cards'){
  const fit=fitThemePage(next,at,merged)?.fit;
  if(!fit?.capacity_ok)throw editError('merged card exceeds the measured template capacity; keep both pages',422,{measurement:fit});
  bindThemeCardPage(next,slide,at,merged);
 }else if(operation==='merge-figures'){
  // The production binder checks the full captions and readable image sizes.
  try{bindSourceMedia(next,slide,merged.sourceImageIds,at);}catch(error){throw editError('merged figure page exceeds the measured template capacity; keep both pages',422,{reason:error.message});}
 }
 slide.section=merged.section;
 if(operation==='remove-divider')for(const node of slide.nodes||[])if(node.templateSlot?.role==='section'||node.content?.derivedFrom==='source-navigation')node.content={...node.content,text:merged.section};
 slide.sourceRefs=unique([...(slide.sourceRefs||[]),...(project.deck.slides[removed]?.sourceRefs||[])]);
 next.planning=refreshPlanning(next);
 if(next.planningContract?.cardOutline)next.planningContract.cardOutline={...next.planningContract.cardOutline,raw:{...next.planningContract.cardOutline.raw,slides:structuredClone(next.outline)},summary:{...next.planningContract.cardOutline.summary,pages:next.pages}};
 if(next.confirmedOutline)next.confirmedOutline={...next.confirmedOutline,pages:next.pages,hash:outlineConfirmationHash(next)};
 if(next.planningContract)next.planningContract.actualPageIds=next.outline.map(page=>page.id);
 syncPageNumbers(next);
 next.deck=ensureDeckV3(next.deck);
 const state=Object.fromEntries(['outline','pages','pageDecision','planning',...CARD_STRUCTURE_STATE].map(key=>[key,next[key]]));
 return [{type:'deck.replace',payload:{deck:next.deck,projectState:state,cardStructure:{operation,targetId,removedId,before:project.pages,after:next.pages}}}];
}
