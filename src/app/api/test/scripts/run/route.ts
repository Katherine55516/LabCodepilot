import fs from 'fs';
import path from 'path';
import { isUnsafeSegment } from '@/lib/test/path-safety';
import { resolveProjectEnvWithDb } from '@/lib/test/env-resolve';
import { manifestCounts, readManifest, scriptsDir, writeManifest } from '@/lib/test/script-artifacts';
import { runGeneratedScript } from '@/lib/test/script-runner';
import { appendAudit } from '@/lib/test/audit';

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
    const manifest = readManifest(projectPath, taskName, env);
    if (!manifest) return Response.json({ error: 'script manifest not found' }, { status: 404 });
    const requested = Array.isArray(body.caseIds)
      ? new Set(body.caseIds.filter((id: unknown): id is string => typeof id === 'string'))
      : null;
    const runnable = manifest.cases.filter((item) =>
      (item.status === 'verified' || item.status === 'needs_review') && (!requested || requested.has(item.caseId))
    );
    if (!runnable.length) return Response.json({ error: 'no runnable scripts selected' }, { status: 400 });

    const resolved = resolveProjectEnvWithDb(projectPath, env);
    const results: Array<{ caseId: string; ok: boolean; output: string; timedOut: boolean }> = [];
    for (const item of runnable) {
      const ownerTask = item.sourceTask ?? taskName;
      if (isUnsafeSegment(ownerTask)) {
        results.push({ caseId: item.caseId, ok: false, output: 'script owner is invalid', timedOut: false });
        continue;
      }
      const root = scriptsDir(projectPath, ownerTask, env);
      const file = path.resolve(root, item.file);
      if (!file.startsWith(path.resolve(root) + path.sep) || !fs.existsSync(file)) {
        results.push({ caseId: item.caseId, ok: false, output: 'script file missing', timedOut: false });
        continue;
      }
      const result = await runGeneratedScript({
        scriptFile: file,
        baseUrl: resolved.frontendBaseUrl,
        storageStatePath: resolved.storageStatePath,
        username: resolved.loginAccount?.username,
        password: resolved.loginAccount?.password,
        headed: body.headed === true,
        collectOnly: false,
        timeoutMs: 120_000,
      });
      results.push({ caseId: item.caseId, ok: result.ok, output: result.output.slice(-4000), timedOut: result.timedOut });
      if (result.ok && !item.usesMock) {
        item.status = 'verified';
        item.lastVerifiedAt = new Date().toISOString();
        item.validation = { ...(item.validation ?? { syntax: true, collected: true, replayed: false, warnings: [] }), replayed: true, error: undefined };
        item.error = undefined;
      }
    }
    manifest.counts = manifestCounts(manifest.cases, manifest.counts.eligible);
    manifest.jobStatus = manifest.counts.failed > 0 ? 'partial' : 'done';
    writeManifest(projectPath, taskName, env, manifest);
    await appendAudit(projectPath, taskName, {
      action: 'run-scripts', mode: 'manual', step: 'report', detail: `运行回归脚本:${results.filter((r) => r.ok).length}/${results.length} 通过`,
    });
    return Response.json({ ok: results.every((result) => result.ok), results, manifest });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
