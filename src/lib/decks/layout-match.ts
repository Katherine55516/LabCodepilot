import { newId } from './blocks';
import { canArrange, slotCapacity } from './component-layout';
import type { Block, OutlineCard, TemplateComponent } from './types';

/**
 * Content → template component matching. A card whose content is N short,
 * parallel items (an overview, the parts of a method, benefits, phases) is
 * drawn with one of the template's own diagram components holding exactly N
 * items, so the deck uses the template's visual vocabulary instead of only
 * its colours.
 *
 * (Scoring below is the first version; see matchComponent for the general one.)
 * Score per candidate:
 * + 1     base
 * + 0.5   body slots ↔ items with explanations ("Title: text")
 * + 0.3   numbered component ↔ ordered content (steps, phases, "first…")
 * + 0.2   radial component ↔ an overview card ("parts", "overview", 目录…)
 * − 0.4   per earlier use of the same component; − 0.6 if the previous card used it
 * A card qualifies when every item is short (≤ 90 characters; titles ≤ 48),
 * it cites no figure, and fewer than ~40% of the deck's cards use components.
 */

export interface ComponentDirective {
  component: TemplateComponent;
  items: { title: string; text?: string; mediaId?: string }[];
  score: number;
  reason: string;
  /** Figures this component shows in its picture slots (taken out of the media plan). */
  figureIds?: string[];
}
export interface MatchFigure { id: string; mediaId: string; label: string; caption: string; kind?: string; series?: string }

const ORDERED = /\b(step|steps|phase|phases|stage|stages|first|then|finally|procedure|process|roadmap|timeline)\b|步骤|阶段|首先|然后|最后|流程|路线/i;
const OVERVIEW = /\b(overview|parts?|components?|pillars?|agenda|outline|summary|key (?:ideas|points|benefits))\b|目录|部分|概览|组成|要点/i;

/** "Title: explanation" → { title, text }; plain items keep their text as the title. */
export function itemsOf(points: string[]): { title: string; text?: string }[] {
  return points.map(p => {
    const m = /^\s*([^:：]{2,48})[:：]\s*(.+)$/.exec(p);
    return m ? { title: m[1].trim(), text: m[2].trim() } : { title: p.trim() };
  });
}

const visualLen = (t: string) => [...t].reduce((n, ch) => n + (/[\u2e80-\u9fff\uac00-\ud7af\uff00-\uffef]/.test(ch) ? 2 : 1), 0);
const shortCaption = (f: MatchFigure) => {
  const words = f.caption.replace(/\s+/g, ' ').split(' ');
  return words.length > 14 ? `${words.slice(0, 14).join(' ')}…` : f.caption;
};

/**
 * One scoring for every template and component kind (no per-template rules):
 * count fit (exact, or rows/columns/grids re-arranged), body slots ↔
 * explanations, numbering ↔ order, radial ↔ overview, text length ↔ slot
 * capacity, picture slots ↔ the card's related figures, and variety.
 */
