/**
 * Decks "Suggested layouts": rearrangements of a card's own content.
 *
 * Run with: npx tsx --test src/__tests__/unit/decks-layout-suggestions.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { findNumber, leadingDate, splitItem, suggestLayouts } from '../../lib/decks/layout-suggestions';
import { blockText } from '../../lib/decks/blocks';
import type { Block, Card } from '../../lib/decks/types';

const heading: Block = { id: 'h1', type: 'heading', level: 2, text: 'Why it works' };
const card = (blocks: Block[], accent: Card['layout']['accent'] = 'none'): Card => ({
  id: 'card_1', blocks, layout: { accent, align: 'left' }, hidden: false, notes: '', stage: 'done',
});
const kinds = (c: Card, dims?: Parameters<typeof suggestLayouts>[1]) => suggestLayouts(c, dims).map(s => s.kind);
const blockOf = (c: Card, kind: string) => {
  const s = suggestLayouts(c).find(x => x.kind === kind);
  assert.ok(s, `expected a ${kind} suggestion`);
  return s.card.blocks.find(b => b.id === 'list')!;
};

describe('splitItem', () => {
  it('splits at a label colon, a bold lead-in or a spaced dash', () => {
    assert.deepEqual(splitItem('Speed: pages load in **1 s**'), { title: 'Speed', text: 'pages load in **1 s**', labelled: true });
    assert.deepEqual(splitItem('**Trust:** audited weekly'), { title: 'Trust', text: 'audited weekly', labelled: true });
    assert.deepEqual(splitItem('Scale — runs on any cloud'), { title: 'Scale', text: 'runs on any cloud', labelled: true });
    assert.deepEqual(splitItem('目标：提升效率'), { title: '目标', text: '提升效率', labelled: true });
  });
  it('ignores times, URLs and links; long items split after the first words', () => {
    assert.equal(splitItem('Standup at 10:30 daily').labelled, false);
    assert.equal(splitItem('See https://example.com').labelled, false);
    assert.deepEqual(splitItem('Teams ship faster because review happens in the editor'),
      { title: 'Teams ship faster', text: 'because review happens in the editor', labelled: false });
    assert.deepEqual(splitItem('Short point'), { title: 'Short point', labelled: false });
  });
});

describe('dates and numbers', () => {
  it('finds leading dates in several shapes', () => {
    assert.deepEqual(leadingDate('2024: Launch'), { label: '2024', rest: 'Launch' });
    assert.deepEqual(leadingDate('Q3 2025 — Beta opens'), { label: 'Q3 2025', rest: 'Beta opens' });
    assert.deepEqual(leadingDate('March 2026 GA'), { label: 'March 2026', rest: 'GA' });
    assert.deepEqual(leadingDate('2023年3月 发布'), { label: '2023年3月', rest: '发布' });
    assert.equal(leadingDate('Launch in 2024'), null);
    assert.equal(leadingDate('20245 users'), null);
  });
  it('extracts a number with currency and unit', () => {
    assert.deepEqual(findNumber('Revenue grew 42% this year'), { value: '42%', rest: 'Revenue grew this year' });
    assert.deepEqual(findNumber('$4.2M ARR'), { value: '$4.2M', rest: 'ARR' });
    assert.equal(findNumber('No numbers here'), null);
  });
});

describe('suggestLayouts', () => {
  const bullets = card([heading, { id: 'list', type: 'bullets', items: ['Speed: pages load in 1 s', 'Trust: audited weekly', 'Scale: any cloud', 'Cost: pay per seat'] }]);

  it('turns a labelled list into a grid without inventing text, keeping untouched block ids', () => {
    const grid = blockOf(bullets, 'grid');
    assert.equal(grid.type, 'grid');
    if (grid.type !== 'grid') return;
    assert.deepEqual(grid.items, [
      { title: 'Speed', text: 'pages load in 1 s' }, { title: 'Trust', text: 'audited weekly' },
      { title: 'Scale', text: 'any cloud' }, { title: 'Cost', text: 'pay per seat' },
    ]);
    const s = suggestLayouts(bullets).find(x => x.kind === 'grid')!;
    assert.equal(s.card.blocks[0], heading);
    assert.equal(s.card.id, bullets.id);
  });

  it('offers steps, a two-column split and a table for label: value lists', () => {
    const k = kinds(bullets);
    for (const kind of ['grid', 'steps', 'table', 'columns']) assert.ok(k.includes(kind as never), `missing ${kind} in ${k}`);
    const cols = blockOf(bullets, 'columns');
    assert.ok(cols.type === 'columns' && cols.columns.length === 2);
    if (cols.type === 'columns') assert.deepEqual(cols.columns.map(c => (c[0].type === 'bullets' ? c[0].items.length : 0)), [2, 2]);
    const table = blockOf(bullets, 'table');
    if (table.type === 'table') assert.deepEqual(table.rows[0], ['Speed', 'pages load in 1 s']);
  });

  it('uses a given table header', () => {
    const s = suggestLayouts(bullets, { tableHeader: ['项目', '说明'] }).find(x => x.kind === 'table')!;
    const table = s.card.blocks[1];
    assert.ok(table.type === 'table' && table.header.join() === '项目,说明');
  });

  it('only offers a timeline when every item starts with a date', () => {
    const dated = card([{ id: 'list', type: 'bullets', items: ['2022: Founded', '2024: Series A — 40 people', 'Q1 2026: Global launch'] }]);
    const tl = blockOf(dated, 'timeline');
    assert.ok(tl.type === 'timeline');
    if (tl.type === 'timeline') {
      assert.deepEqual(tl.items[1], { label: '2024', title: 'Series A', text: '40 people' });
      assert.deepEqual(tl.items.map(i => i.label), ['2022', '2024', 'Q1 2026']);
    }
    assert.ok(!kinds(dated).includes('metrics'), 'a dated list is not offered as key numbers');
    assert.ok(!kinds(bullets).includes('timeline'));
  });

  it('only offers key numbers when every item has a number', () => {
    const nums = card([{ id: 'list', type: 'bullets', items: ['Revenue: $4.2M', 'Retention: 92%', 'NPS: 61'] }]);
    const m = blockOf(nums, 'metrics');
    if (m.type === 'metrics') assert.deepEqual(m.items, [{ value: '$4.2M', label: 'Revenue' }, { value: '92%', label: 'Retention' }, { value: '61', label: 'NPS' }]);
    assert.ok(!kinds(card([{ id: 'list', type: 'bullets', items: ['Revenue: $4.2M', 'Happy customers'] }])).includes('metrics'));
  });

  it('turns a single item into a callout', () => {
    const one = card([{ id: 'list', type: 'bullets', items: ['Remember: back up first'] }]);
    const c = blockOf(one, 'callout');
    assert.deepEqual(c, { id: 'list', type: 'callout', tone: 'info', title: 'Remember', text: 'back up first' });
    assert.ok(!kinds(one).includes('grid'), 'grids need two items');
  });

  it('turns grids, steps, timelines and metrics back into lists', () => {
    const grid = card([{ id: 'list', type: 'grid', items: [{ title: 'A', text: 'alpha' }, { title: 'B' }] }]);
    const list = blockOf(grid, 'bullets');
    assert.deepEqual(list, { id: 'list', type: 'bullets', items: ['A: alpha', 'B'] });
    assert.ok(kinds(grid).includes('steps'));
    const steps = card([{ id: 'list', type: 'steps', items: [{ title: 'Plan' }, { title: 'Build' }] }]);
    assert.equal(blockOf(steps, 'bullets').type, 'numbered');
    const tl = card([{ id: 'list', type: 'timeline', items: [{ label: '2024', title: 'Beta', text: 'invite only' }, { label: '2025', title: 'GA' }] }]);
    assert.deepEqual(blockOf(tl, 'bullets'), { id: 'list', type: 'bullets', items: ['2024: Beta — invite only', '2025: GA'] });
    // …and a timeline turned into a list converts back to the same timeline.
    const back = blockOf(card([blockOf(tl, 'bullets')]), 'timeline');
    assert.deepEqual(back, tl.blocks[0]);
    const metrics = card([{ id: 'list', type: 'metrics', items: [{ value: '92%', label: 'Retention' }, { value: '61', label: 'NPS', detail: 'up from 40' }] }]);
    assert.deepEqual(blockOf(metrics, 'bullets'), { id: 'list', type: 'bullets', items: ['Retention: 92%', 'NPS: 61 — up from 40'] });
  });

  it('adds accent variations, never the current card, at most six, all distinct', () => {
    const k = kinds(card([heading, { id: 'p', type: 'paragraph', text: 'Hello' }], 'left'));
    assert.deepEqual(k, ['accent-right', 'accent-top', 'accent-none']);
    const all = suggestLayouts(bullets);
    assert.ok(all.length <= 6);
    assert.ok(all.some(s => s.kind.startsWith('accent-')), 'keeps room for accent variations');
    const keys = all.map(s => JSON.stringify([s.card.blocks, s.card.layout]));
    assert.equal(new Set(keys).size, keys.length);
    assert.ok(!keys.includes(JSON.stringify([bullets.blocks, bullets.layout])));
    assert.equal(new Set(all.map(s => s.id)).size, all.length);
  });

  it('never invents text', () => {
    const source = blockText(bullets.blocks[1]).replace(/[\s:]/g, '');
    for (const s of suggestLayouts(bullets)) {
      // Table headers are structural labels; the content is the rows.
      const blocks = s.card.blocks.slice(1).map(b => (b.type === 'table' ? { ...b, header: [] } : b));
      assert.equal(blocks.map(blockText).join('').replace(/[\s:]/g, ''), source, s.kind);
    }
  });

  it('is deterministic', () => {
    assert.deepEqual(suggestLayouts(bullets), suggestLayouts(bullets));
  });

  it('drops suggestions that would overflow a fixed card that currently fits', () => {
    const paragraphs: Block[] = [1, 2, 3, 4].map(n => ({ id: `p${n}`, type: 'paragraph', text: 'word '.repeat(40).trim() }));
    const long = card([heading, ...paragraphs]);
    assert.deepEqual(kinds(long, { dimensions: '16x9' }), ['accent-left', 'accent-right'], 'a top image leaves too little room');
    assert.deepEqual(kinds(long), ['accent-left', 'accent-right', 'accent-top'], 'without dimensions nothing is dropped');
    assert.deepEqual(kinds(long, { dimensions: 'fluid' }), ['accent-left', 'accent-right', 'accent-top'], 'fluid cards grow');
  });

  it('leaves cards without a list with accent variations only', () => {
    assert.deepEqual(kinds(card([heading])), ['accent-left', 'accent-right', 'accent-top']);
  });
});
