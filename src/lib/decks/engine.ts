import { blockText, cardCapacity, cardLoad, cardTitle, DEFAULT_LAYOUT, newId } from './blocks';
import { matchChunks, sourceExcerpt } from './chunking';
import type { PdfFigureImage } from './import-pdf';
import { rehostInputImages } from './media';
import { planCardMedia, slotAspect, withTemplateBand, type PlanFigure } from './media-plan';
import { figureRelevance } from './media-relations';
import { applyComponent, matchComponent, type ComponentDirective } from './layout-match';
import { resolveDeckModel, createMockModel, type DeckModel, type PlannedOutline } from './model';
import { AMOUNT_WORDS, extractImageUrls, normalizeSettings, splitByBreaks } from './settings';
import type { DeckSourceDoc } from './source';
import type { TemplateAssets } from './template-pptx';
import * as store from './store';
import { DeckConflictError } from './store';
import type {
  AccentPosition, Card, CardIssue, CardStage, CreateDeckRequest, Deck, DeckJob, DeckWarning, EditProposal, EditScope, GenerationSettings,
  JobProgress, OutlineCard, QueuedInstruction,
} from './types';

/**
 * The Decks engine: the generation workflow reconstructed from Gamma
 * (report 02): create → outline job → (author reviews the outline) → build
 * job with per-card stages queued → writing → imaging → checking → polishing →
 * done, then queued instructions run as edits. Jobs run inside the Next.js
 * server process; the registry lives on globalThis so every route module
 * shares it. A job's state is persisted after every step, so a client that
 * polls or streams always sees real progress.
 */

const CARD_CONCURRENCY = 3;

interface Registry { running: Map<string, Promise<void>>; stopping: Set<string>; booted: boolean }
const registry: Registry = ((globalThis as unknown as { __decksRegistry?: Registry }).__decksRegistry ??= { running: new Map(), stopping: new Set(), booted: false });
registry.stopping ??= new Set();

function boot() {
  if (registry.booted) return;
  registry.booted = true;
  try { store.failInterruptedJobs(); } catch { /* table may not exist in odd test setups */ }
}

export class EngineError extends Error { constructor(public status: number, message: string, public code?: string) { super(message); } }

function runDetached(jobId: string, task: () => Promise<void>) {
  const promise = task().catch(error => {
    store.updateJob(jobId, { status: 'failed', error: error instanceof Error ? error.message : String(error) });
  }).finally(() => registry.running.delete(jobId));
  registry.running.set(jobId, promise);
  return promise;
}

/** For tests: wait until every running job has settled. */
export async function waitForJobs() {
  while (registry.running.size) await Promise.allSettled([...registry.running.values()]);
}

function activeJob(deckId: string) {
  return store.latestJob(deckId, true);
}

// ── Create and outline ────────────────────────────────────────────────────

/** Server-side attachments for a new deck: figure images for a structured source, and a parsed template. */
export interface DeckAttachments { figures?: PdfFigureImage[]; template?: TemplateAssets }

/** Caps a structured source from a request (ids, sizes); media ids are only ever set by the engine. */
function cleanSourceDoc(doc: DeckSourceDoc): DeckSourceDoc {
  const str = (v: unknown, max: number) => String(v ?? '').slice(0, max);
  return {
    kind: doc.kind === 'pdf' ? 'pdf' : 'markdown',
    ...(doc.fileName ? { fileName: str(doc.fileName, 200) } : {}),
    title: str(doc.title, 300),
    ...(doc.authors ? { authors: str(doc.authors, 300) } : {}),
    ...(Number.isFinite(doc.pages) ? { pages: Number(doc.pages) } : {}),
    chunks: (Array.isArray(doc.chunks) ? doc.chunks : []).slice(0, 300).filter(c => /^C\d{1,4}$/.test(c?.id)).map(c => ({
      id: c.id, path: (Array.isArray(c.path) ? c.path : []).slice(0, 6).map(x => str(x, 200)), title: str(c.title, 200),
      kind: (['front', 'body', 'appendix'] as const).includes(c.kind) ? c.kind : 'body', text: str(c.text, 40_000), chars: Math.min(40_000, String(c.text ?? '').length),
      figureIds: (c.figureIds || []).filter(id => /^F\d{1,4}$/.test(id)).slice(0, 40), refFigureIds: (c.refFigureIds || []).filter(id => /^F\d{1,4}$/.test(id)).slice(0, 40),
      cardBudget: Math.max(0, Math.min(20, Math.round(Number(c.cardBudget) || 0))), ...(Array.isArray(c.pages) ? { pages: [Number(c.pages[0]) || 0, Number(c.pages[1]) || 0] as [number, number] } : {}),
    })),
    figures: (Array.isArray(doc.figures) ? doc.figures : []).slice(0, 200).filter(f => /^F\d{1,4}$/.test(f?.id)).map(f => ({
      id: f.id, label: str(f.label, 40), number: Number(f.number) || 0, caption: str(f.caption, 1200),
      ...(f.page ? { page: Number(f.page) } : {}), ...(f.width ? { width: Number(f.width) } : {}), ...(f.height ? { height: Number(f.height) } : {}), ...(f.chunkId ? { chunkId: str(f.chunkId, 10) } : {}),
      ...((['chart', 'diagram', 'screenshot', 'photo', 'illustration'] as const).includes(f.kind as never) ? { kind: f.kind } : {}),
      ...(f.series && /^S\d{1,4}$/.test(f.series) ? { series: f.series } : {}),
    })),
    dropped: (doc.dropped || []).slice(0, 20).map(d => ({ label: str(d.label, 120), chars: Number(d.chars) || 0 })),
    warnings: (doc.warnings || []).slice(0, 20).map(w => str(w, 300)),
  };
}

