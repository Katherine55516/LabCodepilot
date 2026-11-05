import { blockLoad, cardCapacity, newId } from './blocks';
import type { FigureKind } from './source';
import type { AccentPosition, Block, CardDimensions, CardLayout, CardMediaNote } from './types';

/**
 * Media planning: how many images a card shows and how much room they get,
 * decided from the text the card actually carries (after writing).
 *
 * Inputs are the written blocks, the figures the outline cited for the card
 * (content images from the source, in priority order) and whether a
 * decorative image (theme art, template artwork, AI image) is available.
 *
 * - fill = body text load ÷ the card's capacity with no image (1 = full).
 * - Figures beat decoration: a card that cites a figure never gets
 *   decorative art. Figures are shown whole (contain) with their caption;
 *   decoration is cropped to fill (cover).
 * - Count follows fill: ≤ 0.30 → up to 3 figures, ≤ 0.55 → 2, else 1. Extra
 *   cited figures are deferred (reported, not silently dropped).
 * - One figure sits beside the text; its share of the card follows its aspect
 *   ratio (so it fills the slot height) but never squeezes the text below the
 *   width it needs. A wide figure on a light card goes on top instead.
 * - Two or three figures form a gallery under the text, sized to the height
 *   the text leaves.
 * - Decorative art shrinks as text grows (0.5 → 0.42 → 0.34 of the card) and
 *   is dropped when the text alone fills the card.
 *
 * Relations (media-relations.ts) refine this:
 * - Figures are ordered by relevance to the card's text; a weakly related
 *   figure (relevance < 0.15 while a stronger one exists) is deferred.
 * - A gallery only joins figures of one series, or of the same kind and a
 *   similar shape; unrelated figures never share a card just to fill space.
 * - Charts and diagrams are always shown whole and get a readability floor
 *   (≥ 42% of the width beside text, else on top if wide); the text is
 *   shortened rather than the chart shrunk.
 * - Photos and screenshots whose shape is close to the slot fill it
 *   edge to edge (cover); otherwise they are shown whole.
 */

export interface PlanFigure { id: string; mediaId: string; label: string; caption: string; width?: number; height?: number; kind?: FigureKind; series?: string; relevance?: number }
export interface MediaPlanInput {
  blocks: Block[];
  index: number;
  dimensions: CardDimensions;
  /** The writer's suggested accent position. */
  suggested: AccentPosition;
  figures: PlanFigure[];
  /** A decorative image can be supplied for the accent slot. */
  decorative: boolean;
  /** Preferred side/top for decoration (template rhythm). */
  rhythm?: AccentPosition;
  /** Template artwork can fill a thin band; the value is where the template puts its bands. */
  band?: 'top' | 'bottom';
}
export interface MediaPlan {
  blocks: Block[];
  layout: Pick<CardLayout, 'accent' | 'accentSize' | 'accentFit' | 'accentCaption' | 'accentMediaId'>;
  /** The caller should put decorative media in the accent slot. */
  wantsDecoration: boolean;
  /** The caller should add a template-art band (top/bottom, height share). */
  wantsBand?: { position: 'top' | 'bottom'; size: number };
  note: CardMediaNote;
}

/** Logical canvas: 1280 wide; content height of a 16:9 card after padding. */
const CANVAS_W = 1280;
const CONTENT_H: Partial<Record<CardDimensions, number>> = { '16x9': 592, '4x3': 832, '1x1': 1152, '4x5': 1472, '9x16': 2148, a4: 1682, letter: 1528 };
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round2 = (v: number) => Math.round(v * 100) / 100;

export function textFill(blocks: Block[], dimensions: CardDimensions): number {
  const capacity = cardCapacity(dimensions, { accent: 'none', align: 'left' }) ?? 21;
  const load = blocks.reduce((sum, b) => sum + blockLoad(b, 1), 0);
  return round2(load / capacity);
}

const captionOf = (f: PlanFigure, max = 160) => {
  const text = `${f.label}. ${f.caption}`.replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
};

