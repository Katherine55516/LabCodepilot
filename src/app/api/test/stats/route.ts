import fs from 'fs';
import path from 'path';
import { insertTestStatsEvents, queryTestStatsEvents } from '@/lib/db';
import {
  aggregateGlobal,
  aggregateModels,
  aggregateTask,
  classifyVerdict,
  diffCases,
  readCaseKeys,
  sanitizeEventInput,
  snapshotCases,
} from '@/lib/test/stats';
import { artifactPaths } from '@/lib/test/prompts';
import { isUnsafeSegment } from '@/lib/test/path-safety';
import type { TestStatsEventInput } from '@/types';

export const runtime = 'nodejs';

/**
 * 测试模块使用统计 · 采集 + 聚合路由。
 *
 * POST：事件上报（前端埋点走这里；服务端埋点在各路由内直接写库，不经 HTTP）。
 *   body { events: TestStatsEventInput[] } 或 { event: TestStatsEventInput }。
 *   - 逐条 sanitize，不合法条目静默跳过（统计采集永远不能影响测试主流程）；
 *   - `cases_approved` 特殊处理：服务端读当前 cases.json 拍终态快照，与首轮
 *     cases_generated 快照（DB 里查）做 id+hash diff，算出 原样/修改/弃用/新增 与
 *     返工轮数写进 payload —— 前端只发"批准了"这个信号，口径由服务端保证。
 *   - 响应 { ok, stored, skipped }。
 *
 * GET：聚合查询（?scope=global|task|model & taskId & from & to）。
 *   - global：全局 KPI + 周趋势 + 任务明细行（默认全量时间，from/to 可选裁剪）；
 *   - task：单任务详情（节点轮次 + 采纳 + 复核），taskId 必填，取全量历史；
 *   - model：按模型归因的效果对比行。
 *   from/to 接受 'YYYY-MM-DD' 或 'YYYY-MM-DD HH:MM:SS'（UTC，与 created_at 同构）。
 *   响应 { scope, data }。
 *
 * 口径与事件字典见 docs/exec-plans/active/test-usage-stats.md；
 * 校验/diff/聚合的实现与单测在 src/lib/test/stats.ts。
 */

/** cases.json 的两种形状（顶层 {cases:[...]} 或顶层数组）→ 用例数组。项目内多处同款。 */
function readCasesFile(projectPath: string, taskName: string): unknown[] | null {
  try {
    const raw = fs.readFileSync(path.join(projectPath, artifactPaths(taskName).cases), 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray((parsed as { cases?: unknown })?.cases)
      ? (parsed as { cases: unknown[] }).cases
      : Array.isArray(parsed)
        ? parsed
        : [];
  } catch {
    return null;
  }
}

/** cases_approved 事件的服务端增补：终态快照 + 对首轮基线的 diff + 返工轮数。 */
function enrichCasesApproved(ev: TestStatsEventInput): TestStatsEventInput {
  const payload: Record<string, unknown> = { ...(ev.payload ?? {}) };
  try {
    const gen = queryTestStatsEvents({ taskId: ev.taskId, eventTypes: ['cases_generated'] });
    payload.aiRounds = gen.length;
    const baseline = gen.length > 0 ? readCaseKeys(gen[0].payload.cases) : null;
    const taskName = ev.taskName ?? '';
    if (taskName && !isUnsafeSegment(taskName)) {
      const list = readCasesFile(ev.projectPath, taskName);
      if (list) {
        const final = snapshotCases(list);
        payload.finalCount = final.length;
        payload.final = final;
        if (baseline && baseline.length > 0) {
          payload.diff = diffCases(baseline, final);
        }
      }
    }
  } catch {
    payload.diffError = 'enrich_failed'; // 事件照存，只是没有 diff；聚合按缺省处理
  }
  return { ...ev, payload };
}

/**
 * report_reviewed 服务端归类：前端「✗ 有误」只回答"实际结果是什么"（actual: ok/broken/severity），
 * verdict（误报/漏报/程度不符）由服务端按 AI 结论统一判定，避免分类逻辑在前端重复实现而漂移。
 * 「✓ 准确」与「一键全准」前端直接带 verdict:'accurate'，原样透传。
 */
function enrichReviewed(ev: TestStatsEventInput): TestStatsEventInput {
  const p = ev.payload ?? {};
  if (typeof p.verdict === 'string') return ev; // 已带 verdict（accurate / 直接指定）
  const aiStatus = typeof p.aiStatus === 'string' ? p.aiStatus : '';
  const actual = p.actual;
  if (aiStatus && (actual === 'ok' || actual === 'broken' || actual === 'severity')) {
    return { ...ev, payload: { ...p, verdict: classifyVerdict(aiStatus, actual) } };
  }
  return ev; // 无法归类 → 原样（聚合端对无 verdict 的 report_reviewed 忽略）
}

export async function POST(req: Request): Promise<Response> {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const rawEvents: unknown[] = Array.isArray(body.events)
      ? body.events
      : body.event !== undefined
        ? [body.event]
        : [];
    if (rawEvents.length === 0 || rawEvents.length > 200) {
      return Response.json({ error: 'events required (1-200 per request)' }, { status: 400 });
    }
    const accepted: TestStatsEventInput[] = [];
    let skipped = 0;
    for (const raw of rawEvents) {
      const ev = sanitizeEventInput(raw);
      if (!ev) {
        skipped++;
        continue;
      }
      accepted.push(
        ev.eventType === 'cases_approved'
          ? enrichCasesApproved(ev)
          : ev.eventType === 'report_reviewed'
            ? enrichReviewed(ev)
            : ev,
      );
    }
    const stored = accepted.length > 0 ? insertTestStatsEvents(accepted) : 0;
    return Response.json({ ok: true, stored, skipped });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}

/**
 * 窗口查询必须带全量任务上下文：只按 from/to 裁剪事件会让窗外执行轮的归因上下文丢失
 * （熔断排除失效、首轮基线缺失、覆盖率越界）。做法：先查窗内事件拿到涉及的 taskId，
 * 再取这些任务的完整事件历史交给聚合层；窗口本身由聚合层按口径做"计入门控"。
 * 任务数超出 IN 子句安全上限时退化为全表（正确的超集，只是多算）。
 */
function queryEventsWithContext(from?: string, to?: string) {
  if (!from && !to) return queryTestStatsEvents({});
  const windowEvents = queryTestStatsEvents({ from, to });
  const taskIds = [...new Set(windowEvents.map((e) => e.taskId))];
  if (taskIds.length === 0) return windowEvents;
  if (taskIds.length > 900) return queryTestStatsEvents({});
  return queryTestStatsEvents({ taskIds });
}

const TIME_RE = /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2})?$/;

