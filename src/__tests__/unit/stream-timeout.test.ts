import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { STREAM_NO_CONTENT_TIMEOUT_MS, shouldAbortForNoContent } from '../../lib/stream-timeout';

/**
 * Tests for the conversation stream "no-content" timeout policy (B-019 治本).
 *
 * The decision is intentionally pure (no DOM / timers) so it can be exercised
 * directly. The behavioural contract:
 *   - the stream aborts only after NO substantive content for >= the ceiling;
 *   - keep_alive / status pings do NOT advance lastSubstantiveEventTime, so a
 *     wedged-but-connected upstream is still eventually caught;
 *   - a slow provider that eventually streams real content is never mis-killed;
 *   - the timeout is paused while blocked on a user permission decision.
 */
describe('stream no-content timeout policy', () => {
  const CEILING = STREAM_NO_CONTENT_TIMEOUT_MS;

  it('exposes a sane default ceiling (> 300s permission auto-deny backstop)', () => {
    assert.ok(CEILING > 300_000, 'ceiling must exceed the 300s permission auto-deny');
  });

  it('does NOT abort while substantive content is recent', () => {
    const now = 1_000_000;
    assert.equal(shouldAbortForNoContent(now, now - 1, CEILING, false), false);
    assert.equal(shouldAbortForNoContent(now, now - (CEILING - 1), CEILING, false), false);
  });

  it('aborts once the no-content gap reaches the ceiling', () => {
    const now = 1_000_000;
    assert.equal(shouldAbortForNoContent(now, now - CEILING, CEILING, false), true);
    assert.equal(shouldAbortForNoContent(now, now - (CEILING + 5_000), CEILING, false), true);
  });

  it('boundary: a gap exactly at the ceiling aborts (>= semantics)', () => {
    assert.equal(shouldAbortForNoContent(CEILING, 0, CEILING, false), true);
    assert.equal(shouldAbortForNoContent(CEILING - 1, 0, CEILING, false), false);
  });

  it('is paused while blocked on a user permission decision', () => {
    const now = 1_000_000;
    // Even far past the ceiling, a pending permission suspends the timeout — the
    // model is blocked on the user, not stalled.
    assert.equal(shouldAbortForNoContent(now, now - CEILING * 10, CEILING, true), false);
  });

  it('keep_alive-only stream is still caught; a content-streaming one is not', () => {
    const ceiling = 30_000;

    // Case A — only keep_alive pings arrive. They do NOT advance the substantive
    // clock, so after the ceiling elapses the safety net still fires.
    const lastSubstantive = 0;
    let now = 0;
    for (let i = 0; i < 5; i++) now += 10_000; // keep_alive ticks (no content)
    assert.equal(now, 50_000);
    assert.equal(shouldAbortForNoContent(now, lastSubstantive, ceiling, false), true);

    // Case B — real content keeps arriving within the ceiling: never aborts,
    // regardless of total elapsed time (here 200s, far beyond the 30s ceiling).
    let substantive = 0;
    for (let t = 10_000; t <= 200_000; t += 10_000) {
      substantive = t; // each substantive event advances the clock
      assert.equal(shouldAbortForNoContent(t, substantive, ceiling, false), false);
    }
  });
});
