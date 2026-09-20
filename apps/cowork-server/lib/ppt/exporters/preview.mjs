import { SLIDE_SIZE } from '../render-tree.mjs';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const pct = (value, total) => `${(value / total) * 100}%`;

function textLines(element) {
  if (element.kind === 'text') return [element.content?.text || ''];
  if (element.kind === 'metric') return (element.content?.items || []).map((item, index) => `${index ? '' : ''}${item.text}`);
  return (element.content?.items || []).map((item, index) => element.kind === 'timeline' ? `${index + 1}. ${item.text}` : `• ${item.text}`);
}

export function slideSvg(slide) {
  if (!slide) return null;
  const nodes = slide.elements.map(element => {
    const b = element.bounds; const x = pct(b.x, SLIDE_SIZE.width); const y = pct(b.y, SLIDE_SIZE.height);
    const w = pct(b.width, SLIDE_SIZE.width); const h = pct(b.height, SLIDE_SIZE.height);
    if (['text', 'list', 'timeline', 'metric'].includes(element.kind)) {
      const lines = textLines(element); const size = Number(element.style?.fontSizePt || 18) * 1.333;
      return `<foreignObject data-node-id="${esc(element.nodeId || '')}" x="${x}" y="${y}" width="${w}" height="${h}"><div xmlns="http://www.w3.org/1999/xhtml" style="box-sizing:border-box;width:100%;height:100%;overflow:hidden;color:${esc(element.style?.color || '#111827')};font-family:${esc(element.style?.eastAsiaFontFamily || element.style?.fontFamily || 'sans-serif')};font-size:${size}px;font-weight:${Number(element.style?.fontWeight || 400)}">${lines.map(line => `<div>${esc(line)}</div>`).join('')}</div></foreignObject>`;
    }
    const fill = element.style?.fill || '#64748b';
    return `<rect data-node-id="${esc(element.nodeId || '')}" x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="${esc(fill)}" opacity="${element.kind === 'shape' ? 1 : .16}"/><text x="${x}" y="${y}" fill="#111827" font-size="14">${esc(element.kind)}</text>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SLIDE_SIZE.width} ${SLIDE_SIZE.height}" role="img"><rect width="100%" height="100%" fill="${esc(slide.background || '#ffffff')}"/>${nodes}</svg>`;
}
