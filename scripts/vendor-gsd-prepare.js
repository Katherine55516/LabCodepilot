#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Vendor-GSD prepare script.
 *
 * 读 vendor/gsd-source/（gsd-build/get-shit-done 固定快照），输出
 * vendor/gsd-bundle/ —— CodePilot 打包用的内置 GSD 插件资源。
 *
 * 关键转换（与 GSD 官方 installer 在 Claude Code 上的行为一致）：
 *   1. commands/gsd/<name>.md 平面化为 commands/gsd-<name>.md
 *      —— 因为 CodePilot 扫描器（src/app/api/skills/route.ts:266-275）的子目录
 *         会拼成 colon 形式（commands/gsd/debug.md -> /gsd:debug）。
 *         我们要的是 hyphen 形式 /gsd-debug，所以必须平面化。
 *   2. 全文 \bgsd:[a-z][a-z0-9-]*\b -> gsd-...
 *      —— frontmatter `name: gsd:debug` -> `name: gsd-debug`
 *      —— 正文里所有 /gsd:foo、gsd:foo（agent 名引用、命令引用）-> hyphen 形式
 *
 * 产出：
 *   vendor/gsd-bundle/
 *     commands/gsd-debug.md ... (67)
 *     agents/gsd-debugger.md ... (33)
 *     LICENSE
 *     plugin.json
 *     VERSION
 *     transform-report.json
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const REPO_ROOT = path.resolve(__dirname, "..");
const SOURCE_DIR = path.join(REPO_ROOT, "vendor", "gsd-source");
const BUNDLE_DIR = path.join(REPO_ROOT, "vendor", "gsd-bundle");

// v2 (2026-05-26): plugin.json now carries `builtIn: true`, required by
// /api/skills to bypass the SDK whitelist filter and surface /gsd-*
// commands in the popover. Bump triggers re-sync on existing installs.
const TRANSFORM_VERSION = 2;

const GSD_COLON_RE = /\bgsd:([a-z][a-z0-9-]*)\b/g;

/**
 * Parse frontmatter `name` from a markdown file. Returns the raw name string
 * (e.g. "gsd:debug" or "gsd-context") or null if missing.
 *
 * GSD v1.40+ ships namespace-router files whose filename differs from their
 * frontmatter name (e.g. ns-context.md has `name: gsd-context`). We honor the
 * frontmatter name so the surfaced slash command matches GSD's design intent.
 */
function readFrontmatterName(content) {
  const fm = content.match(/^---\r?\n([\s\S]+?)\r?\n---/);
  if (!fm) return null;
  const m = fm[1].match(/^name:\s*(.+)$/m);
  return m ? m[1].trim() : null;
}

/** Read SNAPSHOT.md to extract source commit. */
function readSnapshotCommit() {
  const snapshotPath = path.join(SOURCE_DIR, "SNAPSHOT.md");
  if (!fs.existsSync(snapshotPath)) {
    throw new Error(`SNAPSHOT.md not found at ${snapshotPath}`);
  }
  const text = fs.readFileSync(snapshotPath, "utf-8");
  const match = text.match(/\*\*Commit\*\*:\s*`([0-9a-f]{7,40})`/i);
  if (!match) {
    throw new Error(
      "Could not find Commit field in SNAPSHOT.md. Expected line like '- **Commit**: `<hash>`'.",
    );
  }
  return match[1];
}

/** Convert gsd: colon references to hyphen. Returns {content, replacements}. */
function transformContent(content) {
  let replacements = 0;
  const out = content.replace(GSD_COLON_RE, (_match, suffix) => {
    replacements += 1;
    return `gsd-${suffix}`;
  });
  return { content: out, replacements };
}

function sha1(buf) {
  return crypto.createHash("sha1").update(buf).digest("hex");
}

function rmrf(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function listMdFiles(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith(".md"))
    .map((d) => d.name)
    .sort();
}

