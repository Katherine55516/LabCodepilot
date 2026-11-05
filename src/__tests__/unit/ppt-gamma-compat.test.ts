import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPrivateAddress } from '../../lib/ppt-gamma-image-fetch';
import {
  GammaApiError, extractImageUrls, gammaProgress, nextEngineStep, parseAgentGeneration, parseClassicGeneration, splitAuthorCards, toGammaStatus, toGammaThemes,
} from '../../lib/ppt-gamma-compat';
import { handleGammaRequest, signExport, type GammaJobRecord, type GammaServiceDeps } from '../../lib/ppt-gamma-service';

const rejects = (fn: () => unknown, code: string) => assert.throws(fn, (error: unknown) => error instanceof GammaApiError && error.statusCode === 400 && error.code === code);

test('classic textMode chooses input kind and knowledge; amount chooses density; default 10 cards', () => {
  const generate = parseClassicGeneration({ inputText: 'Deep sea exploration', textOptions: { tone: 'playful', audience: 'kids' }, additionalInstructions: 'End with a quiz' });
  assert.equal(generate.create.inputKind, 'prompt');
  assert.match(generate.create.prompt, /^Deep sea exploration\n\nTone: playful\nAudience: kids\nEnd with a quiz$/);
  assert.equal(generate.create.generationPolicy.knowledge, 'source_plus_explanation');
  assert.equal(generate.settings.exactCards, 10);
  assert.equal(generate.settings.contentMode, 'standard');
  assert.equal(generate.create.readOnlyInput, true);

  const condense = parseClassicGeneration({ inputText: 'long notes', textMode: 'condense', textOptions: { amount: 'brief', tone: 'x' } });
  assert.equal(condense.create.inputKind, 'paste');
  assert.equal(condense.create.text, 'long notes');
  assert.equal(condense.create.generationPolicy.knowledge, 'source_only');
  assert.equal(condense.create.generationPolicy.content, 'overview');
  assert.equal(condense.settings.contentMode, 'concise');
  assert.ok(condense.warnings.some(w => w.code === 'ignored_text_options'));

  const preserve = parseClassicGeneration({ inputText: 'keep me', textMode: 'preserve', textOptions: { amount: 'extensive' } });
  assert.equal(preserve.create.generationPolicy.content, 'full_source');
  assert.equal(preserve.settings.contentMode, 'detailed');
  assert.ok(preserve.warnings.some(w => w.code === 'amount_adjusted'));
});

test('classic rejects what the engine cannot build and warns on what it ignores', () => {
  rejects(() => parseClassicGeneration({ inputText: 'x', format: 'webpage' }), 'unsupported_format');
  rejects(() => parseClassicGeneration({ inputText: 'x', exportAs: 'png' }), 'unsupported_export');
  rejects(() => parseClassicGeneration({ inputText: 'x', textOptions: { language: 'fr' } }), 'unsupported_language');
  rejects(() => parseClassicGeneration({ inputText: 'x', pages: [{ inputText: 'a' }] }), 'unsupported_pages');
  rejects(() => parseClassicGeneration({ inputText: 'x', bogus: 1 }), 'unknown_field');
  rejects(() => parseClassicGeneration({ inputText: 'x', themeId: '../etc' }), 'unknown_theme');
  assert.throws(() => parseClassicGeneration({}), /inputText is required/);
  const parsed = parseClassicGeneration({
    inputText: 'x', numCards: 80, themeId: 'Violet', exportAs: 'pdf', textOptions: { language: 'zh-tw' },
    imageOptions: { source: 'aiGenerated', style: 'flat' }, cardOptions: { dimensions: '4x3', headerFooter: {} },
    folderId: 'f', sharingOptions: { externalAccess: 'view' },
  });
  assert.equal(parsed.settings.exactCards, 40);
  assert.equal(parsed.create.template, 'violet');
  assert.equal(parsed.settings.exportAs, 'pdf');
  assert.equal(parsed.settings.language, 'zh-Hant');
  assert.deepEqual(parsed.create.generationPolicy.language, { mode: 'output', locale: 'zh-HK' });
  assert.deepEqual(parsed.warnings.map(w => w.code).sort(), ['dimensions_unsupported', 'ignored_external_access', 'ignored_folder_id', 'ignored_header_footer', 'ignored_image_options', 'image_source_unsupported', 'num_cards_adjusted'].sort());
  assert.equal(parseClassicGeneration({ inputText: 'x', imageOptions: { source: 'noImages' } }).warnings.length, 0);
});

