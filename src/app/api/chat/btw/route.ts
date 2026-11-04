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
 * Streams token-by-token (SSE) through the Claude Code SDK (streamTextViaSdk) —
 * the SAME subprocess path as the main conversation — NOT the Vercel AI SDK. The
 * SDK path also matters for model
 * resolution: managed models arrive as CLI aliases like `claude-opus-4-7[1m]`
 * (the `[1m]` = 1M-context variant is a Claude Code alias suffix). Only the SDK
 * subprocess resolves those aliases; a direct @ai-sdk/anthropic call sends
 * `claude-opus-4-7[1m]` verbatim to the proxy → 503 model_not_found. Going
 * through the SDK keeps /btw's model handling identical to the main stream.
 */
import { NextRequest, NextResponse } from 'next/server';
import { streamTextViaSdk } from '@/lib/claude-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BTW_SYSTEM_PROMPT = `You are the assistant in a "side chat" — a quick, ongoing aside running alongside the user's main conversation.

Rules:
- Use the main conversation (provided for context) and the side-chat history to answer the user's LATEST question. You have NO tools: you cannot read files, run commands, search the web, or access anything outside what's provided here.
- If the answer isn't in the provided context, say so briefly instead of guessing.
- Be concise and direct — this is a quick aside, usually a sentence or a few. Follow-up questions are expected.
- Reply in the same language the user used.
- This side chat is ephemeral and is not saved to the main conversation history.`;

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
    const { question, contextMessages, sideMessages, model, providerId } = body ?? {};

    if (!question || typeof question !== 'string' || !question.trim()) {
      return NextResponse.json({ error: 'question is required' }, { status: 400 });
    }

    // streamTextViaSdk takes a single prompt string (not a messages array), so
    // fold both transcripts into one prompt: the MAIN conversation snapshot (for
    // context, re-sent every turn) + the SIDE-CHAT's own prior turns + the new
    // question.
    const mainText = sanitizeContext(contextMessages)
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n\n');
    const sideText = sanitizeContext(sideMessages)
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n\n');
    let prompt = '';
    if (mainText) prompt += `Main conversation so far (for context):\n\n${mainText}\n\n---\n\n`;
    if (sideText) prompt += `Side chat so far:\n\n${sideText}\n\n`;
    prompt += `Latest side question: ${question.trim()}`;

    // Single-turn, no session, no lock — runs concurrently with the main stream.
    // Stream the answer token-by-token as SSE (`data: {"delta"|"done"|"error"}`)
    // to match the CLI's feel. Provider/model resolution (incl. CLI aliases like
    // [1m]), the 60s timeout, abort and shadow-home cleanup all live inside
    // streamTextViaSdk.
    const stream = new ReadableStream<string>({
      async start(controller) {
        try {
          for await (const delta of streamTextViaSdk({
            providerId,
            model,
            system: BTW_SYSTEM_PROMPT,
            prompt,
            abortSignal: request.signal,
          })) {
            controller.enqueue(`data: ${JSON.stringify({ delta })}\n\n`);
          }
          controller.enqueue(`data: ${JSON.stringify({ done: true })}\n\n`);
        } catch (error) {
          console.error('[btw] side question failed:', error);
          controller.enqueue(`data: ${JSON.stringify({ error: String(error) })}\n\n`);
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
    });
  } catch (error) {
    console.error('[btw] side question failed:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