export function matchComponent(
  card: Pick<OutlineCard, 'title' | 'points' | 'figureIds'>,
  components: TemplateComponent[],
  ctx: { uses: Map<string, number>; previous?: string; usedCards: number; totalCards: number },
  figures: MatchFigure[] = [],
): ComponentDirective | null {
  if (!components.length) return null;
  // Use components wherever they fit (they carry the template's look); keep some plain cards for rhythm.
  if (ctx.usedCards >= Math.max(1, Math.round(ctx.totalCards * 0.7))) return null;
  // Figure mode: two or more related figures (one series, or one kind) fill a component's picture slots.
  const related = figures.length >= 2 && (figures.every(f => f.series && f.series === figures[0].series) || figures.every(f => f.kind && f.kind === figures[0].kind)) ? figures.slice(0, 4) : [];
  const pointItems = itemsOf(card.points);
  if (!related.length && card.figureIds?.length) return null; // a single figure stays with the media planner
  const modes: { items: { title: string; text?: string; mediaId?: string }[]; figureIds?: string[] }[] = [];
  if (related.length) modes.push({ items: related.map(f => ({ title: f.label, text: shortCaption(f), mediaId: f.mediaId })), figureIds: related.map(f => f.id) });
  if (!card.figureIds?.length && pointItems.length >= 2 && pointItems.length <= 8 && !pointItems.some(i => i.title.length > 90)) modes.push({ items: pointItems });
  const ordered = ORDERED.test(`${card.title} ${card.points.join(' ')}`);
  const overview = OVERVIEW.test(card.title);
  let best: ComponentDirective | null = null;
  for (const mode of modes) {
    const n = mode.items.length;
    const labelled = mode.items.filter(i => i.text).length >= n / 2;
    for (const c of components) {
      if (!canArrange(c, n)) continue;
      if (mode.figureIds && c.imageSlots < c.units) continue; // every item needs a picture slot
      let score = 1;
      const why: string[] = [`${c.kind}×${c.units}${n !== c.units ? `→${n}` : ''}`];
      if (n === c.units) score += 0.3; else score -= 0.15 * Math.abs(n - c.units);
      if (c.hasBody === labelled) { score += 0.4; why.push(labelled ? 'explanations fit body slots' : 'short labels'); }
      else if (c.hasBody) { score -= 0.1; why.push('some body slots empty'); }
      if (c.numbered && ordered) { score += 0.3; why.push('ordered content'); }
      if (c.kind === 'radial' && overview) { score += 0.2; why.push('overview'); }
      if (mode.figureIds) { score += 0.6; why.push(`${n} related figures in picture slots`); }
      else if (c.imageSlots) { score -= 0.1; why.push('template photos kept'); }
      // Text length against slot capacity.
      const titleCap = slotCapacity(c, 'title'), bodyCap = slotCapacity(c, 'body');
      const items = c.hasBody ? mode.items : mode.items.map(i => ({ ...i, title: i.text && !mode.figureIds ? `${i.title}: ${i.text}` : i.title, text: mode.figureIds ? i.text : undefined }));
      if (titleCap && items.some(i => visualLen(i.title) > titleCap)) { score -= 0.3; why.push('long titles'); }
      if (bodyCap && items.some(i => i.text && visualLen(i.text) > bodyCap * 1.2)) { score -= 0.2; why.push('long texts'); }
      const uses = ctx.uses.get(c.id) || 0;
      score -= uses * 0.25 + (ctx.previous === c.id ? 0.4 : 0);
      if (uses) why.push(`used ${uses}×`);
      if (!best || score > best.score) best = { component: c, items, score: Math.round(score * 100) / 100, reason: why.join(', '), ...(mode.figureIds ? { figureIds: mode.figureIds } : {}) };
    }
  }
  return best && best.score >= 0.9 ? best : null;
}

/**
 * Makes sure the written card uses the component: keeps a templateDiagram the
 * writer produced, else replaces the first list-like block (bullets, numbered,
 * steps, grid, timeline) with the component, else appends it.
 */
export function applyComponent(blocks: Block[], d: ComponentDirective): Block[] {
  const existing = blocks.find((b): b is Extract<Block, { type: 'templateDiagram' }> => b.type === 'templateDiagram');
  if (existing) {
    // Wrong component id or count from the writer → the matched one, with the writer's texts where they fit.
    // Figures are placed by the engine, never by the writer; otherwise the writer's texts win where they fit.
    const items = d.items.map((it, i) => (d.figureIds ? it : { ...it, ...(existing.items[i] ? { title: existing.items[i].title, ...(existing.items[i].text ? { text: existing.items[i].text } : {}) } : {}) }));
    if (existing.componentId === d.component.id && existing.items.length === items.length && !d.figureIds) return blocks;
    return blocks.map(b => (b === existing ? { ...existing, componentId: d.component.id, items } : b));
  }
  const diagram: Block = { id: newId('blk'), type: 'templateDiagram', componentId: d.component.id, items: d.items };
  const listIndex = blocks.findIndex(b => ['bullets', 'numbered', 'steps', 'grid', 'timeline'].includes(b.type));
  if (listIndex >= 0) {
    const list = blocks[listIndex];
    const fromList = listItems(list);
    const items = !d.figureIds && fromList.length === d.items.length ? (d.component.hasBody ? fromList : fromList.map(i => ({ title: i.text ? `${i.title}: ${i.text}` : i.title }))) : d.items;
    if (d.figureIds) return [...blocks, diagram]; // figure sets keep the written text and add the component
    return blocks.map((b, i) => (i === listIndex ? { ...diagram, items } as Block : b));
  }
  return [...blocks, diagram];
}

function listItems(b: Block): { title: string; text?: string }[] {
  switch (b.type) {
    case 'bullets': case 'numbered': return itemsOf(b.items);
    case 'steps': case 'grid': return b.items.map(i => ({ title: i.title, ...(i.text ? { text: i.text } : {}) }));
    case 'timeline': return b.items.map(i => ({ title: i.label ? `${i.label} ${i.title}` : i.title, ...(i.text ? { text: i.text } : {}) }));
    default: return [];
  }
}
