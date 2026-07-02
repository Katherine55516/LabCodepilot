/**
 * Integration tests for the 导入 route (src/app/api/test/import/route.ts).
 *
 * Run with: npx tsx --test src/__tests__/unit/test-import-route.test.ts
 *
 * Covers requirement (md/empty) + cases (json/invalid) import + validation 400s.
 * The .docx/.xlsx binary-parsing paths are exercised by the live app (mammoth/
 * exceljs); here we lock the text paths + the guards.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import * as XLSX from "xlsx";
import { POST } from "../../app/api/test/import/route";

let proj: string;
beforeEach(() => { proj = fs.mkdtempSync(path.join(os.tmpdir(), "import-route-")); });
afterEach(() => { fs.rmSync(proj, { recursive: true, force: true }); });

const post = (body: unknown) =>
  POST(new Request("http://x/api/test/import", { method: "POST", body: JSON.stringify(body) }));
const b64 = (s: string) => Buffer.from(s, "utf-8").toString("base64");
const reqFile = (taskName: string) => path.join(proj, "AI_LabTest", "requirements", `${taskName}-需求.md`);
const casesFile = (taskName: string) => path.join(proj, "AI_LabTest", "testCase", ".data", `${taskName}.cases.json`);

describe("POST /api/test/import — requirement", () => {
  it("imports a markdown requirement file", async () => {
    const res = await post({ projectPath: proj, taskName: "订单", kind: "requirement", filename: "req.md", dataBase64: b64("# 需求\n登录功能") });
    const j = await res.json();
    assert.equal(j.ok, true);
    assert.match(fs.readFileSync(reqFile("订单"), "utf-8"), /登录功能/);
  });
  it("rejects an EMPTY requirement instead of silently writing a blank file (M3)", async () => {
    const res = await post({ projectPath: proj, taskName: "订单", kind: "requirement", filename: "req.md" }); // no dataBase64
    assert.equal(res.status, 400);
    assert.ok(!fs.existsSync(reqFile("订单")), "no blank artifact should be written");
  });
  it("rejects legacy .doc binary", async () => {
    const res = await post({ projectPath: proj, taskName: "订单", kind: "requirement", filename: "old.doc", dataBase64: b64("x") });
    assert.equal(res.status, 400);
  });
});

describe("POST /api/test/import — cases", () => {
  it("imports a JSON cases file", async () => {
    const res = await post({ projectPath: proj, taskName: "订单", kind: "cases", filename: "c.json", dataBase64: b64(JSON.stringify({ cases: [{ id: "TC-1" }] })) });
    const j = await res.json();
    assert.equal(j.ok, true);
    assert.deepEqual(JSON.parse(fs.readFileSync(casesFile("订单"), "utf-8")), { cases: [{ id: "TC-1" }] });
    assert.match(j.preview, /1 条用例/);
  });
  it("rejects a non-JSON, non-xlsx cases payload", async () => {
    const res = await post({ projectPath: proj, taskName: "订单", kind: "cases", filename: "c.txt", dataBase64: b64("not json at all") });
    assert.equal(res.status, 400);
  });
  it("maps a legacy .xls (sheetjs) to cases.json", async () => {
    const b = makeXlsB64(["ID", "标题", "测试步骤", "预期结果"], [["TC-1", "登录", "输入账号", "跳首页"]]);
    const res = await post({ projectPath: proj, taskName: "订单", kind: "cases", filename: "old.xls", dataBase64: b });
    assert.equal((await res.json()).ok, true);
    const cases = JSON.parse(fs.readFileSync(casesFile("订单"), "utf-8")).cases;
    assert.equal(cases[0].id, "TC-1");
    assert.equal(cases[0].purpose, "登录");
    assert.equal(cases[0].steps[0].content, "输入账号");
  });
});

describe("POST /api/test/import — validation", () => {
  it("400 on unknown kind", async () => {
    const res = await post({ projectPath: proj, taskName: "订单", kind: "bogus", filename: "x.md", dataBase64: b64("x") });
    assert.equal(res.status, 400);
  });
  it("400 on missing projectPath/taskName", async () => {
    const res = await post({ kind: "requirement", filename: "x.md", dataBase64: b64("x") });
    assert.equal(res.status, 400);
  });
});

// 老二进制 .xls（BIFF8）由 sheetjs 写，对应 import route 的 sheetjs 读路径。
function makeXlsB64(headers: string[], rows: string[][]): string {
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "用例");
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xls" })).toString("base64");
}

async function makeXlsxB64(headers: string[], rows: string[][]): Promise<string> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("用例");
  ws.addRow(headers);
  for (const r of rows) ws.addRow(r);
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf).toString("base64");
}

describe("POST /api/test/import — xlsx parsing", () => {
  it("maps an xlsx (header + rows) to cases.json", async () => {
    const b = await makeXlsxB64(["ID", "标题", "测试步骤", "预期结果"], [["TC-1", "登录", "输入账号", "跳首页"]]);
    const res = await post({ projectPath: proj, taskName: "订单", kind: "cases", filename: "c.xlsx", dataBase64: b });
    assert.equal((await res.json()).ok, true);
    const cases = JSON.parse(fs.readFileSync(casesFile("订单"), "utf-8")).cases;
    assert.equal(cases[0].id, "TC-1");
    assert.equal(cases[0].purpose, "登录");
    assert.equal(cases[0].steps[0].content, "输入账号");
    assert.equal(cases[0].steps[0].expected, "跳首页");
  });
  it("de-dups duplicate ids from the xlsx (L1)", async () => {
    const b = await makeXlsxB64(["ID", "标题"], [["TC-1", "用例A"], ["TC-1", "用例B"]]);
    const res = await post({ projectPath: proj, taskName: "订单", kind: "cases", filename: "c.xlsx", dataBase64: b });
    assert.equal((await res.json()).ok, true);
    const ids = JSON.parse(fs.readFileSync(casesFile("订单"), "utf-8")).cases.map((c: { id: string }) => c.id);
    assert.equal(new Set(ids).size, ids.length, "ids unique after de-dup");
    assert.deepEqual(ids, ["TC-1", "TC-1#2"]);
  });
});
