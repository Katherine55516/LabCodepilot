import { appendAudit } from '@/lib/test/audit';
import { setQuarantine, sanitizeEntryKeys, REGRESSION_LIBRARY_TASK } from '@/lib/test/library';

export const runtime = 'nodejs';

/**
 * 回归用例库 · 隔离 / 恢复(v2 三期)。
 *
 * POST { projectPath, keys:[{task, originalId}], quarantined: boolean, reason? }
 *   → { ok, updated, total }
 *
 * 隔离语义:该用例从任何套件求值里排除(evalSuite 先滤 quarantined)、不计发版红线。
 * **隔离不是删除,也不是遮羞布**——报告横幅强制显示「隔离中 N 条未计入」,健康度页在隔离
 * 占比超阈值时告警。写入一律记审计,便于回溯「谁在发版前把哪条挂掉的用例隔离了」。
 */
export async function POST(req: Request): Promise<Response> {
  try {
    const body = await req.json().catch(() => ({}));
    const projectPath: unknown = body.projectPath;
    if (!projectPath || typeof projectPath !== 'string') {
      return Response.json({ ok: false, error: 'projectPath is required' }, { status: 400 });
    }
    if (typeof body.quarantined !== 'boolean') {
      return Response.json({ ok: false, error: 'quarantined must be boolean' }, { status: 400 });
    }
    const keys = sanitizeEntryKeys(body.keys);
    if (!keys.length) {
      return Response.json({ ok: false, error: 'keys is required' }, { status: 400 });
    }
    const reason = typeof body.reason === 'string' ? body.reason : undefined;

    const r = setQuarantine(projectPath, keys, body.quarantined, reason);
    if (r.updated > 0) {
      void appendAudit(projectPath, REGRESSION_LIBRARY_TASK, {
        action: 'library-quarantine',
        mode: 'manual',
        step: 'cases',
        detail: body.quarantined
          ? `隔离 ${r.updated} 条回归用例(聚合排除、不计发版红线;理由:${reason?.trim() || '手动隔离'})`
          : `恢复 ${r.updated} 条隔离用例(重新计入聚合与红线)`,
      });
    }
    return Response.json({ ok: true, ...r });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Internal server error';
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
