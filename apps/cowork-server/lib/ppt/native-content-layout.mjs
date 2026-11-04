import {explicitLayoutLocks} from '../ppt-layout-locks.mjs';
import {fitComponents,contentCanvas}from'../ppt-density-capacity.mjs';
import{visibleNodes}from'../ppt-visible-content.mjs';
import{editError,codeLaidPage,nativeCardPage}from'./edit-context.mjs';
import{bindThemeCardPage,fitThemePage,cardPageDraft}from'../ppt-card-pages.mjs';
import{nodeContentText}from'../ppt-visible-content.mjs';
import{ensureDeckV3}from'./ir.mjs';
import{refreshPlanning}from'../ppt-planning.mjs';
import{outlineConfirmationHash}from'../ppt-outline-confirmation.mjs';
import {retireUnboundContainers} from '../ppt-component-regions.mjs';
import {balanceBoundContainers} from '../ppt-container-layout.mjs';
import {wideFigureFit,figureLayoutScore} from '../ppt-figure-composition.mjs';
import {templateMediaAssemblies} from '../ppt-media-assemblies.mjs';
import {adaptationDisposition} from '../ppt-template-dispositions.mjs';
import {measureText} from './render-contract.mjs';
const overlaps=(a,b)=>Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
/** Bounded native reflow: change only source-owned frames, never branding,
 * source selection, data, locked/manual geometry, titles or physical count. */
export function nativeContentLayout(project,data){
 const index=project.deck.slides.findIndex(s=>s.id===data.slideId),slide=project.deck.slides[index];
 if(!slide||project.templateFidelity?.mode!=='preserve')throw editError('select a source-bound native page',409);
 if(data.scope==='slide')return smartPageLayout(project,index);
 const ids=data.scope==='object'?(data.nodeIds||[data.nodeId]):null;
 const nodes=slide.nodes.filter(n=>n.sourceArtifact&&(!ids||ids.includes(n.id)));
 if(!nodes.length||ids&&nodes.length!==ids.length||nodes.some(n=>n.locked||n.userGeometry||n.userStyle)||project.runtime?.slides?.[slide.id]?.accepted)throw editError('unlock source-owned content; manual/foreign/template objects cannot be reflowed',409);
 const region=contentCanvas(project,index).geometry;
 let canvas=region;
 if(ids){const left=Math.min(...nodes.map(n=>n.geometry.x)),top=Math.min(...nodes.map(n=>n.geometry.y)),right=Math.max(...nodes.map(n=>n.geometry.x+n.geometry.width)),bottom=Math.max(...nodes.map(n=>n.geometry.y+n.geometry.height));canvas={x:left,y:top,width:right-left,height:bottom-top};}
 const fit=fitComponents(nodes.map(n=>({...n,fontSizePt:n.style?.fontSizePt})),project,index,{canvas,relationalFallback:false});
 if(!fit.capacity_ok)throw editError('source-owned content cannot fit this protected region at its current readable font',422,{measurement:fit});
 const outside=visibleNodes(slide).filter(n=>!nodes.includes(n)&&n.geometry);
 if(fit.boxes.some(box=>outside.some(n=>overlaps(box,n.geometry)>12700*12700)))throw editError('native reflow would intersect another user object; adjust the authorized region',422);
 return [{type:'nodes.setGeometry',payload:{slideId:slide.id,changes:nodes.map((n,i)=>({nodeId:n.id,geometry:fit.boxes[i]}))}}];
}

/** Page proposal retains every sourced payload and the complete title band.
 * Only certified optional template assemblies may retire; explicit fixed,
 * accepted or manually positioned content rejects the whole proposal. */
