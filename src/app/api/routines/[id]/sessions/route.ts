import { getSessionsByRoutine } from '@/lib/db';

/**
 * GET /api/routines/:id/sessions —— 该任务已物化到本地的会话(P6 第三层的取数口)。
 *
 * 运行历史来自服务端(`/runs`),而**能点开看的完整过程**来自本地物化的会话 ——
 * 两者靠 runId 对齐。这个路由回一张 runId → sessionId 的表,第三层拿它去
 * `/api/chat/sessions/:sid/messages` 取正文(那条路由的可见性守卫只看 owner_uid,
 * 不看 routine_id,所以定时会话按 id 能正常读到 —— 排除只针对列表,不针对访问)。
 *
 * 纯本地读,不打沙箱,所以离线也能用:已经拉回来的历史照样看得了。
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sessions = getSessionsByRoutine(id).map((s) => ({
    sessionId: s.id,
    runId: s.routine_run_id || '',
    title: s.title,
    createdAt: s.created_at,
  }));
  return Response.json({ sessions });
}
