import type { ChunkKind, SourceBlock, SourceChunk, SourceFigure } from './source';
import { tableText } from './source';
import { figureTraits } from './media-relations';

/**
 * Semantic chunking for long sources. The unit is the author's own structure
 * (sections), resized to fit a card budget:
 *
 * 1. Sections come from headings; references, acknowledgements and similar
 *    back matter are dropped (and reported), appendices are kept but weighted
 *    down, the abstract is front matter.
 * 2. Thin sections merge into a neighbour under the same top-level section,
 *    so a heading with two lines does not become a card of its own.
 * 3. Dense sections split at paragraph boundaries into balanced parts, never
 *    mid-paragraph, never separating a table from its rows.
 * 4. Each figure gets a semantic home: the chunk that cites it most
 *    ("Figure 4", "Fig. 4"; ties go to the caption's chunk), else the chunk
 *    where its caption sits.
 * 5. Cards are budgeted per chunk by size (sub-linear, so long sections do not
 *    swallow the deck) and figure count; the planner treats this as a guide.
 *
 * The planner then sees labelled chunks ([C3]) and figures ([F4]) and cites
 * them per card; the writer is grounded on the cited chunks' full text.
 */

export interface ChunkOptions { targetCards: number }
export interface ChunkResult { chunks: SourceChunk[]; figures: SourceFigure[]; dropped: { label: string; chars: number }[] }

const DROP = /^(references|bibliography|works cited|literature cited|acknowledge?ments?|funding|author contributions|conflicts? of interest|ethics statement)\b/i;
const APPENDIX = /^(appendix|appendices|supplementary|supplemental)\b/i;
const LETTER_NUMBERED = /^[A-Z](?:\.\d+)*\.?\s+\S/;
const FRONT = /^(abstract|summary|executive summary|tl;?dr)$/i;
const KIND_FACTOR: Record<ChunkKind, number> = { front: 0.5, body: 1, appendix: 0.3 };
const FIGURE_REF = /\b(?:Fig(?:ure)?s?\.?)\s*(\d{1,3})(?:\s*(?:,|and|&|–|-)\s*(\d{1,3}))?/gi;

/** "3.2. Procedure" → "Procedure" (for matching); the printed title is kept for display. */
const bare = (title: string) => title.replace(/^(?:\d+|[A-Z])(?:\.\d+)*\.?\s+/, '').trim();

type Item = { type: 'text'; text: string; page?: number } | { type: 'fig'; id: string; page?: number };
interface Section { path: string[]; title: string; kind: ChunkKind | 'drop'; items: Item[] }

const itemChars = (items: Item[]) => items.reduce((n, it) => n + (it.type === 'text' ? it.text.length : 0), 0);

export function sectionsOf(blocks: SourceBlock[]): Section[] {
  const sections: Section[] = [];
  const stack: { level: number; title: string }[] = [];
  let inAppendix = false;
  let current: Section = { path: [], title: '', kind: 'front', items: [] };
  sections.push(current);
  for (const block of blocks) {
    if (block.kind === 'heading') {
      while (stack.length && stack[stack.length - 1].level >= block.level) stack.pop();
      stack.push({ level: block.level, title: block.text });
      const titles = stack.map(s => s.title);
      const top = bare(titles[0]);
      if (block.level === 1 || stack.length === 1) inAppendix = APPENDIX.test(top) || (inAppendix && LETTER_NUMBERED.test(titles[0])) || (LETTER_NUMBERED.test(titles[0]) && /appendix/i.test(titles[0]));
      const kind: Section['kind'] = titles.some(t => DROP.test(bare(t))) ? 'drop' : inAppendix || APPENDIX.test(top) ? 'appendix' : FRONT.test(bare(block.text)) ? 'front' : 'body';
      current = { path: titles, title: block.text, kind, items: [] };
      sections.push(current);
    } else if (block.kind === 'paragraph') current.items.push({ type: 'text', text: block.text, page: block.page });
    else if (block.kind === 'table') current.items.push({ type: 'text', text: tableText(block.label, block.caption, block.rows), page: block.page });
    else current.items.push({ type: 'fig', id: block.figureId, page: block.page });
  }
  return sections.filter(s => s.items.length || s.title);
}

