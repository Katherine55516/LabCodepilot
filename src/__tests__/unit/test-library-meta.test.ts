/**
 * 回归用例库 · 治理元数据 `_lib`(v2 二期):depositTask 的继承语义(reviewState / 隔离 /
 * rev 时间线不被重新入库抹掉)、语义指纹与 rev 递增、批量评审/隔离、buildRunnableCases 剥离。
 *
 * Run with: npx tsx --test src/__tests__/unit/test-library-meta.test.ts
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  REGRESSION_TAG,
  readLibrary,
  writeLibrary,
  readLibMeta,
  caseFingerprint,
  depositTask,
  setReviewState,
  setQuarantine,
  buildRunnableCases,
  type TestCase,
  type LibraryEntry,
} from "../../lib/test/library";
import { evalSuite, isQuarantined } from "../../lib/test/suites";

let proj: string;
beforeEach(() => { proj = fs.mkdtempSync(path.join(os.tmpdir(), "libmeta-")); });
afterEach(() => { fs.rmSync(proj, { recursive: true, force: true }); });

/** 一条回归集用例。 */
const C = (id: string, extra: Record<string, unknown> = {}): TestCase =>
  ({ id, purpose: `用例${id}`, steps: [{ content: "点击", expected: "跳转" }], tags: [REGRESSION_TAG], ...extra });

const metaOf = (task: string, originalId: string) => {
  const e = readLibrary(proj).entries.find((x) => x._source.task === task && x._source.originalId === originalId);
  assert.ok(e, `entry ${task}/${originalId} 应存在`);
  return readLibMeta(e!);
};

describe("caseFingerprint — 语义指纹", () => {
  it("忽略 id 与 tags(身份由 _source 承担;打标是入库决策不是内容变更)", () => {
    const a = caseFingerprint({ id: "TC-001", tags: [REGRESSION_TAG], purpose: "p", assertion: "a" });
    const b = caseFingerprint({ id: "TC-999", tags: [], purpose: "p", assertion: "a" });
    assert.equal(a, b);
  });

  it("忽略 _source / _lib(治理元数据不参与内容指纹)", () => {
    const a = caseFingerprint({ purpose: "p" });
    const b = caseFingerprint({ purpose: "p", _source: { task: "T", originalId: "TC-001", depositedAt: "t" }, _lib: { rev: 7 } } as TestCase);
    assert.equal(a, b);
  });

  it("字段顺序无关,内容变化则指纹变化", () => {
    assert.equal(caseFingerprint({ a: 1, b: 2 }), caseFingerprint({ b: 2, a: 1 }));
    assert.notEqual(caseFingerprint({ purpose: "p" }), caseFingerprint({ purpose: "p2" }));
  });
});

describe("readLibMeta — 宽松默认(存量零迁移)", () => {
  it("缺 _lib → approved / r1 / 未隔离(v2 §9 存量回填口径)", () => {
    const m = readLibMeta({ _source: { task: "T", originalId: "TC-001", depositedAt: "t" } } as LibraryEntry);
    assert.equal(m.reviewState, "approved");
    assert.equal(m.rev, 1);
    assert.equal(m.quarantined, false);
    assert.deepEqual(m.history, []);
    assert.equal(m.fingerprint, undefined);
  });

  it("兼容 v2 一期写在顶层的 quarantined 布尔", () => {
    const e = { quarantined: true, _source: { task: "T", originalId: "TC-001", depositedAt: "t" } } as unknown as LibraryEntry;
    assert.equal(readLibMeta(e).quarantined, true);
    assert.equal(isQuarantined(e), true);
  });

  it("坏字段类型 → 逐个回落安全默认;坏 history 条目被过滤", () => {
    const e = {
      _lib: { reviewState: "??", rev: -3, history: [{ rev: 1, at: "t", note: "ok" }, "bad", { rev: 2 }] },
      _source: { task: "T", originalId: "TC-001", depositedAt: "t" },
    } as unknown as LibraryEntry;
    const m = readLibMeta(e);
    assert.equal(m.reviewState, "approved");
    assert.equal(m.rev, 1);
    assert.deepEqual(m.history, [{ rev: 1, at: "t", note: "ok" }]);
  });
});

describe("writeLibrary — seq 写入序号(读侧缓存的变更令牌)", () => {
  it("每次落盘严格 +1;同毫秒内的连续写入也能区分", () => {
    depositTask(proj, "T", [C("TC-001")]);
    const s1 = readLibrary(proj).seq ?? 0;
    depositTask(proj, "T2", [C("TC-001")]);
    const s2 = readLibrary(proj).seq ?? 0;
    assert.equal(s2, s1 + 1);
  });

  it("缺 seq 的存量库文件 → 读为 0,首次写入变 1", () => {
    writeLibrary(proj, { version: 1, updatedAt: "", entries: [] });
    assert.equal(readLibrary(proj).seq, 1);
  });
});

