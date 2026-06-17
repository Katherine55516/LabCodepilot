#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Verify the integrity of vendor/gsd-bundle/ produced by vendor-gsd-prepare.js.
 *
 * Exits non-zero on any failure. Used by CI / pre-commit / before electron-builder.
 */

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..");
const BUNDLE_DIR = path.join(REPO_ROOT, "vendor", "gsd-bundle");

const EXPECTED_COMMAND_COUNT = 67;
const EXPECTED_AGENT_COUNT = 33;
// get-shit-done/ subtree (workflows + references + templates + bin + contexts).
// Exact count varies if upstream churns; use a floor that catches a missing
// subtree (e.g. someone forgot to copy in get-shit-done/) but tolerates
// minor file shuffles.
const ASSET_REQUIRED_SUBDIRS = ["workflows", "references", "templates", "bin", "contexts"];
const ASSET_MIN_TOTAL_FILES = 250;

const errors = [];

function err(msg) {
  errors.push(msg);
  console.error(`[verify-gsd] FAIL: ${msg}`);
}

function ok(msg) {
  console.log(`[verify-gsd] OK  : ${msg}`);
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
  return fs
    .readdirSync(dir)
    .filter((n) => n.endsWith(".md"))
    .sort();
}

function countRecursive(dir) {
  let total = 0;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const child = path.join(dir, ent.name);
    if (ent.isDirectory()) total += countRecursive(child);
    else if (ent.isFile()) total += 1;
  }
  return total;
}

function checkCount(label, actual, expected) {
  if (actual !== expected) {
    err(`${label} count = ${actual}, expected ${expected}`);
  } else {
    ok(`${label} count = ${actual}`);
  }
}

function checkFrontmatterName(filepath, expectedName) {
  const text = fs.readFileSync(filepath, "utf-8");
  const fm = text.match(/^---\r?\n([\s\S]+?)\r?\n---/);
  if (!fm) {
    err(`${path.relative(BUNDLE_DIR, filepath)}: no YAML frontmatter`);
    return;
  }
  const nameMatch = fm[1].match(/^name:\s*(.+)$/m);
  if (!nameMatch) {
    err(`${path.relative(BUNDLE_DIR, filepath)}: frontmatter has no 'name:' field`);
    return;
  }
  const actual = nameMatch[1].trim();
  if (actual !== expectedName) {
    err(
      `${path.relative(BUNDLE_DIR, filepath)}: frontmatter name = '${actual}', expected '${expectedName}'`,
    );
  }
}

function checkNoColonReference(filepath) {
  const text = fs.readFileSync(filepath, "utf-8");
  // Find any residual `gsd:foo` reference (after transform there should be none)
  const residual = text.match(/\bgsd:[a-z][a-z0-9-]*\b/g);
  if (residual) {
    err(
      `${path.relative(BUNDLE_DIR, filepath)}: residual 'gsd:' references found: ${residual.slice(0, 5).join(", ")}${residual.length > 5 ? ` (+${residual.length - 5})` : ""}`,
    );
  }
}

function main() {
  if (!fs.existsSync(BUNDLE_DIR)) {
    err(`bundle dir missing: ${BUNDLE_DIR}. Run 'npm run vendor:gsd' first.`);
    process.exit(1);
  }

  // ---- top-level files ----
  const requiredFiles = ["LICENSE", "plugin.json", "VERSION", "transform-report.json"];
  for (const f of requiredFiles) {
    if (requireFile(f)) ok(`exists: ${f}`);
  }

  // ---- counts ----
  const commands = listMd(path.join(BUNDLE_DIR, "commands"));
  const agents = listMd(path.join(BUNDLE_DIR, "agents"));
  checkCount("commands", commands.length, EXPECTED_COMMAND_COUNT);
  checkCount("agents", agents.length, EXPECTED_AGENT_COUNT);

  // ---- command file naming + frontmatter ----
  for (const name of commands) {
    if (!/^gsd-[a-z][a-z0-9-]*\.md$/.test(name)) {
      err(`commands/${name}: filename not in 'gsd-<word>.md' form`);
      continue;
    }
    const stem = name.replace(/\.md$/, "");
    const full = path.join(BUNDLE_DIR, "commands", name);
    checkFrontmatterName(full, stem);
    checkNoColonReference(full);
  }
  if (commands.length === EXPECTED_COMMAND_COUNT) ok("all command filenames + frontmatter pass");

  // ---- agent file naming ----
  for (const name of agents) {
    if (!/^gsd-[a-z][a-z0-9-]*\.md$/.test(name)) {
      err(`agents/${name}: filename not in 'gsd-<word>.md' form`);
      continue;
    }
    const full = path.join(BUNDLE_DIR, "agents", name);
    checkNoColonReference(full);
  }
  if (agents.length === EXPECTED_AGENT_COUNT) ok("all agent filenames + colon-free pass");

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
      "agentCount",
      "commandPrefix",
    ];
    for (const k of required) {
      if (!(k in manifest)) err(`plugin.json missing key: ${k}`);
    }
    if (manifest.commandCount !== EXPECTED_COMMAND_COUNT) {
      err(`plugin.json commandCount = ${manifest.commandCount}, expected ${EXPECTED_COMMAND_COUNT}`);
    }
    if (manifest.agentCount !== EXPECTED_AGENT_COUNT) {
      err(`plugin.json agentCount = ${manifest.agentCount}, expected ${EXPECTED_AGENT_COUNT}`);
    }
    if (manifest.commandPrefix !== "gsd-") {
      err(`plugin.json commandPrefix = '${manifest.commandPrefix}', expected 'gsd-'`);
    }
    if (manifest.builtIn !== true) {
      err("plugin.json builtIn must be true for AI Native Lab-bundled plugin");
    }
    ok("plugin.json schema");
  } catch (e) {
    err(`plugin.json parse error: ${e.message}`);
  }

  // ---- get-shit-done/ asset subtree ----
  const assetsRoot = path.join(BUNDLE_DIR, "get-shit-done");
  if (!fs.existsSync(assetsRoot)) {
    err("get-shit-done/ asset directory missing from bundle");
  } else {
    let totalAssets = 0;
    for (const sub of ASSET_REQUIRED_SUBDIRS) {
      const subPath = path.join(assetsRoot, sub);
      if (!fs.existsSync(subPath)) {
        err(`get-shit-done/${sub}/ subdirectory missing`);
        continue;
      }
      totalAssets += countRecursive(subPath);
    }
    if (totalAssets < ASSET_MIN_TOTAL_FILES) {
      err(`get-shit-done/ total files = ${totalAssets}, expected >= ${ASSET_MIN_TOTAL_FILES}`);
    } else {
      ok(`get-shit-done/ assets present (${totalAssets} files across ${ASSET_REQUIRED_SUBDIRS.length} subdirs)`);
    }
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
    console.error(`\n[verify-gsd] FAILED with ${errors.length} error(s)`);
    process.exit(1);
  }
  console.log("\n[verify-gsd] All checks passed.");
}

main();
