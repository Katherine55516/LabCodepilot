import fs from 'fs';
import path from 'path';
import { appendAudit } from '@/lib/test/audit';
import { REGRESSION_LIBRARY_TASK } from '@/lib/test/library';
import {
  readRounds,
  mutateRounds,
  finishRound,
  normalizeStaleRounds,
  roundDirRel,
  roundArtifactPaths,
  type RegressionRound,
} from '@/lib/test/rounds';
import { isUnsafeSegment } from '@/lib/test/path-safety';
import { buildCaseHistory, mergedStats } from '@/lib/test/case-history';

export const runtime = 'nodejs';

/**
 * 回归轮次 API(v2 批 B)。
 *
 * GET    ?projectPath           → { rounds, quarantined }(惰性收口视图:超时 running → aborted;按发起时间倒序)
 *          复测轮(failed-only)额外附 `mergedPassStr` = **合并口径**(每条用例截至该轮的最新
 *          结果)。复测轮只跑上轮的失败集,自身的 2/2 通过【不等于】可发版——红线必须看合并态。
 * PATCH  { projectPath, roundId, outcome } → 收口轮次:
 *          outcome='done'    读该轮 run.json 摘录 counts/suitePassStr 落索引(缺 run.json → 按 aborted 收);
 *          outcome='aborted' 直接标中断(前端 catch/停止时调用)。
 * DELETE { projectPath, roundId } → 删单轮:索引记录 + report/回归用例库/{roundId}/ 产物目录 +
 *          该轮证据目录(_evidence/回归用例库-*-{roundId})。缺 roundId → 400(不支持清空全部)。
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const projectPath = url.searchParams.get('projectPath');
  if (!projectPath) {
    return Response.json({ error: 'projectPath is required' }, { status: 400 });
  }
  const rounds = normalizeStaleRounds(readRounds(projectPath).rounds)
    .sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''));

  // 复测轮的合并口径:在跨轮矩阵里定位该轮的列下标,取每条用例截至此列的最新结果。
  // 矩阵限流近 N 轮,更早的复测轮找不到列 → 不附 mergedPassStr(诚实降级,UI 不显示结论)。
  let enriched: Array<RegressionRound & { mergedPassStr?: string }> = rounds;
  let quarantined = 0;
  try {
    const hist = buildCaseHistory(projectPath);
    quarantined = hist.cases.filter((c) => c.meta.quarantined).length;
    const idxOf = new Map(hist.rounds.map((r, i) => [r.roundId, i]));
    enriched = rounds.map((r) => {
      if (r.mode !== 'failed-only') return r;
      const i = idxOf.get(r.roundId);
      if (i === undefined) return r;
      const m = mergedStats(hist.cases, i);
      return { ...r, mergedPassStr: `${m.pass}/${m.total}` };
    });
  } catch { /* 矩阵拼装失败不该拖垮轮次列表 */ }

  return Response.json({ rounds: enriched, quarantined });
}

export async function PATCH(req: Request): Promise<Response> {
  try {
    const body = await req.json().catch(() => ({}));
    const projectPath: string | undefined = body.projectPath;
    const roundId: string | undefined = body.roundId;
    const outcome: string | undefined = body.outcome;
    if (!projectPath || typeof projectPath !== 'string') {
      return Response.json({ error: 'projectPath is required' }, { status: 400 });
    }
    if (!roundId || typeof roundId !== 'string' || isUnsafeSegment(roundId)) {
      return Response.json({ error: 'invalid roundId' }, { status: 400 });
    }
    if (outcome !== 'done' && outcome !== 'aborted') {
      return Response.json({ error: 'outcome must be done|aborted' }, { status: 400 });
    }
    const round = readRounds(projectPath).rounds.find((r) => r.roundId === roundId);
    if (!round) {
      return Response.json({ error: 'round not found' }, { status: 404 });
    }
    if (outcome === 'aborted') {
      finishRound(projectPath, roundId, { status: 'aborted' });
      return Response.json({ ok: true, status: 'aborted' });
    }
    // outcome='done':run.json 是权威事实——读它摘录口径;读不到说明执行没产出,按 aborted 收。
    try {
      const runAbs = path.join(projectPath, roundArtifactPaths(roundId, round.env).runJson);
      const raw = JSON.parse(fs.readFileSync(runAbs, 'utf-8')) as {
        counts?: Record<string, number>;
        suitePassStr?: unknown;
      };
      finishRound(projectPath, roundId, {
        status: 'done',
        counts: raw.counts,
        suitePassStr: typeof raw.suitePassStr === 'string' ? raw.suitePassStr : undefined,
      });
      return Response.json({ ok: true, status: 'done' });
    } catch {
      finishRound(projectPath, roundId, { status: 'aborted' });
      return Response.json({ ok: true, status: 'aborted', note: 'run.json 缺失,按中断收口' });
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Internal server error';
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: Request): Promise<Response> {
  try {
    const body = await req.json().catch(() => ({}));
    const projectPath: string | undefined = body.projectPath;
    const roundId: string | undefined = body.roundId;
    if (!projectPath || typeof projectPath !== 'string') {
      return Response.json({ error: 'projectPath is required' }, { status: 400 });
    }
    if (!roundId || typeof roundId !== 'string' || isUnsafeSegment(roundId)) {
      return Response.json({ error: 'invalid roundId' }, { status: 400 });
    }
    const before = readRounds(projectPath).rounds.length;
    mutateRounds(projectPath, (data) => {
      data.rounds = data.rounds.filter((r) => r.roundId !== roundId);
    });
    // 产物目录(报告/快照/run.json)与该轮证据目录一并删除。定向单轮、非批量;证据目录名
    // = {task}-{env}-{roundId}(见 artifactPaths),按「保留任务名前缀 + -{roundId} 后缀」精确
    // 匹配(env 不入判定,记录可能已删拿不到),不会波及其他轮/任务的证据。
    try {
      fs.rmSync(path.join(projectPath, roundDirRel(roundId)), { recursive: true, force: true });
    } catch { /* best-effort */ }
    try {
      const evidenceRoot = path.join(projectPath, 'AI_LabTest', 'report', '_evidence');
      for (const d of fs.readdirSync(evidenceRoot, { withFileTypes: true })) {
        if (d.isDirectory() && d.name.startsWith(`${REGRESSION_LIBRARY_TASK}-`) && d.name.endsWith(`-${roundId}`)) {
          fs.rmSync(path.join(evidenceRoot, d.name), { recursive: true, force: true });
        }
      }
    } catch { /* 无证据目录则忽略 */ }
    const after = readRounds(projectPath).rounds.length;
    if (before !== after) {
      void appendAudit(projectPath, REGRESSION_LIBRARY_TASK, {
        action: 'delete-round',
        mode: 'manual',
        step: 'execution',
        detail: `删除回归轮次 ${roundId}(索引记录 + 产物目录 + 证据)`,
      });
    }
    return Response.json({ ok: true, removed: before - after });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Internal server error';
    return Response.json({ error: message }, { status: 500 });
  }
}
