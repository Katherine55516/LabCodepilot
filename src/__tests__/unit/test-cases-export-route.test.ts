/**
 * Integration tests for the 用例导出 Excel route (src/app/api/test/cases/export/route.ts).
 *
 * Run with: npx tsx --test src/__tests__/unit/test-cases-export-route.test.ts
 *
 * Round-trips the export: GET → xlsx buffer → parse back with exceljs → assert the
 * documented columns, steps-derived 操作/预期 columns, template + missing-file fallback.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { GET } from "../../app/api/test/cases/export/route";

let proj: string;
beforeEach(() => { proj = fs.mkdtempSync(path.join(os.tmpdir(), "cases-export-")); });
afterEach(() => { fs.rmSync(proj, { recursive: true, force: true }); });

const plantCases = (taskName: string, cases: unknown[]) => {
  const f = path.join(proj, "AI_LabTest", "testCase", ".data", `${taskName}.cases.json`);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify({ cases }));
};
async function parseXlsx(res: Response): Promise<string[][]> {
  const buf = Buffer.from(await res.arrayBuffer());
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  const rows: string[][] = [];
  ws.eachRow((row) => {
    const vals: string[] = [];
    row.eachCell({ includeEmpty: true }, (c) => vals.push(String(c.value ?? "")));
    rows.push(vals);
  });
  return rows;
}
const url = (p: Record<string, string>) => "http://x/api/test/cases/export?" + new URLSearchParams(p).toString();

describe("GET /api/test/cases/export", () => {
  it("returns an xlsx with the right content-type + filename", async () => {
    plantCases("订单", [{ id: "TC-1", purpose: "登录" }]);
    const res = await GET(new Request(url({ projectPath: proj, taskName: "订单" })));
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type")!, /spreadsheetml\.sheet/);
    assert.match(res.headers.get("content-disposition")!, /\.xlsx/);
  });
  it("exports cases as rows under the documented headers + steps-derived columns", async () => {
    plantCases("订单", [
      {
        id: "TC-1", priority: "P0", purpose: "正常登录", oracle: "PRD", verification: "功能验证",
        tags: ["冒烟测试", "回归测试"],
        steps: [{ content: "输入账号", expected: "显示" }, { content: "点登录", expected: "跳首页" }],
      },
    ]);
    const rows = await parseXlsx(await GET(new Request(url({ projectPath: proj, taskName: "订单" }))));
    assert.equal(rows[0][0], "ID"); // header row
    assert.equal(rows[0][3], "用例标签"); // tags column (caseType 之后)
    assert.equal(rows[1][0], "TC-1");
    assert.equal(rows[1][1], "P0");
    assert.equal(rows[1][3], "冒烟测试、回归测试"); // tags joined with 、
    assert.match(rows[1][8], /1\. 输入账号/); // 测试操作 derived from steps[].content
    assert.match(rows[1][9], /2\. 跳首页/); // 预期结果 derived from steps[].expected
    assert.equal(rows[1][12], "功能验证"); // 验证性质 column
  });
  it("template=1 returns a blank template with an example row", async () => {
    const rows = await parseXlsx(await GET(new Request(url({ template: "1" }))));
    assert.equal(rows[0][0], "ID");
    assert.equal(rows[1][0], "TC-01"); // built-in EXAMPLE
  });
  it("falls back to an example row when cases.json is missing", async () => {
    const rows = await parseXlsx(await GET(new Request(url({ projectPath: proj, taskName: "无此任务" }))));
    assert.equal(rows[1][0], "TC-01"); // EXAMPLE fallback, not an error
  });
});
