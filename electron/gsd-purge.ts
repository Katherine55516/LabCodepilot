/**
 * GSD residue purge (one-shot migration, electron main-process module).
 *
 * Replaces electron/gsd-installer.ts. The bundled GSD plugin was removed
 * because upstream gsd-build/get-shit-done is archived and the bundle had
 * grown into pure overhead: 67 of the user's 68 global slash commands and
 * all 33 global subagents were GSD, costing ~3.6k tokens of system-prompt
 * context on every single request.
 *
 * Deleting the installer is not enough. Earlier versions mirrored 399 files
 * into the user's `~/.claude/`, where Claude Code reads them straight off
 * disk — no app involvement. Those files survive an app update on their own,
 * so this module removes them once, on the first launch after upgrading.
 *
 * Strategy — four targets, two identification modes:
 *
 *   1. Plugin dir  `~/.claude/plugins/external_plugins/codepilot-gsd-vendor/`
 *      The `codepilot-` prefix makes it unambiguously ours. Removed wholesale.
 *
 *   2. Flat commands  `~/.claude/commands/gsd-*.md`
 *      Official GSD installs commands under `commands/gsd/` (namespaced
 *      `/gsd:x`, confirmed by its own installer code). Our vendor pipeline
 *      flattened them to `gsd-x.md` (`/gsd-x`). The flat form is unique to
 *      us, so these go by name regardless of content.
 *
 *   3. Agents  `~/.claude/agents/gsd-*.md`
 *   4. Assets  `~/.claude/get-shit-done/**`
 *      Both collide with an official install. With no official install
 *      detected we delete by manifest *path* membership; with one detected
 *      we fall back to deleting only exact *hash* matches.
 *
 * Why path membership rather than hash alone: the vendor pipeline shipped
 * three transform generations (v1/v2/v3) inside a four-hour window on
 * 2026-05-26, and the old mirror logic refused to overwrite a file whose
 * hash differed — it recorded a conflict and moved on. Users who installed
 * during that window still carry v1/v2 content that no later update ever
 * corrected, and users who hand-edited a command carry their own. Hash-only
 * matching would strand both on disk permanently.
 *
 * Deliberately out of scope:
 *   - `.planning/` inside user projects — GSD's per-project output, user data.
 *   - `~/.claude.json` — Claude Code's own config, concurrently written by it.
 *     A read-modify-write from here risks clobbering unrelated state, and the
 *     few `skillUsage.gsd-*` counters it holds are inert.
 *   - Files under `get-shit-done/` whose path is absent from the manifest
 *     (e.g. `USER-PROFILE.md`, written by GSD at runtime) — not ours to delete.
 *
 * Every fs operation is wrapped: purge failure must never block the main
 * window. The completion marker is only written on a clean run, so a partial
 * failure retries on the next launch instead of being silently forgotten.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";

// ────────────────────────── types ──────────────────────────

export interface PurgeManifest {
  sourceCommit: string;
  transformVersion: number;
  bundleVersion: string;
  counts: { commands: number; agents: number; assets: number };
  /** basename -> sha1 */
  commands: Record<string, string>;
  /** basename -> sha1 */
  agents: Record<string, string>;
  /** posix relPath under get-shit-done/ -> sha1 */
  assets: Record<string, string>;
}

export interface PurgeResult {
  /** false = nothing done (already purged, or no manifest available). */
  ran: boolean;
  pluginDirRemoved: boolean;
  commandsRemoved: number;
  agentsRemoved: number;
  assetsRemoved: number;
  emptyDirsRemoved: number;
  /** Left alone because an independent official GSD install was detected. */
  keptForOfficial: number;
  /** Left alone because the path is not in the manifest (user-generated). */
  keptUnknown: number;
  officialInstallDetected: boolean;
  markerWritten: boolean;
  errors: string[];
}

export interface PurgePaths {
  manifestPath: string;
  pluginDir: string;
  commandsDir: string;
  agentsDir: string;
  assetsDir: string;
  markerPath: string;
}

// ────────────────────────── path resolution ──────────────────────────

const PLUGIN_DIR_NAME = "codepilot-gsd-vendor";
const MANIFEST_NAME = "gsd-purge-manifest.json";

/**
 * Packaged: `<resourcesPath>/gsd-purge-manifest.json` (electron-builder
 * extraResources). Dev: this file compiles to dist-electron/gsd-purge.js,
 * so `__dirname/../vendor/` resolves to the repo's vendor dir.
 */
