import fs from 'fs';
import path from 'path';
import { artifactPaths } from '@/lib/test/prompts';
import { appendAudit } from '@/lib/test/audit';
import { readLibrary, buildRunnableCases, libraryRunMapFile, REGRESSION_LIBRARY_TASK } from '@/lib/test/library';

export const runtime = 'nodejs';

/**
 * 回归用例库 · 跨任务一键重跑【聚合准备】。
 *
 * 只做「聚合库 → 写保留任务 `回归用例库` 的 cases.json」这一步(零执行逻辑);随后前端用
 * 【现有】`/api/test/run`(taskName=保留名、step=execution→report)驱动执行与报告——最大复用
 * 执行机器(env 解析 / Playwright / 可达性闸门 / wrapExecutionStream 归约 / suiteIds 口径)。
 *
 * buildRunnableCases 已把跨任务 id 冲突命名空间化(避免 @@RESULT 串号);聚合用例保留原
 * `tags`(含「回归测试」),故执行归约时 suiteIds = 全部,报告天然按回归集口径 + 红线规则呈现。
 *
 * POST { projectPath } → { ok, total }。total=0 表示库为空、无可重跑用例(前端提示)。
 */
export async function POST(req: Request): Promise<Response> {
  try {
    const body = await req.json().catch(() => ({}));
    const projectPath: string | undefined = body.projectPath;
    if (!projectPath || typeof projectPath !== 'string') {
      return Response.json({ ok: false, error: 'projectPath is required' }, { status: 400 });
    }
    const lib = readLibrary(projectPath);
    if (!lib.entries.length) {
      return Response.json({ ok: true, total: 0 });
    }
    const { cases, idMap } = buildRunnableCases(lib);
    // 写保留任务的 cases.json(execution 步会 Read 它);沿用 artifactPaths 口径,落
    // AI_LabTest/testCase/.data/回归用例库.cases.json。.tmp + rename 原子写。
    const casesAbs = path.join(projectPath, artifactPaths(REGRESSION_LIBRARY_TASK).cases);
    fs.mkdirSync(path.dirname(casesAbs), { recursive: true });
    const tmp = casesAbs + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ cases }, null, 2), 'utf-8');
    fs.renameSync(tmp, casesAbs);
    // Persist the same snapshot used to build cases. Script generation happens
    // after the report and must not remap against a library that changed mid-run.
    const mapAbs = libraryRunMapFile(projectPath);
    const mapTmp = mapAbs + '.tmp';
    fs.writeFileSync(mapTmp, JSON.stringify({ version: 1, createdAt: new Date().toISOString(), idMap }, null, 2), 'utf-8');
    fs.renameSync(mapTmp, mapAbs);

    void appendAudit(projectPath, REGRESSION_LIBRARY_TASK, {
      action: 'run-library',
      mode: 'manual',
      step: 'execution',
      detail: `跨任务一键重跑:聚合 ${cases.length} 条回归用例,来源 ${new Set(lib.entries.map((e) => e._source.task)).size} 个任务`,
    });
    return Response.json({ ok: true, total: cases.length });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Internal server error';
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
