/**
 * Export → import round trip: a Decks PPTX imported back "as-is" keeps each
 * card's title and points, without slide numbers, and key numbers keep value
 * and label together.
 *
 * Run with: npx tsx --test src/__tests__/unit/decks-roundtrip.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildDeckPptx } from '../../lib/decks/export-pptx';
import { parsePresentation } from '../../lib/decks/import';
import { mergeValueLabels } from '../../lib/decks/import-pptx';
import { DEFAULT_LAYOUT } from '../../lib/decks/blocks';
import type { Card, Deck } from '../../lib/decks/types';

const card = (id: string, blocks: Card['blocks']): Card => ({ id, blocks, layout: { ...DEFAULT_LAYOUT }, hidden: false, notes: '', stage: 'done' });
const deck: Deck = {
  id: 'deck_rt', title: 'Round trip', status: 'ready', version: 1, warnings: [], outline: [], createdAt: '', updatedAt: '',
  settings: { inputText: 'x', textMode: 'generate', amount: 'medium', language: 'auto', numCards: 3, cardSplit: 'auto', imageSource: 'noImages', themeId: 'slate', format: 'presentation', dimensions: '16x9' },
  headerFooter: { bottomRight: { type: 'cardNumber' }, bottomLeft: { type: 'text', value: 'Confidential' } },
  cards: [
    card('c1', [{ id: 'h1', type: 'heading', level: 1, text: 'Quarterly review' }, { id: 'p1', type: 'paragraph', text: 'Revenue grew 32%.' }]),
    card('c2', [{ id: 'h2', type: 'heading', level: 2, text: 'Key numbers' }, { id: 'm', type: 'metrics', items: [{ value: '32%', label: 'Revenue growth' }, { value: '2.1%', label: 'Churn 2.1%' }] }]),
    card('c3', [{ id: 'h3', type: 'heading', level: 2, text: 'Next steps' }, { id: 'b', type: 'bullets', items: ['Launch self-serve', 'Expand to EU'] }]),
  ],
};

describe('PPTX export → import round trip', () => {
  it('keeps titles and points, drops slide numbers, joins key-number values with labels', async () => {
    const parsed = await parsePresentation(await buildDeckPptx(deck), 'round-trip.pptx');
    assert.deepEqual(parsed.cards.map(c => c.title), ['Quarterly review', 'Key numbers', 'Next steps']);
    const all = parsed.cards.flatMap(c => c.points);
    assert.ok(!all.some(p => /^\d+$/.test(p.trim())), `no bare slide numbers: ${JSON.stringify(all)}`);
    assert.deepEqual(parsed.cards[1].points.filter(p => /Revenue|Churn/.test(p)), ['32% — Revenue growth', 'Churn 2.1%']);
    assert.deepEqual(parsed.cards[2].points.filter(p => !/Confidential/.test(p)), ['Launch self-serve', 'Expand to EU']);
  });
  it('mergeValueLabels only joins a bare number with the text after it', () => {
    assert.deepEqual(mergeValueLabels(['48', 'NPS rose to 48', '18%', 'Conversion', 'Plain point', '2026', '2027']), ['NPS rose to 48', '18% — Conversion', 'Plain point', '2026', '2027']);
  });
});
