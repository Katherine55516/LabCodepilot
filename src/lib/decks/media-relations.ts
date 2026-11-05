import { PNG } from 'pngjs';
import type { FigureKind, SourceFigure } from './source';

/**
 * Relations between media and content (and between media themselves), used
 * by the planner digest, the outline grounding and the media planner.
 *
 * - Kind: chart / diagram / screenshot / photo / illustration, from caption
 *   wording and pixel statistics (share of white, colour count). Charts and
 *   diagrams carry detail and must be shown whole and large enough to read;
 *   photos and screenshots tolerate cropping.
 * - Series: figures that belong together (consecutive numbers in the same
 *   section, same kind, similar shape, similar captions) — the only figures
 *   that should share a card as a gallery.
 * - Relevance: how strongly a figure belongs to a card's text (explicit
 *   citation, caption words shared with the card, home section).
 */

/** Most specific first: an explicit "drawing" or "photo" beats "results" or "environment". */
const KIND_WORDS: [FigureKind, RegExp][] = [
  ['illustration', /\b(illustration|drawing|comic|sketch|cartoon|painting)\b|插画|手绘|漫画/i],
  ['photo', /\b(photo|photograph|picture|camera|real[- ]world)\b|照片|实拍/i],
  ['chart', /\b(plot|plots|curve|curves|histogram|bar chart|line chart|scores?|accuracy|loss|reward|rewards|over (?:time|generations?|epochs?)|results?|performance|comparison|distribution|graph|trend|statistics|benchmark)\b|图表|曲线|柱状图|折线|统计|对比/i],
  ['diagram', /\b(diagram|flow|flowchart|architecture|overview|pipeline|framework|schematic|components?|structure|block diagram|workflow|process|layers?|network|shapes?)\b|示意图|流程|架构|框架|结构/i],
  ['screenshot', /\b(screenshot|screen|interactive|demo|environment|game|frames?|rendered|simulation|interface|ui|dream|driving|navigat\w*|playing|solving|track)\b|截图|界面|演示/i],
];

export interface PixelStats { whiteShare: number; colors: number; colorfulness: number }

/** Cheap pixel statistics of a PNG (sampled): share of near-white pixels, distinct colours (4-bit), mean chroma. */
export function pixelStats(png: Buffer): PixelStats | null {
  try {
    const img = PNG.sync.read(png);
    const total = img.width * img.height;
    const step = Math.max(1, Math.floor(total / 40_000));
    let white = 0, n = 0, chroma = 0;
    const palette = new Set<number>();
    for (let i = 0; i < total; i += step) {
      const o = i * 4;
      const r = img.data[o], g = img.data[o + 1], b = img.data[o + 2], a = img.data[o + 3];
      n++;
      if (a < 20 || (r > 235 && g > 235 && b > 235)) { white++; continue; }
      palette.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4));
      chroma += (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
    }
    return { whiteShare: n ? white / n : 0, colors: palette.size, colorfulness: n - white ? chroma / (n - white) : 0 };
  } catch { return null; }
}

/** Kind from caption words, checked against the pixels (a "chart" that is a full-bleed photo is a screenshot). */
export function classifyFigure(caption: string, stats: PixelStats | null): FigureKind {
  const byWords = KIND_WORDS.find(([, re]) => re.test(caption))?.[0];
  if (!stats) return byWords || 'illustration';
  const graphic = stats.whiteShare >= 0.45 && stats.colors < 900; // line art, plots, diagrams
  const pictorial = stats.whiteShare < 0.2 && stats.colors > 900; // photos, renders, screenshots
  // Charts and diagrams sit on white; a "chart" with little white is a rendered frame or screenshot.
  if (byWords === 'chart' || byWords === 'diagram') return pictorial || stats.whiteShare < 0.3 ? 'screenshot' : byWords;
  if (byWords) return byWords;
  if (graphic) return stats.colorfulness < 0.08 ? 'illustration' : 'diagram';
  return pictorial ? 'photo' : 'illustration';
}

const words = (t: string) => new Set((t.toLowerCase().match(/[a-zÀ-ɏ]{4,}|[一-鿿]{2}/g) || []).filter(w => !STOP.has(w)));
const STOP = new Set(['this', 'that', 'with', 'from', 'which', 'their', 'there', 'these', 'those', 'into', 'have', 'been', 'were', 'also', 'such', 'than', 'then', 'when', 'where', 'what', 'figure', 'shows', 'show', 'here', 'using', 'used', 'each', 'other', 'more', 'most', 'some', 'only', 'very']);
const overlap = (a: Set<string>, b: Set<string>) => {
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const w of a) if (b.has(w)) n++;
  return n / Math.sqrt(a.size * b.size);
};

/**
 * Profiles every figure (kind, from its rendered image when given) and links
 * series: neighbours by number, in the same section, of the same kind,
 * similar shape and similar caption wording.
 */
export function profileFigures(figures: SourceFigure[], images: Map<string, Buffer>): SourceFigure[] {
  const out = figures.map(f => ({ ...f, kind: classifyFigure(f.caption, images.has(f.id) ? pixelStats(images.get(f.id)!) : null) }));
  const sorted = [...out].sort((a, b) => a.number - b.number);
  let series = 0;
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1], b = sorted[i];
    const aspect = (f: SourceFigure) => (f.width && f.height ? f.width / f.height : 1);
    const sameShape = Math.abs(Math.log(aspect(a) / aspect(b))) < 0.3;
    const sameHome = a.chunkId && a.chunkId === b.chunkId;
    const similar = overlap(words(a.caption), words(b.caption)) >= 0.25;
    if (b.number - a.number <= 2 && a.kind === b.kind && sameShape && (sameHome || similar)) {
      const id = a.series || `S${++series}`;
      a.series = id; b.series = id;
    }
  }
  return out;
}

/** How strongly a figure belongs to a card's text, 0–~2. */
export function figureRelevance(figure: Pick<SourceFigure, 'label' | 'caption' | 'number' | 'chunkId'>, cardText: string, cardSources: string[] = []): number {
  const cited = new RegExp(`\\b(?:fig(?:ure)?\\.?|图)\\s*${figure.number}\\b`, 'i').test(cardText) ? 1 : 0;
  const home = figure.chunkId && cardSources.includes(figure.chunkId) ? 0.4 : 0;
  return Math.round((cited + home + overlap(words(figure.caption), words(cardText)) * 1.5) * 100) / 100;
}

/** Short label for prompts and diagnostics: "diagram, wide". */
export function figureTraits(f: Pick<SourceFigure, 'kind' | 'width' | 'height' | 'series'>): string {
  const a = f.width && f.height ? f.width / f.height : undefined;
  const shape = a === undefined ? '' : a >= 1.6 ? 'wide' : a <= 0.8 ? 'tall' : 'square-ish';
  return [f.kind, shape, f.series ? `series ${f.series}` : ''].filter(Boolean).join(', ');
}
