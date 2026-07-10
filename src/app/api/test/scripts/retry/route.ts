import fs from 'fs';
import path from 'path';
import { artifactPaths } from '@/lib/test/prompts';
import { isUnsafeSegment } from '@/lib/test/path-safety';
import { sha1Hex } from '@/lib/test/history';
import { enqueueScriptJob } from '@/lib/test/script-job-manager';

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
    const forceCaseIds = Array.isArray(body.caseIds)
      ? body.caseIds.filter((id: unknown): id is string => typeof id === 'string' && id.trim().length > 0).map((id: string) => id.trim()).slice(0, 200)
      : undefined;
    const runFile = path.join(projectPath, artifactPaths(taskName, env).runJson);
    const runContent = fs.readFileSync(runFile, 'utf-8');
    const result = await enqueueScriptJob({
      projectPath,
      taskName,
      env,
      runHash: sha1Hex(runContent),
      model: typeof body.model === 'string' ? body.model : undefined,
      providerId: typeof body.providerId === 'string' ? body.providerId : undefined,
      forceCaseIds,
    });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