describe("depositTask — 首次入库", () => {
  it("新用例 → pending + r1 + 一条「首次入库」history + 指纹落盘", () => {
    depositTask(proj, "登录鉴权", [C("TC-001")]);
    const m = metaOf("登录鉴权", "TC-001");
    assert.equal(m.reviewState, "pending");
    assert.equal(m.rev, 1);
    assert.equal(m.history.length, 1);
    assert.equal(m.history[0].rev, 1);
    assert.match(m.history[0].note, /首次入库/);
    assert.ok(m.fingerprint);
    assert.equal(m.quarantined, false);
  });
});

describe("depositTask — 治理元数据继承(设计默认 #1)", () => {
  it("内容不变的重新入库:rev 不动、history 不增、reviewState 保留", () => {
    depositTask(proj, "登录鉴权", [C("TC-001")]);
    setReviewState(proj, [{ task: "登录鉴权", originalId: "TC-001" }], "approved");
    depositTask(proj, "登录鉴权", [C("TC-001")]);

    const m = metaOf("登录鉴权", "TC-001");
    assert.equal(m.reviewState, "approved", "人工确认的评审态不能被重新入库抹掉");
    assert.equal(m.rev, 1);
    assert.equal(m.history.length, 1);
  });

  it("隔离状态跨重新入库保留(含时间与理由)", () => {
    depositTask(proj, "设备预约", [C("TC-005")]);
    setQuarantine(proj, [{ task: "设备预约", originalId: "TC-005" }], true, "三轮内两次翻转");
    depositTask(proj, "设备预约", [C("TC-005")]);

    const m = metaOf("设备预约", "TC-005");
    assert.equal(m.quarantined, true);
    assert.equal(m.quarantineReason, "三轮内两次翻转");
    assert.ok(m.quarantinedAt);
  });

  it("内容变化 → rev+1 且 history 追加(最新在前),评审态仍保留", () => {
    depositTask(proj, "登录鉴权", [C("TC-004")]);
    setReviewState(proj, [{ task: "登录鉴权", originalId: "TC-004" }], "approved");
    depositTask(proj, "登录鉴权", [C("TC-004", { steps: [{ content: "点击", expected: "跳转登录页" }] })]);

    const m = metaOf("登录鉴权", "TC-004");
    assert.equal(m.rev, 2);
    assert.equal(m.reviewState, "approved");
    assert.equal(m.history.length, 2);
    assert.equal(m.history[0].rev, 2, "最新变更在前");
    assert.equal(m.history[1].rev, 1);
  });

  it("只改 tags 顺序/新增无关标签 → 不算内容变更,rev 不动", () => {
    depositTask(proj, "报表导出", [C("TC-001")]);
    depositTask(proj, "报表导出", [C("TC-001", { tags: [REGRESSION_TAG, "冒烟"] })]);
    assert.equal(metaOf("报表导出", "TC-001").rev, 1);
  });

  it("存量条目(无 _lib)重新入库:回填指纹但【不】bump rev,评审态仍是 approved", () => {
    // 手工造一个 v1 时代的库条目(无 _lib)。
    writeLibrary(proj, {
      version: 1,
      updatedAt: "",
      entries: [{ ...C("TC-001"), _source: { task: "用户管理", originalId: "TC-001", depositedAt: "old" } } as LibraryEntry],
    });
    assert.equal(readLibMeta(readLibrary(proj).entries[0]).fingerprint, undefined);

    depositTask(proj, "用户管理", [C("TC-001")]);
    const m = metaOf("用户管理", "TC-001");
    assert.equal(m.rev, 1, "无指纹基线时不应把回填误判为一次变更");
    assert.equal(m.reviewState, "approved");
    assert.ok(m.fingerprint);
  });

  it("掉标签的用例被移出库,其治理元数据随之消失(upsert 语义不变)", () => {
    depositTask(proj, "登录鉴权", [C("TC-001"), C("TC-002")]);
    depositTask(proj, "登录鉴权", [C("TC-001")]);
    const lib = readLibrary(proj);
    assert.equal(lib.entries.length, 1);
    assert.equal(lib.entries[0]._source.originalId, "TC-001");
  });

  it("不同任务的同名 originalId 互不串继承", () => {
    depositTask(proj, "任务A", [C("TC-001")]);
    setReviewState(proj, [{ task: "任务A", originalId: "TC-001" }], "approved");
    depositTask(proj, "任务B", [C("TC-001")]);
    assert.equal(metaOf("任务A", "TC-001").reviewState, "approved");
    assert.equal(metaOf("任务B", "TC-001").reviewState, "pending");
  });
});

