import ExcelJS from 'exceljs';
import { queryTestStatsEvents } from '@/lib/db';
import { aggregateGlobal } from '@/lib/test/stats';
import type { TestStatsEvent } from '@/types';

export const runtime = 'nodejs';

/**
 * 测试模块使用统计 · 导出（XLSX / JSON）。
 *
 * GET ?format=xlsx（默认）→ 4 个 Sheet 的 .xlsx（复用项目已有 exceljs，无新依赖）：
 *   ① 汇总指标 —— KPI 与口径说明（一行一指标）
 *   ② 任务明细 —— 看板明细表全量（一行一任务）
 *   ③ 复核明细 —— 每条用例的最终复核结论（last-wins，一行一复核）
 *   ④ 事件流水 —— test_stats_events 原始记录（含 payload JSON，便于自定义口径重算）
 * GET ?format=json → 原始事件数组（自定义分析用）。
 * from/to（'YYYY-MM-DD' 或含时分秒）可选裁剪时间窗（窗口口径与看板一致）。
 *
 * 口径见 docs/exec-plans/active/test-usage-stats.md；聚合在 src/lib/test/stats.ts。
 */

const TIME_RE = /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2})?$/;
function normTime(v: string | null, edge: 'from' | 'to'): string | undefined {
  if (!v || !TIME_RE.test(v)) return undefined;
  if (v.length === 10) return edge === 'from' ? `${v} 00:00:00` : `${v} 23:59:59`;
  return v;
}

function fmtDur(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}
function pct(v: number | null | undefined): string {
  return v == null ? '' : `${(v * 100).toFixed(1)}%`;
}

const VERDICT_ZH: Record<string, string> = {
  accurate: '判定准确', false_fail: '误报', missed_fail: '漏报', severity_mismatch: '程度不符',
};
const VALID_VERDICTS = new Set(['accurate', 'false_fail', 'missed_fail', 'severity_mismatch']);

/** 事件流水裁剪同看板：窗口查询补齐涉及任务的全量上下文（见 stats/route 同款注释）。 */
function eventsWithContext(from?: string, to?: string): TestStatsEvent[] {
  if (!from && !to) return queryTestStatsEvents({});
  const win = queryTestStatsEvents({ from, to });
  const taskIds = [...new Set(win.map((e) => e.taskId))];
  if (taskIds.length === 0) return win;
  if (taskIds.length > 900) return queryTestStatsEvents({});
  return queryTestStatsEvents({ taskIds });
}

