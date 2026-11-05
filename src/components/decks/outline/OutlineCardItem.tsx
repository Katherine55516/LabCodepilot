'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowDown, ArrowUp, ChatText, Plus, Trash, X } from '@phosphor-icons/react';
import type { OutlineCard } from '@/lib/decks/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { useDecksT } from '../i18n';

interface OutlineCardItemProps {
  card: OutlineCard;
  index: number;
  total: number;
  onChange: (patch: Partial<OutlineCard>) => void;
  onRemove: () => void;
  onMove: (delta: -1 | 1) => void;
  /** Focus the title on mount (a freshly added card). */
  autoFocus?: boolean;
}

/** One editable card of the plan: title, points, per-card instruction and card actions. */
export function OutlineCardItem({ card, index, total, onChange, onRemove, onMove, autoFocus }: OutlineCardItemProps) {
  const t = useDecksT();
  const [showInstruction, setShowInstruction] = useState(Boolean(card.instruction));
  const pointRefs = useRef<(HTMLTextAreaElement | null)[]>([]);
  const focusRequest = useRef<number | null>(null);
  const number = index + 1;

  useEffect(() => {
    if (focusRequest.current === null) return;
    const el = pointRefs.current[focusRequest.current];
    focusRequest.current = null;
    if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
  });

  const setPoints = (points: string[], focus?: number) => {
    if (focus !== undefined) focusRequest.current = focus;
    onChange({ points });
  };
  const onPointKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>, i: number) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      setPoints([...card.points.slice(0, i + 1), '', ...card.points.slice(i + 1)], i + 1);
    } else if (event.key === 'Backspace' && card.points[i] === '' && card.points.length > 1) {
      event.preventDefault();
      setPoints(card.points.filter((_, j) => j !== i), Math.max(0, i - 1));
    }
  };

  return (
    <article aria-label={t('decks.outline.cardLabel', { n: number })} className="group rounded-xl border border-border/70 bg-card p-3 shadow-xs sm:p-4">
      <div className="flex items-start gap-2 sm:gap-3">
        <span className="mt-1.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold tabular-nums text-muted-foreground">{number}</span>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Input
            value={card.title}
            autoFocus={autoFocus}
            aria-label={t('decks.outline.titleLabel', { n: number })}
            placeholder={t('decks.outline.titlePlaceholder')}
            onChange={event => onChange({ title: event.target.value })}
            onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); pointRefs.current[0]?.focus(); } }}
            className="h-9 border-transparent px-2 text-base font-semibold shadow-none hover:border-border focus-visible:border-ring md:text-base dark:bg-transparent"
          />
          <ul className="flex flex-col gap-1">
            {card.points.map((point, i) => (
              <li key={i} className="group/point flex items-start gap-1.5">
                <span aria-hidden className="mt-3 size-1.5 shrink-0 rounded-full bg-muted-foreground/60" />
                <Textarea
                  ref={el => { pointRefs.current[i] = el; }}
                  value={point}
                  rows={1}
                  aria-label={t('decks.outline.pointLabel', { n: i + 1, card: number })}
                  placeholder={t('decks.outline.pointPlaceholder')}
                  onChange={event => setPoints(card.points.map((p, j) => (j === i ? event.target.value.replace(/\n/g, ' ') : p)))}
                  onKeyDown={event => onPointKeyDown(event, i)}
                  className="min-h-0 resize-none border-transparent px-2 py-1.5 text-sm shadow-none hover:border-border focus-visible:border-ring dark:bg-transparent"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('decks.outline.removePoint', { n: i + 1 })}
                  disabled={card.points.length === 1 && point === ''}
                  onClick={() => setPoints(card.points.length === 1 ? [''] : card.points.filter((_, j) => j !== i))}
                  className="mt-0.5 shrink-0 text-muted-foreground opacity-100 sm:opacity-0 sm:group-hover/point:opacity-100 sm:focus-visible:opacity-100"
                >
                  <X />
                </Button>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-1">
            <Button type="button" variant="ghost" size="xs" onClick={() => setPoints([...card.points, ''], card.points.length)} className="text-muted-foreground">
              <Plus aria-hidden />{t('decks.outline.addPoint')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              aria-expanded={showInstruction}
              onClick={() => setShowInstruction(v => !v)}
              className={cn('text-muted-foreground', card.instruction && 'text-foreground')}
            >
              <ChatText aria-hidden />{t('decks.outline.instruction')}
            </Button>
          </div>
          {showInstruction && (
            <Input
              value={card.instruction ?? ''}
              autoFocus={!card.instruction}
              aria-label={t('decks.outline.instructionLabel', { n: number })}
              placeholder={t('decks.outline.instructionPlaceholder')}
              onChange={event => onChange({ instruction: event.target.value })}
              className="h-8 text-sm"
            />
          )}
        </div>
        <div className="flex shrink-0 flex-col gap-0.5 sm:flex-row">
          <Button type="button" variant="ghost" size="icon-sm" aria-label={t('decks.outline.moveUp', { n: number })} disabled={index === 0} onClick={() => onMove(-1)}>
            <ArrowUp />
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" aria-label={t('decks.outline.moveDown', { n: number })} disabled={index === total - 1} onClick={() => onMove(1)}>
            <ArrowDown />
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" aria-label={t('decks.outline.deleteCard', { n: number })} disabled={total <= 1} onClick={onRemove} className="hover:text-destructive">
            <Trash />
          </Button>
        </div>
      </div>
    </article>
  );
}

/** Read-only card while the outline is still streaming in (skeleton for missing parts). */
export function OutlineCardPreview({ card, index }: { card?: OutlineCard; index: number }) {
  const t = useDecksT();
  return (
    <article aria-label={t('decks.outline.cardLabel', { n: index + 1 })} aria-busy={!card} className="rounded-xl border border-border/70 bg-card p-3 sm:p-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold tabular-nums text-muted-foreground">{index + 1}</span>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {card?.title ? <h3 className="px-0.5 text-base font-semibold">{card.title}</h3> : <div className="h-5 w-1/2 animate-pulse rounded bg-muted" />}
          {card && card.points.length > 0 ? (
            <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-foreground/90">
              {card.points.map((point, i) => <li key={i}>{point}</li>)}
            </ul>
          ) : (
            <div className="flex flex-col gap-1.5">
              <div className="h-3.5 w-11/12 animate-pulse rounded bg-muted" />
              <div className="h-3.5 w-4/5 animate-pulse rounded bg-muted" />
              <div className="h-3.5 w-2/3 animate-pulse rounded bg-muted" />
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
