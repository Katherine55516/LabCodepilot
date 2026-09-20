/** Versioned semantic layout registry. Models may suggest a role, but never
 * provide geometry. Preview, QA and exporters consume the same layout id. */
export const LAYOUT_VERSION = 1;

export const LAYOUTS = Object.freeze({
  cover: { label: '封面', minTitlePt: 38, minBodyPt: 18, maxBullets: 1, allowedBlocks: [], requiredBlockType: null },
  summary: { label: '摘要', minTitlePt: 28, minBodyPt: 17, maxBullets: 5, allowedBlocks: ['shape'], requiredBlockType: null },
  'big-number': { label: '大数字', minTitlePt: 28, minBodyPt: 20, maxBullets: 3, allowedBlocks: ['shape', 'chart'], requiredBlockType: null },
  comparison: { label: '对比', minTitlePt: 28, minBodyPt: 17, maxBullets: 4, allowedBlocks: ['image', 'chart', 'table', 'shape'], requiredBlockType: null },
  chart: { label: '图表', minTitlePt: 28, minBodyPt: 16, maxBullets: 3, allowedBlocks: ['chart'], requiredBlockType: 'chart' },
  table: { label: '表格', minTitlePt: 28, minBodyPt: 13, maxBullets: 3, allowedBlocks: ['table'], requiredBlockType: 'table' },
  'image-text': { label: '图文', minTitlePt: 28, minBodyPt: 17, maxBullets: 4, allowedBlocks: ['image'], requiredBlockType: 'image' },
  timeline: { label: '时间线', minTitlePt: 28, minBodyPt: 16, maxBullets: 5, allowedBlocks: ['shape'], requiredBlockType: null },
  conclusion: { label: '结论', minTitlePt: 32, minBodyPt: 18, maxBullets: 4, allowedBlocks: ['shape'], requiredBlockType: null },
});

export const LAYOUT_IDS = Object.freeze(Object.keys(LAYOUTS));

const timeline = /时间|计划|路线|里程碑|阶段|roadmap|timeline|milestone/i;
const comparison = /对比|比较|差异|vs\.?|versus|before|after/i;
const number = /(?:^|\s)[+−-]?\d[\d,.]*(?:%|万|亿|k|m|b)?(?:\s|$)/i;

export function chooseLayout(slide, index, total) {
  if (LAYOUTS[slide?.layoutId]) return slide.layoutId;
  const blocks = slide?.blocks || [];
  if (blocks.length === 2) return 'comparison';
  if (blocks.some(block => block.type === 'chart')) return 'chart';
  if (blocks.some(block => block.type === 'table')) return 'table';
  if (blocks.some(block => block.type === 'image')) return 'image-text';
  if (index === 0) return 'cover';
  if (index === total - 1) return 'conclusion';
  const searchable = `${slide?.title || ''} ${(slide?.bullets || []).join(' ')}`;
  if (timeline.test(searchable)) return 'timeline';
  if (comparison.test(searchable)) return 'comparison';
  if ((slide?.bullets || []).length <= 2 && number.test(searchable)) return 'big-number';
  return index === 1 ? 'summary' : 'summary';
}

export function applyLayoutRegistry(deck) {
  if (!deck?.slides?.length) return deck;
  return {
    ...deck,
    schemaVersion: Math.max(2, Number(deck.schemaVersion) || 1),
    layoutVersion: LAYOUT_VERSION,
    slides: deck.slides.map((slide, index) => ({
      ...slide,
      layoutId: chooseLayout(slide, index, deck.slides.length),
    })),
  };
}

function weightedLength(value) {
  return [...String(value || '')].reduce((sum, char) => sum + (char.codePointAt(0) > 127 ? 1 : .55), 0);
}

export function typographyFor(slide) {
  const layout = LAYOUTS[slide.layoutId] || LAYOUTS.summary;
  const titleWeight = weightedLength(slide.title);
  const titlePt = Math.max(layout.minTitlePt, titleWeight <= 28 ? 36 : titleWeight <= 48 ? 30 : 28);
  const bulletWeight = (slide.bullets || []).reduce((sum, bullet) => sum + weightedLength(bullet), 0);
  const bodyPt = Math.max(layout.minBodyPt, bulletWeight <= 90 ? 21 : bulletWeight <= 150 ? 18 : layout.minBodyPt);
  return { titlePt, bodyPt, tableHeaderPt: 14, tableBodyPt: 13, chartLabelPt: 10 };
}

/** Inches on a 13.333 × 7.5 canvas. Regions intentionally leave gutters so
 * the deterministic overlap check can use the same contract as exporters. */
export function regionsFor(slide) {
  const id = slide.layoutId || 'summary';
  const common = [
    { id: 'title', x: .86, y: .72, w: 11.55, h: 1.18 },
    { id: 'footer', x: 11.9, y: 7.03, w: .52, h: .28 },
  ];
  if (id === 'cover') return [
    { id: 'title', x: 1.1, y: 2.25, w: 11.1, h: 1.55 },
    { id: 'body', x: 1.35, y: 4.05, w: 10.6, h: .85 },
    common[1],
  ];
  if (id === 'summary' || id === 'conclusion') return [...common, { id: 'body', x: 1.0, y: 2.15, w: 11.25, h: 4.55 }];
  if (id === 'big-number') return [...common,
    { id: 'primary', x: 1.0, y: 2.15, w: 11.25, h: 2.15 },
    { id: 'body', x: 1.0, y: 4.62, w: 11.25, h: 1.75 },
  ];
  if (id === 'comparison') return [...common,
    { id: 'left', x: 1.0, y: 2.12, w: 5.35, h: 4.45 },
    { id: 'right', x: 6.88, y: 2.12, w: 5.35, h: 4.45 },
  ];
  if (id === 'image-text') return [...common,
    { id: 'visual', x: 1.0, y: 2.12, w: 5.45, h: 4.45 },
    { id: 'body', x: 6.82, y: 2.12, w: 5.4, h: 4.45 },
  ];
  if (id === 'timeline') return [...common, { id: 'timeline', x: 1.0, y: 2.25, w: 11.25, h: 4.1 }];
  return [...common,
    { id: 'visual', x: 1.0, y: 2.02, w: 11.25, h: 3.62 },
    { id: 'body', x: 1.0, y: 5.85, w: 11.25, h: .86 },
  ];
}

export function layoutFor(id) { return LAYOUTS[id] || null; }
