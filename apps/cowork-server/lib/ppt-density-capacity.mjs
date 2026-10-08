/** Shared geometry/line estimator for page planning and source-owned rendering.
 * A fit is an analytic prediction; final Render Tree/PPTX QA remains mandatory. */
import { displayUnits } from './ppt-density-profile.mjs';
export const INCH = 914400;
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
    // Preserve title/navigation/footer zones; body objects replace only content.
    const gap=INCH*.08;
    for(const node of spec.nodes||[]){
      if(!validBox(node.geometry))continue;
      const slot=spec.slots?.find(slot=>slot.shapeId===node.nativeRef?.shapeId);
      const header=['title','section'].includes(slot?.role),footer=slot?.purpose==='footnote'||node.semanticRole==='page-number';
      if(!header&&!footer)continue;
      const g=node.geometry;
      if(g.x+g.width<=left||g.x>=right)continue;
      if(header && g.y<(top+bottom)/2 && g.y+g.height>top-gap)top=Math.max(top,g.y+g.height+gap);
      if(footer && g.y>top && g.y<bottom+gap)bottom=Math.min(bottom,g.y-gap);
    }
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
    rowWeights = rows.map(row => Math.max(...row.map((cell, col) => String(cell).split('\n').reduce((n, line) =>
      n + Math.max(1, Math.ceil(displayUnits(line) / (lineUnits * columnWeights[col] / total))), 0))) + .35);
    lines = rowWeights.reduce((n, v) => n + v, 0);
  } else if (['list', 'timeline'].includes(component.type)) {
    lines = (component.content.items || []).reduce((n, item) => n + linesOf(item.text) + .4, 0);
  } else lines = linesOf(component.content?.text || '');
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
      boxes.push(box); measurements.push(measurement); heights[col] += measurement.height + gap;
    }
    const usedHeight = Math.max(0, ...heights.map(h => Math.max(0, h - gap)));
    candidates.push({ layoutId: columns === 2 ? 'parallel-source' : 'stacked-source', columns, boxes, measurements,
      predictedOverflow: Math.max(0, usedHeight - canvas.height), usedHeight, availableHeight: canvas.height, fontSizePt, canvas });
  }
  const best = candidates.sort((a, b) => Number(a.predictedOverflow > 0) - Number(b.predictedOverflow > 0) || a.usedHeight - b.usedHeight)[0];
  return { ...best, capacity_ok: best.predictedOverflow === 0, capacityBasis, measurementBasis: 'shared_line_estimator' };
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
    if(!Number.isInteger(start)||!Number.isInteger(end)||start<1||end<=start||end>item.rows.length)throw new Error('invalid source table row range');
    const existing=intervals.get(item.id)||[];
    if(existing.some(([a,b])=>start<b&&end>a))throw new Error('overlapping source table row ranges');
    existing.push([start,end]);intervals.set(item.id,existing);
  }
  return refs;
}
export function sourceComponent(item, ref = {}) {
  if (item.type === 'TableBlock') {
    const start = ref.rowStart === undefined ? 1 : Number(ref.rowStart), end = ref.rowEnd === undefined ? item.rows.length : Number(ref.rowEnd);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end <= start || end > item.rows.length) throw new Error('invalid source table row range');
    return { type: 'table', content: { rows: [item.rows[0], ...item.rows.slice(start, end)].map(row => row.map(String)) } };
  }
  if (item.type === 'ChecklistBlock') return { type: 'list', content: { items: item.text.split('\n').filter(line => /^\s*(?:[-*+]|\d+[.)])\s+/.test(line)).map(line => ({ text: line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '') })) } };
  if (item.type === 'ProcessBlock') return { type: 'timeline', content: { items: item.text.split(/(?:->|→)/u).map(text => ({ text: text.trim() })) } };
  return { type: 'text', content: { text: item.text } };
}
