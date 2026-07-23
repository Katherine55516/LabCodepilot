import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { shouldNotifyTurnCompletion } from '../../lib/turn-notification-policy';

/**
 * Turn-completion notification policy (Claude-Desktop parity).
 *
 * Contract (mirrors the official NotificationService suppression rule):
 *   - suppressed ONLY when the window is focused AND the session is visible;
 *   - phases other than 'completed' / 'error' never notify ('stopped' is
 *     user-initiated or auto-retried, 'active' is not terminal).
 */
describe('shouldNotifyTurnCompletion', () => {
  it('notifies when the window is unfocused (minimized / behind another app)', () => {
    assert.equal(shouldNotifyTurnCompletion({ phase: 'completed', windowFocused: false, sessionVisible: true }), true);
    assert.equal(shouldNotifyTurnCompletion({ phase: 'completed', windowFocused: false, sessionVisible: false }), true);
  });

  it('notifies when focused but viewing a different conversation', () => {
    assert.equal(shouldNotifyTurnCompletion({ phase: 'completed', windowFocused: true, sessionVisible: false }), true);
  });

  it('suppresses when focused and viewing that session (official viewing_session rule)', () => {
    assert.equal(shouldNotifyTurnCompletion({ phase: 'completed', windowFocused: true, sessionVisible: true }), false);
  });

  it('notifies for error terminals under the same visibility rules', () => {
    assert.equal(shouldNotifyTurnCompletion({ phase: 'error', windowFocused: false, sessionVisible: true }), true);
    assert.equal(shouldNotifyTurnCompletion({ phase: 'error', windowFocused: true, sessionVisible: true }), false);
  });

  it('never notifies for user-initiated or non-terminal phases', () => {
    for (const phase of ['stopped', 'active', '']) {
      assert.equal(shouldNotifyTurnCompletion({ phase, windowFocused: false, sessionVisible: false }), false, phase);
    }
  });
});