function smartPageLayout(project,index){
 const original=project.deck.slides[index],slide=structuredClone(original),explicitLocks=explicitLayoutLocks(project);
 if(project.runtime?.slides?.[slide.id]?.accepted)throw editError('unlock the page before reflow',409);
 const bound=slide.nodes.filter(n=>n.templateComponentBinding?.containerNodeId&&!n.templateComponentBinding.badge);
 if(bound.length>=2){
  if(!balanceBoundContainers(project,slide,index))throw editError('protected containers or complete text cannot fit a balanced grid at the current font',422);
 }else{
  retireUnboundContainers(project,slide,index);
  const headers=slide.nodes.filter(n=>['title','template-title','eyebrow','template-section','title-translation'].includes(n.semanticRole)&&n.geometry);
  const title=headers.find(n=>['title','template-title'].includes(n.semanticRole)),height=project.templateFidelity.height,width=project.templateFidelity.width;
  const isBody=!project.outline?.[index]?.cardFrame&&index>0;
  if(isBody&&title?.geometry.y>height*.22){
   if(headers.some(n=>n.locked||n.userGeometry||n.userStyle))throw editError('the title band is manually protected; keep its position or unlock before reflow',409);
   const delta=height*.065-Math.min(...headers.map(n=>n.geometry.y));
   for(const n of headers){delete n.templateTitleFrameAdaptation;n.geometry={...n.geometry,y:Math.round(n.geometry.y+delta)};if(n.nativeRef){slide.templateAdaptations=(slide.templateAdaptations||[]).filter(a=>String(a.shapeId)!==String(n.nativeRef.shapeId));slide.templateAdaptations.push({shapeId:n.nativeRef.shapeId,action:'body_header_reanchor',geometry:{...n.geometry}});}}
  }
  const spec=project.templateFidelity.slides[index],omitted=new Set((slide.templateOmissions||[]).map(o=>String(o.shapeId)));
  for(const group of templateMediaAssemblies(spec,project.templateFidelity)){
   const live=group.members.map(base=>({base,node:slide.nodes.find(n=>String(n.nativeRef?.shapeId)===String(base.nativeRef?.shapeId)&&!omitted.has(String(base.nativeRef?.shapeId)))})).filter(p=>p.node);
   if(!live.length)continue;
   if(live.some(({node,base})=>explicitLocks.has(node.id)||node.userGeometry||node.userStyle||base.content?.mustPreserve||node.content?.mustPreserve||(project.templateFixedObjectIds||[]).includes(node.id)))throw editError('a composite media assembly is explicitly protected; keep or unlock the whole assembly',409);
   // These are old design-only illustrations, never source charts or photos.
   if(!['design_only','keep_fixed'].includes(project.templateContentMode)||live.some(({base})=>!base.content?.templateDesignOnly))throw editError('this template illustration requires an explicit design-only disposition',409);
   for(const {base,node} of live){
    const role=base.content?.mediaRole||'template_artwork';
    const basis=base.type!=='image'?'source_region_replacement':role==='old_template_content'?'design_only_template':role==='template_icon'?'source_region_card_icon_avoidance':'source_region_artwork_avoidance';
    slide.templateOmissions||=[];slide.templateOmissions.push({...adaptationDisposition(project,base,role,basis,'Unbound optional composite illustration retires as a whole so sourced text can use the reading area.'),replacementRegion:{...base.geometry},overlapRatio:1});
    slide.nodes=slide.nodes.filter(n=>n.id!==node.id);
   }
  }
  const nodes=slide.nodes.filter(n=>n.sourceArtifact||n.semanticRole==='source-explanation'&&n.content?.derivedFrom==='card-page');
  if(!nodes.length||nodes.some(n=>n.locked||n.userGeometry||n.userStyle))throw editError('unlock sourced content before smart page layout; manual positions are preserved',409);
  const components=nodes.map(n=>({...n,fontSizePt:n.style?.fontSizePt}));
  const measurementProject={...project,templateFidelity:{...project.templateFidelity,slides:project.templateFidelity.slides.map((s,k)=>k!==index?s:{...s,nodes:s.nodes.map(n=>{const header=headers.find(h=>h.nativeRef&&String(h.nativeRef.shapeId)===String(n.nativeRef?.shapeId));return header?{...n,geometry:header.geometry}:n;})})}};
  const base=contentCanvas(measurementProject,index).geometry;
  const top=Math.ceil(Math.max(base.y,...headers.map(n=>n.geometry.y+Math.max(n.geometry.height,(measureText({...n,kind:'text',bounds:n.geometry}).estimatedHeightPt+4)*12700)+91440)));
  const canvas={x:base.x,y:top,width:base.width,height:Math.floor(base.y+base.height-top)};
  const referenceList=/reference|bibliograph|参考|引用/iu.test(slide.title||'')&&nodes.every(n=>n.type==='text');
  const plain=fitComponents(components,measurementProject,index,{canvas,relationalFallback:false,...(referenceList?{preferredLayoutId:'stacked-source',fontSizePt:Math.max(18,...nodes.map(n=>n.style?.fontSizePt||0)),center:true}:{})}),wide=wideFigureFit(components,measurementProject,index,{canvas});
  const fit=wide&&figureLayoutScore(components,wide)>figureLayoutScore(components,plain)?wide:plain;
  if(!fit.capacity_ok)throw editError('complete page content cannot fit at readable size',422,{measurement:fit});
  // Native/background artwork may surround the body. Only actual text/data,
  // protected images and manual objects are collision obstacles here.
  const outside=visibleNodes(slide).filter(n=>!nodes.includes(n)&&n.geometry&&(n.content?.mustPreserve||n.userGeometry||['text','table','chart'].includes(n.type)));
  if(fit.boxes.some(b=>outside.some(n=>overlaps(b,n.geometry)>12700*12700)))throw editError('smart layout intersects protected content or title; no changes applied',422);
  nodes.forEach((node,k)=>{node.geometry=fit.boxes[k];if(referenceList)node.style={...node.style,fontSizePt:fit.fontSizePt};if(fit.measurements?.[k]?.fontSizePt&&node.content?.sourceImageCaptionId)node.style={...node.style,fontSizePt:fit.measurements[k].fontSizePt,fontBasis:'figure_caption'};const artifact=slide.sourceArtifactNodes?.find(n=>n.id===node.id);if(artifact){artifact.geometry={...node.geometry};artifact.style={...node.style};}});
  slide.adaptiveLayout={version:1,layoutId:fit.layoutId||'measured-source-content',basis:'complete source content, proportional images and optional illustration retired as one unit'};
 }
 slide.nodeOrder=slide.nodes.map(n=>n.id);
 return [{type:'ai.slidePatch',payload:{slideId:slide.id,patches:[],smartLayout:{slideId:slide.id,slide}}}];
}

