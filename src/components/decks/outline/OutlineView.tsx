'use client';

import { useState, type ReactNode } from 'react';
import { ArrowsMerge, Check, Plus, Sparkle, WarningCircle } from '@phosphor-icons/react';
import type { DeckResponse } from '@/lib/decks/types';
import { decksApi } from '@/lib/decks/client';
import { themeFor } from '@/lib/decks/themes';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { ErrorBanner } from '@/components/ui/error-banner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useDecksT } from '../i18n';
import { ThemePicker } from '../ThemePicker';
import { ImageSourceField } from '../create/SettingsPanel';
import { errorMessage } from '../create/options';
import { OutlineCardItem, OutlineCardPreview } from './OutlineCardItem';
import { RewriteOutlineDialog } from './RewriteOutlineDialog';
import { insertAfter, mergeWithNext, move, newOutlineCard, removeAt, updateAt } from './ops';
import { useOutlineDraft, type SaveState } from './useOutlineDraft';

interface OutlineViewProps {
  deckId: string;
  data: DeckResponse;
  /** True while the outline job is still writing the plan (read-only, skeletons). */
  streaming: boolean;
  refresh: () => void;
}

/**
 * Plan review (report 02 §5.1 "Plan", report 03 §3: the outline is the final
 * content). Mount a fresh instance when planning finishes: the editable draft
 * is initialised from `data.deck.outline` once.
 */
export function OutlineView(props: OutlineViewProps) {
  return props.streaming ? <StreamingOutline {...props} /> : <EditableOutline {...props} />;
}

function StreamingOutline({ data }: OutlineViewProps) {
  const t = useDecksT();
  const { deck, job } = data;
  return (
    <OutlineLayout
      header={
        <>
          <div className="flex min-w-0 items-center gap-2">
            <Spinner className="text-muted-foreground" />
            <h2 className="truncate text-base font-semibold">{t('decks.outline.writing')}</h2>
          </div>
          <span className="text-xs text-muted-foreground tabular-nums">
            {t('decks.outline.countTarget', { n: deck.outline.length, target: deck.settings.numCards })}
            {job && job.progress.percent > 0 ? ` · ${job.progress.percent}%` : ''}
          </span>
        </>
      }
      footer={<Button disabled className="w-full sm:w-auto"><Spinner />{t('decks.outline.waiting')}</Button>}
    >
      <ol aria-live="polite" className="flex flex-col gap-3">
        {deck.outline.map((card, i) => <li key={card.id}><OutlineCardPreview card={card} index={i} /></li>)}
        <li><OutlineCardPreview index={deck.outline.length} /></li>
      </ol>
    </OutlineLayout>
  );
}

