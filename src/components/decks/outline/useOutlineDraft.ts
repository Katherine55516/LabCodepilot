'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { GenerationSettings, OutlineCard, SaveOutlineRequest } from '@/lib/decks/types';
import { decksApi } from '@/lib/decks/client';
import { cleanOutline, errorMessage } from '../create/options';
import { withEditablePoints } from './ops';

export type OutlineLook = Pick<GenerationSettings, 'themeId' | 'imageSource'>;
export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

const SAVE_DELAY_MS = 800;

/**
 * Local outline draft with debounced saving (`PUT /api/decks/:id/outline`).
 * The draft is initialised once from the server outline: the server only
 * changes the outline while it is (re)planning, and the page remounts this
 * view when planning finishes. `flush()` saves immediately (before generate
 * or replan) and rejects if the save fails.
 */
export function useOutlineDraft(deckId: string, initialOutline: OutlineCard[], initialLook: OutlineLook) {
  const [outline, setOutline] = useState<OutlineCard[]>(() => withEditablePoints(initialOutline));
  const [look, setLook] = useState<OutlineLook>(initialLook);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const pending = useRef<SaveOutlineRequest | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inflight = useRef<Promise<unknown> | null>(null);

  const flush = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = undefined; }
    if (inflight.current) await inflight.current.catch(() => {});
    const body = pending.current;
    if (!body) return;
    pending.current = null;
    setSaveState('saving');
    const request = decksApi.saveOutline(deckId, body);
    inflight.current = request;
    try {
      await request;
      setSaveError(null);
      setSaveState(pending.current ? 'dirty' : 'saved');
    } catch (error) {
      pending.current ??= body;
      setSaveError(errorMessage(error));
      setSaveState('error');
      throw error;
    } finally {
      if (inflight.current === request) inflight.current = null;
    }
  }, [deckId]);

  const schedule = useCallback((nextOutline: OutlineCard[], nextLook: OutlineLook) => {
    pending.current = { outline: cleanOutline(nextOutline), settings: nextLook };
    setSaveState('dirty');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flush().catch(() => {}); }, SAVE_DELAY_MS);
  }, [flush]);

  const updateOutline = useCallback((next: OutlineCard[]) => { setOutline(next); schedule(next, look); }, [look, schedule]);
  const updateLook = useCallback((patch: Partial<OutlineLook>) => {
    const next = { ...look, ...patch };
    setLook(next);
    schedule(outline, next);
  }, [look, outline, schedule]);

  // Leaving the page with unsaved edits: send them without waiting.
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    if (pending.current) void decksApi.saveOutline(deckId, pending.current).catch(() => {});
  }, [deckId]);

  return { outline, look, updateOutline, updateLook, flush, saveState, saveError };
}
