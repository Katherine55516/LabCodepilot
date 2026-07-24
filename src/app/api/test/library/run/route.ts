import fs from 'fs';
import path from 'path';
import { artifactPaths } from '@/lib/test/prompts';
import { appendAudit } from '@/lib/test/audit';
import { readLibrary, buildRunnableCases, libraryRunMapFile, REGRESSION_LIBRARY_TASK } from '@/lib/test/library';
import {
  readRounds,
  generateRoundId,
  appendRound,
  roundDirRel,
  type RoundSnapshot,
} from '@/lib/test/rounds';
import { resolveRunScope, RunScopeError } from '@/lib/test/run-scope';
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
 * 二期增量:
 *   4. **复测轮**(`mode='failed-only'`):基准轮的失败集(非 pass 的任何终态)合成一个静态套件,
 *      再走同一条 evalSuite 通道——隔离排除 / pinned 必跑并入 / approvedOnly 三条口径自动与
 *      全量轮一致,不另开一套过滤逻辑。轮次记 parentRoundId,红线按合并口径评估(见 rounds GET)。
 *   5. **仅执行已确认用例**(`approvedOnly`):evalSuite 在 pinned 并入【之后】过滤,评审是硬闸门。
 *
 * POST { projectPath, suiteName?, env?, mode?, approvedOnly?, parentRoundId? } → { ok, total, roundId? }。
 * total=0(库空/套件未命中/基准轮无失败)不建轮次;未知套件名或基准轮缺失 → 400。
 */
export async function POST(req: Request): Promise<Response> {
  try {
    const body = await req.json().catch(() => ({}));
    const projectPath: string | undefined = body.projectPath;
    if (!projectPath || typeof projectPath !== 'string') {
      return Response.json({ ok: false, error: 'projectPath is required' }, { status: 400 });
    }
    const env: string = typeof body.env === 'string' && body.env.trim() ? body.env.trim() : 'local';
    // env 会进产物文件名({task}-{env}.run.json)、roundId 进产物目录 → 段安全校验。
    if (isUnsafeSegment(env)) {
      return Response.json({ ok: false, error: 'invalid env' }, { status: 400 });
    }
    const mode = body.mode === 'failed-only' ? 'failed-only' : 'full';
    const approvedOnly = body.approvedOnly === true;
    const parentRoundIdArg = typeof body.parentRoundId === 'string' && body.parentRoundId.trim()
      ? body.parentRoundId.trim()
      : undefined;
    if (parentRoundIdArg && isUnsafeSegment(parentRoundIdArg)) {
      return Response.json({ ok: false, error: 'invalid parentRoundId' }, { status: 400 });
    }

    const lib = readLibrary(projectPath);
    if (!lib.entries.length) {
      return Response.json({ ok: true, total: 0 });
    }

    // 范围解析下沉 lib(run-scope.ts):发起弹窗的预检卡走同一个函数,预览即所见即所跑。
    let runScope;
    try {
      runScope = resolveRunScope(projectPath, {
        suiteName: typeof body.suiteName === 'string' ? body.suiteName : undefined,
        mode,
        approvedOnly,
        parentRoundId: parentRoundIdArg,
      });
    } catch (e) {
      if (e instanceof RunScopeError) return Response.json({ ok: false, error: e.message }, { status: 400 });
      throw e;
    }
    const { hits, suiteName, parentRoundId } = runScope;
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
    // Persist the same snapshot used to build cases. Script generation happens
    // after the report and must not remap against a library that changed mid-run.
    const mapAbs = libraryRunMapFile(projectPath);
    const mapTmp = mapAbs + '.tmp';
    fs.writeFileSync(mapTmp, JSON.stringify({ version: 1, createdAt: new Date().toISOString(), idMap }, null, 2), 'utf-8');
    fs.renameSync(mapTmp, mapAbs);

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
        mode,
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
      mode,
      parentRoundId,
      status: 'running',
      total: cases.length,
    });

    const scope = mode === 'failed-only' ? `复测轮(基准 ${parentRoundId})` : `套件「${suiteName}」`;
    void appendAudit(projectPath, REGRESSION_LIBRARY_TASK, {
      action: 'run-library',
      mode: 'manual',
      step: 'execution',
      detail: `发起回归轮次 ${roundId}:${scope}命中 ${cases.length} 条(来源 ${new Set(hits.map((e) => e._source.task)).size} 个任务),环境 ${env}${approvedOnly ? ',仅执行已确认用例' : ''}`,
    });
    return Response.json({ ok: true, total: cases.length, roundId, mode, parentRoundId });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Internal server error';
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
