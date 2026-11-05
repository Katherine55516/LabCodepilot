'use client';

import { useState, type FormEvent } from 'react';
import { PaperPlaneRight, X } from '@phosphor-icons/react';
import type { DeckJob, QueuedInstruction } from '@/lib/decks/types';
import { decksApi } from '@/lib/decks/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { ErrorBanner } from '@/components/ui/error-banner';
import { useDecksT } from '../i18n';
import { errorMessage } from '../create/options';

/**
 * Messages sent during the build are queued, not applied mid-build; they run
 * after the deck finishes (report 02 §5.2).
 */
export function InstructionQueue({ deckId, job, onQueued }: { deckId: string; job?: DeckJob; onQueued: (job: DeckJob) => void }) {
  const t = useDecksT();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const items = job?.queuedInstructions ?? [];

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    const value = text.trim();
    if (!value || sending) return;
    setSending(true);
    setError(null);
    try {
      const result = await decksApi.queueInstruction(deckId, value);
      onQueued(result.job);
      setText('');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <section aria-labelledby="decks-queue-heading" className="flex flex-col gap-3 rounded-xl border border-border/60 bg-card p-4">
      <div className="flex flex-col gap-1">
        <h2 id="decks-queue-heading" className="text-sm font-semibold">{t('decks.build.queueTitle')}</h2>
        <p className="text-xs text-muted-foreground">{t('decks.build.queueHint')}</p>
      </div>
      <form onSubmit={submit} className="flex flex-col gap-2">
        <Label htmlFor="decks-queue-input" className="sr-only">{t('decks.build.queueTitle')}</Label>
        <Textarea
          id="decks-queue-input"
          rows={2}
          maxLength={10000}
          value={text}
          placeholder={t('decks.build.queuePlaceholder')}
          onChange={event => setText(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); } }}
          className="max-h-40 text-sm"
        />
        <Button type="submit" size="sm" disabled={!text.trim() || sending} className="self-end">
          {sending ? <Spinner /> : <PaperPlaneRight aria-hidden />}{t('decks.build.queueSubmit')}
        </Button>
      </form>
      {error && <ErrorBanner message={t('decks.build.queueFailed')} description={error} onDismiss={() => setError(null)} />}
      {items.length > 0 && (
        <ol className="flex flex-col gap-2" aria-label={t('decks.build.queueList')}>
          {items.map(item => <QueuedItem key={item.id} item={item} onRemove={async () => { try { onQueued((await decksApi.removeInstruction(deckId, item.id)).job); } catch (e) { setError(errorMessage(e)); } }} />)}
        </ol>
      )}
    </section>
  );
}

function QueuedItem({ item, onRemove }: { item: QueuedInstruction; onRemove: () => void }) {
  const t = useDecksT();
  return (
    <li className="flex items-start justify-between gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm">
      <span className="min-w-0 flex-1 break-words">{item.text}</span>
      {item.status === 'queued' && (
        <Button type="button" variant="ghost" size="icon" className="size-6 shrink-0" aria-label={t('decks.build.queue.remove')} onClick={onRemove}><X aria-hidden /></Button>
      )}
      <Badge variant={item.status === 'failed' ? 'destructive' : item.status === 'applied' ? 'secondary' : 'outline'} className="shrink-0">
        {item.status === 'applying' && <Spinner className="size-3" aria-hidden />}
        {t(`decks.build.queue.${item.status}`)}
      </Badge>
    </li>
  );
}
