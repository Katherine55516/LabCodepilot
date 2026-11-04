import {contentCanvas,fitComponents,measureComponent,sourceImageComponents,INCH} from './ppt-density-capacity.mjs';
import {shownImage} from './ppt-figure-captions.mjs';
import {continuationTitle,captionLeadTitle} from './ppt-outline-cards.mjs';

/** Measure source figures beside a theme card. No point removal: an unfit
 * candidate stays a figure page. The user (2026-10-31, World Models p2) found
 * the page untidy: points flowed into two ragged columns at the body size,
 * the text started at the top while each figure sat centred at its own height.
 * Now the points are one column, grown like a sparse theme page; two figures
 * share one height when both stay readable; text and figures start on one top
 * line, the taller block centred. */
// The sparse-page growth of ppt-card-pages.mjs (which imports this module).
const SPARSE_FILL=.65,GROWN_FILL=.8;
export const FIGURE_TEXT_FLOOR_PT=7;
const RASTER_DIAGRAM_SHARE=.4,UNREAD_VECTOR_SCALE=1.75;
/** Whether a figure's own text reads at a placed width (EMU): true or false
 * when it was measured (glyphs or OCR) or is unread vector text (1.75× its
 * printed size), null when nothing is known. */
export function figureTextReads(image,width){
 const text=image?.figureText;
 if(text?.share>0)return text.share*width/12700>=FIGURE_TEXT_FLOOR_PT;
 if(text?.boxWidthPt>0)return width/12700/text.boxWidthPt>=UNREAD_VECTOR_SCALE;
 return null;
}
export function legibleBeside(image,width,contentWidth){
 // The measured text (glyphs, or OCR of a 4× copy) decides; a vector figure
 // whose text could not be read (World Models Figure 4: labels drawn as paths)
 // sits beside points only at 1.75× its printed size; a raster diagram at 40%
 // of the content width. Photos and game frames are exempt.
 // A raster that is no continuous tone (a line drawing) is held like a
 // diagram when its text could not be measured (Fable 2026-11-02).
 // OCR that read nothing is no proof of no text (the user, 2026-11-03): such a
 // figure is uncertain and is held at the conservative 40% size, whatever its
 // kind, with a figure_text_unmeasured warning; it never passes as legible.
 const measured=figureTextReads(image,width);if(measured!==null)return measured;
 const proxy=width>=contentWidth*RASTER_DIAGRAM_SHARE*.99;
 return uncertainText(image)?proxy:(image.role!=='diagram'&&image.continuousTone!==false)||proxy;
}
/** A figure whose OCR ran but read no measurable text, or failed. */
export const uncertainText=image=>['ocr_unread','ocr_failed'].includes(image?.figureText?.source);
export function pairedCaption(caption,measure){
 const full=String(caption||'').trim(),label=full.match(/^\s*((?:fig(?:ure)?\.?|图|圖)\s*[\dA-Z]+)[.:：]?\s*/iu);
 if(!full)return {text:full,shortened:false};
 const rest=label?full.slice(label[0].length):full,sentence=rest.match(/^[\s\S]*?[.。!?！？](?=\s|$)/u)?.[0]?.trim()||rest.trim();
 const han=/\p{Script=Han}/u.test(full),first=label?`${label[1]}${han?'：':'. '}${sentence}`:sentence;
 if(first.length>=full.length-1)return {text:full,shortened:false};
 if(measure(first)<=2)return {text:first,shortened:true};
 const subject=captionLeadTitle(full,han,{words:1});
 return subject&&label?{text:`${label[1]}${han?'：':': '}${subject}`,shortened:true}:{text:first,shortened:true};
}
function figureParts(images,cellOf,canvas,captionPt){
 return images.map((image,k)=>{const [picture,captionComponent]=sourceImageComponents(image),{x,width}=cellOf(k);
  const lines=text=>{const one=measureComponent({type:'text',content:{text:'Xg'}},{x,y:canvas.y,width,height:canvas.height},captionPt).height;return measureComponent({type:'text',content:{text}},{x,y:canvas.y,width,height:canvas.height},captionPt).height/Math.max(1,one);};
  let caption=captionComponent;
  if(caption){const short=pairedCaption(image.caption,lines);if(short.shortened)caption={...caption,content:{...caption.content,text:short.text,captionShortened:true}};}
  const h=caption?measureComponent(caption,{x,y:canvas.y,width,height:canvas.height},captionPt).height:0;
  return {image,picture,caption,x,h};});
}
/** The points beside the figures, else the figures full width with the points
 * under them (Fable 2026-11-02, F3: two short points under a wide figure still
 * keep its text at 7 pt). Null when neither fits: the figure keeps its page. */
