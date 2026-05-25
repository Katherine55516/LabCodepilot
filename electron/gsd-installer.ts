/**
 * GSD vendor bundle installer (electron main-process module).
 *
 * Responsibility: synchronize the bundled GSD plugin
 * (vendor/gsd-bundle/ packed as extraResources/gsd-bundle/ at build time)
 * to the user's `~/.claude/plugins/external_plugins/codepilot-gsd-vendor/`
 * directory at app boot, so CodePilot's slash-command scanner picks up the
 * `/gsd-*` commands automatically. Also mirrors agent definitions to
 * `~/.claude/agents/gsd-*.md` so Claude Code's subagent resolver can find
 * them when commands spawn agents via the Agent tool.
 *
 * Design notes:
 * - Pure-logic helpers are exported separately from the IPC wiring so they
 *   can be unit-tested without spinning up Electron.
 * - Every fs operation is wrapped — installer failure must NOT block the
 *   main window. Errors are logged and surfaced via getStatus().
 * - Conflict policy:
 *   - Plugin dir (`commands/`, `agents/`, `LICENSE`, `plugin.json`, `VERSION`)
 *     is fully owned by the installer; sync overwrites everything except an
 *     optional `extras/` subdir (user-added customizations) and a `.disabled`
 *     marker file.
 *   - `~/.claude/agents/gsd-*.md` mirror: only writes when target is absent
 *     OR contents hash matches; if hash differs (= user has local
 *     modifications or installed official GSD), the file is left alone and
 *     a conflict is recorded.
 * - Disabling: writing `<installPath>/.disabled` flag causes install() to
 *   skip. To keep CodePilot's scanner from picking up the commands while
 *   disabled, we rename `commands/` -> `commands.disabled/` (scanner only
 *   reads `commands/`). Re-enabling renames back.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";

// ────────────────────────── types ──────────────────────────

export interface PluginManifest {
  name: string;
  displayName: string;
  description: string;
  source: string;
  sourceUrl?: string;
  sourceCommit: string;
  transformVersion: number;
  license: string;
  licenseFile?: string;
  commandCount: number;
  agentCount: number;
  commandPrefix: string;
  bundledAt?: string;
}

export interface GsdConflict {
  agentName: string;
  reason: "hash-mismatch";
  targetPath: string;
}

export interface GsdInstallStatus {
  enabled: boolean;
  installed: boolean;
  bundledVersion: string | null;
  installedVersion: string | null;
  needsSync: boolean;
  manifest: PluginManifest | null;
  installPath: string;
  agentsMirrorPath: string;
  conflicts: GsdConflict[];
  lastError?: string;
}

export interface InstallerPaths {
  bundleDir: string;        // source bundle (resources or dev vendor/)
  installPath: string;      // ~/.claude/plugins/external_plugins/codepilot-gsd-vendor/
  agentsMirrorPath: string; // ~/.claude/agents/
}

// ────────────────────────── path resolution ──────────────────────────

const PLUGIN_DIR_NAME = "codepilot-gsd-vendor";

export function getInstallPath(homedir: string = os.homedir()): string {
  return path.join(
    homedir,
    ".claude",
    "plugins",
    "external_plugins",
    PLUGIN_DIR_NAME,
  );
}

export function getAgentsMirrorPath(homedir: string = os.homedir()): string {
  return path.join(homedir, ".claude", "agents");
}

/**
 * Resolve the bundle dir. In production (packaged), files are at
 * `<process.resourcesPath>/gsd-bundle/` (placed there by electron-builder
 * extraResources). In dev, fall back to `<repo>/vendor/gsd-bundle/`
 * (produced by `npm run vendor:gsd`).
 */
export function getBundleDir(): string {
  // process.resourcesPath is undefined when not running inside Electron
  // (e.g. unit tests). Guard so that pure fs tests still work.
  const resPath = (process as unknown as { resourcesPath?: string })
    .resourcesPath;
  if (resPath) {
    const prodDir = path.join(resPath, "gsd-bundle");
    if (fs.existsSync(prodDir)) return prodDir;
  }
  // dev fallback: this file is compiled to dist-electron/gsd-installer.js,
  // so __dirname/../vendor/gsd-bundle/ points to repo root.
  return path.join(__dirname, "..", "vendor", "gsd-bundle");
}

