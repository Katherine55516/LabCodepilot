'use client';

import Link from 'next/link';
import { ArrowLeft, CheckCircle, ClockCounterClockwise, CloudArrowUp, Palette, Play, Rows, WarningCircle } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Spinner } from '@/components/ui/spinner';
import { ThemePicker } from '../ThemePicker';
import { useDecksT } from '../i18n';
import type { SaveStatus } from './useDeckSaver';
import type { DeckTheme } from '@/lib/decks/types';

export interface TopBarProps {
  title: string;
  onTitle: (title: string) => void;
  status: SaveStatus;
  saveError: string | null;
  onReload: () => void;
  onRetry: () => void;
  themeId: string;
  onTheme: (id: string) => void;
  /** Themes beyond the built-ins (an imported template's theme). */
  extraThemes?: DeckTheme[];
  onOpenHeaderFooter: () => void;
  onOpenHistory: () => void;
  onPresent: () => void;
  exportMenu: React.ReactNode;
}

function SaveIndicator({ status, saveError, onReload, onRetry }: Pick<TopBarProps, 'status' | 'saveError' | 'onReload' | 'onRetry'>) {
  const t = useDecksT();
  if (status === 'conflict') {
    return (
      <span className="flex items-center gap-1.5 text-xs text-destructive" role="status">
        <WarningCircle size={14} />
        <span className="hidden sm:inline">{t('decks.editor.save.conflict')}</span>
        <Button size="xs" variant="outline" onClick={onReload}>{t('decks.editor.save.reload')}</Button>
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span className="flex items-center gap-1.5 text-xs text-destructive" role="status" title={saveError ?? undefined}>
        <WarningCircle size={14} />
        <span className="hidden sm:inline">{t('decks.editor.save.error')}</span>
        <Button size="xs" variant="outline" onClick={onRetry}>{t('decks.retry')}</Button>
      </span>
    );
  }
  const label = status === 'saving' ? t('decks.editor.save.saving') : status === 'pending' ? t('decks.editor.save.pending') : t('decks.editor.save.saved');
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status" aria-live="polite">
      {status === 'saving' ? <Spinner className="size-3.5" /> : status === 'pending' ? <CloudArrowUp size={14} /> : <CheckCircle size={14} />}
      <span className="hidden sm:inline">{label}</span>
    </span>
  );
}

export function TopBar(props: TopBarProps) {
  const t = useDecksT();
  return (
    <header className="flex h-12 shrink-0 items-center gap-1 border-b px-2 sm:gap-2 sm:px-3">
      <Button asChild variant="ghost" size="icon-sm" aria-label={t('decks.editor.back')} title={t('decks.editor.back')}>
        <Link href="/decks"><ArrowLeft size={16} /></Link>
      </Button>
      <Input
        value={props.title}
        onChange={e => props.onTitle(e.target.value)}
        aria-label={t('decks.editor.deckTitle')}
        placeholder={t('decks.editor.untitled')}
        className="h-8 min-w-0 max-w-xs flex-1 border-transparent bg-transparent px-2 font-medium shadow-none hover:border-input focus-visible:border-input dark:bg-transparent"
      />
      <SaveIndicator status={props.status} saveError={props.saveError} onReload={props.onReload} onRetry={props.onRetry} />
      <div className="ml-auto flex items-center gap-0.5 sm:gap-1">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" aria-label={t('decks.editor.theme')} title={t('decks.editor.theme')}>
              <Palette size={16} /><span className="hidden lg:inline">{t('decks.editor.theme')}</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="max-h-[70vh] w-[min(92vw,420px)] overflow-y-auto">
            <ThemePicker extra={props.extraThemes} value={props.themeId} onChange={props.onTheme} />
          </PopoverContent>
        </Popover>
        <Button variant="ghost" size="sm" onClick={props.onOpenHeaderFooter} aria-label={t('decks.editor.headerFooter')} title={t('decks.editor.headerFooter')}>
          <Rows size={16} /><span className="hidden lg:inline">{t('decks.editor.headerFooter')}</span>
        </Button>
        <Button variant="ghost" size="sm" onClick={props.onOpenHistory} aria-label={t('decks.editor.history')} title={t('decks.editor.history')}>
          <ClockCounterClockwise size={16} /><span className="hidden lg:inline">{t('decks.editor.history')}</span>
        </Button>
        {props.exportMenu}
        <Button size="sm" onClick={props.onPresent} aria-label={t('decks.editor.present')} title={t('decks.editor.present')}>
          <Play size={16} weight="fill" /><span className="hidden sm:inline">{t('decks.editor.present')}</span>
        </Button>
      </div>
    </header>
  );
}