test('inputTextBreaks becomes an author outline with a cover; too few cards fall back to auto', () => {
  assert.deepEqual(splitAuthorCards('# A\n* one\n* two\n---\nB\n1. three'), [{ title: 'A', keyPoints: ['one', 'two'] }, { title: 'B', keyPoints: ['three'] }]);
  const parsed = parseClassicGeneration({ inputText: '# Deck\n---\n# One\n- a\n---\n# Two\n- b', cardSplit: 'inputTextBreaks', numCards: 9 });
  assert.equal(parsed.create.pages, 3);
  assert.equal(parsed.create.outline?.[0].title, 'Deck');
  assert.equal(parsed.create.readOnlyInput, false);
  assert.equal(parsed.settings.authorOutline, true);
  assert.equal(parsed.settings.exactCards, undefined);
  const withBody = parseClassicGeneration({ inputText: '# One\n- a\n---\n# Two\n- b', cardSplit: 'inputTextBreaks', title: 'My deck' });
  assert.deepEqual(withBody.create.outline?.map(card => card.title), ['My deck', 'One', 'Two']);
  const tooFew = parseClassicGeneration({ inputText: '# Only', cardSplit: 'inputTextBreaks' });
  assert.equal(tooFew.create.outline, undefined);
  assert.ok(tooFew.warnings.some(w => w.code === 'card_split_fallback'));
});

test('agent requests: prompt only, strict fields, theme xor template, soft numCards', () => {
  const parsed = parseAgentGeneration({ prompt: 'Board update', additionalInstructions: 'Audience: board', numCards: 12, templateId: 'blue', quality: 'max', exportAs: 'pptx' });
  assert.equal(parsed.create.prompt, 'Board update\n\nAudience: board');
  assert.equal(parsed.create.template, 'blue');
  assert.equal(parsed.settings.exactCards, 12);
  assert.ok(parsed.warnings.some(w => w.code === 'ignored_quality'));
  rejects(() => parseAgentGeneration({ prompt: 'x', textMode: 'generate' }), 'unknown_field');
  rejects(() => parseAgentGeneration({ prompt: 'x', sourceUrls: ['https://a.b'] }), 'unsupported_source_urls');
  assert.throws(() => parseAgentGeneration({ prompt: 'x', themeId: 'blue', templateId: 'violet' }), /cannot be combined/);
  const long = parseAgentGeneration({ prompt: 'p'.repeat(90_000) });
  assert.equal(long.create.inputKind, 'paste');
  assert.equal(long.create.generationPolicy.knowledge, 'source_only');
});

test('next engine step: plan at input_ready, generate at outline_ready, otherwise wait', () => {
  const settings = { flavor: 'classic' as const, exactCards: 8, contentMode: 'detailed' as const, language: 'en' as const, authorOutline: false };
  assert.deepEqual(nextEngineStep('created', settings, { id: 'p', status: 'input_ready', planningContract: { semanticRevision: 'r1' } }),
    { type: 'plan', body: { command: 'outline', semanticRevision: 'r1', contentMode: 'detailed', length: { exact: 8 }, language: 'en' } });
  assert.deepEqual(nextEngineStep('created', { ...settings, exactCards: undefined, language: undefined }, { id: 'p', status: 'input_ready' }),
    { type: 'plan', body: { command: 'outline', contentMode: 'detailed', length: { preset: 'standard' } } });
  assert.deepEqual(nextEngineStep('planning', settings, { id: 'p', status: 'input_ready' }), { type: 'none' });
  assert.deepEqual(nextEngineStep('planning', settings, { id: 'p', status: 'outline_ready' }), { type: 'generate' });
  assert.deepEqual(nextEngineStep('generating', settings, { id: 'p', status: 'outline_ready' }), { type: 'none' });
});

test('status projection: progress buckets, completion, quality block without a publish fails', () => {
  const progress = gammaProgress({ id: 'p', status: 'generating', pages: 5, generationStages: { pages: { a: 'ready', b: 'writing', c: 'reviewing', d: 'rendering' } } });
  assert.deepEqual(progress, { stages: { queued: 1, writing: 1, imaging: 1, checking: 1, polishing: 0, done: 1, failed: 0 }, done: 1, total: 5, percent: 20 });
  const context = { generationId: 'gen_x', flavor: 'agent' as const, phase: 'generating' as const, gammaUrl: 'http://h/ppt?projectId=p', warnings: [] };
  const done = toGammaStatus({ id: 'p', status: 'completed', publishedRevision: 1, title: 'T', deck: { slides: [{ title: 'A' }, { title: 'B' }] } }, { ...context, exportUrl: 'http://h/f' });
  assert.equal(done.status, 'completed');
  assert.deepEqual(done.gamma, { gammaId: 'p', gammaUrl: 'http://h/ppt?projectId=p' });
  assert.equal((done.result as { summary: string }).summary, 'T: 2 cards (A; B).');
  assert.equal(done.exportUrl, 'http://h/f');
  const blocked = toGammaStatus({ id: 'p', status: 'quality_blocked' }, { ...context, flavor: 'classic' });
  assert.equal(blocked.status, 'failed');
  assert.equal(blocked.gammaId, 'p');
  const review = toGammaStatus({ id: 'p', status: 'outline_ready' }, { ...context, phase: 'blocked', phaseError: 'Edit these points' });
  assert.deepEqual(review.error, { reason: 'generation_failed', message: 'Edit these points', statusCode: 422 });
  assert.equal(toGammaStatus({ id: 'p', status: 'outlining' }, context).status, 'pending');
});

