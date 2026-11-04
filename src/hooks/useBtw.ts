'use client';

/**
 * useBtw — shared state + streaming fetch for the /btw side-chat popup.
 *
 * Powers a Claude-desktop-style "Side chat": a floating, draggable/resizable
 * popup that holds a MULTI-TURN aside anchored to the CURRENT conversation.
 * Used by both ChatView (in a session) and app/chat/page.tsx (new-chat screen).
 *
 * The caller supplies `getContext()` — a fresh snapshot of the MAIN conversation
 * as plain {role,content}[] — re-read on every turn so the aside always sees the
 * latest main-conversation state. `ask(question)` appends a user turn + an empty
 * assistant turn, then streams the answer token-by-token (SSE) into that
 * assistant turn. The side-chat's own prior turns are sent as `sideMessages` so
 * the backend can continue the thread. `stop()` aborts the in-flight stream
 * (keeping whatever streamed so far); a monotonic request id drops stale streams
 * when a newer ask / stop / clear supersedes an in-flight one.
 */
import { useState, useCallback, useRef, useEffect } from 'react';

export interface BtwMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export interface UseBtwResult {
  open: boolean;
  setOpen: (v: boolean) => void;
  messages: BtwMessage[];
  loading: boolean;
  error: string | null;
  /** Append a question and stream its answer. */
  ask: (question: string) => void;
  /** Abort the in-flight stream, keeping what streamed so far. */
  stop: () => void;
  /** Reset the side-chat to empty (new topic). */
  clear: () => void;
}

interface UseBtwParams {
  /** Snapshot of the MAIN conversation as plain text turns (may be empty). */
  getContext: () => Array<{ role: string; content: string }>;
  model?: string;
  providerId?: string;
}

export function useBtw({ getContext, model, providerId }: UseBtwParams): UseBtwResult {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<BtwMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqId = useRef(0);
  const idSeq = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  // Latest side-chat history, read (not depended-on) inside ask so ask stays
  // stable. Updated in an effect — never during render (react-hooks/refs).
  const messagesRef = useRef<BtwMessage[]>([]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    reqId.current++; // drop the in-flight stream's results
    setLoading(false);
  }, []);

  const clear = useCallback(() => {
    abortRef.current?.abort();
    reqId.current++;
    setMessages([]);
    setError(null);
    setLoading(false);
  }, []);

  const ask = useCallback(async (raw: string) => {
    const question = raw.trim();
    setOpen(true);
    if (!question) return;

    const id = ++reqId.current;
    setError(null);
    const ac = new AbortController();
    abortRef.current = ac;

    // Side-chat history BEFORE this turn → sent to the backend as prior turns.
    const sideMessages = messagesRef.current.map((m) => ({ role: m.role, content: m.content }));
    const asstId = `a-${++idSeq.current}`;
    setMessages((prev) => [
      ...prev,
      { id: `u-${++idSeq.current}`, role: 'user', content: question },
      { id: asstId, role: 'assistant', content: '' },
    ]);
    setLoading(true);

    const contextMessages = getContext(); // fresh main-conversation snapshot
    try {
      const res = await fetch('/api/chat/btw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, contextMessages, sideMessages, model, providerId }),
        signal: ac.signal,
      });
      if (reqId.current !== id) return; // superseded
      if (!res.ok || !res.body) { setError(`HTTP ${res.status}`); setLoading(false); return; }

      // `loading` stays true for the WHOLE stream (submit → done/error/stop) so
      // the composer shows the Stop button throughout; the "thinking" Shimmer is
      // driven separately by the last assistant turn still being empty.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (reqId.current !== id) { await reader.cancel(); return; } // superseded / stopped mid-stream
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop() ?? '';
        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith('data:')) continue;
          let evt: { delta?: string; error?: string; done?: boolean };
          try { evt = JSON.parse(line.slice(5).trim()); } catch { continue; }
          if (evt.error) { setError(evt.error); }
          else if (evt.delta) {
            const d = evt.delta;
            setMessages((prev) => prev.map((m) => (m.id === asstId ? { ...m, content: m.content + d } : m)));
          }
        }
      }
    } catch (e) {
      // AbortError from stop()/clear() is expected — reqId already bumped so this
      // guard skips it; only surface real failures.
      if (reqId.current === id) setError(String(e));
    } finally {
      if (reqId.current === id) setLoading(false);
    }
  }, [getContext, model, providerId]);

  return { open, setOpen, messages, loading, error, ask, stop, clear };
}
