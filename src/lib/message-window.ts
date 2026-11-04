/**
 * Message retention window — bounds how much chat history is kept in renderer
 * React state, by BOTH message count and total content bytes.
 *
 * Why bytes too: the chat view used to cap only by count (300 messages). A
 * single multi-MB tool_result (Read / Bash / WebFetch / Agent) stays fully
 * resident in `message.content`, so 300 heavy messages could retain >1GB and
 * crash the renderer. This helper additionally evicts the oldest messages once
 * the retained content exceeds a byte budget.
 *
 * Eviction is loss-free: the server persists full content to SQLite
 * independently of renderer state, and every recovery path (Load earlier,
 * reconcile, remount) re-fetches from the DB. Eviction only ever drops WHOLE
 * old messages — it never alters the content of a message that stays, so copy,
 * full-render tool rows (WebFetch / Agent), search, rewind, etc. are untouched.
 */

/**
 * Trim the head (oldest) of `msgs` so that the retained tail satisfies BOTH:
 *   - length <= maxCount
 *   - total content length <= maxBytes
 *
 * Walks from the newest message backward, accumulating `content.length`
 * (UTF-16 code units — a cheap, intentionally-approximate proxy for bytes; the
 * budget has ample headroom so under-counting multibyte text never risks OOM).
 * Always keeps at least the single newest message, so one oversized message
 * never disappears mid-view (same graceful-degradation contract as the count
 * cap). Returns the SAME array reference when nothing is trimmed so callers can
 * preserve React state identity and avoid needless re-renders.
 */
export function trimMessageWindow<T extends { content?: string | null }>(
  msgs: T[],
  maxCount: number,
  maxBytes: number,
): { trimmed: T[]; didTrim: boolean } {
  if (msgs.length === 0) return { trimmed: msgs, didTrim: false };

  let bytes = 0;
  let startIdx = 0; // first index to keep

  for (let i = msgs.length - 1; i >= 0; i--) {
    bytes += msgs[i].content?.length ?? 0;
    const countOverflow = msgs.length - i > maxCount;
    const byteOverflow = bytes > maxBytes;
    // `i < msgs.length - 1` guarantees we never evict the single newest message,
    // even if it alone exceeds the byte budget.
    if ((countOverflow || byteOverflow) && i < msgs.length - 1) {
      startIdx = i + 1; // keep from the next-newer message onward
      break;
    }
  }

  if (startIdx === 0) return { trimmed: msgs, didTrim: false };
  return { trimmed: msgs.slice(startIdx), didTrim: true };
}