export function fitCardFigures(project,index,page,components){
 return besideFit(project,index,page,components)||belowFit(project,index,page,components);
}
function belowFit(project,index,page,components){
 const ids=page.sourceImageIds||[];
 if(!ids.length||ids.length>2||!(page.keyPoints||[]).length)return null;
 const images=ids.map(id=>project.source?.images?.find(image=>image.id===id));
 if(images.some(image=>!image||!image.width||!image.height))return null;
 const {geometry:canvas,fontSizePt}=contentCanvas(project,index),gap=.18*INCH;
 // The points at the body size across the full width, under the figures.
 const text=fitComponents(components,project,index,{canvas,fontSizePt,columns:1});
 if(!text.capacity_ok)return null;
 const textHeight=Math.max(...text.boxes.map(box=>box.y+box.height))-Math.min(...text.boxes.map(box=>box.y));
 const captionPt=Math.max(12,fontSizePt-2),cell=(canvas.width-gap*(images.length-1))/images.length;
 const parts=figureParts(images.map(image=>shownImage(project,image)),k=>({x:canvas.x+k*(cell+gap),width:cell}),canvas,captionPt);
 const captionHeight=Math.max(...parts.map(part=>part.h)),figureRoom=canvas.height-textHeight-gap-(captionHeight?captionHeight+gap/2:0);
 if(figureRoom<=0)return null;
 const minimum=image=>(image.role==='diagram'||String(image.caption||'').length>350?3.2:2.2)*INCH;
 const widths=parts.map(({image})=>Math.min(cell,figureRoom*image.width/image.height));
 if(parts.some(({image},k)=>widths[k]<minimum(image)||!legibleBeside(image,widths[k],canvas.width)))return null;
 const heights=parts.map(({image},k)=>widths[k]*image.height/image.width),tall=Math.max(...heights);
 const more=[],boxes=[],measurements=[];
 for(const [k,{picture,caption,x,h}] of parts.entries()){
  more.push(picture);boxes.push({x:Math.round(x+(cell-widths[k])/2),y:canvas.y,width:Math.round(widths[k]),height:Math.round(heights[k])});measurements.push({fontSizePt});
  if(caption){more.push(caption);boxes.push({x:Math.round(x),y:Math.round(canvas.y+tall+gap/2),width:Math.round(cell),height:Math.ceil(h)});measurements.push({fontSizePt:captionPt,fontBasis:'figure_caption'});}
 }
 const textTop=Math.min(...text.boxes.map(box=>box.y)),dy=Math.round(canvas.y+tall+(captionHeight?captionHeight+gap/2:0)+gap-textTop);
 return {components:[...components,...more],fit:{...text,canvas,layoutId:'card-source-figure-below',boxes:[...text.boxes.map(box=>({...box,y:box.y+dy})),...boxes],measurements:[...text.measurements,...measurements],fontSizePt:text.fontSizePt||fontSizePt,inlineSourceImageIds:ids}};
}
function besideFit(project,index,page,components){
 const ids=page.sourceImageIds||[];
 if(!ids.length||ids.length>2)return null;
 const images=ids.map(id=>project.source?.images?.find(image=>image.id===id));
 if(images.some(image=>!image||!image.width||!image.height))return null;
 const {geometry:canvas,fontSizePt}=contentCanvas(project,index),gap=.18*INCH;
 const column=Math.min(canvas.width*.4,images.reduce((sum,image)=>sum+image.width/96*INCH,0));
 if(column<2.2*INCH||images.length===2&&(column-gap)/2<2.2*INCH)return null;
 const textCanvas={...canvas,width:Math.floor(canvas.width-column-gap)};
 if(textCanvas.width<=0)return null;
 // One column of points; the old flow into more columns only when one does not fit.
 const one=fitComponents(components,project,index,{canvas:textCanvas,fontSizePt,columns:1});
 let text=one.capacity_ok?one:fitComponents(components,project,index,{canvas:textCanvas,fontSizePt});
 if(!text.capacity_ok)return null;
 let shown=components;
 if(one.capacity_ok&&text.usedHeight<SPARSE_FILL*text.availableHeight){
  // At most body + 2 pt, as a sparse theme page (the user, 2026-11-02).
  const few=(page.keyPoints||[]).length<=4,cap=Math.min(22,fontSizePt+2);
  for(const scale of few?[1.6,1.45,1.3,1.2,1.1]:[1.3,1.2,1.1]){
   const pt=Math.min(cap,Math.round(fontSizePt*scale));if(pt<=fontSizePt)continue;
   const sized=components.map(component=>({...component,fontSizePt:pt})),grown=fitComponents(sized,project,index,{canvas:textCanvas,fontSizePt:pt,columns:1});
   if(grown.capacity_ok&&grown.usedHeight<=GROWN_FILL*grown.availableHeight){text=grown;shown=sized;break;}
  }
 }
 const captionPt=Math.max(12,fontSizePt-2),cell=(column-gap*(images.length-1))/images.length;
 // Each figure at its cell, then all at the smallest height so tops, bottoms and captions line up.
 const parts=figureParts(images.map(image=>shownImage(project,image)),k=>({x:canvas.x+canvas.width-column+k*(cell+gap),width:cell}),canvas,captionPt);
 const captionHeight=Math.max(...parts.map(part=>part.h)),below=captionHeight?captionHeight+gap/2:0,available=canvas.height-below;
 if(available<=0)return null;
 const minimum=image=>(image.role==='diagram'||String(image.caption||'').length>350?3.2:2.2)*INCH;
 const own=parts.map(({image})=>Math.min(cell,available*image.width/image.height)*image.height/image.width);
 if(parts.some(({image},k)=>own[k]*image.width/image.height<minimum(image)))return null;
 // The legibility floor (Fable 2026-11-02, World Models p3: Figure 4's notes
 // at ~4 pt): a vector figure's text at its placed scale stays ≥7 pt; a raster
 // diagram is at least 40% of the content width. Else it keeps a figure page.
 if(parts.some(({image},k)=>!legibleBeside(image,own[k]*image.width/image.height,canvas.width)))return null;
 // One height when both stay readable at it (World Models: 1.26 and 2.0 wide, the first would shrink to 1.4 in).
 const common=Math.min(...own),heights=parts.every(({image})=>common*image.width/image.height>=minimum(image)&&legibleBeside(image,common*image.width/image.height,canvas.width))?own.map(()=>common):own,height=Math.max(...heights);
 // One top line for the text and the figures, the taller block centred in the canvas.
 const textTop=Math.min(...text.boxes.map(box=>box.y)),textHeight=Math.max(...text.boxes.map(box=>box.y+box.height))-textTop;
 const top=Math.round(canvas.y+Math.max(0,canvas.height-Math.max(textHeight,height+below))/2),dy=top-textTop;
 const more=[],boxes=[],measurements=[];
 for(const [k,{image,picture,caption,x,h}] of parts.entries()){
  const tall=heights[k],width=tall*image.width/image.height;
  more.push(picture);boxes.push({x:Math.round(x+(cell-width)/2),y:top,width:Math.round(width),height:Math.round(tall)});measurements.push({fontSizePt});
  if(caption){more.push(caption);boxes.push({x:Math.round(x),y:Math.round(top+tall+gap/2),width:Math.round(cell),height:Math.ceil(h)});measurements.push({fontSizePt:captionPt,fontBasis:'figure_caption'});}
 }
 const textBoxes=text.boxes.map(box=>({...box,y:box.y+dy}));
 return {components:[...shown,...more],fit:{...text,canvas,layoutId:'card-source-figure-columns',boxes:[...textBoxes,...boxes],measurements:[...text.measurements,...measurements],fontSizePt:text.fontSizePt||fontSizePt,inlineSourceImageIds:ids}};
}

