import { readLibrary } from '@/lib/test/library';
import { readSuites, evalSuite, sanitizeSuite } from '@/lib/test/suites';
import { buildLastResultLookup } from '@/lib/test/rounds';
import { resolveRunScope, RunScopeError } from '@/lib/test/run-scope';

export const runtime = 'nodejs';

/**
 * 套件求值预览。两种调用形态,求值口径都与发起执行完全一致——**预览即所见即所跑**。
 *
 *  ① 构建器(v2 批 C):编辑中的【未保存】套件定义
 *     POST { projectPath, suite } → { hits, sample }
 *
 *  ② 发起弹窗预检卡(二期):按【已保存的套件名 / 复测模式】求值
 *     POST { projectPath, scope: { suiteName?, mode?, approvedOnly?, parentRoundId? } }
 *       → { hits, hitTasks, sample, quarantined, pendingInScope, parentRoundId, suiteName, baseFailedCount }
 *     走 lib/test/run-scope.ts 的同一个 resolveRunScope——预检数字与真正圈选的用例集永远同源,
 *     不在前端重算一遍(那正是预览与实跑漂移的经典来源)。
 */
function sampleOf(hits: ReturnType<typeof evalSuite>) {
  return hits.slice(0, 8).map((e) => ({
    task: e._source.task,
    originalId: e._source.originalId,
    purpose: typeof e.purpose === 'string' ? e.purpose : '',
    priority: typeof e.priority === 'string' ? e.priority : '',
    module: typeof e.module === 'string' ? e.module : '',
  }));
}

export async function POST(req: Request): Promise<Response> {
  try {
    const body = await req.json().catch(() => ({}));
    const projectPath: string | undefined = body.projectPath;
    if (!projectPath || typeof projectPath !== 'string') {
      return Response.json({ error: 'projectPath is required' }, { status: 400 });
    }

    // ② 发起弹窗预检:按名字/模式求值。
    if (body.scope && typeof body.scope === 'object') {
      const s = body.scope as Record<string, unknown>;
      try {
        const scope = resolveRunScope(projectPath, {
          suiteName: typeof s.suiteName === 'string' ? s.suiteName : undefined,
          mode: s.mode === 'failed-only' ? 'failed-only' : 'full',
          approvedOnly: s.approvedOnly === true,
          parentRoundId: typeof s.parentRoundId === 'string' ? s.parentRoundId : undefined,
        });
        return Response.json({
          hits: scope.hits.length,
          hitTasks: new Set(scope.hits.map((e) => e._source.task)).size,
          sample: sampleOf(scope.hits),
          quarantined: scope.quarantined,
          pendingInScope: scope.pendingInScope,
          suiteName: scope.suiteName,
          parentRoundId: scope.parentRoundId,
          baseFailedCount: scope.baseFailedCount,
        });
      } catch (e) {
        if (e instanceof RunScopeError) {
          // 复测轮无基准时不是错误,是「本模式当前不可用」——返回 0 条 + 原因,弹窗据此禁用该模式。
          return Response.json({ hits: 0, hitTasks: 0, sample: [], quarantined: 0, pendingInScope: 0, unavailable: e.message });
        }
        throw e;
      }
    }

    // ① 构建器:未保存的套件定义。
    const suite = sanitizeSuite(body.suite);
    if (!suite) {
      return Response.json({ error: 'invalid suite' }, { status: 400 });
    }
    const lib = readLibrary(projectPath);
    const data = readSuites(projectPath);
    const hits = evalSuite(lib, suite, {
      pinned: data.pinned,
      lastResultOf: buildLastResultLookup(projectPath),
    });
    return Response.json({ hits: hits.length, sample: sampleOf(hits) });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Internal server error';
    return Response.json({ error: message }, { status: 500 });
  }
}
