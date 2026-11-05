'use client';

import { useState } from 'react';
import { ArrowDown, ArrowUp, Copy, DotsThreeVertical, Eye, EyeSlash, Plus, Trash } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { mediaUrl } from '@/lib/decks/client';
import { cardTitle } from '@/lib/decks/blocks';
import type { Card, CardDimensions, DeckTheme } from '@/lib/decks/types';
import { cn } from '@/lib/utils';
import { CardView } from '../CardView';
import { useDecksT } from '../i18n';

export type CardAction = 'up' | 'down' | 'duplicate' | 'delete' | 'toggleHidden';

interface FilmstripProps {
  cards: Card[];
  selectedId: string | undefined;
  theme: DeckTheme;
  dimensions: CardDimensions;
  horizontal: boolean;
  onSelect: (id: string) => void;
  onAction: (id: string, action: CardAction) => void;
  onMove: (from: number, to: number) => void;
  onAdd: () => void;
}

/** Numbered thumbnails with card-level actions and drag to reorder (report 06 §4). */
export function Filmstrip({ cards, selectedId, theme, dimensions, horizontal, onSelect, onAction, onMove, onAdd }: FilmstripProps) {
  const t = useDecksT();
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const thumbWidth = horizontal ? 112 : 168;

  return (
    <nav
      aria-label={t('decks.editor.filmstrip')}
      className={cn('shrink-0 bg-muted/30', horizontal
        ? 'flex w-full gap-2 overflow-x-auto border-b px-2 py-2'
        : 'flex w-[216px] flex-col gap-2 overflow-y-auto border-r px-3 py-3')}
    >
      {cards.map((card, index) => {
        const selected = card.id === selectedId;
        const label = cardTitle(card) || t('decks.editor.cardN', { n: index + 1 });
        return (
          <div
            key={card.id}
            draggable
            onDragStart={e => { setDragFrom(index); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', card.id); }}
            onDragOver={e => { if (dragFrom !== null) { e.preventDefault(); setDragOver(index); } }}
            onDragLeave={() => setDragOver(o => (o === index ? null : o))}
            onDrop={e => { e.preventDefault(); if (dragFrom !== null) onMove(dragFrom, index); setDragFrom(null); setDragOver(null); }}
            onDragEnd={() => { setDragFrom(null); setDragOver(null); }}
            className={cn('group relative flex shrink-0 gap-1.5 rounded-md p-1', horizontal ? 'flex-col' : 'flex-row',
              dragOver === index && dragFrom !== index && 'ring-2 ring-primary/50')}
          >
            <span className={cn('w-4 shrink-0 pt-0.5 text-right text-[11px] tabular-nums text-muted-foreground', horizontal && 'hidden')}>{index + 1}</span>
            <button
              type="button"
              onClick={() => onSelect(card.id)}
              aria-label={t('decks.editor.selectCard', { n: index + 1, title: label })}
              aria-current={selected ? 'true' : undefined}
              className={cn('relative block max-h-40 shrink-0 overflow-hidden rounded-md border-2 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
                selected ? 'border-primary' : 'border-transparent hover:border-border', card.hidden && 'opacity-40')}
            >
              <div className="pointer-events-none">
                <CardView card={card} theme={theme} dimensions={dimensions} mediaUrl={mediaUrl} width={thumbWidth} pending={card.stage !== 'done' && card.stage !== 'failed'} />
              </div>
              {horizontal && <span className="absolute bottom-0.5 left-1 rounded bg-background/80 px-1 text-[10px] tabular-nums">{index + 1}</span>}
              {card.hidden && <EyeSlash size={14} className="absolute right-1 bottom-1 text-foreground" aria-label={t('decks.editor.hidden')} />}
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="secondary" size="icon-xs" aria-label={t('decks.editor.cardActions', { n: index + 1 })}
                  className={cn('absolute top-1.5 right-1.5 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100', (selected || horizontal) && 'opacity-100')}
                >
                  <DotsThreeVertical size={14} weight="bold" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem disabled={index === 0} onSelect={() => onAction(card.id, 'up')}><ArrowUp size={16} />{t('decks.editor.moveUp')}</DropdownMenuItem>
                <DropdownMenuItem disabled={index === cards.length - 1} onSelect={() => onAction(card.id, 'down')}><ArrowDown size={16} />{t('decks.editor.moveDown')}</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onAction(card.id, 'duplicate')}><Copy size={16} />{t('decks.editor.duplicate')}</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onAction(card.id, 'toggleHidden')}>
                  {card.hidden ? <Eye size={16} /> : <EyeSlash size={16} />}{card.hidden ? t('decks.editor.unhide') : t('decks.editor.hide')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => onAction(card.id, 'delete')}><Trash size={16} />{t('decks.delete')}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      })}
      <Button variant="outline" size="sm" onClick={onAdd} className={cn('shrink-0 border-dashed', horizontal ? 'h-auto self-stretch px-3' : 'ml-5')} aria-label={t('decks.editor.addCard')}>
        <Plus size={16} /><span className={horizontal ? 'sr-only' : undefined}>{t('decks.editor.addCard')}</span>
      </Button>
    </nav>
  );
}