export async function GET(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const format = url.searchParams.get('format') || 'xlsx';
    const from = normTime(url.searchParams.get('from'), 'from');
    const to = normTime(url.searchParams.get('to'), 'to');
    const events = eventsWithContext(from, to);

    if (format === 'json') {
      return new Response(JSON.stringify({ events }, null, 2), {
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="test-stats-events.json"`,
        },
      });
    }

    const g = aggregateGlobal(events, { from, to });
    const wb = new ExcelJS.Workbook();

    // ---- ① 汇总指标 ----
    const s1 = wb.addWorksheet('汇总指标');
    s1.addRow(['指标', '数值', '口径说明']);
    const a = g.adoption, e = g.execution, r = g.review;
    s1.addRows([
      ['测试任务数', g.tasks.total, `AI 生成流 ${g.tasks.aiFlow} · 导入用例 ${g.tasks.importedCases} · 已删 ${g.tasks.deleted}`],
      ['用例采纳率', pct(a.adoptionRate), '(原样采纳+修改后采纳) / 首轮 AI 生成数；仅统计 AI 生成流且已批准的任务'],
      ['原样采纳率', pct(a.keptRate), '原样采纳 / 首轮 AI 生成数'],
      ['首轮生成用例数', a.generated, '采纳率分母（首轮基线）'],
      ['采纳构成', `原样 ${a.kept} · 修改 ${a.modified} · 弃用 ${a.removed} · 新增 ${a.userAdded}`, ''],
      ['返工轮数', a.reworkRounds, '各任务用例生成轮数-1 之和'],
      ['执行轮次', e.runs, ''],
      ['执行通过率', pct(e.passRate), 'pass / 参与统计用例数（排除 401 熔断轮）'],
      ['平均单用例耗时', fmtDur(e.avgCaseDurationMs), '服务端进度行时间戳计时'],
      ['报告准确度', pct(r.accuracy), '复核为准确的条次 / 已复核条次'],
      ['复核覆盖率', pct(r.coverage), '已复核 / 可复核条次（准确度的置信度）'],
      ['误判构成', `误报 ${r.falseFail} · 漏报 ${r.missedFail} · 程度不符 ${r.severityMismatch}`, ''],
    ]);
    s1.getRow(1).font = { bold: true };
    s1.columns.forEach((c, i) => { c.width = [18, 30, 60][i] ?? 18; });

    // ---- ② 任务明细 ----
    const s2 = wb.addWorksheet('任务明细');
    s2.addRow(['任务', '项目路径', '创建时间', '来源', '首轮生成', '采纳', '修改', '弃用', '执行轮次', '最新通过率', '熔断', '已复核', '可复核', '准确度', '已删除']);
    for (const row of g.taskRows) {
      const latestRate = row.latestResults && row.latestResults.total > 0
        ? pct(row.latestResults.pass / row.latestResults.total) : '';
      s2.addRow([
        row.taskName || row.taskId, row.projectPath, row.createdAt ?? '', row.source ?? '',
        row.generated ?? '', row.adopted ?? '', row.modified ?? '', row.removed ?? '',
        row.executionRuns, latestRate, row.latestCircuitBroken ? '是' : '',
        row.reviewed, row.reviewTotal, pct(row.accuracy), row.deleted ? '是' : '',
      ]);
    }
    s2.getRow(1).font = { bold: true };
    s2.columns.forEach((c, i) => { c.width = [22, 40, 20, 20, 10, 8, 8, 8, 10, 12, 8, 8, 8, 10, 8][i] ?? 12; });

    // ---- ③ 复核明细（last-wins，排除已撤销 'cleared'）----
    // 与 KPI（Sheet 1 / 看板）口径一致：熔断轮（circuitBroken）的复核整轮排除、verdict 白名单，
    // 否则 Sheet 3 行数会与「报告准确度」分母对不上（评审 L3/L4）。
    const brokenRunHashes = new Set<string>();
    for (const ev of events) {
      if (ev.eventType === 'execution_completed' && ev.payload.circuitBroken === true && typeof ev.payload.runHash === 'string') {
        brokenRunHashes.add(ev.payload.runHash);
      }
    }
    const s3 = wb.addWorksheet('复核明细');
    s3.addRow(['任务', '环境', 'runHash', '用例ID', 'AI 结论', '人工判定', '复核时间']);
    // (taskId, runHash, caseId) → 最终一条，按时间升序覆盖
    const reviewMap = new Map<string, { taskName: string; env: string; runHash: string; caseId: string; aiStatus: string; verdict: string; at: string }>();
    for (const ev of events) {
      const p = ev.payload;
      const runHash = typeof p.runHash === 'string' ? p.runHash : '';
      if (runHash && brokenRunHashes.has(runHash)) continue; // 熔断轮复核不计
      if (ev.eventType === 'report_reviewed') {
        const caseId = typeof p.caseId === 'string' ? p.caseId : '';
        const verdict = typeof p.verdict === 'string' ? p.verdict : '';
        if (!caseId) continue;
        const key = `${ev.taskId}|${runHash}|${caseId}`;
        if (verdict === 'cleared') { reviewMap.delete(key); continue; }
        if (!VALID_VERDICTS.has(verdict)) continue;
        reviewMap.set(key, { taskName: ev.taskName, env: ev.env ?? '', runHash, caseId, aiStatus: typeof p.aiStatus === 'string' ? p.aiStatus : '', verdict, at: ev.createdAt });
      } else if (ev.eventType === 'report_review_bulk') {
        const ids = Array.isArray(p.caseIds) ? p.caseIds : [];
        for (const cid of ids) {
          if (typeof cid !== 'string') continue;
          reviewMap.set(`${ev.taskId}|${runHash}|${cid}`, { taskName: ev.taskName, env: ev.env ?? '', runHash, caseId: cid, aiStatus: '', verdict: 'accurate', at: ev.createdAt });
        }
      }
    }
    for (const v of reviewMap.values()) {
      s3.addRow([v.taskName, v.env, v.runHash.slice(0, 12), v.caseId, v.aiStatus, VERDICT_ZH[v.verdict] ?? v.verdict, v.at]);
    }
    s3.getRow(1).font = { bold: true };
    s3.columns.forEach((c, i) => { c.width = [22, 10, 14, 16, 10, 12, 20][i] ?? 12; });

    // ---- ④ 事件流水 ----
    const s4 = wb.addWorksheet('事件流水');
    s4.addRow(['时间', '事件类型', '任务', '环境', 'payload']);
    for (const ev of events) {
      s4.addRow([ev.createdAt, ev.eventType, ev.taskName || ev.taskId, ev.env ?? '', JSON.stringify(ev.payload)]);
    }
    s4.getRow(1).font = { bold: true };
    s4.columns.forEach((c, i) => { c.width = [20, 20, 22, 10, 80][i] ?? 18; });
    s4.getColumn(5).alignment = { wrapText: false };

    const buf = await wb.xlsx.writeBuffer();
    const stamp = (from ? from.slice(0, 10) : '全部') + '_' + (to ? to.slice(0, 10) : '至今');
    return new Response(new Uint8Array(buf as ArrayBuffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(`测试统计-${stamp}.xlsx`)}"`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return Response.json({ error: message }, { status: 500 });
  }
}
