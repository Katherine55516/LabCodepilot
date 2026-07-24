import { isUnsafeSegment } from '@/lib/test/path-safety';
import { runPipelineForTask } from '@/lib/test/script-job-manager';

export const runtime = 'nodejs';

/**
 * 手动「自动跑通」：对现有 manifest 直接跑 运行→失败自动修→再跑 的流水线，直至全部
 * 可修复的脚本通过。断言如实失败/环境阻塞的用例被诚实标出、不 force-pass。
 * 同步执行，小批量在分钟级返回（每轮含运行+LLM 修复）。
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
    const maxRepairRounds = typeof body.maxRepairRounds === 'number' && body.maxRepairRounds > 0
      ? Math.min(Math.floor(body.maxRepairRounds), 6) : undefined;
    const { summary, manifest } = await runPipelineForTask({
      projectPath,
      taskName,
      env,
      model: typeof body.model === 'string' ? body.model : undefined,
      providerId: typeof body.providerId === 'string' ? body.providerId : undefined,
      maxRepairRounds,
    });
    const ok = summary.stillFailing.length === 0 && summary.environmentBlocked.length === 0 && summary.needsHuman.length === 0;
    return Response.json({ ok, summary, manifest });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
