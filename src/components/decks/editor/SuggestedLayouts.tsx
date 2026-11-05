'use client';

import { useMemo } from 'react';
import { mediaUrl } from '@/lib/decks/client';
import { suggestLayouts } from '@/lib/decks/layout-suggestions';
import type { Card, CardDimensions, DeckTheme } from '@/lib/decks/types';
import { CardView } from '../CardView';
import { useDecksT, type DecksStringKey } from '../i18n';

interface SuggestedLayoutsProps {
  card: Card;
  theme: DeckTheme;
  dimensions: CardDimensions;
  onApply: (next: Card) => void;
  disabled?: boolean;
}

/**
 * Report 04 §2.2 "Suggested layouts": live thumbnails of this card with its
 * own content rearranged (src/lib/decks/layout-suggestions.ts). Applying one
 * replaces the card in a single saved edit, so History can restore the
 * previous arrangement.
 */
export function SuggestedLayouts({ card, theme, dimensions, onApply, disabled }: SuggestedLayoutsProps) {
  const t = useDecksT();
  const itemHeader = t('decks.editor.suggest.tableItem');
  const detailHeader = t('decks.editor.suggest.tableDetail');
  const ready = card.stage === 'done' || card.stage === 'failed';
  const suggestions = useMemo(
    () => (ready ? suggestLayouts(card, { dimensions, tableHeader: [itemHeader, detailHeader] }) : []),
    [ready, card, dimensions, itemHeader, detailHeader],
  );
  const title = t('decks.editor.layout.suggested');

  return (
    <section aria-label={title}>
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      <p className="mb-2 text-xs text-muted-foreground">
        {!ready ? t('decks.editor.layout.suggestedPending') : suggestions.length ? t('decks.editor.layout.suggestedHint') : t('decks.editor.layout.suggestedNone')}
      </p>
      {suggestions.length > 0 && (
        <ul className="grid grid-cols-2 gap-2">
          {suggestions.map(suggestion => {
            const name = t(`decks.editor.suggest.${suggestion.kind}` as DecksStringKey);
            return (
              <li key={suggestion.id}>
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={t('decks.editor.layout.suggestedApply', { name })}
                  onClick={() => onApply(suggestion.card)}
                  className="flex w-full flex-col gap-1 rounded-md border-2 border-transparent p-1 text-left text-xs transition-colors outline-none hover:border-border focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
                >
                  <div className="pointer-events-none max-h-24 overflow-hidden rounded ring-1 ring-border">
                    <CardView card={suggestion.card} theme={theme} dimensions={dimensions} mediaUrl={mediaUrl} />
                  </div>
                  <span className="text-muted-foreground">{name}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
