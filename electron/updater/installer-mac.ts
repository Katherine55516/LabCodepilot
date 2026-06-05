/**
 * macOS DMG install (exec-plan §7.4, inlined from sibling project).
 *
 * A running .app can't replace itself, and a DMG has no silent protocol, so we
 * write a detached bash script that: waits for the parent (main process) to
 * exit → mounts the DMG → `ditto` the new .app over the current bundle (ditto
 * preserves code signature / xattrs / resource forks) → detaches + deletes the
 * DMG → `open`s the updated app → self-deletes. Any failure falls back to
 * `open DMG` for manual drag-install. arm64 only (decision #3).
 */

import { app, shell } from 'electron';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { logInfo, logWarn } from '../auth/log';

export interface InstallResult {
  ok: boolean;
  error?: string;
}

/**
 * The running .app bundle. process.execPath is
 * `/Applications/AI Native Lab.app/Contents/MacOS/AI Native Lab` → up 3 levels.
 */
function appBundlePath(): string {
  return path.resolve(process.execPath, '..', '..', '..');
}

/** Reject shell-dangerous chars; these paths are system-controlled so this is belt-and-braces. */
function isUnsafePath(p: string): boolean {
  return /["`$]/.test(p);
}

function openDmgFallback(dmgPath: string): InstallResult {
  try {
    void shell.openPath(dmgPath);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function installMac(dmgPath: string): Promise<InstallResult> {
  const bundle = appBundlePath();

  if (isUnsafePath(dmgPath) || isUnsafePath(bundle)) {
    logWarn('[updater] mac install: unsafe path, opening DMG for manual install');
    return openDmgFallback(dmgPath);
  }
  if (!bundle.endsWith('.app')) {
    logWarn(`[updater] mac install: not running from a .app (${bundle}); opening DMG`);
    return openDmgFallback(dmgPath);
  }

  const pid = process.pid;
  const mountPoint = path.join(os.tmpdir(), `anlcode-update-mount-${pid}`);
  const logFile = path.join(app.getPath('logs'), `update-${Date.now()}.log`);
  const scriptPath = path.join(os.tmpdir(), `anlcode-update-${pid}.sh`);

  const script = `#!/bin/bash
set -u
LOG="${logFile}"
mkdir -p "$(dirname "$LOG")" 2>/dev/null
log() { echo "[$(date '+%H:%M:%S')] $1" >> "$LOG" 2>/dev/null; }
DMG="${dmgPath}"
APP="${bundle}"
MOUNT="${mountPoint}"
PARENT_PID=${pid}

log "waiting for parent $PARENT_PID to exit"
for i in $(seq 1 60); do
  kill -0 "$PARENT_PID" 2>/dev/null || break
  sleep 0.5
done
sleep 1

fallback() {
  log "fallback: open DMG for manual install"
  open "$DMG"
  rm -f "$0"
  exit 0
}

log "attaching $DMG"
hdiutil attach "$DMG" -nobrowse -noverify -mountpoint "$MOUNT" >> "$LOG" 2>&1 || fallback

NEWAPP="$(/bin/ls -d "$MOUNT"/*.app 2>/dev/null | head -n 1)"
if [ -z "$NEWAPP" ]; then
  log "no .app found in DMG"
  hdiutil detach "$MOUNT" >> "$LOG" 2>&1
  fallback
fi

log "replacing $APP with $NEWAPP via ditto"
rm -rf "$APP" >> "$LOG" 2>&1
ditto "$NEWAPP" "$APP" >> "$LOG" 2>&1
RC=$?
hdiutil detach "$MOUNT" >> "$LOG" 2>&1
if [ $RC -ne 0 ]; then
  log "ditto failed rc=$RC"
  fallback
fi

rm -f "$DMG" >> "$LOG" 2>&1
log "launching updated app"
open "$APP" >> "$LOG" 2>&1
rm -f "$0"
`;

  try {
    fs.writeFileSync(scriptPath, script, { mode: 0o755 });
  } catch (e) {
    return { ok: false, error: `write-script: ${(e as Error).message}` };
  }

  try {
    const child = spawn('/bin/bash', [scriptPath], { detached: true, stdio: 'ignore' });
    child.unref();
    logInfo(`[updater] mac install script spawned (${scriptPath})`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
