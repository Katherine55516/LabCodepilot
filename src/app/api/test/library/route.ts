import { isUnsafeSegment } from '@/lib/test/path-safety';
import { appendAudit } from '@/lib/test/audit';
import { readLibrary, listByTask, removeEntries, REGRESSION_LIBRARY_TASK } from '@/lib/test/library';

export const runtime = 'nodejs';

/**
 * 回归用例库 · 查看 / 管理路由(项目级)。
 *
 *  - GET  ?projectPath → { total, updatedAt, tasks:[{ task, count, entries:[...] }] }
 *    按来源任务分组(库查看弹窗)。缺库 → 空。
 *  - DELETE { projectPath, task?, originalId? } → 移除:
 *      · 给 task+originalId  → 移除该单条;
 *      · 只给 task           → 移除该任务全部贡献;
 *      · 都不给              → 400(不支持清空全库,避免误删)。
 *    返回 { ok, removed, total }。移除记审计 library-remove。
 */
export async function GET(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const projectPath = url.searchParams.get('projectPath');
    if (!projectPath) return Response.json({ total: 0, updatedAt: '', tasks: [] });
    const lib = readLibrary(projectPath);
    const tasks = listByTask(lib).map((g) => ({ task: g.task, count: g.entries.length, entries: g.entries }));
    return Response.json({ total: lib.entries.length, updatedAt: lib.updatedAt, tasks });
  } catch {
    return Response.json({ total: 0, updatedAt: '', tasks: [] });
  }
}

export async function DELETE(req: Request): Promise<Response> {
  try {
    const body = await req.json().catch(() => ({}));
    const projectPath: string | undefined = body.projectPath;
    const task: string | undefined = typeof body.task === 'string' ? body.task : undefined;
    const originalId: string | undefined = typeof body.originalId === 'string' ? body.originalId : undefined;
    if (!projectPath || !task) {
      // 必须至少指定来源任务;不支持无差别清空全库(防误删)。
      return Response.json({ ok: false, error: 'task is required' }, { status: 400 });
    }
    const r = removeEntries(projectPath, (e) =>
      e._source.task === task && (originalId === undefined || e._source.originalId === originalId),
    );
    // 审计记在【来源任务】名下(与 deposit 一致,便于该任务审计线索连贯);来源任务名过安全校验。
    if (!isUnsafeSegment(task) && task !== REGRESSION_LIBRARY_TASK && r.removed > 0) {
      void appendAudit(projectPath, task, {
        action: 'library-remove',
        mode: 'manual',
        detail: originalId
          ? `从回归用例库移除用例 ${originalId}(库剩 ${r.total} 条)`
          : `从回归用例库移除任务「${task}」全部 ${r.removed} 条(库剩 ${r.total} 条)`,
      });
    }
    return Response.json({ ok: true, ...r });
  } catch {
    return Response.json({ ok: false }, { status: 500 });
  }
}
