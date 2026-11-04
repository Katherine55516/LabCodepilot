/**
 * Integration tests for 测试账号 CRUD + export + env DB-fallback (B-class — touches DB).
 *
 * Run with:
 *   CLAUDE_GUI_DATA_DIR=$(mktemp -d) npx tsx --test src/__tests__/unit/test-accounts-route.test.ts
 *
 * DB_PATH = {CLAUDE_GUI_DATA_DIR||~/.codepilot}/codepilot.db, resolved when @/lib/db
 * first loads. We set an isolated data dir BEFORE importing db (dynamic import in
 * before()) so CRUD never touches the real ~/.codepilot DB. For full-suite runs ALSO
 * pass CLAUDE_GUI_DATA_DIR on the CLI — another file may load @/lib/db first.
 */
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { NextRequest } from "next/server";

let list: typeof import("../../app/api/test-accounts/route");
let idR: typeof import("../../app/api/test-accounts/[id]/route");
let exportR: typeof import("../../app/api/test-accounts/[id]/export/route");
let envCfg: typeof import("../../app/api/test/env-config/route");
let resolveR: typeof import("../../app/api/test-accounts/resolve/route");
let projectSummariesR: typeof import("../../app/api/test-accounts/project-summaries/route");
let dbMod: typeof import("../../lib/db");

before(async () => {
  if (!process.env.CLAUDE_GUI_DATA_DIR) {
    process.env.CLAUDE_GUI_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ta-db-"));
  }
  list = await import("../../app/api/test-accounts/route");
  idR = await import("../../app/api/test-accounts/[id]/route");
  exportR = await import("../../app/api/test-accounts/[id]/export/route");
  envCfg = await import("../../app/api/test/env-config/route");
  resolveR = await import("../../app/api/test-accounts/resolve/route");
  projectSummariesR = await import("../../app/api/test-accounts/project-summaries/route");
  dbMod = await import("../../lib/db");
});
beforeEach(() => { dbMod.getDb().exec("DELETE FROM test_account_systems"); });

const asReq = (body?: unknown, method = "POST") =>
  new Request("http://x", body === undefined ? {} : { method, body: JSON.stringify(body) }) as unknown as NextRequest;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const envOf = (local: object) => ({ local, sit: {} });
const createSys = async (body: unknown) => (await (await list.POST(asReq(body))).json()).system;

describe("测试账号 CRUD", () => {
  it("POST creates a system (201) + GET lists it", async () => {
    const res = await list.POST(asReq({ name: "官网" }));
    assert.equal(res.status, 201);
    const sys = (await res.json()).system;
    assert.equal(sys.name, "官网");
    assert.ok(sys.id);
    assert.ok(sys.environments?.local && sys.environments?.sit); // normalized shape
    const all = (await (await list.GET()).json()).systems;
    assert.equal(all.length, 1);
    assert.equal(all[0].name, "官网");
  });
  it("POST 400 without a name", async () => {
    assert.equal((await list.POST(asReq({ name: "" }))).status, 400);
  });
  it("GET [id] → 200 for known, 404 for unknown", async () => {
    const sys = await createSys({ name: "支付" });
    assert.equal((await idR.GET(asReq(), ctx(sys.id))).status, 200);
    assert.equal((await idR.GET(asReq(), ctx("nope"))).status, 404);
  });
  it("PUT [id] updates / 404 for unknown", async () => {
    const sys = await createSys({ name: "old" });
    const upd = await idR.PUT(asReq({ name: "new" }, "PUT"), ctx(sys.id));
    assert.equal(upd.status, 200);
    assert.equal((await upd.json()).system.name, "new");
    assert.equal((await idR.PUT(asReq({ name: "z" }, "PUT"), ctx("nope"))).status, 404);
  });
  it("DELETE [id] removes / 404 for unknown", async () => {
    const sys = await createSys({ name: "del" });
    assert.equal((await idR.DELETE(asReq(), ctx(sys.id))).status, 200);
    assert.equal((await (await list.GET()).json()).systems.length, 0);
    assert.equal((await idR.DELETE(asReq(), ctx("nope"))).status, 404);
  });
  it("sort_order increments across creates", async () => {
    const a = await createSys({ name: "A" });
    const b = await createSys({ name: "B" });
    assert.ok(b.sort_order > a.sort_order);
  });
});

