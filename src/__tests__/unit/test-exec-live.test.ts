/**
 * 执行步 SSE 文本流的**实时**逐行解析(exec-live.ts,前端画进度/四态/用例分段的数据源)。
 *
 * 回归背景:前端原来在 InlineTestingPanel 里就地用「indexOf + slice + JSON.parse」解析
 * @@RESULT,模型把标记行加粗就全解析失败 —— 与 2026-07-10 服务端那次事故同源。
 * 现在与服务端共用 markers.ts,本文件用当时的真实输出钉死。
 *
 * Run with: npx tsx --test src/__tests__/unit/test-exec-live.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyExecLine, createExecLineBuffer, progressCounts, shouldAdoptPlaceholder, type ExecLine } from "../../lib/test/exec-live";

/** 2026-07-10 线上执行步的真实 assistant 文本(节选,原样保留加粗与诱饵行)。 */
const REAL = [
  '**@@CASE_START {"id":"TC-employee-001","index":1}**',
  "▶ 用例 1/3：进入员工信息页默认加载全量列表（不填条件直接查询）",
  '**@@RESULT {"id":"TC-employee-001","status":"pass","actual":"页面渲染完成","evidence":["TC-employee-001.png"],"error":""}**',
  '**@@CASE_START {"id":"TC-employee-002","index":2}**',
  "▶ 用例 2/3：新增一名在职员工",
  '**@@RESULT {"id":"TC-employee-002","status":"fail","actual":"列表未刷新","evidence":["TC-employee-002.png","TC-employee-002.webm"],"error":"POST 返回 code:-1","api":{"method":"POST","url":"/api/v1/employee","status":200}}**',
  "| 已输出 @@RESULT 行数 | 2 |",
  "**覆盖自检**：2 行 @@RESULT 均已输出。",
];

const kinds = (ls: ExecLine[]) => ls.map((l) => l.kind);

describe("classifyExecLine — 线上真实输出", () => {
  it("加粗的 @@RESULT 被正确解析(旧实现在此全丢)", () => {
    const e = classifyExecLine(REAL[2]);
    assert.equal(e.kind, "result");
    if (e.kind !== "result") return;
    assert.equal(e.result.id, "TC-employee-001");
    assert.equal(e.result.status, "pass");
    assert.deepEqual(e.result.evidence, ["TC-employee-001.png"]);
  });

  it("加粗的 @@CASE_START 也能取到 id 与 index(用于用例分段)", () => {
    const e = classifyExecLine(REAL[0]);
    assert.equal(e.kind, "caseStart");
    if (e.kind !== "caseStart") return;
    assert.equal(e.id, "TC-employee-001");
    assert.equal(e.index, 1);
  });

  it("进度行剥掉 ▶ 前缀;title 进一步剥掉「用例 N/总数：」只剩标题", () => {
    const e = classifyExecLine(REAL[1]);
    assert.equal(e.kind, "progress");
    if (e.kind !== "progress") return;
    assert.match(e.text, /^用例 1\/3/);
    assert.equal(e.idx, 1);
    assert.equal(e.total, 3);
    assert.equal(e.title, "进入员工信息页默认加载全量列表（不填条件直接查询）");
  });

  it("markdown 分隔线不进 AI 气泡(模型爱在段落间打 --- )", () => {
    for (const l of ["---", "***", "___", "  ----  "]) {
      const e = classifyExecLine(l);
      assert.equal(e.kind, "text");
      if (e.kind === "text") assert.equal(e.text, "", l);
    }
    // 但正常的破折号正文不该被吞
    const ok = classifyExecLine("-- 这是正文");
    assert.equal(ok.kind, "text");
    if (ok.kind === "text") assert.equal(ok.text, "-- 这是正文");
  });

  it("嵌套 api 对象不打乱大括号配对", () => {
    const e = classifyExecLine(REAL[5]);
    assert.equal(e.kind, "result");
    if (e.kind !== "result") return;
    assert.equal(e.result.status, "fail");
    assert.equal(e.result.error, "POST 返回 code:-1");
  });

  it("正文里提到标记名但不带 JSON → 普通文本,不误采也不报 malformed", () => {
    assert.equal(classifyExecLine(REAL[6]).kind, "text");
    assert.equal(classifyExecLine(REAL[7]).kind, "text");
  });
});