describe("setReviewState / setQuarantine — 批量写", () => {
  beforeEach(() => { depositTask(proj, "T", [C("TC-001"), C("TC-002"), C("TC-003")]); });

  it("批量确认只影响命中的 key", () => {
    const r = setReviewState(proj, [{ task: "T", originalId: "TC-001" }, { task: "T", originalId: "TC-003" }], "approved");
    assert.equal(r.updated, 2);
    assert.equal(r.total, 3);
    assert.equal(metaOf("T", "TC-001").reviewState, "approved");
    assert.equal(metaOf("T", "TC-002").reviewState, "pending");
    assert.equal(metaOf("T", "TC-003").reviewState, "approved");
  });

  it("重复写同一状态 → updated=0(幂等,不产生无谓落盘)", () => {
    setReviewState(proj, [{ task: "T", originalId: "TC-001" }], "approved");
    assert.equal(setReviewState(proj, [{ task: "T", originalId: "TC-001" }], "approved").updated, 0);
  });

  it("未命中的 key 静默忽略", () => {
    assert.equal(setReviewState(proj, [{ task: "T", originalId: "不存在" }], "approved").updated, 0);
  });

  it("隔离写入理由与时间;恢复时清空两者", () => {
    setQuarantine(proj, [{ task: "T", originalId: "TC-002" }], true, "疑似时区相关不稳定");
    let m = metaOf("T", "TC-002");
    assert.equal(m.quarantined, true);
    assert.equal(m.quarantineReason, "疑似时区相关不稳定");

    setQuarantine(proj, [{ task: "T", originalId: "TC-002" }], false);
    m = metaOf("T", "TC-002");
    assert.equal(m.quarantined, false);
    assert.equal(m.quarantineReason, undefined);
    assert.equal(m.quarantinedAt, undefined);
  });

  it("隔离缺省理由 → 「手动隔离」", () => {
    setQuarantine(proj, [{ task: "T", originalId: "TC-001" }], true, "   ");
    assert.equal(metaOf("T", "TC-001").quarantineReason, "手动隔离");
  });
});

describe("evalSuite — 隔离排除 / 评审条件 / approvedOnly", () => {
  beforeEach(() => {
    depositTask(proj, "T", [C("TC-001", { priority: "P0" }), C("TC-002", { priority: "P1" }), C("TC-003", { priority: "P0" })]);
    setReviewState(proj, [{ task: "T", originalId: "TC-001" }], "approved");
  });

  it("隔离条目从全量求值里消失", () => {
    setQuarantine(proj, [{ task: "T", originalId: "TC-002" }], true);
    const hit = evalSuite(readLibrary(proj), null);
    assert.deepEqual(hit.map((e) => e._source.originalId), ["TC-001", "TC-003"]);
  });

  it("查询条件 review 命中待确认", () => {
    const hit = evalSuite(readLibrary(proj), { name: "s", type: "query", filter: { review: ["pending"] } });
    assert.deepEqual(hit.map((e) => e._source.originalId), ["TC-002", "TC-003"]);
  });

  it("approvedOnly 在 pinned 并入之后生效(待确认的 pinned 也被排除)", () => {
    const hit = evalSuite(readLibrary(proj), { name: "s", type: "static", keys: [{ task: "T", originalId: "TC-001" }] }, {
      pinned: [{ task: "T", originalId: "TC-002" }],
      approvedOnly: true,
    });
    assert.deepEqual(hit.map((e) => e._source.originalId), ["TC-001"]);
  });

  it("approvedOnly 关闭时 pinned 照常并入", () => {
    const hit = evalSuite(readLibrary(proj), { name: "s", type: "static", keys: [{ task: "T", originalId: "TC-001" }] }, {
      pinned: [{ task: "T", originalId: "TC-002" }],
    });
    assert.deepEqual(hit.map((e) => e._source.originalId).sort(), ["TC-001", "TC-002"]);
  });
});

describe("buildRunnableCases — 治理元数据不泄漏进执行 prompt", () => {
  it("输出用例既无 _source 也无 _lib", () => {
    depositTask(proj, "T", [C("TC-001")]);
    setQuarantine(proj, [{ task: "T", originalId: "TC-001" }], true, "x");
    const { cases } = buildRunnableCases(readLibrary(proj));
    assert.equal(cases.length, 1);
    assert.equal("_source" in cases[0], false);
    assert.equal("_lib" in cases[0], false);
    assert.equal(cases[0].id, "TC-001");
  });
});