test('themes keep only safe template ids', () => {
  const themes = toGammaThemes([{ id: 'violet', name: 'Violet', kind: 'builtin', category: 'Business', tags: ['clean'] }, { id: 'a'.repeat(32), name: 'Mine', kind: 'uploaded' }, { id: '../x' }]);
  assert.deepEqual(themes.data.map(t => [t.id, t.type]), [['violet', 'standard'], ['a'.repeat(32), 'custom']]);
  assert.deepEqual(themes.data[0].toneKeywords, ['Business', 'clean']);
});

/** A fake engine: create -> input_ready; planning -> outline_ready; generate -> completed. */
function harness(apiKey: string | null = 'k1') {
  const jobs = new Map<string, GammaJobRecord>();
  const calls: string[] = [];
  const project: Record<string, unknown> = { id: 'b'.repeat(32), status: 'input_ready', title: 'Deck', updatedAt: '2026-11-05T00:00:00.000Z' };
  let generateStatus = 202;
  const deps: GammaServiceDeps = {
    apiKey: apiKey ?? undefined, uid: 'u1', now: () => 1_000,
    fetchImage: async url => (url.includes('ok') ? { ok: true, dataUrl: 'data:image/png;base64,iVBORw0KGgo=' } : { ok: false, reason: 'HTTP 404' }),
    store: { insert: job => { jobs.set(job.id, job); }, get: id => jobs.get(id), update: (id, patch) => { jobs.set(id, { ...jobs.get(id)!, ...patch }); } },
    upstream: async (path, init = {}) => {
      calls.push(`${init.method || 'GET'} ${path}${init.body ? ' ' + JSON.stringify(init.body) : ''}`);
      if (path === 'projects') return Response.json({ project }, { status: 201 });
      if (path.endsWith('/planning')) { project.status = 'outline_ready'; return Response.json({ project }, { status: 202 }); }
      if (path.endsWith('/generate')) {
        if (generateStatus !== 202) return Response.json({ error: 'Edit these points before generating: x' }, { status: generateStatus });
        project.status = 'completed'; project.publishedRevision = 1; project.deck = { slides: [{ title: 'Cover' }] }; return Response.json({ project }, { status: 202 });
      }
      if (path.endsWith('/export')) return new Response('PPTX', { headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation' } });
      if (path === 'templates') return Response.json({ templates: [{ id: 'violet', name: 'Violet' }] });
      return Response.json({ project });
    },
  };
  return { deps, calls, jobs, project, setGenerateStatus: (status: number) => { generateStatus = status; } };
}
const req = (path: string, init: RequestInit = {}, key = 'k1') => new Request(`http://localhost:3000/api/ppt/gamma/v1.0/${path}`, { ...init, headers: { 'x-api-key': key, 'content-type': 'application/json', ...(init.headers || {}) } });
const call = (h: ReturnType<typeof harness>, path: string, init?: RequestInit, key?: string) => handleGammaRequest(req(path, init, key), path.split('?')[0].split('/'), h.deps);

test('service: create, poll-driven plan and generate, signed export download', async () => {
  const h = harness();
  const created = await call(h, 'agent/generations', { method: 'POST', body: JSON.stringify({ prompt: 'AI in labs', numCards: 7, exportAs: 'pptx' }) });
  assert.equal(created.status, 202); // Gamma's agent create status
  const { generationId, status } = await created.json();
  assert.match(generationId, /^gen_[a-f0-9]{24}$/);
  assert.equal(status, 'pending');
  assert.equal(JSON.parse(h.calls[0].slice('POST projects '.length)).readOnlyInput, true);

  const first = await (await call(h, `agent/generations/${generationId}`)).json();
  assert.equal(first.status, 'pending');
  assert.ok(h.calls.some(c => c.startsWith('POST projects/' + 'b'.repeat(32) + '/planning') && c.includes('"length":{"exact":7}')));

  const second = await (await call(h, `agent/generations/${generationId}`)).json();
  assert.equal(second.status, 'completed');
  assert.equal(second.gamma.gammaUrl, `http://localhost:3000/ppt?projectId=${'b'.repeat(32)}`);
  const exportUrl = new URL(second.exportUrl);
  assert.equal(exportUrl.searchParams.get('signature'), signExport('k1', generationId, 'pptx', Number(exportUrl.searchParams.get('expires'))));

  const file = await handleGammaRequest(new Request(exportUrl), ['files', `${generationId}.pptx`], h.deps);
  assert.equal(file.status, 200);
  assert.equal(await file.text(), 'PPTX');
  const forged = new URL(exportUrl); forged.searchParams.set('signature', '0'.repeat(64));
  assert.equal((await handleGammaRequest(new Request(forged), ['files', `${generationId}.pptx`], h.deps)).status, 403);
  // A Classic poll cannot read an agent job.
  assert.equal((await call(h, `generations/${generationId}`)).status, 404);
});

test('service: auth, disabled API, review stop and engine errors', async () => {
  assert.equal((await call(harness(null), 'themes')).status, 403);
  assert.equal((await call(harness(), 'themes', {}, 'wrong')).status, 401);
  const themes = await (await call(harness(), 'themes')).json();
  assert.deepEqual(themes.data.map((t: { id: string }) => t.id), ['violet']);
  const bad = await call(harness(), 'generations', { method: 'POST', body: JSON.stringify({ inputText: 'x', format: 'social' }) });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).code, 'unsupported_format');

  const h = harness();
  h.setGenerateStatus(409);
  const classic = await call(h, 'generations', { method: 'POST', body: JSON.stringify({ inputText: 'x' }) });
  assert.equal(classic.status, 200); // Gamma's Classic create status
  const { generationId } = await classic.json();
  await call(h, `generations/${generationId}`);
  const failed = await (await call(h, `generations/${generationId}`)).json();
  assert.equal(failed.status, 'failed');
  assert.match(failed.error.message, /Edit these points.*Open the presentation/);
  assert.equal(h.jobs.get(generationId)?.phase, 'blocked');
  assert.equal((await call(h, 'generations/gen_nope')).status, 404);
});

