/**
 * Native auto-updater orchestrator (research-platform V2).
 *
 * Replaces the old DISABLED stub. Drives the full update lifecycle in the main
 * process (the renderer's `window.electronAPI.updater` contract + the
 * useUpdateChecker native branch are already built for this):
 *
 *   renderer ──IPC `updater:check`──► checkForUpdates() ──► V2 /check
 *            ◄──push `updater:status`── { checking | available | not-available | error }
 *
 * Phase 1 scope: check + notify only. Download (`updater:download`) and install
 * (`updater:install`) are stubbed here and land in Phase 2/3
 * (downloader.ts / installer.ts).
 *
 * Decisions: check-only（不自动下载，用户点击才下）; channel=stable; win-x64 / mac-arm64.
 */

import { ipcMain, type BrowserWindow } from 'electron';
import { checkUpdateV2 } from './client';
import { getUpdateQueryParams } from './platform';
import { logInfo, logWarn } from '../auth/log';
import { AuthExpiredError, HttpError, NetworkError } from '../auth/types';

/** Mirrors src/types/electron.d.ts UpdateStatusEvent (renderer-side contract). */
export interface UpdaterStatusEvent {
  status: 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
  info?: {
    version: string;
    releaseNotes?: string | null;
    releaseName?: string | null;
    releaseDate?: string;
    mustUpgrade?: boolean;
  };
  progress?: { percent: number; bytesPerSecond: number; transferred: number; total: number };
  error?: string;
}

// 8h periodic re-check (check-only; renderer decides whether to prompt).
const CHECK_INTERVAL_MS = 8 * 60 * 60 * 1000;

let getWindow: (() => BrowserWindow | null) | null = null;
let lastStatus: UpdaterStatusEvent | null = null;
let checking = false;
let periodicTimer: NodeJS.Timeout | null = null;

function pushStatus(event: UpdaterStatusEvent): void {
  lastStatus = event;
  try {
    const win = getWindow?.();
    if (win && !win.isDestroyed()) {
      win.webContents.send('updater:status', event);
    }
  } catch {
    /* window gone — ignore */
  }
}

function classifyError(e: unknown): string {
  if (e instanceof AuthExpiredError) return 'auth-expired';
  if (e instanceof NetworkError) return 'network';
  if (e instanceof HttpError) return `http-${e.status}`;
  return e instanceof Error ? e.message : String(e);
}

/**
 * Run a V2 check and push the resulting status to the renderer.
 * Idempotent / debounced — concurrent calls collapse to the in-flight one.
 * Returns the resulting status (also usable directly by the IPC caller).
 */
export async function checkForUpdates(): Promise<UpdaterStatusEvent> {
  if (checking) return lastStatus ?? { status: 'checking' };

  const params = getUpdateQueryParams();
  if (!params) {
    // Unsupported platform (e.g. linux) — treat as no update.
    const ev: UpdaterStatusEvent = { status: 'not-available' };
    pushStatus(ev);
    return ev;
  }

  checking = true;
  pushStatus({ status: 'checking' });
  try {
    const result = await checkUpdateV2(params);
    let ev: UpdaterStatusEvent;
    // has_update is authoritative (api doc §5). When true, carry latest metadata.
    if (result.has_update && result.latest_version) {
      ev = {
        status: 'available',
        info: {
          version: result.latest_version,
          releaseNotes: result.release_notes,
          releaseName: result.latest_version,
          releaseDate: result.released_at ?? undefined,
          mustUpgrade: result.must_upgrade,
        },
      };
      logInfo(`[updater] update available: ${result.latest_version} (must_upgrade=${result.must_upgrade})`);
    } else {
      ev = { status: 'not-available' };
    }
    pushStatus(ev);
    return ev;
  } catch (e) {
    const kind = classifyError(e);
    logWarn(`[updater] check failed: ${kind}`);
    const ev: UpdaterStatusEvent = { status: 'error', error: kind };
    pushStatus(ev);
    return ev;
  } finally {
    checking = false;
  }
}

/**
 * Wire the updater to a window getter and start the periodic background check.
 * The first check is triggered by the renderer (useUpdateChecker on mount) so
 * the onStatus listener is guaranteed registered before any result is pushed.
 */
export function initUpdater(windowGetter: () => BrowserWindow | null): void {
  getWindow = windowGetter;
  if (!periodicTimer) {
    periodicTimer = setInterval(() => {
      void checkForUpdates();
    }, CHECK_INTERVAL_MS);
    // Don't keep the event loop alive past app.quit() (mirrors auth poller).
    periodicTimer.unref?.();
  }
}

export function stopUpdater(): void {
  if (periodicTimer) {
    clearInterval(periodicTimer);
    periodicTimer = null;
  }
}

/** Register the renderer-facing IPC. Call once during app boot. */
export function registerUpdaterIpc(): void {
  ipcMain.handle('updater:check', async () => {
    return checkForUpdates();
  });

  // Phase 2/3: real download + install. Honest stubs until then so the
  // renderer can branch on a clear error instead of a silent no-op.
  ipcMain.handle('updater:download', async () => {
    return { ok: false as const, error: 'not-implemented' };
  });
  ipcMain.handle('updater:install', async () => {
    return { ok: false as const, error: 'not-implemented' };
  });
}