/** A code-laid card page laid out again (Fable 2026-11-01, relayout B): its
 * code-placed boxes keep their content and font and are measured afresh in
 * the page's content canvas, discarding manual moves. An arrangement word
 * picks its column count ("两栏", "三栏", "上下"/"表格在上"), "紧凑" the
 * shortest; a repeat takes the next measured candidate that differs from the
 * layout on the page. The cover and template text-slot pages refuse. */
const RELAYOUT_ROLES=new Set(['source-explanation','source-structure','source-media']);
const columnCount=boxes=>Math.max(...boxes.map(a=>boxes.filter(b=>b.y<a.y+a.height/2&&a.y+a.height/2<b.y+b.height).length));
export function cardPageRelayout(project,data){
 const index=project.deck.slides.findIndex(s=>s.id===data.slideId),slide=project.deck.slides[index];
 if(!slide)throw editError('slide not found',404);
 if(index===0)throw editError('the cover keeps its template layout; drag or resize its text directly',409);
 if(project.runtime?.slides?.[slide.id]?.accepted)throw editError('unlock the page before reflow',409);
 if(nativeCardPage(project,slide.id))return nativeCardToTheme(project,index);
 if(!codeLaidPage(project,slide.id))throw editError('this page writes into the template\'s own text slots, so it cannot be laid out again; edit its text, or merge or split its card in the outline and regenerate',409);
 const visible=visibleNodes(slide);
 // A statement in the template's quote banner belongs to that banner (Fable 2026-11-01).
 if(visible.some(n=>n.style?.colorBasis==='template_banner_text'))throw editError('the statement sits in the template\'s banner; drag or resize it directly',409);
 const nodes=visible.filter(n=>n.slotId==='absolute'&&n.geometry&&(n.sourceArtifact||RELAYOUT_ROLES.has(n.semanticRole)));
 if(nodes.some(n=>n.locked))throw editError('a locked box is on this page; unlock it before laying the page out again',409);
 if(!nodes.length)throw editError('this page has no code-placed content to lay out',409);
 const canvas=contentCanvas(project,index).geometry,center=slide.cardPage?.mode==='theme';
 const instruction=String(data.instruction||'');
 const wanted=/三栏|three.?col/iu.test(instruction)?3:/两栏|双栏|two.?col/iu.test(instruction)?2:/单栏|上下|表格在上|堆叠|stack|one.?col/iu.test(instruction)?1:0;
 const compact=/紧凑|compact|tight/iu.test(instruction);
 const components=nodes.map(n=>({...n,fontSizePt:n.style?.fontSizePt,...(n.type==='table'?{tableFontPt:n.style?.fontSizePt}:{})}));
 const options=[{},{columns:1},{columns:2},{columns:3}].map(o=>({...o,canvas,relationalFallback:false,...(center?{center:true}:{})}));
 // A figure page also gets generation's figure-first candidate; the columns
 // are counted from the boxes, since a figure and its text ignore the option.
 const figure=components.some(c=>c.type==='image');
 let fits=[...options.map(o=>fitComponents(components,project,index,o)),...(figure?[wideFigureFit(components,project,index,{canvas})]:[])]
  .filter(fit=>fit?.capacity_ok&&fit.boxes?.length===nodes.length)
  .map(fit=>{const boxes=fit.boxes.map(b=>({x:Math.round(b.x),y:Math.round(b.y),width:Math.round(b.width),height:Math.round(b.height)}));return{columns:columnCount(boxes),fit:{...fit,boxes}};})
  // The edit's quality gate measures text with the render contract; keep only candidates it accepts.
  .filter(c=>nodes.every((n,i)=>n.type!=='text'||!measureText({...n,kind:'text',bounds:c.fit.boxes[i]}).overflow));
 if(!fits.length)throw editError('this page\'s content does not fit its frame at its current font; shorten it or split its card in the outline',422);
 if(figure)fits.sort((a,b)=>figureLayoutScore(components,b.fit)-figureLayoutScore(components,a.fit));
 if(wanted){
  fits=fits.filter(c=>c.columns===wanted);
  if(!fits.length)throw editError(`this page's content does not fit ${wanted===1?'one column':wanted+' columns'} at its current font`,422);
 }
 else if(compact)fits.sort((a,b)=>a.fit.usedHeight-b.fit.usedHeight);
 const near=(a,b)=>Math.abs(a.x-b.x)<45720&&Math.abs(a.y-b.y)<45720&&Math.abs(a.width-b.width)<45720&&Math.abs(a.height-b.height)<45720;
 const same=fit=>fit.boxes.every((box,i)=>near(box,nodes[i].geometry));
 const distinct=fits.filter((c,k)=>!fits.slice(0,k).some(d=>d.fit.boxes.every((box,i)=>near(box,c.fit.boxes[i]))));
 const chosen=distinct.find(c=>!same(c.fit));
 if(!chosen)throw editError(wanted?'the page already has this arrangement':'the page is already in its only measured layout',409);
 return [{type:'nodes.setGeometry',payload:{slideId:slide.id,changes:nodes.map((n,i)=>({nodeId:n.id,geometry:chosen.fit.boxes[i],userGeometry:false}))}}];
}

