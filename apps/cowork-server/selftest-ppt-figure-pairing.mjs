// A figure page takes the points that explain its figures (Fable 2026-11-02,
// F1/F2/F4; the user: World Models on Mood-Board had figure-only pages while
// the hand deck put each figure beside the text it supports).
import assert from 'node:assert/strict';
import { placeCardFigures, pointCitesFigure, pairedCaption, uncertainText, legibleBeside } from './lib/ppt-card-figure-layout.mjs';
import { shortenedCaptionNotes } from './lib/ppt-card-language.mjs';

const image = { id: 'i1', caption: 'Figure 2: Flow diagram of the V model', sourceRefs: ['5'], width: 800, height: 600 };
const other = { id: 'i2', caption: 'Figure 7: Rollouts in the dream', sourceRefs: ['9'], width: 800, height: 600 };
const base = () => ({ templateFidelity: { mode: 'preserve', slides: [] }, source: { images: [image, other], semantic: { inventory: { items: [{ id: 'u-cap', text: 'Figure 2: Flow diagram of the V model' }, { id: 'u1', text: 'The encoder compresses each frame.' }] } } } });
const point = (text, extra = {}) => ({ text, refs: ['3'], sourceUnitIds: [], ...extra });

// Citation: the caption's unit, the label named, the figure's segment; else none.
{const p = base();
 assert.equal(pointCitesFigure(p, point('x', { sourceUnitIds: ['u-cap'] }), image), 'caption');
 assert.equal(pointCitesFigure(p, point('As Figure 2 shows, V encodes frames.'), image), 'named');
 assert.equal(pointCitesFigure(p, point('Figure 21 is something else.'), image), '');
 assert.equal(pointCitesFigure(p, point('x', { refs: ['5'] }), image), 'segment');
 assert.equal(pointCitesFigure(p, point('Unrelated.'), image), '');}

const hooks = (fits) => ({ reschedule: () => {}, isNative: () => null, components: () => [], fits: (trial, k, page) => fits(page), validate: () => true });
const owner = (points) => ({ id: 'c1', logicalCardId: 'L1', title: 'Vision Model', keyPoints: points, sourceUnitIds: ['u1', 'u-cap'] });
const figure = (extra = {}) => ({ id: 'f1', logicalCardId: 'L1', title: 'Flow Diagram', figurePage: true, restoredFrom: 'c1', sourceImageIds: ['i1'], keyPoints: [], refs: ['5'], ...extra });

// F1: the citing point and its nearest neighbour move onto the figure page; it
// opens the card, so it is part 1 and the owner the continuation.
{const p = base(), points = [point('V compresses each frame into a latent.'), point('As Figure 2 shows, the encoder is a VAE.', { sourceUnitIds: ['u1'] }), point('M predicts the next latent.'), point('C acts on both.')];
 const raw = { slides: [{ id: 'cover' }, owner(points), figure()] };
 const out = placeCardFigures(p, raw, hooks(page => page.keyPoints.length <= 2));
 assert.equal(out.slides.length, 3, 'no page added');
 const [, paired, rest] = out.slides;
 assert.ok(paired.pairedFigurePage && paired.cardFigureLayout && !paired.figurePage && !paired.restoredFrom, 'a content page with its figure, no figure-page eyebrow');
 assert.deepEqual(paired.sourceImageIds, ['i1']);
 assert.deepEqual(paired.keyPoints.map(item => item.text), [points[0].text, points[1].text], 'the citing point and the nearest one, in source order');
 assert.equal(paired.title, 'Vision Model', 'the card title base, not the caption lead (F2)');
 assert.equal(rest.id, 'c1');
 assert.deepEqual(rest.keyPoints.map(item => item.text), [points[2].text, points[3].text]);
 assert.equal(rest.title, 'Vision Model (cont.)', 'the later part is marked; the numbering pass sets k/n');
 assert.deepEqual(p.outline.map(page => page.id), out.slides.map(page => page.id), 'the project takes the paired outline');}

// Citing points late in the card: the figure page follows the owner.
{const p = base(), points = [point('V compresses each frame.'), point('M predicts the next latent.'), point('C acts on both.'), point('Figure 2 details the V model.')];
 const out = placeCardFigures(p, { slides: [{ id: 'cover' }, owner(points), figure()] }, hooks(page => page.keyPoints.length <= 2));
 assert.deepEqual(out.slides.map(page => page.id), ['cover', 'c1', 'f1']);
 assert.equal(out.slides[1].title, 'Vision Model');
 assert.equal(out.slides[2].title, 'Vision Model (cont.)');
 assert.deepEqual(out.slides[2].keyPoints.map(item => item.text), [points[2].text, points[3].text]);}

