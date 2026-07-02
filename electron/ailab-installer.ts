/**
 * AI_LabTest vendor bundle installer (electron main-process module).
 *
 * Responsibility: synchronize the bundled AI_LabTest plugin
 * (vendor/ailab-bundle/ packed as extraResources/ailab-bundle/ at build time)
 * into the user's `~/.claude/` tree so CodePilot's slash-command scanner picks
 * up the `ai-lab-test:*` commands and the `test-workflow` skill — but only
 * while the plugin is ENABLED.
 *
 * Two surfaces (mirrors how GSD works, with deliberate divergences):
 *   1. Plugin dir (installer-owned, full sync):
 *      `~/.claude/plugins/external_plugins/codepilot-ailab-vendor/`
 *      Holds the whole bundle incl. rules/ templates/ site-patterns/ .mcp.json.
 *      This is also the directory `${CLAUDE_PLUGIN_ROOT}` resolves to.
 *   2. Global namespaced mirrors (what actually makes commands appear + run):
 *      - `~/.claude/commands/ai-lab-test/<stem>.md`  (SUBDIR → name `ai-lab-test:<stem>`)
 *      - `~/.claude/skills/test-workflow/SKILL.md`    (real dir, scanner needs it)
 *
 * Divergences from GSD (see docs/handover/ailab-plugin.md):
 *   - Namespacing is structural (commands/ai-lab-test/ subdir), NOT a flat
 *     hyphen prefix. Command filenames are preserved verbatim.
 *   - `${CLAUDE_PLUGIN_ROOT}` rewrite: the mirrored command/skill copies are
 *     "global" (no plugin root at runtime), so on mirror we replace every
 *     `${CLAUDE_PLUGIN_ROOT}` with the absolute plugin-dir path where the
 *     rules/templates/site-patterns assets physically live.
 *   - Default DISABLED on first install ("启用时才运行"). The user turns it on
 *     from Settings → Plugins; enabling also registers the Playwright MCP
 *     (done in the renderer card via the /api/plugins/mcp HTTP API).
 *   - disable() REMOVES the namespaced surfaces (rmrf) — it is not enough to
 *     mark a flag, because the global mirror is what the SDK resolves. The
 *     subdirs are installer-owned namespaces, so wholesale rmrf is safe.
 *
 * Every fs op is wrapped — installer failure must NOT block the main window.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";

// ────────────────────────── types ──────────────────────────

export interface AilabPluginManifest {
  name: string;
  displayName: string;
  description: string;
  source: string;
  sourceUrl?: string;
  sourceCommit: string;
  sourcePluginVersion?: string;
  transformVersion: number;
  license: string;
  licenseFile?: string;
  commandCount: number;
  skillCount: number;
  ruleCount?: number;
  commandPrefix: string;
  requiresMcp?: string[];
  bundledAt?: string;
}

export interface AilabInstallStatus {
  enabled: boolean;
  installed: boolean;
  bundledVersion: string | null;
  installedVersion: string | null;
  needsSync: boolean;
  manifest: AilabPluginManifest | null;
  installPath: string;
  commandsMirrorPath: string;
  skillsMirrorPath: string;
  lastError?: string;
}

export interface AilabInstallerPaths {
  bundleDir: string; // source bundle (resources or dev vendor/)
  installPath: string; // ~/.claude/plugins/external_plugins/codepilot-ailab-vendor/
  commandsMirrorPath: string; // ~/.claude/commands/ai-lab-test/   (namespaced subdir)
  skillsMirrorPath: string; // ~/.claude/skills/test-workflow/
}

// ────────────────────────── path resolution ──────────────────────────

const PLUGIN_DIR_NAME = "codepilot-ailab-vendor";
/** Command namespace subdir under ~/.claude/commands/. Yields `ai-lab-test:<stem>`. */
const COMMAND_NAMESPACE = "ai-lab-test";
/** Skill dir name under ~/.claude/skills/. */
const SKILL_DIR_NAME = "test-workflow";
/** Literal placeholder the plugin's command/skill bodies use for asset paths. */
const PLUGIN_ROOT_TOKEN = "${CLAUDE_PLUGIN_ROOT}";

export function getInstallPath(homedir: string = os.homedir()): string {
  return path.join(
    homedir,
    ".claude",
    "plugins",
    "external_plugins",
    PLUGIN_DIR_NAME,
  );
}

export function getCommandsMirrorPath(homedir: string = os.homedir()): string {
  return path.join(homedir, ".claude", "commands", COMMAND_NAMESPACE);
}

export function getSkillsMirrorPath(homedir: string = os.homedir()): string {
  return path.join(homedir, ".claude", "skills", SKILL_DIR_NAME);
}

