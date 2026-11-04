/** Media-preserving placement of source-owned components (MD-P0-1, MD-P1-4).
 * Before a rebuilt source region retires the template's card artwork, try to
 * flow the same components, at the same font size and in reading order, into
 * the vertical strips the artwork leaves free; and re-anchor card-set icons in
 * a gutter beside the first text boxes instead of retiring them. Nothing is
 * shortened or shrunk: either everything fits or the caller keeps its fit. */
import { measureComponent,fitComponents,contentCanvas } from './ppt-density-capacity.mjs';
import {nativeComponentSpecs,componentInstance,componentReflowReadable} from './ppt-native-components.mjs';
import { templateMediaRole } from './ppt-template-fidelity.mjs';
import { cardsFlow } from './ppt-flow.mjs';
import { chromeSlot } from './ppt-chrome-slots.mjs';
import { slotPictureEntry } from './ppt-content-slot-pictures.mjs';
import { stackedPictureIds } from './ppt-stacked-pictures.mjs';

// EMU per inch is local: this module sits in an import cycle with density-capacity.
const EMU_INCH = 914400, GAP = Math.round(EMU_INCH * .16), MIN_COLUMN = Math.round(EMU_INCH * 2.3);
const overlapRatio = (g, r) => Math.max(0, Math.min(g.x + g.width, r.x + r.width) - Math.max(g.x, r.x)) * Math.max(0, Math.min(g.y + g.height, r.y + r.height) - Math.max(g.y, r.y)) / Math.max(1, g.width * g.height);

/** The region a source rebuild replaces: from just under the title/section
 * header to the canvas bottom, from the title's left edge to the canvas right. */
export function sourceRegion(project, index, canvas) {
  const spec = project.templateFidelity?.slides?.[index];
  if (!spec || !canvas) return canvas;
  const slotOf = n => spec.slots?.find(s => s.shapeId === n.nativeRef?.shapeId);
  const headerBottom = Math.max(0, ...(spec.nodes || []).filter(n => ['title', 'section'].includes(slotOf(n)?.role)).map(n => n.geometry.y + n.geometry.height));
  const titleLeft = Math.min(canvas.x, ...(spec.nodes || []).filter(n => slotOf(n)?.role === 'title').map(n => n.geometry.x));
  const region = { ...canvas, x: titleLeft, width: canvas.x + canvas.width - titleLeft, y: Math.min(canvas.y, headerBottom + 91440) };
  region.height = canvas.y + canvas.height - region.y;
  return region;
}
export const CARD_PHOTO_AREA=.04;
/** A card deck's content page: not the cover, a chapter divider, the takeaway or the closing. */
export const contentCard=(project,index)=>{const page=project.outline?.[index];return cardsFlow(project)&&index>0&&Boolean(page)&&!page.cardFrame&&page.role!=='closing';};
/** The content cards that keep their frame's template photo as an accent
 * (Fable M4, 2026-11-01): a sparse card (at most 3 points, no object, figure,
 * numbering or diagram intent) on a frame with a large photo, at most one in
 * four content cards, spread through the deck. */
const accentCache=new WeakMap();
const sparse=page=>page&&(page.keyPoints||[]).length>0&&(page.keyPoints||[]).length<=3&&!(page.cardObjects||[]).length&&!page.figurePage&&!(page.sourceImageIds||[]).length&&!page.numberedPoints&&!['table','comparison','process','relation'].includes(page.visualIntent?.type)&&!['steps','grid','compare','kpi'].includes(page.cardShapeOverride);
const largePhoto=(project,index)=>{const spec=project.templateFidelity?.slides?.[index],size=project.templateFidelity;return Boolean(spec&&size&&(spec.nodes||[]).some(node=>node.type==='image'&&node.geometry&&!node.content?.mustPreserve&&node.geometry.width*node.geometry.height>=size.width*size.height*CARD_PHOTO_AREA&&!(node.geometry.width>=size.width*.85&&node.geometry.height>=size.height*.5)&&templateMediaRole(node,spec,size)==='template_decoration'));};
export function photoAccentPages(project){
 const outline=project.outline||[];
 if(accentCache.has(outline))return accentCache.get(outline);
 const content=outline.map((_,index)=>index).filter(index=>contentCard(project,index));
 const budget=Math.floor(content.length/4),chosen=new Set();
 let last=-Infinity;
 for(const index of content){if(chosen.size>=budget)break;if(index-last>=4&&sparse(outline[index])&&largePhoto(project,index)){chosen.add(index);last=index;}}
 accentCache.set(outline,chosen);
 return chosen;
}
/** Template images on this page that a full region rebuild would retire. */
export function regionArtwork(project, index, canvas) {
  const found = candidateArtwork(project, index, canvas), blocked = repeatedArtwork(project, index);
  const artwork = blocked.size ? found.artwork.filter(node => !blocked.has(artworkKey(node))) : found.artwork;
  return { ...found, artwork: wholeSets(project, index, artwork) };
}
/** Repeated artwork (a chevron row, numbered tiles) is a component, kept
 * whole or not at all (Fable 2026-11-02, live Capabilities: three chevrons over
 * four points, one chevron over five). On a content page a set is kept only
 * when its pieces equal the points; a banner set (≤1.2 in tall, ≥4:1: chevrons,
 * arrows) never, since its pictures may carry baked-in sample icons the page
 * does not mean (Portfolio's laptop and bug arrows). Pieces over a tenth of
 * the slide are paintings, each kept or retired on its own (two side-by-side
 * photos are no component). */
