'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkle } from '@phosphor-icons/react';
import { ErrorBanner } from '@/components/ui/error-banner';
import { decksApi } from '@/lib/decks/client';
import { getTheme } from '@/lib/decks/themes';
import type { DeckResponse, MediaItem } from '@/lib/decks/types';
import { useDecksT } from '../i18n';
import { AiPanel } from './AiPanel';
import type { BlockAction } from './BlockToolbar';
import { Canvas } from './Canvas';
import { CardPanel } from './CardPanel';
import { ExportMenu } from './ExportMenu';
import { Filmstrip } from './Filmstrip';
import { HeaderFooterDialog } from './HeaderFooterDialog';
import { HistoryDialog } from './HistoryDialog';
import { BlockInspector } from './inspector/BlockInspector';
import { isTypingTarget, useIsMobile } from './hooks';
import { LayoutPanel } from './LayoutPanel';
import { SidePanel } from './SidePanel';
import { TopBar } from './TopBar';
import type { PanelTab, RunAction } from './types';
import { useEditorState } from './useEditorState';

export interface DeckEditorProps {
  deckId: string;
  data: DeckResponse;
  refresh: () => void;
  setData: (d: DeckResponse) => void;
}

/** Card editor: filmstrip, canvas, Layout / Card / AI panel, top bar (report 06 §3–4). */
export function DeckEditor({ deckId, data, refresh, setData }: DeckEditorProps) {
  const t = useDecksT();
  const router = useRouter();
  const mobile = useIsMobile();
  const s = useEditorState(deckId, data, setData);
  const { deck, draft, cards, card, cardIndex, selectedBlock, saver } = s;
  const [tab, setTab] = useState<PanelTab>('layout');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [focusToken, setFocusToken] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'hf' | 'history' | null>(null);

  const theme = getTheme(draft.themeId);
  const dimensions = deck.settings.dimensions;
  const visible = cards.filter(c => !c.hidden);
  const job = data.job;
  const jobActive = !!job && (job.status === 'pending' || job.status === 'running');
  const editRunning = jobActive && job?.kind === 'edit';
  const exportDeck = { ...deck, title: draft.title, cards, headerFooter: draft.headerFooter, settings: { ...deck.settings, themeId: draft.themeId } };

  const runAction: RunAction = async (key, fn) => {
    setBusy(key);
    setActionError(null);
    try {
      if (!(await saver.flush())) throw new Error(t('decks.editor.save.flushFailed'));
      const result = await fn();
      if (result) {
        const current = s.dataRef.current;
        const next: DeckResponse = {
          ...current,
          ...(result.deck ? { deck: result.deck } : {}),
          ...(result.job ? { job: result.job } : {}),
          ...(result.proposals ? { proposals: result.proposals } : {}),
          media: result.media ? [...(current.media ?? []), result.media] : current.media,
        };
        s.dataRef.current = next;
        setData(next);
      }
      return true;
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const openTab = (next: PanelTab) => { setTab(next); if (mobile) setSheetOpen(true); };
  const onBlockAction = (action: BlockAction) => {
    if (action === 'inspect') { openTab('block'); return; }
    if (action !== 'askAi') { s.blockAction(action); return; }
    s.setScopeKind('block');
    openTab('ai');
    setFocusToken(n => n + 1);
  };

  /** A freshly uploaded image joins the deck's media list (for the image picker) without a refetch. */
  const addMedia = (media: MediaItem) => {
    const current = s.dataRef.current;
    const next: DeckResponse = { ...current, media: [...(current.media ?? []), media] };
    s.dataRef.current = next;
    setData(next);
  };

  const restore = async (version: number) => {
    let failure: string | null = null;
    const ok = await runAction('restore', async () => {
      try { return { deck: (await decksApi.restore(deckId, version)).deck }; } catch (e) { failure = e instanceof Error ? e.message : String(e); throw e; }
    });
    // Show the restored copy even if the server numbers it below the version on screen.
    if (ok) { s.discardLocal(); refresh(); }
    return ok ? null : failure ?? t('decks.error');
  };

  const present = async () => { await saver.flush(); router.push(`/decks/${deckId}/present`); };

  // Keyboard: ↑/↓ and PageUp/PageDown switch cards, Delete removes the selected block, Esc deselects.
  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    keyHandler.current = e => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || dialog || isTypingTarget(e.target)) return;
      // The side panel's forms (block inspector) own their keys: Backspace on a focused button must not delete the block.
      if (e.target instanceof HTMLElement && e.target.closest('[role="menu"],[role="dialog"],[role="listbox"],[role="tablist"],[role="radiogroup"],[role="toolbar"],[data-decks-side-panel]')) return;
      if (e.key === 'ArrowUp' || e.key === 'PageUp') { e.preventDefault(); s.goToCard(-1); }
      else if (e.key === 'ArrowDown' || e.key === 'PageDown') { e.preventDefault(); s.goToCard(1); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedBlock && !editRunning) { e.preventDefault(); s.blockAction('delete'); }
      else if (e.key === 'Escape' && selectedBlock) s.selectBlock(null);
    };
  });
  useEffect(() => {
    const handler = (e: KeyboardEvent) => keyHandler.current(e);
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const panelContent: Record<PanelTab, React.ReactNode> = {
    layout: card
      ? <LayoutPanel deckId={deckId} card={card} theme={theme} dimensions={dimensions} onLayout={s.setLayout} onApplySuggestion={s.applyCard} runAction={runAction} busy={busy} />
      : <p className="text-sm text-muted-foreground">{t('decks.editor.noCards')}</p>,
    card: card
      ? <CardPanel card={card} onChange={s.setCardFields} />
      : <p className="text-sm text-muted-foreground">{t('decks.editor.noCards')}</p>,
    block: (
      <BlockInspector deckId={deckId} block={selectedBlock} media={data.media ?? []} disabled={editRunning}
        onChange={next => s.changeBlock(next.id, next)} onMediaAdded={addMedia} />
    ),
    ai: (
      <AiPanel
        deckId={deckId} deckTitle={draft.title} cards={cards} card={card} cardIndex={cardIndex} block={selectedBlock}
        scopeKind={s.scopeKind} onScopeKind={s.setScopeKind} job={job} proposals={data.proposals ?? []}
        theme={theme} dimensions={dimensions} runAction={runAction} busy={busy} refresh={refresh} focusToken={focusToken}
      />
    ),
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-background">
      <TopBar
        title={draft.title} onTitle={s.setTitle}
        status={saver.status} saveError={saver.error}
        onReload={() => { s.discardLocal(); refresh(); }} onRetry={() => { void saver.flush(); }}
        themeId={draft.themeId} onTheme={s.setTheme}
        onOpenHeaderFooter={() => setDialog('hf')} onOpenHistory={() => setDialog('history')}
        onPresent={() => { void present(); }}
        exportMenu={<ExportMenu deck={exportDeck} theme={theme} flush={saver.flush} onError={setActionError} />}
      />
      {saver.status === 'conflict' && (
        <ErrorBanner className="mx-3 mt-2" message={t('decks.editor.save.conflict')} description={t('decks.editor.save.conflictHint')}
          actions={[{ label: t('decks.editor.save.reload'), onClick: () => { s.discardLocal(); refresh(); } }]} />
      )}
      {actionError && <ErrorBanner className="mx-3 mt-2" message={t('decks.error')} description={actionError} onDismiss={() => setActionError(null)} />}
      {jobActive && job?.kind !== 'edit' && (
        <div className="mx-3 mt-2 flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-1.5 text-xs" role="status">
          <Sparkle size={14} className="animate-pulse text-primary" />
          {t('decks.editor.generating', { percent: job?.progress.percent ?? 0 })}
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <Filmstrip
          cards={cards} selectedId={card?.id} theme={theme} dimensions={dimensions} horizontal={mobile}
          onSelect={s.selectCard} onAction={s.cardAction} onMove={s.moveCard} onAdd={s.addCard}
        />
        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-muted/20" aria-label={t('decks.editor.canvas')}>
          <Canvas
            card={card} index={cardIndex} total={cards.length}
            visibleNumber={card && !card.hidden ? visible.indexOf(card) + 1 : undefined} visibleCount={visible.length}
            theme={theme} dimensions={dimensions} headerFooter={draft.headerFooter} deckTitle={draft.title}
            selectedBlock={selectedBlock} onSelectBlock={s.selectBlock} onChangeBlock={s.changeBlock}
            onBlockAction={onBlockAction} onInsert={s.insert} onAddCard={s.addCard} aiBusy={editRunning}
          />
        </main>
        <SidePanel tab={tab} onTab={setTab} content={panelContent} mobile={mobile} sheetOpen={sheetOpen} onSheetOpen={setSheetOpen} />
      </div>
      <HeaderFooterDialog deckId={deckId} onMediaAdded={addMedia} open={dialog === 'hf'} onOpenChange={open => setDialog(open ? 'hf' : null)} value={draft.headerFooter} onSave={s.setHeaderFooter} />
      <HistoryDialog deckId={deckId} currentVersion={deck.version} open={dialog === 'history'} onOpenChange={open => setDialog(open ? 'history' : null)} onRestore={restore} />
    </div>
  );
}
