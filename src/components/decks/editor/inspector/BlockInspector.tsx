'use client';

import type { Block, BlockType, MediaItem } from '@/lib/decks/types';
import { useDecksT, type DecksStringKey } from '../../i18n';
import { BLOCK_ICONS } from '../InsertBlockMenu';
import { ITEM_LIMITS } from './block-edit';
import { ChartEditor } from './ChartEditor';
import { ImageBlockEditor } from './ImageBlockEditor';
import { ItemsEditor, type ItemField } from './ItemsEditor';
import { TableEditor } from './TableEditor';
import { CalloutEditor, CodeEditor, QuoteEditor } from './TextBlockEditors';

/** Blocks with a form in the inspector; the rest are edited inline on the card. */
export const INSPECTABLE_TYPES: BlockType[] = ['table', 'chart', 'metrics', 'timeline', 'steps', 'grid', 'image', 'callout', 'quote', 'code'];
export const isInspectable = (block: Block) => INSPECTABLE_TYPES.includes(block.type);

type Item<T extends Block['type']> = Extract<Block, { type: T }> extends { items: (infer I)[] } ? I : never;

const TIMELINE_FIELDS: ItemField<Item<'timeline'>>[] = [
  { key: 'label', label: 'decks.editor.inspector.field.label', maxLength: 40 },
  { key: 'title', label: 'decks.editor.inspector.field.title', maxLength: 120 },
  { key: 'text', label: 'decks.editor.inspector.field.text', maxLength: 400, optional: true, multiline: true },
];
const STEP_FIELDS: ItemField<Item<'steps'>>[] = [
  { key: 'title', label: 'decks.editor.inspector.field.title', maxLength: 120 },
  { key: 'text', label: 'decks.editor.inspector.field.text', maxLength: 500, optional: true, multiline: true },
];
const GRID_FIELDS: ItemField<Item<'grid'>>[] = [
  { key: 'icon', label: 'decks.editor.inspector.field.icon', maxLength: 4, optional: true },
  ...(STEP_FIELDS as ItemField<Item<'grid'>>[]),
];
const METRIC_FIELDS: ItemField<Item<'metrics'>>[] = [
  { key: 'value', label: 'decks.editor.inspector.field.value', maxLength: 24 },
  { key: 'label', label: 'decks.editor.inspector.field.label', maxLength: 80 },
  { key: 'detail', label: 'decks.editor.inspector.field.detail', maxLength: 200, optional: true },
];

interface BlockInspectorProps {
  deckId: string;
  block: Block | undefined;
  media: MediaItem[];
  onChange: (next: Block) => void;
  onMediaAdded: (media: MediaItem) => void;
  /** Set while an AI edit runs on the deck. */
  disabled?: boolean;
}

/** The side panel's Block tab: a form for the selected structured block (report 06 §4: native, editable blocks). */
export function BlockInspector({ deckId, block, media, onChange, onMediaAdded, disabled }: BlockInspectorProps) {
  const t = useDecksT();
  if (!block) return <p className="text-sm text-muted-foreground">{t('decks.editor.inspector.empty')}</p>;
  const Icon = BLOCK_ICONS[block.type];
  const header = (
    <div className="flex items-center gap-2 text-sm font-medium">
      <Icon size={16} className="text-muted-foreground" />{t(`decks.editor.block.${block.type}` as DecksStringKey)}
    </div>
  );
  return (
    <div className="flex flex-col gap-4" key={block.id}>
      {header}
      {disabled && <p className="rounded-md bg-muted px-2.5 py-1.5 text-xs text-muted-foreground" role="status">{t('decks.editor.inspector.locked')}</p>}
      <Form deckId={deckId} block={block} media={media} onChange={onChange} onMediaAdded={onMediaAdded} disabled={disabled} />
    </div>
  );
}

function Form({ deckId, block, media, onChange, onMediaAdded, disabled }: BlockInspectorProps & { block: Block }) {
  const t = useDecksT();
  const n = (key: DecksStringKey) => (i: number) => t(key, { n: i });
  switch (block.type) {
    case 'table': return <TableEditor block={block} onChange={onChange} disabled={disabled} />;
    case 'chart': return <ChartEditor block={block} onChange={onChange} disabled={disabled} />;
    case 'image': return <ImageBlockEditor deckId={deckId} block={block} media={media} onChange={onChange} onMediaAdded={onMediaAdded} disabled={disabled} />;
    case 'callout': return <CalloutEditor block={block} onChange={onChange} disabled={disabled} />;
    case 'quote': return <QuoteEditor block={block} onChange={onChange} disabled={disabled} />;
    case 'code': return <CodeEditor block={block} onChange={onChange} disabled={disabled} />;
    case 'timeline':
      return <ItemsEditor items={block.items} fields={TIMELINE_FIELDS} {...ITEM_LIMITS.timeline} disabled={disabled}
        make={i => ({ label: n('decks.editor.default.phase')(i), title: n('decks.editor.default.milestone')(i) })}
        onChange={items => onChange({ ...block, items })} />;
    case 'steps':
      return <ItemsEditor items={block.items} fields={STEP_FIELDS} {...ITEM_LIMITS.steps} disabled={disabled}
        make={i => ({ title: n('decks.editor.default.step')(i) })} onChange={items => onChange({ ...block, items })} />;
    case 'grid':
      return <ItemsEditor items={block.items} fields={GRID_FIELDS} {...ITEM_LIMITS.grid} disabled={disabled}
        make={i => ({ title: n('decks.editor.default.point')(i) })} onChange={items => onChange({ ...block, items })} />;
    case 'metrics':
      return <ItemsEditor items={block.items} fields={METRIC_FIELDS} {...ITEM_LIMITS.metrics} disabled={disabled}
        make={i => ({ value: '0', label: n('decks.editor.default.metric')(i) })} onChange={items => onChange({ ...block, items })} />;
    default:
      return <p className="text-sm text-muted-foreground">{t('decks.editor.inspector.inline')}</p>;
  }
}
