/**
 * 回归用例库数据层:depositTask(upsert by 来源任务)、健壮读写、buildRunnableCases
 * (跨任务 id 命名空间 + idMap 反解)、removeEntries、listByTask。
 *
 * Run with: npx tsx --test src/__tests__/unit/test-library.test.ts
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  REGRESSION_TAG,
  REGRESSION_LIBRARY_TASK,
  readLibrary,
  writeLibrary,
  depositTask,
  removeEntries,
  listByTask,
  buildRunnableCases,
  filterRegressionCases,
  isRegressionCase,
  readTaskCases,
  libraryFile,
  type TestCase,
} from "../../lib/test/library";

let proj: string;
beforeEach(() => { proj = fs.mkdtempSync(path.join(os.tmpdir(), "reglib-")); });
afterEach(() => { fs.rmSync(proj, { recursive: true, force: true }); });

const C = (id: string, tags: string[] = [], extra: Record<string, unknown> = {}): TestCase =>
  ({ id, purpose: `用例${id}`, oracle: "PRD", verification: "功能验证", tags, ...extra });

describe("readLibrary — 健壮读", () => {
  it("文件缺失 → 空库", () => {
    const lib = readLibrary(proj);
    assert.deepEqual(lib.entries, []);
    assert.equal(lib.version, 1);
  });

  it("损坏 JSON → 空库(不抛)", () => {
    const f = libraryFile(proj);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, "{ 坏 json");
    assert.deepEqual(readLibrary(proj).entries, []);
  });

  it("entries 非数组 / 条目缺 _source.task → 跳过坏条", () => {
    const f = libraryFile(proj);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify({
      version: 1,
      entries: [
        { id: "TC-001", _source: { task: "A", originalId: "TC-001", depositedAt: "t" } }, // ok
        { id: "TC-002" },                       // 无 _source → 跳过
        { id: "TC-003", _source: { task: "" } },// task 空 → 跳过
        "not-an-object",                        // 非对象 → 跳过
      ],
    }));
    const lib = readLibrary(proj);
    assert.equal(lib.entries.length, 1);
    assert.equal(lib.entries[0]._source.task, "A");
  });
});

describe("tags helpers", () => {
  it("caseTags/isRegressionCase/filterRegressionCases", () => {
    const cases = [C("TC-001", [REGRESSION_TAG]), C("TC-002", ["冒烟测试"]), C("TC-003", [REGRESSION_TAG, "冒烟测试"])];
    assert.equal(isRegressionCase(cases[0]), true);
    assert.equal(isRegressionCase(cases[1]), false);
    const reg = filterRegressionCases(cases);
    assert.deepEqual(reg.map((c) => c.id), ["TC-001", "TC-003"]);
  });

  it("tags 非数组 / 含非字符串项 → 健壮", () => {
    assert.equal(isRegressionCase({ id: "x", tags: "回归测试" as unknown as string[] }), false);
    assert.equal(isRegressionCase({ id: "x", tags: [123, REGRESSION_TAG] as unknown as string[] }), true);
  });
});

describe("readTaskCases — 健壮解析", () => {
  it("{cases:[...]} / 顶层数组 / 坏内容", () => {
    const f1 = path.join(proj, "a.json");
    fs.writeFileSync(f1, JSON.stringify({ cases: [C("TC-001")] }));
    assert.equal(readTaskCases(f1).length, 1);
    const f2 = path.join(proj, "b.json");
    fs.writeFileSync(f2, JSON.stringify([C("TC-001"), C("TC-002")]));
    assert.equal(readTaskCases(f2).length, 2);
    assert.deepEqual(readTaskCases(path.join(proj, "missing.json")), []);
  });
});

describe("depositTask — upsert by 来源任务", () => {
  it("首次入库:只收「回归测试」标签用例,带 _source", () => {
    const cases = [C("TC-001", [REGRESSION_TAG]), C("TC-002", ["冒烟测试"]), C("TC-003", [REGRESSION_TAG])];
    const r = depositTask(proj, "任务甲", cases);
    assert.deepEqual(r, { added: 2, removed: 0, total: 2 });
    const lib = readLibrary(proj);
    assert.deepEqual(lib.entries.map((e) => e.id), ["TC-001", "TC-003"]);
    assert.equal(lib.entries[0]._source.task, "任务甲");
    assert.equal(lib.entries[0]._source.originalId, "TC-001");
    assert.ok(lib.entries[0]._source.depositedAt);
    assert.equal(lib.entries[0].oracle, "PRD"); // 原字段无损
    assert.ok(lib.updatedAt);
  });

  it("同任务重复入库:覆盖旧贡献、不重复", () => {
    depositTask(proj, "任务甲", [C("TC-001", [REGRESSION_TAG]), C("TC-002", [REGRESSION_TAG])]);
    // 第二次:TC-002 掉了回归标签、TC-001 保留、新增 TC-004
    const r = depositTask(proj, "任务甲", [C("TC-001", [REGRESSION_TAG]), C("TC-002", ["冒烟测试"]), C("TC-004", [REGRESSION_TAG])]);
    assert.equal(r.removed, 2); // 删旧的 2 条
    assert.equal(r.added, 2);   // 加新的 2 条(TC-001,TC-004)
    assert.equal(r.total, 2);
    const lib = readLibrary(proj);
    assert.deepEqual(lib.entries.map((e) => e.id).sort(), ["TC-001", "TC-004"]);
  });

  it("多任务并存:各任务贡献互不干扰", () => {
    depositTask(proj, "任务甲", [C("TC-001", [REGRESSION_TAG])]);
    depositTask(proj, "任务乙", [C("TC-001", [REGRESSION_TAG]), C("TC-002", [REGRESSION_TAG])]);
    const lib = readLibrary(proj);
    assert.equal(lib.entries.length, 3);
    // 再次入库任务甲不影响任务乙
    depositTask(proj, "任务甲", [C("TC-009", [REGRESSION_TAG])]);
    const grouped = listByTask(readLibrary(proj));
    assert.deepEqual(grouped.map((g) => g.task), ["任务乙", "任务甲"]); // 任务乙先出现(甲的旧条目已被删后重插到末尾)
    assert.deepEqual(grouped.find((g) => g.task === "任务甲")!.entries.map((e) => e.id), ["TC-009"]);
    assert.equal(grouped.find((g) => g.task === "任务乙")!.entries.length, 2);
  });

  it("回归集为空 → 清空该任务贡献", () => {
    depositTask(proj, "任务甲", [C("TC-001", [REGRESSION_TAG])]);
    const r = depositTask(proj, "任务甲", [C("TC-001", ["冒烟测试"])]);
    assert.deepEqual(r, { added: 0, removed: 1, total: 0 });
    assert.deepEqual(readLibrary(proj).entries, []);
  });

  it("从库导来的用例带旧 _source → 入库时按当前任务重打,不残留旧溯源", () => {
    const withStale: TestCase = { ...C("TC-001", [REGRESSION_TAG]), _source: { task: "旧任务", originalId: "OLD", depositedAt: "x" } } as TestCase;
    depositTask(proj, "新任务", [withStale]);
    const e = readLibrary(proj).entries[0];
    assert.equal(e._source.task, "新任务");
    assert.equal(e._source.originalId, "TC-001");
  });
});

describe("removeEntries", () => {
  beforeEach(() => {
    depositTask(proj, "任务甲", [C("TC-001", [REGRESSION_TAG]), C("TC-002", [REGRESSION_TAG])]);
    depositTask(proj, "任务乙", [C("TC-001", [REGRESSION_TAG])]);
  });
  it("移除单条(按 task+originalId)", () => {
    const r = removeEntries(proj, (e) => e._source.task === "任务甲" && e._source.originalId === "TC-001");
    assert.deepEqual(r, { removed: 1, total: 2 });
  });
  it("移除某任务全部贡献", () => {
    const r = removeEntries(proj, (e) => e._source.task === "任务甲");
    assert.deepEqual(r, { removed: 2, total: 1 });
    assert.equal(readLibrary(proj).entries[0]._source.task, "任务乙");
  });
  it("谓词不命中 → 不写、不变", () => {
    const r = removeEntries(proj, () => false);
    assert.deepEqual(r, { removed: 0, total: 3 });
  });
});

describe("buildRunnableCases — 跨任务 id 命名空间 + idMap", () => {
  it("无冲突保留原 id;冲突用 {task}::{id};idMap 可反解", () => {
    depositTask(proj, "任务甲", [C("TC-001", [REGRESSION_TAG]), C("TC-002", [REGRESSION_TAG])]);
    depositTask(proj, "任务乙", [C("TC-001", [REGRESSION_TAG])]); // 与甲的 TC-001 撞号
    const { cases, idMap } = buildRunnableCases(readLibrary(proj));
    const ids = cases.map((c) => c.id as string);
    // 唯一性
    assert.equal(new Set(ids).size, ids.length);
    // 甲的 TC-001 先到 → 保留;乙的 TC-001 撞号 → 命名空间
    assert.ok(ids.includes("TC-001"));
    assert.ok(ids.includes("任务乙::TC-001"));
    // idMap 反解
    assert.deepEqual(idMap["任务乙::TC-001"], { task: "任务乙", originalId: "TC-001" });
    assert.deepEqual(idMap["TC-002"], { task: "任务甲", originalId: "TC-002" });
    // 用例体去掉 _source
    assert.ok(!("_source" in cases[0]));
  });

  it("空库 → 空 cases/idMap", () => {
    const r = buildRunnableCases(readLibrary(proj));
    assert.deepEqual(r.cases, []);
    assert.deepEqual(r.idMap, {});
  });
});

describe("常量", () => {
  it("保留任务名可作为路径段(不含分隔符)", () => {
    assert.equal(REGRESSION_LIBRARY_TASK, "回归用例库");
    assert.ok(!REGRESSION_LIBRARY_TASK.includes("/") && !REGRESSION_LIBRARY_TASK.includes("\\"));
  });
  it("writeLibrary 原子写 + 刷新 updatedAt", () => {
    writeLibrary(proj, { version: 1, updatedAt: "", entries: [] });
    assert.ok(fs.existsSync(libraryFile(proj)));
    assert.ok(readLibrary(proj).updatedAt);
  });
});
