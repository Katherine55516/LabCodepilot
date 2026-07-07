import { appendAudit, readAudit } from '@/lib/test/audit';
import { isUnsafeSegment } from '@/lib/test/path-safety';

export const runtime = 'nodejs';

/**
 * 测试工作台 · 操作审计路由。
 * 落盘 `<projectPath>/AI_LabTest/audit/<taskName>.jsonl`(独立于 report/,删任务留痕)。
 *  - POST { projectPath, taskName, event: { action, mode?, step?, taskId?, detail? } }
 *    → 追加一条,time 服务端生成。前端全部 fire-and-forget。
 *  - GET  ?projectPath&taskName → { events: AuditEvent[] }(最新在前,供操作记录 UI)。
 * 审计绝不阻塞业务:POST 即使内部失败也回 ok(调用方不重试、不提示)。
 */
export async function POST(req: Request): Promise<Response> {
  try {
    const body = await req.json().catch(() => ({}));
    const projectPath: string | undefined = body.projectPath;
    const taskName: string | undefined = body.taskName;
    const ev = (body.event ?? {}) as Record<string, unknown>;
    if (!projectPath || !taskName || isUnsafeSegment(taskName) || typeof ev.action !== 'string') {
      return Response.json({ ok: false }, { status: 400 });
    }
    await appendAudit(projectPath, taskName, {
      taskId: typeof ev.taskId === 'string' ? ev.taskId : undefined,
      step: typeof ev.step === 'string' ? ev.step : undefined,
      action: ev.action,
      mode: typeof ev.mode === 'string' ? ev.mode : 'manual',
      detail: typeof ev.detail === 'string' ? ev.detail.slice(0, 500) : undefined,
    });
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: true });
  }
}

export async function GET(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const projectPath = url.searchParams.get('projectPath');
    const taskName = url.searchParams.get('taskName');
    if (!projectPath || !taskName || isUnsafeSegment(taskName)) return Response.json({ events: [] });
    return Response.json({ events: await readAudit(projectPath, taskName) });
  } catch {
    return Response.json({ events: [] });
  }
}
