'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';

/** V-P0-1: the generated outline is shown for review; generation continues
 * automatically after a short countdown unless the user starts editing. */
export function OutlineAutoContinue({ seconds = 10, onElapsed, onStop }: { seconds?: number; onElapsed: () => void; onStop: () => void }) {
  const { t } = useTranslation();
  const [left, setLeft] = useState(seconds);
  const elapsed = useRef(onElapsed); elapsed.current = onElapsed;
  useEffect(() => {
    if (left <= 0) { elapsed.current(); return; }
    const timer = setTimeout(() => setLeft(value => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [left]);
  return (
    <div role="status" data-testid="ppt-outline-auto-continue" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
      <span>{t('ppt.outline.autoContinue').replace('{n}', String(Math.max(0, left)))}</span>
      <button className="rounded border border-border px-3 py-1 text-xs" onClick={onStop}>{t('ppt.outline.autoContinueStop')}</button>
    </div>
  );
}
