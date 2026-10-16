import {sourceReadingContinuation} from './ppt-source-continuations.mjs';
import {supportsSourceLineRanges,sourceLineRange,materializeSourceLineRange} from './ppt-source-line-ranges.mjs';
import { sourceDisplayText, sourceRichText, richTextContent } from './ppt-source-text.mjs';
import {ensureRichContent} from './ppt-rich-text.mjs';
import {readingUnits} from './ppt-semantic-relations.mjs';
import {stableId} from './ppt/ir.mjs';
import { orderedSourceSteps } from './ppt-source-boundaries.mjs';
import { templateMediaRole } from './ppt-template-fidelity.mjs';
/** Shared geometry/line estimator for page planning and source-owned rendering.
 * A fit is an analytic prediction; final Render Tree/PPTX QA remains mandatory. */
import { measureText, textContract, PT_EMU, RENDER_CONTRACT_VERSION } from './ppt/render-contract.mjs';
import { displayUnits } from './ppt-density-profile.mjs';
import { equationContent, equationDimensions } from './ppt-math.mjs';
import {chooseLayout,regionsFor,typographyFor} from './ppt-layout.mjs';
export const INCH = 914400;
export const protectedTemplateAsset = node => Boolean(node?.content?.mustPreserve || ['evidence','semanticDiagram','source','brand'].includes(node?.content?.mediaRole));
export function contentCanvas(project = {}, index = 1) {
  const fidelity = project.templateFidelity;
  const spec = fidelity?.slides?.[index];
  const validBox = box => box && ['x','y','width','height'].every(key=>Number.isFinite(box[key])) && box.width>0 && box.height>0;
  const frames = (spec?.nodes || []).filter(node => validBox(node.geometry) && spec.slots?.some(slot => slot.role === 'content' && !['footnote','group-heading'].includes(slot.purpose) && slot.shapeId === node.nativeRef?.shapeId));
  const width = Number(fidelity?.width || project.templateSpec?.width || 12192000);
  const height = Number(fidelity?.height || project.templateSpec?.height || 6858000);
  const fonts = frames.filter(node=>(node.style?.fontWeight||400)<600).map(node=>Number(node.style?.fontSizePt)).filter(pt=>Number.isFinite(pt)&&pt>0);
  const pageId=(project.outline?.[index]||project.deck?.slides?.[index])?.id;
  const fontSizePt = Math.max(14, fonts.length ? Math.min(...fonts) : 18,Number(project.sourceFontFloors?.[pageId])||0);
  let left=width*.065, right=width*.935, top=height*.25, bottom=height*.93;
  // A mapped cover reserves its centered title/eyebrow before source-owned
  // body copy is bound. The generic content canvas overlaps those headers.
  const page=project.deck?.slides?.[index]||project.outline?.[index];
  if(!spec&&page&&chooseLayout(page,index,project.pages||project.outline?.length||1)==='cover'){
    const body=regionsFor({layoutId:'cover'}).find(region=>region.id==='body');
    left=body.x*INCH;right=(body.x+body.w)*INCH;top=body.y*INCH;bottom=(body.y+body.h)*INCH;
  }
  if(!spec){
    const headerPage=page||{layoutId:'summary'};
    // Plan with the actual title ink and footer, before source pagination.
    // Render-time title growth cannot borrow space already assigned to code,
    // a table or another immutable source object.
    const layoutId=chooseLayout(headerPage,index,project.pages||project.outline?.length||project.deck?.slides?.length||3);
    const regions=regionsFor({...headerPage,layoutId}),region=regions.find(r=>r.id==='title'),footer=regions.find(r=>r.id==='footer');
    if(region){
      const node=headerPage.nodes?.find(n=>n.semanticRole==='title'),font=typographyFor({...headerPage,layoutId}).titlePt;
      const title={kind:'text',semanticRole:'title',bounds:node?.geometry||{x:region.x*INCH,y:region.y*INCH,width:region.w*INCH,height:region.h*INCH},content:node?.content||{text:headerPage.title||''},style:{fontFamily:project.templateSpec?.fonts?.title,fontSizePt:Math.round(font*(project.deck?.themeTokens?.titleScale||1)*10)/10,lineHeight:1.05,paragraphSpacingEm:0,fontWeight:700,...node?.style}};
      const contract=textContract(title),measured=measureText(title,contract);
      const inkHeight=!measured.widthOverflow&&measured.lines<=2?Math.ceil((measured.estimatedHeightPt+contract.margins[1]+contract.margins[3]+1)*PT_EMU):title.bounds.height;
      top=Math.max(top,title.bounds.y+Math.max(title.bounds.height,inkHeight)+INCH*.08);
    }
    if(footer)bottom=Math.min(bottom,footer.y*INCH-INCH*.08);
  }
  if(frames.length){
    left=Math.max(0,Math.min(...frames.map(node=>node.geometry.x)));
    right=Math.min(width,Math.max(...frames.map(node=>node.geometry.x+node.geometry.width)));
    top=Math.max(0,Math.min(...frames.map(node=>node.geometry.y)));
    bottom=Math.min(height,Math.max(...frames.map(node=>node.geometry.y+node.geometry.height)));
    // Source-owned components may use free vertical space in the content
    // region. A short legacy textbox is not a limit on a complete table/math
    // object. Keep its horizontal design and all title/footer/image zones.
    const richSource=String(project.source?.text||'').length>=8000;
    if(richSource){
      // Reserve real native title/section/footer geometry below, rather than
      // discarding the entire top quarter even when the header ends earlier.
      top=Math.min(top,height*.065);bottom=Math.max(bottom,height*.93);
    }
    const gap=INCH*.08;
    for(const node of spec.nodes||[]){
      if(!validBox(node.geometry))continue;
      const slot=spec.slots?.find(slot=>slot.shapeId===node.nativeRef?.shapeId);
      const header=['title','section'].includes(slot?.role),footer=slot?.purpose==='footnote'||node.semanticRole==='page-number';
      const g=node.geometry;
      const banner=node.type==='image' && g.width>=width*.8 && g.height<height*.3 && g.y>height*.5;
      if(!header&&!footer&&!banner)continue;
      if(g.x+g.width<=left||g.x>=right)continue;
      if(header && g.y<(top+bottom)/2) {
        // Native title boxes often intentionally allow text to extend beyond
        // their tiny shape height. Reserve the actual line plus native padding,
        // including fallback font metrics, before adding a table underneath.
        const margins=node.nativeTextFrame?.margins||[0,0,0,0];
        const linePt=Number(node.style?.fontSizePt||slot.fontSizePt||24)*1.25;
        const lineCount=Math.max(1,node.nativeTextFrame?.paragraphs?.length||1);
        const textHeight=linePt/72*INCH*lineCount+(Number(margins[1])||0)+(Number(margins[3])||0);
        const headerBottom=g.y+Math.max(g.height,textHeight);
        if(headerBottom>top-gap)top=Math.max(top,headerBottom+gap);
      }
      if((footer||banner) && g.y>top && g.y<bottom+gap)bottom=Math.min(bottom,g.y-gap);
    }
  }
  // Explicit evidence/brand assets are occupied space, not reclaimable old
  // examples. Select a rectangular free region rather than hiding the asset.
  const clearance=INCH*.08;
  for(const node of (spec?.nodes || []).filter(node=>protectedTemplateAsset(node)||node.type==='foreign'||node.type==='image'&&templateMediaRole(node,spec,fidelity)==='unknown')){
    if(!validBox(node.geometry))continue;
    const g=node.geometry;if(g.x>=right||g.x+g.width<=left||g.y>=bottom||g.y+g.height<=top)continue;
    const choices=[{l:left,r:Math.min(right,g.x-clearance),t:top,b:bottom},{l:Math.max(left,g.x+g.width+clearance),r:right,t:top,b:bottom},
      {l:left,r:right,t:top,b:Math.min(bottom,g.y-clearance)},{l:left,r:right,t:Math.max(top,g.y+g.height+clearance),b:bottom}]
      .filter(c=>c.r>c.l&&c.b>c.t).sort((a,b)=>(b.r-b.l)*(b.b-b.t)-(a.r-a.l)*(a.b-a.t));
    if(!choices.length){right=left;bottom=top;break;}
    const c=choices[0];left=c.l;right=c.r;top=c.t;bottom=c.b;
  }
  const continuation=sourceReadingContinuation(project,index);
  const continuationRect=continuation?{x:Math.round(left),y:Math.round(bottom-INCH*.42),width:Math.max(0,Math.round(right-left)),height:Math.round(INCH*.42)}:undefined;
  if(continuation)bottom-=INCH*.5;
  return { continuationRect,geometry:{x:Math.round(left),y:Math.round(top),width:Math.max(0,Math.round(right-left)),height:Math.max(0,Math.round(bottom-top))},fontSizePt,
    capacityBasis:frames.length?'native_frame_geometry':'default_canvas_before_template_parse' };
}
export function measureComponent(component, geometry, fontSizePt) {
  if(component.type==='chart')return {lines:0,height:Math.round(INCH*2.8),overflow:false};
  const horizontalPaddingPt = component.type === 'table' ? 14.4 : 7.2;
  const lineUnits = Math.max(0, geometry.width / INCH * 72 - horizontalPaddingPt) / fontSizePt * .88;
  if (!(lineUnits > 0)) return { lines: Infinity, height: Infinity, overflow: true };
  const linesOf = text => String(text || '').split('\n').reduce((n, line) => n + Math.max(1, Math.ceil(displayUnits(line) / lineUnits)), 0);
  let lines, columnWeights, rowWeights;
  if (component.type === 'table') {
    const rows = component.content.rows || [];
    if (!rows.length || !rows[0].length || rows.some(row => row.length !== rows[0].length)) throw new Error('invalid source table geometry');
    const weights=rows[0].map((_,col)=>Math.max(12,...rows.map(row=>Math.sqrt(displayUnits(row[col]))*4)));
    const wordWidths=rows[0].map((_,col)=>Math.max(0,...rows.flatMap(row=>String(row[col]).match(/[A-Za-z][A-Za-z0-9_-]*/gu)||[]).map(word=>displayUnits(word)*fontSizePt/.88+14.4)));
    const totalPt=geometry.width/INCH*72,minPt=fontSizePt*2+14.4;
    const evaluate=allocation=>{
      const sum=allocation.reduce((n,v)=>n+v,0);
      const rowHeights=rows.map((row,r)=>Math.max(...row.map((cell,col)=>{
        const e={kind:'text',content:{text:String(cell),richText:component.content.cellRich?.[r]?.[col]},style:{fontSizePt,lineHeight:1.18,paragraphSpacingEm:0},bounds:{width:geometry.width*allocation[col]/sum,height:1e12}};
        return measureText(e,textContract(e,[7.2,3,7.2,3])).estimatedHeightPt+6;
      })));
      const brokenWords=allocation.reduce((n,w,col)=>n+Math.max(0,wordWidths[col]-totalPt*w/sum),0);
      return {columnWeights:allocation,rowWeights:rowHeights,heightPt:rowHeights.reduce((sum,v)=>sum+v,0),brokenWords};
    };
    const minimum=wordWidths.map(width=>Math.max(minPt,width)),remaining=Math.max(0,totalPt-minimum.reduce((n,v)=>n+v,0));
    const strategies=[weights,rows[0].map(()=>1),minimum.map((width,col)=>width+remaining*weights[col]/weights.reduce((n,v)=>n+v,0))];
    const measured=strategies.map(evaluate).sort((a,b)=>Number(a.brokenWords>0)-Number(b.brokenWords>0)||a.heightPt-b.heightPt)[0];
    columnWeights=measured.columnWeights;rowWeights=measured.rowWeights;
    const height=Math.ceil(rowWeights.reduce((sum,v)=>sum+v,0)*PT_EMU);
    return {lines:rowWeights.reduce((sum,v)=>sum+v/(fontSizePt*1.18),0),height,lineUnits,columnWeights,rowWeights,overflow:height>geometry.height};
  } else if(component.type==='image') {
    const ratio=Math.max(.05,Number(component.content?.width||1)/Number(component.content?.height||1));
    return {lines:0,height:Math.ceil(Math.min(geometry.height*.7,geometry.width/ratio)),lineUnits,overflow:false};
  } else if (['list', 'timeline'].includes(component.type)) {
    const e={kind:component.type,bounds:{...geometry,height:1e12},content:component.content,style:{fontSizePt,lineHeight:1.18,paragraphSpacingEm:component.type==='timeline'?.15:.4}};
    const measured=measureText(e,textContract(e));
    // Actual CJK inline OMML ink exceeded the conservative frame by 1.38pt.
    // Reserve 2pt before pagination; retain the template font and all source.
    const mathInk=(component.content.items||[]).some(item=>(item.richText?.runs||[]).some(run=>run.kind==='math'))?2:0;
    return {lines:measured.lines,height:Math.ceil((measured.estimatedHeightPt+7.2+mathInk)*PT_EMU),lineUnits,overflow:(measured.estimatedHeightPt+mathInk)*PT_EMU>geometry.height};
  } else if(component.content?.mathMl) {
    const dimensions=equationDimensions(component.content,fontSizePt);
    const width=Math.ceil(dimensions.widthPt/72*INCH),height=Math.ceil(dimensions.heightPt/72*INCH);
    return {lines:dimensions.heightPt/fontSizePt,width,height,lineUnits,overflow:width>geometry.width||height>geometry.height};
  } else {
    const e={kind:'text',bounds:{...geometry,height:1e12},content:component.content,style:{fontSizePt,lineHeight:1.18}};
    const measured=measureText(e,textContract(e));
    return {lines:measured.lines,height:Math.ceil((measured.estimatedHeightPt+7.2)*PT_EMU),lineUnits,overflow:measured.estimatedHeightPt*PT_EMU>geometry.height};
  }
  const height = Math.ceil((lines * fontSizePt * 1.18 + 7.2) / 72 * INCH);
  return { lines, height, lineUnits, columnWeights, rowWeights, overflow: height > geometry.height };
}
function componentText(component) {
  const content=component?.content||{};
  return [content.text,...(content.items||[]).map(item=>item?.text||'')].filter(Boolean).join('\n');
}
/** Dominant script of a prose component (null when too short to tell). */
function componentLanguage(component) {
  if(!isProse(component))return null;
  const text=componentText(component),han=(text.match(/\p{Script=Han}/gu)||[]).length,latin=(text.match(/[A-Za-z]/gu)||[]).length;
  return han+latin<8?null:han*2>=latin?'cjk':'latin';
}
function isProse(component){return ['text','list'].includes(component?.type)&&!component.content?.codeBlock&&!component.content?.mathMl;}
/** Down-then-across order of boxes equals the source order. */
export function preservesReadingOrder(boxes){
  const order=boxes.map((box,i)=>({i,x:box.x,y:box.y})).sort((a,b)=>a.x-b.x||a.y-b.y);
  return order.every((item,position)=>item.i===position);
}
/** Source pair IDs decide; unlabelled text pairs only when both the scripts
 * differ and the lengths/shared Latin tokens look like a translation. */
