'use client';

import { useMemo, useState } from 'react';
import { Stop } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import type { Card, CardStage, DeckJob, DeckResponse } from '@/lib/decks/types';
import { decksApi, mediaUrl } from '@/lib/decks/client';
import { getTheme } from '@/lib/decks/themes';
import { cardTitle } from '@/lib/decks/blocks';
import { cn } from '@/lib/utils';
import { CardView } from '../CardView';
import { useDecksT } from '../i18n';
import { InstructionQueue } from './InstructionQueue';
import { STAGE_ORDER, StageBadge } from './StageBadge';

interface GenerationViewProps {
  deckId: string;
  data: DeckResponse;
  setData: (data: DeckResponse) => void;
}

function stageCounts(cards: Card[], job?: DeckJob): Record<CardStage, number> {
  if (job?.progress.stages) return job.progress.stages;
  const counts: Record<CardStage, number> = { queued: 0, writing: 0, imaging: 0, checking: 0, polishing: 0, done: 0, failed: 0 };
  for (const card of cards) counts[card.stage] += 1;
  return counts;
}

/**
 * Live build (report 02 §5.1 "Generate" / "Build"): placeholder cards titled
 * from the plan, filled whole as each card is written, with a stage badge per
 * card and overall progress from the job.
 */
export function GenerationView({ deckId, data, setData }: GenerationViewProps) {
  const t = useDecksT();
  const { deck, job } = data;
  const theme = getTheme(deck.settings.themeId);
  const counts = useMemo(() => stageCounts(deck.cards, job), [deck.cards, job]);
  const total = job?.progress.total || deck.cards.length || deck.outline.length;
  const done = job?.progress.done ?? counts.done;
  const percent = Math.max(0, Math.min(100, job?.progress.percent ?? (total ? Math.round((done / total) * 100) : 0)));
  const stages: CardStage[] = counts.failed > 0 ? [...STAGE_ORDER, 'failed'] : STAGE_ORDER;
  const titleFor = (card: Card, index: number) => cardTitle(card) || deck.outline[index]?.title || t('decks.build.untitled', { n: index + 1 });

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto grid w-full max-w-7xl gap-5 px-4 py-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section aria-labelledby="decks-build-heading" className="flex min-w-0 flex-col gap-3 lg:col-span-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="decks-build-heading" className="text-base font-semibold">{t('decks.build.heading', { done, total })}</h2>
            <div className="flex items-center gap-3">
              <span className="text-sm tabular-nums text-muted-foreground">{percent}%</span>
              <StopButton deckId={deckId} />
            </div>
          </div>
          <div
            role="progressbar"
            aria-label={t('decks.build.progress')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            className="h-2 overflow-hidden rounded-full bg-muted"
          >
            <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${percent}%` }} />
          </div>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label={t('decks.build.stageCounts')}>
            {stages.map(stage => (
              <li key={stage} className={cn('flex items-center gap-1.5', counts[stage] > 0 && 'text-foreground', stage === 'failed' && 'text-destructive')}>
                <span>{t(`decks.stage.${stage}`)}</span>
                <span className="tabular-nums font-medium">{counts[stage]}</span>
              </li>
            ))}
          </ul>
        </section>

        <section aria-label={t('decks.build.cards')} className="order-3 min-w-0 lg:order-none">
          {deck.cards.length === 0 ? (
            <ol className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {deck.outline.map((item, i) => (
                <li key={item.id} className="flex flex-col gap-2">
                  <div className="aspect-video animate-pulse rounded-lg bg-muted" />
                  <CardCaption index={i} title={item.title} stage="queued" />
                </li>
              ))}
            </ol>
          ) : (
            <ol className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {deck.cards.map((card, i) => (
                <li key={card.id} className="flex min-w-0 flex-col gap-2" aria-busy={card.stage !== 'done' && card.stage !== 'failed'}>
                  <div className={cn('overflow-hidden rounded-lg border border-border/60', card.stage === 'failed' && 'border-destructive/50')}>
                    <CardView
                      card={card}
                      theme={theme}
                      dimensions={deck.settings.dimensions}
                      mediaUrl={mediaUrl}
                      cardNumber={i + 1}
                      cardCount={deck.cards.length}
                      headerFooter={deck.headerFooter}
                      deckTitle={deck.title}
                      pending={card.blocks.length === 0}
                    />
                  </div>
                  <CardCaption index={i} title={titleFor(card, i)} stage={card.stage} />
                </li>
              ))}
            </ol>
          )}
        </section>

        <aside className="order-2 min-w-0 lg:order-none lg:sticky lg:top-4 lg:self-start">
          <InstructionQueue deckId={deckId} job={job} onQueued={nextJob => setData({ ...data, job: nextJob })} />
        </aside>
      </div>
    </div>
  );
}

function CardCaption({ index, title, stage }: { index: number; title: string; stage: CardStage }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-2">
      <span className="min-w-0 truncate text-sm"><span className="mr-1.5 tabular-nums text-muted-foreground">{index + 1}</span>{title}</span>
      <StageBadge stage={stage} />
    </div>
  );
}

/** Stop keeps the finished cards and drops the ones not started (report 02 §3: Stop). */
function StopButton({ deckId }: { deckId: string }) {
  const t = useDecksT();
  const [stopping, setStopping] = useState(false);
  return (
    <Button type="button" variant="outline" size="sm" disabled={stopping} onClick={async () => { setStopping(true); try { await decksApi.stop(deckId); } catch { setStopping(false); } }}>
      <Stop aria-hidden />{stopping ? t('decks.build.stopping') : t('decks.build.stop')}
    </Button>
  );
}
