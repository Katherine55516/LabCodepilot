'use client';

import { useMemo } from 'react';
import { Check } from '@phosphor-icons/react';
import type { Card, DeckTheme } from '@/lib/decks/types';
import { DECK_THEMES } from '@/lib/decks/themes';
import { cn } from '@/lib/utils';
import { CardView } from './CardView';
import { useDecksT } from './i18n';

/** A theme gallery: each tile is a real card rendered with that theme (heading + bullets + accent on the right). */
export function ThemePicker({ value, onChange, extra = [] }: { value: string; onChange: (id: string) => void; /** e.g. the theme read from an imported template */ extra?: DeckTheme[] }) {
  const t = useDecksT();
  const bullets = [t('decks.theme.sampleBullet1'), t('decks.theme.sampleBullet2')];
  return (
    <div role="radiogroup" aria-label={t('decks.theme.label')} className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {[...extra, ...DECK_THEMES].map(theme => (
        <ThemeTile key={theme.id} theme={theme} bullets={bullets} selected={theme.id === value} onSelect={() => onChange(theme.id)} />
      ))}
    </div>
  );
}

function ThemeTile({ theme, bullets, selected, onSelect }: { theme: DeckTheme; bullets: string[]; selected: boolean; onSelect: () => void }) {
  const [first, second] = bullets;
  const card = useMemo<Card>(() => ({
    id: `theme-sample-${theme.id}`,
    blocks: [
      { id: 'h', type: 'heading', level: 2, text: theme.name },
      { id: 'b', type: 'bullets', items: [first, second] },
    ],
    layout: { accent: 'right', align: 'left' },
    hidden: false,
    notes: '',
    stage: 'done',
  }), [theme.id, theme.name, first, second]);
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={theme.name}
      onClick={onSelect}
      className={cn(
        'group relative flex flex-col gap-1.5 rounded-lg border p-1.5 text-left outline-none transition-colors',
        'focus-visible:ring-[3px] focus-visible:ring-ring/50',
        selected ? 'border-primary ring-1 ring-primary' : 'border-border hover:border-foreground/30',
      )}
    >
      <CardView card={card} theme={theme} dimensions="16x9" className="pointer-events-none" />
      <span className="flex items-center justify-between gap-1 px-0.5 text-xs font-medium">
        <span className="truncate">{theme.name}</span>
        {selected && <Check size={14} weight="bold" className="shrink-0 text-primary" aria-hidden />}
      </span>
    </button>
  );
}
