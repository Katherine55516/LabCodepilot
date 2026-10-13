/** Shared geometry/line estimator for page planning and source-owned rendering.
 * A fit is an analytic prediction; final Render Tree/PPTX QA remains mandatory. */
import { measureText, textContract, PT_EMU } from './ppt/render-contract.mjs';
import { displayUnits } from './ppt-density-profile.mjs';
import { equationContent, equationDimensions } from './ppt-math.mjs';
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
  const fontSizePt = Math.max(14, fonts.length ? Math.min(...fonts) : 18);
  let left=width*.065, right=width*.935, top=height*.25, bottom=height*.93;
  if(frames.length){
    left=Math.max(0,Math.min(...frames.map(node=>node.geometry.x)));
    right=Math.min(width,Math.max(...frames.map(node=>node.geometry.x+node.geometry.width)));
    top=Math.max(0,Math.min(...frames.map(node=>node.geometry.y)));
    bottom=Math.min(height,Math.max(...frames.map(node=>node.geometry.y+node.geometry.height)));
    // Source-owned components may use free vertical space in the content
    // region. A short legacy textbox is not a limit on a complete table/math
    // object. Keep its horizontal design and all title/footer/image zones.
    const richSource=String(project.source?.text||'').length>=8000;
    if(richSource){top=Math.min(top,height*.25);bottom=Math.max(bottom,height*.93);}
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
  for(const node of (spec?.nodes || []).filter(node=>protectedTemplateAsset(node)||node.type==='image'&&
    !(node.geometry?.width>=width*.85&&node.geometry?.height>=height*.85))){
    if(!validBox(node.geometry))continue;
    const g=node.geometry;if(g.x>=right||g.x+g.width<=left||g.y>=bottom||g.y+g.height<=top)continue;
    const choices=[{l:left,r:Math.min(right,g.x-clearance),t:top,b:bottom},{l:Math.max(left,g.x+g.width+clearance),r:right,t:top,b:bottom},
      {l:left,r:right,t:top,b:Math.min(bottom,g.y-clearance)},{l:left,r:right,t:Math.max(top,g.y+g.height+clearance),b:bottom}]
      .filter(c=>c.r>c.l&&c.b>c.t).sort((a,b)=>(b.r-b.l)*(b.b-b.t)-(a.r-a.l)*(a.b-a.t));
    if(!choices.length){right=left;bottom=top;break;}
    const c=choices[0];left=c.l;right=c.r;top=c.t;bottom=c.b;
  }
  return { geometry:{x:Math.round(left),y:Math.round(top),width:Math.max(0,Math.round(right-left)),height:Math.max(0,Math.round(bottom-top))},fontSizePt,
    capacityBasis:frames.length?'native_frame_geometry':'default_canvas_before_template_parse' };
}
export function measureComponent(component, geometry, fontSizePt) {
  const horizontalPaddingPt = component.type === 'table' ? 14.4 : 7.2;
  const lineUnits = Math.max(0, geometry.width / INCH * 72 - horizontalPaddingPt) / fontSizePt * .88;
  if (!(lineUnits > 0)) return { lines: Infinity, height: Infinity, overflow: true };
  const linesOf = text => String(text || '').split('\n').reduce((n, line) => n + Math.max(1, Math.ceil(displayUnits(line) / lineUnits)), 0);
  let lines, columnWeights, rowWeights;
  if (component.type === 'table') {
    const rows = component.content.rows || [];
    if (!rows.length || !rows[0].length || rows.some(row => row.length !== rows[0].length)) throw new Error('invalid source table geometry');
    columnWeights = rows[0].map((_, col) => Math.max(12, ...rows.map(row => Math.sqrt(displayUnits(row[col])) * 4)));
    const total = columnWeights.reduce((n, v) => n + v, 0);
    rowWeights = rows.map(row => Math.max(...row.map((cell,col)=>{
      const e={kind:'text',content:{text:String(cell)},style:{fontSizePt,lineHeight:1.18,paragraphSpacingEm:0},bounds:{width:geometry.width*columnWeights[col]/total,height:1e12}};
      return measureText(e,textContract(e,[7.2,3,7.2,3])).estimatedHeightPt+6;
    })));
    const height=Math.ceil(rowWeights.reduce((sum,v)=>sum+v,0)*PT_EMU);
    return {lines:rowWeights.reduce((sum,v)=>sum+v/(fontSizePt*1.18),0),height,lineUnits,columnWeights,rowWeights,overflow:height>geometry.height};
  } else if(component.type==='image') {
    const ratio=Math.max(.05,Number(component.content?.width||1)/Number(component.content?.height||1));
    return {lines:0,height:Math.ceil(Math.min(geometry.height*.7,geometry.width/ratio)),lineUnits,overflow:false};
  } else if (['list', 'timeline'].includes(component.type)) {
    const e={kind:component.type,bounds:{...geometry,height:1e12},content:component.content,style:{fontSizePt,lineHeight:1.18,paragraphSpacingEm:.4}};
    const measured=measureText(e,textContract(e));
    return {lines:measured.lines,height:Math.ceil((measured.estimatedHeightPt+7.2)*PT_EMU),lineUnits,overflow:measured.estimatedHeightPt*PT_EMU>geometry.height};
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
export function fitComponents(components, project = {}, index = 1) {
  const { geometry: canvas, fontSizePt: defaultFont, capacityBasis } = contentCanvas(project, index);
  // A merge proposal must not gain capacity by shrinking already visible type.
  const fontSizePt=Math.max(defaultFont,...components.map(c=>Number(c.fontSizePt)||0));
  if(!components.length||canvas.width<=0||canvas.height<=0)return {capacity_ok:false,predictedOverflow:components.length?1:0,fontSizePt,canvas,boxes:[],measurements:[],capacityBasis,measurementBasis:components.length?'invalid_content_geometry':'missing_display_plan'};
  const gap = Math.round(INCH * .16);
  const candidates = [];
  for (const columns of [1, 2]) {
    if (columns === 2 && components.length < 2) continue;
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
    candidates.push({ layoutId: columns === 2 ? 'parallel-source' : 'stacked-source', columns, boxes, measurements,
      predictedOverflow: Math.max(0, usedHeight - canvas.height,...measurements.map(m=>m.width?m.width-widths:0)), usedHeight, availableHeight: canvas.height, fontSizePt, canvas });
  }
  const best = candidates.sort((a, b) => Number(a.predictedOverflow > 0) - Number(b.predictedOverflow > 0) || a.usedHeight - b.usedHeight)[0];
  // A single primary component plus its caption/brief explanation belongs in
  // the middle of the available region, not against an arbitrary template edge.
  if (best.predictedOverflow === 0 && components.length <= 3 && components.filter(c=>['table','image','chart'].includes(c.type)).length === 1) {
    const dy=Math.round((canvas.height-best.usedHeight)/2);
    best.boxes.forEach((box,i)=>{
      box.y+=dy;
      if (components[i].type==='image') {
        const c=components[i].content || {},ratio=Number(c.width)/Number(c.height);
        if (ratio>0) box.width=Math.min(box.width,Math.round(box.height*ratio));
      }
      box.x=Math.round(canvas.x+(canvas.width-box.width)/2);
    });
  }
  return { ...best, capacity_ok: best.predictedOverflow === 0, capacityBasis, measurementBasis: 'shared_line_estimator' };
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
export const isSourceArtifactItem = item => Boolean(item?.must_preserve_structure || item?.type === 'SummaryBlock');
export function validateSourceArtifactRefs(items, refs) {
  if(!Array.isArray(refs))throw new Error('invalid source artifact refs');
  const intervals=new Map();
  for(const ref of refs){
    const item=items.find(item=>item.id===ref?.sourceUnitId);
    if(!isSourceArtifactItem(item))throw new Error('source artifact not assigned to a structure or summary');
    if(item.type!=='TableBlock'){
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
export function sourceComponent(item, ref = {}) {
  if(item.type==='SourceImage'){
    const {id,type,...content}=item;
    return {type:'image',content:{...content,sourceImageId:id}};
  }
  if(item.type==='CodeBlock')return {type:'text',content:{text:item.text,codeBlock:{language:item.language || '',sourceText:item.text}}};
  if(item.type==='EquationBlock')return {type:'text',content:equationContent(item.text)};
  if (item.type === 'TableBlock') {
    const start = ref.rowStart === undefined ? 1 : Number(ref.rowStart), end = ref.rowEnd === undefined ? item.rows.length : Number(ref.rowEnd);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || (end < start || end === start && item.rows.length !== 1) || end > item.rows.length) throw new Error('invalid source table row range');
    return { type: 'table', content: { rows: [item.rows[0], ...item.rows.slice(start, end)].map(row => row.map(String)) } };
  }
  if (item.type === 'ChecklistBlock') return { type: 'list', content: { items: item.text.split('\n').filter(line => /^\s*(?:[-*+]|\d+[.)])\s+/.test(line)).map(line => ({ text: line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '') })) } };
  if (item.type==='ProcessBlock' && /branch|if\b|else\b|分支|否则|┌|├|└/i.test(item.text)) return {type:'text',content:{text:item.text,processSource:item.text}};
  if (item.type === 'ProcessBlock') return { type: 'timeline', content: { items: item.text.split(/(?:->|→)|\n(?=\s*\d+[.)]\s)/u).map(text => ({ text: text.trim() })) } };
  return { type: 'text', content: { text: item.text } };
}
/** Captions use visible source text and their own capacity budget. */
export function sourceImageComponents(image) {
  return [sourceComponent({...image,type:'SourceImage'}),...(image.caption?.trim()?
    [{type:'text',content:{text:image.caption.trim(),sourceImageCaptionId:image.id}}]:[])];
}
