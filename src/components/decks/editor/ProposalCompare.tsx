'use client';

import { useState } from 'react';
import { ArrowsOutSimple, Check, X } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import { mediaUrl } from '@/lib/decks/client';
import type { Card, CardDimensions, DeckTheme, EditProposal } from '@/lib/decks/types';
import { CardView } from '../CardView';
import { useDecksT } from '../i18n';

interface Row { id: string; number: number | null; before?: Card; after?: Card }

/** One row per changed card, in deck order; cards only in `after` are new. */
export function changedRows(proposal: EditProposal, deckCards: Card[]): Row[] {
  const before = new Map(proposal.before.map(c => [c.id, c]));
  const after = new Map(proposal.after.map(c => [c.id, c]));
  const ids = [...new Set([...proposal.after.map(c => c.id), ...proposal.before.map(c => c.id)])];
  const position = (id: string) => { const i = deckCards.findIndex(c => c.id === id); return i < 0 ? null : i + 1; };
  return ids
    .map(id => ({ id, number: position(id), before: before.get(id), after: after.get(id) }))
    .filter(row => JSON.stringify(row.before) !== JSON.stringify(row.after))
    .sort((a, b) => (a.number ?? 1e9) - (b.number ?? 1e9));
}

interface ProposalCompareProps {
  proposal: EditProposal;
  deckCards: Card[];
  theme: DeckTheme;
  dimensions: CardDimensions;
  busy: string | null;
  onApply: () => void;
  onDiscard: () => void;
}

function Pair({ row, theme, dimensions, width }: { row: Row; theme: DeckTheme; dimensions: CardDimensions; width?: number }) {
  const t = useDecksT();
  const side = (card: Card | undefined, label: string, empty: string) => (
    <figure className="flex min-w-0 flex-1 flex-col gap-1">
      <figcaption className="text-[11px] font-medium text-muted-foreground">{label}</figcaption>
      {card
        ? <div className="pointer-events-none overflow-hidden rounded ring-1 ring-border"><CardView card={card} theme={theme} dimensions={dimensions} mediaUrl={mediaUrl} width={width} /></div>
        : <div className="flex aspect-video items-center justify-center rounded border border-dashed text-[11px] text-muted-foreground">{empty}</div>}
    </figure>
  );
  return (
    <div className="flex flex-col gap-1">
      <div className="text-xs text-muted-foreground">{row.number ? t('decks.editor.cardN', { n: row.number }) : t('decks.editor.ai.newCard')}</div>
      <div className="flex gap-2">
        {side(row.before, t('decks.editor.ai.original'), t('decks.editor.ai.added'))}
        {side(row.after, t('decks.editor.ai.modified'), t('decks.editor.ai.removed'))}
      </div>
    </div>
  );
}

/**
 * Original / Modified receipt (report 06 §3.2). All changes from one request
 * are applied or discarded together; the full view is the "Review changes" screen.
 */
export function ProposalCompare({ proposal, deckCards, theme, dimensions, busy, onApply, onDiscard }: ProposalCompareProps) {
  const t = useDecksT();
  const [full, setFull] = useState(false);
  const rows = changedRows(proposal, deckCards);
  const actions = (
    <>
      <Button size="sm" variant="outline" disabled={busy !== null} onClick={onDiscard}>
        {busy === 'discard' ? <Spinner className="size-4" /> : <X size={16} />}{t('decks.editor.ai.discard')}
      </Button>
      <Button size="sm" disabled={busy !== null} onClick={onApply}>
        {busy === 'apply' ? <Spinner className="size-4" /> : <Check size={16} />}{t('decks.editor.ai.apply')}
      </Button>
    </>
  );
  return (
    <section className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-3" aria-label={t('decks.editor.ai.review')}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-medium">{t('decks.editor.ai.changes', { n: rows.length })}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">“{proposal.instruction}”</p>
        </div>
        <Button size="icon-sm" variant="ghost" onClick={() => setFull(true)} aria-label={t('decks.editor.ai.compareAll')} title={t('decks.editor.ai.compareAll')}>
          <ArrowsOutSimple size={16} />
        </Button>
      </div>
      {proposal.summary && <p className="text-sm leading-relaxed">{proposal.summary}</p>}
      <div className="flex max-h-[45vh] flex-col gap-3 overflow-y-auto">
        {rows.length === 0 && <p className="text-xs text-muted-foreground">{t('decks.editor.ai.noVisibleChange')}</p>}
        {rows.map(row => <Pair key={row.id} row={row} theme={theme} dimensions={dimensions} />)}
      </div>
      <p className="text-[11px] text-muted-foreground">{t('decks.editor.ai.grouped')}</p>
      <div className="flex justify-end gap-2">{actions}</div>

      <Dialog open={full} onOpenChange={setFull}>
        <DialogContent className="sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>{t('decks.editor.ai.review')}</DialogTitle>
            <DialogDescription>{proposal.summary || proposal.instruction}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-5">
            {rows.map(row => <Pair key={row.id} row={row} theme={theme} dimensions={dimensions} />)}
          </div>
          <DialogFooter>{actions}</DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