/** Run after template scheduling, then recheck on the trial's actual frames.
 * A rejected trial leaves the original figure pages and schedule intact.
 * Figures go beside the points of their card (user decision 2026-10-30,
 * replacing figure-only pages): the owner page first, then its continuation
 * text pages (same title root), at most two per page. Only figures that fit
 * nowhere stay on a figure page. */
export const figureTitleAlone=title=>String(title).replace(/\s+\d+\/\d+$/u,'').replace(/\s*·$/u,'');
const titleRoot=title=>String(title||'').replace(/\s+·\s+(?:Figures\s+)?\d+\/\d+$/u,'').trim();
// A page of the same logical card (its continuations); two cards with one
// title are different cards (the user, 2026-11-02: no points moved between
// same-named sections). The title root decides only for pages without card ids.
// A page filled into its template page is fixed: no figure joins it, no point leaves it (fill-template-first).
// A card whose cited figures exceed its page's slots is not fixed: pairing places them (Fable 2026-11-03).
const fixedByFill=slide=>slide?.templateFill?.status==='filled'&&slide.templateFill.sticky===true&&!(Number(slide.templateFill.citedFigures)>Number(slide.templateFill.figures||0));
const sameCard=(owner,slide)=>owner.logicalCardId||slide.logicalCardId?Boolean(owner.logicalCardId)&&slide.logicalCardId===owner.logicalCardId:titleRoot(slide.title)===titleRoot(owner.title);
export function placeCardFigures(project,raw,{reschedule,isNative,components,fits=(trial,k,page)=>fitCardFigures(trial,k,page,components(trial,page)),validate=()=>true}){
 if(project.templateFidelity?.mode!=='preserve')return raw;
 let current=raw;
 const frequencies=slides=>{const result={};for(const slide of slides)for(const id of slide.sourceImageIds||[])result[id]=(result[id]||0)+1;return JSON.stringify(Object.entries(result).sort());};
 // The source's one diagram keeps its full figure page (Fable D4).
 const owners=[...new Set(current.slides.filter(slide=>slide.figurePage&&slide.restoredFrom&&!slide.soleFigure).map(slide=>slide.restoredFrom))];
 for(const ownerId of owners){
  const owner=current.slides.find(slide=>slide.id===ownerId);if(!owner)continue;
  const hostIds=current.slides.filter((slide,k)=>(slide.id===ownerId||!slide.figurePage&&!slide.cardFrame&&sameCard(owner,slide))&&slide.keyPoints?.length&&!slide.cardObjects?.length&&!slide.inlineFigureFallback&&!fixedByFill(slide)&&(slide.sourceImageIds?.length||0)<2&&!isNative(project,k,slide)).map(slide=>slide.id);
  for(const hostId of hostIds){
   const ids=current.slides.filter(slide=>slide.figurePage&&slide.restoredFrom===ownerId).flatMap(slide=>slide.sourceImageIds||[]);
   if(!ids.length)break;
   const host=current.slides.find(slide=>slide.id===hostId),existing=host.sourceImageIds||[];
   for(let count=Math.min(2-existing.length,ids.length);count>=1;count--){
    const selected=ids.slice(0,count),keep=new Set(selected);
    let slides=current.slides.map(slide=>slide.id===hostId?{...slide,sourceImageIds:[...existing,...selected],cardFigureLayout:true}:slide.figurePage&&slide.restoredFrom===ownerId?{...slide,sourceImageIds:slide.sourceImageIds.filter(id=>!keep.has(id))}:slide).filter(slide=>!slide.figurePage||slide.sourceImageIds?.length);
    const remaining=slides.filter(slide=>slide.figurePage&&slide.restoredFrom===ownerId);
    slides=slides.map(slide=>{const k=remaining.indexOf(slide);if(k<0)return slide;const title=remaining.length===1?figureTitleAlone(slide.title):slide.title.replace(/\d+\/\d+$/u,`${k+1}/${remaining.length}`);return{...slide,title,focus:title};});
    if(frequencies(slides)!==frequencies(current.slides))throw Error('inline figure assignment changed source image counts');
    const trial={...project,pages:slides.length,outline:slides,templateFidelity:structuredClone(project.templateFidelity)};
    reschedule(trial);
    const valid=slides.every((page,k)=>!page.cardFigureLayout||(!isNative(trial,k,{...page,cardFigureLayout:false})&&fits(trial,k,page)));
    if(!valid||validate(trial)!==true)continue;
    project.pages=slides.length;project.outline=slides;project.templateFidelity=trial.templateFidelity;
    current={...current,slides};break;
   }
  }
 }
 return pairFigurePages(project,current,{reschedule,isNative,fits,validate});
}

