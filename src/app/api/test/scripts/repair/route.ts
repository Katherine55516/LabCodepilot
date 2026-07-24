import { isUnsafeSegment } from '@/lib/test/path-safety';
import { repairFailedScripts } from '@/lib/test/script-job-manager';

export const runtime = 'nodejs';

/**
 * AI 修复运行失败的回归脚本：把 manifest 里的 lastRunError 连同当前脚本、原用例
 * 一起喂回模型定向修复，修复稿走与生成相同的校验/重放管线后原子覆盖。
 * 同步执行（与 run 路由一致）：LLM + collect + 安全重放，小批量在分钟级内返回。
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
      ? body.caseIds.filter((id: unknown): id is string => typeof id === 'string' && id.trim().length > 0).map((id: string) => id.trim()).slice(0, 50)
      : undefined;
    const { results, manifest } = await repairFailedScripts({
      projectPath,
      taskName,
      env,
      caseIds,
      model: typeof body.model === 'string' ? body.model : undefined,
      providerId: typeof body.providerId === 'string' ? body.providerId : undefined,
    });
    return Response.json({ ok: results.every((item) => item.fixed), results, manifest });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