// A donor that would keep one point moves whole; if that does not fit either,
// the figure keeps its page (F3), the owner its points.
{const p = base(), points = [point('V compresses each frame.'), point('Figure 2 details the V model.'), point('M predicts.')];
 const whole = placeCardFigures(p, { slides: [{ id: 'cover' }, owner(points), figure()] }, hooks(page => page.keyPoints.length <= 3));
 assert.equal(whole.slides.length, 2, 'the whole card moved onto the figure page');
 assert.ok(whole.slides[1].sourceImageIds?.includes('i1') && whole.slides[1].keyPoints.length === 3);
 const p2 = base(), raw = { slides: [{ id: 'cover' }, owner(points), figure()] };
 const kept = placeCardFigures(p2, raw, hooks(() => false));
 assert.deepEqual(kept.slides.map(page => page.id), ['cover', 'c1', 'f1'], 'nothing fits: the figure page stays');
 assert.ok(kept.slides[2].figurePage);}

// Donors with objects, tables, numbered steps or row points keep their points.
for (const extra of [{ cardObjects: ['t1'] }, { sourceArtifactRanges: [{ sourceUnitId: 't1' }] }, { numberedPoints: true }]) {
 const p = base(), points = [point('V compresses each frame.'), point('Figure 2 details the V model.'), point('M predicts.'), point('C acts.')];
 const out = placeCardFigures(p, { slides: [{ id: 'cover' }, { ...owner(points), ...extra }, figure()] }, hooks(page => page.keyPoints.length <= 2));
 assert.ok(out.slides.at(-1).figurePage, `a donor with ${Object.keys(extra)[0]} keeps its points`);
}

// A cited figure no points pair with keeps its page (the user, 2026-11-02:
// necessary figures stay on the slides); nothing goes to the notes here.
{const p = base(), points = [point('V compresses each frame.'), point('M predicts.'), point('C acts.'), point('Training is iterative.')];
 const raw = { slides: [{ id: 'cover' }, owner(points), figure(), { ...figure({ id: 'f2', sourceImageIds: ['i2'], refs: ['9'] }) }] };
 const out = placeCardFigures(p, raw, hooks(() => false));
 assert.deepEqual(out.slides.map(page => page.id), ['cover', 'c1', 'f1', 'f2'], 'both figure pages stay');
 assert.equal(out.optionalFigures, undefined, 'no figure moved to the notes');}

// Two cards with one title are different cards: no points move between them.
{const p = base(), points = [point('V compresses each frame.'), point('Figure 2 details the V model.'), point('M predicts.'), point('C acts.')];
 const other = { ...owner(points), id: 'c9', logicalCardId: 'L9' };
 const out = placeCardFigures(p, { slides: [{ id: 'cover' }, { ...owner([point('Intro.'), point('Overview.')]), }, figure(), other] }, hooks(page => page.keyPoints.length <= 2 && page.id !== 'c1'));
 assert.ok(out.slides.find(page => page.id === 'f1')?.figurePage, 'the same-titled card c9 gives no points');
 assert.deepEqual(out.slides.find(page => page.id === 'c9').keyPoints, points);}

// F4: a page showing one figure gives the points of its card's second figure;
// it keeps its own figure and two points, and both pages are measured.
{const p = base(), points = [point('V compresses each frame.'), point('M predicts.'), point('C acts.'), point('Figure 7 shows rollouts in the dream.')];
 const host = { ...owner(points), sourceImageIds: ['i1'], cardFigureLayout: true }, measured = [];
 const out = placeCardFigures(p, { slides: [{ id: 'cover' }, host, figure({ id: 'f2', sourceImageIds: ['i2'], refs: ['9'] })] }, hooks(page => { measured.push(page.id); return page.keyPoints.length <= 2; }));
 assert.deepEqual(out.slides.slice(1).map(page => [page.id, page.sourceImageIds, page.keyPoints.map(item => item.text)]), [['c1', ['i1'], [points[0].text, points[1].text]], ['f2', ['i2'], [points[2].text, points[3].text]]]);
 assert.ok(measured.includes('c1') && measured.includes('f2'), 'the donor with its figure is measured too');}

