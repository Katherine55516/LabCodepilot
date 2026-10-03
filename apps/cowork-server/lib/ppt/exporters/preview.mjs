import { SLIDE_SIZE } from '../render-tree.mjs';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const lines = element => element.kind === 'text' ? [element.content?.text || ''] : (element.content?.items || []).map((item, index) => element.kind === 'timeline' ? `${index + 1}. ${item.text}` : element.kind === 'list' ? `• ${item.text}` : item.text);
const HANT = /[萬與為於後臺國學實體廣應當復雜雙發變這個們體繁臺灣]/;

function chart(element, x, y, w, h) {
  const labels = element.content?.labels || []; const values = element.content?.values || []; const type = element.content?.chartType || 'bar'; const max = Math.max(...values.map(value => Math.abs(Number(value))), 1);
  if (type === 'pie') {
    const total = values.reduce((sum, value) => sum + Math.max(0, Number(value)), 0) || 1; let cursor = -Math.PI / 2; const cx = x + w * .38; const cy = y + h / 2; const radius = Math.min(w * .28, h * .38);
    return values.map((value, index) => { const angle = Math.max(0, Number(value)) / total * Math.PI * 2; const end = cursor + angle; const x1 = cx + Math.cos(cursor) * radius; const y1 = cy + Math.sin(cursor) * radius; const x2 = cx + Math.cos(end) * radius; const y2 = cy + Math.sin(end) * radius; const large = angle > Math.PI ? 1 : 0; const path = angle >= Math.PI * 1.999 ? `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="hsl(${index * 67} 65% 55%)"/>` : `<path d="M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 ${large} 1 ${x2} ${y2} Z" fill="hsl(${index * 67} 65% 55%)"/>`; cursor = end; return `${path}<text x="${x + w * .72}" y="${y + 18 + index * 18}" font-size="12" fill="${esc(element.style?.color || '#111827')}">${esc(labels[index])}: ${esc(value)}</text>`; }).join('');
  }
  if (type === 'line') {
    const points = values.map((value, index) => `${x + (labels.length <= 1 ? .5 : index / (labels.length - 1)) * w},${y + h * .9 - Number(value) / max * h * .72}`).join(' ');
    return `<polyline points="${points}" fill="none" stroke="${esc(element.style?.color || '#6758c8')}" stroke-width="4"/>`;
  }
  const cell = w / Math.max(1, values.length); return values.map((value, index) => { const height = Math.max(3, Math.abs(Number(value)) / max * h * .68); return `<rect x="${x + index * cell + cell * .16}" y="${y + h * .78 - height}" width="${cell * .68}" height="${height}" rx="4" fill="${esc(element.style?.fill || '#6758c8')}"/><text x="${x + index * cell + cell / 2}" y="${y + h * .92}" text-anchor="middle" font-size="11" fill="${esc(element.style?.color || '#111827')}">${esc(labels[index])}</text>`; }).join('');
}

