/**
 * Integration tests for the 用例 R/W route (src/app/api/test/cases/route.ts).
 *
 * Run with: npx tsx --test src/__tests__/unit/test-cases-route.test.ts
 *
 * Drives the real GET/PUT handlers against a temp project dir: empty/malformed
 * tolerance, PUT→GET round-trip, atomic write, bare-array acceptance, 400s.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GET, PUT } from "../../app/api/test/cases/route";

let proj: string;
beforeEach(() => { proj = fs.mkdtempSync(path.join(os.tmpdir(), "cases-route-")); });
afterEach(() => { fs.rmSync(proj, { recursive: true, force: true }); });

const getUrl = (p: Record<string, string>) =>
  "http://x/api/test/cases?" + new URLSearchParams(p).toString();
const casesFile = (taskName: string) =>
  path.join(proj, "AI_LabTest", "testCase", ".data", `${taskName}.cases.json`);
const plantCases = (taskName: string, content: string) => {
  const f = casesFile(taskName);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, content);
};

describe("GET /api/test/cases", () => {
  it("returns empty cases when the file is absent", async () => {
    const res = await GET(new Request(getUrl({ projectPath: proj, taskName: "订单" })));
    assert.deepEqual(await res.json(), { cases: [] });
  });
  it("returns empty cases when params are missing", async () => {
    const res = await GET(new Request("http://x/api/test/cases"));
    assert.deepEqual(await res.json(), { cases: [] });
  });
  it("tolerates a malformed cases.json (returns empty, no throw)", async () => {
    plantCases("订单", "{not valid json");
    const res = await GET(new Request(getUrl({ projectPath: proj, taskName: "订单" })));
    assert.deepEqual(await res.json(), { cases: [] });
  });
  it("accepts a bare-array cases.json (no {cases} wrapper)", async () => {
    plantCases("订单", JSON.stringify([{ id: "TC-1" }]));
    const res = await GET(new Request(getUrl({ projectPath: proj, taskName: "订单" })));
    assert.deepEqual((await res.json()).cases, [{ id: "TC-1" }]);
  });
  it("returns empty for a traversal taskName — no escape (H2)", async () => {
    const res = await GET(new Request(getUrl({ projectPath: proj, taskName: "../../evil" })));
    assert.deepEqual(await res.json(), { cases: [] });
  });
});

describe("PUT /api/test/cases", () => {
  const put = (body: unknown) =>
    PUT(new Request("http://x/api/test/cases", { method: "PUT", body: JSON.stringify(body) }));

  it("writes cases, then GET reads them back (round-trip)", async () => {
    const cases = [{ id: "TC-1", purpose: "登录", steps: [{ content: "点登录", expected: "【UI检查】跳转首页" }] }];
    const putRes = await put({ projectPath: proj, taskName: "订单", cases });
    assert.deepEqual(await putRes.json(), { ok: true });
    const getRes = await GET(new Request(getUrl({ projectPath: proj, taskName: "订单" })));
    assert.deepEqual((await getRes.json()).cases, cases);
  });
  it("persists as { cases: [...] } pretty JSON on disk", async () => {
    await put({ projectPath: proj, taskName: "订单", cases: [{ id: "TC-1" }] });
    const onDisk = JSON.parse(fs.readFileSync(casesFile("订单"), "utf-8"));
    assert.deepEqual(onDisk, { cases: [{ id: "TC-1" }] });
  });
  it("coerces a non-array cases payload to []", async () => {
    const res = await put({ projectPath: proj, taskName: "订单", cases: { not: "an array" } });
    assert.deepEqual(await res.json(), { ok: true });
    const onDisk = JSON.parse(fs.readFileSync(casesFile("订单"), "utf-8"));
    assert.deepEqual(onDisk, { cases: [] });
  });
  it("400 when projectPath/taskName missing", async () => {
    const res = await put({ taskName: "订单" });
    assert.equal(res.status, 400);
  });
  it("leaves no .tmp file behind after a successful write (atomic)", async () => {
    await put({ projectPath: proj, taskName: "订单", cases: [{ id: "TC-1" }] });
    const dir = path.dirname(casesFile("订单"));
    assert.ok(!fs.readdirSync(dir).some((f) => f.endsWith(".tmp")));
  });
  it("400 on a traversal taskName (H2)", async () => {
    const res = await put({ projectPath: proj, taskName: "../../evil", cases: [{ id: "TC-1" }] });
    assert.equal(res.status, 400);
    // nothing written outside the project
    assert.ok(!fs.existsSync(path.join(path.dirname(proj), "evil.cases.json")));
  });
});