/** 'YYYY-MM-DD' → 一天的边界；非法格式返回 undefined（当没传处理）。 */
function normalizeTime(v: string | null, edge: 'from' | 'to'): string | undefined {
  if (!v || !TIME_RE.test(v)) return undefined;
  if (v.length === 10) return edge === 'from' ? `${v} 00:00:00` : `${v} 23:59:59`;
  return v;
}

export async function GET(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const scope = url.searchParams.get('scope') || 'global';
    const from = normalizeTime(url.searchParams.get('from'), 'from');
    const to = normalizeTime(url.searchParams.get('to'), 'to');

    if (scope === 'task') {
      const taskId = url.searchParams.get('taskId');
      if (!taskId) {
        return Response.json({ error: 'taskId is required for scope=task' }, { status: 400 });
      }
      const events = queryTestStatsEvents({ taskId });
      return Response.json({ scope, data: aggregateTask(events) });
    }
    if (scope === 'reviews') {
      // 报告复核回显：返回某任务(+可选 runHash)当前每条用例的复核结论（last-wins）。
      // 前端打开报告时据此把已复核的行标出，未复核的显示复核按钮。
      const taskId = url.searchParams.get('taskId');
      if (!taskId) {
        return Response.json({ error: 'taskId is required for scope=reviews' }, { status: 400 });
      }
      const runHash = url.searchParams.get('runHash') || undefined;
      const events = queryTestStatsEvents({
        taskId,
        eventTypes: ['report_reviewed', 'report_review_bulk'],
      });
      const byCaseId: Record<string, string> = {};
      for (const ev of events) {
        // 事件按时间升序 → 后写覆盖先写（last-wins）
        const p = ev.payload;
        if (runHash && typeof p.runHash === 'string' && p.runHash !== runHash) continue;
        if (ev.eventType === 'report_reviewed') {
          const caseId = typeof p.caseId === 'string' ? p.caseId : '';
          const verdict = typeof p.verdict === 'string' ? p.verdict : '';
          if (!caseId) continue;
          if (verdict === 'cleared') delete byCaseId[caseId]; // 撤销：last-wins 移除
          // verdict 白名单与聚合层 buildTaskAccs 一致（词表外的值不回显，防御性）
          else if (verdict === 'accurate' || verdict === 'false_fail' || verdict === 'missed_fail' || verdict === 'severity_mismatch') byCaseId[caseId] = verdict;
        } else {
          const ids = Array.isArray(p.caseIds) ? p.caseIds : [];
          for (const cid of ids) if (typeof cid === 'string') byCaseId[cid] = 'accurate';
        }
      }
      return Response.json({ scope, data: { byCaseId } });
    }
    if (scope === 'model') {
      const events = queryEventsWithContext(from, to);
      return Response.json({ scope, data: aggregateModels(events, { from, to }) });
    }
    if (scope === 'global') {
      const events = queryEventsWithContext(from, to);
      return Response.json({ scope, data: aggregateGlobal(events, { from, to }) });
    }
    return Response.json({ error: `unknown scope: ${scope}` }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return Response.json({ error: message }, { status: 500 });
  }
}