const SET_PIECE_SHARE = .1;
export function artworkSets(artwork, size = {}) {
  const like = (a, b) => Math.abs(a.width - b.width) <= Math.max(a.width, b.width) * .06 && Math.abs(a.height - b.height) <= Math.max(a.height, b.height) * .06;
  const slide = (Number(size.width) || 12192000) * (Number(size.height) || 6858000), piece = node => node.geometry.width * node.geometry.height <= slide * SET_PIECE_SHARE;
  const sets = [];
  for (const node of artwork) { const set = piece(node) && sets.find(group => piece(group[0]) && like(group[0].geometry, node.geometry)); if (set) set.push(node); else sets.push([node]); }
  return sets;
}
function wholeSets(project, index, artwork) {
  if (!contentCard(project, index)) return artwork;
  const points = (project.outline?.[index]?.keyPoints || []).length;
  return artworkSets(artwork, project.templateFidelity).filter(set => {
    if (set.length < 2) return true;
    const g = set[0].geometry, banner = g.height <= 1.2 * EMU_INCH && g.width >= 4 * g.height;
    return !banner && set.length === points;
  }).flat();
}
/** Template artwork in a content slot follows the painting rule (Fable B,
 * 2026-11-02; Codex on Portfolio: t4's two arrow pictures on docx pages 3,
 * 14, 15, 19 and 33): one use, a second only five or more pages later, never
 * a third. Played over the plan in page order; pieces under 2% of the slide
 * (icons, markers) and chrome slots are outside it. A blocked piece is not
 * offered to the layout, so its region goes to the content. */
const ARTWORK_AREA = .02, ARTWORK_GAP = 5, ARTWORK_USES = 2, frameArtwork = new WeakMap();
const artworkKey = node => node.content?.imageSha256 || `${node.nativeRef?.sourceSlideIndex}:${node.nativeRef?.shapeId}`;
export function repeatedArtwork(project, index) {
  const slides = project.templateFidelity?.slides || [], size = project.templateFidelity;
  // Content pages only: a frame page (a divider, the closing) keeps its artwork.
  if (!slides[index] || index < 1 || !contentCard(project, index)) return new Set();
  const uses = new Map(), blocked = new Set();
  for (let j = 1; j <= index; j++) {
    const spec = slides[j];if (!spec || !contentCard(project, j)) continue;
    // By page spec and page (a content card retires decorations a frame page keeps).
    const memo = frameArtwork.get(spec) || frameArtwork.set(spec, new Map()).get(spec), page = String(project.outline?.[j]?.id ?? j);
    if (!memo.has(page)) {
      const area = (size.width || 12192000) * (size.height || 6858000);
      // Slot-plan pictures never repeat by construction (G2); they are outside this count.
      memo.set(page, candidateArtwork(project, j, contentCanvas(project, j).geometry).artwork
        .filter(node => !chromeSlot(node, size) && node.geometry.width * node.geometry.height >= area * ARTWORK_AREA && slotPictureEntry(project, j, node) === undefined).map(artworkKey));
    }
    for (const key of new Set(memo.get(page))) {
      const prior = uses.get(key) || [];
      if (prior.length >= ARTWORK_USES || prior.length && j - prior.at(-1) < ARTWORK_GAP) { if (j === index) blocked.add(key); continue; }
      uses.set(key, [...prior, j]);
    }
  }
  return blocked;
}
function candidateArtwork(project, index, canvas) {
  const spec = project.templateFidelity?.slides?.[index], size = project.templateFidelity;
  if (!spec || !canvas || !size) return { artwork: [], icons: [] };
  const artwork = [], icons = [], region = sourceRegion(project, index, canvas), stacked = stackedPictureIds(spec);
  for (const node of spec.nodes || []) {
    const g = node.geometry;
    if (node.type !== 'image' || !g || node.nativeRef?.shapeId === undefined || node.content?.mustPreserve) continue;
    // A piece of a stacked drawing is no stand-alone artwork beside the points.
    if (stacked.has(String(node.nativeRef.shapeId))) continue;
    // A background is wide and tall; a wide low banner is artwork (Fable review r11).
    if (g.width >= size.width * .85 && g.height >= size.height * .5 || overlapRatio(g, region) < .35) continue;
    // A card deck retires a wide banner (a quote callout) rather than keeping it beside cards.
    if (cardsFlow(project) && g.width >= size.width * .8 && g.height < size.height * .3) continue;
    const role = templateMediaRole(node, spec, size);
    // A template photo is no filler beside a card's points: on a content card
    // its region goes to the card and the photo retires (the user, 2026-10-31;
    // frame pages keep it).
    // A sparse card may keep it as an accent (Fable M4).
    // A certified content-slot picture follows the slot plan (Fable G2,
    // 2026-11-02): shown on a text-only card when unused or borrowed, else
    // retired; it replaces the 1-in-4 accent budget for those pictures.
    const slot = slotPictureEntry(project, index, node);
    if (slot === null) continue;
    if (slot === undefined && role === 'template_decoration' && contentCard(project, index) && g.width * g.height >= size.width * size.height * CARD_PHOTO_AREA && !photoAccentPages(project).has(index)) continue;
    if (role === 'template_icon') icons.push(node);
    else if (['template_artwork', 'template_decoration'].includes(role)) artwork.push(node);
  }
  return { artwork, icons };
}

