import { listRoutines, createRoutine, toCacheRow } from '@/lib/routines-client';
import { replaceCoworkRoutines, upsertCoworkRoutine, listCoworkRoutines } from '@/lib/db';
import { routineError } from '@/lib/routines-route-helpers';

/**
 * GET /api/routines —— 列表。
 *
 * 拉到就用服务端结果**覆盖**本地缓存(replaceCoworkRoutines 会删掉服务端没有的),
 * 拉不到就退回本地缓存并标 offline —— 离线时列表仍可看,但 UI 会挂横幅且禁止新建/编辑
 * (本地改了会与服务端分叉,与其事后合并冲突不如当场说清楚)。
 */
export async function GET() {
  try {
    const remote = await listRoutines();
    const rows = remote.map(toCacheRow);
    replaceCoworkRoutines(rows);
    return Response.json({ routines: rows, offline: false });
  } catch (e) {
    const cached = listCoworkRoutines();
    if (cached.length > 0) {
      return Response.json({
        routines: cached,
        offline: true,
        error: e instanceof Error ? e.message : String(e),
      });
    }
    return routineError(e);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const created = await createRoutine(body);
    const row = toCacheRow(created);
    upsertCoworkRoutine(row);
    return Response.json({ routine: row }, { status: 201 });
  } catch (e) {
    return routineError(e);
  }
}
