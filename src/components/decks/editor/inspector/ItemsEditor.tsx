'use client';

import { ArrowDown, ArrowUp, Plus, Trash } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { useDecksT, type DecksStringKey } from '../../i18n';
import { removeAt, setAt, setItemField, swap } from './block-edit';
import { IconAction, Section, TextField } from './fields';

export interface ItemField<T> {
  key: keyof T & string;
  label: DecksStringKey;
  maxLength: number;
  /** Optional fields are removed when emptied; required ones are flagged. */
  optional?: boolean;
  multiline?: boolean;
}

interface ItemsEditorProps<T extends object> {
  items: T[];
  fields: ItemField<T>[];
  min: number;
  max: number;
  /** A new item for position n (1-based), with placeholder content. */
  make: (n: number) => T;
  onChange: (items: T[]) => void;
  disabled?: boolean;
}

/** Edit, add, remove and reorder the items of a timeline, steps, grid or metrics block. */
export function ItemsEditor<T extends object>({ items, fields, min, max, make, onChange, disabled }: ItemsEditorProps<T>) {
  const t = useDecksT();
  const read = (item: T, key: keyof T & string) => {
    const value = item[key];
    return typeof value === 'string' ? value : '';
  };
  return (
    <Section title={t('decks.editor.inspector.items')}>
      <ol className="flex flex-col gap-2">
        {items.map((item, i) => (
          <li key={i} className="flex flex-col gap-2 rounded-md border bg-muted/20 p-2">
            <div className="flex items-center gap-1">
              <span className="flex-1 text-xs font-medium">{t('decks.editor.inspector.item', { n: i + 1 })}</span>
              <IconAction label={t('decks.editor.inspector.moveItemUp', { n: i + 1 })} disabled={disabled || i === 0} onClick={() => onChange(swap(items, i, -1))}><ArrowUp size={14} /></IconAction>
              <IconAction label={t('decks.editor.inspector.moveItemDown', { n: i + 1 })} disabled={disabled || i === items.length - 1} onClick={() => onChange(swap(items, i, 1))}><ArrowDown size={14} /></IconAction>
              <IconAction label={t('decks.editor.inspector.removeItem', { n: i + 1 })} disabled={disabled || items.length <= min} onClick={() => onChange(removeAt(items, i))} destructive><Trash size={14} /></IconAction>
            </div>
            {fields.map(field => (
              <TextField
                key={field.key}
                label={t(field.label)}
                value={read(item, field.key)}
                maxLength={field.maxLength}
                multiline={field.multiline}
                rows={2}
                required={!field.optional}
                requiredLabel={t('decks.editor.inspector.required')}
                disabled={disabled}
                onChange={value => onChange(setAt(items, i, setItemField(item, field.key, value, !!field.optional)))}
              />
            ))}
          </li>
        ))}
      </ol>
      <div className="flex items-center justify-between gap-2">
        <Button type="button" size="sm" variant="outline" disabled={disabled || items.length >= max} onClick={() => onChange([...items, make(items.length + 1)])}>
          <Plus size={14} />{t('decks.editor.inspector.addItem')}
        </Button>
        <span className="text-xs text-muted-foreground">{t('decks.editor.inspector.itemLimits', { min, max })}</span>
      </div>
    </Section>
  );
}
