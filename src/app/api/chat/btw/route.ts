/**
 * /btw side-question route — answers a quick "by the way" question using the
 * CURRENT conversation as context, without ever touching the main conversation.
 *
 * Mirrors Claude Code CLI's /btw command semantics:
 *   - No tools / single response / stateless / ephemeral: persists nothing and
 *     takes NO session lock, so it runs concurrently with the main stream and
 *     never interrupts it.
 *   - Context comes from the client's in-memory snapshot (messages + in-flight
 *     streaming text), so the aside can see content not yet persisted to the DB.
 *
 * Runs through the Claude Code SDK (generateTextViaSdk) — the SAME subprocess
 * path as the main conversation — NOT the Vercel AI SDK. This matters for model
 * resolution: managed models arrive as CLI aliases like `claude-opus-4-7[1m]`
 * (the `[1m]` = 1M-context variant is a Claude Code alias suffix). Only the SDK
 * subprocess resolves those aliases; a direct @ai-sdk/anthropic call sends
 * `claude-opus-4-7[1m]` verbatim to the proxy → 503 model_not_found. Going
 * through the SDK keeps /btw's model handling identical to the main stream.
 */
import { NextRequest, NextResponse } from 'next/server';
import { generateTextViaSdk } from '@/lib/claude-client';

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

type CtxMessage = { role: 'user' | 'assistant'; content: string };

/**
 * Normalize the client-supplied context snapshot into plain user/assistant
 * turns. Drops anything that isn't a plain text turn, then keeps only the most
 * recent N messages.
 */
function sanitizeContext(raw: unknown): CtxMessage[] {
  if (!Array.isArray(raw)) return [];
  const cleaned: CtxMessage[] = [];
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

    // generateTextViaSdk takes a single prompt string (not a messages array),
    // so fold the context snapshot into the prompt as a plain transcript.
    const context = sanitizeContext(contextMessages);
    const historyText = context
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n\n');
    const prompt = historyText
      ? `Conversation so far (for context):\n\n${historyText}\n\n---\n\nSide question: ${question.trim()}`
      : question.trim();

    // Single-turn, no session, no lock — runs concurrently with the main stream.
    // Provider/model resolution (incl. CLI alias like [1m]), the 60s timeout and
    // abort handling all live inside generateTextViaSdk.
    const answer = await generateTextViaSdk({
      providerId,
      model,
      system: BTW_SYSTEM_PROMPT,
      prompt,
      abortSignal: request.signal,
    });

    return NextResponse.json({ answer: answer ?? '' });
  } catch (error) {
    console.error('[btw] side question failed:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