export function defaultPaths(homedir: string = os.homedir()): InstallerPaths {
  return {
    bundleDir: getBundleDir(),
    installPath: getInstallPath(homedir),
    agentsMirrorPath: getAgentsMirrorPath(homedir),
  };
}

// ────────────────────────── pure helpers (testable) ──────────────────────────

export function sha1Buffer(buf: Buffer): string {
  return crypto.createHash("sha1").update(buf).digest("hex");
}

export function sha1File(filepath: string): string {
  return sha1Buffer(fs.readFileSync(filepath));
}

export function readFileTrim(filepath: string): string | null {
  try {
    return fs.readFileSync(filepath, "utf-8").trim();
  } catch {
    return null;
  }
}

export function safeReadJson<T>(filepath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filepath, "utf-8")) as T;
  } catch {
    return null;
  }
}

export function rmrf(target: string): void {
  if (fs.existsSync(target)) {
    fs.rmSync(target, { recursive: true, force: true });
  }
}

export function copyDirShallow(src: string, dst: string): void {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dst, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const ent of entries) {
    const s = path.join(src, ent.name);
    const d = path.join(dst, ent.name);
    if (ent.isDirectory()) {
      copyDirShallow(s, d);
    } else if (ent.isFile()) {
      fs.copyFileSync(s, d);
    }
  }
}

// ────────────────────────── manifest / version ──────────────────────────

export function readManifest(bundleDir: string): PluginManifest | null {
  return safeReadJson<PluginManifest>(path.join(bundleDir, "plugin.json"));
}

export function readBundledVersion(bundleDir: string): string | null {
  return readFileTrim(path.join(bundleDir, "VERSION"));
}

export function readInstalledVersion(installPath: string): string | null {
  return readFileTrim(path.join(installPath, "VERSION"));
}

export function isDisabled(installPath: string): boolean {
  return fs.existsSync(path.join(installPath, ".disabled"));
}

const CONFLICTS_LOG = ".conflicts.json";

function readConflictsLog(installPath: string): GsdConflict[] {
  return (
    safeReadJson<GsdConflict[]>(path.join(installPath, CONFLICTS_LOG)) ?? []
  );
}

function writeConflictsLog(installPath: string, conflicts: GsdConflict[]): void {
  try {
    fs.writeFileSync(
      path.join(installPath, CONFLICTS_LOG),
      JSON.stringify(conflicts, null, 2) + "\n",
      "utf-8",
    );
  } catch {
    // best-effort; conflicts will just not persist this round
  }
}

// ────────────────────────── status ──────────────────────────

export function getStatus(
  paths: InstallerPaths = defaultPaths(),
): GsdInstallStatus {
  const manifest = readManifest(paths.bundleDir);
  const bundledVersion = readBundledVersion(paths.bundleDir);
  const installedVersion = readInstalledVersion(paths.installPath);
  const installedDirExists = fs.existsSync(paths.installPath);
  const enabled = installedDirExists ? !isDisabled(paths.installPath) : true;
  const needsSync =
    bundledVersion !== null && installedVersion !== bundledVersion;
  const conflicts = installedDirExists ? readConflictsLog(paths.installPath) : [];
  return {
    enabled,
    installed: installedDirExists,
    bundledVersion,
    installedVersion,
    needsSync,
    manifest,
    installPath: paths.installPath,
    agentsMirrorPath: paths.agentsMirrorPath,
    conflicts,
  };
}

// ────────────────────────── sync ──────────────────────────

/**
 * Atomically (best-effort) replace install path contents with bundle contents.
 * Preserves the user's optional `extras/` subdirectory and `.disabled` marker.
 */