/** Vertical strips of the canvas not covered (horizontally) by any artwork. */
function freeColumns(canvas, artwork) {
  const spans = artwork.map(n => [Math.max(canvas.x, n.geometry.x - GAP), Math.min(canvas.x + canvas.width, n.geometry.x + n.geometry.width + GAP)]).filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
  const columns = []; let cursor = canvas.x;
  for (const [start, end] of spans) { if (start - cursor >= MIN_COLUMN) columns.push({ x: cursor, width: start - cursor }); cursor = Math.max(cursor, end); }
  if (canvas.x + canvas.width - cursor >= MIN_COLUMN) columns.push({ x: cursor, width: canvas.x + canvas.width - cursor });
  return columns.map(c => ({ ...c, y: canvas.y, height: canvas.height }));
}

/** Sequential (reading-order) fill of the given columns; null if anything overflows. */
function flow(components, columns, fontSizePt) {
  const boxes=[],measurements=[];let column=0,y=columns[0]?.y;
  const units=componentReadingUnits(components);
  for(const unit of units){
    let placed=false;
    while(column<columns.length){
      const c=columns[column];let cursor=y;const pending=[];
      for(const i of unit){
        const box={x:Math.round(c.x),y:Math.round(cursor),width:Math.round(c.width),height:c.height};
        // A component with a measured width (a formula) keeps it, as in fitComponents:
        // LibreOffice stretches math to a wider frame (live fz-r26 p8 beside the kept photo).
        const m=measureComponent(components[i],box,fontSizePt);box.height=m.height;if(m.width)box.width=Math.min(box.width,m.width);
        pending.push({i,box,m});cursor+=m.height+GAP;
      }
      if(cursor-GAP<=c.y+c.height&&pending.every(({m})=>!m.width||m.width<=c.width)){
        for(const {i,box,m} of pending){boxes[i]=box;measurements[i]=m;}y=cursor;placed=true;break;
      }
      column++;y=columns[column]?.y;
    }
    if(!placed)return null;
  }
  return {boxes,measurements,usedHeight:Math.max(...boxes.map(b=>b.y+b.height))-columns[0].y};
}
export function componentReadingUnits(components){
  const units=[];for(let i=0;i<components.length;i++){
    const unit=[i],key=components[i].readingUnitId||components[i].pairId;
    while(key&&(components[i+1]?.readingUnitId||components[i+1]?.pairId)===key)unit.push(++i);
    units.push(unit);
  }return units;
}

/** Keep an existing card composition when complete reading units fit its
 * actual native body slots. Slot labels remain source-owned, never old copy. */
export function nativeCardFit(project,index,components,baseFit){
  if(!baseFit?.capacity_ok||components.some(item=>!['text','list'].includes(item.type)))return null;
  const spec=project.templateFidelity?.slides?.[index];
  const cards=(spec?.nodes||[]).filter(node=>node.type==='text'&&spec.slots?.some(slot=>slot.shapeId===node.nativeRef?.shapeId&&slot.role==='content'&&slot.purpose==='point-description'))
    .sort((a,b)=>a.geometry.y-b.geometry.y||a.geometry.x-b.geometry.x);
  const groups=componentReadingUnits(components);
  if(cards.length<2||!groups.length||groups.length>cards.length)return null;
  const boxes=[],measurements=[],bindings=[];
  for(const [k,group]of groups.entries()){
    const g=cards[k].geometry,c=baseFit.canvas;
    if(!g||g.x<c.x||g.y<c.y||g.x+g.width>c.x+c.width||g.y+g.height>c.y+c.height)return null;
    let y=g.y;
    for(const position of group){
      const box={x:g.x,y,width:g.width,height:g.height},measurement=measureComponent(components[position],box,baseFit.fontSizePt);
      if(y+measurement.height>g.y+g.height||measurement.width&&measurement.width>g.width)return null;
      boxes[position]={...box,height:measurement.height};measurements[position]=measurement;y+=measurement.height+GAP;
    }
    bindings.push({slotShapeId:cards[k].nativeRef.shapeId,componentIndexes:group});
  }
  return {...baseFit,layoutId:'native-source-cards',boxes,measurements,readingOrder:true,capacity_ok:true,predictedOverflow:0,cardBindings:bindings,
    keptMediaShapeIds:(spec.nodes||[]).filter(node=>node.type==='image'||nativeComponentSpecs(spec,project.templateFidelity).some(c=>c.nativeMembers.some(m=>m.shapeId===node.nativeRef?.shapeId))).map(node=>node.nativeRef?.shapeId).filter(id=>id!==undefined)};
}

/** Variable native card family. Every complete unit is measured before any
 * placement is accepted; a failed family falls back to the original fit. */
