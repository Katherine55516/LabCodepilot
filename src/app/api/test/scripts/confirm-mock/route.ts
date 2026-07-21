import { isUnsafeSegment } from '@/lib/test/path-safety';
import { confirmMockScripts } from '@/lib/test/script-job-manager';

export const runtime = 'nodejs';

/**
 * 人工确认接口模拟脚本通过。
 *
 * 执行时用了 `browser_route` 模拟接口的脚本，重放通过也不代表真实环境可通过，故运行链路
 * 刻意不把它提升为 verified、只留一句「需人工确认真实环境可通过」的警告 —— 但此前平台没有
 * 任何地方能记录确认结果，状态被永久钉死在 needs_review。本路由就是那个落点。
 *
 * 只对 usesMock 且无失败记录的 needs_review 条目生效（其余各有既有恢复通道，不得被一键绕过）。
 */
export async function POST(req: Request): Promise<Response> {
  try {
    const body = await req.json().catch(() => ({}));
    const projectPath = typeof body.projectPath === 'string' ? body.projectPath : '';
    const taskName = typeof body.taskName === 'string' ? body.taskName : '';
    const env = typeof body.env === 'string' && body.env ? body.env : 'local';
    if (!projectPath || isUnsafeSegment(taskName) || isUnsafeSegment(env)) {
      return Response.json({ error: 'invalid projectPath/taskName/env' }, { status: 400 });
    }
    const caseIds = Array.isArray(body.caseIds)
      ? body.caseIds.filter((id: unknown): id is string => typeof id === 'string' && id.trim().length > 0).map((id: string) => id.trim())
      : [];
    if (!caseIds.length) {
      return Response.json({ error: 'caseIds is required' }, { status: 400 });
    }
    const { confirmed, skipped, manifest } = await confirmMockScripts({ projectPath, taskName, env, caseIds });
    return Response.json({ ok: true, confirmed, skipped, manifest });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