function main() {
  console.log(`[vendor-gsd] source: ${SOURCE_DIR}`);
  console.log(`[vendor-gsd] bundle: ${BUNDLE_DIR}`);

  if (!fs.existsSync(SOURCE_DIR)) {
    console.error(`[vendor-gsd] source dir missing: ${SOURCE_DIR}`);
    process.exit(1);
  }

  const commandsSrc = path.join(SOURCE_DIR, "commands", "gsd");
  const agentsSrc = path.join(SOURCE_DIR, "agents");
  const licenseSrc = path.join(SOURCE_DIR, "LICENSE");

  if (!fs.existsSync(commandsSrc) || !fs.existsSync(agentsSrc) || !fs.existsSync(licenseSrc)) {
    console.error(
      "[vendor-gsd] missing required source files. Expected commands/gsd, agents, LICENSE under vendor/gsd-source/.",
    );
    process.exit(1);
  }

  const sourceCommit = readSnapshotCommit();
  console.log(`[vendor-gsd] source commit: ${sourceCommit}`);

  rmrf(BUNDLE_DIR);
  mkdirp(path.join(BUNDLE_DIR, "commands"));
  mkdirp(path.join(BUNDLE_DIR, "agents"));

  const report = {
    transformVersion: TRANSFORM_VERSION,
    sourceCommit,
    commands: [],
    agents: [],
    totals: { commandFiles: 0, agentFiles: 0, totalReplacements: 0 },
  };

  // ---- commands ----
  const commandFiles = listMdFiles(commandsSrc);
  if (commandFiles.length !== 67) {
    console.warn(
      `[vendor-gsd] WARNING: expected 67 command files, found ${commandFiles.length}`,
    );
  }
  const seenBundleNames = new Map(); // bundle stem -> source filename, for collision detection
  for (const name of commandFiles) {
    const fileStem = name.replace(/\.md$/, "");
    const src = path.join(commandsSrc, name);
    const raw = fs.readFileSync(src, "utf-8");
    const { content, replacements } = transformContent(raw);

    // Derive the bundle filename from frontmatter `name` (after transform). This
    // honors GSD v1.40+ namespace routers where filename != frontmatter name
    // (e.g. ns-context.md -> gsd-context). Fall back to fileStem with gsd- prefix.
    const fmName = readFrontmatterName(content); // already post-transform, so hyphen form
    let bundleStem;
    if (fmName && /^gsd-[a-z][a-z0-9-]*$/.test(fmName)) {
      bundleStem = fmName;
    } else {
      bundleStem = `gsd-${fileStem}`;
    }

    // Collision check
    if (seenBundleNames.has(bundleStem)) {
      throw new Error(
        `Bundle filename collision: '${bundleStem}.md' produced by both ${seenBundleNames.get(bundleStem)} and ${name}`,
      );
    }
    seenBundleNames.set(bundleStem, name);

    const dst = path.join(BUNDLE_DIR, "commands", `${bundleStem}.md`);
    fs.writeFileSync(dst, content, "utf-8");
    report.commands.push({
      sourceFile: `commands/gsd/${name}`,
      bundleFile: `commands/${bundleStem}.md`,
      bundleStem,
      replacements,
      renamed: bundleStem !== `gsd-${fileStem}`,
      sha1: sha1(content),
    });
    report.totals.totalReplacements += replacements;
  }
  report.totals.commandFiles = commandFiles.length;
  console.log(
    `[vendor-gsd] commands: ${commandFiles.length} files, ${report.commands.reduce(
      (s, c) => s + c.replacements,
      0,
    )} gsd: replacements`,
  );

  // ---- agents ----
  const agentFiles = listMdFiles(agentsSrc);
  if (agentFiles.length !== 33) {
    console.warn(
      `[vendor-gsd] WARNING: expected 33 agent files, found ${agentFiles.length}`,
    );
  }
  for (const name of agentFiles) {
    if (!/^gsd-[a-z][a-z0-9-]*\.md$/.test(name)) {
      console.warn(`[vendor-gsd] unexpected agent filename: ${name}`);
    }
    const src = path.join(agentsSrc, name);
    const dst = path.join(BUNDLE_DIR, "agents", name);
    const raw = fs.readFileSync(src, "utf-8");
    const { content, replacements } = transformContent(raw);
    fs.writeFileSync(dst, content, "utf-8");
    report.agents.push({
      sourceFile: `agents/${name}`,
      bundleFile: `agents/${name}`,
      replacements,
      sha1: sha1(content),
    });
    report.totals.totalReplacements += replacements;
  }
  report.totals.agentFiles = agentFiles.length;
  console.log(
    `[vendor-gsd] agents: ${agentFiles.length} files, ${report.agents.reduce(
      (s, a) => s + a.replacements,
      0,
    )} gsd: replacements`,
  );

  // ---- LICENSE ----
  fs.copyFileSync(licenseSrc, path.join(BUNDLE_DIR, "LICENSE"));

  // ---- plugin.json ----
  const pluginManifest = {
    name: "codepilot-gsd-vendor",
    displayName: "GSD (Get-Shit-Done)",
    description:
      "Get-Shit-Done meta-prompting system by TÂCHES, vendored from gsd-build/get-shit-done (MIT).",
    // `builtIn: true` signals to CodePilot's /api/skills scanner that this
    // plugin is bundled inside the desktop app and its commands should be
    // treated as loaded — i.e. surfaced in the slash-command popover even
    // though the Claude Code SDK didn't actively load it. Without this
    // flag, the two SDK-whitelist filters in useSlashCommands.ts strip out
    // all 67 /gsd-* commands at runtime.
    builtIn: true,
    source: "gsd-build/get-shit-done",
    sourceUrl: "https://github.com/gsd-build/get-shit-done",
    sourceCommit,
    transformVersion: TRANSFORM_VERSION,
    license: "MIT",
    licenseFile: "LICENSE",
    commandCount: commandFiles.length,
    agentCount: agentFiles.length,
    commandPrefix: "gsd-",
    bundledAt: new Date().toISOString().slice(0, 10), // date only; keep deterministic-ish across same day
  };
  fs.writeFileSync(
    path.join(BUNDLE_DIR, "plugin.json"),
    JSON.stringify(pluginManifest, null, 2) + "\n",
    "utf-8",
  );

  // ---- VERSION ----
  // Format: <sourceCommit-short>-v<transformVersion>
  const versionString = `${sourceCommit.slice(0, 12)}-v${TRANSFORM_VERSION}`;
  fs.writeFileSync(path.join(BUNDLE_DIR, "VERSION"), versionString + "\n", "utf-8");

  // ---- transform-report.json (for debugging; not consumed at runtime) ----
  fs.writeFileSync(
    path.join(BUNDLE_DIR, "transform-report.json"),
    JSON.stringify(report, null, 2) + "\n",
    "utf-8",
  );

  console.log(`[vendor-gsd] VERSION = ${versionString}`);
  console.log(`[vendor-gsd] DONE. Bundle ready at ${BUNDLE_DIR}`);
}

main();
