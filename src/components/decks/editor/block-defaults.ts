import type { Block, BlockType } from '@/lib/decks/types';
import { newId } from '@/lib/decks/blocks';
import type { DecksStringKey } from '../i18n';

type T = (key: DecksStringKey, params?: Record<string, string | number>) => string;

/** Every block type, in the order the Insert menu shows them (grouped like the report's Add block). */
export const BLOCK_GROUPS: { group: 'text' | 'media' | 'diagrams'; types: BlockType[] }[] = [
  { group: 'text', types: ['heading', 'paragraph', 'bullets', 'numbered', 'callout', 'quote', 'code', 'divider'] },
  { group: 'media', types: ['image', 'table', 'chart', 'columns'] },
  { group: 'diagrams', types: ['timeline', 'steps', 'metrics', 'grid'] },
];

/** A new block with sensible, editable placeholder content in the UI language. */
export function defaultBlock(type: BlockType, t: T): Block {
  const id = newId('blk');
  const item = (n: number) => t('decks.editor.default.item', { n });
  switch (type) {
    case 'heading': return { id, type, level: 2, text: t('decks.editor.default.heading') };
    case 'paragraph': return { id, type, text: t('decks.editor.default.paragraph') };
    case 'bullets': return { id, type, items: [item(1), item(2), item(3)] };
    case 'numbered': return { id, type, items: [item(1), item(2), item(3)] };
    case 'image': return { id, type, alt: t('decks.editor.default.image'), fit: 'cover', placeholder: true };
    case 'table': return {
      id, type,
      header: [1, 2, 3].map(n => t('decks.editor.default.column', { n })),
      rows: [1, 2].map(r => [1, 2, 3].map(c => `${r}.${c}`)),
    };
    case 'chart': return {
      id, type, chartType: 'bar', labels: ['Q1', 'Q2', 'Q3', 'Q4'],
      series: [{ name: t('decks.editor.default.series'), values: [12, 19, 15, 24] }],
    };
    case 'callout': return { id, type, tone: 'info', title: t('decks.editor.default.calloutTitle'), text: t('decks.editor.default.paragraph') };
    case 'quote': return { id, type, text: t('decks.editor.default.quote'), attribution: t('decks.editor.default.attribution') };
    case 'code': return { id, type, language: 'ts', code: 'const answer = 42;' };
    case 'timeline': return {
      id, type,
      items: [1, 2, 3].map(n => ({ label: t('decks.editor.default.phase', { n }), title: t('decks.editor.default.milestone', { n }) })),
    };
    case 'steps': return { id, type, items: [1, 2, 3].map(n => ({ title: t('decks.editor.default.step', { n }), text: t('decks.editor.default.stepText') })) };
    case 'metrics': return {
      id, type,
      items: [
        { value: '42%', label: t('decks.editor.default.metric', { n: 1 }) },
        { value: '3.5×', label: t('decks.editor.default.metric', { n: 2 }) },
        { value: '120k', label: t('decks.editor.default.metric', { n: 3 }) },
      ],
    };
    case 'grid': return { id, type, items: [1, 2, 3].map(n => ({ title: t('decks.editor.default.point', { n }), text: t('decks.editor.default.stepText') })) };
    case 'columns': return {
      id, type,
      columns: [1, 2].map(n => [
        { id: newId('blk'), type: 'heading', level: 3, text: t('decks.editor.default.column', { n }) } as Block,
        { id: newId('blk'), type: 'paragraph', text: t('decks.editor.default.paragraph') } as Block,
      ]),
    };
    case 'divider': return { id, type };
  }
}