function table(element, x, y, w, h) {
  const rows = element.content?.rows || []; const columns = rows[0]?.length || 0; if (!rows.length || !columns) return '';
  const weights=element.content?.columnWeights || Array(columns).fill(1), sum=weights.reduce((a,b)=>a+b,0);
  const rowWeights=element.content?.rowWeights || Array(rows.length).fill(1), rowSum=rowWeights.reduce((a,b)=>a+b,0);
  const font=Number(element.style?.fontSizePt || 14)*96/72;
  let cy=y; let result='';
  rows.forEach((row,rowIndex)=>{ let cx=x; const cellH=h*rowWeights[rowIndex]/rowSum;
    row.forEach((cell,columnIndex)=>{const cellW=w*weights[columnIndex]/sum;
      result+=`<rect x="${cx}" y="${cy}" width="${cellW}" height="${cellH}" fill="${rowIndex===0?esc(element.style?.fill||'#e7e5f4'):'#ffffff'}" stroke="#777777" stroke-width="9525" stroke-opacity=".35"/><foreignObject x="${cx}" y="${cy}" width="${cellW}" height="${cellH}"><div xmlns="http://www.w3.org/1999/xhtml" style="box-sizing:border-box;width:${cellW/9525}px;height:${cellH/9525}px;overflow:hidden;transform:scale(9525);transform-origin:top left;padding:4px 7px;white-space:pre-wrap;overflow-wrap:break-word;font-family:${esc(element.style?.fontFamily||'sans-serif')},'${esc(element.style?.eastAsiaFontFamily||'sans-serif')}',sans-serif;font-size:${font}px;line-height:1.18;font-weight:${rowIndex===0?700:400};color:${esc(element.style?.color||'#111827')}">${esc(cell)}</div></foreignObject>`;
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
      const text = lines(element).join('\n'); const latin = element.style?.fontFamily || 'sans-serif'; const eastAsia = HANT.test(text) ? (element.style?.eastAsiaFontFamilyHant || element.style?.eastAsiaFontFamily) : element.style?.eastAsiaFontFamily;
      const structured = element.content?.paragraphs;
      const pointLayout = element.kind === 'list' ? element.content?.pointLayout : null;
      const pointHtml = pointLayout?.boxes?.length ? (element.content?.items || []).map((item, index) => {
        const box = pointLayout.boxes[index]; if (!box) return '';
        const first = String(item.text || '').split('\n');
        const heading = item.heading || (first.length > 1 ? first[0] : '');
        const body = item.body || (first.length > 1 ? first.slice(1).join('\n') : item.text || '');
        const fontPx = Number(pointLayout.fontSizePt || 17) * 96 / 72;
        return `<div style="position:absolute;left:${box.x * 100}%;top:${box.y * 100}%;width:${box.w * 100}%;height:${box.h * 100}%;box-sizing:border-box;overflow:hidden;border:1px solid currentColor;border-radius:6px;padding:8px;font-size:${fontPx}px"><div style="font-weight:700;margin-bottom:4px">${esc(heading)}</div><div style="white-space:pre-wrap">${esc(body)}</div></div>`;
      }).join('') : null;
      const paragraphHtml = pointHtml || (Array.isArray(structured) ? structured.map((item, index) => {
        const source = (element.nativeTextFrame?.paragraphs || []).filter(row => row.text?.trim())[index];
        const sourceSpacing = Number(source?.lineSpacing);
        const nativeLine = sourceSpacing > 0 ? `line-height:${sourceSpacing};` : '';
        const nativeAfter = Number(source?.spaceAfterPt) > 0 ? `margin-bottom:${Number(source.spaceAfterPt) * 96 / 72}px;` : `margin-bottom:${Number(element.style?.paragraphSpacingEm || 0)}em;`;
        const bullet = source?.bulletChar ? `<span style="margin-right:.4em">${esc(source.bulletChar)}</span>` : '';
        const labelRun = source?.runs?.[0]; const bodyRun = source?.runs?.find((run, runIndex) => runIndex > 0 && run.text?.trim());
        const labelSize = Number(labelRun?.fontSizePt) > 0 ? `font-size:${Number(labelRun.fontSizePt) * 96 / 72}px;` : '';
        const bodySize = Number(bodyRun?.fontSizePt) > 0 ? `font-size:${Number(bodyRun.fontSizePt) * 96 / 72}px;` : '';
        const label = item.label ? `<strong style="${labelSize}">${esc(item.label)}</strong>` : '';
        const separator = item.label ? `<span style="font-weight:${bodyRun?.bold ? 700 : 400};${bodySize}">：</span>` : '';
        return `<div style="${nativeLine}${nativeAfter}">${bullet}${label}${separator}<span style="font-weight:${bodyRun?.bold ? 700 : 400};${bodySize}">${esc(item.body || '')}</span></div>`;
      }).join('') : lines(element).map((line, index) => {
        const source = element.nativeTextFrame?.paragraphs?.[index];
        const nativeLine = Number(source?.lineSpacing) > 0 ? `line-height:${Number(source.lineSpacing)};` : '';
        const nativeAfter = Number(source?.spaceAfterPt) > 0 ? `margin-bottom:${Number(source.spaceAfterPt) * 96 / 72}px;` : `margin-bottom:${Number(element.style?.paragraphSpacingEm || 0)}em;`;
        return `<div style="${nativeLine}${nativeAfter}">${esc(line)}</div>`;
      }).join(''));
      return `<foreignObject ${common} x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}"><div xmlns="http://www.w3.org/1999/xhtml" style="position:relative;box-sizing:border-box;width:${b.width / 9525}px;height:${b.height / 9525}px;overflow:hidden;transform:scale(9525);transform-origin:top left;background:${esc(element.style?.fill || 'transparent')};color:${esc(element.style?.color || '#111827')};font-family:'${esc(latin)}','${esc(eastAsia || latin)}',sans-serif;font-size:${size}px;font-weight:${Number(element.style?.fontWeight || 400)};font-style:${esc(element.style?.fontStyle || 'normal')};line-height:${Number(element.style?.lineHeight || 1.2)};letter-spacing:${Number(element.style?.letterSpacing || 0)}px;text-align:${align}">${paragraphHtml}</div></foreignObject>`;
    }
    if (element.kind === 'image' && element.content?.dataUrl) {
      const crop = element.content.crop || [0, 0, 0, 0];
      const [left, top, right, bottom] = crop.map(value => Math.max(0, Math.min(.95, Number(value) || 0)));
      if (!crop.some(Boolean)) return `<image ${common} href="${esc(element.content.dataUrl)}" x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" preserveAspectRatio="xMidYMid meet"/>`;
      const imageW = b.width / Math.max(.01, 1 - left - right); const imageH = b.height / Math.max(.01, 1 - top - bottom);
      const clipId = `clip-${esc(element.id)}`;
      return `<g ${common}><defs><clipPath id="${clipId}"><rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}"/></clipPath></defs><image clip-path="url(#${clipId})" href="${esc(element.content.dataUrl)}" x="${b.x - left * imageW}" y="${b.y - top * imageH}" width="${imageW}" height="${imageH}" preserveAspectRatio="none"/></g>`;
    }
    if (element.kind === 'chart') return `<g ${common}>${chart(element, b.x, b.y, b.width, b.height)}</g>`;
    if (element.kind === 'table') return `<g ${common}>${table(element, b.x, b.y, b.width, b.height)}</g>`;
    const radius = element.content?.shape === 'ellipse' || element.style?.shape === 'ellipse' ? Math.min(b.width, b.height) / 2 : Math.min(20, b.height / 8);
    return `<rect ${common} x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" rx="${radius}" fill="${esc(element.style?.fill || (element.nativeRef ? 'none' : '#64748b'))}"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img"><rect width="100%" height="100%" fill="${esc(slide.background || '#ffffff')}"/>${nodes}</svg>`;
}