export async function createDeck(req: CreateDeckRequest, deps: { fetchImage?: Parameters<typeof rehostInputImages>[2]; attachments?: DeckAttachments } = {}): Promise<{ deck: Deck; job: DeckJob }> {
  boot();
  const warnings: DeckWarning[] = [];
  let settings: GenerationSettings;
  try { settings = normalizeSettings(req.settings || { inputText: '' }, warnings); } catch (error) { throw new EngineError(400, error instanceof Error ? error.message : String(error)); }
  const { text, urls } = extractImageUrls(settings.inputText);
  if (urls.length && !text.trim()) throw new EngineError(400, 'Add some text besides the image links.');
  settings = { ...settings, inputText: text };
  const title = (req.title || '').trim().slice(0, 200);
  const prebuilt = Array.isArray(req.outline) ? req.outline.slice(0, 100).map(card => ({
    title: String(card?.title || '').trim().slice(0, 200),
    points: Array.isArray(card?.points) ? card.points.map(p => String(p).trim().slice(0, 800)).filter(Boolean).slice(0, 12) : [],
  })).filter(card => card.title || card.points.length).map((card, i) => ({ ...card, title: card.title || `Card ${i + 1}` })) : undefined;
  if (req.outline && !prebuilt?.length) throw new EngineError(400, 'The outline has no cards.');
  const source = req.source && ['prompt', 'paste', 'import', 'api'].includes(req.source.kind) ? req.source : undefined;
  const sourceDoc = req.sourceDoc ? cleanSourceDoc(req.sourceDoc) : undefined;
  const template = deps.attachments?.template;
  if (template) settings = { ...settings, themeId: template.theme.id };
  let deck = store.insertDeck({ title: title || 'Untitled deck', status: 'outlining', settings, outline: [], cards: [], headerFooter: {}, warnings, ...(source ? { source } : {}), ...(sourceDoc ? { sourceDoc } : {}) });
  // Host the source's figures and the template's artwork as deck media.
  const figureImages = deps.attachments?.figures || [];
  if (sourceDoc && figureImages.length) {
    const hosted = new Map<string, string>();
    for (const img of figureImages.slice(0, 200)) {
      if (!sourceDoc.figures.some(f => f.id === img.figureId)) continue;
      hosted.set(img.figureId, store.insertMedia(deck.id, img.data, img.mime, 'source', { width: img.width, height: img.height, prompt: img.figureId }).id);
    }
    deck = store.updateDeck(deck.id, d => { d.sourceDoc!.figures = d.sourceDoc!.figures.map(f => (hosted.has(f.id) ? { ...f, mediaId: hosted.get(f.id) } : f)); });
  }
  if (template) {
    const accentMeta = template.images.map(img => ({ id: store.insertMedia(deck.id, img.data, img.mime, 'template', { width: img.width, height: img.height }).id, width: img.width, height: img.height, role: img.role, slide: img.slide }));
    // Diagram components: host their picture layers, then carry them on the template theme (CardView and the exporter read them there).
    const componentMedia = new Map(template.componentImages.map(img => [img.key, store.insertMedia(deck.id, img.data, img.mime, 'template', { width: img.width, height: img.height }).id]));
    // Keep every layer field (unit, picture slot) — only the zip key is swapped for the hosted media id.
    const components = template.components.map(c => ({ ...c, layers: c.layers.map(l => {
      if (l.type !== 'image') return l;
      const { key, ...rest } = l;
      return { ...rest, ...(key && componentMedia.has(key) ? { mediaId: componentMedia.get(key) } : {}) };
    }) }));
    const theme = { ...template.theme, components };
    const logoMediaId = template.logo ? store.insertMedia(deck.id, template.logo.data, template.logo.mime, 'template', { width: template.logo.width, height: template.logo.height }).id : undefined;
    deck = store.updateDeck(deck.id, d => {
      d.template = { fileName: template.fileName, theme, accentMediaIds: accentMeta.map(m => m.id), accentMeta, accentRhythm: template.rhythm, notes: template.notes, ...(logoMediaId ? { logoMediaId } : {}) };
      // The brand logo goes where the template had it (report 05 §6 header/footer logo slot).
      if (logoMediaId && template.logo) d.headerFooter = { ...d.headerFooter, [template.logo.slot]: { type: 'logo', mediaId: logoMediaId, size: 'md' } };
    });
  }
  if (urls.length) {
    const { media, skipped } = await rehostInputImages(deck.id, urls, deps.fetchImage);
    deck = store.updateDeck(deck.id, d => {
      d.inputMediaIds = media.map(m => m.id);
      if (skipped.length) d.warnings.push({ code: 'image_urls_skipped', message: `${skipped.length} image link${skipped.length > 1 ? 's were' : ' was'} not used: ${skipped.slice(0, 3).join('; ')}${skipped.length > 3 ? '; …' : ''}` });
    });
  }
  const job = startOutline(deck.id, { keepTitle: Boolean(title), ...(prebuilt ? { prebuilt: { title: title || prebuilt[0].title, cards: prebuilt } } : {}) });
  return { deck: store.getDeck(deck.id)!, job };
}

