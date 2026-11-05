/**
 * Unit tests for presentation import (src/lib/decks/import.ts, import-pptx.ts).
 *
 * Run with: npx tsx --test src/__tests__/unit/decks-import.test.ts
 *
 * Builds a small PPTX in memory (3 slides with title/body placeholders, one
 * notes slide, a slide-number placeholder) and checks order, titles, points
 * and notes; then Markdown splitting, rejections and the intent mapping.
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import JSZip from 'jszip';
import { ImportError, MAX_IMPORT_BYTES, condensedCardCount, importRequest, parsePresentation, parseText } from '../../lib/decks/import';
import { decodeXml } from '../../lib/decks/import-pptx';

// The engine (loaded lazily below) keeps its database in a temp dir and uses the offline mock model.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'decks-import-test-'));
process.env.CLAUDE_GUI_DATA_DIR = tmp;
process.env.DECKS_MODEL = 'mock';
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const para = (...runs: string[]) => `<a:p><a:pPr lvl="0"/>${runs.map(r => `<a:r><a:rPr lang="en-US"/><a:t>${r}</a:t></a:r>`).join('')}</a:p>`;
const shape = (ph: string | null, paragraphs: string[]) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="2" name="s"/><p:cNvSpPr/><p:nvPr>${ph === null ? '' : ph ? `<p:ph type="${ph}"/>` : '<p:ph idx="1"/>'}</p:nvPr></p:nvSpPr><p:spPr/>` +
  `<p:txBody><a:bodyPr/><a:lstStyle/>${paragraphs.join('')}</p:txBody></p:sp>`;
const slide = (...shapes: string[]) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld ${NS}><p:cSld><p:spTree><p:nvGrpSpPr/><p:grpSpPr/>${shapes.join('')}</p:spTree></p:cSld></p:sld>`;

async function buildPptx(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
${[1, 2, 3].map(i => `<Override PartName="/ppt/slides/slide${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')}
<Override PartName="/ppt/notesSlides/notesSlide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/></Types>`);
  zip.file('_rels/.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="ppt/presentation.xml"/></Relationships>`);
  // Presentation order (sldIdLst) differs from file numbering: slide3 comes second.
  zip.file('ppt/presentation.xml', `<p:presentation ${NS}><p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId4"/><p:sldId id="258" r:id="rId3"/></p:sldIdLst></p:presentation>`);
  zip.file('ppt/_rels/presentation.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId2" Type="${REL}/slide" Target="slides/slide1.xml"/><Relationship Id="rId3" Type="${REL}/slide" Target="slides/slide2.xml"/>
<Relationship Id="rId4" Type="${REL}/slide" Target="/ppt/slides/slide3.xml"/><Relationship Id="rId9" Type="${REL}/hyperlink" Target="https://example.com/x" TargetMode="External"/></Relationships>`);
  zip.file('ppt/slides/slide1.xml', slide(
    shape('ctrTitle', [para('Quarterly ', 'Review')]),
    shape('subTitle', [para('Growth &amp; retention'), para('')]),
    shape('sldNum', [`<a:p><a:fld id="{1}" type="slidenum"><a:t>1</a:t></a:fld></a:p>`]),
  ));
  zip.file('ppt/slides/_rels/slide1.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="${REL}/notesSlide" Target="../notesSlides/notesSlide1.xml"/></Relationships>`);
  zip.file('ppt/slides/slide2.xml', slide(
    shape('', [para('Body before title')]),
    shape('title', [para('Next steps')]),
    shape('ftr', [para('Confidential')]),
    shape('dt', [para('2026-11-05')]),
  ));
  zip.file('ppt/slides/slide3.xml', slide(
    shape('title', [para('Revenue &lt;up&gt; 12&#37;')]),
    shape('', [para('North ', '+8%'), '<a:p><a:r><a:t>Line one</a:t></a:r><a:br/><a:r><a:t>line two</a:t></a:r></a:p>', para('&#x4E2D;&#25991; text')]),
  ));
  zip.file('ppt/notesSlides/notesSlide1.xml', `<p:notes ${NS}><p:cSld><p:spTree>${shape('sldImg', [])}${shape('body', [para('Open with the headline.'), para('Pause for questions.')])}${shape('sldNum', [para('1')])}</p:spTree></p:cSld></p:notes>`);
  zip.file('docProps/core.xml', '<cp:coreProperties xmlns:cp="x" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Q3 Business Review</dc:title></cp:coreProperties>');
  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('parsePresentation: pptx', () => {
  it('reads slides in presentation order with titles, points and notes', async () => {
    const parsed = await parsePresentation(await buildPptx(), 'Review.pptx');
    assert.equal(parsed.title, 'Q3 Business Review');
    assert.deepEqual(parsed.cards.map(c => c.title), ['Quarterly Review', 'Revenue <up> 12%', 'Next steps']);
    assert.deepEqual(parsed.cards[0].points, ['Growth & retention'], 'empty paragraph and slide number skipped');
    assert.equal(parsed.cards[0].notes, 'Open with the headline.\nPause for questions.');
    assert.deepEqual(parsed.cards[1].points, ['North +8%', 'Line one line two', '中文 text']);
    assert.equal(parsed.cards[1].notes, undefined);
    assert.deepEqual(parsed.cards[2].points, ['Body before title'], 'footer and date placeholders skipped; title found after body');
    assert.deepEqual(parsed.warnings, []);
  });

  it('accepts .potx with the same parser', async () => {
    const parsed = await parsePresentation(await buildPptx(), 'brand.POTX');
    assert.equal(parsed.cards.length, 3);
  });

  it('caps points per card and characters per point', async () => {
    const zip = await JSZip.loadAsync(await buildPptx());
    const many = Array.from({ length: 15 }, (_, i) => para(`Point ${i + 1}`));
    zip.file('ppt/slides/slide2.xml', slide(shape('title', [para('Long')]), shape('', [para('x'.repeat(900)), ...many])));
    const parsed = await parsePresentation(await zip.generateAsync({ type: 'nodebuffer' }), 'a.pptx');
    const long = parsed.cards[2];
    assert.equal(long.points.length, 12);
    assert.equal(long.points[0].length, 800);
    assert.match(parsed.warnings.join(' '), /more than 12 paragraphs/);
  });

  it('falls back to the first text shape when there is no title placeholder', async () => {
    const zip = await JSZip.loadAsync(await buildPptx());
    zip.file('ppt/slides/slide2.xml', slide(shape(null, [para('Loose heading')]), shape(null, [para('Detail')])));
    const parsed = await parsePresentation(await zip.generateAsync({ type: 'nodebuffer' }), 'a.pptx');
    assert.equal(parsed.cards[2].title, 'Loose heading');
    assert.deepEqual(parsed.cards[2].points, ['Detail']);
  });

  it('decodes XML entities', () => {
    assert.equal(decodeXml('&lt;a&gt; &amp;amp; &quot;q&quot; &apos;s&apos; &#65;&#x42; &bogus;'), '<a> &amp; "q" \'s\' AB &bogus;');
  });
});

describe('parsePresentation: text', () => {
  it('splits Markdown on --- breaks, first line is the title', async () => {
    const parsed = await parsePresentation(Buffer.from('# Launch plan\n- Goals\n- Dates\n---\nBudget\n1. Hire\n2. Build\n---\n\n'), 'plan.md');
    assert.equal(parsed.title, 'Launch plan');
    assert.deepEqual(parsed.cards, [{ title: 'Launch plan', points: ['Goals', 'Dates'] }, { title: 'Budget', points: ['Hire', 'Build'] }]);
  });

  it('splits on # and ## headings when there are no breaks', () => {
    const parsed = parseText('Intro line\nmore intro\n# Deck\n## One\nalpha\n### Sub\nbeta\n## Two\n* gamma\n');
    assert.deepEqual(parsed.cards.map(c => c.title), ['Intro line', 'Deck', 'One', 'Two']);
    assert.deepEqual(parsed.cards[2].points, ['alpha', 'Sub', 'beta']);
    assert.deepEqual(parsed.cards[3].points, ['gamma']);
    assert.equal(parsed.title, 'Deck');
  });

  it('continues a long section on a second card and handles CRLF + BOM', async () => {
    const lines = Array.from({ length: 14 }, (_, i) => `line ${i + 1}`).join('\r\n');
    const parsed = await parsePresentation(Buffer.from(`﻿Notes\r\n${lines}`), 'notes.txt');
    assert.deepEqual(parsed.cards.map(c => [c.title, c.points.length]), [['Notes', 12], ['Notes (2)', 2]]);
    assert.equal(parsed.title, 'Notes');
  });
});

describe('parsePresentation: rejections', () => {
  const rejects = (bytes: Buffer, name: string, status: number, pattern: RegExp) =>
    assert.rejects(parsePresentation(bytes, name), (error: unknown) => error instanceof ImportError && error.status === status && pattern.test(error.message));

  it('rejects unsupported types', async () => {
    // PDFs are read as long sources by the import route (source-import.ts), not by parsePresentation.
    await rejects(Buffer.from('%PDF-1.7'), 'deck.pdf', 415, /\.pdf files cannot be imported/);
    await rejects(Buffer.from('x'), 'deck.docx', 415, /Use \.pptx, \.potx, \.md or \.txt/);
    await rejects(Buffer.from('x'), 'noext', 415, /without an extension/);
  });
  it('rejects files over 50 MB, empty files and broken packages', async () => {
    await rejects(Buffer.alloc(MAX_IMPORT_BYTES + 1), 'big.txt', 413, /larger than 50 MB/);
    await rejects(Buffer.alloc(0), 'empty.md', 400, /empty/);
    await rejects(Buffer.from('not a zip at all'), 'fake.pptx', 400, /not a valid PowerPoint/);
    const zip = new JSZip();
    zip.file('word/document.xml', '<w:document/>');
    await rejects(await zip.generateAsync({ type: 'nodebuffer' }), 'doc.pptx', 400, /presentation\.xml is missing/);
  });
  it('stops reading a part that expands past the cap (zip bomb)', async () => {
    const zip = await JSZip.loadAsync(await buildPptx());
    zip.file('ppt/slides/slide1.xml', slide(shape('title', [para('x'.repeat(17 * 1024 * 1024))])));
    await rejects(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }), 'bomb.pptx', 413, /more data than can be imported/);
  });
  it('rejects files without text and invalid UTF-8', async () => {
    await rejects(Buffer.from('\n\n---\n\n'), 'blank.md', 422, /No text/);
    await rejects(Buffer.from([0xff, 0xfe, 0xfd]), 'bin.txt', 400, /UTF-8/);
  });
});

describe('importRequest', () => {
  const parsed = { title: 'Deck', warnings: [], cards: [{ title: 'A', points: ['a1'], notes: 'n' }, { title: 'B', points: [] }, { title: 'C', points: ['c1', 'c2'] }, { title: 'D', points: ['d'] }] };
  it('asIs keeps the cards verbatim as a prepared outline', () => {
    const req = importRequest(parsed, { fileName: 'x.pptx', intent: 'asIs', themeId: 'slate', mode: 'express' });
    assert.deepEqual(req.outline, [{ title: 'A', points: ['a1'] }, { title: 'B', points: [] }, { title: 'C', points: ['c1', 'c2'] }, { title: 'D', points: ['d'] }]);
    assert.equal(req.settings.textMode, 'preserve');
    assert.equal(req.settings.numCards, 4);
    assert.equal(req.settings.mode, 'express');
    assert.equal(req.settings.themeId, 'slate');
    assert.equal(req.settings.inputText, 'A\n- a1\n---\nB\n---\nC\n- c1\n- c2\n---\nD\n- d');
    assert.deepEqual(req.source, { kind: 'import', fileName: 'x.pptx', intent: 'asIs' });
    assert.equal(req.title, 'Deck');
  });
  it('restyle keeps content and uses theme accents', () => {
    const req = importRequest(parsed, { fileName: 'x.pptx', intent: 'restyle' });
    assert.equal(req.outline?.length, 4);
    assert.equal(req.settings.imageSource, 'themeAccent');
    assert.equal(req.settings.mode, 'plan');
  });
  it('condense has no outline and asks the planner for about half the cards', () => {
    const req = importRequest(parsed, { fileName: 'x.pptx', intent: 'condense' });
    assert.equal(req.outline, undefined);
    assert.equal(req.settings.textMode, 'condense');
    assert.equal(req.settings.numCards, 3);
    assert.deepEqual([1, 2, 6, 10, 41, 200].map(condensedCardCount), [1, 2, 3, 5, 21, 60]);
  });
});

describe('import → engine', () => {
  const load = async () => ({ engine: await import('../../lib/decks/engine'), store: await import('../../lib/decks/store') });
  it('asIs + plan: the outline is the slides verbatim, waiting for review', async () => {
    const { engine, store } = await load();
    const parsed = await parsePresentation(await buildPptx(), 'Review.pptx');
    const { deck } = await engine.createDeck(importRequest(parsed, { fileName: 'Review.pptx', intent: 'asIs', mode: 'plan' }));
    await engine.waitForJobs();
    const saved = store.getDeck(deck.id)!;
    assert.equal(saved.status, 'outline_ready');
    assert.equal(saved.title, 'Q3 Business Review');
    assert.deepEqual(saved.outline.map(c => c.title), ['Quarterly Review', 'Revenue <up> 12%', 'Next steps']);
    assert.deepEqual(saved.outline[1].points, ['North +8%', 'Line one line two', '中文 text']);
    assert.deepEqual(saved.source, { kind: 'import', fileName: 'Review.pptx', intent: 'asIs' });
    assert.equal(saved.settings.imageSource, 'noImages');
  });
  it('restyle + express: builds every card without a review stop', async () => {
    const { engine, store } = await load();
    const parsed = await parsePresentation(await buildPptx(), 'Review.pptx');
    const { deck } = await engine.createDeck(importRequest(parsed, { fileName: 'Review.pptx', intent: 'restyle', mode: 'express' }));
    await engine.waitForJobs();
    await engine.waitForJobs();
    const saved = store.getDeck(deck.id)!;
    assert.equal(saved.status, 'ready');
    assert.equal(saved.cards.length, 3);
    assert.equal(saved.settings.imageSource, 'themeAccent');
  });
  it('condense: the planner writes the outline from the joined text', async () => {
    const { engine, store } = await load();
    const parsed = await parsePresentation(await buildPptx(), 'Review.pptx');
    const { deck } = await engine.createDeck(importRequest(parsed, { fileName: 'Review.pptx', intent: 'condense' }));
    await engine.waitForJobs();
    const saved = store.getDeck(deck.id)!;
    assert.equal(saved.status, 'outline_ready');
    assert.equal(saved.settings.textMode, 'condense');
    assert.ok(saved.outline.length >= 1);
  });
});
