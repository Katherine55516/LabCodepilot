import { resolveProjectEnv } from '@/lib/test/env-config';

/**
 * Read a project's resolved test environment (from its exported
 * AI_LabTest/environments.json) for the workbench to display — target baseUrl,
 * which env, allowed envs, whether it's configured. The execution route reads the
 * same resolver internally; this GET is purely for showing it in the flow view.
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const projectPath = url.searchParams.get('projectPath');
  const env = url.searchParams.get('env') || undefined;
  if (!projectPath) {
    return Response.json({ error: 'projectPath is required' }, { status: 400 });
  }
  return Response.json(resolveProjectEnv(projectPath, env));
}
