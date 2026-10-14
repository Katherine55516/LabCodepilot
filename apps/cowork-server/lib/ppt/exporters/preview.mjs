import { textContract, imageContract, chartContract, chartMarkup } from '../render-contract.mjs';
import { SLIDE_SIZE } from '../render-tree.mjs';
import { equationContent } from '../../ppt-math.mjs';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const lines = element => element.kind === 'text' ? [element.content?.text || ''] : ['timeline','list'].includes(element.kind) ? textContract(element).paragraphs.map(p=>p.text) : (element.content?.items || []).map(item=>item.text);
const HANT = /[萬與為於後臺國學實體廣應當復雜雙發變這個們體繁臺灣]/;

function richHtml(rich){
  return rich.runs.map(run=>run.kind==='math'&&run.status==='native_math'?equationContent(run.tex,{displayMode:Boolean(run.display)}).mathMl || esc(run.source):'<span style="'+(run.bold?'font-weight:700;':'')+(run.italic?'font-style:italic;':'')+(run.strike?'text-decoration:line-through;':'')+(run.code?'font-family:Consolas,monospace;':'')+'">'+esc(run.text)+'</span>').join('');
}

function chart(element, x, y) {
  const axis=element.chartLayout || chartContract(element.content);
  return `<g transform="translate(${x} ${y})">${axis.svg ?? chartMarkup(element,axis)}</g>`;
}

function table(element, x, y, w, h) {
  const rows = element.content?.rows || []; const columns = rows[0]?.length || 0; if (!rows.length || !columns) return '';
  const weights=element.content?.columnWeights || Array(columns).fill(1), sum=weights.reduce((a,b)=>a+b,0);
  const rowWeights=element.content?.rowWeights || Array(rows.length).fill(1), rowSum=rowWeights.reduce((a,b)=>a+b,0);
  const font=Number(element.style?.fontSizePt || 14)*96/72;
  let cy=y; let result='';
  rows.forEach((row,rowIndex)=>{ let cx=x; const cellH=h*rowWeights[rowIndex]/rowSum;
    row.forEach((cell,columnIndex)=>{const cellW=w*weights[columnIndex]/sum;
      result+=`<rect x="${cx}" y="${cy}" width="${cellW}" height="${cellH}" fill="${rowIndex===0?esc(element.style?.fill||'#e7e5f4'):'#ffffff'}" stroke="#777777" stroke-width="9525" stroke-opacity=".35"/><foreignObject x="${cx}" y="${cy}" width="${cellW}" height="${cellH}"><div xmlns="http://www.w3.org/1999/xhtml" style="box-sizing:border-box;width:${cellW/9525}px;height:${cellH/9525}px;overflow:hidden;transform:scale(9525);transform-origin:top left;padding:4px 9.6px;white-space:pre-wrap;overflow-wrap:anywhere;font-family:${esc(element.style?.fontFamily||'sans-serif')},'${esc(element.style?.eastAsiaFontFamily||'sans-serif')}',sans-serif;font-size:${font}px;line-height:1.18;font-weight:${rowIndex===0?700:400};color:${esc((rowIndex===0?element.style?.tableHeaderColor:null)||element.style?.color||'#111827')}">${element.content?.cellRich?.[rowIndex]?.[columnIndex]?richHtml(element.content.cellRich[rowIndex][columnIndex]):esc(cell)}</div></foreignObject>`;
      cx+=cellW; }); cy+=cellH; }); return result;
}

