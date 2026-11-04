/**
 * `/api/routines/*` 各路由共用的错误映射(P4)。
 *
 * 单独抽出来是因为 Next 的 route.ts **只允许导出 handler**(见 CLAUDE.md:导出别的值
 * 会让 webpack 构建期路由校验报错),所以共享逻辑必须放在 route 文件之外。
 */
import { RoutinesHttpError, RoutinesUnavailableError } from './routines-client';

export function routineError(e: unknown): Response {
  if (e instanceof RoutinesUnavailableError) {
    // 503 而不是 404:「没开通」和「这条 routine 不存在」是两回事,UI 的处理也不同
    //(前者该隐藏整个入口,后者该提示刷新列表)。
    return Response.json({ error: e.message, reason: 'not_provisioned' }, { status: 503 });
  }
  if (e instanceof RoutinesHttpError) {
    // 原样透传服务端状态码与消息 —— 400 的中文校验说明、429 的配额原因都是给用户看的。
    return Response.json({ error: e.message }, { status: e.status });
  }
  const msg = e instanceof Error ? e.message : String(e);
  console.error('[api/routines]', msg);
  return Response.json({ error: msg }, { status: 500 });
}
