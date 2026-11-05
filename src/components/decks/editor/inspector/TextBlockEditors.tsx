'use client';

import type { Block } from '@/lib/decks/types';
import { useDecksT } from '../../i18n';
import { Segmented, TextField } from './fields';

type Callout = Extract<Block, { type: 'callout' }>;
type Quote = Extract<Block, { type: 'quote' }>;
type Code = Extract<Block, { type: 'code' }>;

const TONES: Callout['tone'][] = ['info', 'warning', 'success', 'note'];

/** Copy of `block` with `key` set, or removed when emptied (optional fields are never stored as ""). */
function withOptional<B extends Block, K extends keyof B & string>(block: B, key: K, value: string): B {
  const next = { ...block, [key]: value };
  if (!value) delete next[key];
  return next;
}

export function CalloutEditor({ block, onChange, disabled }: { block: Callout; onChange: (next: Callout) => void; disabled?: boolean }) {
  const t = useDecksT();
  return (
    <div className="flex flex-col gap-4">
      <Segmented label={t('decks.editor.inspector.tone')} value={block.tone} disabled={disabled}
        options={TONES.map(tone => ({ value: tone, label: t(`decks.editor.inspector.tone.${tone}`) }))}
        onChange={tone => onChange({ ...block, tone })} />
      <TextField label={t('decks.editor.inspector.field.title')} value={block.title ?? ''} maxLength={200} disabled={disabled}
        onChange={title => onChange(withOptional(block, 'title', title))} />
      <TextField label={t('decks.editor.inspector.field.text')} value={block.text} maxLength={1200} multiline disabled={disabled}
        required requiredLabel={t('decks.editor.inspector.required')} onChange={text => onChange({ ...block, text })} />
    </div>
  );
}

export function QuoteEditor({ block, onChange, disabled }: { block: Quote; onChange: (next: Quote) => void; disabled?: boolean }) {
  const t = useDecksT();
  return (
    <div className="flex flex-col gap-4">
      <TextField label={t('decks.editor.inspector.quote')} value={block.text} maxLength={1000} multiline disabled={disabled}
        required requiredLabel={t('decks.editor.inspector.required')} onChange={text => onChange({ ...block, text })} />
      <TextField label={t('decks.editor.inspector.attribution')} value={block.attribution ?? ''} maxLength={200} disabled={disabled}
        onChange={attribution => onChange(withOptional(block, 'attribution', attribution))} />
    </div>
  );
}

export function CodeEditor({ block, onChange, disabled }: { block: Code; onChange: (next: Code) => void; disabled?: boolean }) {
  const t = useDecksT();
  return (
    <div className="flex flex-col gap-4">
      <TextField label={t('decks.editor.inspector.language')} value={block.language} maxLength={30} placeholder="ts" disabled={disabled}
        onChange={language => onChange({ ...block, language })} />
      <TextField label={t('decks.editor.inspector.code')} value={block.code} maxLength={4000} multiline mono rows={10} disabled={disabled}
        onChange={code => onChange({ ...block, code })} />
    </div>
  );
}
