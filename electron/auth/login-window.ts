/**
 * Login BrowserWindow lifecycle — runs deliberately independent from the
 * main app window and from the OpenAI OAuth flow.
 *
 * The window itself just hosts a "login" button + optional "skip" link.
 * Real OAuth work happens in client.ts:loginViaBrowser; this module owns
 * the window, the resolution state machine, and the IPC bridge to login.js.
 *
 * Result tag union — every path leads to one of three terminal states:
 *   - 'success'    : token landed on disk, app can proceed to startup
 *   - 'skipped'    : user clicked "skip" — only possible when allowSkip=true
 *   - 'cancelled'  : user closed the window without action
 */

import { app, BrowserWindow } from 'electron';
import * as path from 'path';

import { logInfo } from './log';

export type LoginOutcome = 'success' | 'skipped' | 'cancelled';

let loginWindow: BrowserWindow | null = null;
let resolver: ((outcome: LoginOutcome) => void) | null = null;
let settled = false;

const WINDOW_OPTIONS = {
  width: 480,
  height: 460,
  resizable: false,
  minimizable: true,
  maximizable: false,
  fullscreenable: false,
  title: 'CodePilot — 登录账号',
  backgroundColor: '#0a0a0a',
} as const;

/**
 * Resolve `electron/login/index.html` for both dev and packaged builds.
 *
 * Dev: file lives at <repo>/electron/login/index.html. We use process.cwd()
 *      (same convention as getIconPath in main.ts).
 * Packaged: electron-builder is configured to copy electron/login/ → Resources/login/.
 */
function getLoginHtmlPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'login', 'index.html');
  }
  return path.join(process.cwd(), 'electron', 'login', 'index.html');
}

export function isLoginWindowOpen(): boolean {
  return !!loginWindow && !loginWindow.isDestroyed();
}

export function focusLoginWindow(): void {
  if (loginWindow && !loginWindow.isDestroyed()) {
    if (loginWindow.isMinimized()) loginWindow.restore();
    loginWindow.focus();
  }
}

/**
 * Open (or focus, if already open) the login window. The returned promise
 * resolves only once the user's flow lands on a terminal state.
 *
 * Re-entrancy: if the window is already open and a previous caller is
 * awaiting, the second caller is rejected so callers always own a single
 * resolution.
 */
export function openLoginWindow(opts: { allowSkip: boolean }): Promise<LoginOutcome> {
  if (loginWindow && !loginWindow.isDestroyed()) {
    focusLoginWindow();
    return Promise.reject(new Error('login window already open'));
  }
  return new Promise<LoginOutcome>((resolve) => {
    settled = false;
    resolver = resolve;

    loginWindow = new BrowserWindow({
      ...WINDOW_OPTIONS,
      icon: getIconPathSafe(),
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    loginWindow.setMenuBarVisibility(false);

    const hash = opts.allowSkip ? 'allow-skip' : '';
    loginWindow.loadFile(getLoginHtmlPath(), { hash }).catch((err) => {
      logInfo('login window loadFile failed:', err);
      settleOutcome('cancelled');
    });

    loginWindow.on('closed', () => {
      loginWindow = null;
      // If we hadn't already resolved (e.g. user closed via the [X] button),
      // treat as cancellation.
      if (!settled) settleOutcome('cancelled');
    });
  });
}

/**
 * Try to use the app icon, but never throw if it's missing — the window
 * still opens correctly with the platform default.
 */
function getIconPathSafe(): string | undefined {
  try {
    if (app.isPackaged) {
      if (process.platform === 'win32') return path.join(process.resourcesPath, 'icon.ico');
      if (process.platform === 'linux') return path.join(process.resourcesPath, 'icon.png');
      return path.join(process.resourcesPath, 'icon.icns');
    }
    return path.join(process.cwd(), 'build', 'icon.png');
  } catch {
    return undefined;
  }
}

// ── Called by main.ts in response to IPC events ─────────────────────────────

/**
 * Mark the login flow as successful. Closes the window after a short delay
 * so the renderer can show a "✓ 登录成功" flash.
 */
export function notifyLoginSuccess(): void {
  settleOutcome('success');
  // Slight delay lets login.js show its success state before the window pops.
  setTimeout(() => {
    if (loginWindow && !loginWindow.isDestroyed()) loginWindow.close();
  }, 350);
}

/**
 * User opted out via the "skip" link (only available on first-run when
 * allowSkip=true). Close the window immediately.
 */
export function notifyLoginSkip(): void {
  settleOutcome('skipped');
  if (loginWindow && !loginWindow.isDestroyed()) loginWindow.close();
}

/**
 * Manually cancel (used when boot sequence detects a fatal error mid-flow
 * and wants to tear the window down).
 */
export function cancelLoginWindow(reason?: string): void {
  if (reason) logInfo('login window cancelled:', reason);
  settleOutcome('cancelled');
  if (loginWindow && !loginWindow.isDestroyed()) loginWindow.close();
}

function settleOutcome(o: LoginOutcome): void {
  if (settled) return;
  settled = true;
  if (resolver) {
    const r = resolver;
    resolver = null;
    r(o);
  }
}
