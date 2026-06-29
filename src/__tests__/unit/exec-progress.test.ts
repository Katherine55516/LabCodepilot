/**
 * Unit tests for parseExecProgress — 「测试执行」进度行 → {第几个/总数/标题}。
 * 驱动测试执行节点的「N/总数 用例标题」实时进度展示。
 *
 * Run with: npx tsx --test src/__tests__/unit/exec-progress.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseExecProgress } from "../../lib/test/exec-progress";

describe("parseExecProgress", () => {
  it("标准进度行「用例 N/总数：标题」(全角冒号) → idx/total/title 全解析", () => {
    const r = parseExecProgress("用例 3/25：无查询条件时点导出下载全量数据", 25);
    assert.deepEqual(r, { idx: 3, total: 25, title: "无查询条件时点导出下载全量数据" });
  });

  it("半角冒号 + 无「用例」前缀也兼容", () => {
    assert.deepEqual(parseExecProgress("2/10: 登录成功跳转首页", 10), { idx: 2, total: 10, title: "登录成功跳转首页" });
  });

  it("第 1 个", () => {
    assert.deepEqual(parseExecProgress("用例 1/25：登录", 25), { idx: 1, total: 25, title: "登录" });
  });

  it("进度行带的总数优先于 casesTotal", () => {
    const r = parseExecProgress("用例 4/8：xxx", 25);
    assert.equal(r.idx, 4);
    assert.equal(r.total, 8, "进度行的「/8」应优先于 cases 数 25");
  });

  it("首条进度行到达前(currentCase 为空) → idx 0、总数回落 cases 数、标题空", () => {
    assert.deepEqual(parseExecProgress("", 25), { idx: 0, total: 25, title: "" });
  });

  it("有 N/总数 但无标题 → 标题为空", () => {
    assert.deepEqual(parseExecProgress("用例 5/25", 25), { idx: 5, total: 25, title: "" });
  });

  it("完全没有 cases 数且 currentCase 为空 → 全 0/空", () => {
    assert.deepEqual(parseExecProgress("", 0), { idx: 0, total: 0, title: "" });
  });

  it("非进度行文本(无 N/总数) → idx 0、总数回落 cases 数、整行当标题", () => {
    const r = parseExecProgress("正在准备测试数据", 25);
    assert.equal(r.idx, 0);
    assert.equal(r.total, 25);
    assert.equal(r.title, "正在准备测试数据");
  });
});