test('image URLs follow Gamma rules and never reach the engine as blocking references', () => {
  const { text, urls } = extractImageUrls([
    'Our HQ https://cdn.example.com/office.jpg?w=800 is in SF.',
    'https://cdn.example.com/a.png, and again https://cdn.example.com/a.png',
    'Not images: https://example.com/page https://example.com/doc.pdf',
    'Old http://example.com/x.png and wrapped ![Team](https://cdn.example.com/team.png) <img alt="Logo" src="https://cdn.example.com/logo.png">',
    'Local ![kept](data:image/png;base64,AAAA) stays.',
  ].join('\n'));
  assert.deepEqual(urls, ['https://cdn.example.com/office.jpg?w=800', 'https://cdn.example.com/a.png']);
  assert.doesNotMatch(text, /cdn\.example\.com|http:\/\/example\.com\/x\.png/);
  assert.match(text, /Old\s+and wrapped Team Logo/);
  assert.match(text, /https:\/\/example\.com\/doc\.pdf/);
  assert.match(text, /!\[kept\]\(data:image\/png;base64,AAAA\)/);
  rejects(() => parseClassicGeneration({ inputText: 'https://cdn.example.com/only.png' }), 'invalid_request');
  const parsed = parseClassicGeneration({ inputText: 'Deck https://cdn.example.com/a.png' });
  assert.deepEqual(parsed.imageUrls, ['https://cdn.example.com/a.png']);
  assert.equal(parsed.create.prompt.includes('cdn.example.com'), false);
});

test('image fetch refuses private and reserved addresses', () => {
  for (const address of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1'])
    assert.equal(isPrivateAddress(address), true, address);
  for (const address of ['8.8.8.8', '151.101.1.69', '2606:4700::1111']) assert.equal(isPrivateAddress(address), false, address);
});

test('service embeds fetched images and reports skipped URLs as one warning', async () => {
  const h = harness();
  const created = await call(h, 'agent/generations', { method: 'POST', body: JSON.stringify({ prompt: 'Products https://cdn.example.com/ok-a.png https://cdn.example.com/missing.png' }) });
  const { warnings } = await created.json();
  const body = JSON.parse(h.calls[0].slice('POST projects '.length));
  assert.deepEqual(body.images, [{ dataUrl: 'data:image/png;base64,iVBORw0KGgo=', caption: 'ok-a', required: false }]);
  assert.equal(body.prompt, 'Products');
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].code, 'image_urls_skipped');
  assert.match(warnings[0].message, /missing\.png \(HTTP 404\)/);
});
