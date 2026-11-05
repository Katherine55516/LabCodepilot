/**
 * Decks engine: settings interpretation, the outline → build workflow with
 * per-card stages, image sources, edits with proposals / versions / conflicts,
 * queued instructions and overflow polishing. Uses a temp data dir and the
 * deterministic mock model.
 *
 * Run with: npx tsx --test src/__tests__/unit/decks-engine.test.ts
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'decks-test-'));
process.env.CLAUDE_GUI_DATA_DIR = tmp;
process.env.DECKS_MODEL = 'mock';

type Engine = typeof import('../../lib/decks/engine');
type Store = typeof import('../../lib/decks/store');
type Model = typeof import('../../lib/decks/model');
type Settings = typeof import('../../lib/decks/settings');
type Blocks = typeof import('../../lib/decks/blocks');
type Media = typeof import('../../lib/decks/media');
let engine: Engine, store: Store, model: Model, settings: Settings, blocks: Blocks, media: Media;

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000020000000308060000009a9c2b2a0000000d4944415478da63f8ffff3f0300080401fd0b3c2d6f0000000049454e44ae426082', 'hex');

before(async () => {
  engine = await import('../../lib/decks/engine');
  store = await import('../../lib/decks/store');
  model = await import('../../lib/decks/model');
  settings = await import('../../lib/decks/settings');
  blocks = await import('../../lib/decks/blocks');
  media = await import('../../lib/decks/media');
});
after(() => { model.setDeckModelForTests(null); fs.rmSync(tmp, { recursive: true, force: true }); });

async function outlined(input: Partial<import('../../lib/decks/types').GenerationSettings> & { inputText: string }, deps = {}) {
  const { deck } = await engine.createDeck({ settings: input }, deps);
  await engine.waitForJobs();
  return store.getDeck(deck.id)!;
}
async function built(input: Partial<import('../../lib/decks/types').GenerationSettings> & { inputText: string }, deps = {}) {
  const deck = await outlined(input, deps);
  engine.startBuild(deck.id);
  await engine.waitForJobs();
  return store.getDeck(deck.id)!;
}

describe('settings interpretation (report 03 §1–2)', () => {
  it('fills defaults, clamps the card count and adjusts invalid dimensions with warnings', () => {
    const warnings: { code: string; message: string }[] = [];
    const s = settings.normalizeSettings({ inputText: 'Topic', numCards: 99, format: 'social', dimensions: '16x9' }, warnings);
    assert.equal(s.numCards, 60);
    assert.equal(s.dimensions, '1x1');
    assert.equal(s.textMode, 'generate');
    assert.equal(s.imageSource, 'themeAccent');
    assert.deepEqual(warnings.map(w => w.code).sort(), ['dimensions_adjusted', 'num_cards_adjusted']);
  });
  it('defaults long input to condense and ignores tone/audience for preserve', () => {
    assert.equal(settings.normalizeSettings({ inputText: 'x'.repeat(2000) }).textMode, 'condense');
    const warnings: { code: string; message: string }[] = [];
    settings.normalizeSettings({ inputText: 'a', textMode: 'preserve', tone: 'fun' }, warnings);
    assert.equal(warnings[0].code, 'ignored_text_options');
    assert.throws(() => settings.normalizeSettings({ inputText: '   ' }), /topic/);
  });
  it('splits on --- lines: n breaks make n+1 segments', () => {
    assert.deepEqual(settings.splitByBreaks('# A\nx\n---\n# B\n  ---  \n# C'), ['# A\nx', '# B', '# C']);
  });
  it('extracts bare https image URLs only (Gamma rule)', () => {
    const { text, urls } = settings.extractImageUrls('See https://cdn.x.com/a.png, http://x.com/b.png and https://x.com/page then https://cdn.x.com/c.webp?w=2');
    assert.deepEqual(urls, ['https://cdn.x.com/a.png', 'https://cdn.x.com/c.webp?w=2']);
    assert.match(text, /http:\/\/x\.com\/b\.png/);
    assert.match(text, /https:\/\/x\.com\/page/);
  });
});

describe('outline → build workflow (report 02)', () => {
  it('plans an outline near the soft target, then builds every card through to done', async () => {
    const deck = await outlined({ inputText: 'Remote onboarding for engineers', numCards: 6 });
    assert.equal(deck.status, 'outline_ready');
    assert.ok(deck.outline.length >= 5 && deck.outline.length <= 8, `outline ${deck.outline.length}`);
    assert.equal(deck.title, 'Remote onboarding for engineers');
    assert.ok(deck.outline.every(c => c.title && Array.isArray(c.points)));

    const edited = engine.saveOutline(deck.id, [...deck.outline.slice(0, 3), { id: 'new', title: 'Our pilot plan', points: ['Week 1: shadowing', 'Week 2: first PR'], instruction: 'make it a timeline' }]);
    assert.equal(edited.outline.length, 4);

    const job = engine.startBuild(deck.id);
    assert.equal(job.kind, 'build');
    assert.throws(() => engine.startBuild(deck.id), (e: unknown) => e instanceof engine.EngineError && e.status === 409);
    await engine.waitForJobs();
    const done = store.getDeck(deck.id)!;
    assert.equal(done.status, 'ready');
    assert.equal(done.cards.length, 4);
    assert.ok(done.cards.every(c => c.stage === 'done' && c.blocks.length > 0));
    assert.equal(blocks.cardTitle(done.cards[0]), 'Remote onboarding for engineers');
    const finished = store.getJob(job.id)!;
    assert.equal(finished.status, 'completed');
    assert.equal(finished.progress.percent, 100);
    assert.equal(finished.progress.stages.done, 4);
    assert.ok(store.listVersions(deck.id).some(v => v.reason === 'Before generating cards'));
  });

  it('keeps author-written cards verbatim with inputTextBreaks + preserve', async () => {
    const deck = await outlined({ inputText: '# Title\nIntro line\n---\n# Second\n- a point\n---\n# Third\nclosing', cardSplit: 'inputTextBreaks', textMode: 'preserve', numCards: 9 });
    assert.deepEqual(deck.outline.map(c => c.title), ['Title', 'Second', 'Third']);
    assert.deepEqual(deck.outline[1].points, ['a point']);
  });

  it('honours image sources: noImages, placeholder, inputOnly with hosted input images', async () => {
    const none = await built({ inputText: 'Solar power basics', numCards: 4, imageSource: 'noImages' });
    assert.ok(none.cards.every(c => c.layout.accent === 'none'));

    const placeholder = await built({ inputText: 'Solar power basics', numCards: 4, imageSource: 'placeholder' });
    assert.ok(placeholder.cards.some(c => c.blocks.some(b => b.type === 'image' && b.placeholder)));

    const fetchImage = async (url: string) => (url.includes('ok') ? { ok: true as const, data: PNG, mime: 'image/png' } : { ok: false as const, reason: 'HTTP 404' });
    const input = await built({ inputText: 'Our office https://cdn.example.com/ok.png and https://cdn.example.com/missing.png', numCards: 3, imageSource: 'inputOnly' }, { fetchImage });
    assert.equal(input.inputMediaIds?.length, 1);
    assert.ok(input.warnings.some(w => w.code === 'image_urls_skipped' && /missing\.png \(HTTP 404\)/.test(w.message)));
    assert.equal(input.cards[0].layout.accentMediaId, input.inputMediaIds![0]);
    assert.ok(input.cards.slice(1).every(c => c.layout.accent === 'none'));
    assert.equal(store.readMedia(input.inputMediaIds![0])?.data.length, PNG.length);
    assert.doesNotMatch(input.settings.inputText, /cdn\.example\.com/);
  });
});

describe('edits, proposals and versions (report 06)', () => {
  it('proposes a scoped edit, applies it as a new version, and restores the old one', async () => {
    const deck = await built({ inputText: 'Kubernetes for beginners', numCards: 4 });
    const card = deck.cards[1];
    const job = engine.startEdit(deck.id, { kind: 'card', cardId: card.id }, 'Make it shorter');
    assert.throws(() => engine.startEdit(deck.id, { kind: 'deck' }, 'again'), (e: unknown) => e instanceof engine.EngineError && e.code === 'edit_in_progress');
    await engine.waitForJobs();
    assert.equal(store.getJob(job.id)!.status, 'completed');
    const [proposal] = store.listProposals(deck.id);
    assert.equal(proposal.before[0].id, card.id);
    assert.equal(proposal.after[0].id, card.id);
    const applied = engine.applyProposal(deck.id, proposal.id);
    assert.equal(applied.version, deck.version + 1);
    assert.throws(() => engine.applyProposal(deck.id, proposal.id), /already applied/);
    const restored = engine.restoreVersion(deck.id, deck.version);
    assert.deepEqual(restored.cards.find(c => c.id === card.id)!.blocks, card.blocks);
  });

  it('rejects a stale manual save with a 409 version conflict', async () => {
    const deck = await built({ inputText: 'Coffee brewing', numCards: 3 });
    engine.saveDeck(deck.id, { baseVersion: deck.version, title: 'Brewing better coffee' });
    assert.throws(() => engine.saveDeck(deck.id, { baseVersion: deck.version, title: 'stale' }), (e: unknown) => e instanceof engine.EngineError && e.status === 409);
    assert.equal(store.getDeck(deck.id)!.title, 'Brewing better coffee');
  });

  it('runs instructions queued during the build after the cards are done', async () => {
    const deck = await outlined({ inputText: 'Team rituals', numCards: 3 });
    const job = engine.startBuild(deck.id);
    const queued = engine.queueInstruction(deck.id, 'Make everything shorter');
    assert.equal(queued.id, job.id);
    await engine.waitForJobs();
    const final = store.getJob(job.id)!;
    assert.deepEqual(final.queuedInstructions.map(q => q.status), ['applied']);
    assert.ok(store.listVersions(deck.id).some(v => v.reason.startsWith('Queued instruction')));
  });
});

describe('express mode and prepared outlines', () => {
  it('express mode builds straight after the outline (no review stop)', async () => {
    const { deck } = await engine.createDeck({ settings: { inputText: 'Express topic', numCards: 3, mode: 'express' } });
    await engine.waitForJobs();
    const done = store.getDeck(deck.id)!;
    assert.equal(done.status, 'ready');
    assert.equal(done.settings.mode, 'express');
    assert.equal(done.cards.length, done.outline.length);
  });
  it('a prepared outline skips the planner and keeps points as written', async () => {
    const { deck } = await engine.createDeck({
      settings: { inputText: 'imported', textMode: 'preserve' },
      title: 'Imported deck',
      outline: [{ title: 'Cover', points: [] }, { title: 'Results', points: ['Revenue +32%', 'Churn 2.1%'] }, { title: '', points: ['untitled body'] }, { title: ' ', points: [] }],
      source: { kind: 'import', fileName: 'q3.pptx', intent: 'asIs' },
    });
    await engine.waitForJobs();
    const out = store.getDeck(deck.id)!;
    assert.equal(out.status, 'outline_ready');
    assert.equal(out.title, 'Imported deck');
    assert.deepEqual(out.outline.map(c => c.title), ['Cover', 'Results', 'Card 3']);
    assert.deepEqual(out.outline[1].points, ['Revenue +32%', 'Churn 2.1%']);
    assert.deepEqual(out.source, { kind: 'import', fileName: 'q3.pptx', intent: 'asIs' });
    await assert.rejects(engine.createDeck({ settings: { inputText: 'x' }, outline: [{ title: ' ', points: [] }] }), /no cards/);
  });
});

describe('stop, withdraw and retry', () => {
  it('stop keeps finished cards and drops unstarted ones; a queued instruction can be withdrawn', async () => {
    const base = model.createMockModel();
    let release: () => void = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    model.setDeckModelForTests({ ...base, async writeCard(...args) { if (args[2] >= 3) await gate; return base.writeCard(...args); } });
    try {
      const deck = await outlined({ inputText: 'Stop test topic', numCards: 8 });
      engine.startBuild(deck.id);
      const queued = engine.queueInstruction(deck.id, 'Make it shorter');
      const withdrawn = engine.removeQueuedInstruction(deck.id, queued.queuedInstructions[0].id);
      assert.equal(withdrawn.queuedInstructions.length, 0);
      await new Promise(r => setTimeout(r, 50));
      engine.stopBuild(deck.id);
      release();
      await engine.waitForJobs();
      const done = store.getDeck(deck.id)!;
      assert.equal(done.status, 'ready');
      assert.ok(done.cards.length < deck.outline.length, `kept ${done.cards.length} of ${deck.outline.length}`);
      assert.ok(done.cards.every(c => c.stage === 'done'));
      assert.throws(() => engine.stopBuild(deck.id), /Nothing is being generated/);
    } finally { model.setDeckModelForTests(null); }
  });

  it('a failed build can be retried from its outline', async () => {
    const base = model.createMockModel();
    model.setDeckModelForTests({ ...base, async writeCard() { throw new Error('boom'); } });
    const deck = await outlined({ inputText: 'Retry topic', numCards: 2 });
    // Every card falls back to the simple layout instead of failing the deck.
    engine.startBuild(deck.id);
    await engine.waitForJobs();
    const fallback = store.getDeck(deck.id)!;
    assert.equal(fallback.status, 'ready');
    assert.ok(fallback.cards.every(c => c.issues?.some(i => i.code === 'model_fallback')));
    model.setDeckModelForTests(null);
    store.updateDeck(deck.id, d => { d.status = 'failed'; d.error = 'simulated'; });
    engine.startBuild(deck.id);
    await engine.waitForJobs();
    assert.equal(store.getDeck(deck.id)!.status, 'ready');
  });
});

describe('checking and polishing', () => {
  it('removes a side accent and condenses a card that overflows a 16:9 slide', async () => {
    const long = Array.from({ length: 24 }, (_, i) => `Point ${i + 1} with a fairly long explanation that takes most of a line on the slide`);
    const base = model.createMockModel();
    model.setDeckModelForTests({
      ...base,
      async writeCard(s, card, index, total, title) {
        if (index === 0) return base.writeCard(s, card, index, total, title);
        return { blocks: [{ id: 'h', type: 'heading', level: 2, text: card.title }, { id: 'b', type: 'bullets', items: long }], accent: 'right', imagePrompt: 'x' };
      },
    });
    try {
      const deck = await built({ inputText: 'Overflow test', numCards: 2 });
      const card = deck.cards[1];
      assert.equal(card.layout.accent, 'none');
      const bullets = card.blocks.find(b => b.type === 'bullets');
      assert.ok(bullets && bullets.type === 'bullets' && bullets.items.length < long.length);
    } finally { model.setDeckModelForTests(null); }
  });
});

describe('model replies and media safety', () => {
  it('parses JSON from fenced or chatty replies', () => {
    assert.deepEqual(model.parseJsonReply('Sure!\n```json\n{"a":{"b":"}"}}\n```'), { a: { b: '}' } });
    assert.deepEqual(model.parseJsonReply('x {"ok":true} y'), { ok: true });
    assert.throws(() => model.parseJsonReply('{"cut": "'), /cut off/);
  });
  it('sanitizes malformed blocks from a model', () => {
    const out = blocks.sanitizeBlocks([{ type: 'heading', text: 'T', level: 9 }, { type: 'chart', labels: ['a'], series: [] }, { type: 'evil' }, { type: 'bullets', items: ['x', 3] }]);
    assert.deepEqual(out.map(b => b.type), ['heading', 'bullets']);
  });
  it('accepts raster images and refuses SVG', () => {
    assert.equal(media.sniffImage(PNG), 'image/png');
    assert.equal(media.sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
    const deck = store.listDecks()[0];
    assert.throws(() => media.storeImage(deck.id, Buffer.from('<svg/>'), 'upload'), /PNG, JPEG/);
    assert.deepEqual(media.imageSize(PNG, 'image/png'), { width: 2, height: 3 });
  });
});
