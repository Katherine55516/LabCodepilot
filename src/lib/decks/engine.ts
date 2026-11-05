import { cardCapacity, cardLoad, cardTitle, DEFAULT_LAYOUT, newId } from './blocks';
import { rehostInputImages } from './media';
import { resolveDeckModel, createMockModel, type DeckModel } from './model';
import { extractImageUrls, normalizeSettings, splitByBreaks } from './settings';
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

export async function createDeck(req: CreateDeckRequest, deps: { fetchImage?: Parameters<typeof rehostInputImages>[2] } = {}): Promise<{ deck: Deck; job: DeckJob }> {
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
  let deck = store.insertDeck({ title: title || 'Untitled deck', status: 'outlining', settings, outline: [], cards: [], headerFooter: {}, warnings, ...(source ? { source } : {}) });
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
    const model = await resolveDeckModel();
    const s = current.settings;
    let planned;
    if (opts.prebuilt) {
      // A prepared outline (import, API): the author's cards as written.
      planned = opts.prebuilt;
    } else if (s.cardSplit === 'inputTextBreaks' && s.textMode === 'preserve') {
      // The author wrote the cards; keep their text verbatim (report 03 §2).
      planned = await createMockModel().planOutline(s, s.inputText);
    } else {
      planned = await model.planOutline(s, s.inputText, { instruction: opts.instruction, previous: opts.instruction ? previous : undefined });
      if (s.cardSplit === 'inputTextBreaks') {
        const segments = splitByBreaks(s.inputText).length;
        if (planned.cards.length !== segments) {
          const verbatim = await createMockModel().planOutline(s, s.inputText);
          planned = { title: planned.title, cards: verbatim.cards };
        }
      }
    }
    const outline: OutlineCard[] = planned.cards.map(card => ({ id: newId('oc'), title: card.title, points: card.points }));
    store.updateDeck(deckId, d => {
      d.outline = outline;
      d.status = 'outline_ready';
      d.model = model.kind;
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
  const model = await resolveDeckModel();
  const fallback = createMockModel();
  const start = store.getDeck(deckId)!;
  const s = start.settings;
  const outline = start.outline;
  const cardIds = start.cards.map(c => c.id);
  const unusedInput = [...(start.inputMediaIds || [])];
  let aiImageFailed = false;

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
    try { written = await model.writeCard(s, oc, index, outline.length, start.title); }
    catch (error) {
      written = await fallback.writeCard(s, oc, index, outline.length, start.title);
      issues.push({ code: 'model_fallback', message: `The model failed on this card (${error instanceof Error ? error.message : String(error)}); a simple layout was used instead.` });
    }
    const accent: AccentPosition = written.accent;
    let blocks = written.blocks;
    const layout = { ...DEFAULT_LAYOUT, accent };

    // ── imaging (report 04 §1–3) ──
    setStage(cardId, 'imaging', { blocks, layout });
    if (s.imageSource === 'noImages' && !unusedInput.length) layout.accent = 'none';
    else if (layout.accent !== 'none') {
      const inputMedia = unusedInput.shift();
      if (inputMedia) layout.accentMediaId = inputMedia;
      else if (s.imageSource === 'inputOnly' || s.imageSource === 'noImages') layout.accent = 'none';
      else if (s.imageSource === 'placeholder') {
        layout.accent = 'none';
        blocks = [...blocks, { id: newId('blk'), type: 'image', alt: written.imagePrompt.slice(0, 160), fit: 'cover', placeholder: true }];
      } else if (s.imageSource === 'aiGenerated' && !aiImageFailed) {
        const prompt = [written.imagePrompt, s.imageStyle, 'no text, no letters, no watermark'].filter(Boolean).join('. ');
        const image = await model.image(prompt, aspectFor(layout.accent, s.dimensions));
        if (image) {
          const media = store.insertMedia(deckId, image.data, image.mime, 'ai', { prompt });
          layout.accentMediaId = media.id;
        } else {
          aiImageFailed = true; // fall back to theme art for the rest of the deck
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
    if (overflow()) {
      setStage(cardId, 'polishing');
      if (card.layout.accent === 'left' || card.layout.accent === 'right' || card.layout.accent === 'top') card = { ...card, layout: { ...card.layout, accent: 'none', accentMediaId: undefined } };
      if (overflow()) {
        try {
          const edited = await model.editCards(s, { kind: 'card', cardId }, 'Make this card shorter so it fits on one slide. Keep every number and the main point.', [card]);
          if (edited.cards[0]?.blocks.length) card = { ...card, blocks: edited.cards[0].blocks };
        } catch { /* keep the longer card */ }
      }
      if (overflow()) issues.push({ code: 'overflow', message: 'This card has more content than fits; consider splitting it.' });
    }
    setStage(cardId, 'done', { blocks: card.blocks, layout: card.layout, ...(issues.length ? { issues } : {}) });
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
