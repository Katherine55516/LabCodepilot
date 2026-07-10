/**
 * 回归套件数据层(v2 批 A):健壮读写、内置「全量」保护、查询求值(字段 AND/值 OR/空不限制/
 * 上次结果注入)、静态清单、pinned 并入去重、隔离排除、buildRunnableCases include 圈选。
 *
 * Run with: npx tsx --test src/__tests__/unit/test-suites.test.ts
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  REGRESSION_FULL_SUITE,
  suitesFile,
  readSuites,
  upsertSuite,
  removeSuite,
  setPinned,
  evalSuite,
  findSuite,
  mutateSuites,
  type RegressionSuite,
} from "../../lib/test/suites";
import { buildRunnableCases, type RegressionLibrary, type LibraryEntry } from "../../lib/test/library";

let proj: string;
beforeEach(() => { proj = fs.mkdtempSync(path.join(os.tmpdir(), "regsuites-")); });
afterEach(() => { fs.rmSync(proj, { recursive: true, force: true }); });

const E = (task: string, id: string, extra: Record<string, unknown> = {}): LibraryEntry => ({
  id,
  purpose: `用例${id}`,
  tags: ["回归测试"],
  ...extra,
  _source: { task, originalId: id, depositedAt: "2026-07-09T00:00:00.000Z" },
});

const LIB = (): RegressionLibrary => ({
  version: 1,
  updatedAt: "",
  entries: [
    E("登录鉴权", "TC-001", { priority: "P0", module: "登录" }),
    E("登录鉴权", "TC-002", { priority: "P2", module: "登录" }),
    E("设备预约", "TC-001", { priority: "P0", module: "预约" }),
    E("设备预约", "TC-002", { priority: "P1", module: "预约" }),
    E("设备预约", "TC-003", { priority: "P2", module: "预约", quarantined: true }), // 隔离(三期字段前置兼容)
    E("报表导出", "TC-001", { priority: "P1", module: "报表" }),
  ],
});

describe("readSuites — 健壮读", () => {
  it("缺文件 → 空结构", () => {
    const got = readSuites(proj);
    assert.deepEqual(got.suites, []);
    assert.deepEqual(got.pinned, []);
  });

  it("坏 JSON → 空(不抛)", () => {
    const f = suitesFile(proj);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, "非 json");
    assert.deepEqual(readSuites(proj).suites, []);
  });

  it("坏条目跳过:缺名/未知类型/占用内置名;filter 字段清洗", () => {
    const f = suitesFile(proj);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify({
      version: 1,
      pinned: [{ task: "登录鉴权", originalId: "TC-001" }, { task: "" }, "bad"],
      suites: [
        { name: "好静态", type: "static", keys: [{ task: "A", originalId: "1" }, { bad: true }] },
        { name: "好查询", type: "query", filter: { pri: ["P0", 42], last: ["pass", "exploded"] } },
        { name: "", type: "static", keys: [] },
        { name: REGRESSION_FULL_SUITE, type: "static", keys: [] }, // 占用内置名 → 忽略
        { name: "怪类型", type: "magic" },
      ],
    }));
    const got = readSuites(proj);
    assert.equal(got.pinned.length, 1);
    assert.equal(got.suites.length, 2);
    const st = got.suites.find((s) => s.name === "好静态");
    assert.equal(st!.type === "static" && st!.keys.length, 1);
    const q = got.suites.find((s) => s.name === "好查询");
    assert.ok(q!.type === "query");
    assert.deepEqual(q!.type === "query" && q!.filter.pri, ["P0"]);
    assert.deepEqual(q!.type === "query" && q!.filter.last, ["pass"]);
  });
});

describe("upsertSuite / removeSuite / setPinned", () => {
  it("新建 + 同名覆盖;读写往返", () => {
    upsertSuite(proj, { name: "发版精选", type: "static", keys: [{ task: "A", originalId: "1" }] });
    upsertSuite(proj, { name: "P0", type: "query", filter: { pri: ["P0"] } });
    upsertSuite(proj, { name: "发版精选", type: "static", keys: [] }); // 覆盖
    const got = readSuites(proj);
    assert.equal(got.suites.length, 2);
    const st = got.suites.find((s) => s.name === "发版精选");
    assert.equal(st!.type === "static" && st!.keys.length, 0);
  });

  it("内置「全量」不可占用/不可删", () => {
    assert.throws(() => upsertSuite(proj, { name: REGRESSION_FULL_SUITE, type: "static", keys: [] }));
    assert.throws(() => removeSuite(proj, REGRESSION_FULL_SUITE));
  });

  it("removeSuite 删除;不存在 no-op", () => {
    upsertSuite(proj, { name: "临时", type: "query", filter: {} });
    removeSuite(proj, "临时");
    removeSuite(proj, "不存在");
    assert.equal(readSuites(proj).suites.length, 0);
  });

  it("setPinned 覆盖白名单并清洗坏键", () => {
    setPinned(proj, [{ task: "A", originalId: "1" }, { task: "", originalId: "x" } as never]);
    assert.equal(readSuites(proj).pinned.length, 1);
  });

  it("mutateSuites 并发写保护:重放后两笔都保留", () => {
    upsertSuite(proj, { name: "S1", type: "query", filter: {} });
    mutateSuites(
      proj,
      (data) => { data.suites = [...data.suites.filter((s) => s.name !== "S2"), { name: "S2", type: "query", filter: {} } as RegressionSuite]; },
      () => { upsertSuite(proj, { name: "S3", type: "query", filter: {} }); },
    );
    const names = readSuites(proj).suites.map((s) => s.name).sort();
    assert.deepEqual(names, ["S1", "S2", "S3"]);
  });
});

describe("evalSuite — 求值", () => {
  it("null(内置全量)= 全部,但隔离条目排除", () => {
    const hit = evalSuite(LIB(), null);
    assert.equal(hit.length, 5); // 6 - 1 隔离
    assert.ok(!hit.some((e) => e._source.originalId === "TC-003" && e._source.task === "设备预约"));
  });

  it("静态套件按 keys 命中(隔离的 key 也不出)", () => {
    const hit = evalSuite(LIB(), {
      name: "s", type: "static",
      keys: [
        { task: "登录鉴权", originalId: "TC-002" },
        { task: "设备预约", originalId: "TC-003" }, // 隔离 → 不出
      ],
    });
    assert.equal(hit.length, 1);
    assert.equal(hit[0]._source.task, "登录鉴权");
  });

  it("查询:字段间 AND、字段内 OR、空字段不限制", () => {
    const lib = LIB();
    // P0 ∧ 预约模块 → 只有 设备预约 TC-001
    let hit = evalSuite(lib, { name: "q", type: "query", filter: { pri: ["P0"], module: ["预约"] } });
    assert.deepEqual(hit.map((e) => `${e._source.task}·${e._source.originalId}`), ["设备预约·TC-001"]);
    // P0 ∨ P1(字段内 OR),无其他限制 → 4 条(隔离除外)
    hit = evalSuite(lib, { name: "q", type: "query", filter: { pri: ["P0", "P1"] } });
    assert.equal(hit.length, 4);
    // 空 filter → 全量语义
    hit = evalSuite(lib, { name: "q", type: "query", filter: {} });
    assert.equal(hit.length, 5);
    // 按来源任务
    hit = evalSuite(lib, { name: "q", type: "query", filter: { task: ["报表导出"] } });
    assert.equal(hit.length, 1);
  });

  it("上次结果条件:注入 lookup;未注入时只有 none 语义", () => {
    const lib = LIB();
    const lastOf = (k: { task: string; originalId: string }) =>
      k.task === "登录鉴权" && k.originalId === "TC-001" ? ("fail" as const) : ("pass" as const);
    let hit = evalSuite(lib, { name: "q", type: "query", filter: { last: ["fail"] } }, { lastResultOf: lastOf });
    assert.deepEqual(hit.map((e) => e._source.originalId), ["TC-001"]);
    // 未注入 lookup → 一律 none:filter last=['fail'] 不命中任何
    hit = evalSuite(lib, { name: "q", type: "query", filter: { last: ["fail"] } });
    assert.equal(hit.length, 0);
    hit = evalSuite(lib, { name: "q", type: "query", filter: { last: ["none"] } });
    assert.equal(hit.length, 5);
  });

  it("pinned 始终并入(去重;隔离的 pinned 不复活)", () => {
    const lib = LIB();
    const pinned = [
      { task: "登录鉴权", originalId: "TC-001" },  // 未命中条件 → 并入
      { task: "报表导出", originalId: "TC-001" },  // 将命中条件 → 不重复
      { task: "设备预约", originalId: "TC-003" },  // 隔离 → 不并入
    ];
    const hit = evalSuite(lib, { name: "q", type: "query", filter: { task: ["报表导出"] } }, { pinned });
    assert.deepEqual(
      hit.map((e) => `${e._source.task}·${e._source.originalId}`).sort(),
      ["报表导出·TC-001", "登录鉴权·TC-001"],
    );
  });
});

describe("findSuite", () => {
  it("内置名 → null;未知 → undefined;命中 → 套件", () => {
    upsertSuite(proj, { name: "S", type: "query", filter: {} });
    const data = readSuites(proj);
    assert.equal(findSuite(data, REGRESSION_FULL_SUITE), null);
    assert.equal(findSuite(data, "不存在"), undefined);
    assert.equal(findSuite(data, "S")!.name, "S");
  });
});

describe("buildRunnableCases include 圈选(library.ts v2 扩展)", () => {
  it("只聚合命中条目;idMap 反解正确;缺省 = 全库", () => {
    const lib = LIB();
    const all = buildRunnableCases(lib);
    assert.equal(all.cases.length, 6); // buildRunnableCases 本身不管隔离(由 evalSuite 圈选层排除)
    const picked = buildRunnableCases(lib, [
      { task: "登录鉴权", originalId: "TC-001" },
      { task: "设备预约", originalId: "TC-001" },
    ]);
    assert.equal(picked.cases.length, 2);
    // 跨任务同 ID 冲突 → 命名空间;idMap 反解
    const ids = picked.cases.map((c) => String(c.id));
    assert.ok(ids.includes("TC-001"));
    assert.ok(ids.includes("设备预约::TC-001"));
    assert.deepEqual(picked.idMap["设备预约::TC-001"], { task: "设备预约", originalId: "TC-001" });
  });
});
