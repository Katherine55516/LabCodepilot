/**
 * Launch the platform installer (exec-plan §7.2–7.4).
 *
 * `installNow()` returns ok:true once the installer is launched AS AN
 * INDEPENDENT PROCESS — the caller (index.ts) then quits the app after a short
 * delay, because a running app can't replace itself. The before-quit handler in
 * main.ts tears down the bundled server tree (taskkill /T on Windows → also
 * kills the claude.exe SDK subprocesses), releasing file locks on the install
 * dir so the installer can overwrite in place.
 *
 * Dev mode never installs; it reveals the downloaded file instead (dev = mock).
 */

import { app, shell } from 'electron';
import { spawn } from 'child_process';
import { logInfo, logWarn } from '../auth/log';

export interface InstallResult {
  ok: boolean;
  error?: string;
}

export async function installNow(filePath: string): Promise<InstallResult> {
  if (!app.isPackaged) {
    logInfo(`[updater] dev mode — reveal installer instead of running: ${filePath}`);
    shell.showItemInFolder(filePath);
    return { ok: true };
  }
  if (process.platform === 'win32') return installWindows(filePath);
  if (process.platform === 'darwin') {
    // Implemented in Phase 3 (installer-mac.ts: hdiutil + ditto + open).
    return { ok: false, error: 'macos-install-not-implemented' };
  }
  return { ok: false, error: 'unsupported-platform' };
}

/**
 * Windows (NSIS): shell.openPath == double-click setup.exe → NSIS wizard with
 * UAC/SmartScreen, installs to the previous (per-user) path, overwriting. NOT
 * silent (/S spawn is refused elevation / blocked by AV — historical lesson).
 * Fallback to `cmd /c start` (system component, rarely blocked).
 */
async function installWindows(filePath: string): Promise<InstallResult> {
  const err = await shell.openPath(filePath);
  if (!err) {
    logInfo('[updater] windows installer launched via shell.openPath');
    return { ok: true };
  }
  logWarn(`[updater] shell.openPath failed (${err}); falling back to cmd start`);
  try {
    const child = spawn('cmd.exe', ['/c', 'start', '', filePath], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
