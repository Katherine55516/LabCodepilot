import { queryTestStatsEvents } from '@/lib/db';
import { buildDailyRollup } from '@/lib/test/usage-rollup';
import {
  buildRegressionDailyRollup,
  listWorkbenchProjectPaths,
  mergeRegressionIntoDays,
} from '@/lib/test/regression-rollup';

export const runtime = 'nodejs';

/**
 * 测试模块使用统计 · 每日滚动汇总路由（供 Electron 主进程本地环回调用，无鉴权，与 /api/test/stats 一致）。
 *
 * GET ?from=YYYY-MM-DD&to=YYYY-MM-DD（均为北京日，必填）→ { days: DayUsage[] }
 *
 * 两路数据在此会合（来源与口径完全不同，故各自聚合后按日期并集合并）：
 *   - 功能测试：SQLite test_stats_events（事件表、机器级）→ buildDailyRollup
 *   - 回归测试：各项目 AI_LabTest/ 文件态（单项目）→ 先枚举工作台项目清单，再逐项目折叠
 *     → buildRegressionDailyRollup → mergeRegressionIntoDays
 * 只有回归活动、没有功能事件的那天也会出现（反之亦然）。
 *
 * 缺参/格式非法 → 400；异常 → 500（fail-safe，采集/汇总不影响主流程）。
 * 口径与实现见 src/lib/test/usage-rollup.ts 与 src/lib/test/regression-rollup.ts。
 */

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TZ_OFFSET_MINUTES = 480; // 北京 UTC+8，须与 buildDailyRollup 默认一致

/** 北京墙钟 'YYYY-MM-DD HH:MM:SS' → UTC 'YYYY-MM-DD HH:MM:SS'（UTC = 北京 - 偏移）。 */
function beijingToUtc(beijing: string, offsetMin: number): string {
  const asUtc = Date.parse(`${beijing.replace(' ', 'T')}Z`);
  const d = new Date(asUtc - offsetMin * 60000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return `${y}-${m}-${day} ${hh}:${mm}:${ss}`;
}

export async function GET(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    if (!from || !DAY_RE.test(from) || !to || !DAY_RE.test(to)) {
      return Response.json(
        { error: 'from and to are required (YYYY-MM-DD, Beijing day)' },
        { status: 400 },
      );
    }
    // ① 功能测试（事件表，机器级）
    const fromUtc = beijingToUtc(`${from} 00:00:00`, TZ_OFFSET_MINUTES);
    const toUtc = beijingToUtc(`${to} 23:59:59`, TZ_OFFSET_MINUTES);
    const events = queryTestStatsEvents({ from: fromUtc, to: toUtc });
    const funcDays = buildDailyRollup(events, { tzOffsetMinutes: TZ_OFFSET_MINUTES });

    // ② 回归（文件态，逐项目 → 机器级）。任一项目读失败都已在各 reader 内部容错为空，不影响功能侧。
    const { reg, suitesCount } = buildRegressionDailyRollup(
      listWorkbenchProjectPaths(),
      from,
      to,
      Date.now(),
      TZ_OFFSET_MINUTES,
    );

    // ③ 累计曾创建的任务数（机器级全历史快照）：数所有 task_created 事件，与窗口无关。
    //    事件数≈曾创建任务数（有限，几百级），count 即可。
    const tasksTotal = queryTestStatsEvents({ eventTypes: ['task_created'] }).length;

    // ④ 并集合并后再裁剪到窗口（快照 suites_count / tasks_total 只打在最新一天 = to）
    const days = mergeRegressionIntoDays(funcDays, reg, suitesCount, to, tasksTotal).filter(
      (d) => d.date >= from && d.date <= to,
    );
    return Response.json({ days });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return Response.json({ error: message }, { status: 500 });
  }
}
