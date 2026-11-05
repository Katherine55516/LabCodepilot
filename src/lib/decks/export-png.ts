'use client';

/**
 * Client-only PNG export: each visible card is rendered off-screen at 1600 px
 * with the same CardView the editor uses, captured with html-to-image and
 * zipped as card-01.png, card-02.png, … (report 06 §6: PNG export per card).
 */
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { toPng } from 'html-to-image';
import JSZip from 'jszip';
import { CardView } from '@/components/decks/CardView';
import type { Deck, DeckTheme } from './types';

export const PNG_EXPORT_WIDTH = 1600;

const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

async function waitForImages(root: HTMLElement) {
  const images = Array.from(root.querySelectorAll('img'));
  await Promise.all(images.map(img => (img.complete && img.naturalWidth > 0)
    ? Promise.resolve()
    : new Promise<void>(resolve => {
      const done = () => resolve();
      img.addEventListener('load', done, { once: true });
      img.addEventListener('error', done, { once: true });
      setTimeout(done, 8000);
    })));
}

export async function exportDeckPng(
  deck: Deck,
  theme: DeckTheme,
  mediaUrl: (mediaId: string) => string,
  onProgress?: (done: number, total: number) => void,
): Promise<Blob> {
  const cards = deck.cards.filter(card => !card.hidden);
  const zip = new JSZip();
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  Object.assign(host.style, { position: 'fixed', left: '-20000px', top: '0', width: `${PNG_EXPORT_WIDTH}px`, pointerEvents: 'none', zIndex: '-1' });
  document.body.appendChild(host);
  try {
    onProgress?.(0, cards.length);
    for (const [index, card] of cards.entries()) {
      const slot = document.createElement('div');
      host.appendChild(slot);
      const root = createRoot(slot);
      try {
        flushSync(() => root.render(createElement(CardView, {
          card, theme, mediaUrl, dimensions: deck.settings.dimensions, width: PNG_EXPORT_WIDTH,
          cardNumber: index + 1, cardCount: cards.length, headerFooter: deck.headerFooter, deckTitle: deck.title,
        })));
        // Committed synchronously; two frames let fluid cards measure their height.
        await nextFrame();
        await nextFrame();
        await waitForImages(slot);
        await nextFrame();
        const node = slot.firstElementChild as HTMLElement | null;
        if (!node) throw new Error(`Card ${index + 1} did not render`);
        // Theme fonts are system stacks, so font embedding is skipped (faster, avoids cross-origin CSS reads).
        const dataUrl = await toPng(node, { pixelRatio: 1, skipFonts: true, backgroundColor: theme.colors.background, width: node.offsetWidth, height: node.offsetHeight });
        zip.file(`card-${String(index + 1).padStart(2, '0')}.png`, dataUrl.slice(dataUrl.indexOf(',') + 1), { base64: true });
      } finally {
        root.unmount();
        slot.remove();
      }
      onProgress?.(index + 1, cards.length);
    }
    return await zip.generateAsync({ type: 'blob', mimeType: 'application/zip' });
  } finally {
    host.remove();
  }
}
