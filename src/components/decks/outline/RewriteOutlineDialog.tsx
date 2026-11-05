'use client';

import { useState, type FormEvent } from 'react';
import { ArrowsClockwise } from '@phosphor-icons/react';
import { NUM_CARDS_RANGE } from '@/lib/decks/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Spinner } from '@/components/ui/spinner';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { ErrorBanner } from '@/components/ui/error-banner';
import { useDecksT } from '../i18n';
import { Field } from '../create/controls';
import { clampCards, errorMessage } from '../create/options';

/**
 * "Rewrite outline": a chat-style revision of the plan (report 02 §5.1 "Plan
 * revision by chat", e.g. "merge to 10"). The plan then re-streams in place.
 */
export function RewriteOutlineDialog({ currentCount, disabled, onSubmit }: {
  currentCount: number;
  disabled?: boolean;
  onSubmit: (body: { instruction?: string; numCards?: number }) => Promise<void>;
}) {
  const t = useDecksT();
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [numCards, setNumCards] = useState(String(currentCount));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = numCards.trim() === '' ? undefined : clampCards(Number(numCards));
  const changesCount = parsed !== undefined && parsed !== currentCount;
  const canSubmit = !busy && (instruction.trim().length > 0 || changesCount);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ instruction: instruction.trim() || undefined, numCards: parsed });
      setOpen(false);
      setInstruction('');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={next => { setOpen(next); if (next) { setNumCards(String(currentCount)); setError(null); } }}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={disabled}>
          <ArrowsClockwise aria-hidden />{t('decks.outline.rewrite')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t('decks.outline.rewriteTitle')}</DialogTitle>
            <DialogDescription>{t('decks.outline.rewriteDescription')}</DialogDescription>
          </DialogHeader>
          <Field label={t('decks.outline.rewriteInstruction')} htmlFor="decks-rewrite-instruction">
            <Textarea
              id="decks-rewrite-instruction"
              autoFocus
              rows={3}
              maxLength={5000}
              value={instruction}
              placeholder={t('decks.outline.rewritePlaceholder')}
              onChange={event => setInstruction(event.target.value)}
              onKeyDown={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void submit(event); }}
              className="max-h-48"
            />
          </Field>
          <Field label={t('decks.create.numCards')} htmlFor="decks-rewrite-count" hint={t('decks.create.numCardsHint')}>
            <Input
              id="decks-rewrite-count"
              type="number"
              inputMode="numeric"
              min={NUM_CARDS_RANGE.min}
              max={NUM_CARDS_RANGE.max}
              value={numCards}
              onChange={event => setNumCards(event.target.value)}
              className="w-24"
            />
          </Field>
          {error && <ErrorBanner message={t('decks.outline.rewriteFailed')} description={error} />}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>{t('decks.cancel')}</Button>
            <Button type="submit" disabled={!canSubmit}>
              {busy && <Spinner />}{t('decks.outline.rewriteSubmit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
