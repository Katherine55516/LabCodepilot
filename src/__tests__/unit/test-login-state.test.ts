/**
 * Unit tests for inspectLoginState (src/lib/test/env-config.ts) — the execution
 * pre-flight login-state gate used by 多任务批量执行.
 *
 * Run with: npx tsx --test src/__tests__/unit/test-login-state.test.ts
 *
 * Pure fs read of the captured Playwright storageState; deterministic via injected
 * nowMs. Covers: no account, missing file, future/past/session-cookie expiry, mixed
 * cookies, and capturedAtMs presence.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveProjectEnv, inspectLoginState } from "../../lib/test/env-config";

const NOW = 1_700_000_000_000; // fixed "now" in ms
const sec = (ms: number) => Math.round(ms / 1000);

let proj: string;
beforeEach(() => { proj = fs.mkdtempSync(path.join(os.tmpdir(), "loginstate-")); });
afterEach(() => { fs.rmSync(proj, { recursive: true, force: true }); });

const writeEnv = (json: unknown) => {
  const dir = path.join(proj, "AI_LabTest");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "environments.json"), JSON.stringify(json));
};
// Write the captured storageState at the exact path resolveProjectEnv expects
// (.auth/{env}.{account}.storageState.json). Account "u1" needs no sanitization.
const writeAuth = (env: string, account: string, cookies: Array<{ expires?: number }>) => {
  const dir = path.join(proj, "AI_LabTest", ".auth");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${env}.${account}.storageState.json`), JSON.stringify({ cookies, origins: [] }));
};
const baseEnv = (account?: string) =>
  writeEnv({ default: "local", allowedEnvs: ["local", "sit"], environments: { local: { frontendBaseUrl: "http://localhost:3000", ...(account ? { defaultAccount: account } : {}) } } });

describe("inspectLoginState", () => {
  it("no default account → hasState false, account null", () => {
    baseEnv(); // no defaultAccount
    const info = inspectLoginState(resolveProjectEnv(proj, "local"), NOW);
    assert.equal(info.account, null);
    assert.equal(info.hasState, false);
    assert.equal(info.expired, false);
    assert.equal(info.capturedAtMs, null);
  });

  it("account configured but no .auth file → hasState false", () => {
    baseEnv("u1");
    const info = inspectLoginState(resolveProjectEnv(proj, "local"), NOW);
    assert.equal(info.account, "u1");
    assert.equal(info.hasState, false);
    assert.equal(info.expired, false);
  });

  it("future cookie → hasState true, not expired, capturedAtMs set", () => {
    baseEnv("u1");
    writeAuth("local", "u1", [{ expires: sec(NOW) + 100_000 }]);
    const info = inspectLoginState(resolveProjectEnv(proj, "local"), NOW);
    assert.equal(info.hasState, true);
    assert.equal(info.expired, false);
    assert.equal(typeof info.capturedAtMs, "number");
  });

  it("all cookies past → expired true", () => {
    baseEnv("u1");
    writeAuth("local", "u1", [{ expires: sec(NOW) - 1000 }, { expires: sec(NOW) - 5 }]);
    const info = inspectLoginState(resolveProjectEnv(proj, "local"), NOW);
    assert.equal(info.hasState, true);
    assert.equal(info.expired, true);
  });

  it("session cookies only (expires -1) → cannot prove staleness → not expired", () => {
    baseEnv("u1");
    writeAuth("local", "u1", [{ expires: -1 }, { expires: -1 }]);
    const info = inspectLoginState(resolveProjectEnv(proj, "local"), NOW);
    assert.equal(info.hasState, true);
    assert.equal(info.expired, false);
  });

  it("mixed: one live cookie keeps it valid", () => {
    baseEnv("u1");
    writeAuth("local", "u1", [{ expires: sec(NOW) - 1000 }, { expires: sec(NOW) + 100_000 }]);
    const info = inspectLoginState(resolveProjectEnv(proj, "local"), NOW);
    assert.equal(info.expired, false);
  });

  it("no cookies array at all → not expired (no signal)", () => {
    baseEnv("u1");
    const dir = path.join(proj, "AI_LabTest", ".auth");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "local.u1.storageState.json"), JSON.stringify({ origins: [] }));
    const info = inspectLoginState(resolveProjectEnv(proj, "local"), NOW);
    assert.equal(info.hasState, true);
    assert.equal(info.expired, false);
  });
});
