'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Warning, X } from '@/components/ui/icon';
import type { Deck, DeckWarning } from '@/lib/decks/types';
import { decksApi, useDeckLive } from '@/lib/decks/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { ErrorBanner } from '@/components/ui/error-banner';
import { useDecksT } from '@/components/decks/i18n';
import { OutlineView } from '@/components/decks/outline/OutlineView';
import { GenerationView } from '@/components/decks/generation/GenerationView';
import { DeckEditor } from '@/components/decks/editor/DeckEditor';

/** Routes a deck by status: plan streaming → plan review → live build → editor. */
export default function DeckPage() {
  const t = useDecksT();
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const { data, error, refresh, setData } = useDeckLive(id || null);
  const current = data && data.deck.id === id ? data : null;

  if (!current) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
        {error ? (
          <>
            <ErrorBanner message={t('decks.deck.loadFailed')} description={error} actions={[{ label: t('decks.retry'), onClick: refresh }]} className="w-full max-w-md text-left" />
            <Button asChild variant="ghost" size="sm"><Link href="/decks"><ArrowLeft aria-hidden />{t('decks.deck.back')}</Link></Button>
          </>
        ) : (
          <span className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner />{t('decks.loading')}</span>
        )}
      </div>
    );
  }

  const { deck } = current;
  const notices = <DeckNotices deck={deck} liveError={error} onRetry={refresh} />;

  if (deck.status === 'ready' || (deck.status === 'failed' && deck.cards.length > 0)) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        {notices}
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <DeckEditor deckId={id} data={current} refresh={refresh} setData={setData} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex shrink-0 items-center gap-2 border-b border-border/50 px-4 py-2.5 sm:px-6">
        <Button asChild variant="ghost" size="icon-sm" aria-label={t('decks.deck.back')}>
          <Link href="/decks"><ArrowLeft /></Link>
        </Button>
        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold">{deck.title || t('decks.list.untitled')}</h1>
        <Badge variant={deck.status === 'failed' ? 'destructive' : 'outline'} className="shrink-0">
          {(deck.status === 'outlining' || deck.status === 'generating') && <Spinner className="size-3" aria-hidden />}
          {t(`decks.status.${deck.status}`)}
        </Badge>
      </header>
      {notices}
      <div className="min-h-0 flex-1 overflow-hidden">
        {deck.status === 'outlining' && <OutlineView key="streaming" deckId={id} data={current} streaming refresh={refresh} />}
        {deck.status === 'outline_ready' && <OutlineView key="ready" deckId={id} data={current} streaming={false} refresh={refresh} />}
        {deck.status === 'generating' && <GenerationView deckId={id} data={current} setData={setData} />}
        {deck.status === 'failed' && (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
            <p className="max-w-md text-sm text-muted-foreground">{t('decks.deck.failedEmpty')}</p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button size="sm" onClick={async () => { try { await (deck.outline.length ? decksApi.generate(id) : decksApi.replan(id, {})); refresh(); } catch { refresh(); } }}>{t('decks.deck.retry')}</Button>
              <Button asChild variant="outline" size="sm"><Link href="/decks/new">{t('decks.deck.startOver')}</Link></Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const warningKey = (warning: DeckWarning) => `${warning.code}:${warning.message}`;

/** Deck error (on failure), request-level warnings (dismissible) and a live-update error. */
function DeckNotices({ deck, liveError, onRetry }: { deck: Deck; liveError: string | null; onRetry: () => void }) {
  const t = useDecksT();
  const [dismissed, setDismissed] = useState<string[]>([]);
  const warnings = deck.warnings.filter(warning => !dismissed.includes(warningKey(warning)));
  const showError = deck.status === 'failed';
  if (!showError && warnings.length === 0 && !liveError) return null;
  return (
    <div className="flex shrink-0 flex-col gap-2 border-b border-border/50 px-4 py-2 sm:px-6" aria-live="polite">
      {showError && <ErrorBanner message={t('decks.deck.failed')} description={deck.error || t('decks.error')} />}
      {liveError && <ErrorBanner message={t('decks.deck.liveError')} description={liveError} actions={[{ label: t('decks.retry'), onClick: onRetry }]} />}
      {warnings.map(warning => (
        <div key={warningKey(warning)} role="status" className="flex items-start gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm">
          <Warning size={16} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="break-words">{warning.message}</p>
            <p className="font-mono text-[11px] text-muted-foreground">{warning.code}</p>
          </div>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t('decks.deck.dismiss')}
            onClick={() => setDismissed(list => [...list, warningKey(warning)])}
            className="shrink-0"
          >
            <X />
          </Button>
        </div>
      ))}
    </div>
  );
}
