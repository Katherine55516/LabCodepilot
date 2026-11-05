'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Copy, DotsThree, FolderOpen, Plus, Sparkle, Trash } from '@/components/ui/icon';
import type { Card, DeckStatus, DeckSummary } from '@/lib/decks/types';
import { decksApi, mediaUrl } from '@/lib/decks/client';
import { getTheme } from '@/lib/decks/themes';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { ErrorBanner } from '@/components/ui/error-banner';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { CardView } from '@/components/decks/CardView';
import { useDecksT } from '@/components/decks/i18n';
import { errorMessage, intlLocale, relativeTime } from '@/components/decks/create/options';
import { useTranslation } from '@/hooks/useTranslation';

const THUMB_WIDTH = 248;
const IN_PROGRESS: DeckStatus[] = ['outlining', 'generating'];
const EMPTY_CARD: Card = { id: 'empty', blocks: [], layout: { accent: 'none', align: 'left' }, hidden: false, notes: '', stage: 'queued' };

export default function DecksPage() {
  const t = useDecksT();
  const [decks, setDecks] = useState<DeckSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<DeckSummary | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await decksApi.list();
      setDecks(result.decks);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Keep tiles of decks still planning/building fresh.
  const anyInProgress = useMemo(() => decks?.some(deck => IN_PROGRESS.includes(deck.status)) ?? false, [decks]);
  useEffect(() => {
    if (!anyInProgress) return;
    const timer = setInterval(() => { void load(); }, 4000);
    return () => clearInterval(timer);
  }, [anyInProgress, load]);

  const duplicate = async (deck: DeckSummary) => {
    setBusyId(deck.id);
    setActionError(null);
    try { await decksApi.duplicate(deck.id); await load(); } catch (e) { setActionError(errorMessage(e)); } finally { setBusyId(null); }
  };
  const remove = async (deck: DeckSummary) => {
    setBusyId(deck.id);
    setActionError(null);
    try {
      await decksApi.remove(deck.id);
      setDecks(list => list?.filter(d => d.id !== deck.id) ?? list);
    } catch (e) { setActionError(errorMessage(e)); } finally { setBusyId(null); }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border/50 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="text-base font-semibold">{t('decks.title')}</h1>
          <Badge variant="secondary">{t('decks.beta')}</Badge>
        </div>
        <Button asChild size="sm">
          <Link href="/decks/new"><Plus aria-hidden />{t('decks.list.new')}</Link>
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-5 sm:px-6">
          {actionError && <ErrorBanner message={t('decks.list.actionFailed')} description={actionError} onDismiss={() => setActionError(null)} />}
          {decks === null && !error && (
            <div className="flex items-center justify-center gap-2 py-20 text-sm text-muted-foreground"><Spinner />{t('decks.loading')}</div>
          )}
          {decks === null && error && (
            <ErrorBanner message={t('decks.list.loadFailed')} description={error} actions={[{ label: t('decks.retry'), onClick: () => void load() }]} />
          )}
          {decks !== null && (
            <>
              {error && <ErrorBanner message={t('decks.list.loadFailed')} description={error} actions={[{ label: t('decks.retry'), onClick: () => void load() }]} />}
              {decks.length === 0 ? <EmptyState /> : (
                <ul className="grid grid-cols-[repeat(auto-fill,minmax(272px,1fr))] gap-4">
                  <li><NewDeckTile /></li>
                  {decks.map(deck => (
                    <li key={deck.id}>
                      <DeckTile deck={deck} busy={busyId === deck.id} onDuplicate={() => void duplicate(deck)} onDelete={() => setConfirm(deck)} />
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>

      <AlertDialog open={confirm !== null} onOpenChange={open => { if (!open) setConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('decks.list.deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('decks.list.deleteBody', { title: confirm?.title || t('decks.list.untitled') })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('decks.cancel')}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => { if (confirm) void remove(confirm); setConfirm(null); }}>{t('decks.delete')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function NewDeckTile() {
  const t = useDecksT();
  return (
    <Link
      href="/decks/new"
      className="flex h-full min-h-[220px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground outline-none transition-colors hover:border-foreground/30 hover:bg-accent/40 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <span className="flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground"><Plus size={20} aria-hidden /></span>
      <span className="font-medium text-foreground">{t('decks.list.new')}</span>
      <span className="text-xs">{t('decks.list.newHint')}</span>
    </Link>
  );
}

function EmptyState() {
  const t = useDecksT();
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border px-6 py-16 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground"><Sparkle size={24} aria-hidden /></span>
      <h2 className="text-base font-semibold">{t('decks.list.emptyTitle')}</h2>
      <p className="max-w-md text-sm text-muted-foreground">{t('decks.list.emptyBody')}</p>
      <Button asChild><Link href="/decks/new"><Plus aria-hidden />{t('decks.list.new')}</Link></Button>
    </div>
  );
}

function DeckTile({ deck, busy, onDuplicate, onDelete }: { deck: DeckSummary; busy: boolean; onDuplicate: () => void; onDelete: () => void }) {
  const t = useDecksT();
  const router = useRouter();
  const { locale } = useTranslation();
  const theme = getTheme(deck.themeId);
  const title = deck.title || t('decks.list.untitled');
  const href = `/decks/${deck.id}`;
  const inProgress = IN_PROGRESS.includes(deck.status);
  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-xl border border-border/70 bg-card transition-colors hover:border-foreground/30">
      <Link href={href} aria-label={t('decks.list.open', { title })} className="flex justify-center bg-muted/50 p-3 outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50">
        <CardView
          card={deck.firstCard ?? EMPTY_CARD}
          theme={theme}
          dimensions={deck.dimensions || '16x9'}
          mediaUrl={mediaUrl}
          width={THUMB_WIDTH}
          pending={!deck.firstCard}
          className="pointer-events-none shadow-sm"
        />
      </Link>
      <div className="flex min-w-0 flex-1 items-start gap-2 p-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <Link href={href} className="truncate text-sm font-medium outline-none hover:underline focus-visible:underline">{title}</Link>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <Badge variant={deck.status === 'failed' ? 'destructive' : deck.status === 'ready' ? 'secondary' : 'outline'}>
              {inProgress && <Spinner className="size-3" aria-hidden />}
              {t(`decks.status.${deck.status}`)}
            </Badge>
            <span className="tabular-nums">{t('decks.cards', { n: deck.cardCount })}</span>
            <time dateTime={deck.updatedAt} title={new Date(deck.updatedAt).toLocaleString(intlLocale(locale))}>{relativeTime(deck.updatedAt, locale)}</time>
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={t('decks.list.actions', { title })} disabled={busy} className="shrink-0">
              {busy ? <Spinner /> : <DotsThree weight="bold" />}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => router.push(href)}><FolderOpen />{t('decks.list.openAction')}</DropdownMenuItem>
            <DropdownMenuItem onSelect={onDuplicate}><Copy />{t('decks.list.duplicate')}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onDelete}><Trash />{t('decks.delete')}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </article>
  );
}
