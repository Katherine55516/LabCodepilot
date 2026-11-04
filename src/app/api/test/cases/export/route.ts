import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';
import { artifactPaths } from '@/lib/test/prompts';

export const runtime = 'nodejs';

/**
 * 测试工作台 · 用例导出 Excel(镜像 ai-lab-test-framework 的 xlsx-cases.js 列定义)。
 *  - GET ?projectPath&taskName        → 该任务用例导出为 .xlsx
 *  - GET ?template=1                   → 下载空模板(表头 + 1 行示例),供测试人员填写后导入
 * steps:[{content,expected}] 派生成「测试操作」「预期结果」两列(逐步 1:1)。
 */

const COLUMNS: { key: string; header: string; width: number }[] = [
  { key: 'id', header: 'ID', width: 16 },
  { key: 'priority', header: '优先级', width: 8 },
  { key: 'caseType', header: '用例类型', width: 12 },
  { key: 'tags', header: '用例标签', width: 14 },
  { key: 'module', header: '模块', width: 12 },
  { key: 'requirement', header: '需求引用', width: 20 },
  { key: 'purpose', header: '用例标题', width: 28 },
  { key: 'precondition', header: '前置条件', width: 24 },
  { key: 'steps', header: '测试操作', width: 42 },
  { key: 'expected', header: '预期结果', width: 42 },
  { key: 'assertion', header: '断言级别', width: 10 },
  { key: 'oracle', header: 'oracle来源', width: 14 },
  { key: 'verification', header: '验证性质', width: 10 },
  { key: 'cleanup', header: '清理', width: 22 },
];

const cell = (v: unknown): string => (v == null ? '' : String(v));

function caseRow(c: Record<string, unknown>): Record<string, string> {
  const steps = Array.isArray(c.steps) ? (c.steps as { content?: string; expected?: string }[]) : [];
  const stepsText = steps.length ? steps.map((s, i) => `${i + 1}. ${s.content || ''}`).join('\n') : cell(c.steps);
  const expectedText = steps.length ? steps.map((s, i) => `${i + 1}. ${s.expected || ''}`).join('\n') : cell(c.expected);
  return {
    id: cell(c.id), priority: cell(c.priority), caseType: cell(c.caseType),
    tags: Array.isArray(c.tags) ? (c.tags as unknown[]).map(cell).join('、') : cell(c.tags),
    module: cell(c.module),
    requirement: cell(c.requirement), purpose: cell(c.purpose), precondition: cell(c.precondition),
    steps: stepsText, expected: expectedText, assertion: cell(c.assertion),
    oracle: cell(c.oracle), verification: cell(c.verification), cleanup: cell(c.cleanup),
  };
}

const EXAMPLE: Record<string, unknown> = {
  id: 'TC-01', priority: 'P0', caseType: '功能', module: '登录', requirement: 'REQ-001',
  purpose: '正常登录', precondition: '已注册账号',
  steps: [{ content: '输入账号密码', expected: '输入框正确显示' }, { content: '点击登录', expected: '跳转到首页' }],
  oracle: 'PRD', verification: '功能验证', tags: ['回归测试'],
};

export async function GET(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const projectPath = url.searchParams.get('projectPath');
    const taskName = url.searchParams.get('taskName') || 'cases';
    const template = url.searchParams.get('template') === '1';

    let cases: Record<string, unknown>[] = [EXAMPLE];
    if (!template && projectPath) {
      try {
        const raw = await fs.promises.readFile(path.join(projectPath, artifactPaths(taskName).cases), 'utf-8');
        const parsed = JSON.parse(raw);
        const arr = Array.isArray(parsed?.cases) ? parsed.cases : Array.isArray(parsed) ? parsed : [];
        if (arr.length) cases = arr as Record<string, unknown>[];
      } catch { /* 用例文件不存在 → 退化为导出含示例的模板 */ }
    }

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('测试用例');
    ws.columns = COLUMNS.map((c) => ({ key: c.key, header: c.header, width: c.width }));
    ws.getRow(1).font = { bold: true };
    for (const c of cases) ws.addRow(caseRow(c));
    ws.eachRow((row) => row.eachCell((cl) => { cl.alignment = { vertical: 'top', wrapText: true }; }));

    const buf = await wb.xlsx.writeBuffer();
    const fname = encodeURIComponent(`${template ? '测试用例模板' : `${taskName}-测试用例`}.xlsx`);
    return new Response(buf as ArrayBuffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename*=UTF-8''${fname}`,
      },
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'export failed' }, { status: 500 });
  }
}