export function slideSvg(slide) {
  if (!slide) return null;
  const width = slide.size?.width || SLIDE_SIZE.width; const height = slide.size?.height || SLIDE_SIZE.height;
  const nodes = slide.elements.map(element => {
    const b = element.bounds; const rotation = Number(element.rotation || 0); const transform = rotation ? ` transform="rotate(${rotation} ${b.x + b.width / 2} ${b.y + b.height / 2})"` : ''; const common = `data-node-id="${esc(element.nodeId || '')}"${transform} opacity="${Number(element.style?.opacity ?? 1)}"`;
    if (['text', 'list', 'timeline', 'metric'].includes(element.kind)) {
      // Keep CSS text at a normal pixel size, then scale the HTML subtree
      // into the SVG's EMU viewBox (96 CSS pixels per inch).
      const size = Number(element.style?.fontSizePt || 18) * 96 / 72; const align = element.style?.textAlign === 'center' ? 'center' : element.style?.textAlign === 'right' ? 'right' : 'left';
      if(element.content?.mathMl){
        const math=equationContent(element.content.mathText||element.content.text).mathMl;
        if(math)return `<foreignObject ${common} x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}"><div xmlns="http://www.w3.org/1999/xhtml" style="display:flex;align-items:center;width:${b.width/9525}px;height:${b.height/9525}px;transform:scale(9525);transform-origin:top left;font-size:${size}px;color:${esc(element.style?.color||'#111111')}">${math}</div></foreignObject>`;
      }
      const text = lines(element).join('\n'); const latin = element.style?.fontFamily || 'sans-serif'; const eastAsia = HANT.test(text) ? (element.style?.eastAsiaFontFamilyHant || element.style?.eastAsiaFontFamily) : element.style?.eastAsiaFontFamily;
      const pointLayout = element.kind === 'list' ? element.content?.pointLayout : null;
      const pointHtml = pointLayout?.boxes?.length ? (element.content?.items || []).map((item, index) => {
        const box = pointLayout.boxes[index]; if (!box) return '';
        const first = String(item.text || '').split('\n');
        const structured = Boolean(item.heading || item.body);
        const heading = structured ? item.heading || '' : (first.length > 1 ? first[0] : '');
        const body = structured ? item.body || '' : (first.length > 1 ? first.slice(1).join('\n') : item.text || '');
        const fontPx = Number(pointLayout.fontSizePt || 17) * 96 / 72;
        return `<div style="position:absolute;left:${box.x * 100}%;top:${box.y * 100}%;width:${box.w * 100}%;height:${box.h * 100}%;box-sizing:border-box;overflow:hidden;border:1px solid color-mix(in srgb,currentColor 20%,transparent);border-radius:6px;padding:6.72px 10.56px 3.84px;font-size:${fontPx}px;line-height:1.18;white-space:pre-wrap;overflow-wrap:anywhere">${heading ? `<div style="font-weight:700;margin-bottom:4px">${item.headingRich?richHtml(item.headingRich):esc(heading)}</div>` : ''}<div style="white-space:pre-wrap">${item.bodyRich?richHtml(item.bodyRich):esc(body)}</div></div>`;
      }).join('') : null;
      const contract=element.textLayout || textContract(element);
      const paragraphHtml = element.content?.richText&&!element.nativeRef?richHtml(element.content.richText):pointHtml || contract.paragraphs.map((p,i)=>`<div style="white-space:pre-wrap;overflow-wrap:anywhere;${p.runs?.length?`font-size:${Math.max(...p.runs.map(r=>r.fontSizePt))*96/72}px;`:""}min-height:${p.lineHeight}em;line-height:${p.lineHeight};margin-bottom:${i===contract.paragraphs.length-1?0:p.spaceAfterPt*96/72}px">${p.runs?p.runs.map(run=>`<${run.bold?"strong":"span"} style="font-size:${run.fontSizePt*96/72}px;font-weight:${run.bold?700:400};${run.fontFamily?`font-family:&quot;${esc(run.fontFamily)}&quot;;`:""}${run.italic?"font-style:italic;":""}">${richHtml({runs:[run]})}</${run.bold?"strong":"span"}>`).join(''):esc(p.text)}</div>`).join('');
      const [ml,mt,mr,mb]=pointHtml?[0,0,0,0]:contract.margins;
      return `<foreignObject ${common} x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}"><div xmlns="http://www.w3.org/1999/xhtml" style="position:relative;box-sizing:border-box;padding:${mt*96/72}px ${mr*96/72}px ${mb*96/72}px ${ml*96/72}px;white-space:pre-wrap;overflow-wrap:${contract.overflowWrap||'anywhere'};tab-size:4;width:${b.width / 9525}px;height:${b.height / 9525}px;overflow:hidden;transform:scale(9525);transform-origin:top left;background:${esc(element.style?.fill || 'transparent')};color:${esc(element.style?.color || '#111827')};font-family:${contract.code?"'Consolas','Noto Sans Mono CJK SC','Noto Sans Mono CJK TC','DejaVu Sans Mono','Liberation Mono','Menlo',monospace":`'${esc(latin)}','${esc(eastAsia || latin)}',sans-serif`};font-size:${size}px;font-weight:${Number(element.style?.fontWeight || 400)};font-style:${esc(element.style?.fontStyle || 'normal')};line-height:${Number(element.style?.lineHeight || 1.2)};letter-spacing:${Number(element.style?.letterSpacing || 0)}px;text-align:${align}">${paragraphHtml}</div></foreignObject>`;
    }
    if (element.kind === 'image' && element.content?.dataUrl) {
      const layout=imageContract(element.content),mask=layout.mask;
      const maskId=`mask-${esc(element.id)}`;
      const maskShape=mask.kind==='ellipse'?`<ellipse cx="${b.x+b.width/2}" cy="${b.y+b.height/2}" rx="${b.width/2}" ry="${b.height/2}"/>`:mask.kind==='polygon'?`<polygon points="${mask.points.map(([x,y])=>`${b.x+x*b.width},${b.y+y*b.height}`).join(' ')}"/>`:'';
      const hasMask=mask.status==='supported'&&Boolean(maskShape),imageCommon=hasMask?'':common;
      const masked=markup=>hasMask?`<g ${common}><defs><clipPath id="${maskId}">${maskShape}</clipPath></defs><g clip-path="url(#${maskId})">${markup}</g></g>`:markup;
      const crop = element.imageLayout?.valid ? element.imageLayout.crop : element.content.crop || [0, 0, 0, 0];
      const [left, top, right, bottom] = crop.map(value => element.imageLayout?.valid ? value : Math.max(0, Math.min(.95, Number(value) || 0)));
      if (!crop.some(Boolean)) return masked(`<image ${imageCommon} href="${esc(element.content.dataUrl)}" x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" preserveAspectRatio="${(element.imageLayout || layout).fit==='cover'?'xMidYMid slice':(element.imageLayout || layout).fit==='stretch'?'none':'xMidYMid meet'}"/>`);
      const imageW = b.width / Math.max(Number.EPSILON, 1 - left - right); const imageH = b.height / Math.max(Number.EPSILON, 1 - top - bottom);
      const clipId = `clip-${esc(element.id)}`;
      return masked(`<g ${imageCommon}><defs><clipPath id="${clipId}"><rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}"/></clipPath></defs><image clip-path="url(#${clipId})" href="${esc(element.content.dataUrl)}" x="${b.x - left * imageW}" y="${b.y - top * imageH}" width="${imageW}" height="${imageH}" preserveAspectRatio="none"/></g>`);
    }
    if (element.kind === 'chart') return `<g ${common}>${chart(element, b.x, b.y, b.width, b.height)}</g>`;
    if (element.kind === 'table') return `<g ${common}>${table(element, b.x, b.y, b.width, b.height)}</g>`;
    const radius = element.content?.shape === 'ellipse' || element.style?.shape === 'ellipse' ? Math.min(b.width, b.height) / 2 : Math.min(20, b.height / 8);
    return `<rect ${common} x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" rx="${radius}" fill="${esc(element.style?.fill || (element.nativeRef ? 'none' : '#64748b'))}"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img"><rect width="100%" height="100%" fill="${esc(slide.background || '#ffffff')}"/>${nodes}</svg>`;
}