// A same-titled section without a card id is no part of the card either (Fable).
{const p = base(), points = [point('V compresses each frame.'), point('Figure 2 details the V model.'), point('M predicts.'), point('C acts.')];
 const loose = { id: 'c8', title: 'Vision Model', keyPoints: points, sourceUnitIds: [] };
 const out = placeCardFigures(p, { slides: [{ id: 'cover' }, owner([point('Intro.'), point('Overview.')]), figure(), loose] }, hooks(page => page.keyPoints.length <= 2 && page.id !== 'c1'));
 assert.ok(out.slides.find(page => page.id === 'f1')?.figurePage);
 assert.deepEqual(out.slides.find(page => page.id === 'c8').keyPoints, points, 'no exchange with a same-titled page of no card');}

// P2: beside points the caption is its first sentence with the number (two
// lines at most), else "Figure N: subject"; the notes carry it whole.
{const caption = 'Figure 13. Our agent driving inside of its own dream world. Here, we deploy our trained policy.';
 assert.deepEqual(pairedCaption(caption, text => text.length / 80), { text: 'Figure 13. Our agent driving inside of its own dream world.', shortened: true });
 assert.deepEqual(pairedCaption(caption, text => text.length / 20), { text: 'Figure 13: Our Agent Driving Inside of Its Own Dream World', shortened: true }, 'past two lines: the subject');
 assert.equal(pairedCaption('Figure 4: Flow diagram.', () => 1).shortened, false, 'a one-sentence caption stays whole');
 const deck = { source: { images: [{ id: 'i1', caption }] }, deck: { slides: [{ nodes: [] }, { nodes: [{ content: { sourceImageCaptionId: 'i1', captionShortened: true, text: 'Figure 13. Our agent…' } }] }] } };
 assert.deepEqual(shortenedCaptionNotes(deck), [{ index: 1, sourceUnitIds: [], text: caption }], 'the full caption in that page\'s notes');}

// OCR that read nothing is no proof of no text (the user, 2026-11-03, replacing
// Fable P3): such a figure is uncertain and goes beside points only at the
// conservative 40% of the content width, a photo or game frame included.
{const frame = { width: 1290, height: 1290, role: 'source_content', continuousTone: true, figureText: { source: 'ocr_unread', words: 2 } }, IN = 914400;
 assert.equal(uncertainText(frame), true);
 assert.equal(legibleBeside(frame, 3.5 * IN, 11 * IN), false, 'unread text is not passed as legible');
 assert.equal(legibleBeside(frame, 4.4 * IN, 11 * IN), true, 'at 40% of the content width it may sit beside points');
 assert.equal(legibleBeside({ ...frame, figureText: undefined }, 2.5 * IN, 11 * IN), true, 'a photo never read keeps the photo rule');
 const { deckMediaMetrics, deckMediaIssues } = await import('./lib/ppt-deck-media-metrics.mjs');
 const project = { templateFidelity: { mode: 'preserve' }, source: { images: [{ id: 'f', ...frame }] } };
 const metrics = deckMediaMetrics(project, [{ nodes: [] }, { nodes: [{ id: 'n', type: 'image', content: { sourceImageId: 'f' }, geometry: { x: 0, y: 0, width: 4.4 * IN, height: 4.4 * IN } }] }]);
 assert.ok(deckMediaIssues(metrics).some(issue => issue.code === 'figure_text_unmeasured' && issue.severity === 'warning'), 'a warning, never a pass');}

// Every figure page that stays says why (Fable 2026-11-03): no_points, space or titles.
{const p = base(), points = [point('V compresses each frame.'), point('Figure 2 details the V model.'), point('M predicts.'), point('C acts.')];
 const raw = () => ({ slides: [{ id: 'cover' }, owner(points), figure(), figure({ id: 'f2', sourceImageIds: ['i2'], refs: ['9'] })] });
 const out = placeCardFigures(p, raw(), hooks(() => false));
 assert.deepEqual(out.slides.filter(page => page.figurePage).map(page => [page.id, page.figureOnlyReason]), [['f1', 'space'], ['f2', 'no_points']], 'f1 had a citing donor but no fit; nothing cites f2');
 const titled = placeCardFigures(base(), raw(), { ...hooks(page => page.keyPoints.length <= 2), validate: () => ({ reason: 'titles', pages: [{ page: 9, title: 'Dream Training', templatePage: 5 }] }) });
 const f1 = titled.slides.find(page => page.id === 'f1');
 assert.equal(f1.figureOnlyReason, 'titles', 'every trial broke a shifted title: B');
 assert.deepEqual(f1.figureOnlyDetail.refusals[0].pages, [{ page: 9, title: 'Dream Training', templatePage: 5 }], 'the ledger names the page and frame');
 assert.ok(titled.slides.every(page => !page.pairedFigurePage), 'a refused trial pairs nothing');}

