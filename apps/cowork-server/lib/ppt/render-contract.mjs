/** Serialized, point-based rendering rules. Consumers must not invent padding,
 * auto-fit or signed axes. Measurements are conservative predictions, not Office QA. */
import {ensureRichContent} from '../ppt-source-text.mjs';
import {imageMask} from './image-mask.mjs';
export const PT_EMU = 12700;
export const RENDER_CONTRACT_VERSION = 5;
export const CARD_PADDING = [7.92, 5.04, 7.92, 2.88];
export const TABLE_PADDING = [7.2, 3, 7.2, 3];
const finite = (value, fallback) => value !== null && value !== undefined && Number.isFinite(Number(value)) ? Number(value) : fallback;
// F-P1-9: a wrapped code line continues under its own indentation plus two
// columns (hanging indent); the code text itself, including its leading
// whitespace, is unchanged.
export const CODE_ADVANCE_EM = .6;
export function codeHangingIndent(text, fontSizePt) {
  let columns = 0;
  for (const ch of String(text).match(/^[ \t]*/u)[0]) columns += ch === '\t' ? 4 - columns % 4 : 1;
  const marginLeftPt = Math.round((columns + 2) * fontSizePt * CODE_ADVANCE_EM * 100) / 100;
  return { marginLeftPt, indentPt: -marginLeftPt };
}
export function textParagraphs(element) {
  const c = element.content || {}, native = element.nativeTextFrame?.paragraphs || [];
  const preserved = native.length && native.map(p=>p.text).join('\n') === c.text && (!c.richText||c.richText.source===c.text);
  if(c.richText&&!preserved)return [{text:c.text,runs:c.richText.runs.map(run=>({...run,fontSizePt:finite(element.style?.fontSizePt,18),bold:Boolean(run.bold||Number(element.style?.fontWeight)>=600)})),
    lineHeight:finite(native[0]?.lineSpacing,finite(element.style?.lineHeight,native.length?1:1.18)),spaceAfterPt:finite(element.style?.paragraphSpacingEm,0)*finite(element.style?.fontSizePt,18)}];
  const values = c.codeBlock ? String(c.text || '').split('\n').map(text=>({text,...codeHangingIndent(text,finite(element.style?.fontSizePt,18))})) : Array.isArray(c.paragraphs) ? c.paragraphs.map((p,i) => { const label=native[i]?.runs?.[0],body=native[i]?.runs?.find((r,j)=>j>0&&r.text?.trim()); return {text:[p.label,p.body].filter(Boolean).join('：'),label:p.label,runs:p.richText?p.richText.runs.map((r,at)=>({...r,fontSizePt:finite((p.label&&at===0?label:body)?.fontSizePt,finite(element.style?.fontSizePt,18)),bold:Boolean(r.bold)})):[...(p.label?[{text:p.label,fontSizePt:finite(label?.fontSizePt,finite(element.style?.fontSizePt,18)),bold:true}]:[]),{text:(p.label?'：':'')+(p.body||''),fontSizePt:finite(body?.fontSizePt,finite(element.style?.fontSizePt,18)),bold:Boolean(body?.bold)}]}; })
    : element.kind === 'text' ? preserved ? native.map(p=>({text:p.text,runs:p.runs?.map(r=>({text:r.text,fontFamily:r.fontFamily,fontSizePt:finite(r.fontSizePt,finite(element.style?.fontSizePt,18)),bold:Boolean(r.bold),italic:Boolean(r.italic)}))})) : [{ text: String(c.text || '') }]
      : (c.items || []).map((p, i) => {const prefix=element.kind==='timeline'?(/^\s*\d+[.)]\s/u.test(p.text||'')?'':`${i+1}. `):element.kind==='list'?'• ':'';return {text:prefix+(p.text||''),...(p.richText?{runs:[{kind:'text',text:prefix,fontSizePt:finite(element.style?.fontSizePt,18),bold:false},...p.richText.runs.map(run=>({...run,fontSizePt:finite(element.style?.fontSizePt,18),bold:Boolean(run.bold)}))]}:{})};});
  const overrides = textStyleOverrides(element);
  return values.map((p, i) => ({ ...p, ...(p.runs ? {runs:p.runs.map(run=>({...run,
    ...(overrides.fontSizePt !== undefined ? {fontSizePt:overrides.fontSizePt} : {}),
    ...(overrides.fontFamily ? {fontFamily:overrides.fontFamily} : {}),
    ...(overrides.fontWeight !== undefined ? {bold:overrides.fontWeight >= 600} : {}),
    ...(overrides.fontStyle ? {italic:overrides.fontStyle === 'italic'} : {}),
  }))} : {}), lineHeight: overrides.lineHeight !== undefined ? overrides.lineHeight : finite(native[i]?.lineSpacing, finite(element.style?.lineHeight, native.length ? 1 : 1.18)),
    spaceAfterPt: c.codeBlock ? 0 : finite(native[i]?.spaceAfterPt, finite(element.style?.paragraphSpacingEm, 0) * finite(element.style?.fontSizePt, 18)) }));
}
export function nativeTextStyleOverrides(element) {
  const native = element.nativeTextFrame?.paragraphs || [];
  if (!native.length) return {};
  const first = native.flatMap(p=>p.runs || []).find(run=>run.text?.trim()) || {};
  const style = element.style || {}, overrides = {}, baseline=element.nativeStyleBaseline;
  const sizes=new Set(native.flatMap(p=>p.runs||[]).filter(r=>r.text?.trim()&&r.fontSizePt!=null).map(r=>r.fontSizePt));
  // Mixed native runs retain their own hierarchy. An aggregate fallback style
  // is not evidence of a user edit. A real edit is compared with its immutable
  // template/import baseline; homogeneous legacy frames retain compatibility.
  const originalPt=baseline?.fontSizePt ?? (sizes.size<=1?first.fontSizePt:undefined);
  if (originalPt != null && style.fontSizePt != null && Math.abs(style.fontSizePt-originalPt) > .01) overrides.fontSizePt=style.fontSizePt;
  if ((baseline?.fontFamily||first.fontFamily) && style.fontFamily && style.fontFamily !== (baseline?.fontFamily||first.fontFamily)) overrides.fontFamily=style.fontFamily;
  if (style.fontWeight != null && (style.fontWeight >= 600) !== (baseline?.fontWeight!=null?baseline.fontWeight>=600:Boolean(first.bold))) overrides.fontWeight=style.fontWeight;
  if (style.fontStyle && style.fontStyle !== (baseline?.fontStyle || (first.italic?'italic':'normal'))) overrides.fontStyle=style.fontStyle;
  return overrides;
}
/** Baseline-derived overrides plus the fields the user set explicitly with
 * the shared style tools (`textStyleOverrides`), which always win. */