export function getManifestPath(): string {
  const resPath = (process as unknown as { resourcesPath?: string })
    .resourcesPath;
  if (resPath) {
    const prod = path.join(resPath, MANIFEST_NAME);
    if (fs.existsSync(prod)) return prod;
  }
  return path.join(__dirname, "..", "vendor", MANIFEST_NAME);
}

export function defaultPurgePaths(homedir: string = os.homedir()): PurgePaths {
  const claude = path.join(homedir, ".claude");
  return {
    manifestPath: getManifestPath(),
    pluginDir: path.join(claude, "plugins", "external_plugins", PLUGIN_DIR_NAME),
    commandsDir: path.join(claude, "commands"),
    agentsDir: path.join(claude, "agents"),
    assetsDir: path.join(claude, "get-shit-done"),
    markerPath: path.join(homedir, ".codepilot", ".gsd-purged"),
  };
}

// ────────────────────────── small fs helpers ──────────────────────────

export function sha1File(filepath: string): string | null {
  try {
    return crypto
      .createHash("sha1")
      .update(fs.readFileSync(filepath))
      .digest("hex");
  } catch {
    return null;
  }
}

export function readManifest(manifestPath: string): PurgeManifest | null {
  try {
    const raw = JSON.parse(
      fs.readFileSync(manifestPath, "utf-8"),
    ) as PurgeManifest;
    if (!raw || !raw.commands || !raw.agents || !raw.assets) return null;
    return raw;
  } catch {
    return null;
  }
}

function rmrf(target: string): boolean {
  try {
    if (!fs.existsSync(target)) return false;
    fs.rmSync(target, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

function unlinkQuiet(target: string): boolean {
  try {
    fs.unlinkSync(target);
    return true;
  } catch {
    return false;
  }
}

/** Files only — a directory named `gsd-x.md` would not be ours. */
function listGsdMdFiles(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && /^gsd-.+\.md$/.test(e.name))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/**
 * Remove empty directories depth-first under `root`, then `root` itself if it
 * ends up empty. The old installer only ever attempted a single rmdir on the
 * root, which left the 18-directory `get-shit-done/` skeleton (three levels
 * deep in places) standing after every file inside it was gone.
 */
export function pruneEmptyDirs(root: string): number {
  let removed = 0;
  const walk = (dir: string): boolean => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return false;
    }
    let empty = true;
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const childGone = walk(path.join(dir, entry.name));
        if (!childGone) empty = false;
      } else {
        empty = false;
      }
    }
    if (!empty) return false;
    try {
      fs.rmdirSync(dir);
      removed++;
      return true;
    } catch {
      return false;
    }
  };
  walk(root);
  return removed;
}

// ────────────────────────── official-install detection ──────────────────────────

/**
 * Is there an independent, user-installed official GSD on this machine?
 *
 * Two signals, both taken from GSD's own installer code and both absent from
 * anything our vendor pipeline ever produced:
 *   - `~/.claude/commands/gsd/` — the official command namespace (`/gsd:x`).
 *     Our pipeline flattened commands and never created this directory.
 *   - `~/.claude/get-shit-done/skills/` — official-only subtree. Our bundle's
 *     get-shit-done/ contained exactly bin, contexts, references, templates
 *     and workflows.
 *
 * When either is present we downgrade agents and assets to hash-exact
 * deletion so a live official install is never damaged.
 */
export function detectOfficialInstall(paths: PurgePaths): boolean {
  const candidates = [
    path.join(paths.commandsDir, "gsd"),
    path.join(paths.assetsDir, "skills"),
  ];
  for (const dir of candidates) {
    try {
      if (fs.statSync(dir).isDirectory()) return true;
    } catch {
      // absent or unreadable — not a signal
    }
  }
  return false;
}

// ────────────────────────── purge ──────────────────────────

export interface PurgeOptions {
  paths?: PurgePaths;
  /** Ignore the completion marker (used by tests and manual re-runs). */
  force?: boolean;
  log?: (msg: string) => void;
}

export function isPurged(paths: PurgePaths): boolean {
  try {
    return fs.existsSync(paths.markerPath);
  } catch {
    return false;
  }
}

function emptyResult(): PurgeResult {
  return {
    ran: false,
    pluginDirRemoved: false,
    commandsRemoved: 0,
    agentsRemoved: 0,
    assetsRemoved: 0,
    emptyDirsRemoved: 0,
    keptForOfficial: 0,
    keptUnknown: 0,
    officialInstallDetected: false,
    markerWritten: false,
    errors: [],
  };
}

