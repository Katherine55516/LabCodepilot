'use client';

/**
 * useBtw — shared state + streaming fetch for the /btw side-question popup.
 *
 * Extracted so BOTH the in-conversation view (ChatView) and the new-chat screen
 * (app/chat/page.tsx) can wire /btw identically — previously only ChatView had
 * it, so /btw on the welcome screen silently cleared the input with no popup.
 *
 * The caller supplies `getContext()` (a snapshot of the current conversation as
 * plain {role,content}[]), plus the active model/providerId. `ask(question)`
 * opens the popup and streams the answer token-by-token from /api/chat/btw
 * (SSE), accumulating into `answer`. A monotonic request id drops stale results
 * when a newer /btw supersedes an in-flight one.
 */
import { useState, useCallback, useRef } from 'react';

export interface UseBtwResult {
  open: boolean;
  setOpen: (v: boolean) => void;
  question: string;
  answer: string;
  loading: boolean;
  error: string | null;
  /** Open the popup and stream an answer for `question`. */
  ask: (question: string) => void;
}

interface UseBtwParams {
  /** Snapshot of the current conversation as plain text turns (may be empty). */
  getContext: () => Array<{ role: string; content: string }>;
  model?: string;
  providerId?: string;
}

export function useBtw({ getContext, model, providerId }: UseBtwParams): UseBtwResult {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqId = useRef(0);

  const ask = useCallback(async (q: string) => {
    const id = ++reqId.current;
    setQuestion(q);
    setAnswer('');
    setError(null);
    setOpen(true);
    if (!q.trim()) { setLoading(false); return; }
    setLoading(true);

    const contextMessages = getContext();
    try {
      const res = await fetch('/api/chat/btw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, contextMessages, model, providerId }),
      });
      if (reqId.current !== id) return; // superseded by a newer /btw
      if (!res.ok || !res.body) { setError(`HTTP ${res.status}`); return; }

      // Stream the answer token-by-token (SSE): `data: {"delta"|"done"|"error"}`.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let sawDelta = false;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (reqId.current !== id) { await reader.cancel(); return; } // superseded mid-stream
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
            if (!sawDelta) { sawDelta = true; setLoading(false); } // first token → drop spinner
            setAnswer((prev) => prev + d);
          }
        }
      }
    } catch (e) {
      if (reqId.current === id) setError(String(e));
    } finally {
      if (reqId.current === id) setLoading(false);
    }
  }, [getContext, model, providerId]);

  return { open, setOpen, question, answer, loading, error, ask };
}
