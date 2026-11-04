import path from 'path';
import fs from 'fs';
import { artifactPaths } from '@/lib/test/prompts';
import { isUnsafeSegment } from '@/lib/test/path-safety';
import { appendAudit } from '@/lib/test/audit';
import { applyRecommend } from '@/lib/test/recommend';
import { depositTask, readTaskCases, REGRESSION_LIBRARY_TASK } from '@/lib/test/library';

export const runtime = 'nodejs';

/**
 * AI 推荐回归集 · 应用(可视化审阅弹窗点「应用」时调)。
 *
 * 与 /api/test/cases/recommend?review=true 配套:recommend 只推荐(发 recommend_verdicts 帧、不写盘),
 * 用户在弹窗里审阅/勾选调整后,把最终判定 POST 到这里【一次性写盘】。复用 applyRecommend——只增删各条
 * tags 里的「回归测试」,其余字段原样。写完记审计 + 同步回归用例库(标签变了,该任务的库贡献需 upsert)。
 *
 * POST { projectPath, taskName, verdicts: [{id, suite}] } → { ok, changed, total, suiteTotal }。
 */
export async function POST(req: Request): Promise<Response> {
  try {
    const body = await req.json().catch(() => ({}));
    const projectPath: string | undefined = body.projectPath;
    const taskName: string = typeof body.taskName === 'string' ? body.taskName : '';
    const verdicts: unknown = body.verdicts;
    if (!projectPath || !taskName || isUnsafeSegment(taskName)) {
      return Response.json({ ok: false, error: 'projectPath, taskName required' }, { status: 400 });
    }
    if (!Array.isArray(verdicts)) {
      return Response.json({ ok: false, error: 'verdicts must be an array' }, { status: 400 });
    }
    const casesAbs = path.join(projectPath, artifactPaths(taskName).cases);
    if (!fs.existsSync(casesAbs)) {
      return Response.json({ ok: false, error: '当前任务尚无用例' }, { status: 400 });
    }
    // [{id, suite}] → Map<id, boolean>(仅取合法项)。
    const rec = new Map<string, boolean>();
    for (const v of verdicts) {
      if (v && typeof v.id === 'string' && typeof v.suite === 'boolean') rec.set(v.id, v.suite);
    }
    const summary = applyRecommend(casesAbs, rec);
    void appendAudit(projectPath, taskName, {
      action: 'recommend-suite',
      mode: 'manual',
      step: 'cases',
      detail: `AI 推荐回归集(审阅后应用)：调整 ${summary.changed} 条，回归集 ${summary.suiteTotal}/${summary.total}`,
    });
    // 标签已变 → 同步该任务在回归用例库的贡献(upsert by 来源任务;保留任务名不入库)。
    if (taskName !== REGRESSION_LIBRARY_TASK) {
      try { depositTask(projectPath, taskName, readTaskCases(casesAbs)); } catch { /* 库同步 best-effort */ }
    }
    return Response.json({ ok: true, ...summary });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Internal server error';
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
