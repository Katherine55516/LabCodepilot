/**
 * Turn-completion system notifications — replicates Claude Desktop's idle
 * notification ("Claude is waiting for your input", screenshot-identical
 * top-right banner on macOS / bottom-right toast on Windows).
 *
 * Official behaviour replicated (researched from Claude.app's bundled
 * NotificationService):
 *   - trigger: a turn finishes while the user isn't looking (window
 *     unfocused/minimized, or focused on a different conversation);
 *   - suppression: focused AND viewing that session → no notification;
 *   - dedupe: one notification per session (tag `turn-<sessionId>`), a new
 *     one replaces the old;
 *   - click: focus the app window and navigate to that session;
 *   - returning to the session by yourself closes its stale notification.
 *
 * Completion events come from stream-session-manager's window-level
 * 'stream-session-event' broadcast, which fires for ALL sessions — including
 * ones whose ChatView has been unmounted (user switched away mid-turn).
 *
 * Electron: native Notification via the notification:show IPC (click-to-
 * focus + navigate). Browser/dev fallback: HTML5 Notification API.
 */

import { shouldNotifyTurnCompletion } from '@/lib/turn-notification-policy';
import { translate, type Locale } from '@/i18n';
import type { StreamEvent } from '@/types';

// globalThis keys survive Next.js HMR (same pattern as stream-session-manager).
const VISIBLE_KEY = '__turnNotifyVisibleSessions__' as const;
const INIT_KEY = '__turnNotifyInitialized__' as const;
const WEB_NOTIFS_KEY = '__turnNotifyWebNotifications__' as const;

function getVisibleSessions(): Set<string> {
  const g = globalThis as Record<string, unknown>;
  if (!g[VISIBLE_KEY]) g[VISIBLE_KEY] = new Set<string>();
  return g[VISIBLE_KEY] as Set<string>;
}

/** Web-fallback notifications by tag, so returning to a session can close them. */
function getWebNotifications(): Map<string, Notification> {
  const g = globalThis as Record<string, unknown>;
  if (!g[WEB_NOTIFS_KEY]) g[WEB_NOTIFS_KEY] = new Map<string, Notification>();
  return g[WEB_NOTIFS_KEY] as Map<string, Notification>;
}

function currentLocale(): Locale {
  return (typeof document !== 'undefined'
    ? (document.documentElement.lang as Locale)
    : 'en');
}

function notificationTag(sessionId: string): string {
  return `turn-${sessionId}`;
}

/**
 * Mark a session as currently visible (a ChatView for it is mounted).
 * Returns an unregister cleanup. Registering also closes any stale
 * notification for that session — the user found their way back on their own
 * (official closeIdleNotificationForSession behaviour).
 */
export function registerVisibleSession(sessionId: string): () => void {
  const visible = getVisibleSessions();
  visible.add(sessionId);
  closeTurnNotification(sessionId);
  return () => { visible.delete(sessionId); };
}

function closeTurnNotification(sessionId: string): void {
  const tag = notificationTag(sessionId);
  if (typeof window !== 'undefined' && window.electronAPI?.notification?.close) {
    window.electronAPI.notification.close(tag).catch(() => {});
  }
  const webNotif = getWebNotifications().get(tag);
  if (webNotif) {
    webNotif.close();
    getWebNotifications().delete(tag);
  }
}

async function fetchSessionTitle(sessionId: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/chat/sessions/${encodeURIComponent(sessionId)}`);
    if (!res.ok) return null;
    const data = await res.json();
    const title = data?.session?.title;
    return typeof title === 'string' && title.trim() ? title : null;
  } catch {
    return null;
  }
}

async function showTurnNotification(sessionId: string, phase: string, navigate: (sessionId: string) => void): Promise<void> {
  const locale = currentLocale();
  const title = (await fetchSessionTitle(sessionId)) ?? 'AI Native Lab';
  const body = phase === 'error'
    ? translate(locale, 'turnNotify.errorBody')
    : translate(locale, 'turnNotify.completedBody');
  const tag = notificationTag(sessionId);

  if (typeof window !== 'undefined' && window.electronAPI?.notification) {
    // Electron: native notification; click → main focuses window + renderer
    // navigates (onClick payload round-trips through notification:click).
    window.electronAPI.notification.show({
      title,
      body,
      tag,
      onClick: { type: 'open-session', payload: sessionId },
    }).catch(() => {});
    return;
  }

  // Browser/dev fallback — HTML5 Notification.
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission === 'default') {
    try { await Notification.requestPermission(); } catch { /* ignore */ }
  }
  if (Notification.permission !== 'granted') return;
  try {
    const webNotif = new Notification(title, { body, tag });
    webNotif.onclick = () => {
      window.focus();
      navigate(sessionId);
      webNotif.close();
      getWebNotifications().delete(tag);
    };
    getWebNotifications().set(tag, webNotif);
  } catch { /* Notification constructor can throw in odd environments */ }
}

/**
 * Install the global turn-completion listener + notification-click handler.
 * Idempotent across HMR and re-mounts; the latest `navigate` always wins.
 */
export function initTurnNotifications(navigate: (sessionId: string) => void): void {
  const g = globalThis as Record<string, unknown>;
  // Keep the freshest navigate (router identity can change across mounts).
  g.__turnNotifyNavigate__ = navigate;
  if (g[INIT_KEY]) return;
  g[INIT_KEY] = true;

  const nav = (sessionId: string) => {
    const fn = (globalThis as Record<string, unknown>).__turnNotifyNavigate__ as ((id: string) => void) | undefined;
    fn?.(sessionId);
  };

  window.addEventListener('stream-session-event', (e: Event) => {
    const event = (e as CustomEvent<StreamEvent>).detail;
    if (!event || event.type !== 'completed') return;
    const phase = event.snapshot?.phase ?? '';
    const decision = shouldNotifyTurnCompletion({
      phase,
      windowFocused: typeof document !== 'undefined' && document.hasFocus(),
      sessionVisible: getVisibleSessions().has(event.sessionId),
    });
    if (decision) void showTurnNotification(event.sessionId, phase, nav);
  });

  // Electron notification click → navigate to the session.
  if (typeof window !== 'undefined' && window.electronAPI?.notification?.onClick) {
    window.electronAPI.notification.onClick((action) => {
      if (action && action.type === 'open-session' && action.payload) {
        nav(action.payload);
      }
    });
  }
}
