import fs from 'fs';
import path from 'path';
import mammoth from 'mammoth';
import ExcelJS from 'exceljs';
import { artifactPaths } from '@/lib/test/prompts';

export const runtime = 'nodejs';

/**
 * Save imported material for a test task into the project's AI_LabTest artifacts so
 * the flow consumes it directly (no AI generation for that step):
 *  - kind=requirement → {task}-需求.md   (用例 step reads it). Accepts .md/.txt/.markdown
 *    (raw) and .docx (Word → Markdown via mammoth).
 *  - kind=cases       → {task}.cases.json (执行/报告 read it). Accepts .json (validated)
 *    and .xlsx (Excel → cases.json via exceljs, best-effort column mapping).
 *
 * Body: { projectPath, taskName, kind, filename, dataBase64 } — dataBase64 is the raw
 * file; we parse by filename extension. (Legacy `content` text is still accepted.)
 * Used by 新建任务 when the user imports 需求 / 用例 (see InlineTestingPanel.addTask).
 */

function extOf(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name || '');
  return m ? m[1].toLowerCase() : '';
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.richText)) return (o.richText as Array<{ text?: string }>).map((r) => r.text || '').join('');
    if (typeof o.text === 'string') return o.text;
    if ('result' in o) return cellText(o.result);
    if ('hyperlink' in o && typeof o.hyperlink === 'string') return o.hyperlink;
    return '';
  }
  return String(v).trim();
}

/** Pick the column index whose header matches any of the keywords. */
function findCol(headers: string[], re: RegExp): number {
  return headers.findIndex((h) => re.test(h));
}

/** Excel rows → cases.json shape (best-effort; mirrors the framework cases schema). */
function rowsToCases(rows: string[][]): { cases: unknown[] } {
  const headers = (rows[0] || []).map((h) => (h || '').trim());
  const idC = findCol(headers, /(^|[^a-z])id|编号|用例号/i);
  const purposeC = findCol(headers, /标题|用例名|用例标题|名称|目的|描述|摘要|purpose|title|case\s*name/i);
  const priorityC = findCol(headers, /优先级|priority|级别/i);
  const typeC = findCol(headers, /类型|用例类型|type|category/i);
  const preC = findCol(headers, /前置|预置|precondition/i);
  const stepC = findCol(headers, /步骤|操作|测试步骤|step|action/i);
  const expectC = findCol(headers, /预期|期望|期待|预期结果|expected|result/i);

  const splitLines = (s: string): string[] => s.split(/\r?\n|；|;/).map((x) => x.trim()).filter(Boolean);
  const cases: unknown[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] || [];
    if (r.every((c) => !c || !c.trim())) continue; // skip blank rows
    const purpose = (purposeC >= 0 ? r[purposeC] : '') || r.find((c) => c && c.trim()) || '';
    const stepText = stepC >= 0 ? r[stepC] || '' : '';
    const expectText = expectC >= 0 ? r[expectC] || '' : '';
    const stepLines = splitLines(stepText);
    const expectLines = splitLines(expectText);
    const steps =
      stepLines.length > 0
        ? stepLines.map((content, idx) => ({ content, expected: expectLines[idx] || expectLines[0] || '' }))
        : [{ content: purpose, expected: expectText }];
    const c: Record<string, unknown> = {
      id: (idC >= 0 ? r[idC] : '') || `TC-${String(cases.length + 1).padStart(2, '0')}`,
      purpose,
      steps,
    };
    if (priorityC >= 0 && r[priorityC]) c.priority = r[priorityC];
    if (typeC >= 0 && r[typeC]) c.caseType = r[typeC];
    if (preC >= 0 && r[preC]) c.precondition = r[preC];
    cases.push(c);
  }
  return { cases };
}

async function xlsxToCasesJson(buf: Buffer): Promise<string> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.worksheets.find((w) => w.rowCount > 0) || wb.worksheets[0];
  if (!ws) throw new Error('Excel 没有可读工作表');
  const rows: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const vals: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell) => vals.push(cellText(cell.value)));
    rows.push(vals);
  });
  if (rows.length < 2) throw new Error('Excel 至少需要表头行 + 一行用例');
  return JSON.stringify(rowsToCases(rows), null, 2);
}

export async function POST(req: Request): Promise<Response> {
  try {
    const body = await req.json().catch(() => ({}));
    const projectPath: string | undefined = body.projectPath;
    const taskName: string = typeof body.taskName === 'string' ? body.taskName : '';
    const kind: string = body.kind;
    const filename: string = typeof body.filename === 'string' ? body.filename : '';
    const ext = extOf(filename);
    const buf: Buffer =
      typeof body.dataBase64 === 'string'
        ? Buffer.from(body.dataBase64, 'base64')
        : typeof body.content === 'string'
          ? Buffer.from(body.content, 'utf-8')
          : Buffer.alloc(0);

    if (!projectPath || !taskName || (kind !== 'requirement' && kind !== 'cases')) {
      return Response.json({ error: 'projectPath, taskName, kind(requirement|cases) required' }, { status: 400 });
    }

    let out: string;
    if (kind === 'requirement') {
      // .docx → Markdown; .doc (legacy binary) is not OOXML and can't be parsed here.
      if (ext === 'doc') return Response.json({ error: '.doc（旧版二进制 Word）暂不支持，请另存为 .docx 再导入' }, { status: 400 });
      out = ext === 'docx' ? (await mammoth.extractRawText({ buffer: buf })).value : buf.toString('utf-8');
    } else {
      // cases: .json validated as-is; .xlsx mapped to cases.json; .xls (legacy) unsupported.
      if (ext === 'xls') return Response.json({ error: '.xls（旧版二进制 Excel）暂不支持，请另存为 .xlsx 再导入' }, { status: 400 });
      if (ext === 'xlsx') {
        out = await xlsxToCasesJson(buf);
      } else {
        out = buf.toString('utf-8');
        try { JSON.parse(out); } catch { return Response.json({ error: '用例文件需为合法 JSON 或 .xlsx' }, { status: 400 }); }
      }
    }

    const paths = artifactPaths(taskName);
    const rel = kind === 'requirement' ? paths.requirement : paths.cases;
    const abs = path.join(projectPath, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, out, 'utf-8');
    // Preview shown in the 测试对话 right after import, so the stage isn't empty.
    let preview = '';
    if (kind === 'requirement') {
      preview = out.length > 1500 ? out.slice(0, 1500) + '\n\n…（已截断，完整内容见产物文件）' : out;
    } else {
      try { preview = `已解析 ${(JSON.parse(out).cases || []).length} 条用例`; } catch { preview = '用例已导入'; }
    }
    return Response.json({ ok: true, path: rel, preview });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'import failed' }, { status: 500 });
  }
}