export function variableNativeCardFit(project,index,components,baseFit,{cardOnly=false}={}){
  if(!baseFit?.capacity_ok||components.some(c=>!['text','list'].includes(c.type)))return null;
  // Do not detach a white glyph from an unclassified photographic carrier
  // and place it on a light page. Keep that original artwork eligible for the
  // measured media rail; only complete, readable components may be repeated.
  const spec=project.templateFidelity?.slides?.[index],background=spec?.background||project.templateSpec?.palette?.background||'#ffffff',prototypes=nativeComponentSpecs(spec,project.templateFidelity).filter(p=>componentReflowReadable(p,background));
  const units=componentReadingUnits(components),n=units.length;
  // Introductions/translations and a closing explanation are prose bands,
  // not additional role/checklist points. Keep them in source order around
  // the contiguous point group, measured independently at the same font.
  const pointUnits=units.flatMap((unit,u)=>unit.some(i=>components[i].itemFragment)?[u]:[]);
  if(!cardOnly&&pointUnits.length>=2&&pointUnits.length<n&&pointUnits.at(-1)-pointUnits[0]+1===pointUnits.length){
    const first=pointUnits[0],last=pointUnits.at(-1),cardIndexes=units.slice(first,last+1).flat(),prefixIndexes=units.slice(0,first).flat(),suffixIndexes=units.slice(last+1).flat(),canvas=baseFit.canvas;
    const band=ids=>ids.length?fitComponents(ids.map(i=>components[i]),project,index,{canvas,fontSizePt:baseFit.fontSizePt,boundedTypography:Boolean(baseFit.fontAdaptation)}):{capacity_ok:true,usedHeight:0,boxes:[],measurements:[]};
    const prefix=band(prefixIndexes),suffix=band(suffixIndexes),before=prefix.usedHeight+(prefixIndexes.length?GAP:0),after=suffix.usedHeight+(suffixIndexes.length?GAP:0);
    if(prefix.capacity_ok&&suffix.capacity_ok&&before+after<canvas.height){
      const area={...canvas,y:canvas.y+before,height:canvas.height-before-after},points=cardIndexes.map(i=>components[i]),measured=fitComponents(points,project,index,{canvas:area,fontSizePt:baseFit.fontSizePt,boundedTypography:Boolean(baseFit.fontAdaptation)});
      const cards=variableNativeCardFit(project,index,points,measured,{cardOnly:true});
      if(cards){
        const boxes=[],measurements=[];prefixIndexes.forEach((i,j)=>{boxes[i]=prefix.boxes[j];measurements[i]=prefix.measurements[j];});
        cardIndexes.forEach((i,j)=>{boxes[i]=cards.boxes[j];measurements[i]=cards.measurements[j];});
        suffixIndexes.forEach((i,j)=>{boxes[i]={...suffix.boxes[j],y:suffix.boxes[j].y+before+cards.usedHeight+(suffixIndexes.length?GAP:0)};measurements[i]=suffix.measurements[j];});
        for(const member of cards.componentInstances)member.templateComponentBinding.unitIndex+=first;
        return {...cards,canvas,boxes,measurements,readingUnits:units,panelColors:units.map((_,u)=>u>=first&&u<=last?cards.panelColors?.[u-first]||null:null),usedHeight:before+cards.usedHeight+after,semanticPointCount:pointUnits.length,proseBandCount:Number(prefixIndexes.length>0)+Number(suffixIndexes.length>0),layoutId:cards.layoutId+'-prose-bands'};
      }
    }
  }
  if(!prototypes.length||n<1||n>8)return null;
  // Only repeated item compositions are safe to rebind; lone brand/media
  // objects are not inferred as generic icons.
  if(prototypes.length<2)return null;
  const rasterPanel=prototypes.every(p=>p.family==='card-panel'),nativeCard=prototypes.every(p=>p.family==='native-card'),panelFamily=rasterPanel||nativeCard;
  const canvas=baseFit.canvas,gap=GAP,slideId=project.deck?.slides?.[index]?.id||project.outline?.[index]?.id||`slide_${index}`;
  const columns=[...new Set([n===1?1:n<=4?2:n<=6?3:4,1,2,3,4])].filter(c=>c<=n);
  for(const cols of columns){
    const width=(canvas.width-gap*(cols-1))/cols,boxes=[],measurements=[],rows=[],instances=[],usedIds=new Set();let y=canvas.y,failed=false;
    for(let start=0;start<n;start+=cols){
      const row=[];let height=0;
      for(let u=start;u<Math.min(n,start+cols);u++){
        const prototype=prototypes[u%prototypes.length],a=prototype.sourceAnchor;
        const graphicMembers=prototype.members.filter(n=>!nativeCard||n.id!==prototype.layoutFrameNodeId);
        const extent={left:Math.min(...graphicMembers.map(n=>n.geometry.x)),top:Math.min(...graphicMembers.map(n=>n.geometry.y)),right:Math.max(...graphicMembers.map(n=>n.geometry.x+n.geometry.width)),bottom:Math.max(...graphicMembers.map(n=>n.geometry.y+n.geometry.height))};
        const ew=extent.right-extent.left,eh=extent.bottom-extent.top,largeCarrier=Math.max(ew,eh)>Math.max(a.width,a.height)*1.5;
        const scale=Math.min(1,(largeCarrier?Math.min(EMU_INCH*3,width*.35):Math.min(EMU_INCH*.7,width*.22))/Math.max(ew,eh)),iw=a.width*scale,ih=a.height*scale,wholeWidth=ew*scale,wholeHeight=eh*scale;
        if(!panelFamily&&Math.min(iw,ih)<Math.min(Math.min(a.width,a.height),EMU_INCH*.14)){failed=true;break;}
        const gutter=rasterPanel?gap:wholeWidth+gap+(nativeCard?gap:0),textWidth=width-gutter-(panelFamily?gap:0);if(textWidth<EMU_INCH*1.25){failed=true;break;}
        let cursor=y+(panelFamily?gap:0);const placements=[];
        for(const i of units[u]){
          const box={x:Math.round(canvas.x+(u-start)*(width+gap)+gutter),y:Math.round(cursor),width:Math.round(textWidth),height:canvas.height};
          const m=measureComponent(components[i],box,baseFit.fontSizePt);if(m.width&&m.width>textWidth){failed=true;break;}
          box.height=m.height;placements.push({i,box,m});cursor+=m.height+gap;
        }
        height=Math.max(height,cursor-y-gap+(panelFamily?gap:0),wholeHeight);row.push({u,prototype,placements,icon:{x:Math.round(canvas.x+(u-start)*(width+gap)+(nativeCard?gap:0)+(a.x-extent.left)*scale),y:Math.round(y+(a.y-extent.top)*scale),width:Math.round(iw),height:Math.round(ih)}});
      }
      if(failed||y+height>canvas.y+canvas.height){failed=true;break;}
      for(const item of row){if(rasterPanel)item.icon={x:Math.round(canvas.x+(item.u-start)*(width+gap)),y:Math.round(y),width:Math.round(width),height:Math.round(height)};for(const {i,box,m}of item.placements){boxes[i]=box;measurements[i]=m;}instances.push(...componentInstance(item.prototype,slideId,item.u,item.icon,usedIds,nativeCard?{frameGeometry:{x:Math.round(canvas.x+(item.u-start)*(width+gap)),y:Math.round(y),width:Math.round(width),height:Math.round(height)}}:{}));}
      rows.push({y,height,unitIndexes:row.map(x=>x.u)});y+=height+gap;
    }
    if(!failed&&boxes.filter(Boolean).length===components.length)return {...baseFit,layoutId:`native-unit-grid-${cols}`,columns:cols,readingOrder:true,atomicReadingUnits:true,
      boxes,measurements,usedHeight:y-gap-canvas.y,predictedOverflow:0,capacity_ok:true,readingUnits:units,componentInstances:instances,panelFamily,panelColors:panelFamily?units.map((_,u)=>prototypes[u%prototypes.length].panelColor):null,
      keptMediaShapeIds:instances.filter(n=>n.nativeRef.cloneFromShapeId===undefined).map(n=>n.nativeRef.shapeId),gridRows:rows};
  }return null;
}
/** MD-P1-5: scale only optional artwork, preserving the same image bytes and
 * aspect ratio. A measured rail never changes source copy or its font floor. */
