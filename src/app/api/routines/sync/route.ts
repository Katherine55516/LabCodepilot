import { syncRoutines } from '@/lib/routine-sync';

/**
 * POST /api/routines/sync —— 拉取服务端运行记录并物化成本地会话(P5)。
 *
 * 定时任务在沙箱服务器上自己跑,客户端只做事后对账。触发时机由前端决定:
 * app 启动 / 打开定时任务页 / 定时轮询。
 *
 * **恒返回 200**,把成败放在 body 里。同步是后台动作:失败该降级成一条横幅,
 * 而不是让调用它的页面加载报错 —— 沙箱临时不可达时本地已物化的历史照样能看。
 * `notProvisioned` 为真时 UI 应隐藏整个入口(账号没下发沙箱配置)。
 */
export async function POST() {
  const result = await syncRoutines();
  return Response.json(result);
}
