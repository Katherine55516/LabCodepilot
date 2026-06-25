import fs from 'fs';
import path from 'path';
import { artifactPaths } from '@/lib/test/prompts';
import { isUnsafeSegment } from '@/lib/test/path-safety';

export const runtime = 'nodejs';

/**
 * 测试工作台 · 用例设计阶段用例的读 / 写。
 *
 * 用例存于 <projectPath>/AI_LabTest/testCase/.data/<taskName>.cases.json
 * (路径由 artifactPaths 统一约定,镜像 ai-lab-test-framework)。
 *  - GET:读用例供用例阶段展示 / 编辑器加载。文件不存在 / 解析失败 → { cases: [] }。
 *  - PUT:用例编辑器保存,整份覆盖写(原子写:先 .tmp 再 rename)。
 */

function casesFile(projectPath: string, taskName: string): string {
  return path.join(projectPath, artifactPaths(taskName).cases);
}

export async function GET(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const projectPath = url.searchParams.get('projectPath');
    const taskName = url.searchParams.get('taskName');
    if (!projectPath || !taskName || isUnsafeSegment(taskName)) return Response.json({ cases: [] });

    const raw = await fs.promises.readFile(casesFile(projectPath, taskName), 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    const cases = Array.isArray((parsed as { cases?: unknown })?.cases)
      ? (parsed as { cases: unknown[] }).cases
      : Array.isArray(parsed)
        ? parsed
        : [];
    return Response.json({ cases });
  } catch {
    return Response.json({ cases: [] });
  }
}

export async function PUT(req: Request): Promise<Response> {
  try {
    const body = (await req.json().catch(() => ({}))) as { projectPath?: string; taskName?: string; cases?: unknown };
    const { projectPath, taskName } = body;
    if (!projectPath || !taskName || isUnsafeSegment(taskName)) {
      return Response.json({ error: 'projectPath, taskName required (taskName must be a safe path segment)' }, { status: 400 });
    }
    const cases = Array.isArray(body.cases) ? body.cases : [];
    const file = casesFile(projectPath, taskName);
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    // 原子写:先写临时文件再 rename(同目录 rename 原子),避免读到写一半的损坏 JSON。
    const tmp = `${file}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify({ cases }, null, 2), 'utf-8');
    await fs.promises.rename(tmp, file);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'save failed' }, { status: 500 });
  }
}