export function planCardMedia(input: MediaPlanInput): MediaPlan {
  const { blocks, index, dimensions } = input;
  const fill = textFill(blocks, dimensions);
  const contentH = CONTENT_H[dimensions] ?? 592;
  const cited = input.figures.map(f => f.id);
  const note = (rule: string, placed: string[]): CardMediaNote => ({ fill, figuresCited: cited, figuresPlaced: placed, figuresDeferred: cited.filter(id => !placed.includes(id)), rule });

  // ── Title card: decoration only (figures belong to the cards that discuss them). ──
  if (index === 0) {
    if (!input.decorative) return { blocks, layout: { accent: 'none' }, wantsDecoration: false, note: note('title card, no decoration available', []) };
    const accent = input.suggested === 'none' ? (input.rhythm && input.rhythm !== 'none' ? input.rhythm : 'right') : input.suggested;
    return { blocks, layout: { accent, accentSize: accent === 'background' ? undefined : 0.5, accentFit: 'cover' }, wantsDecoration: true, note: note(`title card: decorative ${accent}`, []) };
  }

  const maxFigures = fill <= 0.3 ? 3 : fill <= 0.55 ? 2 : 1;
  const aspectOf = (f: PlanFigure) => (f.width && f.height ? f.width / f.height : 1.4);
  // Most relevant first; weak ones yield when a strong one exists.
  const ranked = [...input.figures].sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0));
  const best = ranked[0]?.relevance ?? 0;
  const relevant = ranked.filter((f, i) => i === 0 || (f.relevance ?? 0) >= 0.15 || best < 0.15);
  // Only related figures share a card: same series, or same kind and similar shape as the lead.
  const lead = relevant[0];
  const related = lead ? relevant.filter((f, i) => i === 0 || (lead.series && f.series === lead.series) || (f.kind === lead.kind && Math.abs(Math.log(aspectOf(f) / aspectOf(lead))) < 0.35)) : [];
  const figures = related.slice(0, maxFigures);

  // ── Gallery: 2–3 figures under the text, at the height the text leaves. ──
  if (figures.length >= 2) {
    const captionH = 52;
    const height = Math.round(clamp(contentH * (1 - fill) - captionH - 24, 0, 320));
    if (height >= 150) {
      const gallery: Block = {
        id: newId('blk'), type: 'columns',
        columns: figures.map(f => [{ id: newId('blk'), type: 'image', mediaId: f.mediaId, alt: f.caption.slice(0, 200), caption: captionOf(f, 90), fit: 'contain', height } as Block]),
      };
      const why = lead?.series && figures.every(f => f.series === lead.series) ? `series ${lead.series}` : `same kind (${lead?.kind || 'figure'})`;
      return {
        blocks: [...blocks, gallery], layout: { accent: 'none' }, wantsDecoration: false,
        note: note(`gallery of ${figures.length}, ${why} (text fill ${fill}; image height ${height}px)`, figures.map(f => f.id)),
      };
    }
  }

  // ── One figure beside (or above) the text. ──
  const figure = figures[0];
  if (figure) {
    const aspect = aspectOf(figure);
    const detailed = figure.kind === 'chart' || figure.kind === 'diagram';
    const textNeeds = clamp(fill * 1.05, 0.42, 0.72); // share of width the text needs at this fill
    // Charts and diagrams need room to be read: a wide one goes on top when the text allows, else it keeps ≥ 42% beside the text.
    const wideOnTop = aspect >= 1.7 ? fill <= 0.5 : detailed && aspect >= 1.3 && 1 - textNeeds < 0.42 && fill <= 0.6;
    if (wideOnTop) {
      const ideal = (CANVAS_W * 0.86) / aspect / (contentH + 128);
      const size = round2(clamp(Math.min(ideal + 0.06, 1 - Math.max(0.45, fill * 1.1)), 0.28, 0.55));
      return {
        blocks, layout: { accent: 'top', accentSize: size, accentFit: 'contain', accentCaption: captionOf(figure), accentMediaId: figure.mediaId }, wantsDecoration: false,
        note: note(`wide figure on top (aspect ${round2(aspect)}, size ${size})`, [figure.id]),
      };
    }
    const ideal = (aspect * (contentH + 128) * 0.82) / CANVAS_W + 0.06;
    const floor = detailed ? 0.42 : 0.28;
    const size = round2(clamp(Math.min(ideal, Math.max(floor, 1 - textNeeds)), floor, 0.6));
    const side: AccentPosition = input.suggested === 'left' || input.suggested === 'right' ? input.suggested : index % 2 ? 'right' : 'left';
    // A photo or screenshot whose shape matches the slot may fill it (no meaningful crop).
    const slotAspect = (size * CANVAS_W) / (contentH + 128);
    const cover = !detailed && figure.kind !== 'illustration' && Math.abs(Math.log(aspect / slotAspect)) < 0.25;
    const squeezed = 1 - size < textNeeds;
    const why = [`${figure.kind || 'figure'} ${side}`, `aspect ${round2(aspect)}`, `size ${size}`, cover ? 'fills slot' : 'whole', detailed && size === floor ? 'readability floor' : '', squeezed || fill > 0.9 ? 'text needs shortening' : ''].filter(Boolean);
    const dropped = input.figures.filter(f => !figures.includes(f)).map(f => `${f.label}${related.includes(f) ? '' : relevant.includes(f) ? ' (unrelated to lead)' : ' (weakly related)'}`);
    return {
      blocks, layout: { accent: side, accentSize: size, accentFit: cover ? 'cover' : 'contain', accentCaption: captionOf(figure), accentMediaId: figure.mediaId }, wantsDecoration: false,
      note: note(`${why.join(', ')}${dropped.length ? `; deferred ${dropped.join(', ')}` : ''}`, [figure.id]),
    };
  }

  // ── Decoration only. ──
  if (!input.decorative || fill > 0.85) {
    return { blocks, layout: { accent: 'none' }, wantsDecoration: false, note: note(input.decorative ? `no decoration: text fills the card (fill ${fill})` : 'no image source', []) };
  }
  let accent: AccentPosition = input.suggested;
  // With a template, its rhythm decides: a slide position the template leaves without art stays without art.
  if (input.rhythm === 'none' && input.band !== undefined) return { blocks, layout: { accent: 'none' }, wantsDecoration: false, note: note(`no decoration (template slide has none, fill ${fill})`, []) };
  if (accent === 'none') {
    if (fill > 0.6 || !input.rhythm || input.rhythm === 'none') return { blocks, layout: { accent: 'none' }, wantsDecoration: false, note: note(`no decoration (writer chose none${input.rhythm === 'none' ? ', template slide has none' : ''}, fill ${fill})`, []) };
    accent = input.rhythm;
  } else if (input.rhythm && input.rhythm !== 'none' && accent !== 'background') accent = input.rhythm;
  if (accent === 'background' && fill > 0.35) accent = 'right';
  if (accent === 'top' && fill > 0.55) accent = 'right';
  const size = accent === 'top' ? (fill <= 0.35 ? 0.42 : 0.34) : fill <= 0.35 ? 0.5 : fill <= 0.6 ? 0.42 : 0.34;
  return {
    blocks, layout: { accent, ...(accent === 'background' ? {} : { accentSize: size }), accentFit: 'cover' }, wantsDecoration: true,
    note: note(`decorative ${accent}${accent === 'background' ? '' : ` ${size}`} (fill ${fill})`, []),
  };
}

