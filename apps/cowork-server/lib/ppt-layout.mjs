/** Versioned semantic layout registry. Models may suggest a role, but never
 * provide geometry. Preview, QA and exporters consume the same layout id. */
export const LAYOUT_VERSION = 2;
import { typographyPolicy } from './ppt-content-depth.mjs';
import { measureText } from './ppt/render-contract.mjs';

const COPY = Object.freeze({ titlePreferredUnits: 28, titleHardUnits: 36, titleMaxLines: 2, titleMinPt: 32 });
export const LAYOUTS = Object.freeze({
  cover: { label: '封面', minTitlePt: 38, minBodyPt: 18, maxBullets: 1, allowedBlocks: ['image'], requiredBlockType: null, copy: { ...COPY, titlePreferredUnits: 26, titleHardUnits: 32, titleMinPt: 38 } },
  summary: { label: '摘要', minTitlePt: 32, minBodyPt: 17, maxBullets: 8, allowedBlocks: ['shape'], requiredBlockType: null, copy: COPY },
  editorial: { label: '详细讲解', minTitlePt: 28, minBodyPt: 10, maxBullets: 10, allowedBlocks: ['shape', 'table', 'chart', 'image'], requiredBlockType: null, copy: { ...COPY, titleMinPt: 28 } },
  'big-number': { label: '大数字', minTitlePt: 32, minBodyPt: 20, maxBullets: 3, allowedBlocks: ['shape', 'chart'], requiredBlockType: null, copy: COPY },
  comparison: { label: '对比', minTitlePt: 32, minBodyPt: 17, maxBullets: 8, allowedBlocks: ['image', 'chart', 'table', 'shape'], requiredBlockType: null, copy: COPY },
  chart: { label: '图表', minTitlePt: 32, minBodyPt: 16, maxBullets: 3, allowedBlocks: ['chart'], requiredBlockType: 'chart', copy: COPY },
  table: { label: '表格', minTitlePt: 32, minBodyPt: 13, maxBullets: 3, allowedBlocks: ['table'], requiredBlockType: 'table', copy: COPY },
  'image-text': { label: '图文', minTitlePt: 32, minBodyPt: 17, maxBullets: 4, allowedBlocks: ['image'], requiredBlockType: 'image', copy: COPY },
  timeline: { label: '时间线', minTitlePt: 32, minBodyPt: 16, maxBullets: 8, allowedBlocks: ['shape'], requiredBlockType: null, copy: COPY },
  'two-panel': { label: '不等宽面板', minTitlePt: 28, minBodyPt: 15, maxBullets: 10, allowedBlocks: ['table','image','chart','shape'], copy: { ...COPY, titleMinPt: 28 } },
  'formula-variables': { label: '公式与变量', minTitlePt: 28, minBodyPt: 15, maxBullets: 8, allowedBlocks: ['shape','table'], copy: { ...COPY, titleMinPt: 28 } },
  'item-icons': { label: '条目与图标', minTitlePt: 28, minBodyPt: 15, maxBullets: 8, allowedBlocks: ['image','shape'], copy: { ...COPY, titleMinPt: 28 } },
  conclusion: { label: '结论', minTitlePt: 32, minBodyPt: 18, maxBullets: 5, allowedBlocks: ['shape'], requiredBlockType: null, copy: COPY },
});

export const LAYOUT_IDS = Object.freeze(Object.keys(LAYOUTS));

const timeline = /时间|计划|路线|里程碑|阶段|roadmap|timeline|milestone/i;
const comparison = /对比|比较|差异|vs\.?|versus|before|after/i;
const number = /(?:^|\s)[+−-]?\d[\d,.]*(?:%|万|亿|k|m|b)?(?:\s|$)/i;

