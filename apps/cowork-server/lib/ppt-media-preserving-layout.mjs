/** Media-preserving placement of source-owned components (MD-P0-1, MD-P1-4).
 * Before a rebuilt source region retires the template's card artwork, try to
 * flow the same components, at the same font size and in reading order, into
 * the vertical strips the artwork leaves free; and re-anchor card-set icons in
 * a gutter beside the first text boxes instead of retiring them. Nothing is
 * shortened or shrunk: either everything fits or the caller keeps its fit. */
import { measureComponent,fitComponents,contentCanvas } from './ppt-density-capacity.mjs';
import {nativeComponentSpecs,componentInstance} from './ppt-native-components.mjs';
import { templateMediaRole } from './ppt-template-fidelity.mjs';

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
/** Template images on this page that a full region rebuild would retire. */
export function regionArtwork(project, index, canvas) {
  const spec = project.templateFidelity?.slides?.[index], size = project.templateFidelity;
  if (!spec || !canvas || !size) return { artwork: [], icons: [] };
  const artwork = [], icons = [], region = sourceRegion(project, index, canvas);
  for (const node of spec.nodes || []) {
    const g = node.geometry;
    if (node.type !== 'image' || !g || node.nativeRef?.shapeId === undefined || node.content?.mustPreserve) continue;
    if (g.width >= size.width * .85 || overlapRatio(g, region) < .35) continue;
    const role = templateMediaRole(node, spec, size);
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
        const m=measureComponent(components[i],box,fontSizePt);box.height=m.height;
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
  const spec=project.templateFidelity?.slides?.[index],prototypes=nativeComponentSpecs(spec,project.templateFidelity);
  const units=componentReadingUnits(components),n=units.length;
  // Introductions/translations and a closing explanation are prose bands,
  // not additional role/checklist points. Keep them in source order around
  // the contiguous point group, measured independently at the same font.
  const pointUnits=units.flatMap((unit,u)=>unit.some(i=>components[i].itemFragment)?[u]:[]);
  if(!cardOnly&&pointUnits.length>=2&&pointUnits.length<n&&pointUnits.at(-1)-pointUnits[0]+1===pointUnits.length){
    const first=pointUnits[0],last=pointUnits.at(-1),cardIndexes=units.slice(first,last+1).flat(),prefixIndexes=units.slice(0,first).flat(),suffixIndexes=units.slice(last+1).flat(),canvas=baseFit.canvas;
    const band=ids=>ids.length?fitComponents(ids.map(i=>components[i]),project,index,{canvas,fontSizePt:baseFit.fontSizePt}):{capacity_ok:true,usedHeight:0,boxes:[],measurements:[]};
    const prefix=band(prefixIndexes),suffix=band(suffixIndexes),before=prefix.usedHeight+(prefixIndexes.length?GAP:0),after=suffix.usedHeight+(suffixIndexes.length?GAP:0);
    if(prefix.capacity_ok&&suffix.capacity_ok&&before+after<canvas.height){
      const area={...canvas,y:canvas.y+before,height:canvas.height-before-after},points=cardIndexes.map(i=>components[i]),measured=fitComponents(points,project,index,{canvas:area,fontSizePt:baseFit.fontSizePt});
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
function scaledArtworkFit(project,index,components,baseFit,artwork){
  const canvas=baseFit.canvas,cellHeight=(canvas.height-GAP*(artwork.length-1))/artwork.length;
  const original=contentCanvas(project,index).geometry;
  if(canvas.x<original.x||canvas.y<original.y||canvas.x+canvas.width>original.x+original.width||canvas.y+canvas.height>original.y+original.height)return null;
  for(const inches of [1.3,1.7,2,2.4]){
    const railWidth=inches*EMU_INCH;
    if(canvas.width-railWidth-GAP<canvas.width*.6)continue;
    const moved=artwork.map((node,i)=>{
      const g=node.geometry,scale=Math.min(1,railWidth/g.width,cellHeight/g.height),width=Math.round(g.width*scale),height=Math.round(g.height*scale);
      return {shapeId:node.nativeRef.shapeId,originalGeometry:{...g},geometry:{x:Math.round(canvas.x+canvas.width-railWidth+(railWidth-width)/2),y:Math.round(canvas.y+i*(cellHeight+GAP)+(cellHeight-height)/2),width,height},scale};
    });
    if(moved.some(item=>Math.min(item.geometry.width,item.geometry.height)<EMU_INCH*.65))continue;
    const fit=fitComponents(components,project,index,{canvas:{...canvas,width:canvas.width-railWidth-GAP},fontSizePt:baseFit.fontSizePt,readingOrder:true});
    if(fit.capacity_ok)return {...fit,canvas:baseFit.canvas,layoutId:'media-preserving-scaled-rail',keptMediaShapeIds:moved.map(item=>item.shapeId),mediaAdaptations:moved};
  }
  return null;
}

/** A fit that keeps the region's artwork, or null when it cannot. */
export function mediaPreservingFit(project, index, components, baseFit) {
  const variable=variableNativeCardFit(project,index,components,baseFit);if(variable)return variable;
  const cards=nativeCardFit(project,index,components,baseFit);if(cards)return cards;
  // Tables use the same complete-cell/unchanged-font measurement as other
  // source components. Their presence alone is not grounds to retire artwork.
  if (!baseFit?.capacity_ok || components.some(c => c.type === 'image')) return null;
  const { artwork } = regionArtwork(project, index, baseFit.canvas);
  if (!artwork.length) return null;
  // Try the largest retained subset first. A failed four-card placement must
  // not retire all four when one or two leave enough measured text capacity.
  // Bound the search; fonts, source components and page count never change.
  const candidates=[artwork];
  const choose=(start,count,items=[])=>{
    if(candidates.length>=256)return;
    if(!count){candidates.push(items);return;}
    for(let i=start;i<=artwork.length-count;i++)choose(i+1,count-1,[...items,artwork[i]]);
  };
  for(let count=artwork.length-1;count>0&&candidates.length<256;count--)choose(0,count);
  for(const retained of candidates){
    const columns = freeColumns(baseFit.canvas, retained);
    if(columns.length&&columns.reduce((n,c)=>n+c.width,0)>=baseFit.canvas.width*.45){
      const placed=flow(components,columns,baseFit.fontSizePt);
      if(placed)return {...baseFit,layoutId:'media-preserving-columns',columns:columns.length,readingOrder:true,...placed,predictedOverflow:0,capacity_ok:true,keptMediaShapeIds:retained.map(n=>n.nativeRef.shapeId)};
    }
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
  const cards = icons.filter(icon => isCardIcon(icon, spec)).sort((a, b) => a.geometry.y - b.geometry.y || a.geometry.x - b.geometry.x);
  if (!fit?.capacity_ok || !cards.length) return null;
  const size = Math.max(...cards.map(i => Math.max(i.geometry.width, i.geometry.height))), gutter = size + GAP;
  // A complete table is one source object but has real row-level reading
  // units. Preserve the small original icons beside actual rows rather than
  // dropping every icon merely because the component is typed as a table.
  if(components.length===1&&components[0].type==='table'&&components[0].content.rows?.length>1){
    const box={...fit.boxes[0],x:fit.boxes[0].x+gutter,width:fit.boxes[0].width-gutter,height:fit.canvas.y+fit.canvas.height-fit.boxes[0].y};
    const measurement=measureComponent(components[0],box,fit.fontSizePt);
    if(measurement.height>box.height||!measurement.rowWeights)return null;
    const placed=[],rows=components[0].content.rows;let y=box.y+measurement.rowWeights[0]/72*EMU_INCH;
    for(let row=1;row<rows.length&&placed.length<cards.length;row++){
      const height=measurement.rowWeights[row]/72*EMU_INCH,card=cards[placed.length];
      if(height>=card.geometry.height){placed.push({node:card,shapeId:card.nativeRef.shapeId,geometry:{x:fit.boxes[0].x,y:Math.round(y+(height-card.geometry.height)/2),width:card.geometry.width,height:card.geometry.height},rowBinding:{sourceUnitId:components[0].sourceUnitId,sourceRowIndex:row,label:rows[row][0]}});}
      y+=height;
    }
    if(!placed.length)return null;
    const finalBox={...box,height:measurement.height};
    return {fit:{...fit,boxes:[finalBox],measurements:[measurement],usedHeight:measurement.height,iconGutter:gutter,anchoredIconShapeIds:placed.map(i=>i.shapeId),tableRowIconBindings:placed.map(i=>({shapeId:i.shapeId,...i.rowBinding}))},icons:placed};
  }
  const order = fit.boxes.map((box, i) => ({ box, i })).sort((a, b) => a.box.x - b.box.x || a.box.y - b.box.y).map(v => v.i);
  const anchored = order.slice(0, cards.length).filter(i => components[i]?.type !== 'table');
  if (!anchored.length) return null;
  const boxes = fit.boxes.map(b => ({ ...b })), measurements = [...fit.measurements];
  for (const i of anchored) {
    const box = { ...boxes[i], x: boxes[i].x + gutter, width: boxes[i].width - gutter };
    const m = measureComponent(components[i], box, fit.fontSizePt);
    if (m.width && m.width > box.width) return null;
    boxes[i] = { ...box, height: m.height }; measurements[i] = m;
  }
  // Restack each column (same x before narrowing) keeping the original order.
  const columns = new Map();
  // A bilingual row may contain a full-width unpaired block. Restacking
  // solely by x lets the next right-hand cell climb over that block.
  const byRow = fit.layoutId === 'bilingual-rows-source';
  fit.boxes.forEach((b, i) => { const key = byRow ? b.y : b.x; if (!columns.has(key)) columns.set(key, []); columns.get(key).push(i); });
  const bottom = fit.canvas.y + fit.canvas.height;
  if (byRow) {
    let y = fit.canvas.y;
    for (const [, members] of [...columns.entries()].sort((a,b)=>a[0]-b[0])) {
      for (const i of members) boxes[i].y = Math.round(y);
      y += Math.max(...members.map(i=>boxes[i].height)) + GAP;
    }
    if (y - GAP > bottom) return null;
  }
  for (const members of byRow ? [] : columns.values()) {
    members.sort((a, b) => fit.boxes[a].y - fit.boxes[b].y);
    let y = fit.boxes[members[0]].y;
    for (const i of members) { boxes[i].y = Math.round(y); y += boxes[i].height + GAP; }
    if (y - GAP > bottom) return null;
  }
  const placedIcons = anchored.map((boxIndex, k) => ({ node: cards[k], shapeId: cards[k].nativeRef.shapeId,
    geometry: { x: boxes[boxIndex].x - gutter, y: boxes[boxIndex].y, width: cards[k].geometry.width, height: cards[k].geometry.height } }));
  return { fit: { ...fit, boxes, measurements, iconGutter: gutter, anchoredIconShapeIds: placedIcons.map(i => i.shapeId) }, icons: placedIcons };
}

/** Do not turn free space into extra factual components. Actual point-bound
 * native instances are created by variableNativeCardFit; the source-region
 * adapter records retirement of spare foreground assets with hashes/reasons.
 * Background artwork and protected evidence remain handled independently. */
export function supplementaryNativeMedia(project,index,fit){
 return fit;
}