export function textStyleOverrides(element) {
  const overrides = nativeTextStyleOverrides(element), style = element.style || {};
  for (const key of element.textStyleOverrides || []) if (['fontSizePt','fontFamily','fontWeight','fontStyle','lineHeight'].includes(key) && style[key] !== undefined) overrides[key] = style[key];
  return overrides;
}
export function textContract(element, padding) {
  const code = element.content?.codeBlock;
  const margins = padding || (!element.nativeRef&&['eyebrow','page-number','takeaway'].includes(element.semanticRole)?[0,0,0,0]:null) || element.nativeTextFrame?.margins?.map(v => v / PT_EMU) || [3.6, 3.6, 3.6, 3.6];
  return { version: RENDER_CONTRACT_VERSION, units: 'pt', margins, wrap: true, autoFit: 'none', whiteSpace: 'pre-wrap',
    overflowWrap: ['title','template-title'].includes(element.semanticRole)?'normal':'anywhere', hangingPunctuation: false, fontFamily: code && !element.textStyleOverrides?.includes('fontFamily') ? 'Consolas' : element.style?.fontFamily,
    tabSize: 4, paragraphs: textParagraphs(element), code: Boolean(code), uniformStyle: textStyleOverrides(element) };
}
export function measureText(element, contract = element.textLayout || textContract(element)) {
  const font = finite(element.style?.fontSizePt, 18), b = element.bounds || {};
  const [l, t, r, bottom] = contract.margins;
  const widthPt = Math.max(0, finite(b.width, 0) / PT_EMU - l - r);
  const availableHeightPt = Math.max(0, finite(b.height, 0) / PT_EMU - t - bottom);
  let lines = 0, estimatedHeightPt = 0, widthOverflow = false;
  // Reserve ten percent for font-engine/word-boundary differences. Measure
  // mixed-size runs in points; hard and blank code lines consume height.
  for (const p of contract.paragraphs) {
    const runs=(p.runs?.length?p.runs:[{text:p.text,fontSizePt:font}]).flatMap(run=>run.kind==='math'?run.fallbackRuns.map(r=>({...r,fontSizePt:run.fontSizePt*r.scale})):run);
    let used=0,lineFont=0,column=0,paragraphHeight=0,count=0;
    const finish=()=>{paragraphHeight+=(lineFont || font)*p.lineHeight;count++;used=0;lineFont=0;column=0;};
    for(const run of runs){
      const pt=finite(run.fontSizePt,font);
      const advanceFor=value=>pt*Array.from(value).reduce((sum,char)=>sum+(char.codePointAt(0)>127?1:contract.code?.6:/[MW@]/.test(char)?.85:.55),0);
      const tokens=contract.code?Array.from(String(run.text)):(String(run.text).match(/[A-Za-z0-9]+(?:[-'’][A-Za-z0-9]+)*|[^A-Za-z0-9]/gu)||[]).flatMap(token=>contract.overflowWrap==='anywhere'&&advanceFor(token)>widthPt*.9?Array.from(token):[token]);
      for(const ch of tokens){
      if(ch==='\n'||ch==='\v'){finish();continue;}
      const tabs=ch==='\t'?contract.tabSize-column%contract.tabSize:1;
      const advance=pt*(ch==='\t'?tabs*.6:Array.from(ch).reduce((sum,char)=>sum+(char.codePointAt(0)>127?1:contract.code?.6:/[MW@]/.test(char)?.85:.55),0));
      if (advance > widthPt || !contract.wrap && used + advance > widthPt) widthOverflow = true;
      if(contract.wrap&&used>0&&used+advance>widthPt*.9){finish();used=finite(p.marginLeftPt,0);}
      used+=advance;column+=tabs;lineFont=Math.max(lineFont,pt);
      }
    }
    finish();lines+=count;estimatedHeightPt+=paragraphHeight+p.spaceAfterPt;
  }
  // Last paragraph's after-spacing is outside its visible text.
  estimatedHeightPt -= contract.paragraphs.at(-1)?.spaceAfterPt || 0;
  // Office CJK/fallback fonts use taller ascent/descent boxes than CSS line
  // height. Reserve measured engine headroom without shrinking the font.
  const firstNative=element.nativeTextFrame?.paragraphs?.[0]?.runs?.find(r=>r.text?.trim());
  const nativeHeight=element.nativeTextFrame?.originalHeight;
  const unchangedLatinTitle=element.nativeRef&&['title','template-title'].includes(element.semanticRole)&&element.nativeTextFrame?.paragraphs?.length===1&&firstNative?.fontFamily===element.style?.fontFamily&&Math.abs(Number(firstNative?.fontSizePt)-font)<.01&&!/[\u3400-\u9fff]/u.test(element.content?.text||'')&&!(element.content?.richText?.runs||[]).some(r=>r.kind==='math')&&nativeHeight>0&&!(element.style?.fontStyle==='italic'&&!firstNative.italic);
  // The original native Latin title frame supplies a measured ink bound for
  // its unchanged face/size. A generic CJK fallback multiplier must not reject
  // a source-designed single-line box; wrapping and actual export QA remain.
  const inkFactor=unchangedLatinTitle?Math.max(1,Math.min(1.2,(nativeHeight/PT_EMU-t-bottom)/(font*finite(element.nativeTextFrame.paragraphs[0].lineSpacing,1)))):1.2;
  estimatedHeightPt*=inkFactor;
  return { lines, widthPt, availableHeightPt, estimatedHeightPt, widthOverflow, overflow: widthOverflow || estimatedHeightPt > availableHeightPt + 1,
    measurementBasis: unchangedLatinTitle?'native_latin_title_frame_bound':'render_contract_conservative_prediction' };
}
export function chartContract(content = {}) {
  const values = content.values || [], labels = content.labels || [];
  const allSeries=content.series?.length?content.series:[{values}];
  const valid = values.length > 0 && labels.length === values.length && allSeries.every(s=>s.values?.length===labels.length&&s.values.every(v=>typeof v==='number'&&Number.isFinite(v)));
  const pie = content.chartType === 'pie';
  const domain=content.series?.length?content.series.flatMap(s=>s.values||[]):values;
  const min = valid ? Math.min(0, ...domain) : 0, max = valid ? Math.max(0, ...domain) : 1;
  const pad = (max - min || 1) * .1;
  return { version: RENDER_CONTRACT_VERSION, valid: valid && (!pie || allSeries.length===1 && values.every(v => v >= 0) && values.some(v => v > 0)),
    minimum: min < 0 ? min - pad : 0, maximum: max > 0 ? max + pad : min < 0 ? 0 : 1,
    zeroBaseline: true, unit: String(content.chartTitle || content.unit || ''), numberFormat: content.numberFormat || '0.##' };
}
const escapeXml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
export function chartMarkup(element, axis = chartContract(element.content)) {
  if (!axis.valid || !(element.bounds?.width>0) || !(element.bounds?.height>0)) return '';
  const c=element.content || {}, w=element.bounds.width/PT_EMU, h=element.bounds.height/PT_EMU;
  const color=escapeXml(element.style?.fill || '#6758c8'), ink=escapeXml(element.style?.color || '#111827');
  const font=Math.min(12,h*.055,w*.04), labels=c.labels, values=c.values;
  const text=(x,y,value,anchor='middle')=>`<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="${font}" fill="${ink}">${escapeXml(value)}</text>`;
  const unit=text(w/2,font,axis.unit);
  if(c.chartType==='pie') {
    const total=values.reduce((a,b)=>a+b,0),cx=w*.32,cy=h*.52,r=Math.min(w*.25,h*.36);let cursor=-Math.PI/2;
    return `<g transform="scale(${PT_EMU})">`+unit+values.map((v,i)=>{const angle=v/total*Math.PI*2,end=cursor+angle;
      const path=angle>=Math.PI*1.999?`<circle cx="${cx}" cy="${cy}" r="${r}" fill="hsl(${i*67} 65% 55%)"/>`:`<path d="M ${cx} ${cy} L ${cx+Math.cos(cursor)*r} ${cy+Math.sin(cursor)*r} A ${r} ${r} 0 ${angle>Math.PI?1:0} 1 ${cx+Math.cos(end)*r} ${cy+Math.sin(end)*r} Z" fill="hsl(${i*67} 65% 55%)"/>`;cursor=end;
      return path+text(w*.64,h*.18+i*font*1.8,`${labels[i]}: ${v}`,'start');}).join('')+'</g>';
  }
  const left=w*.12,right=w*.95,top=h*.13,bottom=h*.82;
  const y=v=>bottom-(v-axis.minimum)/(axis.maximum-axis.minimum)*(bottom-top),zero=y(0);
  const cell=(right-left)/values.length,x=i=>left+cell*(i+.5);
  let markup=unit+text(w/2,h*.995,c.axisTitles?.[0]||'')+text(left,top-font*.4,c.axisTitles?.[1]||'','start')+`<line x1="${left}" x2="${right}" y1="${zero}" y2="${zero}" stroke="${ink}" stroke-width="1"/>`;
  markup+=text(left-font*.4,top+font,axis.maximum.toPrecision(3),'end')+text(left-font*.4,bottom,axis.minimum.toPrecision(3),'end');
  const series=c.series?.length?c.series:[{values}];
  series.forEach((s,k)=>{
    const paint=series.length===1?color:escapeXml(s.color||`hsl(${k*67+220} 55% 48%)`),xx=i=>x(i)+(k-(series.length-1)/2)*cell*.6/series.length;
    if(c.chartType==='line')markup+=`<polyline points="${s.values.map((v,i)=>`${x(i)},${y(v)}`).join(' ')}" fill="none" stroke="${paint}" stroke-width="2"/>`;
    markup+=s.values.map((v,i)=>(c.chartType==='line'?`<circle cx="${x(i)}" cy="${y(v)}" r="3" fill="${paint}"/>`:`<rect data-value="${v}" x="${xx(i)-cell*.3/series.length}" y="${Math.min(y(v),zero)}" width="${cell*.6/series.length}" height="${Math.abs(y(v)-zero)}" fill="${paint}"/>`)+text(xx(i),v>=0?y(v)-font*.35:y(v)+font,v)).join('');
    if(series.length>1)markup+=text(w*.14+k*w*.3,font*2.1,s.name||`Series ${k+1}`,'start');
  });
  return `<g transform="scale(${PT_EMU})">`+markup+labels.map((v,i)=>text(x(i),h*.94,v)).join('')+'</g>';
}
export function imageContract(content = {}) {
  const raw = content.crop || [0, 0, 0, 0];
  const crop = Array.isArray(raw) ? raw.map(v => finite(v, 0)) : [0, 0, 0, 0];
  const valid = Array.isArray(raw) && raw.length === 4 && raw.every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1) && crop[0] + crop[2] < 1 && crop[1] + crop[3] < 1;
  return { version: RENDER_CONTRACT_VERSION, crop, valid, mask:imageMask(content.nativeMaskXml || content.maskXml), fit: crop.some(Boolean) ? 'crop' : ['cover', 'stretch'].includes(content.fit) ? content.fit : 'contain' };
}
/** Refresh generated native frames, including previews saved by older builds.
 * Explicit user geometry and imported originals remain authoritative. */
export function prepareNativeTextElement(element, pageHeight) {
  if(element.kind!=='text' || !element.nativeTextFrame || !element.content?.templateFit || element.userGeometry) return element;
  element.nativeTextFrame={...element.nativeTextFrame,paragraphs:(element.nativeTextFrame.paragraphs||[]).map(paragraph=>({...paragraph,
    lineSpacing:Number(paragraph.lineSpacing)>0 && Number(paragraph.lineSpacing)<1.15 ? 1.15 : paragraph.lineSpacing}))};
  const contract=textContract(element),measurement=measureText(element,contract);
  const height=Math.ceil((measurement.estimatedHeightPt*1.2+contract.margins[1]+contract.margins[3])*PT_EMU);
  if(height>element.bounds.height && element.bounds.y+height<=pageHeight)element.bounds={...element.bounds,height};
  element.textLayout=contract;
  return element;
}
export function applyRenderContract(element) {
  const originalText=element.nativeTextFrame?.paragraphs?.map(p=>p.text).join('\n');
  if(!element.nativeRef&&!(typeof originalText==='string'&&originalText===element.content?.text))element.content=ensureRichContent(element.content);
  if (['text', 'list', 'timeline', 'metric'].includes(element.kind)) {
    element.textLayout = textContract(element);
    if (element.content?.codeBlock) element.style = { ...element.style, fontFamily: element.textLayout.fontFamily };
  }
  if (element.kind === 'table') {
    element.style={...element.style,fontSizePt:finite(element.style?.fontSizePt,18),fill:element.style?.fill || '#e7e5f4',color:element.style?.color || '#111827'};
    element.tableLayout = { version: RENDER_CONTRACT_VERSION, margins: TABLE_PADDING, lineHeight: 1.18, autoFit: 'none', wrap: true };
  }
  if (element.kind === 'chart') { element.chartLayout = chartContract(element.content); element.chartLayout.svg = chartMarkup(element,element.chartLayout); }
  if (element.kind === 'image') element.imageLayout = imageContract(element.content);
  return element;
}
