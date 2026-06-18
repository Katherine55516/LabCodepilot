/**
 * Policy for the conversation stream "no-content" timeout.
 *
 * The stream is aborted when no SUBSTANTIVE content (real model text / thinking /
 * tool activity) has arrived for STREAM_NO_CONTENT_TIMEOUT_MS. keep_alive and
 * pure-status pings deliberately do NOT count toward this — they prove the
 * connection is alive but NOT that the model is making progress. This lets a
 * slow-first-byte provider stream late without being mis-killed, while a
 * genuinely wedged-but-connected upstream is still bounded by the ceiling.
 *
 * The value must be ≥ the longest legitimate gap between substantive events on
 * any runtime path (dominated by worst-case slow first byte + context
 * compaction/retry), and ≥ the 300s permission auto-deny backstop.
 *
 * See docs/exec-plans/active/stream-idle-timeout-rework.md and issue B-019.
 *
 * NOTE: this is the SINGLE source of truth — it lives in its own module (rather
 * than inside the client-only stream-session-manager) so the pure decision below
 * can be unit-tested without dragging in browser/DOM dependencies.
 */
export const STREAM_NO_CONTENT_TIMEOUT_MS = 990_000; // 16.5min

/**
 * Pure abort decision for the no-content timeout. Unit-tested in isolation.
 *
 * @param now                       current epoch ms
 * @param lastSubstantiveEventTime  epoch ms of the last substantive event
 * @param ceilingMs                 timeout threshold (STREAM_NO_CONTENT_TIMEOUT_MS)
 * @param hasPendingPermission      whether the stream is blocked on a user permission decision
 * @returns true when the stream should be aborted for lack of substantive content
 */
export function shouldAbortForNoContent(
  now: number,
  lastSubstantiveEventTime: number,
  ceilingMs: number,
  hasPendingPermission: boolean,
): boolean {
  // Paused while awaiting a user permission decision — the model is blocked on
  // the user, not stalled (permission has its own 300s auto-deny backstop).
  if (hasPendingPermission) return false;
  return now - lastSubstantiveEventTime >= ceilingMs;
}