function syncPluginDir(bundleDir: string, installPath: string): void {
  // Preserve extras/ and .disabled across sync
  const extrasSrc = path.join(installPath, "extras");
  const hasExtras = fs.existsSync(extrasSrc);
  const disabledMarker = path.join(installPath, ".disabled");
  const wasDisabled = fs.existsSync(disabledMarker);

  let extrasBackup: string | null = null;
  if (hasExtras) {
    extrasBackup = path.join(
      os.tmpdir(),
      `codepilot-gsd-extras-${Date.now()}-${process.pid}`,
    );
    copyDirShallow(extrasSrc, extrasBackup);
  }

  // Wipe install dir (except parents) and recreate
  rmrf(installPath);
  fs.mkdirSync(installPath, { recursive: true });

  // Copy bundle contents
  for (const entry of fs.readdirSync(bundleDir, { withFileTypes: true })) {
    // skip the dev/debug transform-report.json — it's only useful at vendor
    // time, not at runtime. Keeping it out of the user's disk avoids confusion.
    if (entry.name === "transform-report.json") continue;
    const src = path.join(bundleDir, entry.name);
    const dst = path.join(installPath, entry.name);
    if (entry.isDirectory()) copyDirShallow(src, dst);
    else if (entry.isFile()) fs.copyFileSync(src, dst);
  }

  // Restore extras
  if (extrasBackup) {
    copyDirShallow(extrasBackup, path.join(installPath, "extras"));
    rmrf(extrasBackup);
  }

  // Re-apply disabled marker (sync resets commands/, so re-rename if needed)
  if (wasDisabled) {
    fs.writeFileSync(disabledMarker, "", "utf-8");
    const cmdDir = path.join(installPath, "commands");
    const cmdDirDisabled = path.join(installPath, "commands.disabled");
    if (fs.existsSync(cmdDir)) {
      rmrf(cmdDirDisabled);
      fs.renameSync(cmdDir, cmdDirDisabled);
    }
  }
}

/**
 * Mirror bundle agents/*.md to `~/.claude/agents/`. Returns list of conflicts.
 */
function mirrorAgents(
  bundleDir: string,
  agentsMirrorPath: string,
): GsdConflict[] {
  const conflicts: GsdConflict[] = [];
  const srcAgents = path.join(bundleDir, "agents");
  if (!fs.existsSync(srcAgents)) return conflicts;

  fs.mkdirSync(agentsMirrorPath, { recursive: true });

  for (const name of fs.readdirSync(srcAgents)) {
    if (!name.endsWith(".md")) continue;
    const srcFile = path.join(srcAgents, name);
    const dstFile = path.join(agentsMirrorPath, name);

    const srcBuf = fs.readFileSync(srcFile);

    if (!fs.existsSync(dstFile)) {
      fs.writeFileSync(dstFile, srcBuf);
      continue;
    }
    // Hash compare
    const dstBuf = fs.readFileSync(dstFile);
    if (sha1Buffer(srcBuf) === sha1Buffer(dstBuf)) {
      // identical — nothing to do
      continue;
    }
    // Different — user-modified or another GSD install. Skip + record.
    conflicts.push({
      agentName: name.replace(/\.md$/, ""),
      reason: "hash-mismatch",
      targetPath: dstFile,
    });
  }

  return conflicts;
}

// ────────────────────────── api ──────────────────────────

export interface InstallOptions {
  paths?: InstallerPaths;
  force?: boolean; // if true, sync even when versions match (used by resync())
  log?: (msg: string) => void;
}

export function install(opts: InstallOptions = {}): GsdInstallStatus {
  const paths = opts.paths ?? defaultPaths();
  const log = opts.log ?? (() => {});

  // If disabled, refuse to touch anything except return current status.
  if (fs.existsSync(paths.installPath) && isDisabled(paths.installPath)) {
    log("[gsd-installer] plugin is disabled, skipping sync");
    return getStatus(paths);
  }

  const status = getStatus(paths);
  if (!status.manifest || status.bundledVersion === null) {
    const msg = `bundle missing or invalid at ${paths.bundleDir}`;
    log(`[gsd-installer] ${msg}`);
    return { ...status, lastError: msg };
  }

  if (!opts.force && !status.needsSync) {
    log(
      `[gsd-installer] up-to-date (version=${status.installedVersion}), skipping`,
    );
    return status;
  }

  try {
    log(
      `[gsd-installer] syncing: ${status.installedVersion ?? "<none>"} -> ${status.bundledVersion}`,
    );
    syncPluginDir(paths.bundleDir, paths.installPath);
    const conflicts = mirrorAgents(paths.bundleDir, paths.agentsMirrorPath);
    writeConflictsLog(paths.installPath, conflicts);
    log(
      `[gsd-installer] sync done. agent mirror conflicts: ${conflicts.length}`,
    );
    return getStatus(paths);
  } catch (err) {
    const msg = (err as Error).message;
    log(`[gsd-installer] sync FAILED: ${msg}`);
    return { ...getStatus(paths), lastError: msg };
  }
}

export function resync(opts: InstallOptions = {}): GsdInstallStatus {
  return install({ ...opts, force: true });
}

