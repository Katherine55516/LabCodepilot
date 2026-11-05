'use client';

import { Plus, Sparkle, WarningCircle } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { mediaUrl } from '@/lib/decks/client';
import type { Block, BlockType, Card, CardDimensions, DeckTheme, HeaderFooter } from '@/lib/decks/types';
import { CardView } from '../CardView';
import { useDecksT } from '../i18n';
import { BlockToolbar, type BlockAction } from './BlockToolbar';
import { InsertBlockMenu } from './InsertBlockMenu';

interface CanvasProps {
  card: Card | undefined;
  index: number;
  total: number;
  /** 1-based number among visible cards (headers/footers), undefined when hidden. */
  visibleNumber?: number;
  visibleCount: number;
  theme: DeckTheme;
  dimensions: CardDimensions;
  headerFooter: HeaderFooter;
  deckTitle: string;
  selectedBlock: Block | undefined;
  onSelectBlock: (id: string | null) => void;
  onChangeBlock: (id: string, next: Block) => void;
  onBlockAction: (action: BlockAction) => void;
  onInsert: (type: BlockType) => void;
  onAddCard: () => void;
  /** Set while an AI edit job targets this card. */
  aiBusy: boolean;
}

export function Canvas(props: CanvasProps) {
  const t = useDecksT();
  const { card, selectedBlock } = props;
  if (!card) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-sm text-muted-foreground">
        <p>{t('decks.editor.noCards')}</p>
        <Button onClick={props.onAddCard}><Plus size={16} />{t('decks.editor.addCard')}</Button>
      </div>
    );
  }
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-3 py-3 sm:px-6 sm:py-5">
      <div className="flex min-h-10 flex-wrap items-center gap-2">
        <span className="text-xs tabular-nums text-muted-foreground">{t('decks.editor.cardOf', { n: props.index + 1, total: props.total })}</span>
        {card.hidden && <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{t('decks.editor.hidden')}</span>}
        <InsertBlockMenu onInsert={props.onInsert} />
        {selectedBlock && (
          <BlockToolbar block={selectedBlock} onAction={props.onBlockAction} onChange={next => props.onChangeBlock(selectedBlock.id, next)} />
        )}
      </div>
      {/* Capture phase: CardView's inline text stops propagation, so select the clicked block here.
          Bubble phase only reaches this for empty card space, which clears the selection. */}
      <div
        className="relative"
        onClickCapture={e => {
          const id = e.target instanceof Element ? e.target.closest('[data-block-id]')?.getAttribute('data-block-id') : null;
          if (id && !props.aiBusy) props.onSelectBlock(id);
        }}
        onClick={() => props.onSelectBlock(null)}
      >
        <CardView
          card={card}
          theme={props.theme}
          dimensions={props.dimensions}
          mediaUrl={mediaUrl}
          cardNumber={props.visibleNumber}
          cardCount={props.visibleCount}
          headerFooter={props.headerFooter}
          deckTitle={props.deckTitle}
          editable={!props.aiBusy}
          selectedBlockId={selectedBlock?.id ?? null}
          onSelectBlock={props.onSelectBlock}
          onChangeBlock={props.onChangeBlock}
          pending={card.stage !== 'done' && card.stage !== 'failed'}
          className="shadow-md ring-1 ring-border"
        />
        {props.aiBusy && (
          <div className="absolute inset-0 flex items-start justify-end rounded-lg bg-background/30 p-3" aria-live="polite">
            <span className="flex items-center gap-1.5 rounded-full bg-popover px-3 py-1 text-xs font-medium shadow">
              <Sparkle size={14} className="animate-pulse text-primary" />{t('decks.editor.ai.editing')}
            </span>
          </div>
        )}
      </div>
      {card.issues && card.issues.length > 0 && (
        <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
          {card.issues.map((issue, i) => (
            <li key={i} className="flex items-center gap-1.5"><WarningCircle size={14} className="shrink-0 text-destructive" />{issue.message}</li>
          ))}
        </ul>
      )}
      <p className="hidden text-xs text-muted-foreground md:block">{t('decks.editor.hint')}</p>
    </div>
  );
}