export function chooseLayout(slide, index, total) {
  if (LAYOUTS[slide?.layoutId]) return slide.layoutId;
  const blocks = slide?.blocks || [];
  if (index === 0 || slide.copy?.role === 'cover') return 'cover';
  if (index === total - 1 || ['closing', 'conclusion'].includes(slide.copy?.role)) return 'conclusion';
  const role = slide.copy?.role || slide.role || '';
  const intent = slide.copy?.visualIntent?.type || slide.visualIntent?.type || slide.visualIntent || '';
  if (blocks.some(block => block.type === 'chart')) return 'chart';
  if (blocks.some(block => block.type === 'table')) return 'table';
  if (blocks.some(block => block.type === 'image')) return 'image-text';
  if (role === 'comparison' || intent === 'comparison' || intent === 'before-after') return 'comparison';
  if (['timeline', 'process', 'roadmap'].includes(role) || ['timeline', 'pipeline', 'process'].includes(intent)) return 'timeline';
  if (role === 'metric' && (slide?.bullets || []).length <= 2) return 'big-number';
  if (['mechanism', 'architecture', 'framework', 'case', 'runtime', 'system', 'appendix'].includes(role)) return 'editorial';
  if (slide.copy?.density === 'high' && (slide.bullets || []).length >= 3) return 'editorial';
  const searchable = `${slide?.title || ''} ${(slide?.bullets || []).join(' ')}`;
  if (timeline.test(searchable)) return 'timeline';
  if (comparison.test(searchable)) return 'comparison';
  if ((slide?.bullets || []).length <= 2 && number.test(searchable) && role === 'metric') return 'big-number';
  return 'summary';
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
      classification: { method: 'semantic-registry', role: slide.copy?.role || slide.role || 'content',
        visualIntent: slide.copy?.visualIntent?.type || slide.visualIntent?.type || 'none',
        explicitLayout: Boolean(LAYOUTS[slide.layoutId]), selectedLayout: chooseLayout(slide, index, deck.slides.length) },
    })),
  };
}

function weightedLength(value) {
  return [...String(value || '')].reduce((sum, char) => sum + (char.codePointAt(0) > 127 ? 1 : .55), 0);
}

/** A cover's title is the source's own heading: a long one steps down, as on
 * an uploaded template (coverTitleSize), to the largest size the render
 * contract measures inside the cover's 11.1 × 1.48 in title region (live
 * 2026-11-01: the JEPA paper's title could not be confirmed on Blue at 38 pt). */
const COVER_TITLE_STEPS = Object.freeze([38, 34, 32, 28]);
export function coverTitlePt(title) {
  const fits = pt => !measureText({ kind: 'text', semanticRole: 'title', bounds: { x: 0, y: 0, width: 11.1 * 914400, height: 1.48 * 914400 }, content: { text: String(title || '') }, style: { fontSizePt: pt, lineHeight: 1.05, fontWeight: 700 } }).overflow;
  return COVER_TITLE_STEPS.find(fits) ?? COVER_TITLE_STEPS.at(-1);
}

/** Whether a title fits a built-in layout's title region at that layout's
 * title size (JEPA on Blue, 2026-11-01: a figure page's "… · Figures" title
 * took three lines and failed the page). */
export function builtinTitleFits(title, layoutId = 'image-text') {
  const slide = { layoutId, title: String(title || '') }, region = regionsFor(slide).find(item => item.id === 'title');
  if (!region) return true;
  return !measureText({ kind: 'text', semanticRole: 'title', bounds: { x: 0, y: 0, width: region.w * 914400, height: region.h * 914400 }, content: { text: slide.title }, style: { fontSizePt: typographyFor(slide).titlePt, lineHeight: 1.05, fontWeight: 700 } }).overflow;
}

export function typographyFor(slide) {
  const layout = LAYOUTS[slide.layoutId] || LAYOUTS.summary;
  const titleWeight = weightedLength(slide.title);
  // Copy fitting must rewrite before it shrinks. The renderer therefore only
  // has a small 36→34 adjustment and never falls below the 32pt contract.
  const titlePt = slide.layoutId === 'editorial' ? (titleWeight <= layout.copy.titlePreferredUnits ? 32 : 30)
    : slide.layoutId === 'cover' ? coverTitlePt(slide.title)
    : Math.max(layout.minTitlePt, titleWeight <= layout.copy.titlePreferredUnits ? 36 : 34);
  const bulletWeight = (slide.bullets || []).reduce((sum, bullet) => sum + weightedLength(bullet), 0);
  const bodyPt = slide.layoutId === 'table' ? 14
    : Math.max(layout.minBodyPt, bulletWeight <= 90 ? 21 : bulletWeight <= 150 ? 18 : layout.minBodyPt);
  return { titlePt, bodyPt, tableHeaderPt: 14, tableBodyPt: 13, chartLabelPt: 10,
    ...typographyPolicy(slide) };
}

