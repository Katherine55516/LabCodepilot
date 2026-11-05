'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { ArrowsIn, ArrowsOut, CaretLeft, CaretRight, Note, X } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { decksApi, mediaUrl } from '@/lib/decks/client';
import { deckTheme } from '@/lib/decks/themes';
import { DIMENSION_RATIO, type DeckResponse } from '@/lib/decks/types';
import { CardView } from '../CardView';
import { useDecksT } from '../i18n';
import { useMounted, useViewport } from './hooks';

const NOTES_HEIGHT = 160;

/** Fullscreen present mode: visible cards only, fit to the viewport, keyboard and click navigation. */
export function PresentView({ deckId }: { deckId: string }) {
  const t = useDecksT();
  const router = useRouter();
  const mounted = useMounted();
  const viewport = useViewport();
  const [data, setData] = useState<DeckResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [notes, setNotes] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  const load = useCallback(() => {
    decksApi.get(deckId).then(setData).catch(e => setError(e instanceof Error ? e.message : String(e)));
  }, [deckId]);
  useEffect(() => { load(); }, [load]);

  const cards = data?.deck.cards.filter(c => !c.hidden) ?? [];
  const current = Math.min(index, Math.max(0, cards.length - 1));
  const go = (delta: number) => setIndex(i => Math.max(0, Math.min(cards.length - 1, Math.min(i, cards.length - 1) + delta)));
  const exit = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    router.push(`/decks/${deckId}`);
  }, [deckId, router]);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void document.documentElement.requestFullscreen?.().catch(() => {});
  };

  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    // Navigation from the Present button usually still carries user activation.
    void document.documentElement.requestFullscreen?.().catch(() => {});
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    keyHandler.current = e => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key;
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(key)) { e.preventDefault(); go(1); }
      else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(key)) { e.preventDefault(); go(-1); }
      else if (key === 'Home') setIndex(0);
      else if (key === 'End') setIndex(Math.max(0, cards.length - 1));
      else if (key === 'n' || key === 'N') setNotes(v => !v);
      else if (key === 'f' || key === 'F') toggleFullscreen();
      else if (key === 'Escape') exit();
    };
  });
  useEffect(() => {
    const handler = (e: KeyboardEvent) => keyHandler.current(e);
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  if (!mounted) return null;
  const deck = data?.deck;
  const card = cards[current];
  const ratio = deck ? DIMENSION_RATIO[deck.settings.dimensions] : null;
  const availableHeight = viewport.height - (notes ? NOTES_HEIGHT : 0);
  const width = ratio ? Math.floor(Math.min(viewport.width, availableHeight * ratio)) : Math.min(viewport.width, 1600);

  const body = (
    <div className="fixed inset-0 z-[200] flex flex-col bg-black text-white" role="dialog" aria-modal="true" aria-label={t('decks.editor.present.label')}>
      {!deck && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-sm">
          {error
            ? <><p>{t('decks.error')}: {error}</p><Button variant="secondary" size="sm" onClick={() => { setError(null); load(); }}>{t('decks.retry')}</Button></>
            : <><Spinner className="size-5" />{t('decks.loading')}</>}
        </div>
      )}
      {deck && !card && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-sm">
          <p>{t('decks.editor.present.empty')}</p>
          <Button variant="secondary" size="sm" onClick={exit}>{t('decks.editor.present.exit')}</Button>
        </div>
      )}
      {deck && card && (
        <div className={ratio ? 'flex min-h-0 flex-1 items-center justify-center overflow-hidden' : 'min-h-0 flex-1 overflow-y-auto'} onClick={() => go(1)}>
          <div className={ratio ? undefined : 'mx-auto'} style={{ width }}>
            <CardView
              key={card.id} card={card} theme={deckTheme(deck)} dimensions={deck.settings.dimensions} mediaUrl={mediaUrl} width={width}
              cardNumber={current + 1} cardCount={cards.length} headerFooter={deck.headerFooter} deckTitle={deck.title}
            />
          </div>
        </div>
      )}
      {deck && card && notes && (
        <aside className="shrink-0 overflow-y-auto border-t border-white/15 bg-neutral-900 px-6 py-3 text-sm leading-relaxed whitespace-pre-wrap" style={{ height: NOTES_HEIGHT }} aria-label={t('decks.editor.card.notes')}>
          {card.notes || <span className="text-white/50">{t('decks.editor.present.noNotes')}</span>}
        </aside>
      )}
      {deck && card && (
        <>
          <div className="absolute top-3 right-3 flex gap-1 opacity-30 transition-opacity hover:opacity-100 focus-within:opacity-100">
            <Button variant="secondary" size="icon-sm" onClick={() => go(-1)} disabled={current === 0} aria-label={t('decks.editor.present.prev')} title={t('decks.editor.present.prev')}><CaretLeft size={16} /></Button>
            <Button variant="secondary" size="icon-sm" onClick={() => go(1)} disabled={current >= cards.length - 1} aria-label={t('decks.editor.present.next')} title={t('decks.editor.present.next')}><CaretRight size={16} /></Button>
            <Button variant="secondary" size="icon-sm" onClick={() => setNotes(v => !v)} aria-pressed={notes} aria-label={t('decks.editor.present.notes')} title={t('decks.editor.present.notes')}><Note size={16} /></Button>
            <Button variant="secondary" size="icon-sm" onClick={toggleFullscreen} aria-label={t('decks.editor.present.fullscreen')} title={t('decks.editor.present.fullscreen')}>
              {fullscreen ? <ArrowsIn size={16} /> : <ArrowsOut size={16} />}
            </Button>
            <Button variant="secondary" size="icon-sm" onClick={exit} aria-label={t('decks.editor.present.exit')} title={t('decks.editor.present.exit')}><X size={16} /></Button>
          </div>
          <div className="pointer-events-none absolute bottom-0 left-0 right-0" style={{ bottom: notes ? NOTES_HEIGHT : 0 }}>
            <span className="absolute right-3 bottom-2 rounded bg-black/50 px-2 py-0.5 text-xs tabular-nums text-white/80" aria-live="polite">
              {t('decks.editor.present.progress', { n: current + 1, total: cards.length })}
            </span>
            <div className="h-1 bg-white/10" role="progressbar" aria-valuemin={1} aria-valuemax={cards.length} aria-valuenow={current + 1}>
              <div className="h-full bg-white/70 transition-[width] duration-300" style={{ width: `${((current + 1) / cards.length) * 100}%` }} />
            </div>
          </div>
        </>
      )}
    </div>
  );
  return createPortal(body, document.body);
}
