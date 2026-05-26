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
  /** Bare name (no `.md` suffix). For `asset` kind the value is the
   *  relative path inside `~/.claude/get-shit-done/`, e.g.
   *  "workflows/add-tests". */
  agentName: string;
  /** Which mirror produced this conflict. */
  kind?: "agent" | "command" | "asset";
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
  bundleDir: string;          // source bundle (resources or dev vendor/)
  installPath: string;        // ~/.claude/plugins/external_plugins/codepilot-gsd-vendor/
  agentsMirrorPath: string;   // ~/.claude/agents/
  commandsMirrorPath: string; // ~/.claude/commands/
  assetsMirrorPath: string;   // ~/.claude/get-shit-done/
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
 * `~/.claude/commands/` is the canonical location Claude Code (and the
 * Claude Agent SDK init scan) reads global slash commands from. Bundled
 * plugin commands MUST be mirrored here — otherwise `/gsd-debug` shows
 * up in CodePilot's popover but the SDK has no idea what to do with it
 * and the request returns instantly with no work performed.
 */
export function getCommandsMirrorPath(homedir: string = os.homedir()): string {
  return path.join(homedir, ".claude", "commands");
}

/**
 * `~/.claude/get-shit-done/` holds GSD's runtime resources: workflows,
 * references, templates, bin/, contexts/. 57/67 GSD commands @-import
 * paths under this tree (e.g. `@~/.claude/get-shit-done/workflows/...`).
 * Without these files on disk, the commands fire but the agent spends
 * the first turn fishing for missing files, often falling back to a
 * global search that may or may not find the right copy.
 */