/** Inches on a 13.333 × 7.5 canvas. Regions intentionally leave gutters so
 * the deterministic overlap check can use the same contract as exporters. */
export function regionsFor(slide) {
  const id = slide.layoutId || 'summary';
  const common = [
    { id: 'eyebrow', x: .86, y: .34, w: 11.55, h: .22 },
    { id: 'title', x: .86, y: .68, w: 11.55, h: 1.16 },
    { id: 'subtitle', x: .86, y: 1.86, w: 11.55, h: .36 },
    { id: 'footer', x: 11.9, y: 7.03, w: .52, h: .28 },
  ];
  const sourceFigure=slide.sourceImageIds?.length||(slide.nodes||slide.sourceArtifactNodes||[]).some(node=>node.type==='image'&&node.content?.sourceImageId);
  if(id==='cover'&&sourceFigure)return [
    {id:'eyebrow',x:1.1,y:.3,w:11.1,h:.22},
    {id:'title',x:1.1,y:.62,w:11.1,h:1.48},
    {id:'subtitle',x:1.1,y:2.12,w:11.1,h:.28},
    {id:'body',x:1.1,y:2.48,w:11.1,h:4.23},common[3],
  ];
  if (id === 'cover') return [
    { id: 'eyebrow', x: 1.1, y: 1.86, w: 11.1, h: .22 },
    { id: 'title', x: 1.1, y: 2.22, w: 11.1, h: 1.48 },
    { id: 'subtitle', x: 1.1, y: 3.78, w: 11.1, h: .36 },
    { id: 'body', x: 1.35, y: 4.18, w: 10.6, h: .85 },
    common[3],
  ];
  if (['two-panel','formula-variables','item-icons'].includes(id)) return [
    { id:'title',x:.86,y:.58,w:11.55,h:.9 }, {id:'body',x:.86,y:1.78,w:11.55,h:4.95}, common[3],
  ];
  if (id === 'summary' || id === 'conclusion') return [...common, { id: 'body', x: 1.0, y: 2.26, w: 11.25, h: 4.12 }, { id: 'takeaway', x: 1.0, y: 6.45, w: 11.25, h: .25 }];
  if (id === 'editorial') {
    const bodyY = 1.88;
    return [
      { id: 'eyebrow', x: .86, y: .28, w: 11.55, h: .24 },
      { id: 'title', x: .86, y: .58, w: 11.55, h: .86 },
      { id: 'subtitle', x: .86, y: 1.48, w: 11.55, h: .36 },
      { id: 'body', x: .86, y: bodyY, w: 11.55, h: 6.77 - bodyY },
      common[3],
    ];
  }
  if (id === 'big-number') return [...common,
    { id: 'primary', x: 1.0, y: 2.26, w: 11.25, h: 2.15 },
    { id: 'body', x: 1.0, y: 4.73, w: 11.25, h: 1.75 },
  ];
  if (id === 'comparison') return [...common,
    { id: 'left', x: 1.0, y: 2.26, w: 5.35, h: 4.31 },
    { id: 'right', x: 6.88, y: 2.26, w: 5.35, h: 4.31 },
  ];
  if (id === 'image-text') return [...common,
    { id: 'visual', x: 1.0, y: 2.26, w: 5.45, h: 4.31 },
    { id: 'body', x: 6.82, y: 2.26, w: 5.4, h: 4.31 },
  ];
  if (id === 'timeline') return [...common, { id: 'timeline', x: 1.0, y: 2.36, w: 11.25, h: 4.0 }];
  return [...common,
    { id: 'visual', x: 1.0, y: 2.26, w: 11.25, h: 3.42 },
    { id: 'body', x: 1.0, y: 5.88, w: 11.25, h: .82 },
  ];
}

export function layoutFor(id) { return LAYOUTS[id] || null; }