function translationPair(a,b,languageA,languageB){
  if(!a||!b||!isProse(a)||!isProse(b))return false;
  if(a.pairId||b.pairId)return Boolean(a.pairId&&a.pairId===b.pairId);
  if(!languageA||!languageB||languageA===languageB)return false;
  const [latin,cjk]=languageA==='latin'?[componentText(a),componentText(b)]:[componentText(b),componentText(a)];
  const ratio=latin.length/Math.max(1,(cjk.match(/\p{Script=Han}/gu)||[]).length*2.6+(cjk.match(/[A-Za-z0-9]/gu)||[]).length);
  const tokens=text=>new Set((text.match(/[A-Za-z][A-Za-z0-9_]{1,}|\d+(?:[.,]\d+)*/gu)||[]).map(t=>t.toLowerCase()));
  const shared=[...tokens(cjk)].filter(t=>tokens(latin).has(t)).length,cjkTokens=tokens(cjk).size;
  return ratio>.55&&ratio<1.8&&(!cjkTokens||shared/cjkTokens>=.5);
}
const readability=candidate=>candidate.layoutId==='bilingual-rows-source'?2:candidate.readingOrder?1:0;
export function fitComponents(components, project = {}, index = 1, options = {}) {
  const { geometry: originalCanvas, fontSizePt: defaultFont, capacityBasis } = contentCanvas(project, index);
  const canvas=options.canvas||originalCanvas;
  if(options.canvas&&(!['x','y','width','height'].every(k=>Number.isFinite(canvas[k]))||canvas.width<=0||canvas.height<=0||canvas.x<originalCanvas.x||canvas.y<originalCanvas.y||canvas.x+canvas.width>originalCanvas.x+originalCanvas.width||canvas.y+canvas.height>originalCanvas.y+originalCanvas.height))throw Error('invalid constrained source canvas');
  // A merge proposal must not gain capacity by shrinking already visible type.
  const fontSizePt=Math.max(defaultFont,Number(options.fontSizePt)||0,...components.map(c=>Number(c.fontSizePt)||0));
  if(!components.length||canvas.width<=0||canvas.height<=0)return {capacity_ok:false,predictedOverflow:components.length?1:0,fontSizePt,canvas,boxes:[],measurements:[],capacityBasis,measurementBasis:components.length?'invalid_content_geometry':'missing_display_plan'};
  const oneFragmentedList=components.length>1&&typeof components[0].sourceUnitId==='string'&&components.every(c=>c.type==='list'&&c.itemFragment&&c.sourceUnitId===components[0].sourceUnitId);
  // Each split list point already retains its measured paragraph spacing and
  // text-frame padding. A second outer object gap is optional, not a font or
  // content requirement; remove only that duplicate gap if the full list needs it.
  const gapInches=options.gapInches===0&&oneFragmentedList?0:options.gapInches===.12?.12:.16;
  const gap = Math.round(INCH * gapInches);
  const candidates = [];
  const languages=components.map(componentLanguage);
  const atomicPairs=[];
  for(let i=0;i<components.length-1;i++)if(translationPair(components[i],components[i+1],languages[i],languages[i+1])){atomicPairs.push([i,i+1]);i++;}
  const atomicGroups=new Map();components.forEach((c,i)=>{if(c.readingUnitId)atomicGroups.set(c.readingUnitId,[...(atomicGroups.get(c.readingUnitId)||[]),i]);});
  const ordered=components.some(c=>c.type==='timeline');
  for (const columns of ordered?[1]:[1, 2, 3]) {
    if(columns>components.length || columns===3 && components.some(c=>c.type==='table'))continue;
    const widths = (canvas.width - gap * (columns - 1)) / columns;
    const heights = Array(columns).fill(0), boxes = [], measurements = [];
    for (const component of components) {
      const col = heights.indexOf(Math.min(...heights));
      const box = { x: Math.round(canvas.x + col * (widths + gap)), y: Math.round(canvas.y + heights[col]), width: Math.round(widths), height: canvas.height };
      const measurement = measureComponent(component, box, fontSizePt);
      box.height = measurement.height;
      if(measurement.width)box.width=Math.min(box.width,measurement.width);
      boxes.push(box); measurements.push(measurement); heights[col] += measurement.height + gap;
    }
    const usedHeight = Math.max(0, ...heights.map(h => Math.max(0, h - gap)));
    candidates.push({ layoutId: columns === 3 ? 'three-column-source' : columns === 2 ? 'parallel-source' : 'stacked-source', columns, boxes, measurements,
      predictedOverflow: Math.max(0, usedHeight - canvas.height,...measurements.map(m=>m.width?m.width-widths:0)), usedHeight, availableHeight: canvas.height, fontSizePt, canvas });
  }
  // Tables get a whole-width region before notes. Compare unequal widths too;
  // every candidate uses the same font, complete components and source order.
  if(!ordered && components.length>=2){
    const tableIndexes=components.map((c,i)=>c.type==='table'?i:-1).filter(i=>i>=0);
    // A leading table, or a leading code block (whose lines must not wrap),
    // takes the full width; notes share two columns below it.
    if(tableIndexes.length===1 && tableIndexes[0]===0 || !tableIndexes.length && components[0].content?.codeBlock){
      const table=measureComponent(components[0],canvas,fontSizePt);
      const boxes=[{...canvas,height:table.height}],measurements=[table];
      const heights=[table.height+gap,table.height+gap],width=(canvas.width-gap)/2;
      for(const component of components.slice(1)){
        const col=heights.indexOf(Math.min(...heights)),box={x:canvas.x+col*(width+gap),y:canvas.y+heights[col],width,height:canvas.height};
        const m=measureComponent(component,box,fontSizePt);box.height=m.height;boxes.push(box);measurements.push(m);heights[col]+=m.height+gap;
      }
      const usedHeight=Math.max(...heights)-gap;
      candidates.push({layoutId:components[0].type==='table'?'full-width-table-notes':'full-width-code-notes',boxes,measurements,predictedOverflow:Math.max(0,usedHeight-canvas.height,...measurements.map((m,i)=>m.width?m.width-boxes[i].width:0)),usedHeight,availableHeight:canvas.height,fontSizePt,canvas});
    }
    if(components.length===2)for(const ratio of [.35,.65,.4,.6]){
      const widths=[(canvas.width-gap)*ratio,(canvas.width-gap)*(1-ratio)];
      const measurements=components.map((c,i)=>measureComponent(c,{...canvas,width:widths[i]},fontSizePt));
      const boxes=measurements.map((m,i)=>({x:canvas.x+(i?widths[0]+gap:0),y:canvas.y,width:widths[i],height:m.height}));
      const usedHeight=Math.max(...measurements.map(m=>m.height));
      candidates.push({layoutId:'asymmetric-source',columnRatio:ratio,boxes,measurements,predictedOverflow:Math.max(0,usedHeight-canvas.height,...measurements.map((m,i)=>m.width?m.width-widths[i]:0)),usedHeight,availableHeight:canvas.height,fontSizePt,canvas});
    }
  }
  // Reading order. Shortest-column packing can put the Chinese of one
  // paragraph beside the English of the next. Translation pairs share a row
  // (one language per column); other text flows down one column, then the next.
  if(!ordered && components.length>=2 && !components.some(c=>c.type==='table')){
    const width=(canvas.width-gap)/2,languages=components.map(componentLanguage);
    const rows=[];for(let i=0;i<components.length;i++){
      if(translationPair(components[i],components[i+1],languages[i],languages[i+1])){rows.push([i,i+1]);i++;}else rows.push([i]);
    }
    const pairs=rows.filter(row=>row.length===2);
    if(pairs.length){
      const left=languages[pairs[0][0]],boxes=[],measurements=[];let y=canvas.y;
      for(const row of rows){
        if(row.length===2){
          const placed=row.map((i,col)=>{const box={x:Math.round(canvas.x+col*(width+gap)),y:Math.round(y),width:Math.round(width),height:canvas.height};const m=measureComponent(components[i],box,fontSizePt);box.height=m.height;return [i,box,m];});
          for(const [i,box,m] of placed){boxes[i]=box;measurements[i]=m;}
          y+=Math.max(...placed.map(([, box])=>box.height))+gap;
        }else{
          const i=row[0],box={x:canvas.x,y:Math.round(y),width:canvas.width,height:canvas.height},m=measureComponent(components[i],box,fontSizePt);
          box.height=m.height;if(m.width)box.width=Math.min(box.width,m.width);boxes[i]=box;measurements[i]=m;y+=m.height+gap;
        }
      }
      const usedHeight=Math.max(0,y-gap-canvas.y);
      candidates.push({layoutId:'bilingual-rows-source',columns:2,readingOrder:true,boxes,measurements,predictedOverflow:Math.max(0,usedHeight-canvas.height,...measurements.map((m,i)=>m.width?m.width-boxes[i].width:0)),usedHeight,availableHeight:canvas.height,fontSizePt,canvas});
    }
    const probe=components.map(c=>measureComponent(c,{...canvas,width},fontSizePt));
    let split=1,bestHeight=Infinity;
    for(let k=1;k<components.length;k++){
      if(atomicPairs.some(([a,b])=>a<k&&b>=k)||[...atomicGroups.values()].some(g=>g[0]<k&&g.at(-1)>=k))continue;
      const h=Math.max(...[probe.slice(0,k),probe.slice(k)].map(part=>part.reduce((n,m)=>n+m.height+gap,0)-gap));
      if(h<bestHeight){bestHeight=h;split=k;}
    }
    const boxes=[],heights=[0,0];
    components.forEach((c,i)=>{const col=i<split?0:1,box={x:Math.round(canvas.x+col*(width+gap)),y:Math.round(canvas.y+heights[col]),width:Math.round(width),height:probe[i].height};if(probe[i].width)box.width=Math.min(box.width,probe[i].width);boxes.push(box);heights[col]+=probe[i].height+gap;});
    candidates.push({layoutId:'column-flow-source',columns:2,readingOrder:true,boxes,measurements:probe,predictedOverflow:Math.max(0,bestHeight-canvas.height,...probe.map(m=>m.width?m.width-width:0)),usedHeight:bestHeight,availableHeight:canvas.height,fontSizePt,canvas});
  }
  for(const candidate of candidates){
    if(candidate.readingOrder===undefined)candidate.readingOrder=preservesReadingOrder(candidate.boxes);
    // A code line that wraps in a narrow column restarts at the left edge and
    // loses its indentation; count wrapped code lines per candidate.
    candidate.atomicReadingUnits=[...atomicGroups.values()].every(group=>{
      const bs=group.map(i=>candidate.boxes[i]),r={x:Math.min(...bs.map(b=>b.x)),y:Math.min(...bs.map(b=>b.y)),right:Math.max(...bs.map(b=>b.x+b.width)),bottom:Math.max(...bs.map(b=>b.y+b.height))};
      return candidate.boxes.every((b,i)=>group.includes(i)||b.x>=r.right||b.x+b.width<=r.x||b.y>=r.bottom||b.y+b.height<=r.y);
    })&&atomicPairs.every(([a,b])=>{
      const first=candidate.boxes[a],second=candidate.boxes[b];
      return Math.abs(first.y-second.y)<2 || Math.abs(first.x-second.x)<2&&second.y>=first.y+first.height-2;
    });
    candidate.codeWraps=components.reduce((sum,component,i)=>component.content?.codeBlock?sum+Math.max(0,Math.round(candidate.measurements[i]?.lines||0)-String(component.content.text||'').split('\n').length):sum,0);
    // F-P1-9: the render contract gives every code paragraph a hanging indent,
    // so a wrap that remains continues under its own indentation.
    if(candidate.codeWraps)candidate.codeHangingIndent=true;
  }
  // Among layouts that fit: unwrapped code first, then readable order, then height.
  // Atomic pairs are a capacity constraint: overflow is preferable to a false
  // pass obtained by interleaving unrelated languages in shortest columns.
  const eligible=candidates.filter(candidate=>candidate.atomicReadingUnits&&candidate.readingOrder);
  const primaryFirst = components.length === 2 && ['table','chart','image'].includes(components[0].type) && components[1].type === 'text';
  const balancedPair = candidate => primaryFirst && candidate.layoutId === 'asymmetric-source' && candidate.columnRatio === .65 ? 1 : 0;
  const best = (eligible.length?eligible:candidates).sort((a, b) => Number(a.predictedOverflow > 0) - Number(b.predictedOverflow > 0)
    || (a.predictedOverflow === 0 && b.predictedOverflow === 0 ? balancedPair(b) - balancedPair(a) : 0)
    || (a.predictedOverflow > 0 ? a.usedHeight - b.usedHeight : a.codeWraps - b.codeWraps || readability(b) - readability(a) || a.usedHeight - b.usedHeight))[0];
  if(best.predictedOverflow>0&&options.gapInches===undefined){const compact=fitComponents(components,project,index,{...options,gapInches:.12});if(compact.capacity_ok)return {...compact,spacingBasis:'measured 0.12in object gaps, unchanged text font/line spacing/source'};if(oneFragmentedList){const listFit=fitComponents(components,project,index,{...options,gapInches:0});if(listFit.capacity_ok)return {...listFit,spacingBasis:'contiguous list fragments retain native paragraph spacing and frame padding; no duplicate outer object gap'};}}
  // A single primary component plus its caption/brief explanation belongs in
  // the middle of the available region, not against an arbitrary template edge.
  if (best.predictedOverflow === 0 && components.length <= 3 && components.filter(c=>['table','image','chart'].includes(c.type)).length === 1) {
    const dy=Math.round((canvas.height-best.usedHeight)/2);
    // Stacked boxes centre one by one; side-by-side columns move as a group.
    const stacked=best.boxes.every((box,i)=>best.boxes.every((other,j)=>i===j||box.y>=other.y+other.height-1||other.y>=box.y+box.height-1));
    // Components sharing horizontal space form one column/stack. Shift that
    // group as a whole: independently centering two paragraphs overlaps them.
    const shifts=new Map(),remaining=new Set(best.boxes.map((_,i)=>i));
    while(remaining.size){
      const group=[remaining.values().next().value];remaining.delete(group[0]);
      for(let n=0;n<group.length;n++)for(const other of [...remaining]){
        const a=best.boxes[group[n]],b=best.boxes[other];
        if(Math.min(a.x+a.width,b.x+b.width)>Math.max(a.x,b.x)+1){group.push(other);remaining.delete(other);}
      }
      const top=Math.min(...group.map(i=>best.boxes[i].y)),bottom=Math.max(...group.map(i=>best.boxes[i].y+best.boxes[i].height));
      const shift=Math.round(canvas.y+(canvas.height-(bottom-top))/2-top);
      for(const i of group)shifts.set(i,shift);
    }
    best.boxes.forEach((box,i)=>{
      box.y+=stacked?dy:shifts.get(i);
      if (components[i].type==='image') {
        const c=components[i].content || {},ratio=Number(c.width)/Number(c.height);
        if (ratio>0) box.width=Math.min(box.width,Math.round(box.height*ratio));
      }
      if(stacked)box.x=Math.round(canvas.x+(canvas.width-box.width)/2);
    });
    if(!stacked){
      const left=Math.min(...best.boxes.map(b=>b.x)),right=Math.max(...best.boxes.map(b=>b.x+b.width));
      const dx=Math.round(canvas.x+(canvas.width-(right-left))/2-left);
      best.boxes.forEach(box=>{box.x+=dx;});
    }
    best.balanced='centered';
  }
  return { ...best, renderContractVersion:RENDER_CONTRACT_VERSION, layoutGapInches:gapInches, capacity_ok: best.predictedOverflow === 0&&best.atomicReadingUnits&&best.readingOrder, capacityBasis, measurementBasis: 'shared_line_estimator',
    ...(process.env.PPT_FIT_DEBUG ? { alternatives: candidates.map(c => ({ layoutId: c.layoutId, overflow: Math.round(c.predictedOverflow / INCH * 100) / 100, used: Math.round(c.usedHeight / INCH * 100) / 100, readingOrder: c.readingOrder })) } : {}) };
}
/** A measured guidance budget, never a text truncator or an acceptance override. */
export function explanationBudget(components, project, index) {
  const source = fitComponents(components, project, index);
  if (components.length&&!source.capacity_ok) return { sourceFits: false, singleParagraphCjkCharacters: 0 };
  let low=0,high=2000;
  while(low<high){
    const middle=Math.ceil((low+high)/2);
    const fit=fitComponents([...components,{type:'text',content:{text:'字'.repeat(middle)}}],project,index);
    if(fit.capacity_ok)low=middle;else high=middle-1;
  }
  return {sourceFits:true,singleParagraphCjkCharacters:low,paragraphCount:1,
    basis:'shared_line_estimator; complete source plus one CJK paragraph; additional paragraphs consume gaps'};
}
export const isSourceArtifactItem = item => Boolean(item?.presentation!=='notes_by_contract'&&(item?.must_preserve_structure || item?.type === 'SummaryBlock'));
export function validateSourceArtifactRefs(items, refs) {
  if(!Array.isArray(refs))throw new Error('invalid source artifact refs');
  const intervals=new Map();
  for(const ref of refs){
    const item=items.find(item=>item.id===ref?.sourceUnitId);
    if(!isSourceArtifactItem(item))throw new Error('source artifact not assigned to a structure or summary');
    if(ref.lineStart!==undefined||ref.lineEnd!==undefined){
      const range=sourceLineRange(item,ref),ranges=intervals.get(item.id)||[];
      if(ranges.some(([a,b])=>range.lineStart<b&&range.lineEnd>a))throw new Error('overlapping source line ranges');
      ranges.push([range.lineStart,range.lineEnd]);intervals.set(item.id,ranges);continue;
    }
    if(!['TableBlock','SummaryTableBlock'].includes(item.type)){
      if(ref.rowStart!==undefined||ref.rowEnd!==undefined)throw new Error('row range is only valid for a table');
      if(intervals.has(item.id))throw new Error('duplicate source artifact');
      intervals.set(item.id,[]);continue;
    }
    const start=ref.rowStart??1,end=ref.rowEnd??item.rows?.length;
    if(!Number.isInteger(start)||!Number.isInteger(end)||start<1||(end<start||end===start&&item.rows.length!==1)||end>item.rows.length)throw new Error('invalid source table row range');
    const existing=intervals.get(item.id)||[];
    if(existing.some(([a,b])=>start<b&&end>a))throw new Error('overlapping source table row ranges');
    existing.push([start,end]);intervals.set(item.id,existing);
  }
  return refs;
}
/** Source components keep their translation-pair identity for layout. */
export function sourceComponent(item, ref = {}) {
  const displayed=ref.lineStart!==undefined||ref.lineEnd!==undefined?materializeSourceLineRange(item,ref):item;
  const raw = sourceComponentBody(displayed, ref),component={...raw,sourceUnitId:item.id,content:ensureRichContent(raw.content)};
  return item?.languagePairId ? { ...component, pairId: item.languagePairId } : component;
}
/** Checklist members are semantic points, not one paragraph-count proxy.
 * The original source ID remains authoritative; fragments cover ordered item
 * indices exactly and are checked together by object integrity. */