function EditableOutline({ deckId, data, refresh }: OutlineViewProps) {
  const t = useDecksT();
  const { deck } = data;
  const draft = useOutlineDraft(deckId, deck.outline, { themeId: deck.settings.themeId, imageSource: deck.settings.imageSource });
  const { outline, look, updateOutline, updateLook, flush } = draft;
  const [focusId, setFocusId] = useState<string | null>(null);
  const [themeOpen, setThemeOpen] = useState(false);
  const [busy, setBusy] = useState<'generate' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const theme = themeFor(look.themeId, deck.template);
  const n = outline.length;
  const byBreaks = deck.settings.cardSplit === 'inputTextBreaks';
  const target = deck.settings.numCards;
  const offTarget = !byBreaks && Math.abs(n - target) > 2;

  const addAfter = (index: number) => {
    const card = newOutlineCard();
    setFocusId(card.id);
    updateOutline(insertAfter(outline, index, card));
  };
  const generate = async () => {
    setBusy('generate');
    setActionError(null);
    try {
      await flush();
      await decksApi.generate(deckId);
      refresh();
    } catch (e) {
      setActionError(errorMessage(e));
      setBusy(null);
    }
  };
  const replan = async (body: { instruction?: string; numCards?: number }) => {
    await flush();
    await decksApi.replan(deckId, body);
    refresh();
  };

  return (
    <OutlineLayout
      header={
        <>
          <div className="flex min-w-0 flex-col">
            <h2 className="truncate text-base font-semibold">{t('decks.outline.heading')}</h2>
            <span className={cn('text-xs tabular-nums', offTarget ? 'text-foreground' : 'text-muted-foreground')}>
              {byBreaks ? t('decks.outline.countSections', { n }) : t('decks.outline.countTarget', { n, target })}
              {offTarget && <span className="text-muted-foreground"> · {t('decks.outline.softTarget')}</span>}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Dialog open={themeOpen} onOpenChange={setThemeOpen}>
              <DialogTrigger asChild>
                <Button type="button" variant="outline" size="sm" aria-label={t('decks.outline.themeButton', { name: theme.name })}>
                  <span aria-hidden className="size-3.5 rounded-full border" style={{ background: `linear-gradient(135deg, ${theme.colors.background} 50%, ${theme.colors.accent} 50%)` }} />
                  {theme.name}
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-3xl">
                <DialogHeader><DialogTitle>{t('decks.theme.label')}</DialogTitle></DialogHeader>
                <ThemePicker extra={deck.template ? [deck.template.theme] : []} value={look.themeId} onChange={themeId => { updateLook({ themeId }); setThemeOpen(false); }} />
              </DialogContent>
            </Dialog>
            <ImageSourceField compact id="decks-outline-image-source" value={look.imageSource} onChange={imageSource => updateLook({ imageSource })} />
            <RewriteOutlineDialog currentCount={n} disabled={busy !== null} onSubmit={replan} />
          </div>
        </>
      }
      footer={
        <>
          <SaveStatus state={draft.saveState} />
          {draft.saveState === 'error' && draft.saveError && (
            <ErrorBanner message={t('decks.outline.saveFailed')} description={draft.saveError} actions={[{ label: t('decks.retry'), onClick: () => void flush().catch(() => {}) }]} className="sm:max-w-md" />
          )}
          {actionError && <ErrorBanner message={t('decks.outline.generateFailed')} description={actionError} onDismiss={() => setActionError(null)} className="sm:max-w-md" />}
          <Button type="button" onClick={() => void generate()} disabled={busy !== null || n === 0} className="w-full sm:ml-auto sm:w-auto">
            {busy === 'generate' ? <Spinner /> : <Sparkle weight="fill" aria-hidden />}
            {t('decks.outline.generate', { n })}
          </Button>
        </>
      }
    >
      {n === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          <p>{t('decks.outline.empty')}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => addAfter(-1)}><Plus aria-hidden />{t('decks.outline.addCard')}</Button>
        </div>
      ) : (
        <ol className="flex flex-col">
          {outline.map((card, i) => (
            <li key={card.id} className="flex flex-col">
              <OutlineCardItem
                card={card}
                index={i}
                total={n}
                autoFocus={card.id === focusId}
                onChange={patch => updateOutline(updateAt(outline, i, patch))}
                onRemove={() => updateOutline(removeAt(outline, i))}
                onMove={delta => updateOutline(move(outline, i, delta))}
              />
              <BetweenCards
                canMerge={i < n - 1}
                index={i}
                onAdd={() => addAfter(i)}
                onMerge={() => updateOutline(mergeWithNext(outline, i))}
              />
            </li>
          ))}
        </ol>
      )}
    </OutlineLayout>
  );
}

function BetweenCards({ index, canMerge, onAdd, onMerge }: { index: number; canMerge: boolean; onAdd: () => void; onMerge: () => void }) {
  const t = useDecksT();
  return (
    <div className="flex items-center justify-center gap-1 py-1.5">
      <Button type="button" variant="ghost" size="xs" onClick={onAdd} aria-label={t('decks.outline.addAfter', { n: index + 1 })} className="text-muted-foreground">
        <Plus aria-hidden />{t('decks.outline.addCard')}
      </Button>
      {canMerge && (
        <Button type="button" variant="ghost" size="xs" onClick={onMerge} aria-label={t('decks.outline.mergeLabel', { a: index + 1, b: index + 2 })} className="text-muted-foreground">
          <ArrowsMerge aria-hidden />{t('decks.outline.merge')}
        </Button>
      )}
    </div>
  );
}

function SaveStatus({ state }: { state: SaveState }) {
  const t = useDecksT();
  if (state === 'idle' || state === 'error') return null;
  return (
    <span role="status" className="flex items-center gap-1.5 text-xs text-muted-foreground">
      {state === 'saved' ? <Check aria-hidden /> : state === 'saving' ? <Spinner className="size-3" /> : <WarningCircle aria-hidden />}
      {t(`decks.outline.save.${state}`)}
    </span>
  );
}

function OutlineLayout({ header, footer, children }: { header: ReactNode; footer: ReactNode; children: ReactNode }) {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="shrink-0 border-b border-border/50 bg-background">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">{header}</div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 py-4 sm:px-6">{children}</div>
      </div>
      <div className="shrink-0 border-t border-border/50 bg-background">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:px-6">{footer}</div>
      </div>
    </div>
  );
}
