import fs from 'fs';
import path from 'path';
import { artifactPaths } from '@/lib/test/prompts';
import { appendAudit } from '@/lib/test/audit';
import { readLibrary, buildRunnableCases, REGRESSION_LIBRARY_TASK } from '@/lib/test/library';
import { readSuites, findSuite, evalSuite, REGRESSION_FULL_SUITE } from '@/lib/test/suites';
import {
  readRounds,
  generateRoundId,
  appendRound,
  roundDirRel,
  buildLastResultLookup,
  type RoundSnapshot,
} from '@/lib/test/rounds';
import { isUnsafeSegment } from '@/lib/test/path-safety';

export const runtime = 'nodejs';

/**
 * 回归用例库 · 发起回归轮次【聚合准备】(v2)。
 *
 * 只做「圈选 → 聚合 → 建轮次 + 快照」(零执行逻辑);随后前端用【现有】`/api/test/run`
 * (taskName=保留名、roundId=本路由返回值、step=execution→report)驱动执行与报告——最大
 * 复用执行机器(env 解析 / Playwright / 可达性闸门 / wrapExecutionStream 归约 / suiteIds 口径)。
 *
 * 相比 v1 的三个增量(执行计划批 B):
 *   1. **套件圈选**:`suiteName` 参数(缺省=内置「全量」,等价 v1 行为)——readSuites →
 *      evalSuite(查询求值/静态清单,pinned 必跑并入,隔离排除) → buildRunnableCases(include);
 *   2. **轮次实体**:生成 roundId、appendRound(running) 进 回归轮次.json;执行/报告产物由
 *      run 路由按 roundId 落 report/回归用例库/{roundId}/,同环境多轮互不覆盖;
 *   3. **当轮快照**:聚合结果(含 idMap)原样留存为 {roundId}/cases.snapshot.json——历史报告
 *      永远能回答「当时测的是什么」;idMap 随快照持久化,供报告分组/上次结果反查/复测。
 *
 * POST { projectPath, suiteName?, env? } → { ok, total, roundId? }。
 * total=0(库空/套件未命中)不建轮次;未知套件名 → 400。
 */
export async function POST(req: Request): Promise<Response> {
  try {
    const body = await req.json().catch(() => ({}));
    const projectPath: string | undefined = body.projectPath;
    if (!projectPath || typeof projectPath !== 'string') {
      return Response.json({ ok: false, error: 'projectPath is required' }, { status: 400 });
    }
    const suiteName: string =
      typeof body.suiteName === 'string' && body.suiteName.trim() ? body.suiteName.trim() : REGRESSION_FULL_SUITE;
    const env: string = typeof body.env === 'string' && body.env.trim() ? body.env.trim() : 'local';
    // env 会进产物文件名({task}-{env}.run.json)、roundId 进产物目录 → 段安全校验。
    if (isUnsafeSegment(env)) {
      return Response.json({ ok: false, error: 'invalid env' }, { status: 400 });
    }

    const lib = readLibrary(projectPath);
    if (!lib.entries.length) {
      return Response.json({ ok: true, total: 0 });
    }

    const suitesData = readSuites(projectPath);
    const suite = findSuite(suitesData, suiteName); // 内置「全量」→ null;未知 → undefined
    if (suite === undefined) {
      return Response.json({ ok: false, error: `未知套件「${suiteName}」` }, { status: 400 });
    }
    const hits = evalSuite(lib, suite, {
      pinned: suitesData.pinned,
      lastResultOf: buildLastResultLookup(projectPath),
    });
    if (!hits.length) {
      return Response.json({ ok: true, total: 0 });
    }

    const include = hits.map((e) => ({ task: e._source.task, originalId: e._source.originalId }));
    const { cases, idMap } = buildRunnableCases(lib, include);

    // 写保留任务的聚合 cases.json(execution 步会 Read 它);沿用 artifactPaths 口径,落
    // AI_LabTest/testCase/.data/回归用例库.cases.json。.tmp + rename 原子写。
    const casesAbs = path.join(projectPath, artifactPaths(REGRESSION_LIBRARY_TASK).cases);
    fs.mkdirSync(path.dirname(casesAbs), { recursive: true });
    const tmp = casesAbs + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ cases }, null, 2), 'utf-8');
    fs.renameSync(tmp, casesAbs);

    // 建轮次 + 当轮快照(快照写失败不阻塞发起——轮次照常,可信度降级但主流程可用)。
    const existing = new Set(readRounds(projectPath).rounds.map((r) => r.roundId));
    const roundId = generateRoundId(existing);
    const startedAt = new Date().toISOString();
    try {
      const roundDirAbs = path.join(projectPath, roundDirRel(roundId));
      fs.mkdirSync(roundDirAbs, { recursive: true });
      const snapshot: RoundSnapshot = {
        version: 1,
        roundId,
        suiteName,
        env,
        mode: 'full',
        generatedAt: startedAt,
        total: cases.length,
        idMap,
        cases,
      };
      const snapAbs = path.join(roundDirAbs, 'cases.snapshot.json');
      fs.writeFileSync(snapAbs + '.tmp', JSON.stringify(snapshot, null, 2), 'utf-8');
      fs.renameSync(snapAbs + '.tmp', snapAbs);
    } catch (e) {
      console.warn('[regression-rounds] 当轮快照写入失败(轮次继续):', e);
    }
    appendRound(projectPath, {
      roundId,
      startedAt,
      env,
      suiteName,
      mode: 'full',
      status: 'running',
      total: cases.length,
    });

    void appendAudit(projectPath, REGRESSION_LIBRARY_TASK, {
      action: 'run-library',
      mode: 'manual',
      step: 'execution',
      detail: `发起回归轮次 ${roundId}:套件「${suiteName}」命中 ${cases.length} 条(来源 ${new Set(hits.map((e) => e._source.task)).size} 个任务),环境 ${env}`,
    });
    return Response.json({ ok: true, total: cases.length, roundId });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Internal server error';
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