export function sourceComponentParts(item,ref={}){
  const component=sourceComponent(item,ref);
  if(component.type!=='list'||component.content.items.length<2)return [component];
  const parts=component.content.items.map((entry,index)=>({...component,content:{...component.content,items:[entry]},itemFragment:{itemStart:index,itemEnd:index+1},
    ...(component.pairId?{pairId:`${component.pairId}:point:${index}`}:{})}));
  if(!component.pairId)for(let i=0;i<parts.length-1;i++)if(translationPair(parts[i],parts[i+1],componentLanguage(parts[i]),componentLanguage(parts[i+1]))){const id=stableId('unit',item.id,'paired-list',i);parts[i].readingUnitId=id;parts[i+1].readingUnitId=id;i++;}
  return parts;
}
function sourceComponentBody(item, ref = {}) {
  if(item.type==='SourceImage'){
    const {id,type,...content}=item;
    return {type:'image',content:{...content,sourceImageId:id}};
  }
  if(item.type==='ChartBlock')return {type:'chart',content:structuredClone(item.chart)};
  if(item.type==='CodeBlock')return {type:'text',content:{text:item.text,codeBlock:{language:item.language || '',sourceText:item.text}}};
  if(item.type==='EquationBlock')return {type:'text',content:equationContent(item.text)};
  // Older parsed snapshots stored compact ASCII branches as lossy table
  // rows but retained the complete immutable diagram alongside them. Render
  // that drawing directly when the reference owns the whole legacy object.
  const legacyDrawing=item.type==='TableBlock'&&item.diagramSource?.kind==='ascii'&&item.rows?.slice(1).map(row=>row.length===1?String(row[0]):'').join('\n')!==String(item.diagramSource.text||'')&&/├|└|\b(?:Yes|No)\s*→/u.test(item.diagramSource.text||'')?String(item.diagramSource.text).replace(/\s+$/u,''):'';
  if(legacyDrawing&&legacyDrawing.split('\n').length<=20&&Math.max(...legacyDrawing.split('\n').map(line=>line.length))<=64){
    if(ref.rowStart!==undefined&&(ref.rowStart!==1||ref.rowEnd!==item.rows.length))throw new Error('Legacy ASCII diagram requires its complete original source scope');
    return {type:'text',content:{text:legacyDrawing,codeBlock:{language:'diagram',sourceText:legacyDrawing},processSource:legacyDrawing}};
  }
  if (['TableBlock','SummaryTableBlock'].includes(item.type)) {
    const start = ref.rowStart === undefined ? 1 : Number(ref.rowStart), end = ref.rowEnd === undefined ? item.rows.length : Number(ref.rowEnd);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || (end < start || end === start && item.rows.length !== 1) || end > item.rows.length) throw new Error('invalid source table row range');
    const rawRows=[item.rows[0],...item.rows.slice(start,end)].map(row=>row.map(String)),cellRich=rawRows.map(row=>row.map(value=>sourceRichText(value,{inline:true})));
    return {type:'table',content:{rows:cellRich.map(row=>row.map(cell=>cell.plainText)),rawRows,cellRich,derivedSummary:item.derivedSummary,displayTransformVersion:2}};
  }
  // A fanned-out or branching ASCII drawing reads as its original drawing in a
  // monospace box; flattening its columns with " / " garbles the arrows.
  const drawing=item.diagramSource?.kind==='ascii'&&['parallel','branching'].includes(item.diagramSource.relation)?(item.sourceLineRange?item.text:String(item.diagramSource.text||'').replace(/\s+$/u,'')):'';
  if(drawing&&(item.sourceLineRange||drawing.split('\n').length<=20&&Math.max(...drawing.split('\n').map(line=>line.length))<=64))
    return {type:'text',content:{text:drawing,codeBlock:{language:'diagram',sourceText:drawing},processSource:item.text}};
  // A drawing too wide for a slide keeps its source text, one box per line; a
  // timeline would add per-stage chrome and overflow a long architecture.
  const sourceLines=item.text.split('\n').filter(line=>line.trim()),bullet=/^\s*(?:[-*+]|\d+[.)])\s+/;
  // Warning/role/taxonomy classification must not erase the source's list
  // structure. Only a wholly explicit list is split; mixed prose stays whole.
  if (item.type === 'ChecklistBlock'||['WarningBlock','TaxonomyBlock'].includes(item.type)&&sourceLines.length>=1&&sourceLines.every(line=>bullet.test(line))) return { type: 'list', content: { items: sourceLines.filter(line=>bullet.test(line)).map(line => ({ text: line.replace(bullet, '') })) } };
  if(item.type==='ProcessBlock'&&item.diagramSource?.kind==='text-flow')return {type:'timeline',content:{items:item.text.split('\n').map(text=>richTextContent(text)),processSource:item.text}};
  if (item.type==='ProcessBlock' && /branch|if\b|else\b|分支|否则|┌|├|└/i.test(item.text)) return {type:'text',content:{text:item.text,processSource:item.text}};
  if (item.type === 'ProcessBlock') {
    const steps=orderedSourceSteps(item.text);
    return steps.length>1?{type:'timeline',content:{items:steps.map(text=>richTextContent(text)),processSource:item.text}}:{type:'text',content:{text:sourceDisplayText(item.text),processSource:item.text}};
  }
  return {type:'text',content:richTextContent(item.text)};
}
/** Captions use visible source text and their own capacity budget. */
export function sourceImageComponents(image) {
  return [sourceComponent({...image,type:'SourceImage'}),...(image.caption?.trim()?
    [{type:'text',content:{text:image.caption.trim(),sourceImageCaptionId:image.id}}]:[])];
}

