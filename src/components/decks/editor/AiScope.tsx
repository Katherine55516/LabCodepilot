'use client';

import { Cards, Rectangle, TextT } from '@phosphor-icons/react';
import { cardTitle } from '@/lib/decks/blocks';
import type { Block, Card, EditScope } from '@/lib/decks/types';
import { cn } from '@/lib/utils';
import { useDecksT, type DecksStringKey } from '../i18n';
import { blockSnippet } from './card-ops';
import type { AiScopeKind } from './types';

interface AiScopeProps {
  kind: AiScopeKind;
  onKind: (kind: AiScopeKind) => void;
  deckTitle: string;
  card: Card | undefined;
  cardIndex: number;
  block: Block | undefined;
  disabled?: boolean;
}

/** Resolves the requested scope to what is actually available. */
export function effectiveScope(kind: AiScopeKind, card: Card | undefined, block: Block | undefined): EditScope {
  if (kind === 'block' && card && block) return { kind: 'block', cardId: card.id, blockId: block.id };
  if (kind !== 'deck' && card) return { kind: 'card', cardId: card.id };
  return { kind: 'deck' };
}

/**
 * Scope selector plus the typed chip (report 06 §3.1): `Paragraph · "first
 * words…"`, `Card · <title>`, `Deck · <title>`.
 */
export function AiScope({ kind, onKind, deckTitle, card, cardIndex, block, disabled }: AiScopeProps) {
  const t = useDecksT();
  const scope = effectiveScope(kind, card, block);
  const options: { kind: AiScopeKind; label: string; icon: React.ReactNode; enabled: boolean }[] = [
    { kind: 'deck', label: t('decks.editor.ai.scope.deck'), icon: <Cards size={14} />, enabled: true },
    { kind: 'card', label: t('decks.editor.ai.scope.card'), icon: <Rectangle size={14} />, enabled: !!card },
    { kind: 'block', label: t('decks.editor.ai.scope.block'), icon: <TextT size={14} />, enabled: !!block },
  ];
  const chip = scope.kind === 'deck'
    ? `${t('decks.editor.ai.chip.deck')} · ${deckTitle || t('decks.editor.untitled')}`
    : scope.kind === 'card'
      ? `${t('decks.editor.ai.chip.card')} · ${(card && cardTitle(card)) || t('decks.editor.cardN', { n: cardIndex + 1 })}`
      : `${t(`decks.editor.block.${block!.type}` as DecksStringKey)} · “${blockSnippet(block!) || '…'}”`;

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-3 rounded-md bg-muted p-0.5" role="radiogroup" aria-label={t('decks.editor.ai.scope')}>
        {options.map(option => {
          const active = scope.kind === option.kind;
          return (
            <button
              key={option.kind}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled || !option.enabled}
              title={!option.enabled && option.kind === 'block' ? t('decks.editor.ai.scope.blockHint') : undefined}
              onClick={() => onKind(option.kind)}
              className={cn('flex items-center justify-center gap-1 rounded px-1.5 py-1 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40',
                active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
            >
              {option.icon}<span className="truncate">{option.label}</span>
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/5 px-2 py-1 text-xs" aria-live="polite">
        <span className="shrink-0 text-muted-foreground">{t('decks.editor.ai.willChange')}</span>
        <span className="min-w-0 truncate font-medium" title={chip}>{chip}</span>
      </div>
    </div>
  );
}
