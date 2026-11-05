/**
 * Gamma-compatible API over Decks: request mapping, create → poll with real
 * per-card progress, signed PPTX export, inputTextBreaks, agent create rules,
 * in-place edits (409 while one runs), metadata, themes, auth and the
 * concurrency limit. Uses a temp data dir and a gateable mock model.
 *
 * Run with: npx tsx --test src/__tests__/unit/decks-gamma-api.test.ts
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'decks-gamma-test-'));
process.env.CLAUDE_GUI_DATA_DIR = tmp;
process.env.DECKS_MODEL = 'mock';

type Api = typeof import('../../lib/decks/gamma-api');
type Engine = typeof import('../../lib/decks/engine');
type Store = typeof import('../../lib/decks/store');
type Model = typeof import('../../lib/decks/model');
type Db = typeof import('../../lib/db');
let api: Api, engine: Engine, store: Store, model: Model, db: Db;

const KEY = 'sk-test-decks-key';
const ORIGIN = 'http://localhost:3000';
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000020000000308060000009a9c2b2a0000000d4944415478da63f8ffff3f0300080401fd0b3c2d6f0000000049454e44ae426082', 'hex');

/** A mock model whose card writing and edits wait while the gate is closed. */
let gate: Promise<void> | null = null;
let openGate: () => void = () => {};
function closeGate() { gate = new Promise(resolve => { openGate = () => { gate = null; resolve(); }; }); }

before(async () => {
  api = await import('../../lib/decks/gamma-api');
  engine = await import('../../lib/decks/engine');
  store = await import('../../lib/decks/store');
  model = await import('../../lib/decks/model');
  db = await import('../../lib/db');
  const mock = model.createMockModel();
  model.setDeckModelForTests({
    ...mock,
    async writeCard(...args) { if (gate) await gate; return mock.writeCard(...args); },
    async editCards(...args) { if (gate) await gate; return mock.editCards(...args); },
  });
});
after(() => { model.setDeckModelForTests(null); fs.rmSync(tmp, { recursive: true, force: true }); });