/** Shared planning/writing representation: paired list points are contiguous,
 * so reading units cannot differ between a predicted fit and the real writer. */
export function prepareReadingComponents(items,components){
 const idOf=c=>c.item?.id||c.sourceUnitId,units=readingUnits(items,components.map(idOf).filter(Boolean)),result=[];
 for(const ids of units){
  let parts=components.filter(c=>ids.includes(idOf(c)));
  // Point-wise bilingual alignment requires equal explicit list cardinality.
  // Unequal/mixed lists stay intact as one source reading group; do not infer
  // missing counterparts or silently pair the wrong point with a paragraph.
  const pairs=[...new Set(ids.map(id=>items.find(item=>item.id===id)?.languagePairId).filter(Boolean))];
  for(const pairId of pairs){
    const members=ids.filter(id=>items.find(item=>item.id===id)?.languagePairId===pairId);
    const counts=members.map(id=>parts.filter(part=>idOf(part)===id&&part.itemFragment).length);
    if(members.length<2||!counts.some(Boolean)||counts.every(count=>count>0&&count===counts[0]))continue;
    parts=parts.filter(part=>!members.includes(idOf(part))).concat(members.flatMap(id=>{
      const memberParts=components.filter(part=>idOf(part)===id),first=memberParts[0],item=items.find(item=>item.id===id);
      if(!first||!memberParts.some(part=>part.itemFragment))return memberParts;
      const {itemFragment,readingUnitId,...whole}=first;
      return [{...whole,...sourceComponent(item)}];
    }));
  }
  if(parts.some(c=>c.itemFragment)&&ids.some(id=>items.find(i=>i.id===id)?.languagePairId))parts.sort((a,b)=>(a.itemFragment?.itemStart??-1)-(b.itemFragment?.itemStart??-1)||ids.indexOf(idOf(a))-ids.indexOf(idOf(b)));
  for(const c of parts)result.push({...c,...(ids.length>1?{readingUnitId:stableId('unit',...ids,c.itemFragment?.itemStart??'prose')}:{})});
 }
 const assigned=new Set(units.flat());return [...result,...components.filter(c=>!idOf(c)||!assigned.has(idOf(c)))];
}