// D: the trial score adds the title cost only for pages whose title fit
// before a pairing trial; with none it is the schedule score unchanged.
{const { cardScheduleScore, figureTrialScore } = await import('./lib/ppt-api.mjs');
 const p = { outline: [{ id: 'c', title: 'Deck' }, { id: 'a', title: 'A short title', keyPoints: [point('One.'), point('Two.')] }], pages: 2, source: { images: [], semantic: { inventory: { items: [] } } } };
 for (const keep of [undefined, new Set(), new Set(['a'])]) assert.equal(figureTrialScore(keep)(p, 1), cardScheduleScore(p, 1), 'a fitting title costs nothing');}

// Two figures that pair with nothing together are tried one at a time: the one
// that fits takes its points, the other keeps its own page (live Mood f4).
{const p = base(), points = [point('V compresses each frame.'), point('Figure 2 details the V model.'), point('M predicts.'), point('C acts.')];
 const pair = figure({ sourceImageIds: ['i1', 'i2'], refs: ['5', '9'] });
 const out = placeCardFigures(p, { slides: [{ id: 'cover' }, owner(points), pair] }, hooks(page => page.keyPoints.length <= 2 && (page.sourceImageIds || []).length <= 1));
 const shown = out.slides.filter(page => page.sourceImageIds?.length);
 assert.deepEqual(shown.map(page => [page.sourceImageIds, Boolean(page.pairedFigurePage), page.figureOnlyReason || null]), [[['i1'], true, null], [['i2'], false, 'no_points']], 'figure 2 with its points, figure 7 alone (nothing cites it)');
 const none = placeCardFigures(base(), { slides: [{ id: 'cover' }, owner(points), pair] }, hooks(() => false));
 assert.deepEqual(none.slides.filter(page => page.figurePage).map(page => page.sourceImageIds), [['i1', 'i2']], 'kept whole when neither pairs');}

// Every donor already shows a figure and has no two points to spare: no_points, not space.
{const p = base(), points = [point('V compresses each frame.'), point('Figure 2 details the V model.'), point('M predicts.')];
 const host = { ...owner(points), sourceImageIds: ['i2'], cardFigureLayout: true };
 const out = placeCardFigures(p, { slides: [{ id: 'cover' }, host, figure()] }, hooks(page => page.keyPoints.length <= 3 && (page.sourceImageIds || []).length <= 1));
 assert.equal(out.slides.find(page => page.id === 'f1').figureOnlyReason, 'no_points');}

// The ledger: a figure page without a reason takes the default reason and a warning on a paired deck (never a gate); decks made before carry none.
{const { inspectMediaLedger } = await import('./lib/ppt-media-ledger.mjs');
 const ledger = placements => ({ status: 'profiled', basis: 'mapped_component_profile', entries: [], componentIssues: [], deck: null, figurePlacements: placements });
 const codes = placements => inspectMediaLedger(ledger(placements)).map(issue => issue.code);
 assert.ok(codes([{ page: 3, paired: true }, { page: 5, reason: null }]).includes('figure_only_reason_missing'));
 {const placements = [{ page: 3, paired: true }, { page: 5, reason: null }], issue = inspectMediaLedger(ledger(placements)).find(item => item.code === 'figure_only_reason_missing');
  assert.equal(issue.severity, 'warning');assert.equal(placements[1].reason, 'unrecorded', 'the default reason');}
 {const { isBlocking } = await import('./lib/ppt-gate-tiers.mjs');
  for (const code of ['figure_only_reason_missing', 'figure_text_unmeasured', 'figure_text_small', 'media_coverage_low', 'template_picture_repeat', 'layout_reuse_cap_exceeded', 'media_conservation_blocked', 'media_weighted_conservation_blocked']) assert.equal(isBlocking(code), false, code + ' never blocks a card deck');
  for (const code of ['required_source_media_missing', 'export_integrity_failed', 'cited_table_rows_missing']) assert.equal(isBlocking(code), true, code + ' still blocks');}
 assert.ok(!codes([{ page: 3, paired: true }, { page: 5, reason: 'no_points' }]).includes('figure_only_reason_missing'));
 assert.ok(!codes([{ page: 5, reason: null }]).includes('figure_only_reason_missing'), 'a deck made before the pairing');}

console.log('PASS figure pairing: citing points join their figure (nearest added to two), part order by source, whole card when the owner would keep one, F3 fallback, protected donors, cited figures never to notes, same-titled cards kept apart, a figure page beside a second figure, short captions with full notes, unread OCR held as uncertain, a reason on every figure page, D trial score');
