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
import { installMac } from './installer-mac';

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
  if (process.platform === 'darwin') return installMac(filePath);
  return { ok: false, error: 'unsupported-platform' };
}

/**
 * Windows (NSIS): launch the installer in UPDATE mode by passing `--updated`.
 *
 * electron-builder's NSIS template sets ${isUpdated} from `--updated`; combined
 * with build/installer.nsh (customInstallMode forces per-user when ${isUpdated}),
 * the installer skips the install-mode / welcome / finish pages and goes straight
 * to the VISIBLE install progress, overwriting the existing per-user install with
 * zero clicks. We do NOT pass `/S` — that would be fully silent (no progress UI),
 * exactly the "user sees nothing" experience we want to avoid.
 *
 * Launched via `cmd /c start` (system component, AV-friendly, and lets us pass
 * the `--updated` arg which shell.openPath cannot); direct spawn as fallback.
 * Manual / website installs run the installer with no args → full wizard.
 */
async function installWindows(filePath: string): Promise<InstallResult> {
  try {
    const child = spawn('cmd.exe', ['/c', 'start', '', filePath, '--updated'], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    logInfo('[updater] windows installer launched (--updated, visible progress, no clicks)');
    return { ok: true };
  } catch (e) {
    logWarn(`[updater] cmd start failed (${(e as Error).message}); trying direct spawn`);
    try {
      const child = spawn(filePath, ['--updated'], { detached: true, stdio: 'ignore' });
      child.unref();
      return { ok: true };
    } catch (e2) {
      return { ok: false, error: (e2 as Error).message };
    }
  }
}
