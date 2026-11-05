'use client';

import { useEffect, useRef, useState } from 'react';
import type {
  AiEditRequest, CreateDeckRequest, Deck, DeckJob, DeckResponse, DeckSummary, DeckTheme, DeckVersion,
  MediaItem, SaveDeckRequest, SaveOutlineRequest,
} from './types';

/** Thin typed client for /api/decks. Errors throw `DecksApiError` with the server's message. */
export class DecksApiError extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message); }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/decks${path}`, {
    ...init,
    headers: { ...(init.body && !(init.body instanceof Blob) ? { 'content-type': 'application/json' } : {}), ...(init.headers || {}) },
    cache: 'no-store',
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw new DecksApiError(response.status, data.error || response.statusText, data.code);
  return data as T;
}
const json = (body: unknown) => JSON.stringify(body);

export const decksApi = {
  list: () => call<{ decks: DeckSummary[] }>(''),
  themes: () => call<{ themes: DeckTheme[] }>('/themes'),
  create: (body: CreateDeckRequest) => call<{ deck: Deck; job: DeckJob }>('', { method: 'POST', body: json(body) }),
  get: (id: string) => call<DeckResponse>(`/${id}`),
  save: (id: string, body: SaveDeckRequest) => call<{ deck: Deck }>(`/${id}`, { method: 'PUT', body: json(body) }),
  remove: (id: string) => call<{ ok: true }>(`/${id}`, { method: 'DELETE' }),
  duplicate: (id: string) => call<{ deck: Deck }>(`/${id}/duplicate`, { method: 'POST' }),
  saveOutline: (id: string, body: SaveOutlineRequest) => call<{ deck: Deck }>(`/${id}/outline`, { method: 'PUT', body: json(body) }),
  replan: (id: string, body: { instruction?: string; numCards?: number }) => call<{ job: DeckJob }>(`/${id}/outline`, { method: 'POST', body: json(body) }),
  generate: (id: string) => call<{ job: DeckJob }>(`/${id}/generate`, { method: 'POST' }),
  queueInstruction: (id: string, text: string) => call<{ job: DeckJob }>(`/${id}/instructions`, { method: 'POST', body: json({ text }) }),
  removeInstruction: (id: string, instructionId: string) => call<{ job: DeckJob }>(`/${id}/instructions/${instructionId}`, { method: 'DELETE' }),
  stop: (id: string) => call<{ job: DeckJob }>(`/${id}/stop`, { method: 'POST' }),
  aiEdit: (id: string, body: AiEditRequest) => call<{ job: DeckJob }>(`/${id}/edits`, { method: 'POST', body: json(body) }),
  applyProposal: (id: string, proposalId: string) => call<{ deck: Deck }>(`/${id}/proposals/${proposalId}/apply`, { method: 'POST' }),
  discardProposal: (id: string, proposalId: string) => call<{ deck: Deck }>(`/${id}/proposals/${proposalId}/discard`, { method: 'POST' }),
  versions: (id: string) => call<{ versions: DeckVersion[] }>(`/${id}/versions`),
  restore: (id: string, version: number) => call<{ deck: Deck }>(`/${id}/versions/${version}/restore`, { method: 'POST' }),
  addMediaFromUrl: (id: string, url: string) => call<{ media: MediaItem }>(`/${id}/media`, { method: 'POST', body: json({ url }) }),
  uploadMedia: (id: string, file: Blob) => call<{ media: MediaItem }>(`/${id}/media`, { method: 'POST', body: file, headers: { 'content-type': file.type || 'application/octet-stream' } }),
  accent: (id: string, cardId: string, body: { action: 'regenerate' | 'clear' | 'set'; position?: string; mediaId?: string }) =>
    call<{ deck: Deck }>(`/${id}/cards/${cardId}/accent`, { method: 'POST', body: json(body) }),
};

export const mediaUrl = (mediaId: string) => `/api/decks/media/${mediaId}`;
export const exportUrl = (deckId: string, format: 'pptx') => `/api/decks/${deckId}/export?format=${format}`;

/**
 * Live deck + job snapshots over SSE (`GET /api/decks/:id/events`), falling
 * back to polling every 2 s if the stream drops. `refresh()` forces a fetch.
 */
export function useDeckLive(deckId: string | null) {
  const [state, setState] = useState<DeckResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refreshRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (!deckId) return;
    let closed = false;
    let poll: ReturnType<typeof setTimeout> | undefined;
    const load = () => decksApi.get(deckId).then(data => { if (!closed) { setState(data); setError(null); } }).catch(e => { if (!closed) setError(e instanceof Error ? e.message : String(e)); });
    refreshRef.current = load;
    void load();
    const source = new EventSource(`/api/decks/${deckId}/events`);
    source.onmessage = event => { if (closed) return; try { setState(JSON.parse(event.data) as DeckResponse); setError(null); } catch { /* ignore partial */ } };
    source.onerror = () => {
      source.close();
      const tick = () => { if (closed) return; void load(); poll = setTimeout(tick, 2000); };
      poll = setTimeout(tick, 2000);
    };
    return () => { closed = true; source.close(); if (poll) clearTimeout(poll); };
  }, [deckId]);
  return { data: state, error, refresh: () => refreshRef.current(), setData: setState };
}
