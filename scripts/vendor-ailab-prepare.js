#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Vendor-AI_LabTest prepare script.
 *
 * 读 vendor/ailab-source/（qitianersheng/ai-lab-test-agent 的固定快照），输出
 * vendor/ailab-bundle/ —— CodePilot 打包用的内置 AI_LabTest 插件资源。
 *
 * 与 GSD 的关键差异（见 docs/handover/ailab-plugin.md）：
 *   1. 不平面化、不重命名命令文件。AI_LabTest 在 CodePilot UI 里要的是
 *      命名空间形式 `ai-lab-test:cases`，它来自全局 `~/.claude/commands/ai-lab-test/`
 *      子目录（由 installer 镜像），所以命令文件名（stem）必须原样保留。
 *   2. 不做 `${CLAUDE_PLUGIN_ROOT}` 改写。该占位符指向资产（rules/templates/
 *      site-patterns），但用户机器上的 home 路径只有安装时才知道，因此改写
 *      推迟到 electron/ailab-installer.ts 在镜像命令/技能时进行（指向插件
 *      安装目录绝对路径）。bundle 里保留 `${CLAUDE_PLUGIN_ROOT}` 原文。
 *
 * 产出：
 *   vendor/ailab-bundle/
 *     commands/{cases,execute,init,knowledge-map,report,status}.md  (verbatim)
 *     skills/test-workflow/SKILL.md                                  (verbatim)
 *     rules/*.md (5)                                                 (verbatim)
 *     templates/* (5)                                               (verbatim)
 *     site-patterns/_template.md                                    (verbatim)
 *     .mcp.json                                                      (verbatim)
 *     plugin.json    (生成，builtIn:true, commandPrefix "ai-lab-test:")
 *     VERSION        (<commit12>-v<TRANSFORM_VERSION>)
 *     LICENSE
 *     transform-report.json
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const REPO_ROOT = path.resolve(__dirname, "..");
const SOURCE_DIR = path.join(REPO_ROOT, "vendor", "ailab-source");
const BUNDLE_DIR = path.join(REPO_ROOT, "vendor", "ailab-bundle");

// v1: 首版内置插件。bundle 结构变化时递增，强制已安装客户端在重新启用 / 版本
// 漂移时重新同步插件目录。
const TRANSFORM_VERSION = 1;

const EXPECTED_COMMAND_COUNT = 6;
const EXPECTED_RULE_COUNT = 5;
const EXPECTED_TEMPLATE_COUNT = 5;

function sha1(buf) {
  return crypto.createHash("sha1").update(buf).digest("hex");
}

function rmrf(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function listMdFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith(".md"))
    .map((d) => d.name)
    .sort();
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

/** Read .claude-plugin/plugin.json for name / displayName / version. */
function readSourceManifest() {
  const p = path.join(SOURCE_DIR, ".claude-plugin", "plugin.json");
  if (!fs.existsSync(p)) {
    throw new Error(`source plugin.json not found at ${p}`);
  }
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

/**
 * Recursively copy a tree from src to dst verbatim. Returns a flat list of
 * {relPath, sha1} entries for the report.
 */
function copyTreeVerbatim(srcRoot, dstRoot, stats) {
  function walk(relDir) {
    const absSrc = path.join(srcRoot, relDir);
    const absDst = path.join(dstRoot, relDir);
    fs.mkdirSync(absDst, { recursive: true });
    for (const ent of fs.readdirSync(absSrc, { withFileTypes: true })) {
      if (ent.name === ".DS_Store") continue;
      const childRel = path.posix.join(relDir.replace(/\\/g, "/"), ent.name);
      if (ent.isDirectory()) {
        walk(childRel);
        continue;
      }
      if (!ent.isFile()) continue;
      const srcFile = path.join(srcRoot, childRel);
      const dstFile = path.join(dstRoot, childRel);
      const buf = fs.readFileSync(srcFile);
      fs.writeFileSync(dstFile, buf);
      stats.push({ relPath: childRel, sha1: sha1(buf) });
    }
  }
  walk("");
}

/** Copy a single file verbatim and record it in stats. */
function copyFileVerbatim(srcFile, dstFile, relLabel, stats) {
  const buf = fs.readFileSync(srcFile);
  mkdirp(path.dirname(dstFile));
  fs.writeFileSync(dstFile, buf);
  stats.push({ relPath: relLabel, sha1: sha1(buf) });
}

function main() {
  console.log(`[vendor-ailab] source: ${SOURCE_DIR}`);
  console.log(`[vendor-ailab] bundle: ${BUNDLE_DIR}`);

  if (!fs.existsSync(SOURCE_DIR)) {
    console.error(`[vendor-ailab] source dir missing: ${SOURCE_DIR}`);
    process.exit(1);
  }

  const commandsSrc = path.join(SOURCE_DIR, "commands");
  const skillSrc = path.join(SOURCE_DIR, "skills", "test-workflow", "SKILL.md");
  const rulesSrc = path.join(SOURCE_DIR, "rules");
  const templatesSrc = path.join(SOURCE_DIR, "templates");
  const sitePatternsSrc = path.join(SOURCE_DIR, "site-patterns");
  const mcpSrc = path.join(SOURCE_DIR, ".mcp.json");
  const licenseSrc = path.join(SOURCE_DIR, "LICENSE");

  for (const [label, p] of [
    ["commands/", commandsSrc],
    ["skills/test-workflow/SKILL.md", skillSrc],
    ["rules/", rulesSrc],
    ["templates/", templatesSrc],
    [".mcp.json", mcpSrc],
    ["LICENSE", licenseSrc],
  ]) {
    if (!fs.existsSync(p)) {
      console.error(`[vendor-ailab] missing required source: ${label} (${p})`);
      process.exit(1);
    }
  }

  const sourceCommit = readSnapshotCommit();
  const srcManifest = readSourceManifest();
  console.log(`[vendor-ailab] source commit: ${sourceCommit}`);
  console.log(`[vendor-ailab] source plugin: ${srcManifest.name} v${srcManifest.version}`);

  rmrf(BUNDLE_DIR);
  mkdirp(BUNDLE_DIR);

  const report = {
    transformVersion: TRANSFORM_VERSION,
    sourceCommit,
    sourcePluginVersion: srcManifest.version,
    commands: [],
    skills: [],
    rules: [],
    templates: [],
    sitePatterns: [],
    other: [],
    totals: { commandFiles: 0, ruleFiles: 0, templateFiles: 0 },
  };

  // ---- commands (verbatim, no flatten / no rename) ----
  const commandFiles = listMdFiles(commandsSrc);
  if (commandFiles.length !== EXPECTED_COMMAND_COUNT) {
    console.warn(
      `[vendor-ailab] WARNING: expected ${EXPECTED_COMMAND_COUNT} command files, found ${commandFiles.length}`,
    );
  }
  mkdirp(path.join(BUNDLE_DIR, "commands"));
  for (const name of commandFiles) {
    copyFileVerbatim(
      path.join(commandsSrc, name),
      path.join(BUNDLE_DIR, "commands", name),
      `commands/${name}`,
      report.commands,
    );
  }
  report.totals.commandFiles = commandFiles.length;
  console.log(`[vendor-ailab] commands: ${commandFiles.length} files`);

  // ---- skill (verbatim) ----
  copyFileVerbatim(
    skillSrc,
    path.join(BUNDLE_DIR, "skills", "test-workflow", "SKILL.md"),
    "skills/test-workflow/SKILL.md",
    report.skills,
  );
  console.log(`[vendor-ailab] skills: test-workflow/SKILL.md`);

  // ---- rules (verbatim) ----
  const ruleFiles = listMdFiles(rulesSrc);
  if (ruleFiles.length !== EXPECTED_RULE_COUNT) {
    console.warn(
      `[vendor-ailab] WARNING: expected ${EXPECTED_RULE_COUNT} rule files, found ${ruleFiles.length}`,
    );
  }
  copyTreeVerbatim(rulesSrc, path.join(BUNDLE_DIR, "rules"), report.rules);
  report.totals.ruleFiles = ruleFiles.length;
  console.log(`[vendor-ailab] rules: ${ruleFiles.length} files`);

  // ---- templates (verbatim, includes non-.md like gitignore.snippet) ----
  copyTreeVerbatim(templatesSrc, path.join(BUNDLE_DIR, "templates"), report.templates);
  report.totals.templateFiles = report.templates.length;
  console.log(`[vendor-ailab] templates: ${report.templates.length} files`);

  // ---- site-patterns (verbatim) ----
  if (fs.existsSync(sitePatternsSrc)) {
    copyTreeVerbatim(
      sitePatternsSrc,
      path.join(BUNDLE_DIR, "site-patterns"),
      report.sitePatterns,
    );
    console.log(`[vendor-ailab] site-patterns: ${report.sitePatterns.length} files`);
  }

  // ---- .mcp.json (verbatim — installer/renderer registers Playwright MCP) ----
  copyFileVerbatim(mcpSrc, path.join(BUNDLE_DIR, ".mcp.json"), ".mcp.json", report.other);

  // ---- LICENSE ----
  copyFileVerbatim(licenseSrc, path.join(BUNDLE_DIR, "LICENSE"), "LICENSE", report.other);

  // ---- plugin.json (generated) ----
  const pluginManifest = {
    name: "codepilot-ailab-vendor",
    displayName: srcManifest.displayName || "AI_LabTest QA 自动化测试框架",
    description:
      srcManifest.description ||
      "AI_LabTest QA 自动化测试插件，3 步强制工作流（用例设计→AI 实时驱动 Playwright 执行→报告）。",
    // builtIn:true 告诉 CodePilot 的 /api/skills 扫描器这是随桌面端打包的内置
    // 插件：其命令应被视为已加载、在 slash 命令弹窗中常驻（绕过 SDK 白名单），
    // 同时让扫描器跳过插件目录自身的 commands/ 以避免与全局镜像重复列出。
    builtIn: true,
    source: "qitianersheng/ai-lab-test-agent",
    sourceUrl: "https://github.com/qitianersheng/ai-lab-test-agent",
    sourceCommit,
    sourcePluginVersion: srcManifest.version,
    transformVersion: TRANSFORM_VERSION,
    license: "MIT",
    licenseFile: "LICENSE",
    commandCount: commandFiles.length,
    skillCount: 1,
    ruleCount: ruleFiles.length,
    // 命名空间前缀：命令镜像进 ~/.claude/commands/ai-lab-test/ 子目录后，
    // CodePilot 扫描器以 <subdir>:<stem> 命名，得到 ai-lab-test:cases 等。
    commandPrefix: "ai-lab-test:",
    requiresMcp: ["playwright"],
    bundledAt: new Date().toISOString().slice(0, 10),
  };
  fs.writeFileSync(
    path.join(BUNDLE_DIR, "plugin.json"),
    JSON.stringify(pluginManifest, null, 2) + "\n",
    "utf-8",
  );

  // ---- VERSION ----
  const versionString = `${sourceCommit.slice(0, 12)}-v${TRANSFORM_VERSION}`;
  fs.writeFileSync(path.join(BUNDLE_DIR, "VERSION"), versionString + "\n", "utf-8");

  // ---- transform-report.json ----
  fs.writeFileSync(
    path.join(BUNDLE_DIR, "transform-report.json"),
    JSON.stringify(report, null, 2) + "\n",
    "utf-8",
  );

  console.log(`[vendor-ailab] VERSION = ${versionString}`);
  console.log(`[vendor-ailab] DONE. Bundle ready at ${BUNDLE_DIR}`);
}

main();
