/**
 * Integration tests for the workbench persistence route (src/app/api/test/workbench/route.ts).
 *
 * Run with: npx tsx --test src/__tests__/unit/test-workbench-route.test.ts
 *
 * Drives GET/PUT against a temp data dir (CLAUDE_GUI_DATA_DIR): empty shell, PUT→GET
 * round-trip, malformed tolerance, type coercion, atomic write.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GET, PUT } from "../../app/api/test/workbench/route";

let tmp: string;
let origEnv: string | undefined;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wb-route-"));
  origEnv = process.env.CLAUDE_GUI_DATA_DIR;
  process.env.CLAUDE_GUI_DATA_DIR = tmp;
});
afterEach(() => {
  if (origEnv === undefined) delete process.env.CLAUDE_GUI_DATA_DIR;
  else process.env.CLAUDE_GUI_DATA_DIR = origEnv;
  fs.rmSync(tmp, { recursive: true, force: true });
});

const put = (body: unknown) => PUT(new Request("http://x/api/test/workbench", { method: "PUT", body: JSON.stringify(body) }));
const dataFile = () => path.join(tmp, "test-workbench.json");

describe("workbench persistence route", () => {
  it("GET returns an empty shell when no file exists", async () => {
    assert.deepEqual(await (await GET()).json(), { projects: [], taskStates: {} });
  });
  it("PUT persists projects + taskStates, GET reads them back", async () => {
    const body = { projects: [{ name: "p", path: "/x", tasks: [{ id: "t1", name: "登录" }] }], taskStates: { t1: { stepStatus: { requirement: "done" } } } };
    assert.deepEqual(await (await put(body)).json(), { ok: true });
    const got = await (await GET()).json();
    assert.deepEqual(got.projects, body.projects);
    assert.deepEqual(got.taskStates, body.taskStates);
  });
  it("GET tolerates a malformed json file (empty shell, no throw)", async () => {
    fs.writeFileSync(dataFile(), "{not json");
    assert.deepEqual(await (await GET()).json(), { projects: [], taskStates: {} });
  });
  it("PUT coerces non-array projects / non-object taskStates to safe defaults", async () => {
    await put({ projects: "nope", taskStates: [1, 2] });
    const got = await (await GET()).json();
    assert.deepEqual(got.projects, []);
    assert.deepEqual(got.taskStates, {});
  });
  it("PUT leaves no .tmp file behind (atomic write)", async () => {
    await put({ projects: [], taskStates: {} });
    assert.ok(!fs.readdirSync(tmp).some((f) => f.endsWith(".tmp")));
  });
});
