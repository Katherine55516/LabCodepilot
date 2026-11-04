import { appendAudit } from '@/lib/test/audit';
import { setReviewState, sanitizeEntryKeys, REGRESSION_LIBRARY_TASK } from '@/lib/test/library';

export const runtime = 'nodejs';

/**
 * 回归用例库 · 评审态批量写(v2 二期)。
 *
 * POST { projectPath, keys:[{task, originalId}], reviewState: 'approved'|'pending' }
 *   → { ok, updated, total }
 *
 * 评审态**不参与发版红线**(红线口径仍是「回归集未全过 = 不可发版」),只影响发起回归弹窗的
 * 「仅执行已确认用例」开关与库内曝光——把它做成硬门禁会让存量项目一夜之间无法发版。
 * 存量条目(无 `_lib`)读为 approved,故本接口只对「新入库」与「主动打回」的用例有意义。
 */
export async function POST(req: Request): Promise<Response> {
  try {
    const body = await req.json().catch(() => ({}));
    const projectPath: unknown = body.projectPath;
    if (!projectPath || typeof projectPath !== 'string') {
      return Response.json({ ok: false, error: 'projectPath is required' }, { status: 400 });
    }
    const reviewState = body.reviewState;
    if (reviewState !== 'approved' && reviewState !== 'pending') {
      return Response.json({ ok: false, error: 'reviewState must be approved|pending' }, { status: 400 });
    }
    const keys = sanitizeEntryKeys(body.keys);
    if (!keys.length) {
      return Response.json({ ok: false, error: 'keys is required' }, { status: 400 });
    }

    const r = setReviewState(projectPath, keys, reviewState);
    if (r.updated > 0) {
      void appendAudit(projectPath, REGRESSION_LIBRARY_TASK, {
        action: 'library-review',
        mode: 'manual',
        step: 'cases',
        detail: `${reviewState === 'approved' ? '确认' : '打回'} ${r.updated} 条回归用例(库共 ${r.total} 条)`,
      });
    }
    return Response.json({ ok: true, ...r });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Internal server error';
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
