'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { DecksApiError, decksApi } from '@/lib/decks/client';
import type { Deck, SaveDeckRequest } from '@/lib/decks/types';

export type SaveStatus = 'saved' | 'pending' | 'saving' | 'conflict' | 'error';
export type DeckPatch = Omit<SaveDeckRequest, 'baseVersion'>;

const DEBOUNCE_MS = 800;

/**
 * Debounced, serial saver. Patches merge until the debounce fires; saves run
 * one at a time, each based on the version the previous save returned, so the
 * server's 409 only fires for real conflicts (another tab, an applied AI edit).
 */
export function useDeckSaver(deckId: string, serverVersion: number, onSaved: (deck: Deck) => void) {
  const [status, setStatus] = useState<SaveStatus>('saved');
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<DeckPatch>({});
  const version = useRef(serverVersion);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const chain = useRef<Promise<boolean>>(Promise.resolve(true));
  const onSavedRef = useRef(onSaved);
  const blocked = useRef(false);

  useEffect(() => { onSavedRef.current = onSaved; }, [onSaved]);
  useEffect(() => { version.current = Math.max(version.current, serverVersion); }, [serverVersion]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const run = useCallback(async (): Promise<boolean> => {
    const body = pending.current;
    if (blocked.current) return false;
    if (Object.keys(body).length === 0) return true;
    pending.current = {};
    setStatus('saving');
    try {
      const { deck } = await decksApi.save(deckId, { baseVersion: version.current, ...body });
      version.current = deck.version;
      onSavedRef.current(deck);
      setStatus(Object.keys(pending.current).length ? 'pending' : 'saved');
      setError(null);
      return true;
    } catch (e) {
      if (e instanceof DecksApiError && e.status === 409) {
        blocked.current = true;
        setStatus('conflict');
      } else {
        pending.current = { ...body, ...pending.current };
        setStatus('error');
        setError(e instanceof Error ? e.message : String(e));
      }
      return false;
    }
  }, [deckId]);

  /** Saves everything queued now; resolves false on conflict or error. */
  const flush = useCallback((): Promise<boolean> => {
    clearTimeout(timer.current);
    chain.current = chain.current.then(run, run);
    return chain.current;
  }, [run]);

  const queue = useCallback((patch: DeckPatch, immediate = false) => {
    if (blocked.current) return;
    pending.current = { ...pending.current, ...patch, ...(patch.settings || pending.current.settings ? { settings: { ...pending.current.settings, ...patch.settings } } : {}) };
    setStatus('pending');
    clearTimeout(timer.current);
    if (immediate) void flush();
    else timer.current = setTimeout(() => { void flush(); }, DEBOUNCE_MS);
  }, [flush]);

  /** Drops local unsaved changes after the user chose to reload the server copy. */
  const reset = useCallback(() => {
    clearTimeout(timer.current);
    pending.current = {};
    blocked.current = false;
    setStatus('saved');
    setError(null);
  }, []);

  return { status, error, queue, flush, reset, dirty: status !== 'saved' };
}
