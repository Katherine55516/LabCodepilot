import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';
import { artifactPaths } from '@/lib/test/prompts';
import { isUnsafeSegment } from '@/lib/test/path-safety';

export const runtime = 'nodejs';

/**
 * 测试报告 XLSX 执行矩阵（一行一用例）——**确定性地从 run.json + cases.json 派生**，
 * 不依赖磁盘上是否存在 .xlsx（报告步默认只写 .md，Excel 是按需视图）。
 *
 * GET ?projectPath&taskName&env
 *   - 默认：返回 { sheets: [{ name, rows: string[][] }] } 供产物预览的只读表格。
 *   - ?download=1：用 exceljs 即时生成 .xlsx 并回传（attachment），用于「导出」。
 *
 * 列：序号 / 用例ID / 标题 / 用例标签 / 期望结果 / 实际结果 / 状态 / 证据。
 * 标题、标签、期望结果来自 cases.json（按 id join）；实际结果/状态/证据来自 run.json。
 * 安全：taskName/env 经 isUnsafeSegment 校验（它们组成路径，不能穿越）。
 */
const HEADER = ['序号', '用例ID', '标题', '用例标签', '期望结果', '实际结果', '状态', '证据'];
// 下载 xlsx 的列宽（字符数，与 HEADER 对齐）：长文本列（期望结果/实际结果）加宽；标签列窄。
const COL_WIDTHS = [6, 12, 26, 14, 48, 48, 10, 22];

type RunTest = { id?: string; status?: string; actual?: string; error?: string; evidence?: string[] };
type CaseDef = { id?: string; purpose?: string; steps?: { expected?: string }[]; tags?: string[] };

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const projectPath = url.searchParams.get('projectPath');
  const taskName = url.searchParams.get('taskName');
  const env = url.searchParams.get('env') || 'local';
  const download = url.searchParams.get('download') === '1';
  if (!projectPath || !taskName) {
    return new Response('projectPath, taskName are required', { status: 400 });
  }
  if (isUnsafeSegment(taskName) || isUnsafeSegment(env)) {
    return new Response('invalid taskName or env', { status: 400 });
  }

  const p = artifactPaths(taskName, env);
  let run: { tests?: RunTest[] };
  try {
    run = JSON.parse(fs.readFileSync(path.join(projectPath, p.runJson), 'utf-8'));
  } catch {
    return Response.json({ error: 'run.json missing' }, { status: 404 });
  }
  const tests: RunTest[] = Array.isArray(run.tests) ? run.tests : [];

  // cases.json（可选）→ id → {标题, 标签, 期望}。文件不存在/解析失败时这几列留空。
  const caseById = new Map<string, CaseDef>();
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(projectPath, p.cases), 'utf-8')) as unknown;
    const list = Array.isArray((raw as { cases?: unknown })?.cases)
      ? (raw as { cases: CaseDef[] }).cases
      : Array.isArray(raw)
        ? (raw as CaseDef[])
        : [];
    for (const c of list) if (c && typeof c.id === 'string') caseById.set(c.id, c);
  } catch { /* no cases.json → 标题/标签/期望 empty */ }

  const rows: string[][] = [HEADER];
  tests.forEach((t, i) => {
    const c = t.id ? caseById.get(t.id) : undefined;
    const expected = c?.steps?.map((s) => s.expected).filter(Boolean).join('；') ?? '';
    rows.push([
      String(i + 1),
      String(t.id ?? ''),
      c?.purpose ?? '',
      Array.isArray(c?.tags) ? c.tags.join('、') : '',
      expected,
      t.actual ?? '',
      String(t.status ?? ''),
      Array.isArray(t.evidence) ? t.evidence.join(', ') : '',
    ]);
  });

  if (!download) {
    return Response.json({ sheets: [{ name: '执行矩阵', rows }] });
  }

  // 即时生成 .xlsx 并下载。
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('执行矩阵');
  ws.addRows(rows);
  ws.getRow(1).font = { bold: true };
  ws.columns.forEach((col, i) => { col.width = COL_WIDTHS[i] ?? 18; });
  // 期望结果(第5列)/实际结果(第6列)在导出的 xlsx 里自动换行，避免撑成超长单行。
  [5, 6].forEach((n) => { ws.getColumn(n).alignment = { wrapText: true, vertical: 'top' }; });
  const buf = await wb.xlsx.writeBuffer();
  return new Response(new Uint8Array(buf as ArrayBuffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(`${taskName}-${env}-执行矩阵.xlsx`)}"`,
    },
  });
}