export function startOutline(deckId: string, opts: { instruction?: string; numCards?: number; keepTitle?: boolean; prebuilt?: { title: string; cards: { title: string; points: string[] }[] } } = {}): DeckJob {
  boot();
  const deck = store.getDeck(deckId);
  if (!deck) throw new EngineError(404, 'Deck not found');
  if (activeJob(deckId)) throw new EngineError(409, 'Another job is running on this deck.', 'job_in_progress');
  if (!['outlining', 'outline_ready', 'failed'].includes(deck.status)) throw new EngineError(409, 'The outline can only be rewritten before the cards are generated.');
  const previous = deck.outline;
  store.updateDeck(deckId, d => {
    d.status = 'outlining'; d.error = undefined; d.outline = [];
    if (opts.numCards) d.settings.numCards = Math.max(1, Math.min(60, Math.round(opts.numCards)));
  });
  const job = store.insertJob(deckId, 'outline', { instruction: opts.instruction || '' });
  runDetached(job.id, async () => {
    store.updateJob(job.id, { status: 'running' });
    const current = store.getDeck(deckId)!;
    const model = await resolveDeckModel(current.settings.model);
    const s = current.settings;
    let planned: PlannedOutline;
    if (opts.prebuilt) {
      // A prepared outline (import, API): the author's cards as written.
      planned = opts.prebuilt;
    } else if (s.cardSplit === 'inputTextBreaks' && s.textMode === 'preserve') {
      // The author wrote the cards; keep their text verbatim (report 03 §2).
      planned = await createMockModel().planOutline(s, s.inputText);
    } else if (current.sourceDoc?.chunks.length) {
      // Chunked source: the planner cites chunks and figures; citations are checked and completed here.
      planned = await model.planOutline(s, s.inputText, { instruction: opts.instruction, previous: opts.instruction ? previous : undefined, source: { chunks: current.sourceDoc.chunks, figures: current.sourceDoc.figures }, components: componentHints(current) });
      planned = groundOutline(planned, current.sourceDoc);
    } else {
      planned = await model.planOutline(s, s.inputText, { instruction: opts.instruction, previous: opts.instruction ? previous : undefined, components: componentHints(current) });
      if (s.cardSplit === 'inputTextBreaks') {
        const segments = splitByBreaks(s.inputText).length;
        if (planned.cards.length !== segments) {
          const verbatim = await createMockModel().planOutline(s, s.inputText);
          planned = { title: planned.title, cards: verbatim.cards };
        }
      }
    }
    const outline: OutlineCard[] = planned.cards.map(card => ({
      id: newId('oc'), title: card.title, points: card.points,
      ...(card.sources?.length ? { sourceIds: card.sources } : {}), ...(card.figures?.length ? { figureIds: card.figures } : {}),
    }));
    store.updateDeck(deckId, d => {
      d.outline = outline;
      d.status = 'outline_ready';
      d.model = model.kind;
      if (model.label) d.modelLabel = model.label;
      if (!opts.keepTitle || d.title === 'Untitled deck') d.title = planned.title || outline[0]?.title || d.title;
      d.warnings = d.warnings.filter(w => w.code !== 'demo_model');
      if (model.kind === 'mock' && process.env.DECKS_MODEL !== 'mock') d.warnings.push({ code: 'demo_model', message: 'No AI provider is configured, so the offline demo model wrote this deck. Set up a provider in Settings for real generation.' });
    });
    store.updateJob(job.id, { status: 'completed', progress: { ...store.emptyProgress(0), percent: 100 } });
    // Express mode builds straight away (Gamma 5's Express skips the plan review).
    if (s.mode === 'express' && !opts.instruction) startBuild(deckId);
  });
  return job;
}

export function saveOutline(deckId: string, outline: OutlineCard[], settings?: Partial<GenerationSettings>): Deck {
  const deck = store.getDeck(deckId);
  if (!deck) throw new EngineError(404, 'Deck not found');
  if (deck.status !== 'outline_ready') throw new EngineError(409, 'The outline is not editable now.');
  const clean = outline.slice(0, 60).map(card => ({
    id: typeof card.id === 'string' && card.id ? card.id.slice(0, 40) : newId('oc'),
    title: String(card.title || '').slice(0, 200),
    points: Array.isArray(card.points) ? card.points.map(p => String(p).slice(0, 800)).filter(Boolean).slice(0, 12) : [],
    ...(card.instruction ? { instruction: String(card.instruction).slice(0, 1000) } : {}),
    ...(Array.isArray(card.sourceIds) && card.sourceIds.length ? { sourceIds: card.sourceIds.filter(id => /^C\d{1,4}$/.test(id)).slice(0, 4) } : {}),
    ...(Array.isArray(card.figureIds) && card.figureIds.length ? { figureIds: card.figureIds.filter(id => /^F\d{1,4}$/.test(id)).slice(0, 3) } : {}),
  }));
  if (!clean.length) throw new EngineError(400, 'Keep at least one card.');
  return store.updateDeck(deckId, d => {
    d.outline = clean;
    if (settings) {
      const merged = normalizeSettings({ ...d.settings, ...settings, inputText: d.settings.inputText });
      d.settings = { ...merged, inputText: d.settings.inputText };
    }
  });
}

