import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';
import { artifactPaths, requirementOriginalPath, requirementImportedTextPath } from '@/lib/test/prompts';
import { isUnsafeSegment } from '@/lib/test/path-safety';

export const runtime = 'nodejs';

/**
 * Save imported material for a test task into the project's AI_LabTest artifacts:
 *  - kind=requirement → PRESERVES the raw upload at {task}-需求-原始.{ext} (byte-for-byte,
 *    never overwritten by AI). For .docx, also extracts plain text to
 *    requirements/.data/{task}-导入原文.txt (the Agent SDK Read tool can't parse binary
 *    docx). .md/.txt/.markdown keep the original file as the readable source. It does NOT
 *    write {task}-需求.md — that path is now reserved for the AI's 需求分析 product, produced
 *    only when the user picks 生成需求分析文档 at the requirement node. Accepts .md/.txt/
 *    .markdown/.docx. Returns { originalPath, ext, sourceTextPath?, path } where `path` is
 *    the readable source (extracted text for docx, else the original file).
 *  - kind=cases       → {task}.cases.json (执行/报告 read it). Accepts .json (validated),
 *    .xlsx (exceljs) and .xls (sheetjs), best-effort column mapping.
 *
 * Body: { projectPath, taskName, kind, filename, dataBase64 } — dataBase64 is the raw
 * file; we parse by filename extension. (Legacy `content` text is still accepted.)
 * Used by 新建任务 when the user imports 需求 / 用例 (see InlineTestingPanel.addTask).
 */

// mammoth（docx→文本）走「函数内动态 import」，与下方 xlsToRows 的 sheetjs 同一纪律：
// ① 把重解析库隔离在 docx 这一条路径上，导 .md/.txt 需求、导用例都不会加载它；
// ② 避免顶部硬 import 让整个 import 路由在 standalone（NFT 可能漏收 mammoth 依赖链）
// 模块加载阶段就失败、把所有导入一起拖挂——这正是 Windows 打包后「docx 导入失败」的
// 根因。配合 next.config 的 serverExternalPackages + outputFileTracingIncludes 强制收录。
async function docxToText(buf: Buffer): Promise<string> {
  const mammoth = (await import('mammoth')).default;
  return (await mammoth.extractRawText({ buffer: buf })).value;
}

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
  const seenIds = new Set<string>();
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
    // De-dup ids (L1): a duplicate id in the Excel would break the run.json↔cases id
    // join (oracle 双轴 verification map) downstream — suffix collisions with #N.
    let id = (idC >= 0 ? r[idC] : '') || `TC-${String(cases.length + 1).padStart(2, '0')}`;
    if (seenIds.has(id)) {
      let n = 2;
      while (seenIds.has(`${id}#${n}`)) n++;
      id = `${id}#${n}`;
    }
    seenIds.add(id);
    const c: Record<string, unknown> = {
      id,
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

// .xls（老二进制 BIFF）exceljs 读不了 → 用 sheetjs 读成行矩阵，复用 rowsToCases 映射。
// sheetjs 走「函数内动态 import」而非顶部静态 import：① 把 sheetjs 隔离在 .xls 这一条
// 路径上，导需求(mammoth)/导 .xlsx(exceljs)/导 .json 都不会加载它；② 避免顶部硬 import
// 让整个 import 路由在 standalone（NFT 可能漏收 xlsx）模块加载阶段就失败、把所有导入一起
// 拖挂——这正是 Windows 打包后「新建任务导需求/用例都卡在导入中」的根因。
async function xlsToRows(buf: Buffer): Promise<string[][]> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(buf, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error('Excel 没有可读工作表');
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '', raw: false });
  return rows.map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? '').trim()) : []));
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
    if (isUnsafeSegment(taskName)) {
      return Response.json({ error: 'invalid taskName' }, { status: 400 });
    }

    if (kind === 'requirement') {
      // 「保留原始文档」：原样保存用户上传件（字节级，按原扩展名），永不被 AI 需求分析覆盖。
      // .doc（旧版二进制 Word）不是 OOXML，无法抽文本 → 拒绝。
      if (ext === 'doc') return Response.json({ error: '.doc（旧版二进制 Word）暂不支持，请另存为 .docx 再导入' }, { status: 400 });
      // 先算可读文本（docx 用 mammoth 抽，其余原样）→ 空内容直接 400，不落任何文件（含原始件）。
      // docx 是二进制 ZIP，Agent SDK 的 Read 工具读不了它 → 抽一份纯文本供 AI 读，原始 .docx 仍保留。
      const text = ext === 'docx' ? await docxToText(buf) : buf.toString('utf-8');
      if (!text.trim()) return Response.json({ error: '导入内容为空，未写入产物' }, { status: 400 });

      const originalRel = requirementOriginalPath(taskName, ext);
      const originalAbs = path.join(projectPath, originalRel);
      fs.mkdirSync(path.dirname(originalAbs), { recursive: true });
      fs.writeFileSync(originalAbs, buf); // 原始字节，不做任何转换

      // .md/.txt 本身即可 Read（来源就是原文件）；仅 docx 需要额外落一份抽取文本供 AI 读。
      let sourceTextRel: string | undefined;
      if (ext === 'docx') {
        sourceTextRel = requirementImportedTextPath(taskName);
        const sourceTextAbs = path.join(projectPath, sourceTextRel);
        fs.mkdirSync(path.dirname(sourceTextAbs), { recursive: true });
        fs.writeFileSync(sourceTextAbs, text, 'utf-8');
      }
      // Preview shown in the 测试对话 right after import, so the stage isn't empty.
      const preview = text.length > 1500 ? text.slice(0, 1500) + '\n\n…（已截断，完整内容见产物文件）' : text;
      // path = 供预览/用例读取的可读来源：docx→抽取文本，md/txt→原文件本身。
      return Response.json({ ok: true, kind: 'requirement', path: sourceTextRel || originalRel, originalPath: originalRel, ext, sourceTextPath: sourceTextRel, preview });
    }

    // cases: .json 原样校验；.xlsx 走 exceljs；.xls（老二进制 BIFF）走 sheetjs。
    let out: string;
    if (ext === 'xlsx') {
      out = await xlsxToCasesJson(buf);
    } else if (ext === 'xls') {
      const rows = await xlsToRows(buf);
      if (rows.length < 2) throw new Error('Excel 至少需要表头行 + 一行用例');
      out = JSON.stringify(rowsToCases(rows), null, 2);
    } else {
      out = buf.toString('utf-8');
      try { JSON.parse(out); } catch { return Response.json({ error: '用例文件需为合法 JSON / .xlsx / .xls' }, { status: 400 }); }
    }
    // 空内容（空文件/前端 FileReader 偶发空结果）→ 不静默写空产物，明确报错。
    if (!out.trim()) {
      return Response.json({ error: '导入内容为空，未写入产物' }, { status: 400 });
    }
    const rel = artifactPaths(taskName).cases;
    const abs = path.join(projectPath, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, out, 'utf-8');
    let preview = '';
    try { preview = `已解析 ${(JSON.parse(out).cases || []).length} 条用例`; } catch { preview = '用例已导入'; }
    return Response.json({ ok: true, path: rel, preview });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'import failed' }, { status: 500 });
  }
}
