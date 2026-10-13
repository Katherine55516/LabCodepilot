import { measureText, textContract, PT_EMU, CARD_PADDING } from './render-contract.mjs';
/** Fixed-slide reflow for semantic points. Values in boxes are fractions of
 * the parent list region, so browser preview and PPTX export share geometry. */
const units = value => [...String(value || '')].reduce((sum, char) => sum + (char.codePointAt(0) > 127 ? 1 : .55), 0);
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

function pointParts(item = {}) {
  if (item.heading || item.body) return { heading: String(item.heading || ''), body: String(item.body || '') };
  const [heading, ...rest] = String(item.text || '').split('\n');
  return rest.length ? { heading, body: rest.join('\n') } : { heading: '', body: heading };
}

function requiredHeight(parts, widthIn, fontSizePt, lineHeight = 1.18) {
  const element={kind:'text',bounds:{width:widthIn*72*PT_EMU,height:1e12},style:{fontSizePt,lineHeight,paragraphSpacingEm:0},content:{text:parts.body}};
  const contract=textContract(element,CARD_PADDING);
  contract.paragraphs=[...(parts.heading?[{text:parts.heading,lineHeight,spaceAfterPt:3}]:[]),{text:parts.body,lineHeight,spaceAfterPt:0}];
  return (measureText(element,contract).estimatedHeightPt+CARD_PADDING[1]+CARD_PADDING[3])/72;
}

export function layoutPoints(items = [], region = {}, options = {}) {
  if (!items.length) return { boxes: [], fontSizePt: 17, overflow: false, columns: 1 };
  const width = Math.max(.1, Number(region.w) || 11.25);
  const height = Math.max(.1, Number(region.h) || 4.12);
  const gap = .14;
  const distribution = String(options.distributionType || '');
  const parts = items.map(pointParts);
  const weights = parts.map(part => Math.max(24, units(part.body) + units(part.heading) * 1.4));
  const sorted = [...weights].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] || 1;
  // Try layout families before reducing type. Three columns are considered
  // only for short points on a wide page; deep explanations stay one column.
  const deep = /three_deep|single_deep|two_macro/u.test(distribution);
  const candidates = deep || width < 7 || items.length < 4 ? [1]
    : width >= 10 && items.length >= 6 && median < 75 ? [2, 3, 1] : [2, 1];
  const manualSize=Number(options.fontSizePt);
  const lineHeight=Number(options.lineHeight)||1.18;
  const floor = manualSize ? manualSize : options.density === 'high' || options.depth === 'detailed' ? 14 : 15;
  const preferredSize = manualSize || clamp(Math.round(18 * Number(options.bodyScale || 1)), 18, 20);
  const plans = candidates.map(columns => {
    const rows = [];
    let start = 0;
    if (columns === 2 && items.length >= 4 && weights[0] > median * 1.7) { rows.push([0]); start = 1; }
    for (let i = start; i < items.length; i += columns) rows.push(Array.from({ length: Math.min(columns, items.length - i) }, (_, j) => i + j));
    const available = Math.max(.1, height - gap * (rows.length - 1));
    const needsAt = size => rows.map(row => {
      const cellWidth = (width - gap * (row.length - 1)) / row.length;
      return Math.max(...row.map(index => requiredHeight(parts[index], cellWidth, size, lineHeight)));
    });
    let fontSizePt = preferredSize;
    let needs = needsAt(fontSizePt);
    while (fontSizePt > floor && needs.reduce((sum, value) => sum + value, 0) > available) {
      fontSizePt--;
      needs = needsAt(fontSizePt);
    }
    const neededTotal = needs.reduce((sum, value) => sum + value, 0);
    return { columns, rows, available, needs, neededTotal, fontSizePt,
      overflow: neededTotal > available };
  });
  const selected = plans.sort((a, b) => Number(a.overflow) - Number(b.overflow) ||
    b.fontSizePt - a.fontSizePt || a.neededTotal / a.available - b.neededTotal / b.available || a.columns - b.columns)[0];
  const { columns, rows, available, needs, neededTotal, fontSizePt } = selected;
  const fits = neededTotal <= available;
  const rowHeights = fits ? needs.map(need => need + (available - neededTotal) / rows.length)
    : needs.map(need => available * need / neededTotal);
  const boxes = [];
  let y = 0;
  rows.forEach((row, rowIndex) => {
    const cellWidth = (width - gap * (row.length - 1)) / row.length;
    row.forEach((itemIndex, colIndex) => boxes[itemIndex] = {
      x: (colIndex * (cellWidth + gap)) / width,
      y: y / height,
      w: cellWidth / width,
      h: rowHeights[rowIndex] / height,
    });
    y += rowHeights[rowIndex] + gap;
  });
  const overflow = !fits;
  return { boxes: boxes.map(box => ({
    x: Math.round(box.x * 10000) / 10000, y: Math.round(box.y * 10000) / 10000,
    w: Math.round(box.w * 10000) / 10000, h: Math.round(box.h * 10000) / 10000,
  })), fontSizePt: clamp(fontSizePt, floor, preferredSize), overflow,
    suggestedSplitCount: overflow ? Math.max(2, Math.ceil(neededTotal / available)) : 1, columns };
}

export const _internals = { pointParts, requiredHeight, units };
