/**
 * Turn-completion notification policy — pure decision logic, no DOM.
 *
 * Replicates Claude Desktop's official suppression rule (extracted from its
 * NotificationService): a completion notification is suppressed ONLY when the
 * app window is focused AND the user is currently viewing that session; any
 * other combination (window minimized/unfocused, or focused but on a
 * different conversation) notifies. Claude Desktop expresses this as
 *   isAppFocusedAndVisible() && currentURL.includes(sessionId) → skip
 * — we mirror it with (windowFocused && sessionVisible).
 *
 * Phase filter: only turns that ended on their own get a notification —
 * 'completed' (normal finish) and 'error' (needs attention). 'stopped' is
 * excluded: it is user-initiated (manual stop) or immediately auto-retried
 * (tool timeout), so the user either knows already or the turn isn't over.
 */

export interface TurnNotificationContext {
  /** Terminal phase of the stream snapshot ('completed' | 'stopped' | 'error' | ...). */
  phase: string;
  /** Whether the app window currently has focus (document.hasFocus()). */
  windowFocused: boolean;
  /** Whether a ChatView for this session is currently mounted/visible. */
  sessionVisible: boolean;
}

export function shouldNotifyTurnCompletion(ctx: TurnNotificationContext): boolean {
  if (ctx.phase !== 'completed' && ctx.phase !== 'error') return false;
  return !(ctx.windowFocused && ctx.sessionVisible);
}
