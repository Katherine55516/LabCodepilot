/**
 * Unit tests for resolveProjectEnv (src/lib/test/env-config.ts) — the bridge from
 * the colleague's exported AI_LabTest/environments.json to the test workbench's
 * execution step (target baseUrl + captured login).
 *
 * Run with: npx tsx --test src/__tests__/unit/test-env-config.test.ts
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { resolveProjectEnv } from "../../lib/test/env-config";

function writeEnvFile(root: string, json: unknown) {
  const dir = path.join(root, "AI_LabTest");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "environments.json"), JSON.stringify(json), "utf-8");
}

const SAMPLE = {
  $schema: "...",
  default: "local",
  allowedEnvs: ["local", "sit"],
  environments: {
    local: {
      label: "本地", frontendBaseUrl: "http://localhost:3000", apiBaseUrl: "http://localhost:3000/api",
      healthEndpoint: "/", defaultAccount: "user1", accounts: [{ key: "user1", role: "user", username: "u", password: "p" }], tag: "local",
    },
    sit: {
      label: "SIT", frontendBaseUrl: "https://sit.example.com", apiBaseUrl: "TBD",
      healthEndpoint: "/", defaultAccount: "admin@x", accounts: [{ key: "admin@x", role: "admin", authType: "capture" }], tag: "SIT",
    },
  },
};

describe("resolveProjectEnv", () => {
  let root: string;
  before(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "envcfg-")); });
  after(() => fs.rmSync(root, { recursive: true, force: true }));

  it("returns unconfigured when environments.json is missing", () => {
    const r = resolveProjectEnv(path.join(root, "nope"));
    assert.equal(r.configured, false);
    assert.equal(r.frontendBaseUrl, null);
    assert.equal(r.env, "local");
  });

  it("resolves the default env (local) with its baseUrl", () => {
    writeEnvFile(root, SAMPLE);
    const r = resolveProjectEnv(root);
    assert.equal(r.env, "local");
    assert.equal(r.configured, true);
    assert.equal(r.frontendBaseUrl, "http://localhost:3000");
    assert.equal(r.apiBaseUrl, "http://localhost:3000/api");
    assert.equal(r.defaultAccount, "user1");
    assert.deepEqual(r.allowedEnvs, ["local", "sit"]);
  });

  it("resolves a requested env (sit) and maps TBD apiBaseUrl to null", () => {
    writeEnvFile(root, SAMPLE);
    const r = resolveProjectEnv(root, "sit");
    assert.equal(r.env, "sit");
    assert.equal(r.frontendBaseUrl, "https://sit.example.com");
    assert.equal(r.apiBaseUrl, null); // "TBD" → null
  });

  it("falls back to default when requested env is not allowed", () => {
    writeEnvFile(root, SAMPLE);
    const r = resolveProjectEnv(root, "uat"); // not in allowedEnvs
    assert.equal(r.env, "local");
  });

  it("treats frontendBaseUrl 'TBD' as not configured", () => {
    writeEnvFile(root, {
      default: "local", allowedEnvs: ["local", "sit"],
      environments: { local: { frontendBaseUrl: "TBD", apiBaseUrl: "TBD", defaultAccount: "", accounts: [] }, sit: {} },
    });
    const r = resolveProjectEnv(root, "local");
    assert.equal(r.configured, false);
    assert.equal(r.frontendBaseUrl, null);
  });

  it("detects the captured storageState file (sanitized account key)", () => {
    writeEnvFile(root, SAMPLE);
    // sit defaultAccount "admin@x" → sanitized "admin_x"
    const authDir = path.join(root, "AI_LabTest", ".auth");
    fs.mkdirSync(authDir, { recursive: true });
    fs.writeFileSync(path.join(authDir, "sit.admin_x.storageState.json"), "{}", "utf-8");
    const r = resolveProjectEnv(root, "sit");
    assert.ok(r.storageStatePath && r.storageStatePath.endsWith("sit.admin_x.storageState.json"));
    // local has no storageState file → null
    assert.equal(resolveProjectEnv(root, "local").storageStatePath, null);
  });
});