describe("classifyExecLine — 各种装饰与坏输入", () => {
  const R = (l: string) => classifyExecLine(l);

  it("裸写 / 行内代码 / 列表符 / 尾随文字都能解析", () => {
    for (const l of [
      '@@RESULT {"id":"A","status":"pass"}',
      '`@@RESULT {"id":"A","status":"pass"}`',
      '- @@RESULT {"id":"A","status":"pass"}',
      '@@RESULT {"id":"A","status":"pass"} ✅ 完成',
    ]) assert.equal(R(l).kind, "result", l);
  });

  it("状态别名归一(passed/failed/skipped)", () => {
    const g = (s: string) => { const e = R(`@@RESULT {"id":"A","status":"${s}"}`); return e.kind === "result" ? e.result.status : null; };
    assert.equal(g("passed"), "pass");
    assert.equal(g("FAILED"), "fail");
    assert.equal(g("skipped"), "blocked");
  });

  it("未知状态 → 不算判定(宁可当文本,也不虚构四态)", () => {
    assert.equal(R('@@RESULT {"id":"A","status":"玄学"}').kind, "text");
  });

  it("缺 id → 不算判定", () => {
    assert.equal(R('@@RESULT {"status":"pass"}').kind, "text");
  });

  it("含标记 + 含 { 但 JSON 非法 → resultMalformed(显式暴露,不静默吞掉)", () => {
    assert.equal(R("@@RESULT {id: A}").kind, "resultMalformed");
  });

  it("加粗的进度行也认", () => {
    assert.equal(R("**▶ 用例 2/5：登录**").kind, "progress");
  });
});

describe("createExecLineBuffer — SSE 把一行切成多帧", () => {
  it("跨 chunk 的判定行被正确拼回", () => {
    const b = createExecLineBuffer();
    assert.deepEqual(kinds(b.feed('**@@RESULT {"id":"A",')), []);
    assert.deepEqual(kinds(b.feed('"status":"pass"}**')), []);   // 还没换行
    const out = b.feed("\n");
    assert.deepEqual(kinds(out), ["result"]);
  });

  it("一个 chunk 里多行 → 逐行分类,尾部残行留在缓冲", () => {
    const b = createExecLineBuffer();
    const out = b.feed('▶ 用例 1/2：登录\n@@RESULT {"id":"A","status":"pass"}\n未完的一行');
    assert.deepEqual(kinds(out), ["progress", "result"]);
    assert.deepEqual(kinds(b.flush()), ["text"]);
  });

  it("空行被丢弃,不产生空气泡", () => {
    const b = createExecLineBuffer();
    assert.deepEqual(kinds(b.feed("\n\n  \n")), []);
  });

  it("flush 在缓冲为空时返回空", () => {
    const b = createExecLineBuffer();
    b.feed("abc\n");
    assert.deepEqual(b.flush(), []);
  });

  it("整段真实输出:2 条判定 + 2 条 caseStart + 2 条进度 + 2 条正文", () => {
    const b = createExecLineBuffer();
    const out = [...b.feed(REAL.join("\n") + "\n"), ...b.flush()];
    const c = out.reduce<Record<string, number>>((m, e) => ((m[e.kind] = (m[e.kind] ?? 0) + 1), m), {});
    assert.deepEqual(c, { caseStart: 2, progress: 2, result: 2, text: 2 });
  });
});

describe("progressCounts", () => {
  it("取出第几条 / 共几条", () => assert.deepEqual(progressCounts("用例 2/3：标题"), { idx: 2, total: 3 }));
  it("全角冒号与空格容错", () => assert.deepEqual(progressCounts("用例 10 / 25 ：x"), { idx: 10, total: 25 }));
  it("取不到 → 0/0", () => assert.deepEqual(progressCounts("准备中"), { idx: 0, total: 0 }));
});

// 幻影配对回归守卫(2026-07-13 真机截图):模型先发「▶ 用例 N/总数」再发 @@CASE_START,
// 进度行兜底先开了 `#N` 占位;@@CASE_START 此时必须【认领】占位而不是另开 —— 否则每条
// 真用例配一条无判定幻影,「已开始」虚高一倍,对账横幅误响(实际全部有判定)。
describe("shouldAdoptPlaceholder", () => {
  it("进度行先行的 #N 占位(无判定,同序号)→ 认领", () => {
    assert.equal(shouldAdoptPlaceholder({ id: "#1", index: 1 }, 1), true);
  });
  it("@@CASE_START 未带 index → 也认领(占位是 #N 即同一条)", () => {
    assert.equal(shouldAdoptPlaceholder({ id: "#2", index: 2 }, undefined), true);
  });
  it("序号冲突(#1 占位遇到 index=2)→ 不认领,是真的下一条", () => {
    assert.equal(shouldAdoptPlaceholder({ id: "#1", index: 1 }, 2), false);
  });
  it("占位已有判定 → 不认领(那条已完结)", () => {
    assert.equal(shouldAdoptPlaceholder({ id: "#1", index: 1, result: { status: "pass" } }, 1), false);
  });
  it("当前用例已是真实 id(正常 @@CASE_START 先行的顺序)→ 不认领,照旧另开", () => {
    assert.equal(shouldAdoptPlaceholder({ id: "TC-employee-001", index: 1 }, 2), false);
  });
  it("没有当前用例 → 不认领", () => {
    assert.equal(shouldAdoptPlaceholder(undefined, 1), false);
  });
});