/** Artwork kept where the template put it (Fable media decision S2, mlq-r25:
 * the photo at the bottom right of T5 retired because only full-height columns
 * beside it were tried). The points take the full-width band above or below
 * it (at least 40% of the canvas), else run from that band into the column
 * beside it; fonts and components never change. */
function reservedArtworkFit(project,index,components,baseFit,artwork){
  const c=baseFit.canvas,top=Math.min(...artwork.map(n=>n.geometry.y))-GAP,bottom=Math.max(...artwork.map(n=>n.geometry.y+n.geometry.height))+GAP;
  const left=Math.min(...artwork.map(n=>n.geometry.x))-GAP,right=Math.max(...artwork.map(n=>n.geometry.x+n.geometry.width))+GAP;
  const kept={keptMediaShapeIds:artwork.map(n=>n.nativeRef.shapeId),layoutId:'media-preserving-reserved',readingOrder:true};
  const above={...c,height:Math.max(0,top-c.y)},below={...c,y:bottom,height:Math.max(0,c.y+c.height-bottom)};
  for(const band of [above,below].filter(b=>b.height>=c.height*.4).sort((a,b)=>b.height-a.height)){
    const fit=fitComponents(components,project,index,{canvas:band,fontSizePt:baseFit.fontSizePt,boundedTypography:Boolean(baseFit.fontAdaptation),readingOrder:true});
    if(fit.capacity_ok)return {...fit,...kept,canvas:c,availableHeight:c.height,usedHeight:Math.max(...fit.boxes.map(b=>b.y+b.height))-c.y};
  }
  // An L: the band above, then the column beside the artwork down to the canvas bottom.
  const side=[{x:c.x,width:left-c.x},{x:right,width:c.x+c.width-right}].filter(col=>col.width>=MIN_COLUMN).sort((a,b)=>b.width-a.width)[0];
  if(!side||above.height<EMU_INCH*.5)return null;
  const placed=flow(components,[above,{...side,y:top+GAP,height:c.y+c.height-top-GAP}],baseFit.fontSizePt);
  return placed?{...baseFit,...placed,...kept,predictedOverflow:0,capacity_ok:true,columns:2}:null;
}
function scaledArtworkFit(project,index,components,baseFit,artwork){
  const canvas=baseFit.canvas,cellHeight=(canvas.height-GAP*(artwork.length-1))/artwork.length;
  const original=contentCanvas(project,index).geometry;
  if(canvas.x<original.x||canvas.y<original.y||canvas.x+canvas.width>original.x+original.width||canvas.y+canvas.height>original.y+original.height)return null;
  // A card deck's rail is at least 2 in wide and 1.5 in tall at 40% scale or
  // more; a smaller photo reads as debris and retires (Fable review r11, fz p13).
  const cards=cardsFlow(project);
  for(const inches of cards?[2,2.4]:[1.3,1.7,2,2.4]){
    const railWidth=inches*EMU_INCH;
    if(canvas.width-railWidth-GAP<canvas.width*.6)continue;
    const moved=artwork.map((node,i)=>{
      const g=node.geometry,scale=Math.min(1,railWidth/g.width,cellHeight/g.height),width=Math.round(g.width*scale),height=Math.round(g.height*scale);
      return {shapeId:node.nativeRef.shapeId,originalGeometry:{...g},geometry:{x:Math.round(canvas.x+canvas.width-railWidth+(railWidth-width)/2),y:Math.round(canvas.y+i*(cellHeight+GAP)+(cellHeight-height)/2),width,height},scale};
    });
    if(moved.some(item=>Math.min(item.geometry.width,item.geometry.height)<EMU_INCH*.65))continue;
    if(cards&&moved.some(item=>item.geometry.width<EMU_INCH*2||item.geometry.height<EMU_INCH*1.5||item.scale<.4))continue;
    const fit=fitComponents(components,project,index,{canvas:{...canvas,width:canvas.width-railWidth-GAP},fontSizePt:baseFit.fontSizePt,boundedTypography:Boolean(baseFit.fontAdaptation),readingOrder:true});
    if(fit.capacity_ok)return {...fit,canvas:baseFit.canvas,layoutId:'media-preserving-scaled-rail',keptMediaShapeIds:moved.map(item=>item.shapeId),mediaAdaptations:moved};
  }
  return null;
}