export function getAssetsMirrorPath(homedir: string = os.homedir()): string {
  return path.join(homedir, ".claude", "get-shit-done");
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
    commandsMirrorPath: getCommandsMirrorPath(homedir),
    assetsMirrorPath: getAssetsMirrorPath(homedir),
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
 * Write the minimal "we installed this version" footprint to install path.
 * Cheap (3 small files), idempotent, almost-impossible-to-fail — and run on
 * every install() so the Settings UI's `installedVersion` is always defined
 * as soon as a bundle exists, independent of whether the larger
 * syncPluginDir() succeeds afterwards. Without this, a transient failure in
 * the bulk copy (e.g. Windows Explorer holding a lock on installPath, AV
 * scanning .cjs files mid-write) would leave the UI showing "未安装" even
 * though commands work via mirror.
 */
function ensurePluginMetadata(bundleDir: string, installPath: string): void {
  fs.mkdirSync(installPath, { recursive: true });
  for (const fname of ["VERSION", "plugin.json", "LICENSE"]) {
    const src = path.join(bundleDir, fname);
    if (!fs.existsSync(src)) continue;
    try {
      fs.copyFileSync(src, path.join(installPath, fname));
    } catch {
      // best-effort per file; one failure doesn't block the others
    }
  }
}

/**
 * Per-entry replace of install path contents with bundle contents.
 * Preserves the user's optional `extras/` subdirectory and `.disabled` marker.
 *
 * Earlier versions called `rmrf(installPath)` first — that was vulnerable to
 * Windows Explorer holding a handle on the directory, AV scanners briefly
 * locking .cjs files, etc. and would leave the dir empty when the rebuild
 * step then failed. We now per-entry replace: each bundle entry overwrites
 * its corresponding install path entry, and only stale entries (not in the
 * bundle) are removed at the end. Partial failures leave install path in a
 * mixed but identifiable state — the metadata copy (which ran via
 * ensurePluginMetadata before this) is unaffected.
 */
function syncPluginDir(bundleDir: string, installPath: string): void {
  const disabledMarker = path.join(installPath, ".disabled");
  const wasDisabled = fs.existsSync(disabledMarker);

  fs.mkdirSync(installPath, { recursive: true });

  const bundleEntries = new Set<string>();
  for (const entry of fs.readdirSync(bundleDir, { withFileTypes: true })) {
    // skip the dev/debug transform-report.json — it's only useful at vendor
    // time, not at runtime. Keeping it out of the user's disk avoids confusion.
    if (entry.name === "transform-report.json") continue;
    bundleEntries.add(entry.name);
    const src = path.join(bundleDir, entry.name);
    const dst = path.join(installPath, entry.name);
    if (entry.isDirectory()) {
      // Replace the per-entry directory (small scope); if rmrf fails on one,
      // other entries still get synced.
      try {
        rmrf(dst);
      } catch {
        // continue; copyDirShallow below will overlay what it can
      }
      copyDirShallow(src, dst);
    } else if (entry.isFile()) {
      try {
        fs.copyFileSync(src, dst);
      } catch {
        // single-file failure shouldn't abort the whole sync
      }
    }
  }

  // Clean up entries that are no longer in the bundle, but preserve user
  // state (extras/, .disabled, .conflicts.json, commands.disabled/).
  const preserved = new Set([
    "extras",
    ".disabled",
    ".conflicts.json",
    "commands.disabled",
  ]);
  let presentEntries: string[] = [];
  try {
    presentEntries = fs.readdirSync(installPath);
  } catch {
    presentEntries = [];
  }
  for (const name of presentEntries) {
    if (preserved.has(name)) continue;
    if (bundleEntries.has(name)) continue;
    try {
      rmrf(path.join(installPath, name));
    } catch {
      // best-effort cleanup
    }
  }

  // Re-apply disabled marker (sync re-created commands/, so re-rename if
  // the user had it disabled). Marker file itself is preserved in `preserved`
  // above, so no explicit re-write needed.
  if (wasDisabled) {
    const cmdDir = path.join(installPath, "commands");
    const cmdDirDisabled = path.join(installPath, "commands.disabled");
    if (fs.existsSync(cmdDir)) {
      try {
        rmrf(cmdDirDisabled);
        fs.renameSync(cmdDir, cmdDirDisabled);
      } catch {
        // best-effort
      }
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
  return mirrorDir(
    path.join(bundleDir, "agents"),
    agentsMirrorPath,
    "agent",
  );
}

/**
 * Mirror bundle commands/*.md to `~/.claude/commands/`. Returns list of
 * conflicts (user-modified files left untouched). This is the step that
 * actually makes `/gsd-debug` etc. work end-to-end: Claude Code's
 * built-in slash-command scanner reads from `~/.claude/commands/`, so
 * unless the files live there, the SDK has no command body to inject
 * when the user sends the slash command — the message just no-ops.
 */
function mirrorCommands(
  bundleDir: string,
  commandsMirrorPath: string,
): GsdConflict[] {
  return mirrorDir(
    path.join(bundleDir, "commands"),
    commandsMirrorPath,
    "command",
  );
}

/**
 * Mirror bundle get-shit-done/ subtree to `~/.claude/get-shit-done/`.
 * Recursive, hash-aware (same conflict policy as the flat mirrors).
 * Returns conflict list; preserved files keep their user edits.
 */
function mirrorAssets(
  bundleDir: string,
  assetsMirrorPath: string,
): GsdConflict[] {
  return mirrorTree(
    path.join(bundleDir, "get-shit-done"),
    assetsMirrorPath,
    "asset",
  );
}

/**
 * Generic hash-aware flat-dir mirror. Used by both mirrorAgents and
 * mirrorCommands so the conflict policy stays identical: new file →
 * write; identical hash → skip; different hash → record conflict and
 * leave the user's file alone. Only `.md` files are touched.
 */
function mirrorDir(
  srcDir: string,
  dstDir: string,
  kind: "agent" | "command",
): GsdConflict[] {
  const conflicts: GsdConflict[] = [];
  if (!fs.existsSync(srcDir)) return conflicts;

  fs.mkdirSync(dstDir, { recursive: true });

  for (const name of fs.readdirSync(srcDir)) {
    if (!name.endsWith(".md")) continue;
    const srcFile = path.join(srcDir, name);
    const dstFile = path.join(dstDir, name);
    applyFileMirror(srcFile, dstFile, kind, name, conflicts);
  }

  return conflicts;
}

/**
 * Recursive variant of mirrorDir. Mirrors every file under srcDir
 * (any extension — get-shit-done/bin/ contains .cjs scripts) into the
 * matching position under dstDir, preserving directory structure.
 * Same hash-aware conflict policy as flat mirrors.
 */
function mirrorTree(
  srcRoot: string,
  dstRoot: string,
  kind: "agent" | "command" | "asset",
): GsdConflict[] {
  const conflicts: GsdConflict[] = [];
  if (!fs.existsSync(srcRoot)) return conflicts;

  function walk(relDir: string): void {
    const absSrc = path.join(srcRoot, relDir);
    const absDst = path.join(dstRoot, relDir);
    fs.mkdirSync(absDst, { recursive: true });
    for (const ent of fs.readdirSync(absSrc, { withFileTypes: true })) {
      const childRel = path.join(relDir, ent.name);
      if (ent.isDirectory()) {
        walk(childRel);
        continue;
      }
      if (!ent.isFile()) continue;
      applyFileMirror(
        path.join(srcRoot, childRel),
        path.join(dstRoot, childRel),
        // mirrorTree only emits 'asset'-kind conflicts; the agent/command
        // variants use mirrorDir which provides those kinds explicitly.
        kind === "asset" ? "asset" : kind,
        childRel.replace(/\\/g, "/"),
        conflicts,
      );
    }
  }

  walk("");
  return conflicts;
}

function applyFileMirror(
  srcFile: string,
  dstFile: string,
  kind: GsdConflict["kind"],
  conflictName: string,
  conflicts: GsdConflict[],
): void {
  const srcBuf = fs.readFileSync(srcFile);
  if (!fs.existsSync(dstFile)) {
    fs.writeFileSync(dstFile, srcBuf);
    return;
  }
  const dstBuf = fs.readFileSync(dstFile);
  if (sha1Buffer(srcBuf) === sha1Buffer(dstBuf)) return;
  conflicts.push({
    agentName: conflictName.replace(/\.md$/, ""),
    kind,
    reason: "hash-mismatch",
    targetPath: dstFile,
  });
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

  // Always write metadata first. This is independent of needsSync because
  // it's how the Settings UI tells "installed" from "not installed" — and
  // a stale or missing VERSION on disk has bitten users in the past
  // (Settings showed "未安装" while commands were actually present via the
  // mirror layer). Wrapped separately so a metadata failure doesn't block
  // mirrors or the content sync downstream.
  let metadataError: string | null = null;
  try {
    ensurePluginMetadata(paths.bundleDir, paths.installPath);
  } catch (err) {
    metadataError = (err as Error).message;
    log(`[gsd-installer] metadata write failed: ${metadataError}`);
  }

  try {
    // Mirrors are idempotent (hash-compare per file), so run them every
    // launch — not just on version drift. This recovers from: 1) builds
    // installed before the mirror features shipped, 2) users who
    // manually deleted a mirror file. Total cost ~400 hashes/launch,
    // dominated by the 299 get-shit-done/ asset files.
    const conflicts: GsdConflict[] = [];
    conflicts.push(...mirrorAgents(paths.bundleDir, paths.agentsMirrorPath));
    conflicts.push(...mirrorCommands(paths.bundleDir, paths.commandsMirrorPath));
    conflicts.push(...mirrorAssets(paths.bundleDir, paths.assetsMirrorPath));

    if (!opts.force && !status.needsSync) {
      writeConflictsLog(paths.installPath, conflicts);
      log(
        `[gsd-installer] up-to-date (version=${status.installedVersion}); mirrors re-checked (conflicts: ${conflicts.length})`,
      );
      return metadataError
        ? { ...getStatus(paths), lastError: metadataError }
        : getStatus(paths);
    }

    log(
      `[gsd-installer] syncing: ${status.installedVersion ?? "<none>"} -> ${status.bundledVersion}`,
    );
    syncPluginDir(paths.bundleDir, paths.installPath);
    // After sync, re-apply metadata — syncPluginDir may have overwritten
    // VERSION/plugin.json from the bundle (correct) but if it failed
    // partway, ensurePluginMetadata leaves a coherent footprint anyway.
    ensurePluginMetadata(paths.bundleDir, paths.installPath);
    writeConflictsLog(paths.installPath, conflicts);
    log(
      `[gsd-installer] sync done. mirror conflicts: ${conflicts.length}`,
    );
    return getStatus(paths);
  } catch (err) {
    const msg = (err as Error).message;
    log(`[gsd-installer] sync FAILED: ${msg}`);
    // Even if content sync blew up, the ensurePluginMetadata() call at
    // the top of install() already wrote VERSION/plugin.json/LICENSE, so
    // the UI will still show the right version + count instead of "未安装".
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
    // Also remove mirrored files *that match our bundle exactly*. User-edited
    // ones are left alone (same hash policy as install).
    cleanupMirror(
      path.join(paths.bundleDir, "agents"),
      paths.agentsMirrorPath,
    );
    cleanupMirror(
      path.join(paths.bundleDir, "commands"),
      paths.commandsMirrorPath,
    );
    cleanupMirrorTree(
      path.join(paths.bundleDir, "get-shit-done"),
      paths.assetsMirrorPath,
    );
    log("[gsd-installer] uninstalled");
  } catch (err) {
    log(`[gsd-installer] uninstall FAILED: ${(err as Error).message}`);
  }
  return getStatus(paths);
}

/**
 * Remove flat-dir mirror files that still match the bundle exactly. User
 * changes are preserved — same conservative policy as install/mirror.
 */
function cleanupMirror(srcDir: string, dstDir: string): void {
  if (!fs.existsSync(srcDir) || !fs.existsSync(dstDir)) return;
  for (const name of fs.readdirSync(srcDir)) {
    if (!name.endsWith(".md")) continue;
    const srcFile = path.join(srcDir, name);
    const dstFile = path.join(dstDir, name);
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

/**
 * Recursive cleanup variant. Walks the bundle subtree; for each file,
 * removes the matching destination iff hashes still match. Empty dirs
 * left behind by the user are tidied last.
 */
function cleanupMirrorTree(srcRoot: string, dstRoot: string): void {
  if (!fs.existsSync(srcRoot) || !fs.existsSync(dstRoot)) return;

  function walk(relDir: string): void {
    const absSrc = path.join(srcRoot, relDir);
    for (const ent of fs.readdirSync(absSrc, { withFileTypes: true })) {
      const childRel = path.join(relDir, ent.name);
      if (ent.isDirectory()) {
        walk(childRel);
        continue;
      }
      if (!ent.isFile()) continue;
      const srcFile = path.join(srcRoot, childRel);
      const dstFile = path.join(dstRoot, childRel);
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

  walk("");

  // Best-effort: remove the root if everything we wrote is gone.
  try {
    // fs.rmdir succeeds only on empty dir
    const remaining = fs.readdirSync(dstRoot);
    if (remaining.length === 0) {
      fs.rmdirSync(dstRoot);
    }
  } catch {
    // user files remain — leave the directory in place
  }
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
