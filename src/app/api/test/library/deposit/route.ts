import path from 'path';
import { artifactPaths } from '@/lib/test/prompts';
import { isUnsafeSegment } from '@/lib/test/path-safety';
import { appendAudit } from '@/lib/test/audit';
import { depositTask, readTaskCases, REGRESSION_LIBRARY_TASK } from '@/lib/test/library';

export const runtime = 'nodejs';

/**
 * 回归用例库 · 手动重同步某任务贡献。
 *
 * 用例设计步完成后【后端自动入库】(run/route wrapCasesStream);此接口是【前端 re-sync】,
 * 用于用例设计【之后】用户又改动了用例的场景——编辑用例保存、AI 推荐回归集——重新按当前
 * cases.json 把该任务的回归集 upsert 进库,保证库不 stale。
 *
 * POST { projectPath, taskName } → { ok, added, removed, total }。
 * best-effort:失败回 { ok:false },前端不重试、不打断主流程。保留任务名不入库(避免自递归)。
 */
export async function POST(req: Request): Promise<Response> {
  try {
    const body = await req.json().catch(() => ({}));
    const projectPath: string | undefined = body.projectPath;
    const taskName: string | undefined = body.taskName;
    if (!projectPath || !taskName || isUnsafeSegment(taskName)) {
      return Response.json({ ok: false }, { status: 400 });
    }
    if (taskName === REGRESSION_LIBRARY_TASK) {
      // 保留任务名不是真实测试任务,不入库
      return Response.json({ ok: true, added: 0, removed: 0, total: 0 });
    }
    const casesAbs = path.join(projectPath, artifactPaths(taskName).cases);
    const cases = readTaskCases(casesAbs);
    const r = depositTask(projectPath, taskName, cases);
    void appendAudit(projectPath, taskName, {
      action: 'deposit-library',
      mode: 'manual',
      step: 'cases',
      detail: `回归用例库重同步:新增 ${r.added} 条、替换旧 ${r.removed} 条,库共 ${r.total} 条`,
    });
    return Response.json({ ok: true, ...r });
  } catch {
    return Response.json({ ok: false }, { status: 500 });
  }
}
