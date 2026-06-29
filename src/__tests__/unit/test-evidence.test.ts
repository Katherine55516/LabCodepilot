/**
 * Unit tests for execution-step evidence collection (src/lib/test/evidence.ts).
 *
 * Run with: npx tsx --test src/__tests__/unit/test-evidence.test.ts
 *
 * Covers the pure fs logic: magic-number sniff, stray-evidence sweep (by name +
 * run mtime), and extension normalization. (The MCP launcher shim's chdir effect
 * only proves out on a real browser run, so it's verified by inspection elsewhere.)
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { sniffExt, sweepStrayEvidence, normalizeEvidenceExt, writeMcpLauncherShim } from "../../lib/test/evidence";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const WEBM = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x02]);
const GIF = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);

describe("sniffExt", () => {
  it("recognizes png/jpg/webm/gif by magic number", () => {
    assert.equal(sniffExt(PNG), "png");
    assert.equal(sniffExt(JPG), "jpg");
    assert.equal(sniffExt(WEBM), "webm");
    assert.equal(sniffExt(GIF), "gif");
  });
  it("returns null for unknown/empty bytes", () => {
    assert.equal(sniffExt(Buffer.from([0x00, 0x01, 0x02, 0x03])), null);
    assert.equal(sniffExt(Buffer.from([])), null);
  });
});

describe("sweepStrayEvidence", () => {
  let root: string;
  let evidenceDir: string;
  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ev-sweep-"));
    evidenceDir = path.join(root, "AI_LabTest", "report", "_evidence", "订单-local");
    const sinceMs = Date.now() - 5000; // run "started" 5s ago
    // recent, evidence-shaped → should be swept
    fs.writeFileSync(path.join(root, "TC-001.png"), PNG);
    fs.writeFileSync(path.join(root, "TC-002.webm"), WEBM);
    // non-evidence → ignored
    fs.writeFileSync(path.join(root, "notes.txt"), "hi");
    // evidence-shaped but OLD (before run start) → not swept
    const stale = path.join(root, "TC-old.png");
    fs.writeFileSync(stale, PNG);
    const oldT = (sinceMs - 100000) / 1000;
    fs.utimesSync(stale, oldT, oldT);
  });
  after(() => fs.rmSync(root, { recursive: true, force: true }));

  it("moves recent evidence-shaped files into evidenceDir, skips stale + non-evidence", () => {
    const moved = sweepStrayEvidence({ dirs: [root], evidenceDir, sinceMs: Date.now() - 5000 });
    const movedNames = moved.map((p) => path.basename(p)).sort();
    assert.deepEqual(movedNames, ["TC-001.png", "TC-002.webm"]);
    // destination has them
    assert.ok(fs.existsSync(path.join(evidenceDir, "TC-001.png")));
    assert.ok(fs.existsSync(path.join(evidenceDir, "TC-002.webm")));
    // stale + non-evidence stayed in root
    assert.ok(fs.existsSync(path.join(root, "TC-old.png")));
    assert.ok(fs.existsSync(path.join(root, "notes.txt")));
    // originals removed from root
    assert.ok(!fs.existsSync(path.join(root, "TC-001.png")));
  });
});

describe("normalizeEvidenceExt", () => {
  let dir: string;
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ev-norm-"));
    fs.writeFileSync(path.join(dir, "TC-001"), PNG); // no ext, PNG bytes
    fs.writeFileSync(path.join(dir, "TC-002"), WEBM); // no ext, WEBM bytes
    fs.writeFileSync(path.join(dir, "TC-003.png"), PNG); // already has ext → untouched
    fs.writeFileSync(path.join(dir, "junk"), Buffer.from([0, 1, 2, 3])); // unknown → untouched
  });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("appends sniffed extensions to extension-less media files only", () => {
    const fixed = normalizeEvidenceExt(dir).map((p) => path.basename(p)).sort();
    assert.deepEqual(fixed, ["TC-001.png", "TC-002.webm"]);
    assert.ok(fs.existsSync(path.join(dir, "TC-001.png")));
    assert.ok(fs.existsSync(path.join(dir, "TC-002.webm")));
    assert.ok(!fs.existsSync(path.join(dir, "TC-001"))); // renamed away
    assert.ok(fs.existsSync(path.join(dir, "TC-003.png"))); // untouched
    assert.ok(fs.existsSync(path.join(dir, "junk"))); // unknown bytes, untouched
  });
});

// Regression for M2: a user file that merely starts with "TC-" but has a non-media
// extension (TC-spec.md) must NOT be swept out of the project root; only media files
// and extension-less TC- screenshots are evidence.
describe("sweepStrayEvidence — leaves TC-prefixed user files (non-media ext) alone (M2)", () => {
  let root: string;
  let evidenceDir: string;
  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ev-m2-"));
    evidenceDir = path.join(root, "_evidence");
    fs.writeFileSync(path.join(root, "TC-spec.md"), "user design notes");
    fs.writeFileSync(path.join(root, "TC-plan.txt"), "user file");
    fs.writeFileSync(path.join(root, "TC-001.png"), PNG); // real evidence (media ext)
    fs.writeFileSync(path.join(root, "TC-shot"), PNG); // ext-less screenshot → still evidence
  });
  after(() => fs.rmSync(root, { recursive: true, force: true }));

  it("sweeps media + ext-less TC- screenshots, but leaves TC-*.md/.txt user files", () => {
    const moved = sweepStrayEvidence({ dirs: [root], evidenceDir, sinceMs: Date.now() - 5000 })
      .map((p) => path.basename(p))
      .sort();
    assert.deepEqual(moved, ["TC-001.png", "TC-shot"]);
    assert.ok(fs.existsSync(path.join(root, "TC-spec.md")), "TC-spec.md must NOT be swept");
    assert.ok(fs.existsSync(path.join(root, "TC-plan.txt")), "TC-plan.txt must NOT be swept");
  });
});

describe("writeMcpLauncherShim", () => {
  it("writes a chdir shim that loads the CLI from env", () => {
    const p = writeMcpLauncherShim();
    const src = fs.readFileSync(p, "utf-8");
    assert.match(src, /process\.chdir\(process\.env\.AILAB_MCP_CWD\)/);
    assert.match(src, /require\(cli\)/);
  });
});
