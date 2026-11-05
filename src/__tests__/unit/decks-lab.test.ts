/**
 * Unit tests for long sources, templates and media planning:
 * chunking.ts, import-pdf.ts helpers, media-relations.ts, media-plan.ts,
 * template-pptx.ts and the engine path that ties them together.
 *
 * Run with: npx tsx --test src/__tests__/unit/decks-lab.test.ts
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import JSZip from 'jszip';
import { PNG } from 'pngjs';
import { chunkSource, citations, matchChunks, plannerDigest } from '../../lib/decks/chunking';
import { composeAccents, joinText } from '../../lib/decks/import-pdf';
import { classifyFigure, figureRelevance, profileFigures } from '../../lib/decks/media-relations';
import { planCardMedia, slotAspect, textFill, type PlanFigure } from '../../lib/decks/media-plan';
import { contrast, fontStack, parseTemplate } from '../../lib/decks/template-pptx';
import { blocksFromMarkdown, type SourceBlock, type SourceFigure } from '../../lib/decks/source';
import type { Block } from '../../lib/decks/types';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'decks-lab-test-'));
process.env.CLAUDE_GUI_DATA_DIR = tmp;
process.env.DECKS_MODEL = 'mock';
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const words = (n: number, seed = 'alpha') => Array.from({ length: n }, (_, i) => `${seed}${i % 7} word${i % 11}`).join(' ') + '.';

// ── Chunking ────────────────────────────────────────────────────────────────

function paperBlocks(): { blocks: SourceBlock[]; figures: SourceFigure[] } {
  const blocks: SourceBlock[] = [
    { kind: 'heading', level: 1, text: 'Abstract' },
    { kind: 'paragraph', text: words(60, 'abs') },
    { kind: 'heading', level: 1, text: '1. Introduction' },
    { kind: 'paragraph', text: words(500, 'intro') },
    { kind: 'figure', figureId: 'F1' },
    { kind: 'paragraph', text: words(500, 'intro2') },
    { kind: 'heading', level: 1, text: '2. Method' },
    { kind: 'heading', level: 2, text: '2.1. Tiny part' },
    { kind: 'paragraph', text: words(40, 'tiny') },
    { kind: 'heading', level: 2, text: '2.2. Model' },
    { kind: 'paragraph', text: `As Figure 2 shows, ${words(250, 'model')}` },
    { kind: 'heading', level: 1, text: '3. Results' },
    { kind: 'paragraph', text: `Figure 2 again and Figure 3. ${words(300, 'res')}` },
    { kind: 'figure', figureId: 'F2' },
    { kind: 'table', label: 'Table 1', caption: 'Scores', rows: [['Method', 'Score'], ['Ours', '906 ± 21']] },
    { kind: 'figure', figureId: 'F3' },
    { kind: 'heading', level: 1, text: 'References' },
    { kind: 'paragraph', text: words(400, 'ref') },
    { kind: 'heading', level: 1, text: 'A. Appendix' },
    { kind: 'paragraph', text: words(200, 'app') },
  ];
  const figures: SourceFigure[] = [1, 2, 3].map(n => ({ id: `F${n}`, label: `Figure ${n}`, number: n, caption: `Caption ${n}` }));
  return { blocks, figures };
}

describe('chunking', () => {
  it('drops back matter, merges thin sections, splits dense ones and budgets cards', () => {
    const { blocks, figures } = paperBlocks();
    const { chunks, dropped, figures: placed } = chunkSource(blocks, figures, { targetCards: 8 });
    assert.ok(dropped.some(d => d.label === 'References' && d.chars > 1000), 'references are dropped and counted');
    assert.ok(!chunks.some(c => /ref\d/.test(c.text)), 'no reference text in chunks');
    assert.equal(chunks[0].kind, 'front');
    assert.equal(chunks.at(-1)!.kind, 'appendix');
    // The two-line "2.1" section is not a chunk of its own.
    assert.ok(!chunks.some(c => c.title === '2.1. Tiny part'), 'thin section merged');
    assert.ok(chunks.some(c => c.text.includes('tiny0')), 'its text is kept');
    // The long introduction is split at a paragraph boundary.
    const intro = chunks.filter(c => c.path[0] === '1. Introduction');
    assert.ok(intro.length >= 2 && intro[0].title.endsWith('(1/2)'));
    // Budgets add up to the target minus the title card.
    assert.equal(chunks.reduce((n, c) => n + c.cardBudget, 0), 7);
    // Tables keep their numbers.
    assert.ok(chunks.some(c => c.text.includes('| Ours | 906 ± 21 |')));
    // Figure 2 is cited once in Method and once in Results, where its caption is: the tie goes to Results.
    const results = chunks.find(c => c.path[0] === '3. Results')!;
    assert.ok(results.figureIds.includes('F2') && results.figureIds.includes('F3'));
    assert.equal(placed.find(f => f.id === 'F1')!.chunkId, intro[0].id, 'uncited figure lives where its caption is');
  });

  it('parses figure citations including ranges', () => {
    assert.deepEqual(citations('See Figure 4, Fig. 7 and Figures 2–4.').sort(), [2, 3, 4, 4, 7]);
  });

  it('digest labels chunks and figures; matchChunks finds overlap', () => {
    const { blocks, figures } = paperBlocks();
    const { chunks, figures: f } = chunkSource(blocks, figures, { targetCards: 8 });
    const digest = plannerDigest(chunks, f, 2000);
    assert.match(digest, /\[C1\] Abstract · front · ≈\d cards?/);
    assert.match(digest, /\[F2\] Figure 2/);
    assert.ok(digest.includes('…[trimmed]'), 'long chunks are trimmed for the planner');
    assert.ok(matchChunks('model0 word3 model2 word5', chunks).length >= 1);
  });

  it('reads Markdown into blocks', () => {
    const blocks = blocksFromMarkdown('# Title\n\nPara one\ncontinues.\n\n## Part\n| a | b |\n|---|---|\n| 1 | 2 |\n- item');
    assert.deepEqual(blocks.map(b => b.kind), ['heading', 'paragraph', 'heading', 'table', 'paragraph']);
    assert.equal((blocks[1] as { text: string }).text, 'Para one continues.');
  });
});

describe('pdf text helpers', () => {
  it('re-joins hyphenated lines and composes spacing accents', () => {
    assert.equal(joinText(['a pre-', 'dictive model', 'works']), 'a predictive model works');
    assert.equal(joinText(['state-', 'Of-the-art']), 'state- Of-the-art');
    assert.equal(composeAccents('J ¨urgen and Schmidhuber'), 'Jürgen and Schmidhuber');
  });
});

// ── Media relations ─────────────────────────────────────────────────────────

describe('media relations', () => {
  it('classifies by caption words, checked against pixels', () => {
    assert.equal(classifyFigure('Histogram of cumulative rewards', { whiteShare: 0.7, colors: 120, colorfulness: 0.2 }), 'chart');
    assert.equal(classifyFigure('Training results over generations', { whiteShare: 0.05, colors: 3000, colorfulness: 0.3 }), 'screenshot', 'a "chart" with no white is a rendered frame');
    assert.equal(classifyFigure('Ancient drawing of an environment', null), 'illustration', 'specific words win');
    assert.equal(classifyFigure('Untitled', { whiteShare: 0.6, colors: 80, colorfulness: 0.3 }), 'diagram');
  });

  it('links series and scores relevance', () => {
    const figs: SourceFigure[] = [
      { id: 'F5', label: 'Figure 5', number: 5, caption: 'Histogram of rewards with z only', width: 400, height: 300, chunkId: 'C2' },
      { id: 'F6', label: 'Figure 6', number: 6, caption: 'Histogram of rewards with z and h', width: 410, height: 300, chunkId: 'C2' },
      { id: 'F7', label: 'Figure 7', number: 7, caption: 'Flow diagram of the agent', width: 900, height: 300, chunkId: 'C3' },
    ];
    const out = profileFigures(figs, new Map());
    assert.ok(out[0].series && out[0].series === out[1].series, 'F5 and F6 form a series');
    assert.equal(out[2].series, undefined);
    assert.ok(figureRelevance(out[0], 'As Figure 5 shows, rewards rise', ['C2']) > figureRelevance(out[2], 'As Figure 5 shows, rewards rise', ['C2']));
  });
});

// ── Media plan ──────────────────────────────────────────────────────────────

const h2 = (text: string): Block => ({ id: 'h', type: 'heading', level: 2, text });
const bullets = (n: number, len = 60): Block => ({ id: 'b', type: 'bullets', items: Array.from({ length: n }, (_, i) => `${'x'.repeat(len)} ${i}`) });
const fig = (id: string, w: number, h: number, extra: Partial<PlanFigure> = {}): PlanFigure => ({ id, mediaId: `m_${id}`, label: `Figure ${id.slice(1)}`, caption: `caption ${id}`, width: w, height: h, relevance: 0.5, ...extra });

describe('media plan', () => {
  it('title card takes decoration, never figures', () => {
    const plan = planCardMedia({ blocks: [h2('T')], index: 0, dimensions: '16x9', suggested: 'background', figures: [fig('F1', 400, 300)], decorative: true });
    assert.equal(plan.layout.accent, 'background');
    assert.equal(plan.wantsDecoration, true);
    assert.deepEqual(plan.note.figuresPlaced, []);
  });

  it('light text + a series → gallery sized to the room left', () => {
    const plan = planCardMedia({ blocks: [h2('Results'), bullets(2, 30)], index: 3, dimensions: '16x9', suggested: 'right', decorative: true,
      figures: [fig('F5', 400, 300, { kind: 'chart', series: 'S1' }), fig('F6', 400, 300, { kind: 'chart', series: 'S1' })] });
    const gallery = plan.blocks.at(-1)!;
    assert.equal(gallery.type, 'columns');
    assert.equal(plan.layout.accent, 'none');
    assert.deepEqual(plan.note.figuresPlaced, ['F5', 'F6']);
    assert.match(plan.note.rule, /series S1/);
  });

  it('unrelated figures do not share a card; the weaker is deferred', () => {
    const plan = planCardMedia({ blocks: [h2('Mixed'), bullets(2, 30)], index: 2, dimensions: '16x9', suggested: 'left', decorative: true,
      figures: [fig('F1', 400, 300, { kind: 'photo', relevance: 0.2 }), fig('F2', 1200, 300, { kind: 'diagram', relevance: 0.9 })] });
    assert.deepEqual(plan.note.figuresPlaced, ['F2'], 'most relevant first');
    assert.deepEqual(plan.note.figuresDeferred, ['F1']);
  });

  it('charts keep a readability floor and push the text to shorten', () => {
    const heavy = [h2('Dense'), bullets(9, 150)];
    assert.ok(textFill(heavy, '16x9') > 0.8);
    const plan = planCardMedia({ blocks: heavy, index: 1, dimensions: '16x9', suggested: 'right', decorative: true, figures: [fig('F3', 500, 500, { kind: 'chart' })] });
    assert.ok(plan.layout.accentSize! >= 0.42, `size ${plan.layout.accentSize}`);
    assert.equal(plan.layout.accentFit, 'contain');
    assert.match(plan.note.rule, /text needs shortening/);
  });

  it('a wide figure on a light card goes on top', () => {
    const plan = planCardMedia({ blocks: [h2('Flow'), bullets(2, 40)], index: 1, dimensions: '16x9', suggested: 'right', decorative: true, figures: [fig('F4', 1800, 500, { kind: 'diagram' })] });
    assert.equal(plan.layout.accent, 'top');
    assert.equal(plan.layout.accentMediaId, 'm_F4');
    assert.ok(plan.layout.accentCaption?.startsWith('Figure 4.'));
  });

  it('a photo shaped like the slot fills it; decoration yields to heavy text', () => {
    const photo = planCardMedia({ blocks: [h2('Scene'), bullets(3, 60)], index: 1, dimensions: '16x9', suggested: 'left', decorative: true, figures: [fig('F9', 600, 900, { kind: 'photo' })] });
    assert.equal(photo.layout.accentFit, 'cover');
    const heavy = planCardMedia({ blocks: [h2('Wall of text'), bullets(10, 160)], index: 4, dimensions: '16x9', suggested: 'right', decorative: true, figures: [] });
    assert.equal(heavy.layout.accent, 'none');
    assert.equal(heavy.wantsDecoration, false);
    const light = planCardMedia({ blocks: [h2('Short'), bullets(1, 30)], index: 4, dimensions: '16x9', suggested: 'right', decorative: true, figures: [], rhythm: 'left' });
    assert.equal(light.layout.accent, 'left', 'template rhythm picks the side');
    assert.equal(light.layout.accentSize, 0.5);
  });

  it('slot aspect follows position and size', () => {
    assert.ok(slotAspect({ accent: 'left', accentSize: 0.4 }, '16x9') < 1);
    assert.ok(slotAspect({ accent: 'top', accentSize: 0.3 }, '16x9') > 3);
  });
});

// ── Template ────────────────────────────────────────────────────────────────

const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const W = 12192000, H = 6858000;

function png(w: number, h: number, rgb: [number, number, number], alpha = 255, varied = false): Buffer {
  const img = new PNG({ width: w, height: h });
  for (let i = 0; i < w * h; i++) {
    // `varied`: a textured picture (artwork), not a flat colour block.
    const d = varied ? ((i % w) * 3 + Math.floor(i / w) * 5) % 120 : 0;
    img.data[i * 4] = (rgb[0] + d) % 256; img.data[i * 4 + 1] = (rgb[1] + d * 2) % 256; img.data[i * 4 + 2] = (rgb[2] + d) % 256; img.data[i * 4 + 3] = alpha;
  }
  return PNG.sync.write(img);
}
const xfrm = (x: number, y: number, cx: number, cy: number) => `<a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>`;
const pic = (rid: string, x: number, y: number, cx: number, cy: number, link = '') => `<p:pic><p:nvPicPr><p:cNvPr id="9" name="p">${link}</p:cNvPr><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rid}"/></p:blipFill><p:spPr>${xfrm(x, y, cx, cy)}<a:prstGeom prst="rect"/></p:spPr></p:pic>`;
const rect = (fill: string, x = 0, y = 0, cx = W, cy = H) => `<p:sp><p:nvSpPr><p:cNvPr id="3" name="r"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(x, y, cx, cy)}<a:prstGeom prst="roundRect"/><a:solidFill><a:srgbClr val="${fill}"/></a:solidFill></p:spPr></p:sp>`;
const text = (t: string, color: string, face: string, sz: number, title = false) => `<p:sp><p:nvSpPr><p:cNvPr id="4" name="t"/><p:cNvSpPr/><p:nvPr>${title ? '<p:ph type="title"/>' : ''}</p:nvPr></p:nvSpPr><p:spPr>${xfrm(600000, 600000, 6000000, 800000)}</p:spPr><p:txBody><a:bodyPr/><a:p><a:r><a:rPr lang="en-US" sz="${sz}"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="${face}"/></a:rPr><a:t>${t}</a:t></a:r></a:p></p:txBody></p:sp>`;

async function buildTemplate(): Promise<Buffer> {
  const zip = new JSZip();
  const slides = 4;
  zip.file('ppt/presentation.xml', `<p:presentation ${NS}><p:sldIdLst>${Array.from({ length: slides }, (_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`).join('')}</p:sldIdLst><p:sldSz cx="${W}" cy="${H}"/></p:presentation>`);
  zip.file('ppt/_rels/presentation.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${Array.from({ length: slides }, (_, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/slide" Target="slides/slide${i + 1}.xml"/>`).join('')}<Relationship Id="rId99" Type="${REL}/theme" Target="theme/theme1.xml"/></Relationships>`);
  zip.file('ppt/theme/theme1.xml', `<a:theme ${NS}><a:themeElements><a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3></a:clrScheme><a:fontScheme name="x"><a:majorFont><a:latin typeface="Calibri Light"/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`);
  zip.file('ppt/media/art.png', png(300, 600, [120, 140, 90], 255, true));
  zip.file('ppt/media/logo.png', png(120, 40, [200, 30, 30]));
  zip.file('ppt/media/badge.png', png(90, 24, [10, 10, 80]));
  for (let i = 1; i <= slides; i++) {
    const body = [
      rect('F2EEE3'), // full-slide background paint
      i === 2 ? pic('rIdArt', 0, 0, W * 0.4, H) : '',
      pic('rIdLogo', W - 1500000, 150000, 1200000, 400000),
      pic('rIdBadge', W - 1100000, H - 300000, 1000000, 250000, '<a:hlinkClick r:id="rIdLink"/>'),
      rect('B5523B', 700000, 3000000, 2000000, 1200000), // saturated card fill → accent
      text('Heading words', '2A2620', 'Fraunces SemiBold', 3600, true),
      text('Body text that is long enough to count as the main body colour', '2A2620', 'DM Sans', 1400),
    ].join('');
    zip.file(`ppt/slides/slide${i}.xml`, `<p:sld ${NS}><p:cSld><p:spTree><p:nvGrpSpPr/><p:grpSpPr/>${body}</p:spTree></p:cSld></p:sld>`);
    zip.file(`ppt/slides/_rels/slide${i}.xml.rels`, `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdArt" Type="${REL}/image" Target="../media/art.png"/><Relationship Id="rIdLogo" Type="${REL}/image" Target="../media/logo.png"/><Relationship Id="rIdBadge" Type="${REL}/image" Target="../media/badge.png"/><Relationship Id="rIdLink" Type="${REL}/hyperlink" Target="https://vendor.example/" TargetMode="External"/></Relationships>`);
  }
  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('template parsing', () => {
  it('reads painted colours (not the Office default scheme), fonts, art, rhythm and logo', async () => {
    const t = await parseTemplate(await buildTemplate(), 'Brand.pptx');
    assert.equal(t.theme.colors.background, '#f2eee3');
    assert.equal(t.theme.colors.text, '#2a2620');
    assert.equal(t.theme.colors.accent, '#b5523b', 'the saturated fill, not Office blue');
    assert.notEqual(t.theme.colors.accent2, '#4472c4');
    assert.ok(contrast(t.theme.colors.muted, t.theme.colors.background) >= 3);
    assert.match(t.theme.fonts.heading, /^"Fraunces SemiBold", "Fraunces", Georgia/);
    assert.match(t.theme.fonts.body, /^"DM Sans", Inter/);
    assert.deepEqual(t.rhythm, ['none', 'left', 'none', 'none']);
    assert.equal(t.images.length, 1);
    assert.equal(t.images[0].role, 'left');
    assert.equal(t.logo?.slot, 'topRight');
    assert.equal(t.logo?.slides, 4);
    assert.ok(t.notes.some(n => /linking to a web page/.test(n)), 'the linked badge is left out and reported');
    assert.ok(t.theme.id.startsWith('tpl_'));
  });

  it('font stacks fall back by family', () => {
    assert.match(fontStack('PT Serif'), /serif$/);
    assert.match(fontStack('Roboto Medium'), /^"Roboto Medium", "Roboto", Inter/);
  });
});

// ── Engine: sourced deck with a template ────────────────────────────────────

describe('engine with a structured source and a template', () => {
  it('cites chunks, places figures, applies the template theme, art and logo', async () => {
    const { createDeck, waitForJobs, groundOutline } = await import('../../lib/decks/engine');
    const store = await import('../../lib/decks/store');
    const { blocks, figures } = paperBlocks();
    const { chunks, figures: homed } = chunkSource(blocks, figures, { targetCards: 6 });
    const doc = { kind: 'pdf' as const, title: 'Paper', chunks, figures: profileFigures(homed, new Map()), dropped: [], warnings: [] };
    const template = await parseTemplate(await buildTemplate(), 'Brand.pptx');
    const figureImages = figures.map(f => ({ figureId: f.id, data: png(400, 300, [30, 90, 160]), mime: 'image/png' as const, width: 400, height: 300 }));
    const { deck } = await createDeck(
      { settings: { inputText: 'Paper\n\nbody', numCards: 6, mode: 'express' }, title: 'Paper', sourceDoc: doc },
      { attachments: { figures: figureImages, template } },
    );
    await waitForJobs();
    await waitForJobs();
    const done = store.getDeck(deck.id)!;
    assert.equal(done.status, 'ready');
    assert.equal(done.settings.themeId, template.theme.id);
    assert.equal(done.template?.theme.colors.accent, '#b5523b');
    assert.ok(done.sourceDoc!.figures.every(f => f.mediaId), 'figures are hosted');
    assert.equal(done.headerFooter.topRight?.type, 'logo');
    assert.ok(done.outline.slice(1).every(c => c.sourceIds?.length), 'every body card cites a chunk');
    const placed = done.cards.flatMap(c => c.media?.figuresPlaced || []);
    assert.equal(new Set(placed).size, placed.length, 'no figure is used twice');
    assert.ok(placed.length >= 1);
    for (const c of done.cards.filter(x => x.media?.figuresPlaced.length)) assert.ok(c.layout.accentMediaId || c.blocks.some(b => b.type === 'columns'));

    // Grounding fills in missing sources and keeps figures unique.
    const grounded = groundOutline({ title: 'x', cards: [{ title: 'T', points: [] }, { title: 'Model', points: ['model0 word1 model3 word4'], figures: ['F2', 'F9'] }, { title: 'Again', points: ['res1'], figures: ['F2'] }] }, done.sourceDoc!);
    assert.ok(grounded.cards[1].sources?.length);
    assert.deepEqual(grounded.cards[1].figures, ['F2']);
    assert.deepEqual(grounded.cards[2].figures, []);
  });
});

// ── Template components (recognition → arrangement → matching) ─────────────

import { arrangeComponent, canArrange } from '../../lib/decks/component-layout';
import { applyComponent, itemsOf, matchComponent } from '../../lib/decks/layout-match';
import type { TemplateComponent } from '../../lib/decks/types';

const tbox = (t: string, x: number, y: number, cx: number, cy: number, sz: number, color = '2A2620') =>
  `<p:sp><p:nvSpPr><p:cNvPr id="5" name="t"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(x, y, cx, cy)}<a:prstGeom prst="rect"/><a:noFill/></p:spPr><p:txBody><a:bodyPr anchor="ctr"/><a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="en-US" sz="${sz}"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:rPr><a:t>${t}</a:t></a:r></a:p></p:txBody></p:sp>`;

async function buildComponentTemplate(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('ppt/presentation.xml', `<p:presentation ${NS}><p:sldIdLst><p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst><p:sldSz cx="${W}" cy="${H}"/></p:presentation>`);
  zip.file('ppt/_rels/presentation.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/slide" Target="slides/slide1.xml"/><Relationship Id="rId2" Type="${REL}/slide" Target="slides/slide2.xml"/></Relationships>`);
  // Slide 1: four transparent petal pieces stacked on one box, numbers 1–4 clockwise, labels around.
  zip.file('ppt/media/petal.png', png(200, 200, [40, 40, 30], 90));
  zip.file('ppt/media/photo.jpg', png(300, 200, [120, 90, 60])); // opaque "photo" (PNG bytes, .jpg name is irrelevant to the parser's opacity check)
  zip.file('ppt/media/photo.png', (() => { const img = new PNG({ width: 300, height: 200 }); for (let i = 0; i < 300 * 200; i++) { img.data[i * 4] = (i * 7) % 255; img.data[i * 4 + 1] = (i * 13) % 255; img.data[i * 4 + 2] = (i * 3) % 255; img.data[i * 4 + 3] = 255; } return PNG.sync.write(img); })());
  const P = { x: 7000000, y: 3000000, s: 2000000 };
  const petals = [1, 2, 3, 4].map(() => pic('rIdP', P.x, P.y, P.s, P.s)).join('');
  const nums = [[1, 0.25, 0.25], [2, 0.75, 0.25], [3, 0.75, 0.75], [4, 0.25, 0.75]].map(([n, fx, fy]) => tbox(String(n), P.x + P.s * fx - 120000, P.y + P.s * fy - 120000, 240000, 240000, 1800, 'FFFFFF')).join('');
  const labels = [['Alpha label', 4000000, 3300000], ['Beta label', 9300000, 3300000], ['Gamma label', 9300000, 4500000], ['Delta label', 4000000, 4500000]].map(([t, x, y]) => tbox(String(t), Number(x), Number(y), 2000000, 400000, 1600)).join('');
  const title = tbox('Slide title', 600000, 400000, 8000000, 600000, 3200);
  zip.file('ppt/slides/slide1.xml', `<p:sld ${NS}><p:cSld><p:spTree><p:nvGrpSpPr/><p:grpSpPr/>${title}${petals}${nums}${labels}</p:spTree></p:cSld></p:sld>`);
  zip.file('ppt/slides/_rels/slide1.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdP" Type="${REL}/image" Target="../media/petal.png"/></Relationships>`);
  // Slide 2: a row of three items, each with a photo above, a title and a body.
  const row = [0, 1, 2].map(i => {
    const x = 800000 + i * 3700000;
    return pic('rIdPh', x, 1800000, 3300000, 1800000) + tbox(`Item ${i + 1}`, x, 3700000, 3300000, 400000, 1800) + tbox(`Body text for item ${i + 1} explaining it`, x, 4200000, 3300000, 700000, 1200);
  }).join('');
  zip.file('ppt/slides/slide2.xml', `<p:sld ${NS}><p:cSld><p:spTree><p:nvGrpSpPr/><p:grpSpPr/>${tbox('Another title', 600000, 400000, 8000000, 600000, 3200)}${row}</p:spTree></p:cSld></p:sld>`);
  zip.file('ppt/slides/_rels/slide2.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdPh" Type="${REL}/image" Target="../media/photo.png"/></Relationships>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('template components', () => {
  it('recognises a numbered radial diagram and a row with picture slots', async () => {
    const t = await parseTemplate(await buildComponentTemplate(), 'Components.pptx');
    const radial = t.components.find(c => c.slide === 1)!;
    assert.equal(radial.kind, 'radial');
    assert.equal(radial.units, 4);
    assert.ok(radial.numbered);
    assert.deepEqual(radial.slots.filter(s => s.role === 'title').sort((a, b) => a.unit - b.unit).map(s => s.sample), ['Alpha label', 'Beta label', 'Gamma label', 'Delta label'], 'units follow the template numbers (clockwise)');
    assert.equal(radial.layers.filter(l => l.type === 'image').length, 4);
    assert.ok(t.componentImages.some(i => i.key.endsWith('petal.png')));
    const row = t.components.find(c => c.slide === 2)!;
    assert.equal(row.kind, 'row');
    assert.equal(row.units, 3);
    assert.equal(row.imageSlots, 3, 'each item owns its photo');
    assert.ok(row.hasBody);
    assert.ok(!t.components.some(c => c.slots.some(s => s.sample === 'Slide title')), 'titles stay out');
  });

  it('re-arranges rows for other counts; radial needs its own count', async () => {
    const t = await parseTemplate(await buildComponentTemplate(), 'Components.pptx');
    const row = t.components.find(c => c.kind === 'row')! as unknown as TemplateComponent;
    const radial = t.components.find(c => c.kind === 'radial')! as unknown as TemplateComponent;
    assert.ok(canArrange(row, 4) && canArrange(row, 2));
    assert.ok(!canArrange(radial, 3));
    const four = arrangeComponent(row, 4);
    assert.equal(four.units, 4);
    assert.ok(four.aspect > row.aspect, 'a longer row is wider');
    assert.equal(four.slots.filter(s => s.role === 'title').length, 4);
    assert.ok(four.slots.every(s => s.x >= -0.001 && s.x + s.w <= 1.001), 'stays inside the box');
    const two = arrangeComponent(row, 2);
    assert.ok(two.aspect < row.aspect);
  });

  it('matches content to components generically (items, figures, variety)', async () => {
    const t = await parseTemplate(await buildComponentTemplate(), 'Components.pptx');
    const comps = t.components as unknown as TemplateComponent[];
    const ctx = () => ({ uses: new Map<string, number>(), usedCards: 0, totalCards: 10 });
    const overview = matchComponent({ title: 'Overview of the four parts', points: ['Vision', 'Memory', 'Control', 'Dreams'] }, comps, ctx());
    assert.equal(overview?.component.kind, 'radial');
    const explained = matchComponent({ title: 'Three ideas', points: ['Speed: faster delivery', 'Cost: lower spend', 'Quality: fewer bugs'] }, comps, ctx());
    assert.equal(explained?.component.kind, 'row');
    assert.deepEqual(explained?.items[0], { title: 'Speed', text: 'faster delivery' });
    const figs = [1, 2].map(n => ({ id: `F${n}`, mediaId: `m${n}`, label: `Figure ${n}`, caption: `Histogram ${n}`, kind: 'chart', series: 'S1' }));
    const withFigures = matchComponent({ title: 'Results', points: ['a', 'b'], figureIds: ['F1', 'F2'] }, comps, ctx(), figs);
    assert.equal(withFigures?.component.kind, 'row', 'related figures go to a component with picture slots');
    assert.deepEqual(withFigures?.figureIds, ['F1', 'F2']);
    assert.equal(withFigures?.items[1].mediaId, 'm2');
    assert.equal(matchComponent({ title: 'One figure', points: ['a', 'b'], figureIds: ['F1'] }, comps, ctx(), figs.slice(0, 1)), null, 'a single figure stays with the media planner');
    const busy = { uses: new Map([[overview!.component.id, 3]]), previous: overview!.component.id, usedCards: 1, totalCards: 10 };
    assert.equal(matchComponent({ title: 'Overview again', points: ['a', 'b', 'c', 'd'] }, comps, busy), null, 'repetition is penalised');
    assert.deepEqual(itemsOf(['Ab: c', 'plain']), [{ title: 'Ab', text: 'c' }, { title: 'plain' }]);
  });

  it('applyComponent replaces the list the writer produced', async () => {
    const t = await parseTemplate(await buildComponentTemplate(), 'Components.pptx');
    const comps = t.components as unknown as TemplateComponent[];
    const d = matchComponent({ title: 'Overview', points: ['A', 'B', 'C', 'D'] }, comps, { uses: new Map(), usedCards: 0, totalCards: 10 })!;
    const blocks = applyComponent([{ id: 'h', type: 'heading', level: 2, text: 'Overview' }, { id: 'b', type: 'bullets', items: ['A', 'B', 'C', 'D'] }], d);
    assert.equal(blocks[1].type, 'templateDiagram');
    assert.equal(blocks.length, 2);
  });
});