/**
 * Resolve the bundle dir. In production (packaged), files are at
 * `<process.resourcesPath>/ailab-bundle/` (placed there by electron-builder
 * extraResources). In dev, fall back to `<repo>/vendor/ailab-bundle/`
 * (produced by `npm run vendor:ailab`).
 */
export function getBundleDir(): string {
  const resPath = (process as unknown as { resourcesPath?: string })
    .resourcesPath;
  if (resPath) {
    const prodDir = path.join(resPath, "ailab-bundle");
    if (fs.existsSync(prodDir)) return prodDir;
  }
  // dev fallback: compiled to dist-electron/ailab-installer.js, so
  // __dirname/../vendor/ailab-bundle points to repo root.
  return path.join(__dirname, "..", "vendor", "ailab-bundle");
}

export function defaultPaths(homedir: string = os.homedir()): AilabInstallerPaths {
  return {
    bundleDir: getBundleDir(),
    installPath: getInstallPath(homedir),
    commandsMirrorPath: getCommandsMirrorPath(homedir),
    skillsMirrorPath: getSkillsMirrorPath(homedir),
  };
}

// ────────────────────────── pure helpers ──────────────────────────

export function sha1Buffer(buf: Buffer): string {
  return crypto.createHash("sha1").update(buf).digest("hex");
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
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const d = path.join(dst, ent.name);
    if (ent.isDirectory()) copyDirShallow(s, d);
    else if (ent.isFile()) fs.copyFileSync(s, d);
  }
}

/** Replace every `${CLAUDE_PLUGIN_ROOT}` with the absolute plugin-dir path. */
export function rewritePluginRoot(content: string, pluginRootAbs: string): string {
  return content.split(PLUGIN_ROOT_TOKEN).join(pluginRootAbs);
}

// ────────────────────────── manifest / version ──────────────────────────

