/**
 * Renders the card outline (after Gamma) for real (react-dom/server + the real
 * I18nContext): the settings form before the outline is written (length with
 * page counts, text, language, template), pending cards while it is written,
 * then cards with their titles, points, point headings and chapter/takeaway
 * tags, the outline summary and the rewrite box. No topic review, lock or pause.
 *
 * Run with: npx tsx --test src/__tests__/unit/ppt-card-outline-render.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nContext } from '../../components/layout/I18nProvider';
import { PptCardOutline, outlineCards, cardEditOps, outlineRequest, settingsFrom, type PptCardEdit } from '../../components/ppt/create/PptCardOutline';
import type { PptProject } from '../../components/ppt/types';
import { translate, type Locale, type TranslationKey } from '../../i18n';

const base = (patch: Record<string, unknown>, planning: Record<string, unknown> = {}): PptProject => ({
  id: 'c'.repeat(32), title: 'Alpha Mining', status: 'outline_ready', stage: 'outline', template: 'light', outline: [],
  inputUnderstanding: { recommended: 12, min: 8, max: 16, reason: 'Reading estimate.' },
  planningContract: { version: 3, flow: 'cards', phase: 'expanding', semanticRevision: 'r1', contentMode: 'concise', logicalCards: [], pagePreference: { mode: 'adaptive', max: 100 }, ...planning },
  outlineAcceptance: { version: 1, schema: true, ownership: true, semantic: true, physical: true, confirmable: true, issues: [] },
  ...patch,
} as unknown as PptProject);

const outline = [
  { id: 'p0', title: 'Alpha Mining', keyPoints: [] },
  { id: 'p1', title: 'Genetic programming evolves formula trees', titleSecondary: '遗传编程演化公式树', keyPoints: [{ text: 'Mutates fields, operators and windows', refs: [], chunkRefs: [] }, { text: 'Fitness: out-of-sample ICIR minus penalties', refs: [], chunkRefs: [] }] },
  { id: 'p2', title: 'The evaluation gauntlet', numberedPoints: true, keyPoints: [{ text: 'Data and timestamp audit', refs: [], chunkRefs: [] }, { text: 'Multiple-testing', refs: [], chunkRefs: [] }] },
];
const framed = [...outline,
  { id: 'p3', title: 'Combining factors', cardFrame: 'divider', keyPoints: [{ text: 'Neutralisation', refs: [], chunkRefs: [], navigation: true }] },
  { id: 'p4', title: 'Signals decay', keyPoints: [{ text: 'Data dictionary: source, frequency, lag', label: 'Data dictionary', refs: [], chunkRefs: [] }, { text: 'Turnover rises with decay', refs: [], chunkRefs: [] }] },
  { id: 'p5', title: 'Takeaway', cardFrame: 'takeaway', keyPoints: [{ text: 'Test every formula out of sample.', refs: [], chunkRefs: [] }] },
];
const settings = { length: { preset: 'standard' }, presets: { quick: { content: 6, dividers: 0, takeaway: true, total: 8 }, standard: { content: 8, dividers: 2, takeaway: true, total: 12 }, full: { content: 11, dividers: 2, takeaway: true, total: 15 } }, language: 'bilingual', languageDefault: 'bilingual', bilingualSource: true, notesOther: false, instruction: '' };
const summary = { version: 1, language: 'en', textMode: 'concise', length: 'standard', pages: 6, steps: ['The evaluation gauntlet'], objects: [], statements: [], chapters: ['Combining factors'], takeaway: true, uncoveredSections: ['Appendix'], labelled: 1, warnings: [] };

function render(p: PptProject, locale: Locale = 'en', modelState: {modelsLoading?:boolean;modelsError?:string;onRetryModels?:()=>void} = {}): string {
  return renderToStaticMarkup(createElement(I18nContext.Provider,
    { value: { locale, setLocale: () => {}, t: (key: TranslationKey, params?: Record<string, string | number>) => translate(locale, key, params) } },
    createElement(PptCardOutline, { initial: p, templates: [], onClose: () => {}, onGenerate: () => {}, busy: false, ...modelState })));
}
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');
// What the old planner showed: reader purpose, topic locks, authorized page limits.
const forbidden = (locale: Locale) => locale === 'en' ? ['Reader question', 'Lock this topic', 'Authorized maximum'] : locale === 'zh' ? ['读者问题', '锁定此主题', '授权'] : ['讀者問題', '鎖定此主題', '授權'];

describe('PptCardOutline', () => {
  for (const locale of ['en', 'zh', 'zh-HK'] as Locale[]) {
    it(`before writing: the settings form with page counts, then Generate outline (${locale})`, () => {
      const html = render(base({ status: 'input_ready' }, { phase: 'reading', settings, structure: { sections: 10, chars: 9000, objects: { tables: 1, code: 2, equations: 3, lists: 4 }, images: 0, primaryLanguage: 'en', bilingualRatio: 0.9, warnings: [] } }), locale), body = text(html);
      assert.match(html, /data-testid="ppt-card-settings"/);
      assert.match(html, /data-testid="ppt-card-write"/);
      assert.doesNotMatch(html, /data-testid="ppt-card-list"/, 'no cards before the outline is written');
      for (const n of [8, 12, 15]) assert.ok(body.includes(translate(locale, 'ppt.cards.lengthPages', { n })), `the ${n}-page preset is shown`);
      for (const key of ['ppt.cards.lengthQuick', 'ppt.cards.lengthStandard', 'ppt.cards.lengthFull', 'ppt.cards.lengthCustom', 'ppt.cards.languageBilingual', 'ppt.cards.languageEn', 'ppt.cards.condense'] as TranslationKey[]) assert.ok(body.includes(translate(locale, key)), key);
      assert.match(html, /role="radio" aria-checked="true"[^>]*>[^<]*<span[^>]*>[^<]*<\/span><span[^>]*>[^<]*12/, 'the standard length is chosen');
      assert.ok(body.includes(translate(locale, 'ppt.cards.sourceRead', { sections: 10, chars: 9000 })), 'what code read from the source');
      assert.ok(!/ppt\.(cards|plan)\./.test(body), 'no raw keys');
    });
    it(`while writing: the planned pages are pending (${locale})`, () => {
      const html = render(base({ status: 'outlining' }, { writing: { pages: 3 } }), locale), body = text(html);
      assert.match(html, /data-testid="ppt-card-writing"/);
      assert.ok(body.includes(translate(locale, 'ppt.cards.writing')) && body.includes(translate(locale, 'ppt.cards.lengthPages', { n: 3 })));
      assert.equal((html.match(/data-pending=""/g) || []).length, 3, 'one pending card per planned page');
      assert.doesNotMatch(html, /data-testid="ppt-card-pause"/, 'no outline pause');
      for (const word of forbidden(locale)) assert.ok(!body.includes(word), `no ${word}`);
      assert.ok(!/ppt\.(cards|plan)\./.test(body), 'no raw keys');
    });
    it(`while writing: written topics show their cards, the rest their titles (${locale})`, () => {
      const outlineForming = { version: 1, revision: 'r1', phase: 'cards', done: 1, total: 2, at: '2026-10-31T00:00:00Z', syllabus: [
        { id: 'forming_0_0', title: 'Genetic programming evolves formula trees', points: ['Mutates fields, operators and windows'] },
        { id: 'forming_1', title: 'The evaluation gauntlet', points: [], pending: true },
      ] };
      const html = render(base({ status: 'outlining', outlineForming }, { writing: { pages: 6 } }), locale), body = text(html);
      assert.ok(body.includes(translate(locale, 'ppt.cards.formingCards', { done: 1, total: 2 })), 'how many topics are written');
      assert.ok(body.includes('Mutates fields, operators and windows'), 'a written card shows its points');
      assert.ok(body.includes('The evaluation gauntlet'), 'a pending topic shows its title');
      assert.equal((html.match(/data-pending=""/g) || []).length, 1, 'only the unwritten topic is pending');
      assert.equal((html.match(/<li[^>]*data-frame/g) || html.match(/class="group flex gap-3"/g) || []).length, 3, 'the cover and two topics');
      const finishing = text(render(base({ status: 'outlining', outlineForming: { ...outlineForming, phase: 'checking', done: 2 } }, { writing: { pages: 6 } }), locale));
      assert.ok(finishing.includes(translate(locale, 'ppt.cards.formingChecking')), 'the step after the cards is named');
      // A finished outline ignores a stale forming record.
      const ready = text(render(base({ outline, outlineForming }, { phase: 'page_plan_ready', settings }), locale));
      assert.ok(!ready.includes(translate(locale, 'ppt.cards.formingCards', { done: 1, total: 2 })));
      assert.ok(!/ppt\.(cards|plan)\./.test(body), 'no raw keys');
    });
    it(`written: each card is a title and its points, edited in place (${locale})`, () => {
      const html = render(base({ outline }, { phase: 'page_plan_ready', settings }), locale), body = text(html);
      const fields = [...html.matchAll(/<textarea(?![^>]*data-testid)[^>]*>([^<]*)<\/textarea>/g)].map(match => match[1]);
      assert.deepEqual(fields, ['Alpha Mining', 'Genetic programming evolves formula trees', 'Mutates fields, operators and windows', 'Fitness: out-of-sample ICIR minus penalties', 'The evaluation gauntlet', 'Data and timestamp audit', 'Multiple-testing']);
      assert.ok(body.includes('遗传编程演化公式树'), 'the second-language title is shown as written');
      // Each point has its heading field (its label on the slide) above its text.
      assert.match(html, /<ol class="[^"]*list-disc[^"]*"><li><input[^>]*data-testid="ppt-card-heading"[^>]*\/><textarea[^>]*>Mutates fields/);
      assert.match(html, /<ol class="[^"]*list-decimal[^"]*"><li><input[^>]*data-testid="ppt-card-heading"[^>]*\/><textarea[^>]*>Data and timestamp audit/);
      assert.equal((html.match(/data-testid="ppt-card-heading"/g) || []).length, 4, 'one heading field per point');
      assert.ok(html.includes(`aria-label="${translate(locale, 'ppt.cards.heading')}"`), 'the heading field is labelled');
      assert.equal((html.match(new RegExp(`aria-label="${translate(locale, 'ppt.cards.delete')}"`, 'g')) || []).length, 2, 'every card but the cover can be deleted');
      assert.match(html, /data-testid="ppt-card-add"/);
      assert.match(html, /data-testid="ppt-card-instruction-text"/, 'the rewrite box');
      assert.ok(body.includes(translate(locale, 'ppt.cards.total', { n: 3 })));
      const generate = html.match(/<button[^>]*data-testid="ppt-card-generate"[^>]*>/)?.[0] || '';
      assert.ok(generate && !/disabled=""/.test(generate), 'ready to generate');
      assert.match(html, new RegExp(`data-testid="ppt-card-generate"[^>]*>.*?<svg[^>]*aria-hidden="true"[\\s\\S]*?</svg>${translate(locale, 'ppt.cards.generate')}</button>`), 'the AI mark, then the label');
      for (const word of forbidden(locale)) assert.ok(!body.includes(word), `no ${word}`);
    });
    it(`being rewritten: the cards are shown, not edited (${locale})`, () => {
      const html = render(base({ outline, status: 'outlining' }, { phase: 'page_plan_ready' }), locale), body = text(html);
      assert.doesNotMatch(html, /<textarea(?![^>]*data-testid)/);
      assert.match(html, /data-testid="ppt-card-writing"/);
      assert.ok(body.includes('Alpha Mining') && body.includes('Genetic programming evolves formula trees 遗传编程演化公式树') && body.includes('The evaluation gauntlet'), body);
      assert.match(html, /<ul class="[^"]*list-disc[^"]*"><li>Mutates fields, operators and windows<\/li>/);
      assert.match(html, /<ol class="[^"]*list-decimal[^"]*"><li>Data and timestamp audit<\/li>/);
      const generate = html.match(/<button[^>]*data-testid="ppt-card-generate"[^>]*>/)?.[0] || '';
      assert.match(generate, /disabled=""/, 'not while the outline is being written');
    });
  }
  for (const locale of ['en', 'zh'] as Locale[]) {
    it(`chapters, takeaway, point headings and the outline summary (${locale})`, () => {
      const html = render(base({ outline: framed, status: 'outlining' }, { phase: 'page_plan_ready', settings, summary }), locale), body = text(html);
      assert.ok(body.includes(translate(locale, 'ppt.cards.chapter')) && body.includes(translate(locale, 'ppt.cards.takeawayTag')) && body.includes(translate(locale, 'ppt.cards.coverTag')));
      assert.match(html, /data-frame="divider"/); assert.match(html, /data-frame="takeaway"/);
      assert.match(html, /<strong[^>]*>Data dictionary:<\/strong>Data dictionary: source, frequency, lag/, 'a point shows its heading');
      const ready = render(base({ outline: framed }, { phase: 'page_plan_ready', settings, summary }), locale), readyBody = text(ready);
      assert.match(ready, /data-testid="ppt-card-summary"/);
      assert.ok(readyBody.includes(translate(locale, 'ppt.cards.summaryChapters', { list: 'Combining factors' })) && readyBody.includes(translate(locale, 'ppt.cards.summaryTakeaway')) && readyBody.includes(translate(locale, 'ppt.cards.summaryUncovered', { list: 'Appendix' })));
    });
  }
  for (const locale of ['en', 'zh', 'zh-HK'] as Locale[]) {
    it(`a card that states a source count which does not multiply out: a note to edit or keep, Generate stays enabled (${locale})`, () => {
      const params = { expression: '2×3×3', calculated: 18, claimed: 27 };
      const note = { key: 'source_warning:aaaaaaaaaaaaaaaaaaaaaaaa', pageId: 'p1', pointIndex: 0, code: 'source_arithmetic_conflict', params, withExpression: true, resolved: false };
      const html = render(base({ outline, sourceMediaWarnings: [{ code: 'source_arithmetic_conflict', message: 'Count mismatch', location: '段落 1', key: note.key, required: false, resolved: true, kept: false, cause: 'source_inconsistency', params }] }, { phase: 'page_plan_ready', settings, sourceNotes: [note] }), locale), body = text(html);
      assert.equal((html.match(/data-testid="ppt-card-source-note"/g) || []).length, 1, 'one note, on the card that shows it');
      for (const key of ['ppt.cards.noteArithmeticShown', 'ppt.cards.editPoint', 'ppt.create.sourceWarnings.keepOriginal'] as TranslationKey[]) assert.ok(body.includes(translate(locale, key, params)), key);
      assert.ok(body.includes(translate(locale, 'ppt.sourceWarnings.arithmetic', params)), 'the source warning is worded in the reader\'s language');
      assert.ok(!body.includes(translate(locale, 'ppt.create.sourceWarnings.unresolved', { count: 1 }).replace('{count}', '1')), 'nothing waits on it');
      const generate = html.match(/<button[^>]*data-testid="ppt-card-generate"[^>]*>/)?.[0] || '';
      assert.ok(generate && !/disabled=""/.test(generate), 'generation is not held');
      const kept = text(render(base({ outline }, { phase: 'page_plan_ready', settings, sourceNotes: [{ ...note, resolved: true }] }), locale));
      assert.ok(!kept.includes(translate(locale, 'ppt.cards.editPoint')), 'a kept original shows no note');
    });
  }
  it('the settings form sends one outline request', () => {
    const p = base({ outline }, { phase: 'page_plan_ready', settings, semanticRevision: 'r9' });
    const form = settingsFrom(p);
    assert.deepEqual(form, { length: 'standard', exact: 12, density: 'concise', language: 'bilingual', notesOther: false, template: 'light' });
    assert.deepEqual(outlineRequest(p, { ...form, length: 'custom', exact: 50, language: 'en', notesOther: true }, ' Merge the background. '),
      { command: 'outline', template: 'light', contentMode: 'concise', semanticRevision: 'r9', length: { exact: 40 }, language: 'en', notesOther: true, instruction: 'Merge the background.' });
    assert.equal(outlineRequest(p, { ...form, notesOther: true }).notesOther, false, 'a bilingual deck has no other-language notes');
  });
  it('edit operations keep the cover first and send titles and non-empty points', () => {
    const cards: PptCardEdit[] = [{ key: 'c', id: 'c', title: 'Cover', numbered: false, points: [] }, { key: 'a', id: 'a', title: 'A', numbered: false, points: ['one', ' two '], labels: ['One', undefined] }, { key: 'b', id: 'b', title: 'B', numbered: true, points: ['x'] }];
    assert.deepEqual(cardEditOps.move(cards, 2, 1).map(card => card.key), ['c', 'b', 'a']);
    assert.equal(cardEditOps.move(cards, 1, 0), cards, 'nothing moves above the cover');
    assert.equal(cardEditOps.remove(cards, 0), cards, 'the cover cannot be deleted');
    const added = cardEditOps.add(cards, 1, 'New card');
    assert.deepEqual(added.map(card => card.title), ['Cover', 'A', 'New card', 'B']); assert.equal(added[2].id, undefined);
    const typed = cardEditOps.removePoint(cardEditOps.insertPoint(cards, 1, 0), 1, 2);
    assert.deepEqual(typed[1].points, ['one', '']);
    assert.deepEqual(cardEditOps.point(cards, 1, 0, 'one changed')[1].labels, ['One', undefined], 'a point keeps its heading; the author edits it on its own');
    assert.deepEqual(cardEditOps.payload(added), [{ id: 'c', title: 'Cover', points: [], labels: [], numbered: false }, { id: 'a', title: 'A', points: ['one', 'two'], labels: ['One', ''], numbered: false }, { title: 'New card', points: [], labels: [], numbered: false }, { id: 'b', title: 'B', points: ['x'], labels: [''], numbered: true }]);
  });
  it('point headings stay aligned with their points through inserts, deletes and blank points', () => {
    const cards: PptCardEdit[] = [{ key: 'c', id: 'c', title: 'Cover', numbered: false, points: [] }, { key: 'a', id: 'a', title: 'A', numbered: false, points: ['one', 'two', 'three'], labels: ['First', 'Second', 'Third'] }];
    const inserted = cardEditOps.insertPoint(cards, 1, 0);
    assert.deepEqual(inserted[1].labels, ['First', undefined, 'Second', 'Third']);
    const removed = cardEditOps.removePoint(inserted, 1, 2);
    assert.deepEqual([removed[1].points, removed[1].labels], [['one', '', 'three'], ['First', undefined, 'Third']]);
    const renamed = cardEditOps.heading(removed, 1, 2, ' Last ');
    assert.deepEqual(cardEditOps.payload(renamed)[1], { id: 'a', title: 'A', points: ['one', 'three'], labels: ['First', 'Last'], numbered: false }, 'a blank point leaves with its heading');
  });
  it('cards to show: the accepted outline wins over the planned pages', () => {
    assert.equal(outlineCards(base({ outline }, { phase: 'page_plan_ready', writing: { pages: 9 } })).length, 3);
    assert.equal(outlineCards(base({}, { writing: { pages: 4 } })).filter(card => card.pending).length, 4);
    assert.deepEqual(outlineCards(base({}, {})), []);
  });
  it('figure pages show their captions while editable and never offer an empty point', () => {
    const figure = { id: 'fig', title: 'Figure 1', figurePage: true, sourceImageIds: ['image1'], keyPoints: [] };
    const p = base({ outline: [outline[0], figure], sourceAssets: [{ id: 'image1', caption: 'Figure 1. Original caption', width: 400, height: 300 }] }, { phase: 'page_plan_ready', settings });
    const html = render(p, 'en');
    assert.match(html, /data-testid="ppt-card-figures"/);
    assert.ok(text(html).includes('Figure 1. Original caption'));
    assert.ok(!text(html).includes('+ ' + translate('en', 'ppt.cards.point')), 'figure page does not accept a stray point');
  });
});

it('the full-screen outline owns its model retry and blocks generation until models are ready',()=>{
 const p=base({outline},{phase:'page_plan_ready',settings});
 for(const locale of ['en','zh','zh-HK'] as const){
  const html=render(p,locale,{modelsError:'15s timeout',onRetryModels:()=>{}});
  assert.match(html,/data-testid="ppt-card-model-error"/);
  assert.ok(text(html).includes(translate(locale,'ppt.quality.reloadModels')));
  assert.match(html,/<button[^>]*data-testid="ppt-card-generate"[^>]*disabled=""/);
 }
 const loading=render(p,'en',{modelsLoading:true});
 assert.ok(text(loading).includes(translate('en','ppt.quality.modelsLoading')));
 assert.match(loading,/<button[^>]*data-testid="ppt-card-generate"[^>]*disabled=""/);
 assert.doesNotMatch(render(p),/<button[^>]*data-testid="ppt-card-generate"[^>]*disabled=""/);
});
