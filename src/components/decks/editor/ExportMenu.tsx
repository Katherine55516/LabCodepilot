'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { DownloadSimple, FileImage, FilePdf, PresentationChart } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Spinner } from '@/components/ui/spinner';
import { exportUrl, mediaUrl } from '@/lib/decks/client';
import type { Deck, DeckTheme } from '@/lib/decks/types';
import { useDecksT } from '../i18n';
import { downloadFile, safeFilename } from './hooks';

interface ExportMenuProps {
  deck: Deck;
  theme: DeckTheme;
  /** Saves pending edits first so the export reflects the canvas. */
  flush: () => Promise<boolean>;
  onError: (message: string) => void;
}

export function ExportMenu({ deck, theme, flush, onError }: ExportMenuProps) {
  const t = useDecksT();
  const router = useRouter();
  const [png, setPng] = useState<{ done: number; total: number } | null>(null);
  const [preparing, setPreparing] = useState(false);

  const withSave = async (fn: () => void | Promise<void>) => {
    setPreparing(true);
    try {
      if (!(await flush())) { onError(t('decks.editor.save.flushFailed')); return; }
      await fn();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setPreparing(false);
    }
  };

  const exportPptx = () => withSave(() => downloadFile(exportUrl(deck.id, 'pptx'), `${safeFilename(deck.title)}.pptx`));
  // In-app navigation: the desktop shell denies window.open, and the print page links back.
  const exportPdf = () => withSave(() => router.push(`/decks/${deck.id}/print`));
  const exportPng = () => withSave(async () => {
    setPng({ done: 0, total: deck.cards.filter(c => !c.hidden).length });
    try {
      const { exportDeckPng } = await import('@/lib/decks/export-png');
      const blob = await exportDeckPng(deck, theme, mediaUrl, (done, total) => setPng({ done, total }));
      downloadFile(blob, `${safeFilename(deck.title)}.zip`);
    } catch (e) {
      throw new Error(`${t('decks.editor.export.pngFailed')}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setPng(null);
    }
  });

  const busy = preparing || png !== null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" disabled={busy} aria-label={t('decks.editor.export')} title={t('decks.editor.export')}>
          {busy ? <Spinner className="size-4" /> : <DownloadSimple size={16} />}
          <span className={png ? 'tabular-nums' : 'hidden lg:inline'} aria-live="polite">
            {png ? t('decks.editor.export.pngProgress', { done: png.done, total: png.total }) : t('decks.editor.export')}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onSelect={() => { void exportPptx(); }}>
          <PresentationChart size={16} />{t('decks.editor.export.pptx')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => { void exportPdf(); }}>
          <FilePdf size={16} />{t('decks.editor.export.pdf')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => { void exportPng(); }}>
          <FileImage size={16} />{t('decks.editor.export.png')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
