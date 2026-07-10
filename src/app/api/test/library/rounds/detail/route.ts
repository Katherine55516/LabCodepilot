import fs from 'fs';
import path from 'path';
import {
  readRounds,
  normalizeStaleRounds,
  readRoundSnapshot,
  roundArtifactPaths,
  type RegressionRound,
} from '@/lib/test/rounds';
import { isUnsafeSegment } from '@/lib/test/path-safety';

export const runtime = 'nodejs';

/**
 * 轮次详情(v2 批 E):单轮的按来源任务分组结果 + 与上一全量轮的 delta。
 *
 * GET ?projectPath&roundId → {
 *   round,                          // 轮次记录(惰性收口视图)
 *   groups: [{ task, counts, tests: [{ originalId, purpose, status }] }],
 *   delta: { baseRoundId, newFail[], fixed[], stillFail[] } | null   // 无上一全量轮 → null
 * }
 * 全部本地文件只读拼装(run.json + 快照 idMap 反解),零执行逻辑。delta 只对两轮**都执行过**
 * 的用例有意义(交集口径,决策日志 2026-07-09):一轮没跑到的用例不判「新增失败/已修复」。
 */
interface CaseRef { task: string; originalId: string; purpose: string }

function readRunTests(projectPath: string, round: RegressionRound): Array<{ id: string; status: string }> | null {
  try {
    const abs = path.join(projectPath, roundArtifactPaths(round.roundId, round.env).runJson);
    const raw = JSON.parse(fs.readFileSync(abs, 'utf-8')) as { tests?: Array<{ id?: unknown; status?: unknown }> };
    if (!Array.isArray(raw.tests)) return null;
    return raw.tests
      .filter((t): t is { id: string; status: string } => !!t && typeof t.id === 'string' && typeof t.status === 'string');
  } catch {
    return null;
  }
}

/** 该轮的 (task·originalId) → {status, purpose}。快照缺损 → null(无法反解就不硬拼)。 */
function roundResultMap(projectPath: string, round: RegressionRound): Map<string, { status: string; ref: CaseRef }> | null {
  const snap = readRoundSnapshot(projectPath, round.roundId);
  if (!snap?.idMap) return null;
  const tests = readRunTests(projectPath, round);
  if (!tests) return null;
  const purposeByRunId = new Map<string, string>();
  for (const c of Array.isArray(snap.cases) ? snap.cases : []) {
    const cc = c as { id?: unknown; purpose?: unknown };
    if (typeof cc.id === 'string') purposeByRunId.set(cc.id, typeof cc.purpose === 'string' ? cc.purpose : '');
  }
  const map = new Map<string, { status: string; ref: CaseRef }>();
  for (const t of tests) {
    const src = snap.idMap[t.id];
    if (!src) continue;
    map.set(`${src.task}\u0000${src.originalId}`, {
      status: t.status,
      ref: { task: src.task, originalId: src.originalId, purpose: purposeByRunId.get(t.id) ?? '' },
    });
  }
  return map;
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const projectPath = url.searchParams.get('projectPath');
  const roundId = url.searchParams.get('roundId');
  if (!projectPath) return Response.json({ error: 'projectPath is required' }, { status: 400 });
  if (!roundId || isUnsafeSegment(roundId)) return Response.json({ error: 'invalid roundId' }, { status: 400 });

  const rounds = normalizeStaleRounds(readRounds(projectPath).rounds)
    .sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''));
  const round = rounds.find((r) => r.roundId === roundId);
  if (!round) return Response.json({ error: 'round not found' }, { status: 404 });

  const cur = roundResultMap(projectPath, round);
  // 按来源任务分组(保持快照内出现顺序)。
  const groups: Array<{ task: string; counts: Record<string, number>; tests: Array<CaseRef & { status: string }> }> = [];
  if (cur) {
    const byTask = new Map<string, Array<CaseRef & { status: string }>>();
    for (const { status, ref } of cur.values()) {
      if (!byTask.has(ref.task)) byTask.set(ref.task, []);
      byTask.get(ref.task)!.push({ ...ref, status });
    }
    for (const [task, tests] of byTask) {
      const counts: Record<string, number> = { total: tests.length, pass: 0, fail: 0, partial: 0, blocked: 0 };
      for (const t of tests) counts[t.status] = (counts[t.status] ?? 0) + 1;
      groups.push({ task, counts, tests });
    }
  }

  // delta:上一个「全量模式且已收口」的轮(按时间倒序,排除自身与复测轮)。
  let delta: { baseRoundId: string; newFail: CaseRef[]; fixed: CaseRef[]; stillFail: CaseRef[] } | null = null;
  if (cur) {
    const prev = rounds.find(
      (r) =>
        r.roundId !== round.roundId
        && (r.startedAt || '') < (round.startedAt || '')
        && r.mode !== 'failed-only'
        && (r.status === 'done' || r.status === 'partial'),
    );
    const prevMap = prev ? roundResultMap(projectPath, prev) : null;
    if (prev && prevMap) {
      const newFail: CaseRef[] = [];
      const fixed: CaseRef[] = [];
      const stillFail: CaseRef[] = [];
      for (const [key, curV] of cur) {
        const prevV = prevMap.get(key);
        if (!prevV) continue; // 交集口径:上一轮没跑到的不判 delta
        const curPass = curV.status === 'pass';
        const prevPass = prevV.status === 'pass';
        if (prevPass && !curPass) newFail.push(curV.ref);
        else if (!prevPass && curPass) fixed.push(curV.ref);
        else if (!prevPass && !curPass) stillFail.push(curV.ref);
      }
      delta = { baseRoundId: prev.roundId, newFail, fixed, stillFail };
    }
  }

  return Response.json({ round, groups, delta });
}
