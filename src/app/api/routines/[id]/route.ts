import { getRoutine, updateRoutine, deleteRoutine, toCacheRow } from '@/lib/routines-client';
import { upsertCoworkRoutine, deleteCoworkRoutine, getSessionsByRoutine, deleteSession } from '@/lib/db';
import { routineError } from '@/lib/routines-route-helpers';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const row = toCacheRow(await getRoutine(id));
    upsertCoworkRoutine(row);
    return Response.json({ routine: row });
  } catch (e) {
    return routineError(e);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const row = toCacheRow(await updateRoutine(id, await request.json()));
    upsertCoworkRoutine(row);
    return Response.json({ routine: row });
  } catch (e) {
    return routineError(e);
  }
}

/**
 * 删除 routine。服务端会连带清掉它的容器与持久卷,所以本地那些「由它物化出来的会话」
 * 也必须一起删 —— 留着的话用户会看到一堆点开是空的孤儿会话(产物已随卷消失)。
 * 顺序刻意是「先服务端后本地」:服务端失败就整体不动,不制造半删状态。
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await deleteRoutine(id);
    for (const s of getSessionsByRoutine(id)) deleteSession(s.id);
    deleteCoworkRoutine(id);
    return Response.json({ ok: true });
  } catch (e) {
    return routineError(e);
  }
}