/** The template's diagram components, as hints for the planner (distinct by count/kind/body). */
function componentHints(deck: Deck) {
  const seen = new Set<string>();
  return (deck.template?.theme.components || []).map(c => ({ units: c.units, hasBody: c.hasBody, kind: c.kind, numbered: c.numbered }))
    .filter(h => { const k = `${h.units}|${h.kind}|${h.hasBody}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

/**
 * Checks and completes the planner's citations against the source:
 * unknown ids are dropped; a body card with no sources gets the chunks its
 * text overlaps most; each figure is used once (first card wins). If the
 * model cited no figures at all, each card takes the unused figures whose
 * home is one of its sources (one per card).
 */
export function groundOutline(planned: PlannedOutline, doc: DeckSourceDoc): PlannedOutline {
  const chunkIds = new Set(doc.chunks.map(c => c.id));
  const figureIds = new Set(doc.figures.filter(f => f.mediaId || !doc.figures.some(x => x.mediaId)).map(f => f.id));
  const used = new Set<string>();
  const modelCitedFigures = planned.cards.some(c => c.figures?.length);
  const cards = planned.cards.map((card, i) => {
    let sources = (card.sources || []).filter(id => chunkIds.has(id));
    if (!sources.length && i > 0) sources = matchChunks(`${card.title} ${card.points.join(' ')}`, doc.chunks);
    let figures = (card.figures || []).filter(id => figureIds.has(id) && !used.has(id));
    if (!modelCitedFigures && i > 0) {
      const home = doc.figures.find(f => f.chunkId && sources.includes(f.chunkId) && figureIds.has(f.id) && !used.has(f.id));
      figures = home ? [home.id] : [];
    }
    // Most relevant to the card's own words first (the media planner leads with it).
    const text = `${card.title} ${card.points.join(' ')}`;
    const rel = (id: string) => { const f = doc.figures.find(x => x.id === id); return f ? figureRelevance(f, text, sources) : 0; };
    figures = [...figures].sort((a, b) => rel(b) - rel(a));
    figures.forEach(id => used.add(id));
    return { ...card, ...(sources.length ? { sources } : {}), figures };
  });
  return { ...planned, cards };
}

// ── Build ─────────────────────────────────────────────────────────────────

function progressOf(cards: Card[], total: number): JobProgress {
  const stages = { queued: 0, writing: 0, imaging: 0, checking: 0, polishing: 0, done: 0, failed: 0 } as Record<CardStage, number>;
  for (const card of cards) stages[card.stage]++;
  const finished = stages.done + stages.failed;
  // Each card contributes partial credit by stage so percent moves smoothly.
  const weight: Record<CardStage, number> = { queued: 0, writing: 0.2, imaging: 0.55, checking: 0.75, polishing: 0.85, done: 1, failed: 1 };
  const score = cards.reduce((sum, card) => sum + weight[card.stage], 0);
  return { stages, done: finished, total, percent: total ? Math.min(99, Math.floor((score / total) * 100)) : 0 };
}

function aspectFor(accent: AccentPosition, dimensions: GenerationSettings['dimensions']) {
  if (accent === 'top') return '16:9';
  if (accent === 'background') return dimensions === '9x16' ? '9:16' : '16:9';
  return dimensions === '9x16' || dimensions === '4x5' ? '1:1' : '3:4';
}

export function startBuild(deckId: string): DeckJob {
  boot();
  const deck = store.getDeck(deckId);
  if (!deck) throw new EngineError(404, 'Deck not found');
  if (activeJob(deckId)) throw new EngineError(409, 'Another job is running on this deck.', 'job_in_progress');
  // A failed build can be retried from its outline.
  if (deck.status !== 'outline_ready' && !(deck.status === 'failed' && deck.outline.length)) throw new EngineError(409, 'Review the outline first; cards are generated from it.');
  if (!deck.outline.length) throw new EngineError(400, 'The outline is empty.');
  const cards: Card[] = deck.outline.map(() => ({ id: newId('card'), blocks: [], layout: { ...DEFAULT_LAYOUT }, hidden: false, notes: '', stage: 'queued' }));
  store.updateDeck(deckId, d => { d.cards = cards; d.status = 'generating'; d.error = undefined; }, { reason: 'Before generating cards' });
  const job = store.insertJob(deckId, 'build', {}, cards.length);
  runDetached(job.id, () => runBuild(deckId, job.id));
  return job;
}

async function runBuild(deckId: string, jobId: string) {
  store.updateJob(jobId, { status: 'running' });
  const model = await resolveDeckModel(store.getDeck(deckId)?.settings.model);
  const fallback = createMockModel();
  const start = store.getDeck(deckId)!;
  const s = start.settings;
  const outline = start.outline;
  const cardIds = start.cards.map(c => c.id);
  const unusedInput = [...(start.inputMediaIds || [])];
  let aiImageFailed = false;
  const doc = start.sourceDoc;
  const template = start.template;
  const figureById = new Map((doc?.figures || []).map(f => [f.id, f]));
  // Template artwork: the image whose shape best matches the slot, never the one used on the last two cards, least-used first.
  const artUses = new Map<string, number>();
  const recentArt: string[] = [];
  type Art = { id: string; width?: number; height?: number; role?: string; slide?: number };
  const artPool: Art[] = template?.accentMeta?.length ? template.accentMeta : (template?.accentMediaIds || []).map(id => ({ id }));
  /** Template cover art: the picture from the template's first slide, if it has one. */
  const coverArt = artPool.find(m => m.slide === 1 && m.role !== 'tile');
  /** Where the template puts thin bands of art (top unless it only has bottom strips). */
  const bandPosition: 'top' | 'bottom' | undefined = !artPool.length ? undefined : artPool.some(m => m.role === 'bottom') && !artPool.some(m => m.role === 'top') ? 'bottom' : 'top';
  const nextTemplateArt = (aspect = 0.75, roles: string[] = []) => {
    const pool = artPool;
    if (!pool.length) return undefined;
    const fresh = pool.filter(m => !recentArt.includes(m.id));
    const choices = fresh.length ? fresh : pool;
    const score = (m: Art) => {
      const a = m.width && m.height ? m.width / m.height : 1;
      return Math.abs(Math.log(a / aspect)) + (artUses.get(m.id) || 0) * 0.35 - (roles.length && m.role && roles.includes(m.role) ? 0.5 : 0);
    };
    const pick = [...choices].sort((x, y) => score(x) - score(y))[0];
    artUses.set(pick.id, (artUses.get(pick.id) || 0) + 1);
    recentArt.push(pick.id);
    if (recentArt.length > 2) recentArt.shift();
    return pick.id;
  };

  // Content → template component matching (layout-match.ts), decided in reading order before the parallel writers start.
  const directives: (ComponentDirective | null)[] = [];
  {
    const components = template?.theme.components || [];
    const uses = new Map<string, number>();
    let previous: string | undefined;
    let usedCards = 0;
    outline.forEach((oc, i) => {
      const cardFigures = (oc.figureIds || []).map(id => figureById.get(id)).filter((f): f is NonNullable<typeof f> => Boolean(f?.mediaId))
        .map(f => ({ id: f.id, mediaId: f.mediaId!, label: f.label, caption: f.caption, kind: f.kind, series: f.series }));
      const d = i === 0 ? null : matchComponent(oc, components, { uses, previous, usedCards, totalCards: outline.length }, cardFigures);
      directives.push(d);
      if (d) { uses.set(d.component.id, (uses.get(d.component.id) || 0) + 1); usedCards++; }
      previous = d?.component.id;
    });
  }

  const setStage = (cardId: string, stage: CardStage, patch: Partial<Card> = {}) => {
    const deck = store.patchCard(deckId, cardId, { ...patch, stage });
    store.updateJob(jobId, { progress: progressOf(deck.cards, deck.cards.length) });
    return deck;
  };

  const buildOne = async (index: number) => {
    const cardId = cardIds[index];
    const oc = outline[index];
    setStage(cardId, 'writing');
    let written;
    const issues: CardIssue[] = [];
    // Grounding and figures for this card (structured sources).
    const inComponent = new Set(directives[index]?.figureIds || []);
    const figures: PlanFigure[] = (oc.figureIds || []).filter(id => !inComponent.has(id)).map(id => figureById.get(id)).filter((f): f is NonNullable<typeof f> => Boolean(f?.mediaId))
      .map(f => ({ id: f.id, mediaId: f.mediaId!, label: f.label, caption: f.caption, width: f.width, height: f.height, kind: f.kind, series: f.series }));
    const [minW, maxW] = AMOUNT_WORDS[s.amount];
    const shrink = figures.length ? (figures.length > 1 ? 0.55 : 0.7) : 1;
    const directive = directives[index];
    const ctx = doc || directive ? {
      ...(directive ? { component: { id: directive.component.id, units: directive.component.units, hasBody: directive.component.hasBody, kind: directive.component.kind, items: directive.items } } : {}),
      excerpt: doc ? sourceExcerpt(doc.chunks, oc.sourceIds || []) : undefined,
      figures: figures.map(f => ({ id: f.id, label: f.label, caption: f.caption, ...(f.width && f.height ? { aspect: f.width / f.height } : {}) })),
      words: [Math.round(minW * shrink), Math.round(maxW * shrink)] as [number, number],
    } : undefined;
    try { written = await model.writeCard(s, oc, index, outline.length, start.title, ctx); }
    catch (error) {
      written = await fallback.writeCard(s, oc, index, outline.length, start.title, ctx);
      issues.push({ code: 'model_fallback', message: `The model failed on this card (${error instanceof Error ? error.message : String(error)}); a simple layout was used instead.` });
    }
    let blocks = written.blocks;
    if (directive) blocks = applyComponent(blocks, directive);
    // Relevance of each cited figure to what the card now says (media-relations.ts).
    const cardText = `${oc.title} ${oc.points.join(' ')} ${blocks.map(blockText).join(' ')}`;
    for (const f of figures) f.relevance = figureRelevance({ ...f, number: Number(f.id.slice(1)) || 0, chunkId: figureById.get(f.id)?.chunkId }, cardText, oc.sourceIds);
    // ── media plan: how many images and how much room, from the written text (media-plan.ts) ──
    const decorative = s.imageSource === 'themeAccent' || s.imageSource === 'aiGenerated' || (s.imageSource !== 'noImages' && unusedInput.length > 0) || s.imageSource === 'placeholder';
    const templateArt = Boolean(template && artPool.length && (s.imageSource === 'themeAccent' || s.imageSource === 'aiGenerated'));
    const rhythm = template?.accentRhythm.length ? template.accentRhythm[index % template.accentRhythm.length] : undefined;
    const plan = withTemplateBand(planCardMedia({
      blocks, index, dimensions: s.dimensions, figures, decorative, ...(templateArt ? { band: bandPosition } : {}),
      // The cover follows the template's cover composition (its art on top, left, right or behind).
      suggested: index === 0 && coverArt && ['top', 'left', 'right', 'background'].includes(coverArt.role || '') ? coverArt.role as AccentPosition : written.accent,
      rhythm,
    }), templateArt && rhythm !== 'none' ? bandPosition : undefined, s.dimensions);
    blocks = plan.blocks;
    const layout: Card['layout'] = { ...DEFAULT_LAYOUT, ...plan.layout };
    const mediaNote = plan.note;
    if (directive) {
      mediaNote.rule = `template component ${directive.component.id} (${directive.reason}, score ${directive.score}); ${mediaNote.rule}`;
      if (directive.figureIds?.length) {
        mediaNote.figuresCited = [...new Set([...directive.figureIds, ...mediaNote.figuresCited])];
        mediaNote.figuresPlaced = [...new Set([...directive.figureIds, ...mediaNote.figuresPlaced])];
      }
    }
    if (plan.wantsBand) {
      const bandArt = nextTemplateArt(1280 / (720 * plan.wantsBand.size), ['top', 'bottom']);
      if (bandArt) layout.band = { mediaId: bandArt, ...plan.wantsBand };
    }

    // ── imaging (report 04 §1–3) ──
    setStage(cardId, 'imaging', { blocks, layout });
    if (plan.wantsDecoration && layout.accent !== 'none') {
      const inputMedia = unusedInput.shift();
      const useTemplate = !inputMedia && template && (s.imageSource === 'themeAccent' || (s.imageSource === 'aiGenerated' && aiImageFailed));
      // The cover takes the template's own cover art when it has one.
      const art = useTemplate ? (index === 0 && coverArt ? (artUses.set(coverArt.id, (artUses.get(coverArt.id) || 0) + 1), coverArt.id) : nextTemplateArt(slotAspect(layout, s.dimensions), [layout.accent])) : undefined;
      if (inputMedia) layout.accentMediaId = inputMedia;
      else if (art) layout.accentMediaId = art;
      else if (s.imageSource === 'inputOnly' || s.imageSource === 'noImages') { layout.accent = 'none'; delete layout.accentSize; }
      else if (s.imageSource === 'placeholder') {
        layout.accent = 'none';
        delete layout.accentSize;
        blocks = [...blocks, { id: newId('blk'), type: 'image', alt: written.imagePrompt.slice(0, 160), fit: 'cover', placeholder: true }];
      } else if (s.imageSource === 'aiGenerated' && !aiImageFailed) {
        const prompt = [written.imagePrompt, s.imageStyle, 'no text, no letters, no watermark'].filter(Boolean).join('. ');
        const image = await model.image(prompt, aspectFor(layout.accent, s.dimensions));
        if (image) {
          const media = store.insertMedia(deckId, image.data, image.mime, 'ai', { prompt });
          layout.accentMediaId = media.id;
        } else {
          aiImageFailed = true; // fall back to theme art (or template artwork) for the rest of the deck
          const fallbackArt = nextTemplateArt(slotAspect(layout, s.dimensions));
          if (fallbackArt) layout.accentMediaId = fallbackArt;
          store.updateDeck(deckId, d => { if (!d.warnings.some(w => w.code === 'ai_images_unavailable')) d.warnings.push({ code: 'ai_images_unavailable', message: 'AI images could not be generated (no image provider, or the provider failed); theme artwork was used instead.' }); });
        }
      }
      // themeAccent: CardView and the exporter draw the theme art from the card id.
    }

    // ── checking + polishing (report 02 "checking" / "polishing") ──
    let card: Card = { id: cardId, blocks, layout, hidden: false, notes: '', stage: 'checking' };
    setStage(cardId, 'checking', { blocks, layout });
    const capacity = cardCapacity(s.dimensions, card.layout);
    const overflow = () => capacity !== null && cardLoad(card) > capacity;
    if (!card.blocks.length) issues.push({ code: 'empty', message: 'The card has no content.' });
    const holdsFigure = mediaNote.figuresPlaced.length > 0;
    if (overflow() && card.layout.band) {
      // The template band is the first thing to go when the text needs the room.
      card = { ...card, layout: { ...card.layout, band: undefined } };
      mediaNote.rule += ' → template band dropped (overflow)';
    }
    if (overflow()) {
      setStage(cardId, 'polishing');
      // Decoration gives way to text; a figure the card cites stays and the text is shortened instead.
      if (!holdsFigure && (card.layout.accent === 'left' || card.layout.accent === 'right' || card.layout.accent === 'top')) {
        card = { ...card, layout: { ...card.layout, accent: 'none', accentMediaId: undefined, accentSize: undefined } };
        mediaNote.rule += ' → decoration dropped (overflow)';
      }
      if (overflow()) {
        try {
          const edited = await model.editCards(s, { kind: 'card', cardId }, 'Make this card shorter so it fits on one slide. Keep every number and the main point.', [card]);
          if (edited.cards[0]?.blocks.length) card = { ...card, blocks: edited.cards[0].blocks };
        } catch { /* keep the longer card */ }
      }
      if (overflow()) issues.push({ code: 'overflow', message: 'This card has more content than fits; consider splitting it.' });
    }
    if (mediaNote.figuresDeferred.length) issues.push({ code: 'missing_image', message: `Not shown for lack of room: ${mediaNote.figuresDeferred.map(id => figureById.get(id)?.label || id).join(', ')}.` });
    setStage(cardId, 'done', { blocks: card.blocks, layout: card.layout, media: mediaNote, ...(oc.sourceIds?.length ? { sourceIds: oc.sourceIds } : {}), ...(issues.length ? { issues } : {}) });
  };

  // Bounded concurrency; cards are committed in place so reading order is kept.
  let next = 0;
  const workers = Array.from({ length: Math.min(CARD_CONCURRENCY, cardIds.length) }, async () => {
    while (next < cardIds.length && !registry.stopping.has(jobId)) {
      const index = next++;
      try { await buildOne(index); }
      catch (error) { setStage(cardIds[index], 'failed', { issues: [{ code: 'empty', message: error instanceof Error ? error.message : String(error) }] }); }
    }
  });
  await Promise.all(workers);

  const stopped = registry.stopping.delete(jobId);
  const done = store.updateDeck(deckId, d => {
    // Stop: finished cards stay; cards that never started are dropped (Gamma's Stop keeps the partial deck).
    if (stopped) d.cards = d.cards.filter(c => c.stage !== 'queued');
    d.status = 'ready';
    if (d.cards.every(c => c.stage === 'failed')) { d.status = 'failed'; d.error = 'No card could be generated.'; }
  });
  store.updateJob(jobId, { progress: progressOf(done.cards, done.cards.length) });

  // Queued instructions run after the build, in order (report 02: "Queued").
  await drainQueue(deckId, jobId, model);
  store.updateJob(jobId, { status: done.status === 'failed' ? 'failed' : 'completed', progress: { ...progressOf(store.getDeck(deckId)!.cards, done.cards.length), percent: 100 }, ...(done.status === 'failed' ? { error: done.error } : {}) });
}

async function drainQueue(deckId: string, jobId: string, model: DeckModel) {
  for (;;) {
    const job = store.getJob(jobId);
    const item = job?.queuedInstructions.find(q => q.status === 'queued');
    if (!job || !item) return;
    const mark = (status: QueuedInstruction['status']) => store.updateJob(jobId, { queued: store.getJob(jobId)!.queuedInstructions.map(q => (q.id === item.id ? { ...q, status } : q)) });
    mark('applying');
    try {
      const proposal = await proposeEdit(deckId, { kind: 'deck' }, item.text, model);
      applyProposal(deckId, proposal.id, `Queued instruction: ${item.text.slice(0, 80)}`);
      mark('applied');
    } catch { mark('failed'); }
  }
}

export function stopBuild(deckId: string): DeckJob {
  const job = activeJob(deckId);
  if (!job || job.kind !== 'build') throw new EngineError(409, 'Nothing is being generated.');
  registry.stopping.add(job.id);
  return job;
}

export function removeQueuedInstruction(deckId: string, instructionId: string): DeckJob {
  const job = store.latestJob(deckId);
  const item = job?.queuedInstructions.find(q => q.id === instructionId);
  if (!job || !item) throw new EngineError(404, 'Instruction not found');
  if (item.status !== 'queued') throw new EngineError(409, 'This instruction is already running or done.');
  store.updateJob(job.id, { queued: job.queuedInstructions.filter(q => q.id !== instructionId) });
  return store.getJob(job.id)!;
}

export function queueInstruction(deckId: string, text: string): DeckJob {
  const clean = text.trim().slice(0, 2000);
  if (!clean) throw new EngineError(400, 'Write an instruction first.');
  const job = activeJob(deckId);
  if (job && job.kind === 'build') {
    store.updateJob(job.id, { queued: [...job.queuedInstructions, { id: newId('q'), text: clean, status: 'queued' }] });
    return store.getJob(job.id)!;
  }
  // Nothing is building: run it as a deck-scope edit proposal now.
  return startEdit(deckId, { kind: 'deck' }, clean);
}

// ── AI edits (report 06 §1–2): scope first, proposal, accept or discard ──

function scopedCards(deck: Deck, scope: EditScope): Card[] {
  if (scope.kind === 'deck') return deck.cards;
  const card = deck.cards.find(c => c.id === scope.cardId);
  if (!card) throw new EngineError(404, 'Card not found');
  if (scope.kind === 'block' && !card.blocks.some(b => b.id === scope.blockId)) throw new EngineError(404, 'Block not found');
  return [card];
}

async function proposeEdit(deckId: string, scope: EditScope, instruction: string, model?: DeckModel): Promise<EditProposal> {
  const deck = store.getDeck(deckId);
  if (!deck) throw new EngineError(404, 'Deck not found');
  const before = scopedCards(deck, scope);
  const m = model || await resolveDeckModel();
  const edited = await m.editCards(deck.settings, scope, instruction, before);
  const byId = new Map(before.map(c => [c.id, c]));
  let after: Card[] = edited.cards.map(e => {
    const original = byId.get(e.id);
    const blocks = scope.kind === 'block' && original
      ? original.blocks.map(b => (b.id === scope.blockId ? e.blocks.find(x => x.id === b.id) || e.blocks[0] || b : b))
      : e.blocks;
    return { ...(original || { id: newId('card'), hidden: false, notes: '', layout: { ...DEFAULT_LAYOUT } }), blocks, stage: 'done' as const, layout: { ...(original?.layout || DEFAULT_LAYOUT), ...(e.accent ? { accent: e.accent } : {}) } };
  });
  if (scope.kind !== 'deck') after = after.slice(0, 1).map(c => ({ ...c, id: before[0].id }));
  return store.insertProposal({ deckId, scope, instruction, baseVersion: deck.version, before, after, summary: edited.summary });
}

export function startEdit(deckId: string, scope: EditScope, instruction: string): DeckJob {
  boot();
  const deck = store.getDeck(deckId);
  if (!deck) throw new EngineError(404, 'Deck not found');
  const clean = instruction.trim().slice(0, 10_000);
  if (!clean) throw new EngineError(400, 'Describe what should change.');
  if (!['ready', 'failed'].includes(deck.status)) throw new EngineError(409, 'Wait until the cards are generated.');
  // One edit at a time per deck (report 06: 409 edit_in_progress).
  if (activeJob(deckId)) throw new EngineError(409, 'Another edit is running on this deck.', 'edit_in_progress');
  scopedCards(deck, scope);
  const job = store.insertJob(deckId, 'edit', { scope, instruction: clean });
  runDetached(job.id, async () => {
    store.updateJob(job.id, { status: 'running', progress: { ...store.emptyProgress(1), percent: 20 } });
    for (const p of store.listProposals(deckId)) store.setProposalStatus(p.id, 'discarded');
    await proposeEdit(deckId, scope, clean);
    store.updateJob(job.id, { status: 'completed', progress: { ...store.emptyProgress(0), percent: 100 } });
  });
  return job;
}

export function applyProposal(deckId: string, proposalId: string, reason?: string): Deck {
  const proposal = store.getProposal(proposalId);
  if (!proposal || proposal.deckId !== deckId) throw new EngineError(404, 'Proposal not found');
  if (proposal.status !== 'proposed') throw new EngineError(409, 'This proposal was already applied or discarded.');
  try {
    const deck = store.updateDeck(deckId, d => {
      if (proposal.scope.kind === 'deck') {
        const returned = new Set(proposal.after.map(c => c.id));
        // A model that drops most cards is more likely wrong than asked to; keep the rest.
        d.cards = returned.size >= Math.ceil(proposal.before.length / 2) ? proposal.after : [...proposal.after, ...d.cards.filter(c => !returned.has(c.id))];
      } else {
        d.cards = d.cards.map(c => (c.id === proposal.after[0].id ? proposal.after[0] : c));
      }
    }, { baseVersion: proposal.baseVersion, reason: reason || `AI edit: ${proposal.instruction.slice(0, 80)}` });
    store.setProposalStatus(proposalId, 'applied');
    return deck;
  } catch (error) {
    if (error instanceof DeckConflictError) throw new EngineError(409, 'The deck changed after this edit was proposed; ask again.', 'version_conflict');
    throw error;
  }
}

export function discardProposal(deckId: string, proposalId: string): Deck {
  const proposal = store.getProposal(proposalId);
  if (!proposal || proposal.deckId !== deckId) throw new EngineError(404, 'Proposal not found');
  store.setProposalStatus(proposalId, 'discarded');
  return store.getDeck(deckId)!;
}

// ── Manual saves, versions, accents ───────────────────────────────────────

export function saveDeck(deckId: string, body: { baseVersion: number; title?: string; cards?: Card[]; headerFooter?: Deck['headerFooter']; settings?: Partial<GenerationSettings> }): Deck {
  if (!Number.isInteger(body.baseVersion)) throw new EngineError(400, 'baseVersion is required.');
  try {
    return store.updateDeck(deckId, d => {
      if (typeof body.title === 'string') d.title = body.title.trim().slice(0, 200) || d.title;
      if (Array.isArray(body.cards)) d.cards = body.cards.slice(0, 200);
      if (body.headerFooter && typeof body.headerFooter === 'object') d.headerFooter = body.headerFooter;
      if (body.settings) {
        const merged = normalizeSettings({ ...d.settings, ...body.settings, inputText: d.settings.inputText });
        d.settings = { ...merged, inputText: d.settings.inputText };
      }
    }, { baseVersion: body.baseVersion, reason: 'Edit' });
  } catch (error) {
    if (error instanceof DeckConflictError) throw new EngineError(409, error.message, 'version_conflict');
    if (error instanceof Error && error.message === 'Deck not found') throw new EngineError(404, error.message);
    throw error;
  }
}

export function restoreVersion(deckId: string, version: number): Deck {
  const doc = store.getVersionDoc(deckId, version);
  if (!doc) throw new EngineError(404, 'Version not found');
  return store.updateDeck(deckId, d => ({ ...d, title: doc.title, cards: doc.cards, headerFooter: doc.headerFooter, settings: doc.settings, outline: doc.outline, status: doc.status === 'generating' ? 'ready' : doc.status }), { reason: `Restore version ${version}` });
}

export async function changeAccent(deckId: string, cardId: string, body: { action: 'regenerate' | 'clear' | 'set'; position?: AccentPosition; mediaId?: string }): Promise<Deck> {
  const deck = store.getDeck(deckId);
  if (!deck) throw new EngineError(404, 'Deck not found');
  const card = deck.cards.find(c => c.id === cardId);
  if (!card) throw new EngineError(404, 'Card not found');
  const position: AccentPosition = body.position && ['none', 'left', 'right', 'top', 'background'].includes(body.position) ? body.position : card.layout.accent === 'none' ? 'right' : card.layout.accent;
  let layout = { ...card.layout };
  if (body.action === 'clear') layout = { ...layout, accent: 'none', accentMediaId: undefined };
  if (body.action === 'set') {
    if (!body.mediaId || !store.listMedia(deckId).some(m => m.id === body.mediaId)) throw new EngineError(400, 'Unknown image.');
    layout = { ...layout, accent: position, accentMediaId: body.mediaId };
  }
  if (body.action === 'regenerate') {
    layout = { ...layout, accent: position, accentMediaId: undefined, accentSeed: newId('seed') };
    if (deck.settings.imageSource === 'aiGenerated') {
      const model = await resolveDeckModel();
      const prompt = [cardTitle(card) || deck.title, deck.settings.imageStyle, 'no text, no letters, no watermark'].filter(Boolean).join('. ');
      const image = await model.image(prompt, aspectFor(position, deck.settings.dimensions));
      if (image) layout.accentMediaId = store.insertMedia(deckId, image.data, image.mime, 'ai', { prompt }).id;
    }
  }
  return store.updateDeck(deckId, d => { d.cards = d.cards.map(c => (c.id === cardId ? { ...c, layout } : c)); }, { reason: 'Change image' });
}

export function duplicateDeck(deckId: string): Deck {
  const deck = store.getDeck(deckId);
  if (!deck) throw new EngineError(404, 'Deck not found');
  if (deck.status === 'generating' || deck.status === 'outlining') throw new EngineError(409, 'Wait for the current job to finish.');
  const copy = store.insertDeck({ ...structuredClone(deck), id: undefined, title: `${deck.title} (copy)` });
  return copy;
}
