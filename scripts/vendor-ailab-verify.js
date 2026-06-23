#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Verify the integrity of vendor/ailab-bundle/ produced by
 * vendor-ailab-prepare.js. Exits non-zero on any failure. Used by CI /
 * pre-commit / before electron-builder.
 */

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..");
const BUNDLE_DIR = path.join(REPO_ROOT, "vendor", "ailab-bundle");

const EXPECTED_COMMAND_COUNT = 6;
const EXPECTED_RULE_COUNT = 5;
const EXPECTED_TEMPLATE_COUNT = 5;
const EXPECTED_COMMAND_STEMS = [
  "cases",
  "execute",
  "init",
  "knowledge-map",
  "report",
  "status",
];

const errors = [];

function err(msg) {
  errors.push(msg);
  console.error(`[verify-ailab] FAIL: ${msg}`);
}

function ok(msg) {
  console.log(`[verify-ailab] OK  : ${msg}`);
}

function requireFile(rel) {
  const p = path.join(BUNDLE_DIR, rel);
  if (!fs.existsSync(p)) {
    err(`missing file: ${rel}`);
    return null;
  }
  return p;
}

function listMd(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((n) => n.endsWith(".md")).sort();
}

function checkCount(label, actual, expected) {
  if (actual !== expected) {
    err(`${label} count = ${actual}, expected ${expected}`);
  } else {
    ok(`${label} count = ${actual}`);
  }
}

function main() {
  if (!fs.existsSync(BUNDLE_DIR)) {
    err(`bundle dir missing: ${BUNDLE_DIR}. Run 'npm run vendor:ailab' first.`);
    process.exit(1);
  }

  // ---- top-level files ----
  for (const f of ["LICENSE", "plugin.json", "VERSION", "transform-report.json", ".mcp.json"]) {
    if (requireFile(f)) ok(`exists: ${f}`);
  }

  // ---- commands: count + exact stems (filenames are load-bearing) ----
  const commands = listMd(path.join(BUNDLE_DIR, "commands"));
  checkCount("commands", commands.length, EXPECTED_COMMAND_COUNT);
  const stems = commands.map((n) => n.replace(/\.md$/, "")).sort();
  const expected = [...EXPECTED_COMMAND_STEMS].sort();
  if (JSON.stringify(stems) !== JSON.stringify(expected)) {
    err(`command stems mismatch. got [${stems.join(", ")}], expected [${expected.join(", ")}]`);
  } else {
    ok(`command stems = [${stems.join(", ")}]`);
  }

  // ---- skill ----
  if (requireFile("skills/test-workflow/SKILL.md")) ok("skill: test-workflow/SKILL.md");

  // ---- rules ----
  const rules = listMd(path.join(BUNDLE_DIR, "rules"));
  checkCount("rules", rules.length, EXPECTED_RULE_COUNT);

  // ---- templates ----
  const templatesDir = path.join(BUNDLE_DIR, "templates");
  const templateCount = fs.existsSync(templatesDir)
    ? fs.readdirSync(templatesDir).filter((n) => n !== ".DS_Store").length
    : 0;
  checkCount("templates", templateCount, EXPECTED_TEMPLATE_COUNT);

  // ---- site-patterns ----
  if (requireFile("site-patterns/_template.md")) ok("site-patterns/_template.md");

  // ---- .mcp.json declares playwright ----
  try {
    const mcp = JSON.parse(fs.readFileSync(path.join(BUNDLE_DIR, ".mcp.json"), "utf-8"));
    if (!mcp.mcpServers || !mcp.mcpServers.playwright) {
      err(".mcp.json does not declare a 'playwright' server");
    } else {
      ok(".mcp.json declares playwright server");
    }
  } catch (e) {
    err(`.mcp.json parse error: ${e.message}`);
  }

  // ---- plugin.json schema ----
  try {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(BUNDLE_DIR, "plugin.json"), "utf-8"),
    );
    const required = [
      "name",
      "displayName",
      "source",
      "sourceCommit",
      "transformVersion",
      "license",
      "commandCount",
      "skillCount",
      "commandPrefix",
    ];
    for (const k of required) {
      if (!(k in manifest)) err(`plugin.json missing key: ${k}`);
    }
    if (manifest.commandCount !== EXPECTED_COMMAND_COUNT) {
      err(`plugin.json commandCount = ${manifest.commandCount}, expected ${EXPECTED_COMMAND_COUNT}`);
    }
    if (manifest.skillCount !== 1) {
      err(`plugin.json skillCount = ${manifest.skillCount}, expected 1`);
    }
    if (manifest.commandPrefix !== "ai-lab-test:") {
      err(`plugin.json commandPrefix = '${manifest.commandPrefix}', expected 'ai-lab-test:'`);
    }
    if (manifest.builtIn !== true) {
      err("plugin.json builtIn must be true for CodePilot-bundled plugin");
    }
    if (manifest.name !== "codepilot-ailab-vendor") {
      err(`plugin.json name = '${manifest.name}', expected 'codepilot-ailab-vendor'`);
    }
    ok("plugin.json schema");
  } catch (e) {
    err(`plugin.json parse error: ${e.message}`);
  }

  // ---- VERSION format ----
  try {
    const ver = fs.readFileSync(path.join(BUNDLE_DIR, "VERSION"), "utf-8").trim();
    if (!/^[0-9a-f]{7,12}-v\d+$/.test(ver)) {
      err(`VERSION format invalid: '${ver}', expected '<commit>-v<num>'`);
    } else {
      ok(`VERSION = ${ver}`);
    }
  } catch (e) {
    err(`VERSION read error: ${e.message}`);
  }

  // ---- LICENSE content ----
  try {
    const license = fs.readFileSync(path.join(BUNDLE_DIR, "LICENSE"), "utf-8");
    if (!/MIT License/i.test(license)) {
      err("LICENSE does not look like MIT License");
    } else {
      ok("LICENSE looks like MIT");
    }
  } catch (e) {
    err(`LICENSE read error: ${e.message}`);
  }

  // ---- final ----
  if (errors.length > 0) {
    console.error(`\n[verify-ailab] FAILED with ${errors.length} error(s)`);
    process.exit(1);
  }
  console.log("\n[verify-ailab] All checks passed.");
}

main();
