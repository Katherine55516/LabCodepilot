/**
 * /btw side-question route — answers a quick "by the way" question using the
 * CURRENT conversation as context, without ever touching the main conversation.
 *
 * Mirrors Claude Code CLI's /btw command semantics:
 *   - No tools: native generateText with no tools wired. It can only answer from
 *     the context it's handed (no file reads, no commands, no web).
 *   - Single response, stateless: one completion, no follow-up thread.
 *   - Ephemeral: does NOT persist anything — no addMessage, no session row,
 *     no sdk_session_id, and crucially NO session lock. Because it never takes
 *     the per-session lock that /api/chat uses, it runs concurrently with the
 *     main stream and never interrupts it.
 *   - Context comes from the client's in-memory snapshot (messages + in-flight
 *     streaming text), so the side question can see content that hasn't been
 *     persisted to the DB yet.
 *
 * Uses the Vercel AI SDK via the unified provider factory (createModel) — the
 * same path as /api/chat/structured. No Claude Code SDK dependency.
 */
import { NextRequest, NextResponse } from 'next/server';
import { generateText, type ModelMessage } from 'ai';
import { createModel } from '@/lib/ai-provider';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BTW_SYSTEM_PROMPT = `You are answering a quick "by the way" side question raised during an ongoing conversation.

Rules:
- Answer ONLY from information already present in the conversation context provided below. You have NO tools: you cannot read files, run commands, search the web, or access anything outside this conversation.
- If the answer is not in the context, say so briefly instead of guessing.
- Be concise and direct. This is a quick aside, not a deep dive — a sentence or a few is usually right.
- Reply in the same language the user used for the question.
- This exchange is ephemeral and will not be saved to the conversation history.`;

/** Cap how much history we forward, to bound token cost of the aside. */
const MAX_CONTEXT_MESSAGES = 60;

/**
 * Normalize the client-supplied context snapshot into typed ModelMessage[].
 * Drops anything that isn't a plain text user/assistant turn, then keeps only
 * the most recent N messages.
 */
function sanitizeContext(raw: unknown): ModelMessage[] {
  if (!Array.isArray(raw)) return [];
  const cleaned: ModelMessage[] = [];
  for (const m of raw) {
    if (!m || typeof m !== 'object') continue;
    const role = (m as { role?: unknown }).role;
    const content = (m as { content?: unknown }).content;
    if (role !== 'user' && role !== 'assistant') continue;
    if (typeof content !== 'string' || !content.trim()) continue;
    cleaned.push({ role, content });
  }
  return cleaned.slice(-MAX_CONTEXT_MESSAGES);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { question, contextMessages, model, providerId } = body ?? {};

    if (!question || typeof question !== 'string' || !question.trim()) {
      return NextResponse.json({ error: 'question is required' }, { status: 400 });
    }

    const context = sanitizeContext(contextMessages);
    const messages: ModelMessage[] = [
      ...context,
      { role: 'user', content: question.trim() },
    ];

    // Unified provider factory — same as /api/chat/structured. No tools wired.
    const { languageModel } = createModel({ providerId, model });

    // Honor client aborts (popup closed) and add a 45s safety timeout so a
    // hung provider can't pin the request open.
    const abortController = new AbortController();
    const onClientAbort = () => abortController.abort();
    request.signal?.addEventListener('abort', onClientAbort);
    const timeoutId = setTimeout(() => abortController.abort(), 45_000);

    try {
      const result = await generateText({
        model: languageModel,
        system: BTW_SYSTEM_PROMPT,
        messages,
        maxOutputTokens: 1024,
        abortSignal: abortController.signal,
      });
      return NextResponse.json({ answer: result.text ?? '' });
    } finally {
      clearTimeout(timeoutId);
      request.signal?.removeEventListener('abort', onClientAbort);
    }
  } catch (error) {
    console.error('[btw] side question failed:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