describe("导出 environments.json + env DB-fallback", () => {
  it("export writes {project_root}/AI_LabTest/environments.json (+ .auth dir)", async () => {
    const proj = fs.mkdtempSync(path.join(os.tmpdir(), "ta-proj-"));
    try {
      const sys = await createSys({ name: "官网", project_root: proj, environments: envOf({ frontendBaseUrl: "http://localhost:3000", accounts: [] }) });
      const res = await exportR.POST(asReq(), ctx(sys.id));
      assert.equal(res.status, 200);
      const f = path.join(proj, "AI_LabTest", "environments.json");
      assert.ok(fs.existsSync(f), "environments.json written");
      assert.ok(JSON.parse(fs.readFileSync(f, "utf-8")).environments?.local, "has environments.local");
      assert.ok(fs.existsSync(path.join(proj, "AI_LabTest", ".auth")), ".auth dir ensured");
    } finally { fs.rmSync(proj, { recursive: true, force: true }); }
  });
  it("export → 404 for unknown system, 400 when project_root missing", async () => {
    assert.equal((await exportR.POST(asReq(), ctx("nope"))).status, 404);
    const sys = await createSys({ name: "no-root" }); // no project_root
    assert.equal((await exportR.POST(asReq(), ctx(sys.id))).status, 400);
  });
  it("env-config falls back to the live DB when no environments.json file (source=db)", async () => {
    const proj = fs.mkdtempSync(path.join(os.tmpdir(), "ta-proj2-"));
    try {
      await createSys({ name: "官网", project_root: proj, environments: envOf({ frontendBaseUrl: "http://localhost:8080", accounts: [] }) });
      // NO export → resolveProjectEnvWithDb must hit the DB (project_root === projectPath).
      const r = await (await envCfg.GET(new Request("http://x/api/test/env-config?projectPath=" + encodeURIComponent(proj)))).json();
      assert.equal(r.source, "db");
      assert.equal(r.frontendBaseUrl, "http://localhost:8080");
    } finally { fs.rmSync(proj, { recursive: true, force: true }); }
  });
});

describe("resolve（工作台就地配置：项目路径 → 系统）", () => {
  const resolveOf = async (projectPath: string) =>
    (await resolveR.GET(new Request("http://x/api/test-accounts/resolve?projectPath=" + encodeURIComponent(projectPath)))).json();

  it("400 when projectPath is missing", async () => {
    assert.equal((await resolveR.GET(new Request("http://x/api/test-accounts/resolve"))).status, 400);
  });

  it("system:null for an unmatched path (不隐式建库)", async () => {
    const r = await resolveOf("/Users/dev/never-configured");
    assert.equal(r.system, null);
    assert.equal((await (await list.GET()).json()).systems.length, 0); // resolve 只读，不建库
  });

  it("matches by exact project_root", async () => {
    const sys = await createSys({ name: "官网", project_root: "/Users/dev/site" });
    const r = await resolveOf("/Users/dev/site");
    assert.equal(r.system?.id, sys.id);
  });

  it("tolerates trailing-slash / separator diff (归一化匹配)", async () => {
    const sys = await createSys({ name: "官网", project_root: "/Users/dev/site" });
    assert.equal((await resolveOf("/Users/dev/site/")).system?.id, sys.id);   // 尾斜杠
    assert.equal((await resolveOf("/Users/dev/site//")).system?.id, sys.id);  // 多重尾斜杠
  });

  it("ignores systems with an empty project_root (unbound rows never match)", async () => {
    await createSys({ name: "未绑定系统" }); // no project_root
    const r = await resolveOf("/Users/dev/whatever");
    assert.equal(r.system, null);
  });
});

describe("project summaries（工作台系统名称脱敏摘要）", () => {
  it("只返回已绑定系统的 id/name/project_root，不泄露环境配置或凭据", async () => {
    const bound = await createSys({
      name: "论坛管理系统",
      project_root: "/Users/dev/forum-xc-sit",
      environments: envOf({
        frontendBaseUrl: "https://secret.example.test",
        accounts: [{
          key: "admin",
          role: "admin",
          authMethod: "password",
          username: "private-user",
          password: "private-password",
        }],
      }),
    });
    await createSys({ name: "未绑定系统" });

    const res = await projectSummariesR.GET();
    assert.equal(res.status, 200);
    const body = await res.json() as { systems: Record<string, unknown>[] };
    assert.equal(body.systems.length, 1);
    assert.deepEqual(body.systems[0], {
      id: bound.id,
      name: "论坛管理系统",
      project_root: "/Users/dev/forum-xc-sit",
    });
    assert.equal(JSON.stringify(body).includes("private-password"), false);
    assert.equal("environments" in body.systems[0], false);
  });
});
