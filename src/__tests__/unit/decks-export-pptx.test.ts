/**
 * Unit tests for the native PPTX exporter (src/lib/decks/export-pptx.ts).
 *
 * Run with: npx tsx --test src/__tests__/unit/decks-export-pptx.test.ts
 *
 * Builds a fixture deck covering every block type, every accent position, a
 * hidden card, speaker notes and header/footer slots, then unzips the .pptx
 * and checks the parts PowerPoint will read.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { buildDeckPptx, dedupeParagraphProps, imageSize, slideSize, svgFallbackPng, type PptxMedia } from '../../lib/decks/export-pptx';
import type { Block, Card, CardDimensions, CardLayout, Deck, DeckFormat } from '../../lib/decks/types';

let n = 0;
const id = (p: string) => `${p}_${++n}`;
const card = (blocks: Block[], layout: Partial<CardLayout> = {}, extra: Partial<Card> = {}): Card => ({
  id: id('card'), blocks, layout: { accent: 'none', align: 'left', ...layout }, hidden: false, notes: '', stage: 'done', ...extra,
});
const deckOf = (cards: Card[], over: { dimensions?: CardDimensions; format?: DeckFormat; themeId?: string; headerFooter?: Deck['headerFooter']; title?: string } = {}): Deck => ({
  id: 'deck_test', title: over.title ?? 'Fixture Deck', status: 'ready', version: 1, warnings: [], outline: [], cards,
  headerFooter: over.headerFooter ?? {}, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  settings: {
    inputText: 'x', textMode: 'generate', amount: 'medium', language: 'en', numCards: cards.length, cardSplit: 'auto',
    imageSource: 'themeAccent', themeId: over.themeId ?? 'slate', format: over.format ?? 'presentation', dimensions: over.dimensions ?? '16x9',
  },
});

// A real PNG for readMedia (the exporter's own encoder, 4:3).
const PHOTO: PptxMedia = { data: svgFallbackPng('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><defs><linearGradient id="g"><stop stop-color="#ff0000"/><stop stop-color="#0000ff"/></linearGradient></defs><rect fill="#ffffff"/></svg>'), mime: 'image/png' };
const readMedia = (mediaId: string): PptxMedia | null => (mediaId === 'media_photo' ? PHOTO : null);

const everyBlock: Block[][] = [
  [
    { id: id('b'), type: 'heading', level: 1, text: 'Title Alpha **Bold** Heading' },
    { id: id('b'), type: 'paragraph', text: 'Plain lead, **strong run**, *italic run*, `code run` and [link run](https://example.com/docs).' },
    { id: id('b'), type: 'divider' },
    { id: id('b'), type: 'heading', level: 2, text: 'Second Level Heading' },
    { id: id('b'), type: 'heading', level: 3, text: 'Third Level Heading' },
  ],
  [
    { id: id('b'), type: 'bullets', items: ['Bullet one', 'Bullet **two** with bold', 'Bullet three'] },
    { id: id('b'), type: 'numbered', items: ['Numbered first', 'Numbered second'] },
  ],
  [
    { id: id('b'), type: 'quote', text: 'Quote body text here', attribution: 'Quote Author' },
    { id: id('b'), type: 'callout', tone: 'warning', title: 'Callout Title', text: 'Callout body text' },
    { id: id('b'), type: 'code', language: 'ts', code: 'const answer = 42;\n\n  return answer;' },
  ],
  [
    { id: id('b'), type: 'table', header: ['Region', 'Revenue'], rows: [['North', '120'], ['South', 'see [report](https://example.com/r)']] },
  ],
  [
    { id: id('b'), type: 'chart', chartType: 'bar', labels: ['Q1', 'Q2', 'Q3'], series: [{ name: 'Bar Series A', values: [1, 2, 3] }, { name: 'Bar Series B', values: [3, 2, 1] }], unit: 'k' },
  ],
  [
    { id: id('b'), type: 'chart', chartType: 'line', labels: ['Jan', 'Feb', 'Mar'], series: [{ name: 'Line Series', values: [5, 7, 6] }], unit: '%' },
    { id: id('b'), type: 'chart', chartType: 'pie', labels: ['Slice X', 'Slice Y'], series: [{ name: 'Pie Series', values: [60, 40] }] },
  ],
  [
    { id: id('b'), type: 'timeline', items: [{ label: '2024', title: 'Timeline Start', text: 'Kick-off' }, { label: '2025', title: 'Timeline Middle' }, { label: '2026', title: 'Timeline End', text: 'Launch' }] },
    { id: id('b'), type: 'steps', items: [{ title: 'Step Plan', text: 'Plan it' }, { title: 'Step Build' }, { title: 'Step Ship', text: 'Ship it' }] },
  ],
  [
    { id: id('b'), type: 'metrics', items: [{ value: '42%', label: 'Metric Growth', detail: 'Year over year' }, { value: '3.1M', label: 'Metric Users' }] },
    { id: id('b'), type: 'grid', items: [{ title: 'Grid Speed', text: 'Fast', icon: 'S' }, { title: 'Grid Safety' }, { title: 'Grid Scale', text: 'Big' }, { title: 'Grid Cost' }] },
  ],
  [
    { id: id('b'), type: 'columns', columns: [[{ id: id('b'), type: 'paragraph', text: 'Left column text' }], [{ id: id('b'), type: 'bullets', items: ['Right column bullet'] }]] },
    { id: id('b'), type: 'image', mediaId: 'media_photo', alt: 'Photo alt', caption: 'Photo caption', fit: 'cover' },
    { id: id('b'), type: 'image', alt: 'Placeholder alt text', fit: 'cover', placeholder: true },
  ],
];

const ACCENTS: CardLayout['accent'][] = ['none', 'left', 'right', 'top', 'background', 'left', 'right', 'top', 'background'];
const fixtureCards: Card[] = everyBlock.map((blocks, i) => card(blocks, { accent: ACCENTS[i], align: i === 0 ? 'center' : 'left' }, { notes: i === 1 ? 'Speaker notes for the bullets card' : '' }));
// Same accentSeed on two cards with the same accent slot → identical art; card 2 (left) has its own seed.
fixtureCards[5].layout = { ...fixtureCards[5].layout, accent: 'left', accentSeed: 'shared-seed' };
fixtureCards[1].layout = { ...fixtureCards[1].layout, accent: 'left', accentSeed: 'shared-seed' };
fixtureCards[7].layout = { ...fixtureCards[7].layout, accent: 'top', accentMediaId: 'media_photo' };
const hiddenCard = card([{ id: id('b'), type: 'paragraph', text: 'Secret hidden card text' }], {}, { hidden: true, notes: 'Hidden notes' });
const allCards = [...fixtureCards.slice(0, 4), hiddenCard, ...fixtureCards.slice(4)];
const fixture = deckOf(allCards, {
  title: 'Fixture Deck',
  headerFooter: { bottomLeft: { type: 'text', value: 'Footer Confidential' }, bottomRight: { type: 'cardNumber' }, topRight: { type: 'logo' }, hideFromFirstCard: true },
});

interface Unzipped { zip: JSZip; slides: string[]; all: string }
async function unzip(buf: Buffer): Promise<Unzipped> {
  const zip = await JSZip.loadAsync(buf);
  const names = Object.keys(zip.files).filter(f => /^ppt\/slides\/slide\d+\.xml$/.test(f)).sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  const slides = await Promise.all(names.map(f => zip.file(f)!.async('string')));
  return { zip, slides, all: slides.join('\n') };
}
const sldSz = async (zip: JSZip) => {
  const xml = await zip.file('ppt/presentation.xml')!.async('string');
  const m = /<p:sldSz cx="(\d+)" cy="(\d+)"/.exec(xml);
  assert.ok(m, 'p:sldSz present');
  return { cx: Number(m[1]), cy: Number(m[2]) };
};

describe('buildDeckPptx — fixture deck with every block type', () => {
  let out: Unzipped;
  before(async () => { out = await unzip(await buildDeckPptx(fixture, { readMedia })); });

  it('emits one slide per visible card and skips the hidden card', () => {
    assert.equal(out.slides.length, allCards.filter(c => !c.hidden).length);
    assert.equal(out.slides.length, 9);
    assert.ok(!out.all.includes('Secret hidden card text'));
  });

  it('keeps every text as native runs in the slide XML', () => {
    const expected = [
      'Title Alpha ', 'Bold', 'Plain lead, ', 'strong run', 'italic run', 'code run', 'link run', 'Second Level Heading', 'Third Level Heading',
      'Bullet one', 'Bullet ', 'two', 'Bullet three', 'Numbered first', 'Numbered second',
      'Quote body text here', '— Quote Author', 'Callout Title', 'Callout body text', 'const answer = 42;', '  return answer;',
      'Region', 'Revenue', 'North', 'South', 'report',
      'Timeline Start', 'Kick-off', 'Timeline End', 'Step Plan', 'Step Build', 'Plan it',
      '42%', 'Metric Growth', 'Year over year', '3.1M', 'Grid Speed', 'Grid Cost', 'Fast',
      'Left column text', 'Right column bullet', 'Photo caption', 'Placeholder alt text',
    ];
    for (const text of expected) assert.ok(out.all.includes(`<a:t>${text}</a:t>`), `missing text run: ${text}`);
    assert.ok(out.all.includes('<a:t>2024</a:t>'), 'timeline label');
  });

  it('formats inline runs: bold, italic, code font, hyperlinks', () => {
    const s1 = out.slides[0];
    assert.match(s1, /<a:rPr[^>]* b="1"[^>]*>(?:(?!<\/a:rPr>)[\s\S])*<\/a:rPr><a:t>strong run<\/a:t>/);
    assert.match(s1, /<a:rPr[^>]* i="1"[^>]*>(?:(?!<\/a:rPr>)[\s\S])*<\/a:rPr><a:t>italic run<\/a:t>/);
    assert.match(s1, /typeface="Consolas"(?:(?!<\/a:rPr>)[\s\S])*<\/a:rPr><a:t>code run<\/a:t>/);
    assert.match(s1, /<a:hlinkClick r:id="rId\d+"(?:(?!<\/a:rPr>)[\s\S])*<\/a:rPr><a:t>link run<\/a:t>/);
    assert.ok(!out.all.includes('rIdundefined'), 'every hyperlink has a relationship');
  });

  it('uses real PowerPoint bullets and numbering', () => {
    const s2 = out.slides[1];
    assert.equal((s2.match(/<a:buChar /g) || []).length, 3, 'bullets for 3 items');
    assert.equal((s2.match(/<a:buAutoNum /g) || []).length, 2, 'numbering for 2 items');
  });

  it('writes one <a:pPr> per paragraph (pptxgenjs duplicates are stripped)', () => {
    for (const xml of out.slides) {
      assert.ok(!/<\/a:r><a:pPr/.test(xml), 'no pPr after a run');
      for (const p of xml.match(/<a:p>[\s\S]*?<\/a:p>/g) || []) assert.ok((p.match(/<a:pPr\b/g) || []).length <= 1);
    }
  });

  it('creates a native table with an accent header row', () => {
    assert.ok(out.slides[3].includes('<a:tbl>'));
    assert.match(out.slides[3], /<a:srgbClr val="2457C5"\/>/, 'slate accent fill on header cells');
  });

  it('creates a native chart part for each chart, with series names and units', async () => {
    const charts = Object.keys(out.zip.files).filter(f => /^ppt\/charts\/chart\d+\.xml$/.test(f));
    assert.equal(charts.length, 3);
    const xml = (await Promise.all(charts.map(f => out.zip.file(f)!.async('string')))).join('\n');
    for (const name of ['Bar Series A', 'Bar Series B', 'Line Series', 'Pie Series', 'Q1', 'Slice X']) assert.ok(xml.includes(name), `chart contains ${name}`);
    assert.ok(xml.includes('<c:barChart>'));
    assert.ok(xml.includes('<c:lineChart>'));
    assert.ok(xml.includes('<c:pieChart>'));
    assert.ok(xml.includes('General&quot;k&quot;'), 'unit in data label format');
    assert.ok(xml.includes('General&quot;%&quot;'), 'percent unit quoted as a literal');
  });

  it('writes speaker notes', async () => {
    const notes = Object.keys(out.zip.files).filter(f => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(f));
    const texts = await Promise.all(notes.map(f => out.zip.file(f)!.async('string')));
    assert.ok(texts.some(t => t.includes('Speaker notes for the bullets card')));
    assert.ok(!texts.some(t => t.includes('Hidden notes')));
  });

  it('renders header/footer slots with the visible card number, hidden on the first card', () => {
    assert.ok(!out.slides[0].includes('Footer Confidential'));
    assert.ok(out.slides[1].includes('<a:t>Footer Confidential</a:t>'));
    assert.ok(out.slides[1].includes('<a:t>2</a:t>'));
    // Slide 5 follows the hidden card: numbered by visible index.
    assert.ok(out.slides[4].includes('<a:t>5</a:t>'));
    assert.ok(out.slides[4].includes('<a:t>Fixture Deck</a:t>'), 'logo slot falls back to the deck title');
  });

  it('embeds accent art as SVG with a real PNG fallback, and media images', async () => {
    const svgs = Object.keys(out.zip.files).filter(f => /^ppt\/media\/.*\.svg$/.test(f));
    // Accents: left(seeded), right, top, background, left(seeded), right, background = 7 SVGs; the media accent is a PNG.
    assert.equal(svgs.length, 7);
    assert.ok(out.all.includes('asvg:svgBlip'));
    for (const svg of svgs) {
      const m = /image-(\d+)-(\d+)\.svg$/.exec(svg)!;
      const png = await out.zip.file(`ppt/media/image-${m[1]}-${Number(m[2]) - 1}.png`)!.async('nodebuffer');
      assert.deepEqual([...png.subarray(1, 4)].map(b => String.fromCharCode(b)).join(''), 'PNG');
      const size = imageSize(png, 'image/png')!;
      assert.ok(Math.max(size.w, size.h) === 192, 'generated fallback, not the 100×119 broken-image placeholder');
    }
    // background accent → full-bleed art + translucent overlay
    assert.match(out.slides[8], /<a:alpha val="72000"\/>|<a:alpha val="55000"\/>/);
    // image block with media → a picture; placeholder → dashed frame
    assert.ok((out.slides[8].match(/<p:pic>/g) || []).length >= 2, 'accent + image block');
    assert.ok(out.slides[8].includes('<a:prstDash val="dash"/>'));
  });

  it('same accentSeed produces identical art bytes; a different seed does not', async () => {
    const svgOf = async (slideIndex: number) => {
      const name = Object.keys(out.zip.files).find(f => new RegExp(`^ppt/media/image-${slideIndex}-\\d+\\.svg$`).test(f))!;
      return out.zip.file(name)!.async('string');
    };
    const seededA = await svgOf(2); // card 2 (accent left, seed shared-seed)
    const seededB = await svgOf(6); // card 7 after the hidden one (accent left, seed shared-seed)
    const other = await svgOf(7); // accent right: same slot size, seeded by its own card id
    assert.equal(seededA, seededB);
    assert.notEqual(seededA, other);
  });

  it('sets the slide size and deck title metadata', async () => {
    assert.deepEqual(await sldSz(out.zip), { cx: 12192000, cy: 6858000 });
    const core = await out.zip.file('docProps/core.xml')!.async('string');
    assert.ok(core.includes('<dc:title>Fixture Deck</dc:title>'));
  });
});

describe('buildDeckPptx — sizes and fit', () => {
  const simple = () => [card([{ id: id('b'), type: 'heading', level: 1, text: 'Size check' }])];

  it('4x3 decks are 10 × 7.5 in', async () => {
    const { zip } = await unzip(await buildDeckPptx(deckOf(simple(), { dimensions: '4x3' })));
    assert.deepEqual(await sldSz(zip), { cx: 9144000, cy: 6858000 });
  });

  it('A4 documents are portrait 210 × 297 mm', async () => {
    const { zip } = await unzip(await buildDeckPptx(deckOf(simple(), { dimensions: 'a4', format: 'document' })));
    assert.deepEqual(await sldSz(zip), { cx: Math.round((210 / 25.4) * 914400), cy: Math.round((297 / 25.4) * 914400) });
  });

  it('pageless documents map to A4, fluid presentations to 16:9', async () => {
    assert.equal(slideSize('pageless', 'document').dimensions, 'a4');
    assert.equal(slideSize('fluid', 'document').dimensions, 'a4');
    assert.equal(slideSize('fluid', 'presentation').dimensions, '16x9');
    const { zip } = await unzip(await buildDeckPptx(deckOf(simple(), { dimensions: 'pageless', format: 'document' })));
    assert.deepEqual(await sldSz(zip), { cx: 7560000, cy: 10692000 });
  });

  it('scales an overflowing card down uniformly, never below 10 pt', async () => {
    const long = 'This sentence is deliberately long so that the paragraph wraps across several lines on the slide. ';
    const blocks: Block[] = Array.from({ length: 10 }, () => ({ id: id('b'), type: 'paragraph' as const, text: long.repeat(2) }));
    const { slides } = await unzip(await buildDeckPptx(deckOf([card(blocks)])));
    const sizes = [...slides[0].matchAll(/ sz="(\d+)"/g)].map(m => Number(m[1]));
    assert.ok(sizes.length > 0);
    assert.ok(Math.max(...sizes) < 1950, 'body text shrank from 19.5 pt');
    assert.ok(Math.min(...sizes) >= 1000, 'never below 10 pt');
  });

  it('keeps designed sizes when the content fits', async () => {
    const { slides } = await unzip(await buildDeckPptx(deckOf([card([{ id: id('b'), type: 'paragraph', text: 'Short' }])])));
    assert.match(slides[0], / sz="1950"/, '26 px on a 1280 canvas → 19.5 pt on a 13.333 in slide');
  });

  it('handles an all-hidden deck and missing media without throwing', async () => {
    const hidden = card([{ id: id('b'), type: 'paragraph', text: 'x' }], {}, { hidden: true });
    const { slides } = await unzip(await buildDeckPptx(deckOf([hidden])));
    assert.equal(slides.length, 1, 'PowerPoint needs at least one slide');
    const missing = card([{ id: id('b'), type: 'image', mediaId: 'gone', alt: 'Missing media alt', fit: 'cover' }], { accent: 'left', accentMediaId: 'gone' });
    const res = await unzip(await buildDeckPptx(deckOf([missing]), { readMedia: () => null }));
    assert.ok(res.all.includes('Missing media alt'), 'falls back to the placeholder');
    assert.ok(res.all.includes('asvg:svgBlip'), 'accent falls back to the SVG art');
  });
});

describe('helpers', () => {
  it('dedupeParagraphProps keeps only the leading pPr', () => {
    const xml = '<a:p><a:pPr algn="l"><a:buNone/></a:pPr><a:r><a:t>a</a:t></a:r><a:pPr indent="0"><a:buNone/></a:pPr><a:r><a:t>b</a:t></a:r></a:p>';
    assert.equal(dedupeParagraphProps(xml), '<a:p><a:pPr algn="l"><a:buNone/></a:pPr><a:r><a:t>a</a:t></a:r><a:r><a:t>b</a:t></a:r></a:p>');
  });

  it('imageSize reads PNG and JPEG headers', () => {
    assert.deepEqual(imageSize(PHOTO.data, 'image/png'), { w: 192, h: 144 });
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x02, 0x58, 0x03, 0, 0, 0, 0]);
    assert.deepEqual(imageSize(jpeg, 'image/jpeg'), { w: 600, h: 300 });
  });
});
