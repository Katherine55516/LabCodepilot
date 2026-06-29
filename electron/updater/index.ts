/**
 * Native auto-updater orchestrator (research-platform V2).
 *
 * Drives the full lifecycle in the main process; the renderer's
 * window.electronAPI.updater contract + useUpdateChecker native branch consume it:
 *
 *   renderer ──IPC `updater:check` / `:download` / `:install`──► main
 *            ◄──push `updater:status`── checking|available|not-available|
 *                                       downloading|downloaded|error
 *
 * - Check: authenticated V2 /check (Bearer auto-injected).
 * - Download: user-initiated (check-only policy); CDN直链 + sha256/size 校验 +
 *   三层避免重下 + pending-update.json 跨会话复用（downloader.ts）.
 * - Install: shell.openPath (win) / hdiutil+ditto (mac, Phase 3); then app.quit()
 *   so the independent installer overwrites in place（installer.ts）.
 */

import { app, ipcMain, type BrowserWindow } from 'electron';
import * as fs from 'fs';
import { checkUpdateV2, type CheckResult } from './client';
import { getUpdateQueryParams } from './platform';
import { isNewerVersion } from './version';
import {
  ensureInstaller,
  installerPath,
  sha256File,
  writePending,
  readPending,
  clearPending,
  deleteInstallerFile,
  type PendingUpdate,
} from './downloader';
import { installNow } from './installer';
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

/** Internal normalized view of an available update. */
interface UpdateMeta {
  version: string;
  downloadUrl: string;
  sha256: string;
  fileSize: number;
  mustUpgrade: boolean;
  releaseNotes: string;
  releaseDate: string;
}

const CHECK_INTERVAL_MS = 8 * 60 * 60 * 1000; // 8h periodic re-check

let getWindow: (() => BrowserWindow | null) | null = null;
let lastStatus: UpdaterStatusEvent | null = null;
let checking = false;
let downloading = false;
let periodicTimer: NodeJS.Timeout | null = null;

let current: UpdateMeta | null = null; // latest update the server is offering
let readyPath: string | null = null; // a locally verified installer ready to install
let cachedInstaller: PendingUpdate | null = null; // validated pending from disk (download cache)
let pendingLoadPromise: Promise<void> | null = null;

