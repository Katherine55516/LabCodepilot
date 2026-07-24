import {
  buildCaseHistory,
  flips,
  tailFails,
  health,
  roundStats,
  DEFAULT_HISTORY_LIMIT,
  QUARANTINE_ALERT_RATIO,
  type HealthKind,
} from '@/lib/test/case-history';
import { readSuites } from '@/lib/test/suites';

export const runtime = 'nodejs';

/**
 * 回归用例库 · 逐用例跨轮结果矩阵 + 健康度(v2 二/三期)。
 *
 * GET ?projectPath&limit → {
 *   rounds:  [{ roundId, startedAt, env, suiteName, mode, status }],        // 旧→新
 *   cases:   [{ task, originalId, purpose, priority, module, meta, res, pinned, flips, tailFails, health }],
 *   passRates: [{ roundId, pass, fail, total }],                            // 与 rounds 同下标
 *   summary: { total, flaky, streak, stale, never, quarantined, pending, quarantineRatio, quarantineAlert }
 * }
 *
 * 「对比矩阵」(屏 5)与「健康度」(屏 6)共用本接口。全部本地文件只读现算(run.json + 快照
 * idMap 反解),零执行逻辑、无物化中间态(数据源决策见 case-history.ts 模块头)。
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const projectPath = url.searchParams.get('projectPath');
  if (!projectPath) {
    return Response.json({ error: 'projectPath is required' }, { status: 400 });
  }
  try {
    const limitRaw = parseInt(url.searchParams.get('limit') ?? '', 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 50) : DEFAULT_HISTORY_LIMIT;

    const { rounds, cases } = buildCaseHistory(projectPath, { limit });
    // 身份键用 JSON 数组:任务名可含空格,单字符分隔符会撞键。
    const idKey = (task: string, originalId: string) => JSON.stringify([task, originalId]);
    const pinnedSet = new Set(readSuites(projectPath).pinned.map((k) => idKey(k.task, k.originalId)));

    const enriched = cases.map((c) => ({
      ...c,
      pinned: pinnedSet.has(idKey(c.task, c.originalId)),
      flips: flips(c.res),
      tailFails: tailFails(c.res),
      health: health(c.res, c.meta.quarantined),
    }));

    const tally = (k: HealthKind) => enriched.filter((c) => c.health === k).length;
    const quarantined = tally('quar');
    const total = enriched.length;

    return Response.json({
      rounds,
      cases: enriched,
      passRates: rounds.map((r, i) => ({ roundId: r.roundId, ...roundStats(cases, i) })),
      summary: {
        total,
        flaky: tally('flaky'),
        streak: tally('streak'),
        stale: tally('stale'),
        never: tally('never'),
        quarantined,
        pending: enriched.filter((c) => c.meta.reviewState === 'pending').length,
        quarantineRatio: total ? quarantined / total : 0,
        quarantineAlert: total > 0 && quarantined / total > QUARANTINE_ALERT_RATIO,
      },
    });
  } catch {
    return Response.json({
      rounds: [],
      cases: [],
      passRates: [],
      summary: { total: 0, flaky: 0, streak: 0, stale: 0, never: 0, quarantined: 0, pending: 0, quarantineRatio: 0, quarantineAlert: false },
    });
  }
}