/** Width ÷ height of the accent slot, for choosing artwork of a matching shape. */
export function slotAspect(layout: Pick<CardLayout, 'accent' | 'accentSize'>, dimensions: CardDimensions): number {
  const h = (CONTENT_H[dimensions] ?? 592) + 128;
  const share = layout.accentSize ?? (layout.accent === 'top' ? 0.38 : 0.4);
  if (layout.accent === 'top') return CANVAS_W / (h * share);
  if (layout.accent === 'background') return CANVAS_W / h;
  return (CANVAS_W * share) / h;
}

/**
 * Template look on figure cards: when a content figure takes the accent slot
 * (or a gallery takes the body), a thin band of template artwork keeps the
 * template present — the composition the template itself uses (art band on
 * top, content below). Skipped when the figure is already on top (unless the
 * template has bottom bands) or the text is dense (fill > 0.75).
 */
export function withTemplateBand(plan: MediaPlan, band: MediaPlanInput['band'], dimensions: CardDimensions): MediaPlan {
  if (!band || plan.wantsDecoration || !plan.note.figuresPlaced.length) return plan;
  const position: 'top' | 'bottom' = plan.layout.accent === 'top' ? 'bottom' : band;
  if (plan.layout.accent === 'top' && band !== 'bottom') return plan;
  // The band costs height: the text must still fit in what is left, beside the figure (if any).
  const size = plan.note.fill <= 0.4 ? 0.2 : 0.15;
  const textWidth = plan.layout.accent === 'left' || plan.layout.accent === 'right' ? 1 - (plan.layout.accentSize ?? 0.4) : 1;
  const effective = plan.note.fill / ((1 - size) * Math.min(1, textWidth / 0.6));
  if (effective > 0.85 || /text needs shortening/.test(plan.note.rule)) return { ...plan, note: { ...plan.note, rule: `${plan.note.rule}; no template band (text needs the height)` } };
  // A gallery's image height was sized for the full card; shrink it to the room the band leaves.
  const contentH = (CONTENT_H[dimensions] ?? 592);
  const blocks = plan.blocks.map(b => b.type === 'columns' ? { ...b, columns: b.columns.map(col => col.map(x => x.type === 'image' && x.height ? { ...x, height: Math.max(120, Math.round(x.height - contentH * size)) } : x)) } : b);
  return { ...plan, blocks, wantsBand: { position, size }, note: { ...plan.note, rule: `${plan.note.rule}; template band ${position} ${size}` } };
}
