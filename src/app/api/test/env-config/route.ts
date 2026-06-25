import { resolveProjectEnvWithDb } from '@/lib/test/env-resolve';
import { isUnsafeSegment } from '@/lib/test/path-safety';

/**
 * Read a project's resolved test environment for the workbench to display — target
 * baseUrl, which env, allowed envs, whether it's configured, and the source (exported
 * file vs. live 设置·测试账号 DB). Uses the same file-first / DB-fallback resolver the
 * execution route uses; this GET is purely for showing it in the flow view.
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const projectPath = url.searchParams.get('projectPath');
  const env = url.searchParams.get('env') || undefined;
  if (!projectPath) {
    return Response.json({ error: 'projectPath is required' }, { status: 400 });
  }
  // env composes the storageState path (.auth/{env}.{key}.storageState.json) — reject traversal.
  if (env !== undefined && isUnsafeSegment(env)) {
    return Response.json({ error: 'invalid env' }, { status: 400 });
  }
  return Response.json(resolveProjectEnvWithDb(projectPath, env));
}
