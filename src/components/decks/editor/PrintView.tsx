'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { ArrowLeft, Printer } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { decksApi, mediaUrl } from '@/lib/decks/client';
import { deckTheme } from '@/lib/decks/themes';
import type { CardDimensions, DeckResponse } from '@/lib/decks/types';
import { CardView } from '../CardView';
import { useDecksT } from '../i18n';
import { useMounted } from './hooks';

/**
 * Page box per card format, in CSS px at 96 dpi. Fixed formats print one card
 * per page at exactly the card's size; fluid / pageless cards flow on A4 portrait.
 */
const PAGES: Record<CardDimensions, { size: string; width: number; height: number | null }> = {
  '16x9': { size: '13.333in 7.5in', width: 1280, height: 720 },
  '4x3': { size: '10in 7.5in', width: 960, height: 720 },
  '1x1': { size: '7.5in 7.5in', width: 720, height: 720 },
  '4x5': { size: '7.5in 9.375in', width: 720, height: 900 },
  '9x16': { size: '7.5in 13.333in', width: 720, height: 1280 },
  a4: { size: 'A4 portrait', width: 794, height: 1122 },
  letter: { size: 'letter portrait', width: 816, height: 1056 },
  fluid: { size: 'A4 portrait', width: 703, height: null },
  pageless: { size: 'A4 portrait', width: 703, height: null },
};

const printCss = (size: string, flow: boolean) => `
@page { size: ${size}; margin: ${flow ? '12mm' : '0'}; }
@media print {
  html, body { height: auto !important; overflow: visible !important; background: #fff !important; }
  body > *:not(#decks-print-root) { display: none !important; }
  #decks-print-root { position: static !important; inset: auto !important; overflow: visible !important; background: none !important; padding: 0 !important; }
  #decks-print-root .decks-print-chrome { display: none !important; }
  #decks-print-root .decks-print-list { gap: ${flow ? '16px' : '0'} !important; padding: 0 !important; }
  #decks-print-root .decks-print-page { box-shadow: none !important; border-radius: 0 !important; }
  #decks-print-root * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
}`;

async function waitForImages(root: HTMLElement) {
  const images = Array.from(root.querySelectorAll('img'));
  await Promise.all(images.map(img => (img.complete ? Promise.resolve() : new Promise<void>(resolve => {
    img.addEventListener('load', () => resolve(), { once: true });
    img.addEventListener('error', () => resolve(), { once: true });
    setTimeout(resolve, 10_000);
  }))));
  await document.fonts?.ready;
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

/** Print layout for "Save as PDF": every visible card, no app chrome, auto print once images load. */
export function PrintView({ deckId }: { deckId: string }) {
  const t = useDecksT();
  const mounted = useMounted();
  const [data, setData] = useState<DeckResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const printed = useRef(false);

  const load = useCallback(() => {
    decksApi.get(deckId).then(setData).catch(e => setError(e instanceof Error ? e.message : String(e)));
  }, [deckId]);
  useEffect(() => { load(); }, [load]);

  const hasDeck = !!data;
  useEffect(() => {
    if (!hasDeck || !mounted || !listRef.current) return;
    let cancelled = false;
    void waitForImages(listRef.current).then(() => {
      if (cancelled) return;
      setReady(true);
      if (!printed.current) { printed.current = true; window.print(); }
    });
    return () => { cancelled = true; };
  }, [hasDeck, mounted]);

  if (!mounted) return null;
  const deck = data?.deck;
  const cards = deck?.cards.filter(c => !c.hidden) ?? [];
  const page = PAGES[deck?.settings.dimensions ?? '16x9'];
  const flow = page.height === null;

  const body = (
    <div id="decks-print-root" className="fixed inset-0 z-[200] overflow-auto bg-muted">
      {deck && <style>{printCss(page.size, flow)}</style>}
      <div className="decks-print-chrome sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b bg-background/95 px-4 py-2 backdrop-blur">
        <Button asChild variant="ghost" size="sm"><Link href={`/decks/${deckId}`}><ArrowLeft size={16} />{t('decks.editor.print.back')}</Link></Button>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{deck?.title}</span>
        {deck && !ready && <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><Spinner className="size-3.5" />{t('decks.editor.print.preparing')}</span>}
        <Button size="sm" onClick={() => window.print()} disabled={!deck}><Printer size={16} />{t('decks.editor.print.button')}</Button>
      </div>
      {!deck && (
        <div className="decks-print-chrome flex flex-col items-center gap-3 p-10 text-sm text-muted-foreground">
          {error
            ? <><p>{t('decks.error')}: {error}</p><Button size="sm" variant="outline" onClick={() => { setError(null); load(); }}>{t('decks.retry')}</Button></>
            : <><Spinner className="size-5" />{t('decks.loading')}</>}
        </div>
      )}
      {deck && (
        <div ref={listRef} className="decks-print-list flex flex-col items-center gap-6 p-6">
          {cards.length === 0 && <p className="decks-print-chrome text-sm text-muted-foreground">{t('decks.editor.present.empty')}</p>}
          {cards.map((card, i) => (
            <div
              key={card.id}
              className="decks-print-page shrink-0 overflow-hidden bg-background shadow-md"
              style={{ width: page.width, height: page.height ?? undefined, breakAfter: !flow && i < cards.length - 1 ? 'page' : 'auto', breakInside: 'avoid' }}
            >
              <CardView
                card={card} theme={deckTheme(deck)} dimensions={deck.settings.dimensions} mediaUrl={mediaUrl} width={page.width}
                cardNumber={i + 1} cardCount={cards.length} headerFooter={deck.headerFooter} deckTitle={deck.title}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
  return createPortal(body, document.body);
}