/** Whether a point cites a source figure: its caption's unit, its label named
 * in the text ("Figure 4", "图 4"), or the figure's source segment (F1). */
export function pointCitesFigure(project,point,image){
 const units=new Map((project.originalSourceInventory?.items||project.source?.semantic?.inventory?.items||[]).map(item=>[item.id,item]));
 const caption=String(image?.caption||'').trim(),label=caption.match(/^(?:(fig(?:ure)?\.?)|(图|圖))\s*(\d+)/iu);
 const texts=[String(point.text||''),...(point.sourceUnitIds||[]).map(id=>String(units.get(id)?.text||''))];
 if(caption&&(point.sourceUnitIds||[]).some(id=>{const text=String(units.get(id)?.text||'').trim();return text&&(text===caption||caption.startsWith(text.slice(0,60)));}))return 'caption';
 if(label&&texts.some(text=>(label[2]?new RegExp(`[图圖]\\s*${label[3]}(?!\\d)`,'u'):new RegExp(`\\bfig(?:ure)?\\.?\\s*${label[3]}(?!\\d)`,'iu')).test(text)))return 'named';
 const refs=new Set((image?.sourceRefs||[]).map(String));
 return (point.refs||[]).some(ref=>refs.has(String(ref)))?'segment':'';
}

/** A figure page left by the host pass takes the points that explain its
 * figures (Fable 2026-11-02, F1/F2; the user: World Models on Mood-Board had
 * figure-only pages 6 and 7 while the hand deck put each figure beside the
 * text it supports). The citing points of the card's donor page move onto it,
 * nearest points in source order added up to two; k = max(2, citing) is
 * reduced (never below two) until both pages fit. A donor that would keep
 * fewer than two points moves whole. The page becomes the card's next part:
 * the card's title base with a continuation marker (the numbering pass sets
 * "· k/n"), no "Figure" eyebrow. Donors with objects, tables, numbered steps
 * or row points keep their points; their figure keeps its page (F3). A cited
 * figure is never moved to the notes here (the user, 2026-11-02: necessary
 * figures stay on the slides, on a page of their own when nothing pairs). A donor
 * on native slots may give points: the schedule picks its frame again. */
