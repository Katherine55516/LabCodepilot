import fs from 'fs';
import path from 'path';
import { isUnsafeSegment } from '@/lib/test/path-safety';
import { readManifest, scriptsDir } from '@/lib/test/script-artifacts';
import { recoverScriptJob } from '@/lib/test/script-job-manager';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const projectPath = url.searchParams.get('projectPath') || '';
  const taskName = url.searchParams.get('taskName') || '';
  const env = url.searchParams.get('env') || 'local';
  const caseId = url.searchParams.get('caseId');
  if (!projectPath || isUnsafeSegment(taskName) || isUnsafeSegment(env)) {
    return Response.json({ error: 'invalid projectPath/taskName/env' }, { status: 400 });
  }
  recoverScriptJob({ projectPath, taskName, env });
  const manifest = readManifest(projectPath, taskName, env);
  if (!manifest) return Response.json({ manifest: null });
  if (!caseId) return Response.json({ manifest });
  const item = manifest.cases.find((entry) => entry.caseId === caseId);
  if (!item) return Response.json({ error: 'script not found' }, { status: 404 });
  const ownerTask = item.sourceTask ?? taskName;
  if (isUnsafeSegment(ownerTask)) return Response.json({ error: 'script not found' }, { status: 404 });
  const root = scriptsDir(projectPath, ownerTask, env);
  const file = path.resolve(root, item.file);
  if (!file.startsWith(path.resolve(root) + path.sep) || !fs.existsSync(file)) {
    return Response.json({ error: 'script not found' }, { status: 404 });
  }
  return Response.json({ manifest, case: item, content: fs.readFileSync(file, 'utf-8') });
}
