'use client';

import { Check, WarningCircle } from '@phosphor-icons/react';
import type { CardStage } from '@/lib/decks/types';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { useDecksT } from '../i18n';

export const STAGE_ORDER: CardStage[] = ['queued', 'writing', 'imaging', 'checking', 'polishing', 'done'];
const ACTIVE: CardStage[] = ['writing', 'imaging', 'checking', 'polishing'];

/** Per-card build stage (report 02 §5.1 "Build": Checking… / Polishing… / Done / Couldn't finish). */
export function StageBadge({ stage, className }: { stage: CardStage; className?: string }) {
  const t = useDecksT();
  const active = ACTIVE.includes(stage);
  return (
    <Badge
      variant={stage === 'failed' ? 'destructive' : stage === 'done' ? 'secondary' : 'outline'}
      className={cn(active && 'border-primary/40 text-foreground', stage === 'queued' && 'text-muted-foreground', className)}
    >
      {active && <Spinner className="size-3" aria-hidden />}
      {stage === 'done' && <Check weight="bold" aria-hidden />}
      {stage === 'failed' && <WarningCircle weight="bold" aria-hidden />}
      {t(`decks.stage.${stage}`)}
    </Badge>
  );
}
