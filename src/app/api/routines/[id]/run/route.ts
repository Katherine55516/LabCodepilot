import { runRoutineNow } from '@/lib/routines-client';
import { routineError } from '@/lib/routines-route-helpers';

/**
 * 立即运行。服务端在并发满 / 日配额用尽 / 上次还在跑时返回 429 + reason,
 * 这里原样透传 —— UI 要能区分「已发起」和「被限了」,后者还得说清是哪种限。
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return Response.json(await runRoutineNow(id));
  } catch (e) {
    return routineError(e);
  }
}