/** A fit that keeps the region's artwork, or null when it cannot. */
export function mediaPreservingFit(project, index, components, baseFit, {icons:keepIcons=!cardsFlow(project)}={}) {
  // A card deck never keeps or re-anchors template card icons: they carry no
  // meaning for the card's content (Fable, live fz-r10 slides 3/5/10: icon
  // badges kept in a band pushed the table to the bottom, others floated).
  // Brand artwork may still stay as a rail or column.
  if(!keepIcons)return artworkPreservingFit(project,index,components,baseFit);
  // A real card collection owns one component per reading unit. Keeping four
  // untouched icons beside six units loses that relationship; try measured
  // editable card reuse before a purely decorative original-media rail.
  if(componentReadingUnits(components).length>=3){const mapped=variableNativeCardFit(project,index,components,baseFit);if(mapped)return mapped;}
  // A short source message need not consume the whole native card row and
  // retire its remaining icons. First try the unchanged original illustrations
  // as reserved regions. No additional source point or equivalence is claimed.
  if(baseFit?.capacity_ok&&!components.some(c=>c.type==='image')) {
    const {artwork,icons}=regionArtwork(project,index,baseFit.canvas);
    if(icons.length){
      const spec=project.templateFidelity.slides[index];
      const carriers=icons.flatMap(icon=>{const g=icon.geometry;return (spec.nodes||[]).filter(n=>n.type==='shape'&&n.geometry&&n.nativeRef?.shapeId!==undefined&&n.geometry.width<EMU_INCH*1.5&&n.geometry.height<EMU_INCH*1.5&&n.geometry.x<=g.x&&n.geometry.y<=g.y&&n.geometry.x+n.geometry.width>=g.x+g.width&&n.geometry.y+n.geometry.height>=g.y+g.height).sort((a,b)=>a.geometry.width*a.geometry.height-b.geometry.width*b.geometry.height).slice(0,1);});
      const reserved=[...artwork,...icons,...carriers],columns=freeColumns(baseFit.canvas,reserved);
      const c=baseFit.canvas,top=Math.min(...reserved.map(n=>n.geometry.y))-GAP,bottom=Math.max(...reserved.map(n=>n.geometry.y+n.geometry.height))+GAP;
      // A horizontal icon row blocks only that row, not the whole height of
      // every column. Try complete source content above/below it first.
      const bands=[{...c,height:top-c.y},{...c,y:bottom,height:c.y+c.height-bottom}].filter(b=>b.height>0).sort((a,b)=>b.height-a.height);
      for(const band of bands){
        const fit=fitComponents(components,project,index,{canvas:band,fontSizePt:baseFit.fontSizePt,boundedTypography:Boolean(baseFit.fontAdaptation),readingOrder:true});
        if(fit.capacity_ok)return {...fit,canvas:c,availableHeight:c.height,usedHeight:Math.max(...fit.boxes.map(b=>b.y+b.height))-c.y,layoutId:'media-preserving-original-band',reservedMediaRegion:{top:top+GAP,bottom:bottom-GAP},keptMediaShapeIds:[...new Set(reserved.map(n=>n.nativeRef.shapeId))]};
      }
      const placed=columns.length&&flow(components,columns,baseFit.fontSizePt);
      if(placed){
        return {...baseFit,layoutId:'media-preserving-original-regions',columns:columns.length,readingOrder:true,...placed,predictedOverflow:0,capacity_ok:true,keptMediaShapeIds:[...new Set([...reserved,...carriers].map(n=>n.nativeRef.shapeId))]};
      }
    }
  }
  const variable=variableNativeCardFit(project,index,components,baseFit);if(variable)return variable;
  const cards=nativeCardFit(project,index,components,baseFit);if(cards)return cards;
  return artworkPreservingFit(project,index,components,baseFit);
}
/** The template's brand artwork kept beside the source content: the largest
 * retained subset as free columns, else a scaled rail (fonts, source
 * components and page count never change); null when none fits. */
