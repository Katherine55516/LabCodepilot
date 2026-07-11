import { isUnsafeSegment } from '@/lib/test/path-safety';
import { runScripts } from '@/lib/test/script-job-manager';

export const runtime = 'nodejs';

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
      ? body.caseIds.filter((id: unknown): id is string => typeof id === 'string' && id.trim().length > 0)
      : undefined;
    const { results, manifest } = await runScripts({
      projectPath,
      taskName,
      env,
      caseIds,
      model: typeof body.model === 'string' ? body.model : undefined,
      providerId: typeof body.providerId === 'string' ? body.providerId : undefined,
    });
    return Response.json({ ok: results.every((result) => result.ok), results, manifest });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