export function purge(opts: PurgeOptions = {}): PurgeResult {
  const paths = opts.paths ?? defaultPurgePaths();
  const log = opts.log ?? (() => {});
  const result = emptyResult();

  if (!opts.force && isPurged(paths)) return result;

  const manifest = readManifest(paths.manifestPath);
  if (!manifest) {
    // Without the manifest we cannot tell our files from an official install's,
    // so we do nothing rather than guess. No marker either — if a later build
    // ships the manifest correctly, that launch will do the work.
    result.errors.push(`manifest unreadable at ${paths.manifestPath}`);
    log(`[gsd-purge] ${result.errors[0]} — skipping`);
    return result;
  }

  result.ran = true;
  const official = detectOfficialInstall(paths);
  result.officialInstallDetected = official;
  if (official) {
    log(
      "[gsd-purge] official GSD install detected — agents/assets limited to hash-exact removal",
    );
  }

  // 1. Plugin dir — unambiguously ours, remove wholesale.
  try {
    result.pluginDirRemoved = rmrf(paths.pluginDir);
  } catch (err) {
    result.errors.push(`pluginDir: ${(err as Error).message}`);
  }

  // 2. Flat gsd-*.md commands — unique to our flattening transform.
  for (const name of listGsdMdFiles(paths.commandsDir)) {
    if (unlinkQuiet(path.join(paths.commandsDir, name))) {
      result.commandsRemoved++;
    } else {
      result.errors.push(`command: ${name}`);
    }
  }

  // 3. Agents — name-based unless an official install is present.
  for (const name of listGsdMdFiles(paths.agentsDir)) {
    const target = path.join(paths.agentsDir, name);
    const known = Object.prototype.hasOwnProperty.call(manifest.agents, name);
    if (!known) {
      // Not a filename we ever shipped. Could be an official agent or the
      // user's own; leave it.
      result.keptUnknown++;
      continue;
    }
    if (official && sha1File(target) !== manifest.agents[name]) {
      result.keptForOfficial++;
      continue;
    }
    if (unlinkQuiet(target)) result.agentsRemoved++;
    else result.errors.push(`agent: ${name}`);
  }

  // 4. Assets — path membership unless an official install is present.
  if (fs.existsSync(paths.assetsDir)) {
    for (const rel of Object.keys(manifest.assets)) {
      const target = path.join(paths.assetsDir, ...rel.split("/"));
      if (!fs.existsSync(target)) continue;
      if (official && sha1File(target) !== manifest.assets[rel]) {
        result.keptForOfficial++;
        continue;
      }
      if (unlinkQuiet(target)) result.assetsRemoved++;
      else result.errors.push(`asset: ${rel}`);
    }
    // Anything still standing is either the user's own runtime output
    // (USER-PROFILE.md) or an official install's extra files. Count it, keep
    // it, and prune only the empty scaffolding around it.
    result.keptUnknown += countFiles(paths.assetsDir);
    try {
      result.emptyDirsRemoved = pruneEmptyDirs(paths.assetsDir);
    } catch (err) {
      result.errors.push(`prune: ${(err as Error).message}`);
    }
  }

  // Marker last, and only on a clean run — a partial failure should retry.
  if (result.errors.length === 0) {
    try {
      fs.mkdirSync(path.dirname(paths.markerPath), { recursive: true });
      fs.writeFileSync(
        paths.markerPath,
        `${new Date().toISOString()} bundleVersion=${manifest.bundleVersion}\n`,
        "utf-8",
      );
      result.markerWritten = true;
    } catch (err) {
      result.errors.push(`marker: ${(err as Error).message}`);
    }
  }

  log(
    `[gsd-purge] done: plugin=${result.pluginDirRemoved} commands=${result.commandsRemoved} ` +
      `agents=${result.agentsRemoved} assets=${result.assetsRemoved} ` +
      `emptyDirs=${result.emptyDirsRemoved} keptOfficial=${result.keptForOfficial} ` +
      `keptUnknown=${result.keptUnknown} errors=${result.errors.length}`,
  );
  return result;
}

function countFiles(root: string): number {
  let n = 0;
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) walk(path.join(dir, entry.name));
      else n++;
    }
  };
  walk(root);
  return n;
}