/** Rule 3 (Fable 2026-11-01): a page written into the template's own text
 * slots is laid out again as a code-laid theme page on the same template
 * frame, its points measured into the content region. Text the user edited
 * on the page is carried into those points and back into the outline (Fable
 * D1): "重新排版" lays out what is on the page. */
function nativeCardToTheme(project,index){
 const original=project.deck.slides[index];
 if(original.locked||original.nodes.some(n=>n.locked&&!n.nativeRef&&n.semanticRole!=='page-number'))throw editError('a locked box is on this page; unlock it before laying the page out again',409);
 const page=livePage(project,index),next=structuredClone(project),slide=next.deck.slides[index];
 next.outline[index]=page;
 if(!fitThemePage(next,index,page)?.fit?.capacity_ok)throw editError('this page\'s content does not fit its frame at its current font; shorten it or split its card in the outline',422);
 bindThemeCardPage(next,slide,index,page);
 next.planning=refreshPlanning(next);
 if(next.planningContract?.cardOutline)next.planningContract.cardOutline={...next.planningContract.cardOutline,raw:{...next.planningContract.cardOutline.raw,slides:structuredClone(next.outline)}};
 if(next.confirmedOutline)next.confirmedOutline={...next.confirmedOutline,hash:outlineConfirmationHash(next)};
 const state=Object.fromEntries(['outline','planning','planningContract','confirmedOutline'].filter(key=>next[key]!==undefined).map(key=>[key,next[key]]));
 return [{type:'deck.replace',payload:{deck:ensureDeckV3(next.deck),projectState:state,cardStructure:{operation:'native-to-theme',targetId:slide.id,before:project.pages,after:project.pages}}}];
}
/** The card as the page shows it, read off its visible template slots in
 * page order: a list slot gives one point per line ("label：body"), a label
 * slot paired with a text slot gives a labelled point. Points that match the
 * outline keep their references; the outline changes only where the page does. */