export function disable(opts: InstallOptions = {}): GsdInstallStatus {
  const paths = opts.paths ?? defaultPaths();
  const log = opts.log ?? (() => {});
  try {
    if (!fs.existsSync(paths.installPath)) {
      // Nothing installed — write disabled marker preemptively
      fs.mkdirSync(paths.installPath, { recursive: true });
    }
    fs.writeFileSync(path.join(paths.installPath, ".disabled"), "", "utf-8");
    // Hide commands from scanner: rename commands/ -> commands.disabled/
    const cmdDir = path.join(paths.installPath, "commands");
    const cmdDirDisabled = path.join(paths.installPath, "commands.disabled");
    if (fs.existsSync(cmdDir)) {
      rmrf(cmdDirDisabled);
      fs.renameSync(cmdDir, cmdDirDisabled);
    }
    log("[gsd-installer] disabled");
  } catch (err) {
    log(`[gsd-installer] disable FAILED: ${(err as Error).message}`);
  }
  return getStatus(paths);
}

export function enable(opts: InstallOptions = {}): GsdInstallStatus {
  const paths = opts.paths ?? defaultPaths();
  const log = opts.log ?? (() => {});
  try {
    const cmdDir = path.join(paths.installPath, "commands");
    const cmdDirDisabled = path.join(paths.installPath, "commands.disabled");
    if (fs.existsSync(cmdDirDisabled) && !fs.existsSync(cmdDir)) {
      fs.renameSync(cmdDirDisabled, cmdDir);
    }
    const marker = path.join(paths.installPath, ".disabled");
    if (fs.existsSync(marker)) fs.unlinkSync(marker);
    log("[gsd-installer] enabled");
    // Trigger sync after re-enable to catch any version drift
    return install({ ...opts, paths });
  } catch (err) {
    log(`[gsd-installer] enable FAILED: ${(err as Error).message}`);
    return getStatus(paths);
  }
}

export function uninstall(opts: InstallOptions = {}): GsdInstallStatus {
  const paths = opts.paths ?? defaultPaths();
  const log = opts.log ?? (() => {});
  try {
    rmrf(paths.installPath);
    // Also remove mirrored agents *that match our bundle exactly*. User-edited
    // ones are left alone (same hash policy as install).
    const srcAgents = path.join(paths.bundleDir, "agents");
    if (fs.existsSync(srcAgents) && fs.existsSync(paths.agentsMirrorPath)) {
      for (const name of fs.readdirSync(srcAgents)) {
        if (!name.endsWith(".md")) continue;
        const srcFile = path.join(srcAgents, name);
        const dstFile = path.join(paths.agentsMirrorPath, name);
        if (!fs.existsSync(dstFile)) continue;
        try {
          if (sha1File(srcFile) === sha1File(dstFile)) {
            fs.unlinkSync(dstFile);
          }
        } catch {
          // ignore per-file errors
        }
      }
    }
    log("[gsd-installer] uninstalled");
  } catch (err) {
    log(`[gsd-installer] uninstall FAILED: ${(err as Error).message}`);
  }
  return getStatus(paths);
}

// ────────────────────────── IPC ──────────────────────────

/**
 * Register IPC handlers. Called from electron/main.ts during app.whenReady().
 * Handler names: `gsd:status`, `gsd:install`, `gsd:resync`, `gsd:enable`,
 * `gsd:disable`, `gsd:uninstall`.
 *
 * The signature is intentionally weak (any-ish) so this module doesn't take
 * a hard dependency on `electron`'s typings — keeps the file unit-testable
 * without a `require('electron')` shim.
 */
type IpcMainLike = {
  handle: (channel: string, listener: (...args: unknown[]) => unknown) => void;
};

export function registerGsdIpc(ipcMain: IpcMainLike): void {
  const log = (msg: string) => {
    try { console.log(msg); } catch { /* noop */ }
  };
  ipcMain.handle("gsd:status", async () => getStatus());
  ipcMain.handle("gsd:install", async () => install({ log }));
  ipcMain.handle("gsd:resync", async () => resync({ log }));
  ipcMain.handle("gsd:enable", async () => enable({ log }));
  ipcMain.handle("gsd:disable", async () => disable({ log }));
  ipcMain.handle("gsd:uninstall", async () => uninstall({ log }));
}
