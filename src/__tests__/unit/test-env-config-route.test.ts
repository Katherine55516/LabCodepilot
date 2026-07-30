/**
 * Integration tests for the env-config route (src/app/api/test/env-config/route.ts).
 *
 * Run with: npx tsx --test src/__tests__/unit/test-env-config-route.test.ts
 *
 * Covers the param guards (projectPath required, env traversal → 400) and the
 * file-source resolution path. The DB-fallback path (no file → live 测试账号 DB)
 * needs better-sqlite3 and is exercised separately (B-class).
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GET } from "../../app/api/test/env-config/route";

let proj: string;
beforeEach(() => { proj = fs.mkdtempSync(path.join(os.tmpdir(), "envcfg-route-")); });
afterEach(() => { fs.rmSync(proj, { recursive: true, force: true }); });

const writeEnv = (json: unknown) => {
  const dir = path.join(proj, "AI_LabTest");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "environments.json"), JSON.stringify(json));
};
const get = (q: Record<string, string>) =>
  GET(new Request("http://x/api/test/env-config?" + new URLSearchParams(q).toString()));

describe("GET /api/test/env-config", () => {
  it("400 without projectPath", async () => {
    assert.equal((await GET(new Request("http://x/api/test/env-config"))).status, 400);
  });
  it("400 on a traversal env (H2)", async () => {
    assert.equal((await get({ projectPath: proj, env: "../../x" })).status, 400);
  });
  it("resolves an exported environments.json (file source, no DB touched)", async () => {
    writeEnv({ default: "local", allowedEnvs: ["local", "sit"], environments: { local: { frontendBaseUrl: "http://localhost:3000", defaultAccount: "u1" } } });
    const r = await (await get({ projectPath: proj })).json();
    assert.equal(r.configured, true);
    assert.equal(r.env, "local");
    assert.equal(r.frontendBaseUrl, "http://localhost:3000");
    assert.equal(r.source, "file");
  });
  it("honors a requested env over the default", async () => {
    writeEnv({ default: "local", allowedEnvs: ["local", "sit"], environments: { local: { frontendBaseUrl: "http://a" }, sit: { frontendBaseUrl: "http://b" } } });
    const r = await (await get({ projectPath: proj, env: "sit" })).json();
    assert.equal(r.env, "sit");
    assert.equal(r.frontendBaseUrl, "http://b");
  });
  it("returns the requested SIT URL and its captured default-account login state together", async () => {
    writeEnv({
      default: "local",
      allowedEnvs: ["local", "sit"],
      environments: {
        local: { frontendBaseUrl: "http://localhost:3000" },
        sit: {
          frontendBaseUrl: "https://fhrms-di1.sit.cmft.com/index",
          defaultAccount: "role1",
        },
      },
    });
    const authDir = path.join(proj, "AI_LabTest", ".auth");
    fs.mkdirSync(authDir, { recursive: true });
    fs.writeFileSync(
      path.join(authDir, "sit.role1.storageState.json"),
      JSON.stringify({
        cookies: [{ name: "session", value: "redacted", expires: -1 }],
        origins: [],
      }),
    );

    const r = await (await get({ projectPath: proj, env: "sit" })).json();
    assert.equal(r.env, "sit");
    assert.equal(r.frontendBaseUrl, "https://fhrms-di1.sit.cmft.com/index");
    assert.equal(r.loginState.account, "role1");
    assert.equal(r.loginState.hasState, true);
    assert.equal(r.loginState.expired, false);
    assert.equal(typeof r.loginState.capturedAtMs, "number");
  });
});
