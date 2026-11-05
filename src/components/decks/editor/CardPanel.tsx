'use client';

import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import type { Card } from '@/lib/decks/types';
import { useDecksT } from '../i18n';

interface CardPanelProps {
  card: Card;
  onChange: (patch: Partial<Pick<Card, 'notes' | 'hidden'>>) => void;
}

/** Speaker notes and visibility for the selected card (report 06 §4: card rail). */
export function CardPanel({ card, onChange }: CardPanelProps) {
  const t = useDecksT();
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Label htmlFor={`notes-${card.id}`} className="text-xs font-medium text-muted-foreground">{t('decks.editor.card.notes')}</Label>
        <Textarea
          id={`notes-${card.id}`}
          value={card.notes}
          onChange={e => onChange({ notes: e.target.value })}
          placeholder={t('decks.editor.card.notesPlaceholder')}
          className="min-h-40 resize-y text-sm"
        />
        <p className="text-xs text-muted-foreground">{t('decks.editor.card.notesHint')}</p>
      </div>
      <Label className="flex items-start justify-between gap-3 font-normal">
        <span className="flex flex-col gap-0.5">
          <span className="text-sm">{t('decks.editor.card.hide')}</span>
          <span className="text-xs text-muted-foreground">{t('decks.editor.card.hideHint')}</span>
        </span>
        <Switch checked={card.hidden} onCheckedChange={hidden => onChange({ hidden })} />
      </Label>
    </div>
  );
}