export function chunkSource(blocks: SourceBlock[], figuresIn: SourceFigure[], opts: ChunkOptions): ChunkResult {
  const sections = sectionsOf(blocks);
  const dropped: ChunkResult['dropped'] = [];
  const kept: Section[] = [];
  for (const s of sections) {
    if (s.kind === 'drop') {
      const chars = itemChars(s.items);
      if (chars) dropped.push({ label: bare(s.path[0] || s.title) || 'Back matter', chars });
    } else kept.push(s);
  }
  const total = kept.reduce((n, s) => n + itemChars(s.items), 0);
  const cardsForBody = Math.max(3, opts.targetCards - 1);
  const target = Math.min(4500, Math.max(700, total / cardsForBody));

  // ── Merge: heading-only sections carry into the next; thin siblings join. ──
  interface Draft { sections: Section[]; items: Item[]; kind: ChunkKind; top: string }
  const drafts: Draft[] = [];
  let carry: Section[] = [];
  for (const s of kept) {
    const chars = itemChars(s.items);
    const kind = s.kind as ChunkKind;
    if (chars < 80 && !s.items.some(i => i.type === 'fig')) { carry.push(s); continue; }
    const top = s.path[0] || '';
    const prev = drafts.at(-1);
    const prevChars = prev ? itemChars(prev.items) : 0;
    const mergeable = prev && prev.kind === kind && prev.top === top && !carry.some(c => c.path.length === 1) &&
      prevChars + chars <= target * 1.25 && (chars < target * 0.45 || prevChars < target * 0.45);
    if (mergeable) { prev.sections.push(...carry, s); prev.items.push(...s.items); }
    else drafts.push({ sections: [...carry, s], items: [...s.items], kind, top });
    carry = [];
  }
  if (carry.length && drafts.length) drafts.at(-1)!.sections.push(...carry);

  // ── Split: dense drafts at paragraph boundaries, balanced by size. ──
  const pieces: { draft: Draft; items: Item[]; part: number; parts: number }[] = [];
  for (const d of drafts) {
    const chars = itemChars(d.items);
    const parts = chars > target * 1.6 ? Math.max(2, Math.round(chars / target)) : 1;
    if (parts === 1) { pieces.push({ draft: d, items: d.items, part: 1, parts: 1 }); continue; }
    const per = chars / parts;
    let bucket: Item[] = [], size = 0, made = 0;
    for (const it of d.items) {
      const len = it.type === 'text' ? it.text.length : 0;
      if (bucket.length && size + len / 2 > per && made < parts - 1 && it.type === 'text') {
        pieces.push({ draft: d, items: bucket, part: ++made, parts }); bucket = []; size = 0;
      }
      bucket.push(it); size += len;
    }
    if (bucket.length) pieces.push({ draft: d, items: bucket, part: ++made, parts });
    for (const p of pieces.filter(x => x.draft === d)) p.parts = made;
  }

  // ── Chunks ──
  const chunks: SourceChunk[] = pieces.map((p, i) => {
    const named = p.draft.sections.filter(s => s.title);
    const leaf = named.at(-1) || p.draft.sections[0];
    const path = leaf?.path.length ? leaf.path : [];
    const titles = [...new Set(named.map(s => s.title))];
    const title = (titles.length > 1 ? `${titles[0]} … ${titles.at(-1)}` : titles[0] || (p.draft.kind === 'front' ? 'Opening' : 'Section')) + (p.parts > 1 ? ` (${p.part}/${p.parts})` : '');
    const text = p.items.filter((it): it is Extract<Item, { type: 'text' }> => it.type === 'text').map(it => it.text).join('\n\n');
    const pages = p.items.map(it => it.page).filter((n): n is number => typeof n === 'number');
    return {
      id: `C${i + 1}`, path, title: title.slice(0, 160), kind: p.draft.kind, text, chars: text.length,
      figureIds: [], refFigureIds: [], cardBudget: 0,
      ...(pages.length ? { pages: [Math.min(...pages), Math.max(...pages)] as [number, number] } : {}),
    };
  });

  // ── Figures: home = the chunk citing it most, else where its caption sits. ──
  const captionChunk = new Map<string, number>();
  pieces.forEach((p, i) => p.items.forEach(it => { if (it.type === 'fig' && !captionChunk.has(it.id)) captionChunk.set(it.id, i); }));
  const figures = figuresIn.map(f => ({ ...f }));
  for (const f of figures) {
    const counts = chunks.map(c => citations(c.text).filter(n => n === f.number).length);
    const best = Math.max(...counts, 0);
    // Ties go to the chunk holding the caption (the author placed the figure there).
    const caption = captionChunk.get(f.id);
    const home = best > 0 ? (caption !== undefined && counts[caption] === best ? caption : counts.indexOf(best)) : caption;
    if (home === undefined) continue;
    f.chunkId = chunks[home].id;
    chunks[home].figureIds.push(f.id);
    chunks.forEach((c, i) => { if (i !== home && (counts[i] > 0 || captionChunk.get(f.id) === i)) c.refFigureIds.push(f.id); });
  }

  // ── Card budget: sub-linear in size, plus room for figures; largest remainder. ──
  const weights = chunks.map(c => Math.pow(c.chars + 350 * c.figureIds.length, 0.8) * KIND_FACTOR[c.kind]);
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const budget = opts.targetCards - 1;
  const raw = weights.map(w => (w / sum) * budget);
  const base = raw.map(Math.floor);
  let left = budget - base.reduce((a, b) => a + b, 0);
  raw.map((r, i) => ({ i, frac: r - base[i] })).sort((a, b) => b.frac - a.frac).forEach(({ i }) => { if (left > 0) { base[i]++; left--; } });
  chunks.forEach((c, i) => { c.cardBudget = base[i]; });

  return { chunks, figures, dropped };
}

