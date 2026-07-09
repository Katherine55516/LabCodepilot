import fs from 'fs';
import path from 'path';
import { artifactPaths } from '@/lib/test/prompts';
import { isUnsafeSegment } from '@/lib/test/path-safety';
import { recordStatsEvents } from '@/lib/test/stats-recorder';

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
    const body = (await req.json().catch(() => ({}))) as { projectPath?: string; taskName?: string; taskId?: unknown; cases?: unknown };
    const { projectPath, taskName } = body;
    if (!projectPath || !taskName || isUnsafeSegment(taskName)) {
      return Response.json({ error: 'projectPath, taskName required (taskName must be a safe path segment)' }, { status: 400 });
    }
    const taskId: string | null =
      typeof body.taskId === 'string' && body.taskId.trim() ? body.taskId.trim().slice(0, 128) : null;
    const cases = Array.isArray(body.cases) ? body.cases : [];
    const file = casesFile(projectPath, taskName);
    // 使用统计 cases_edited 的 before 计数（写盘前读旧文件；不存在/损坏按 0）
    let countBefore = 0;
    if (taskId) {
      try {
        const prev = JSON.parse(await fs.promises.readFile(file, 'utf-8')) as unknown;
        const prevList = Array.isArray((prev as { cases?: unknown })?.cases)
          ? (prev as { cases: unknown[] }).cases
          : Array.isArray(prev)
            ? prev
            : [];
        countBefore = prevList.length;
      } catch {
        /* 首次保存 → before=0 */
      }
    }
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    // 原子写:先写临时文件再 rename(同目录 rename 原子),避免读到写一半的损坏 JSON。
    const tmp = `${file}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify({ cases }, null, 2), 'utf-8');
    await fs.promises.rename(tmp, file);
    // 使用统计：手动编辑保存（辅助信号；采纳率不消费它，批准时 diff 才是权威）
    if (taskId) {
      recordStatsEvents([
        {
          eventType: 'cases_edited',
          projectPath,
          taskId,
          taskName,
          payload: { countBefore, countAfter: cases.length },
        },
      ]);
    }
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'save failed' }, { status: 500 });
  }
}