function livePage(project,index){
 const page=project.outline[index],spec=project.templateFidelity?.slides?.[index],slide=project.deck.slides[index];
 const norm=text=>String(text||'').replace(/\s+/gu,'');
 const shown=new Map(visibleNodes(slide).filter(n=>n.nativeRef).map(n=>[String(n.nativeRef.shapeId),String(nodeContentText(n)||'').trim()]));
 const slots=(spec?.slots||[]).filter(slot=>slot.role==='content'&&shown.has(String(slot.shapeId)));
 const box=slot=>spec.nodes?.find(n=>String(n.nativeRef?.shapeId)===String(slot.shapeId))?.geometry||{x:0,y:0};
 const groups=new Map();for(const slot of slots){const key=String(slot.groupId||slot.pairedWith||slot.shapeId);groups.set(key,[...(groups.get(key)||[]),slot]);}
 const ordered=[...groups.values()].sort((a,b)=>Math.min(...a.map(s=>box(s).y))-Math.min(...b.map(s=>box(s).y))||Math.min(...a.map(s=>box(s).x))-Math.min(...b.map(s=>box(s).x)));
 const split=line=>{const m=line.match(/^(.{1,16}?)[：:]\s*(.+)$/u);return m?{label:m[1],text:m[2]}:{text:line};};
 const live=ordered.flatMap(group=>{
  const bySize=[...group].sort((a,b)=>Number(a.capacity||0)-Number(b.capacity||0)),texts=bySize.map(slot=>shown.get(String(slot.shapeId))).filter(Boolean);
  if(group.length>1&&texts.length===2)return[{label:texts[0],text:texts[1]}];
  return texts.flatMap(text=>text.split('\n').map(line=>line.trim()).filter(Boolean).map(split));
 });
 const original=page.keyPoints||[];
 const same=live.length===original.length&&live.every((point,k)=>norm(point.text)===norm(original[k].text)||norm(`${point.label||''}${point.text}`)===norm(`${original[k].label||''}${original[k].text}`));
 const titleNode=visibleNodes(slide).find(n=>n.semanticRole==='template-title'),title=String(nodeContentText(titleNode)||'').trim()||page.title;
 if(same||!live.length)return{...page,title};
 const keyPoints=live.map(point=>{const match=original.find(o=>norm(o.text)===norm(point.text)||norm(o.label)&&norm(o.label)===norm(point.label));return{...(match||{}),...point,...(point.label?{}:{label:match?.label})};}).map(point=>{if(!point.label)delete point.label;return point;});
 return{...page,title,keyPoints};
}
