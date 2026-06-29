/**
 * Guard tests for the AI-backed 修订 / 缺陷 routes (B-class).
 *
 * Run with: npx tsx --test src/__tests__/unit/test-revise-defect-route.test.ts
 *
 * Their core is a streamClaude call (real LLM — not auto-testable here). We lock the
 * deterministic guards that return BEFORE the agent runs: required params, supported
 * step, artifact/run.json presence, and the taskName/env traversal guard (H2). None
 * of these reach streamClaude, so no AI/credentials are needed. defect stays on the
 * file-first env path (planted environments.json) so it never touches the DB.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { POST as revisePOST } from "../../app/api/test/revise/route";
import { POST as defectPOST } from "../../app/api/test/defect/route";

let proj: string;
beforeEach(() => { proj = fs.mkdtempSync(path.join(os.tmpdir(), "rd-route-")); });
afterEach(() => { fs.rmSync(proj, { recursive: true, force: true }); });

const post = (fn: (r: Request) => Promise<Response>, body: unknown) =>
  fn(new Request("http://x", { method: "POST", body: JSON.stringify(body) }));
const plantEnv = () => {
  fs.mkdirSync(path.join(proj, "AI_LabTest"), { recursive: true });
  fs.writeFileSync(path.join(proj, "AI_LabTest", "environments.json"),
    JSON.stringify({ default: "local", allowedEnvs: ["local"], environments: { local: { frontendBaseUrl: "http://x" } } }));
};

describe("POST /api/test/revise — guards (no AI)", () => {
  it("400 without projectPath or instruction", async () => {
    assert.equal((await post(revisePOST, { taskName: "t", step: "requirement" })).status, 400); // no instruction
    assert.equal((await post(revisePOST, { instruction: "改", step: "requirement" })).status, 400); // no projectPath
  });
  it("400 for an unsupported step (only requirement / cases)", async () => {
    assert.equal((await post(revisePOST, { projectPath: proj, instruction: "改", step: "execution" })).status, 400);
  });
  it("400 when the artifact does not exist yet", async () => {
    assert.equal((await post(revisePOST, { projectPath: proj, instruction: "改", step: "requirement", taskName: "订单" })).status, 400);
  });
  it("400 on a traversal taskName before any file read (H2)", async () => {
    assert.equal((await post(revisePOST, { projectPath: proj, instruction: "改", step: "requirement", taskName: "../../evil" })).status, 400);
  });
});

describe("POST /api/test/defect — guards (no AI, file-first env → no DB)", () => {
  it("400 without projectPath", async () => {
    assert.equal((await post(defectPOST, { taskName: "订单" })).status, 400);
  });
  it("400 on a traversal taskName before env resolution (H2)", async () => {
    assert.equal((await post(defectPOST, { projectPath: proj, taskName: "../../evil" })).status, 400);
  });
  it("400 when run.json is missing", async () => {
    plantEnv(); // file-first env resolution → never hits the DB
    assert.equal((await post(defectPOST, { projectPath: proj, taskName: "订单", env: "local" })).status, 400);
  });
});