export function artworkPreservingFit(project, index, components, baseFit) {
  // Tables use the same complete-cell/unchanged-font measurement as other
  // source components. Their presence alone is not grounds to retire artwork.
  // A measured column placement may fit even when the initial stack does not.
  // Every complete reading unit is measured again by flow at the same font.
  if (!baseFit?.canvas || !Number.isFinite(baseFit.fontSizePt) || components.some(c => c.type === 'image')) return null;
  const { artwork } = regionArtwork(project, index, baseFit.canvas);
  if (!artwork.length) return null;
  // Try the largest retained subset first. A failed four-card placement must
  // not retire all four when one or two leave enough measured text capacity.
  // Bound the search; fonts, source components and page count never change.
  // A repeated set is one unit: subsets keep or retire it whole.
  const units=artworkSets(artwork,project.templateFidelity).flatMap(set=>set.length>1?[set]:set.map(node=>[node]));
  const candidates=[artwork];
  const choose=(start,count,items=[])=>{
    if(candidates.length>=256)return;
    if(!count){candidates.push(items.flat());return;}
    for(let i=start;i<=units.length-count;i++)choose(i+1,count-1,[...items,units[i]]);
  };
  for(let count=units.length-1;count>0&&candidates.length<256;count--)choose(0,count);
  for(const retained of candidates){
    const columns = freeColumns(baseFit.canvas, retained);
    if(columns.length&&columns.reduce((n,c)=>n+c.width,0)>=baseFit.canvas.width*.45){
      const placed=flow(components,columns,baseFit.fontSizePt);
      if(placed)return {...baseFit,layoutId:'media-preserving-columns',columns:columns.length,readingOrder:true,...placed,predictedOverflow:0,capacity_ok:true,keptMediaShapeIds:retained.map(n=>n.nativeRef.shapeId)};
    }
    const reserved=reservedArtworkFit(project,index,components,baseFit,retained);
    if(reserved)return reserved;
    const scaled=scaledArtworkFit(project,index,components,baseFit,retained);
    if(scaled)return scaled;
  }
  return null;
}

/** Re-anchor card-set icons: narrow the first text boxes by a gutter and put
 * one icon at the top-left of each; the boxes of a column are restacked and
 * must still end inside the canvas. Returns {fit, icons} or null. */