/** Figure numbers cited in a text ("Figure 4", "Fig. 4", "Figures 4 and 5"). */
export function citations(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(FIGURE_REF)) {
    out.push(Number(m[1]));
    if (m[2]) {
      const a = Number(m[1]), b = Number(m[2]);
      if (/[–-]/.test(m[0]) && b > a && b - a < 10) for (let n = a + 1; n <= b; n++) out.push(n);
      else out.push(b);
    }
  }
  return out;
}

/**
 * The planner's view of the source: each chunk labelled with its id, path,
 * suggested card count and figures, text trimmed to a share of `budget`
 * characters at a sentence boundary. The writer later gets the full text.
 */
export function plannerDigest(chunks: SourceChunk[], figures: SourceFigure[], budget = 60_000): string {
  const total = chunks.reduce((n, c) => n + c.chars, 0) || 1;
  const scale = Math.min(1, budget / total);
  return chunks.map(c => {
    const share = Math.max(600, Math.floor(c.chars * scale));
    const text = c.chars <= share ? c.text : `${trimAtSentence(c.text, share)} …[trimmed]`;
    const figs = c.figureIds.map(id => figures.find(f => f.id === id)).filter(Boolean) as SourceFigure[];
    const head = `[${c.id}] ${c.path.length ? c.path.join(' › ') : c.title} · ${c.kind} · ≈${c.cardBudget} card${c.cardBudget === 1 ? '' : 's'}`;
    const figLines = figs.map(f => `  [${f.id}] ${f.label}${figureTraits(f) ? ` (${figureTraits(f)})` : ''}: ${f.caption.slice(0, 220)}`);
    return [head, ...(figLines.length ? ['Figures:', ...figLines] : []), text].join('\n');
  }).join('\n\n');
}

export function trimAtSentence(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('。'), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return end > max * 0.6 ? cut.slice(0, end + 1) : cut;
}

/** The writer's grounding: the cited chunks' text, capped. */
export function sourceExcerpt(chunks: SourceChunk[], ids: string[], max = 7000): string {
  const picked = ids.map(id => chunks.find(c => c.id === id)).filter(Boolean) as SourceChunk[];
  if (!picked.length) return '';
  const per = Math.floor(max / picked.length);
  return picked.map(c => `[${c.id}] ${c.path.join(' › ') || c.title}\n${trimAtSentence(c.text, per)}`).join('\n\n');
}

/**
 * Fallback citation when the model returns none: the chunk whose words best
 * overlap the card's text (Jaccard on content words). Deterministic.
 */
export function matchChunks(cardText: string, chunks: SourceChunk[], limit = 2): string[] {
  const words = (t: string) => new Set(t.toLowerCase().match(/[a-zÀ-ɏ]{4,}|[一-鿿]{2}/g) || []);
  const card = words(cardText);
  if (!card.size) return [];
  const scored = chunks.map(c => {
    const w = words(c.text.slice(0, 6000));
    let inter = 0;
    for (const x of card) if (w.has(x)) inter++;
    return { id: c.id, score: inter / Math.sqrt(card.size * Math.max(1, w.size)) };
  }).filter(s => s.score > 0.02).sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).filter((s, i) => i === 0 || s.score > scored[0].score * 0.6).map(s => s.id);
}
