/**
 * 被测链接探活（执行前确认弹窗「测试连接」按钮）。
 *
 * 服务端发起请求而非浏览器端 fetch —— 被测前端(如 localhost:5173)通常不带 CORS 头,
 * 浏览器端跨源请求会被拦成 opaque/失败,无法区分「真不可达」与「CORS 拒绝」。放到 Next
 * 服务端(Node)发请求则无同源限制,能拿到真实可达性 + 状态码。
 *
 * 与执行阶段规则 §0.3「被测地址探活」一致:可达→放行;连接被拒/超时/DNS 失败→不可达。
 * 任意 HTTP 响应(含 4xx/5xx)都算「可达」—— 服务在监听、能握手,就不该白跑一整轮。
 *
 * 探活逻辑本体在 @/lib/test/probe（probeUrl），与执行步开跑前的可达性闸门
 * (POST /api/test/run 的 probeUrlWithRetry) 共用同一「是否可达」定义。
 */
import { probeUrl } from '@/lib/test/probe';

export async function POST(req: Request): Promise<Response> {
  let url: string | undefined;
  try {
    const body = await req.json().catch(() => ({}));
    url = typeof body.url === 'string' ? body.url.trim() : undefined;
  } catch {
    /* ignore — handled below */
  }
  if (!url) {
    return Response.json({ ok: false, reachable: false, error: 'url is required' }, { status: 400 });
  }

  const r = await probeUrl(url);
  // 非法地址 / 不支持协议：保持原语义（ok:false，不代表「探到不可达」而是入参问题）。
  if (r.error === 'invalid url' || r.error === 'unsupported protocol') {
    return Response.json({ ok: false, reachable: false, error: r.error });
  }
  // 可达：带回状态码 + 时延（不带 error 键，保持原响应形状）。
  if (r.reachable) {
    return Response.json({ ok: true, reachable: true, status: r.status, latencyMs: r.latencyMs });
  }
  // 探到不可达（连接被拒 / 超时 / DNS 失败）：ok:true（探测本身成功），reachable:false + 原因。
  return Response.json({ ok: true, reachable: false, error: r.error, latencyMs: r.latencyMs });
}
