import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';
import { isUnsafeSegment } from '@/lib/test/path-safety';

export const runtime = 'nodejs';

/**
 * 报告目录里的可选 XLSX 执行矩阵预览/下载。
 *
 * GET ?projectPath&taskName&file=...xlsx
 *   - 默认：用 exceljs 解析为 { sheets: [{ name, rows: string[][] }] }，供产物预览的只读表格。
 *   - ?download=1：直接回传原 .xlsx（attachment），用于「导出」。
 *
 * 安全：taskName 经 isUnsafeSegment 校验（它组成目录名，不能穿越）；file 只取 basename，
 * 白名单到项目的 AI_LabTest/report/{taskName}/ 内的 .xlsx，杜绝 ../ 穿越。
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const projectPath = url.searchParams.get('projectPath');
  const taskName = url.searchParams.get('taskName');
  const file = url.searchParams.get('file');
  const download = url.searchParams.get('download') === '1';
  if (!projectPath || !taskName || !file) {
    return new Response('projectPath, taskName, file are required', { status: 400 });
  }
  if (isUnsafeSegment(taskName)) {
    return new Response('invalid taskName', { status: 400 });
  }
  const reportDir = path.resolve(projectPath, 'AI_LabTest', 'report', taskName);
  const target = path.join(reportDir, path.basename(file));
  if (target !== reportDir && !target.startsWith(reportDir + path.sep)) {
    return new Response('forbidden', { status: 403 });
  }
  if (!target.toLowerCase().endsWith('.xlsx')) {
    return new Response('not an xlsx', { status: 400 });
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(target);
  } catch {
    return new Response('not found', { status: 404 });
  }
  if (!stat.isFile()) return new Response('not found', { status: 404 });

  if (download) {
    const buf = fs.readFileSync(target);
    return new Response(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(path.basename(target))}"`,
        'Content-Length': String(stat.size),
      },
    });
  }

  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(target);
    const sheets = wb.worksheets.map((ws) => {
      const rows: string[][] = [];
      ws.eachRow({ includeEmpty: false }, (row) => {
        // exceljs row.values is 1-based (index 0 unused) → drop it; map every cell to display text.
        const vals = Array.isArray(row.values) ? row.values.slice(1) : [];
        rows.push(vals.map((v) => cellText(v)));
      });
      return { name: ws.name, rows };
    });
    return Response.json({ sheets });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'parse failed' }, { status: 500 });
  }
}

/** exceljs cell value → plain display text (handles rich text / hyperlink / formula result). */
function cellText(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.text === 'string') return o.text; // rich text / hyperlink label
    if ('result' in o && o.result != null) return String(o.result); // formula
    if (o.hyperlink != null) return String(o.hyperlink);
    if (Array.isArray((o as { richText?: unknown }).richText)) {
      return ((o as { richText: { text?: string }[] }).richText).map((t) => t.text ?? '').join('');
    }
  }
  return String(v);
}