export function anchorCardIcons(project, index, components, fit, isCardIcon) {
  const { icons } = regionArtwork(project, index, fit?.canvas);
  const spec = project.templateFidelity?.slides?.[index];
  const background=spec?.background||project.templateSpec?.palette?.background||'#ffffff';
  const cards = icons.filter(icon => isCardIcon(icon, spec)).sort((a, b) => a.geometry.y - b.geometry.y || a.geometry.x - b.geometry.x);
  if (!fit?.capacity_ok || !cards.length) return null;
  const badges=cards.map(card=>{
    const g=card.geometry;
    const carrier=(spec.nodes||[]).filter(n=>n.type==='shape'&&n.geometry&&n.nativeRef?.shapeId!==undefined&&(n.zIndex||0)<(card.zIndex||0)&&n.geometry.width<EMU_INCH*1.5&&n.geometry.height<EMU_INCH*1.5&&n.geometry.x<=g.x&&n.geometry.y<=g.y&&n.geometry.x+n.geometry.width>=g.x+g.width&&n.geometry.y+n.geometry.height>=g.y+g.height).sort((a,b)=>a.geometry.width*a.geometry.height-b.geometry.width*b.geometry.height)[0];
    const scale=carrier?Math.min(1,.34*EMU_INCH/Math.max(carrier.geometry.width,carrier.geometry.height)):1;
    return {card,carrier,scale,width:(carrier||card).geometry.width*scale,height:(carrier||card).geometry.height*scale};
  }).filter(b=>componentReflowReadable({members:[b.card,...(b.carrier?[b.carrier]:[])]},background));
  if(!badges.length)return null;
  // All indexing below addresses the filtered readable family.
  cards.splice(0,cards.length,...badges.map(b=>b.card));
  const gutter=Math.max(...badges.map(b=>b.width))+GAP;
  // A complete table is one source object but has real row-level reading
  // units. Preserve the small original icons beside actual rows rather than
  // dropping every icon merely because the component is typed as a table.
  const tableIndex=components.findIndex(component=>component.type==='table'&&component.content.rows?.length>1);
  if(tableIndex>=0){
    const component=components[tableIndex],originalBox=fit.boxes[tableIndex];
    const below=fit.boxes.map((box,i)=>({box,i})).filter(({box,i})=>i!==tableIndex&&Math.abs(box.x-originalBox.x)<EMU_INCH*.03&&box.y>=originalBox.y+originalBox.height-EMU_INCH*.02);
    const reserved=below.length?Math.max(...below.map(({box})=>box.y+box.height))-originalBox.y-originalBox.height:0;
    const badgeGutter=Math.max(...badges.map(b=>b.width))+GAP;
    const box={...originalBox,x:originalBox.x+badgeGutter,width:originalBox.width-badgeGutter,height:fit.canvas.y+fit.canvas.height-originalBox.y-reserved};
    const measurement=measureComponent(component,box,fit.fontSizePt);
    if(measurement.height>box.height||!measurement.rowWeights)return null;
    const placed=[],rows=component.content.rows;let y=box.y+measurement.rowWeights[0]/72*EMU_INCH;
    for(let row=1;row<rows.length&&placed.length<cards.length;row++){
      const height=measurement.rowWeights[row]/72*EMU_INCH,badge=badges[placed.length],{card,carrier,scale}=badge;
      if(height>=badge.height){
        const origin=(carrier||card).geometry,left=originalBox.x,top=y+(height-badge.height)/2;
        const transform=g=>({x:Math.round(left+(g.x-origin.x)*scale),y:Math.round(top+(g.y-origin.y)*scale),width:Math.round(g.width*scale),height:Math.round(g.height*scale)});
        placed.push({node:card,shapeId:card.nativeRef.shapeId,geometry:transform(card.geometry),rowBinding:{sourceUnitId:component.sourceUnitId,sourceRowIndex:row,label:rows[row][0]},...(carrier?{carriers:[{shapeId:carrier.nativeRef.shapeId,geometry:transform(carrier.geometry)}],badgeScale:scale}:{})});
      }
      y+=height;
    }
    if(!placed.length)return null;
    const finalBox={...box,height:measurement.height};
    const boxes=fit.boxes.map(g=>({...g})),measurements=[...fit.measurements];boxes[tableIndex]=finalBox;measurements[tableIndex]=measurement;
    for(const {i}of below)boxes[i].y+=measurement.height-originalBox.height;
    return {fit:{...fit,boxes,measurements,usedHeight:Math.max(...boxes.map(g=>g.y+g.height))-fit.canvas.y,iconGutter:badgeGutter,anchoredIconShapeIds:placed.map(i=>i.shapeId),tableRowIconBindings:placed.map(i=>({shapeId:i.shapeId,...i.rowBinding}))},icons:placed};
  }
  const order = fit.boxes.map((box, i) => ({ box, i })).sort((a, b) => a.box.x - b.box.x || a.box.y - b.box.y).map(v => v.i);
  const anchored = order.slice(0, cards.length).filter(i => components[i]?.type !== 'table');
  if (!anchored.length) return null;
  const boxes = fit.boxes.map(b => ({ ...b })), measurements = [...fit.measurements];
  for (const i of anchored) {
    const box = { ...boxes[i], x: boxes[i].x + gutter, width: boxes[i].width - gutter };
    const m = measureComponent(components[i], box, fit.fontSizePt);
    if (m.width && m.width > box.width) return null;
    boxes[i] = { ...box, height: Math.max(m.height,badges[anchored.indexOf(i)].height) }; measurements[i] = m;
  }
  // Restack each column (same x before narrowing) keeping the original order.
  const columns = new Map();
  // A bilingual row may contain a full-width unpaired block. Restacking
  // solely by x lets the next right-hand cell climb over that block.
  const byRow = fit.layoutId === 'bilingual-rows-source';
  fit.boxes.forEach((b, i) => { const key = byRow ? b.y : b.x; if (!columns.has(key)) columns.set(key, []); columns.get(key).push(i); });
  const bottom = fit.canvas.y + fit.canvas.height;
  // Use the same measured inter-item gap as the source fit. Bibliographies
  // have a compact item gap; restoring the normal block gap here used to
  // overflow a previously fitting reference list and retire all its icons.
  const itemGap = Number.isFinite(fit.itemGap) ? fit.itemGap : GAP;
  if (byRow) {
    let y = fit.canvas.y;
    for (const [, members] of [...columns.entries()].sort((a,b)=>a[0]-b[0])) {
      for (const i of members) boxes[i].y = Math.round(y);
      y += Math.max(...members.map(i=>boxes[i].height)) + itemGap;
    }
    if (y - itemGap > bottom) return null;
  }
  for (const members of byRow ? [] : columns.values()) {
    members.sort((a, b) => fit.boxes[a].y - fit.boxes[b].y);
    let y = fit.boxes[members[0]].y;
    for (const i of members) { boxes[i].y = Math.round(y); y += boxes[i].height + itemGap; }
    if (y - itemGap > bottom) return null;
  }
  const placedIcons=anchored.map((boxIndex,k)=>{
    const {card,carrier,scale}=badges[k],origin=(carrier||card).geometry,left=boxes[boxIndex].x-gutter,top=boxes[boxIndex].y;
    const transform=g=>({x:Math.round(left+(g.x-origin.x)*scale),y:Math.round(top+(g.y-origin.y)*scale),width:Math.round(g.width*scale),height:Math.round(g.height*scale)});
    return {node:card,shapeId:card.nativeRef.shapeId,geometry:transform(card.geometry),...(carrier?{carriers:[{shapeId:carrier.nativeRef.shapeId,geometry:transform(carrier.geometry)}],badgeScale:scale}:{})};
  });
  return { fit: { ...fit, boxes, measurements, iconGutter: gutter, anchoredIconShapeIds: placedIcons.map(i => i.shapeId) }, icons: placedIcons };
}

/** Do not turn free space into extra factual components. Actual point-bound
 * native instances are created by variableNativeCardFit; the source-region
 * adapter records retirement of spare foreground assets with hashes/reasons.
 * Background artwork and protected evidence remain handled independently. */
export function supplementaryNativeMedia(project,index,fit){
 return fit;
}