export function readManifest(bundleDir: string): AilabPluginManifest | null {
  return safeReadJson<AilabPluginManifest>(path.join(bundleDir, "plugin.json"));
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

// ────────────────────────── status ──────────────────────────

export function getStatus(
  paths: AilabInstallerPaths = defaultPaths(),
): AilabInstallStatus {
  const manifest = readManifest(paths.bundleDir);
  const bundledVersion = readBundledVersion(paths.bundleDir);
  const installedVersion = readInstalledVersion(paths.installPath);
  const installedDirExists = fs.existsSync(paths.installPath);
  const enabled = installedDirExists ? !isDisabled(paths.installPath) : false;
  const needsSync =
    bundledVersion !== null && installedVersion !== bundledVersion;
  return {
    enabled,
    installed: installedDirExists,
    bundledVersion,
    installedVersion,
    needsSync,
    manifest,
    installPath: paths.installPath,
    commandsMirrorPath: paths.commandsMirrorPath,
    skillsMirrorPath: paths.skillsMirrorPath,
  };
}

// ────────────────────────── sync (plugin dir) ──────────────────────────

/**
 * Write the minimal footprint (VERSION/plugin.json/LICENSE) to install path so
 * the Settings UI's installedVersion is defined even if the larger sync fails.
 */
function ensurePluginMetadata(bundleDir: string, installPath: string): void {
  fs.mkdirSync(installPath, { recursive: true });
  for (const fname of ["VERSION", "plugin.json", "LICENSE"]) {
    const src = path.join(bundleDir, fname);
    if (!fs.existsSync(src)) continue;
    try {
      fs.copyFileSync(src, path.join(installPath, fname));
    } catch {
      // best-effort per file
    }
  }
}

/**
 * Per-entry replace of install-path contents with bundle contents. Preserves
 * the user's optional `extras/` and the `.disabled` marker. The plugin-dir
 * copies keep `${CLAUDE_PLUGIN_ROOT}` verbatim (it resolves natively if the
 * SDK ever loads the plugin directly); the mirrors get the rewrite instead.
 */
function syncPluginDir(bundleDir: string, installPath: string): void {
  fs.mkdirSync(installPath, { recursive: true });

  const bundleEntries = new Set<string>();
  for (const entry of fs.readdirSync(bundleDir, { withFileTypes: true })) {
    // transform-report.json is vendor-time debug only; keep it off the user disk.
    if (entry.name === "transform-report.json") continue;
    bundleEntries.add(entry.name);
    const src = path.join(bundleDir, entry.name);
    const dst = path.join(installPath, entry.name);
    if (entry.isDirectory()) {
      try {
        rmrf(dst);
      } catch {
        // continue; copyDirShallow overlays what it can
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

  // Remove entries no longer in the bundle, preserving user state.
  const preserved = new Set(["extras", ".disabled"]);
  let present: string[] = [];
  try {
    present = fs.readdirSync(installPath);
  } catch {
    present = [];
  }
  for (const name of present) {
    if (preserved.has(name)) continue;
    if (bundleEntries.has(name)) continue;
    try {
      rmrf(path.join(installPath, name));
    } catch {
      // best-effort cleanup
    }
  }
}

// ────────────────────────── mirrors (namespaced surfaces) ──────────────────────────

/**
 * Mirror bundle commands/*.md into `~/.claude/commands/ai-lab-test/`, rewriting
 * `${CLAUDE_PLUGIN_ROOT}` to the absolute plugin-dir path. Wholesale rmrf +
 * recreate: the subdir is an installer-owned namespace, so we own it entirely
 * (also avoids writing through any leftover debug symlinks). The subdir
 * structure is what yields the `ai-lab-test:<stem>` command ids.
 */
function mirrorCommandsNamespaced(
  bundleDir: string,
  commandsMirrorPath: string,
  pluginRootAbs: string,
): void {
  const srcDir = path.join(bundleDir, "commands");
  rmrf(commandsMirrorPath);
  if (!fs.existsSync(srcDir)) return;
  fs.mkdirSync(commandsMirrorPath, { recursive: true });
  for (const name of fs.readdirSync(srcDir)) {
    if (!name.endsWith(".md")) continue;
    const raw = fs.readFileSync(path.join(srcDir, name), "utf-8");
    fs.writeFileSync(
      path.join(commandsMirrorPath, name),
      rewritePluginRoot(raw, pluginRootAbs),
      "utf-8",
    );
  }
}

/**
 * Mirror the bundle skill (skills/test-workflow/*) into
 * `~/.claude/skills/test-workflow/` as a REAL directory (the skills scanner
 * skips symlinked dirs). `.md` files get the `${CLAUDE_PLUGIN_ROOT}` rewrite;
 * any other files are copied byte-for-byte. Wholesale rmrf + recreate.
 */
function mirrorSkill(
  bundleDir: string,
  skillsMirrorPath: string,
  pluginRootAbs: string,
): void {
  const srcDir = path.join(bundleDir, "skills", SKILL_DIR_NAME);
  rmrf(skillsMirrorPath);
  if (!fs.existsSync(srcDir)) return;

  function walk(relDir: string): void {
    const absSrc = path.join(srcDir, relDir);
    const absDst = path.join(skillsMirrorPath, relDir);
    fs.mkdirSync(absDst, { recursive: true });
    for (const ent of fs.readdirSync(absSrc, { withFileTypes: true })) {
      const childRel = path.join(relDir, ent.name);
      if (ent.isDirectory()) {
        walk(childRel);
        continue;
      }
      if (!ent.isFile()) continue;
      const srcFile = path.join(srcDir, childRel);
      const dstFile = path.join(skillsMirrorPath, childRel);
      if (ent.name.endsWith(".md")) {
        const raw = fs.readFileSync(srcFile, "utf-8");
        fs.writeFileSync(dstFile, rewritePluginRoot(raw, pluginRootAbs), "utf-8");
      } else {
        fs.copyFileSync(srcFile, dstFile);
      }
    }
  }
  walk("");
}

/** Remove both namespaced surfaces (used by disable / disabled-boot GC / uninstall). */
function removeMirrors(paths: AilabInstallerPaths): void {
  try {
    rmrf(paths.commandsMirrorPath);
  } catch {
    // best-effort
  }
  try {
    rmrf(paths.skillsMirrorPath);
  } catch {
    // best-effort
  }
}

// ────────────────────────── api ──────────────────────────

export interface InstallOptions {
  paths?: AilabInstallerPaths;
  force?: boolean; // sync plugin dir even when versions match (resync())
  /** When true, a first-ever install is created ENABLED (used by enable());
   *  default false → first-ever install defaults DISABLED. */
  enableOnInstall?: boolean;
  log?: (msg: string) => void;
}

export function install(opts: InstallOptions = {}): AilabInstallStatus {
  const paths = opts.paths ?? defaultPaths();
  const log = opts.log ?? (() => {});

  const installedDirExists = fs.existsSync(paths.installPath);
  const disabled = installedDirExists && isDisabled(paths.installPath);

  // Respect disabled state (unless we're explicitly enabling). Defensively GC
  // any lingering namespaced surfaces so disabled really means "gone".
  if (disabled && !opts.enableOnInstall) {
    log("[ailab-installer] plugin is disabled, skipping mirror");
    removeMirrors(paths);
    return getStatus(paths);
  }

  const status = getStatus(paths);
  if (!status.manifest || status.bundledVersion === null) {
    const msg = `bundle missing or invalid at ${paths.bundleDir}`;
    log(`[ailab-installer] ${msg}`);
    return { ...status, lastError: msg };
  }

  let metadataError: string | null = null;
  try {
    ensurePluginMetadata(paths.bundleDir, paths.installPath);
  } catch (err) {
    metadataError = (err as Error).message;
    log(`[ailab-installer] metadata write failed: ${metadataError}`);
  }

  try {
    const firstEver = !installedDirExists;
    const defaultDisable = firstEver && !opts.enableOnInstall;

    // Lay down / refresh the plugin dir on first install, version drift, or force.
    if (firstEver || opts.force || status.needsSync) {
      log(
        `[ailab-installer] syncing plugin dir: ${status.installedVersion ?? "<none>"} -> ${status.bundledVersion}`,
      );
      syncPluginDir(paths.bundleDir, paths.installPath);
      ensurePluginMetadata(paths.bundleDir, paths.installPath);
    }

    if (defaultDisable) {
      // First-ever install from the boot path → default OFF. User enables in
      // Settings → Plugins (which also registers the Playwright MCP).
      try {
        fs.writeFileSync(path.join(paths.installPath, ".disabled"), "", "utf-8");
      } catch {
        // best-effort
      }
      removeMirrors(paths);
      log("[ailab-installer] first install → default disabled");
      return getStatus(paths);
    }

    // Enabled path: clear any marker, then (re)create the namespaced mirrors.
    const marker = path.join(paths.installPath, ".disabled");
    if (fs.existsSync(marker)) {
      try {
        fs.unlinkSync(marker);
      } catch {
        // best-effort
      }
    }
    const pluginRootAbs = paths.installPath;
    mirrorCommandsNamespaced(paths.bundleDir, paths.commandsMirrorPath, pluginRootAbs);
    mirrorSkill(paths.bundleDir, paths.skillsMirrorPath, pluginRootAbs);
    log("[ailab-installer] mirrors applied (commands + skill)");

    return metadataError
      ? { ...getStatus(paths), lastError: metadataError }
      : getStatus(paths);
  } catch (err) {
    const msg = (err as Error).message;
    log(`[ailab-installer] sync FAILED: ${msg}`);
    return { ...getStatus(paths), lastError: msg };
  }
}

export function resync(opts: InstallOptions = {}): AilabInstallStatus {
  return install({ ...opts, force: true });
}

export function enable(opts: InstallOptions = {}): AilabInstallStatus {
  const paths = opts.paths ?? defaultPaths();
  const log = opts.log ?? (() => {});
  log("[ailab-installer] enabling");
  // enableOnInstall bypasses the disabled short-circuit and the default-off
  // policy; install() removes the marker + (re)creates the mirrors.
  return install({ ...opts, paths, enableOnInstall: true });
}

export function disable(opts: InstallOptions = {}): AilabInstallStatus {
  const paths = opts.paths ?? defaultPaths();
  const log = opts.log ?? (() => {});
  try {
    if (!fs.existsSync(paths.installPath)) {
      fs.mkdirSync(paths.installPath, { recursive: true });
    }
    fs.writeFileSync(path.join(paths.installPath, ".disabled"), "", "utf-8");
    // The namespaced subdirs are what the SDK resolves; remove them so the
    // commands + skill actually disappear (marker alone is insufficient).
    removeMirrors(paths);
    log("[ailab-installer] disabled");
  } catch (err) {
    log(`[ailab-installer] disable FAILED: ${(err as Error).message}`);
  }
  return getStatus(paths);
}

export function uninstall(opts: InstallOptions = {}): AilabInstallStatus {
  const paths = opts.paths ?? defaultPaths();
  const log = opts.log ?? (() => {});
  try {
    rmrf(paths.installPath);
    removeMirrors(paths);
    log("[ailab-installer] uninstalled");
  } catch (err) {
    log(`[ailab-installer] uninstall FAILED: ${(err as Error).message}`);
  }
  return getStatus(paths);
}

// ────────────────────────── IPC ──────────────────────────

type IpcMainLike = {
  handle: (channel: string, listener: (...args: unknown[]) => unknown) => void;
};

export function registerAilabIpc(ipcMain: IpcMainLike): void {
  const log = (msg: string) => {
    try {
      console.log(msg);
    } catch {
      /* noop */
    }
  };
  ipcMain.handle("ailab:status", async () => getStatus());
  ipcMain.handle("ailab:install", async () => install({ log }));
  ipcMain.handle("ailab:resync", async () => resync({ log }));
  ipcMain.handle("ailab:enable", async () => enable({ log }));
  ipcMain.handle("ailab:disable", async () => disable({ log }));
  ipcMain.handle("ailab:uninstall", async () => uninstall({ log }));
}
