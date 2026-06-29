/**
 * 被测链接探活（执行前确认弹窗「测试连接」按钮）。
 *
 * 服务端发起请求而非浏览器端 fetch —— 被测前端(如 localhost:5173)通常不带 CORS 头,
 * 浏览器端跨源请求会被拦成 opaque/失败,无法区分「真不可达」与「CORS 拒绝」。放到 Next
 * 服务端(Node)发请求则无同源限制,能拿到真实可达性 + 状态码。
 *
 * 与执行阶段规则 §0.3「被测地址探活」一致:可达→放行;连接被拒/超时/DNS 失败→不可达。
 * 任意 HTTP 响应(含 4xx/5xx)都算「可达」—— 服务在监听、能握手,就不该白跑一整轮。
 */

const TIMEOUT_MS = 6000;

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
  // 只允许 http/https，挡掉 file:// 等本地协议探测（SSRF 面收敛 + 语义正确）。
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return Response.json({ ok: false, reachable: false, error: 'invalid url' });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return Response.json({ ok: false, reachable: false, error: 'unsupported protocol' });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const startedMs = Date.now();
  try {
    // 先 GET（HEAD 常被 dev server 401/405，GET 更能反映真实可达性）。redirect: 'manual'
    // 不追跳转 —— 拿到首个响应即证明握手成功。no-store 避免任何缓存层。
    const res = await fetch(parsed.toString(), {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
      cache: 'no-store',
      headers: { 'User-Agent': 'AI-Native-Lab/probe' },
    });
    const latencyMs = Date.now() - startedMs;
    // 任意响应（含 3xx/4xx/5xx）都算可达：服务在监听、TCP/HTTP 握手成功。
    return Response.json({ ok: true, reachable: true, status: res.status, latencyMs });
  } catch (e) {
    const latencyMs = Date.now() - startedMs;
    const aborted = controller.signal.aborted;
    const message = aborted ? 'timeout' : e instanceof Error ? e.message : String(e);
    return Response.json({ ok: true, reachable: false, error: message, latencyMs });
  } finally {
    clearTimeout(timer);
  }
}
