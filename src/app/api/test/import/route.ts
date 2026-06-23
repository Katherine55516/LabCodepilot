import fs from 'fs';
import path from 'path';
import { artifactPaths } from '@/lib/test/prompts';

/**
 * Save imported material for a test task into the project's AI_LabTest artifacts so
 * the flow consumes it directly (no AI generation for that step):
 *  - kind=requirement → {task}-需求.md  (用例 step reads it)
 *  - kind=cases       → {task}.cases.json (执行/报告 read it; must be valid JSON)
 *
 * Used by 新建任务 when the user imports 需求 / 用例 (see InlineTestingPanel.addTask).
 */
export async function POST(req: Request): Promise<Response> {
  try {
    const body = await req.json().catch(() => ({}));
    const projectPath: string | undefined = body.projectPath;
    const taskName: string = typeof body.taskName === 'string' ? body.taskName : '';
    const kind: string = body.kind;
    const content: string = typeof body.content === 'string' ? body.content : '';

    if (!projectPath || !taskName || (kind !== 'requirement' && kind !== 'cases')) {
      return Response.json({ error: 'projectPath, taskName, kind(requirement|cases) required' }, { status: 400 });
    }
    // Imported cases become the canonical cases.json the platform reduces against,
    // so it must be valid JSON.
    if (kind === 'cases') {
      try { JSON.parse(content); } catch { return Response.json({ error: 'imported cases must be valid JSON (cases.json)' }, { status: 400 }); }
    }

    const paths = artifactPaths(taskName);
    const rel = kind === 'requirement' ? paths.requirement : paths.cases;
    const abs = path.join(projectPath, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf-8');
    return Response.json({ ok: true, path: rel });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'import failed' }, { status: 500 });
  }
}