type Deps = Parameters<Api['handleDecksGammaRequest']>[2];
async function call(method: string, route: string, body?: unknown, opts: { key?: string | null; deps?: Partial<Deps> } = {}) {
  const headers: Record<string, string> = {};
  if (opts.key !== null) headers['x-api-key'] = opts.key ?? KEY;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const request = new Request(`${ORIGIN}/api/decks/gamma/v1.0/${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const path = new URL(request.url).pathname.replace('/api/decks/gamma/v1.0/', '').split('/');
  const response = await api.handleDecksGammaRequest(request, path, { apiKey: KEY, activeGenerations: () => 0, ...opts.deps });
  const type = response.headers.get('content-type') || '';
  return { status: response.status, headers: response.headers, body: type.includes('json') ? await response.json() : Buffer.from(await response.arrayBuffer()) };
}

/** Polls like a Gamma client until the job settles (jobs run in-process, so waitForJobs bounds it). */
async function settle(route: string) {
  await engine.waitForJobs();
  return call('GET', route);
}

describe('request mapping (pure)', () => {
  it('maps Classic fields onto Decks settings with named warnings', () => {
    const parsed = api.parseClassicGeneration({
      inputText: 'Solar power', textMode: 'generate', format: 'social', numCards: 80, title: 'Sun',
      themeId: 'ember', exportAs: 'png', additionalInstructions: 'Keep it upbeat',
      textOptions: { amount: 'brief', tone: 'warm', audience: 'kids', language: 'en-gb' },
      imageOptions: { source: 'pexels', style: 'flat', model: 'flux-1-quick' },
      cardOptions: { dimensions: '16x9', headerFooter: { topLeft: { type: 'text', value: 'ACME' }, bottomRight: { type: 'cardNumber' }, topRight: { type: 'image', source: 'themeLogo', size: 'lg' }, hideFromFirstCard: true } },
      sharingOptions: { workspaceAccess: 'view' }, folderId: 'f1',
    });
    const s = parsed.request.settings;
    assert.equal(s.numCards, 60);
    assert.equal(s.format, 'social');
    assert.equal(s.dimensions, '1x1');
    assert.equal(s.language, 'en');
    assert.equal(s.imageSource, 'themeAccent');
    assert.equal(s.imageStyle, undefined);
    assert.equal(s.mode, 'express');
    assert.equal(s.themeId, 'ember');
    assert.equal(s.amount, 'brief');
    assert.equal(parsed.request.title, 'Sun');
    assert.equal(parsed.exportAs, 'png');
    assert.deepEqual(parsed.headerFooter, { topLeft: { type: 'text', value: 'ACME' }, topRight: { type: 'logo', size: 'lg' }, bottomRight: { type: 'cardNumber' }, hideFromFirstCard: true });
    assert.deepEqual(parsed.warnings.map(w => w.code).sort(), [
      'dimensions_adjusted', 'export_failed', 'ignored_folder_id', 'ignored_image_model', 'ignored_image_options', 'ignored_workspace_access',
      'image_source_unsupported', 'language_adjusted', 'num_cards_adjusted', 'theme_logo_as_text',
    ]);
    // Classic defaults: 10 cards, AI images (Gamma's default source).
    const plain = api.parseClassicGeneration({ inputText: 'x' }).request.settings;
    assert.equal(plain.numCards, 10);
    assert.equal(plain.imageSource, 'aiGenerated');
  });

  it('rejects what Decks cannot honour with 400', () => {
    const code = (body: unknown) => { try { api.parseClassicGeneration(body); return 'ok'; } catch (e) { return (e as InstanceType<Api['GammaApiError']>).code; } };
    assert.equal(code({ inputText: 'x', themeId: 'nope' }), 'unknown_theme');
    assert.equal(code({ inputText: 'x', textOptions: { language: 'pt-pt' } }), 'unsupported_language');
    assert.equal(code({ inputText: 'x', format: 'webpage' }), 'unsupported_format');
    assert.equal(code({ inputText: 'x', pages: [] }), 'unsupported_pages');
    assert.equal(code({ inputText: 'x', bogus: 1 }), 'unknown_field');
    assert.equal(code({ inputText: 'x', numCards: 101 }), 'invalid_request');
    assert.equal(code({ inputText: 'x', cardOptions: { dimensions: '2x1' } }), 'invalid_request');
    assert.equal(code({ inputText: 'x', cardOptions: { headerFooter: { topLeft: { type: 'image', source: 'custom', src: 'http://x/a.png' } } } }), 'invalid_request');
    assert.equal(code({}), 'invalid_request');
  });

  it('turns inputTextBreaks into a prepared outline, one card per segment', () => {
    const parsed = api.parseClassicGeneration({ inputText: '# One\n- a\n- b\n---\nTwo\nbody\n---\n# Three', cardSplit: 'inputTextBreaks', numCards: 9 });
    assert.deepEqual(parsed.request.outline, [{ title: 'One', points: ['a', 'b'] }, { title: 'Two', points: ['body'] }, { title: 'Three', points: [] }]);
    assert.equal(parsed.request.settings.numCards, 3);
  });

  it('maps Decks themes onto ListThemesResponse with paging', () => {
    const all = api.toGammaThemes(new URLSearchParams());
    assert.equal(all.hasMore, false);
    assert.equal(all.nextCursor, null);
    assert.ok(all.data.length >= 8);
    for (const theme of all.data) {
      assert.equal(theme.type, 'standard');
      assert.ok(theme.id && theme.name && theme.colorKeywords.length && theme.toneKeywords.length);
    }
    const first = api.toGammaThemes(new URLSearchParams({ limit: '3' }));
    assert.equal(first.data.length, 3);
    assert.equal(first.hasMore, true);
    const next = api.toGammaThemes(new URLSearchParams({ limit: '3', after: first.nextCursor! }));
    assert.equal(next.data[0].id, all.data[3].id);
    assert.equal(api.toGammaThemes(new URLSearchParams({ type: 'custom' })).data.length, 0);
  });
});

describe('auth', () => {
  it('answers 403 api_disabled without a key, 401 for a wrong key, and serves themes with the right one', async () => {
    const disabled = await call('GET', 'themes', undefined, { deps: { apiKey: undefined } });
    assert.equal(disabled.status, 403);
    assert.equal(disabled.body.code, 'api_disabled');
    assert.equal(disabled.body.statusCode, 403);
    assert.equal((await call('GET', 'themes', undefined, { key: 'wrong' })).status, 401);
    assert.equal((await call('GET', 'themes', undefined, { key: null })).body.statusCode, 401);
    const ok = await call('GET', 'themes');
    assert.equal(ok.status, 200);
    assert.ok(Array.isArray(ok.body.data));
    const bearer = await api.handleDecksGammaRequest(new Request(`${ORIGIN}/x`, { headers: { authorization: `Bearer ${KEY}` } }), ['themes'], { apiKey: KEY });
    assert.equal(bearer.status, 200);
    assert.equal((await call('GET', 'nothing/here')).status, 404);
  });
});

describe('Classic generation', () => {
  it('creates (200), reports per-card progress while pending, completes, and serves a signed PPTX', async () => {
    closeGate();
    const created = await call('POST', 'generations', {
      inputText: 'Remote onboarding for engineers', numCards: 5, exportAs: 'pptx', imageOptions: { source: 'themeAccent' },
      cardOptions: { headerFooter: { bottomRight: { type: 'cardNumber' }, topLeft: { type: 'image', source: 'custom', src: 'https://cdn.example.com/logo.png' } } },
    }, { deps: { fetchImage: async () => ({ ok: true as const, data: PNG, mime: 'image/png' }) } });
    assert.equal(created.status, 200);
    assert.match(created.body.generationId, /^gen_[A-Za-z0-9]+$/);
    const id = created.body.generationId as string;

    // Let the outline finish and the build start; card writing is held by the gate.
    let pending;
    for (let i = 0; i < 50; i++) {
      pending = await call('GET', `generations/${id}`);
      if (pending.body.progress) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(pending!.body.status, 'pending');
    const progress = pending!.body.progress;
    assert.ok(progress, 'progress while building');
    assert.ok(progress.total >= 4);
    assert.equal(Object.values(progress.stages as Record<string, number>).reduce((a, b) => a + b, 0), progress.total);
    assert.ok(progress.stages.writing > 0);
    assert.ok(progress.percent >= 0 && progress.percent <= 99);
    assert.equal(pending!.body.gammaId, undefined);

    openGate();
    const done = await settle(`generations/${id}`);
    assert.equal(done.body.status, 'completed');
    assert.match(done.body.gammaId, /^deck_/);
    assert.equal(done.body.gammaUrl, `${ORIGIN}/decks/${done.body.gammaId}`);
    assert.match(done.body.exportUrl, /\/files\/deck_[a-z0-9]+\.pptx\?expires=\d+&signature=[a-f0-9]{64}$/);
    // The other flavor's poll does not see a Classic id.
    assert.equal((await call('GET', `agent/generations/${id}`)).status, 404);

    const deck = store.getDeck(done.body.gammaId)!;
    assert.equal(deck.headerFooter.bottomRight?.type, 'cardNumber');
    assert.equal(deck.headerFooter.topLeft?.type, 'logo');
    assert.ok(deck.headerFooter.topLeft?.mediaId, 'custom logo hosted as media');
    assert.equal(deck.source?.kind, 'api');

    const fileRoute = done.body.exportUrl.slice(`${ORIGIN}/api/decks/gamma/v1.0/`.length);
    const file = await call('GET', fileRoute, undefined, { key: null });
    assert.equal(file.status, 200);
    assert.equal(file.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(file.body as Buffer);
    assert.ok(zip.file('ppt/presentation.xml'));
    assert.equal(Object.keys(zip.files).filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name)).length, deck.cards.length);
    // Tampered and expired links are refused.
    assert.equal((await call('GET', fileRoute.replace(/signature=[a-f0-9]{4}/, 'signature=0000'), undefined, { key: null })).status, 403);
    assert.equal((await call('GET', fileRoute, undefined, { key: null, deps: { now: () => Date.now() + 8 * 24 * 3600 * 1000 } })).status, 403);
  });

  it('builds one card per --- segment with inputTextBreaks', async () => {
    const created = await call('POST', 'generations', { inputText: '# Alpha\n- one\n---\n# Beta\n- two\n---\n# Gamma\n- three\n---\n# Delta', cardSplit: 'inputTextBreaks', numCards: 12, textMode: 'preserve', imageOptions: { source: 'noImages' } });
    assert.equal(created.status, 200);
    const done = await settle(`generations/${created.body.generationId}`);
    assert.equal(done.body.status, 'completed');
    const deck = store.getDeck(done.body.gammaId)!;
    assert.equal(deck.cards.length, 4);
    assert.deepEqual(deck.outline.map(card => card.title), ['Alpha', 'Beta', 'Gamma', 'Delta']);
  });
});

describe('Gamma 5 agent generation', () => {
  it('answers 202 pending with warnings, completes with gamma + result.summary + credits', async () => {
    const created = await call('POST', 'agent/generations', { prompt: 'A short history of the bicycle', numCards: 4, themeId: 'paper', quality: 'max', exportAs: 'pdf' });
    assert.equal(created.status, 202);
    assert.equal(created.body.status, 'pending');
    assert.match(created.body.generationId, /^gen_[A-Za-z0-9]+$/);
    assert.deepEqual(created.body.warnings.map((w: { code: string }) => w.code).sort(), ['export_failed', 'ignored_quality']);
    const done = await settle(`agent/generations/${created.body.generationId}`);
    assert.equal(done.body.status, 'completed');
    assert.match(done.body.gamma.gammaId, /^deck_/);
    assert.match(done.body.result.summary, /card/);
    assert.deepEqual(done.body.credits, {});
    assert.ok(done.body.updatedTime);
    assert.equal(done.body.exportUrl, undefined);
    assert.ok(done.body.warnings.some((w: { code: string }) => w.code === 'export_failed'));
    assert.equal(store.getDeck(done.body.gamma.gammaId)!.settings.themeId, 'paper');
  });

  it('rejects unknown fields and themeId with templateId; uses a template deck look', async () => {
    const unknown = await call('POST', 'agent/generations', { prompt: 'x', textMode: 'generate' });
    assert.equal(unknown.status, 400);
    assert.equal(unknown.body.code, 'unknown_field');
    assert.equal((await call('POST', 'agent/generations', { prompt: 'x', themeId: 'paper', templateId: 'deck_abc' })).status, 400);
    assert.equal((await call('POST', 'agent/generations', { prompt: 'x', templateId: 'deck_missing1' })).body.code, 'unknown_template');

    const template = await call('POST', 'generations', { inputText: 'Template source', numCards: 3, themeId: 'forest', format: 'document', cardOptions: { dimensions: 'a4', headerFooter: { bottomLeft: { type: 'text', value: 'Confidential' } } }, imageOptions: { source: 'noImages' } });
    const templateDone = await settle(`generations/${template.body.generationId}`);
    const created = await call('POST', 'agent/generations', { prompt: 'Quarterly review', templateId: templateDone.body.gammaId });
    assert.equal(created.status, 202);
    const done = await settle(`agent/generations/${created.body.generationId}`);
    const deck = store.getDeck(done.body.gamma.gammaId)!;
    assert.equal(deck.settings.themeId, 'forest');
    assert.equal(deck.settings.format, 'document');
    assert.equal(deck.settings.dimensions, 'a4');
    assert.equal(deck.headerFooter.bottomLeft?.value, 'Confidential');
  });

  it('answers 429 workspace_concurrency_limit_exceeded with Retry-After when 3 generations are running', async () => {
    closeGate();
    const ids: string[] = [];
    try {
      for (let i = 0; i < 3; i++) {
        const created = await call('POST', 'agent/generations', { prompt: `Busy topic ${i}`, numCards: 3 }, { deps: { activeGenerations: undefined } });
        assert.equal(created.status, 202, JSON.stringify(created.body));
        ids.push(created.body.generationId);
      }
      const rejected = await call('POST', 'generations', { inputText: 'One too many' }, { deps: { activeGenerations: undefined } });
      assert.equal(rejected.status, 429);
      assert.equal(rejected.body.code, 'workspace_concurrency_limit_exceeded');
      assert.equal(rejected.headers.get('retry-after'), '10');
    } finally { openGate(); }
    await engine.waitForJobs();
    assert.equal((await call('POST', 'generations', { inputText: 'Now there is room', numCards: 2 }, { deps: { activeGenerations: undefined } })).status, 200);
    await engine.waitForJobs();
  });
});

describe('edits, metadata, exports', () => {
  it('applies an edit in place (version increases), and refuses a second edit while one runs (409)', async () => {
    const created = await call('POST', 'generations', { inputText: 'Kubernetes for beginners', numCards: 3, imageOptions: { source: 'noImages' } });
    const done = await settle(`generations/${created.body.generationId}`);
    const gammaId = done.body.gammaId as string;
    const before = store.getDeck(gammaId)!;

    closeGate();
    const edit = await call('POST', `agent/gammas/${gammaId}/edits`, { prompt: 'Make every card shorter' });
    assert.equal(edit.status, 201);
    assert.match(edit.body.editId, /^job_/);
    assert.equal(edit.body.gammaUrl, `${ORIGIN}/decks/${gammaId}`);
    const pending = await call('GET', `agent/edits/${edit.body.editId}`);
    assert.equal(pending.body.status, 'pending');
    assert.equal(pending.body.pageId, gammaId);
    const second = await call('POST', `agent/gammas/${created.body.generationId}/edits`, { prompt: 'Another change' });
    assert.equal(second.status, 409);
    assert.equal(second.body.code, 'edit_in_progress');
    assert.equal(second.body.editId, edit.body.editId);
    openGate();

    await engine.waitForJobs();
    const after = store.getDeck(gammaId)!;
    assert.ok(after.version > before.version, `version ${before.version} → ${after.version}`);
    assert.equal(store.listProposals(gammaId).length, 0, 'the proposal was applied, not left for review');
    const status = await call('GET', `agent/edits/${edit.body.editId}`);
    assert.equal(status.body.status, 'completed');
    assert.match(status.body.result.summary, /shorter/);
    assert.deepEqual(status.body.credits, {});
    assert.equal(store.getDeck(gammaId)!.version, after.version, 'polling again does not re-apply');
    assert.equal((await call('POST', `agent/gammas/${gammaId}/edits`, { prompt: 'x', pageId: 'p' })).body.code, 'unknown_field');
    assert.equal((await call('GET', 'agent/edits/job_nothere')).status, 404);
  });

  it('returns GetGammaResponse, exports pptx through /exports, and rejects pdf/png exports', async () => {
    const created = await call('POST', 'agent/generations', { prompt: 'Coffee brewing methods', numCards: 3 });
    const done = await settle(`agent/generations/${created.body.generationId}`);
    const gammaId = done.body.gamma.gammaId as string;

    const meta = await call('GET', `gammas/${gammaId}`);
    assert.equal(meta.status, 200);
    assert.deepEqual(Object.keys(meta.body).sort(), ['archived', 'author', 'createdTime', 'description', 'id', 'themeId', 'thumbnailUrl', 'title', 'type', 'updatedTime', 'url']);
    assert.equal(meta.body.id, gammaId);
    assert.equal(meta.body.type, 'regular');
    assert.equal(meta.body.url, `${ORIGIN}/decks/${gammaId}`);
    assert.equal(meta.body.thumbnailUrl, null);
    assert.equal(meta.body.author, null);
    assert.equal(meta.body.archived, false);
    assert.equal(typeof meta.body.description, 'string');
    assert.equal(meta.body.themeId, store.getDeck(gammaId)!.settings.themeId);
    assert.equal((await call('GET', 'gammas/deck_unknown1')).status, 404);
    assert.equal((await call('GET', 'gammas/bad%20id')).status, 400);

    assert.equal((await call('POST', `gammas/${gammaId}/export`, { exportAs: 'pdf' })).body.code, 'unsupported_export');
    const exp = await call('POST', `gammas/${gammaId}/export`, { exportAs: 'pptx' });
    assert.equal(exp.status, 200);
    const status = await call('GET', `exports/${exp.body.exportId}`);
    assert.equal(status.body.status, 'completed');
    assert.equal(status.body.exportAs, 'pptx');
    assert.equal(status.body.gammaId, gammaId);
    const file = await call('GET', status.body.exportUrl.slice(`${ORIGIN}/api/decks/gamma/v1.0/`.length), undefined, { key: null });
    assert.equal(file.status, 200);
    assert.equal((file.body as Buffer).subarray(0, 2).toString(), 'PK');
  });

  it('scopes ids to the signed-in account', async () => {
    const created = await call('POST', 'generations', { inputText: 'Private deck', numCards: 2 });
    const done = await settle(`generations/${created.body.generationId}`);
    db.setSetting('current_user_uid', 'someone-else');
    try {
      assert.equal((await call('GET', `generations/${created.body.generationId}`)).status, 404);
      assert.equal((await call('GET', `gammas/${done.body.gammaId}`)).status, 404);
    } finally { db.setSetting('current_user_uid', ''); }
    assert.equal((await call('GET', `gammas/${done.body.gammaId}`)).status, 200);
  });
});