function pairFigurePages(project,raw,{reschedule,isNative,fits,validate}){
 let current=raw;
 // Why each figure page stays one (Fable 2026-11-03): no_points (no page of
 // its card has two free points that cite it, or every one already shows a
 // figure), space (no layout fit; the figure-card route is not yet tried) or
 // titles (a trial broke the title of a shifted page on every frame, B). The
 // ledger adds legibility (F3).
 const reasons=new Map();
 // One figure page against the pages of its card: the outline with it paired, or why not.
 const attempt=(current,pageId)=>{
  const figure=current.slides.find(slide=>slide.id===pageId);
  const images=(figure.sourceImageIds||[]).map(id=>project.source?.images?.find(image=>image.id===id)).filter(Boolean);
  const owner=current.slides.find(slide=>slide.id===figure.restoredFrom);if(!owner)return {current,placed:false,reason:{reason:'no_points',detail:{owner:'missing'}}};
  const donors=current.slides.filter(slide=>!slide.figurePage&&!slide.cardFrame&&(slide.id===owner.id||sameCard(owner,slide))
   &&(slide.keyPoints||[]).length>=2&&!slide.cardObjects?.length&&!slide.inlineFigureFallback&&!fixedByFill(slide)&&!(slide.sourceArtifactRanges||[]).length&&!slide.numberedPoints&&(slide.sourceImageIds?.length||0)<=1&&!slide.keyPoints.some(point=>point.rowLabel));
  const citing=slide=>slide.keyPoints.map((point,k)=>({k,rank:images.map(image=>pointCitesFigure(project,point,image)).reduce((best,kind)=>Math.max(best,{caption:3,named:2,segment:1}[kind]||0),0)})).filter(item=>item.rank>0);
  const ranked=donors.map(slide=>({slide,cites:citing(slide)})).filter(item=>item.cites.length).sort((a,b)=>Math.max(...b.cites.map(c=>c.rank))-Math.max(...a.cites.map(c=>c.rank))||b.cites.length-a.cites.length);
  if(!ranked.length)return {current,placed:false,reason:{reason:'no_points',detail:{donors:donors.length}}};
  const refusals=[];
  for(const {slide:donor,cites} of ranked){
   const n=donor.keyPoints.length,want=Math.max(2,cites.length);
   // The citing points by strength, then the nearest points in source order.
   const order=[...cites.sort((a,b)=>b.rank-a.rank||a.k-b.k).map(item=>item.k)];
   const centre=order.length?order.reduce((sum,k)=>sum+k,0)/order.length:0;
   for(const k of [...donor.keyPoints.keys()].sort((a,b)=>Math.abs(a-centre)-Math.abs(b-centre)||a-b))if(!order.includes(k))order.push(k);
   let placed=null;
   for(let size=Math.min(want,n);size>=2&&!placed;size--){
    // A donor showing a figure of its own keeps it and two points (F4: two
    // figures of one card each with their points).
    if(n-size<2&&donor.sourceImageIds?.length)continue;
    const moving=new Set(n-size<2?[...donor.keyPoints.keys()]:order.slice(0,size));
    const moved=donor.keyPoints.filter((_,k)=>moving.has(k)),kept=donor.keyPoints.filter((_,k)=>!moving.has(k));
    const units=list=>[...new Set(list.flatMap(point=>point.sourceUnitIds||[]))],refs=list=>[...new Set(list.flatMap(point=>(point.refs||[]).map(String)))];
    const keptUnits=new Set(units(kept));
    const lang=project.inputUnderstanding?.primaryLanguage||'en';
    const paired={...figure,keyPoints:moved,sourceUnitIds:units(moved),refs:[...new Set([...refs(moved),...(figure.refs||[])])],cardFigureLayout:true,title:kept.length?continuationTitle(donor.title,lang):donor.title,focus:kept.length?continuationTitle(donor.title,lang):donor.title,section:donor.section,role:donor.role,visualIntent:donor.visualIntent,logicalCardId:donor.logicalCardId,pairedFigurePage:true};
    delete paired.figurePage;delete paired.restoredFrom;delete paired.titleRepeat;
    let slides=current.slides.filter(slide=>slide.id!==pageId);
    const d=slides.findIndex(slide=>slide.id===donor.id);
    if(kept.length)slides.splice(d,1,{...donor,keyPoints:kept,sourceUnitIds:(donor.sourceUnitIds||[]).filter(id=>keptUnits.has(id)||!units(moved).includes(id))});
    else slides.splice(d,1);
    // Before the donor when the figure's points open the card, else after it.
    const before=kept.length&&Math.max(...[...moving])<Math.min(...[...donor.keyPoints.keys()].filter(k=>!moving.has(k)));
    const pos=kept.length?slides.findIndex(slide=>slide.id===donor.id)+(before?0:1):d;
    slides.splice(pos,0,kept.length?paired:{...paired,id:donor.id});
    // The part order follows the points: the page holding the earlier points is part 1.
    if(before){const donorAt=slides.findIndex(slide=>slide.id===donor.id),pair=slides[donorAt-1];slides[donorAt-1]={...pair,title:donor.title,focus:donor.title};slides[donorAt]={...slides[donorAt],title:continuationTitle(donor.title,lang),focus:continuationTitle(donor.title,lang)};}
    const trial={...project,pages:slides.length,outline:slides,templateFidelity:structuredClone(project.templateFidelity)};
    reschedule(trial);
    const valid=slides.every((page,k)=>(page.id===donor.id&&page.cardFigureLayout?fits(trial,k,page):true)&&(!page.pairedFigurePage||(!isNative(trial,k,{...page,cardFigureLayout:false})&&fits(trial,k,page))));
    if(!valid){refusals.push({donor:donor.id,size,reason:'space'});continue;}
    const checked=validate(trial);
    if(checked!==true){refusals.push({donor:donor.id,size,...(checked&&typeof checked==='object'?checked:{reason:'space'})});continue;}
    project.pages=slides.length;project.outline=slides;project.templateFidelity=trial.templateFidelity;
    current={...current,slides};placed=true;
   }
   if(placed)return {current,placed:true};
  }
  return {current,placed:false,reason:refusals.length?{reason:refusals.every(item=>item.reason==='titles')?'titles':'space',detail:{refusals:refusals.slice(0,8)}}:{reason:'no_points',detail:{donorsWithFigures:ranked.length}}};
 };
 const pageIds=current.slides.filter(slide=>slide.figurePage&&slide.restoredFrom&&!slide.soleFigure).map(slide=>slide.id);
 for(const pageId of pageIds){
  const figure=current.slides.find(slide=>slide.id===pageId);if(!figure)continue;
  const count=(figure.sourceImageIds||[]).filter(id=>project.source?.images?.some(image=>image.id===id)).length;
  if(!count||count>2){reasons.set(pageId,{reason:'space',detail:{figures:count}});continue;}
  const whole=attempt(current,pageId);
  if(whole.placed){current=whole.current;continue;}
  reasons.set(pageId,whole.reason);
  if(count<2)continue;
  // Two figures that pair with nothing together: each on its own page, either
  // one paired with its points (live Mood f4: Figures 20 and 21 grouped, while
  // Figure 20 alone fits beside p16). Kept whole when neither pairs.
  const [first,second]=figure.sourceImageIds,splitId=pageId+'_2';
  const split={...current,slides:current.slides.flatMap(slide=>slide.id!==pageId?[slide]:[{...slide,sourceImageIds:[first]},{...slide,id:splitId,sourceImageIds:[second]}])};
  for(const [tryId,otherId] of [[pageId,splitId],[splitId,pageId]]){
   const one=attempt(split,tryId);if(!one.placed)continue;
   const other=attempt(one.current,otherId);
   current=other.placed?other.current:one.current;reasons.delete(pageId);
   if(!other.placed)reasons.set(otherId,other.reason);
   break;
  }
 }
 // Every figure page left carries its reason; a sole figure has no points of its own.
 const slides=current.slides.map(slide=>{if(!slide.figurePage||slide.figureOnlyDetail?.generationFallback)return slide;const {reason,detail}=reasons.get(slide.id)||{reason:'no_points',detail:{sole:Boolean(slide.soleFigure)}};return {...slide,figureOnlyReason:reason,figureOnlyDetail:detail};});
 if(project.outline===current.slides)project.outline=slides;
 return {...current,slides};
}
