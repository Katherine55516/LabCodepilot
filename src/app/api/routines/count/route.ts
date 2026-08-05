import { listCoworkRoutines } from '@/lib/db';

/**
 * GET /api/routines/count —— 侧边栏徽标用的任务数。
 *
 * **纯本地读缓存,不打沙箱**:侧边栏每次挂载都会问一次,走网络的话等于每开一次 app、
 * 每切一次 tab 就多一轮沙箱往返,而这个数字只是个徽标。缓存由定时任务页和同步流程写入,
 * 差一拍无所谓 —— 数字短暂偏旧远好过让侧边栏依赖沙箱可达性。
 */
export async function GET() {
  return Response.json({ count: listCoworkRoutines().length });
}
