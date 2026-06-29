import { resolveProjectEnvWithDb } from '@/lib/test/env-resolve';
import { inspectLoginState } from '@/lib/test/env-config';
import { isUnsafeSegment } from '@/lib/test/path-safety';

/**
 * Read a project's resolved test environment for the workbench to display — target
 * baseUrl, which env, allowed envs, whether it's configured, and the source (exported
 * file vs. live 设置·测试账号 DB). Uses the same file-first / DB-fallback resolver the
 * execution route uses; this GET is for showing it in the flow view AND for the
 * 多任务批量执行 pre-flight login-state gate (loginState).
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
  const resolved = resolveProjectEnvWithDb(projectPath, env);
  // loginState: 执行前登录态预检信号（文件存在 + cookie 过期）。best-effort，失败不阻断 GET。
  let loginState;
  try {
    loginState = inspectLoginState(resolved);
  } catch {
    loginState = undefined;
  }
  return Response.json({ ...resolved, loginState });
}