function pushStatus(event: UpdaterStatusEvent): void {
  lastStatus = event;
  try {
    const win = getWindow?.();
    if (win && !win.isDestroyed()) win.webContents.send('updater:status', event);
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

function metaFromCheck(r: CheckResult): UpdateMeta | null {
  if (!r.has_update || !r.latest_version || !r.download_url || !r.sha256) return null;
  return {
    version: r.latest_version,
    downloadUrl: r.download_url,
    sha256: r.sha256,
    fileSize: r.file_size ?? 0,
    mustUpgrade: r.must_upgrade,
    releaseNotes: r.release_notes ?? '',
    releaseDate: r.released_at ?? '',
  };
}

function metaFromPending(p: PendingUpdate): UpdateMeta {
  return {
    version: p.version,
    downloadUrl: p.downloadUrl,
    sha256: p.sha256,
    fileSize: p.fileSize,
    mustUpgrade: p.mustUpgrade,
    releaseNotes: p.releaseNotes,
    releaseDate: p.releaseDate,
  };
}

function availableEvent(m: UpdateMeta): UpdaterStatusEvent {
  return {
    status: 'available',
    info: {
      version: m.version,
      releaseNotes: m.releaseNotes,
      releaseName: m.version,
      releaseDate: m.releaseDate || undefined,
      mustUpgrade: m.mustUpgrade,
    },
  };
}

/** Drop a stale download cache (different version than what's now offered). */
function dropCache(): void {
  if (cachedInstaller) {
    deleteInstallerFile(cachedInstaller.filePath);
    cachedInstaller = null;
  }
  clearPending();
  readyPath = null;
}

/**
 * Run a V2 check and push the resulting status. Reuses a cross-session cached
 * installer when the server's latest version matches it (→ straight to
 * "downloaded"); on network error, falls back to a valid cached installer.
 */
export async function checkForUpdates(): Promise<UpdaterStatusEvent> {
  if (checking) return lastStatus ?? { status: 'checking' };
  const params = getUpdateQueryParams();
  if (!params) {
    const ev: UpdaterStatusEvent = { status: 'not-available' };
    pushStatus(ev);
    return ev;
  }

  // Make sure any on-disk pending installer has been validated before we decide
  // whether to reuse it (avoids re-downloading 100MB+ on launch).
  await (pendingLoadPromise ?? Promise.resolve());

  checking = true;
  pushStatus({ status: 'checking' });
  try {
    const result = await checkUpdateV2(params);
    const meta = metaFromCheck(result);
    const installed = app.getVersion();
    // Defensive client-side guard: only surface an update when the server's
    // latest is STRICTLY newer than the installed build. The server's has_update
    // can be true while latest_version is older or equal to what's installed
    // (e.g. a local / manual build ahead of the version the platform currently
    // hosts) — in that case we must NOT prompt, let alone force, a "downgrade".
    if (meta && isNewerVersion(meta.version, installed)) {
      current = meta;
      pushStatus(availableEvent(meta));
      if (
        cachedInstaller &&
        cachedInstaller.version === meta.version &&
        fs.existsSync(cachedInstaller.filePath)
      ) {
        readyPath = cachedInstaller.filePath;
        pushStatus({ status: 'downloaded' });
        return { status: 'downloaded' };
      }
      // Cache is for a different/older version → discard it.
      if (cachedInstaller && cachedInstaller.version !== meta.version) dropCache();
      readyPath = null;
      return lastStatus ?? availableEvent(meta);
    }
    if (meta) {
      logInfo(
        `[updater] server offered ${meta.version} but installed ${installed} is newer or equal — ignoring`,
      );
    }
    // No applicable update (server reported none, or offered a non-newer
    // version) — discard any stale cache and report.
    current = null;
    if (cachedInstaller) dropCache();
    const ev: UpdaterStatusEvent = { status: 'not-available' };
    pushStatus(ev);
    return ev;
  } catch (e) {
    const kind = classifyError(e);
    logWarn(`[updater] check failed: ${kind}`);
    // Offline fallback: if we have a validated cached installer, surface it.
    if (kind === 'network' && cachedInstaller && fs.existsSync(cachedInstaller.filePath)) {
      current = metaFromPending(cachedInstaller);
      readyPath = cachedInstaller.filePath;
      pushStatus(availableEvent(current));
      pushStatus({ status: 'downloaded' });
      return { status: 'downloaded' };
    }
    const ev: UpdaterStatusEvent = { status: 'error', error: kind };
    pushStatus(ev);
    return ev;
  } finally {
    checking = false;
  }
}

/** User-initiated download + verify of the current update; persists pending. */
export async function downloadUpdate(): Promise<{ ok: boolean; error?: string }> {
  if (!current) return { ok: false, error: 'no-update' };
  if (downloading) return { ok: false, error: 'already-downloading' };

  const meta = current;
  const pending: PendingUpdate = {
    version: meta.version,
    filePath: installerPath(meta.version),
    sha256: meta.sha256,
    fileSize: meta.fileSize,
    mustUpgrade: meta.mustUpgrade,
    downloadUrl: meta.downloadUrl,
    releaseNotes: meta.releaseNotes,
    releaseDate: meta.releaseDate,
  };

  downloading = true;
  try {
    const filePath = await ensureInstaller(pending, (transferred, total) => {
      const percent = total > 0 ? Math.min(100, (transferred / total) * 100) : 0;
      pushStatus({ status: 'downloading', progress: { percent, bytesPerSecond: 0, transferred, total } });
    });
    pending.filePath = filePath;
    writePending(pending);
    cachedInstaller = pending;
    readyPath = filePath;
    pushStatus({ status: 'downloaded' });
    return { ok: true };
  } catch (e) {
    const kind = classifyError(e);
    logWarn(`[updater] download failed: ${kind}`);
    pushStatus({ status: 'error', error: kind });
    return { ok: false, error: kind };
  } finally {
    downloading = false;
  }
}

/** Launch the installer and quit so it can overwrite in place. */
export async function quitAndInstall(): Promise<{ ok: boolean; error?: string }> {
  const filePath = readyPath || readPending()?.filePath || null;
  if (!filePath || !fs.existsSync(filePath)) {
    pushStatus({ status: 'error', error: 'installer-missing' });
    return { ok: false, error: 'installer-missing' };
  }
  const result = await installNow(filePath);
  if (!result.ok) {
    pushStatus({ status: 'error', error: result.error ?? 'install-failed' });
    return result;
  }
  // Installer is an independent process now; quit after a short delay so it can
  // replace the app. before-quit tears down the server tree (taskkill /T on win
  // → also kills claude.exe SDK subprocesses), releasing install-dir file locks.
  logInfo('[updater] installer launched — quitting to apply update');
  setTimeout(() => app.quit(), 800);
  return { ok: true };
}

/**
 * Validate any pending-update.json on disk (version newer than current + file
 * present + sha256 matches) and cache it for reuse. Does NOT push status — the
 * renderer-triggered check() consumes the cache once it's loaded.
 */
async function loadPendingFromDisk(): Promise<void> {
  const p = readPending();
  if (!p) return;
  const cur = app.getVersion();

  if (!isNewerVersion(p.version, cur)) {
    logInfo(`[updater] pending ${p.version} not newer than ${cur} — clearing`);
    clearPending();
    deleteInstallerFile(p.filePath);
    return;
  }
  if (!p.filePath || !fs.existsSync(p.filePath)) {
    clearPending();
    return;
  }
  try {
    const actual = await sha256File(p.filePath);
    if (actual.toLowerCase() !== (p.sha256 || '').toLowerCase()) {
      logWarn('[updater] pending sha256 mismatch — clearing');
      clearPending();
      deleteInstallerFile(p.filePath);
      return;
    }
  } catch {
    clearPending();
    return;
  }

  cachedInstaller = p;
  logInfo(`[updater] cached installer ready for ${p.version}`);
}

export function initUpdater(windowGetter: () => BrowserWindow | null): void {
  getWindow = windowGetter;
  // Validate a previously-downloaded installer (cross-session reuse). Kept as a
  // promise so the first check() awaits it before deciding to re-download.
  pendingLoadPromise = loadPendingFromDisk();
  if (!periodicTimer) {
    periodicTimer = setInterval(() => {
      void checkForUpdates();
    }, CHECK_INTERVAL_MS);
    periodicTimer.unref?.();
  }
}

export function stopUpdater(): void {
  if (periodicTimer) {
    clearInterval(periodicTimer);
    periodicTimer = null;
  }
}

export function registerUpdaterIpc(): void {
  ipcMain.handle('updater:check', async () => checkForUpdates());
  ipcMain.handle('updater:download', async () => downloadUpdate());
  ipcMain.handle('updater:install', async () => quitAndInstall());
}
