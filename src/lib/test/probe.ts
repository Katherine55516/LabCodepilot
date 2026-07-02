/**
 * 被测系统可达性探测（共享实现）。
 *
 * 服务端 GET 探活：被测前端(如 localhost:5173)通常不带 CORS 头，浏览器端跨源请求会被
 * 拦成 opaque/失败，无法区分「真不可达」与「CORS 拒绝」。放到 Next 服务端(Node)发请求
 * 则无同源限制，能拿到真实可达性 + 状态码。任意 HTTP 响应(含 3xx/4xx/5xx)都算「可达」
 * —— 服务在监听、能握手，就不该白跑一整轮。
 *
 * 同时被两处复用：
 *  - POST /api/test/probe：执行前确认弹窗「测试连接」按钮（单次探测）。
 *  - POST /api/test/run（执行步）：开跑前的可达性闸门（probeUrlWithRetry，最多 3 次）。
 *    仍不可达就直接拦下、不启动 AI —— 否则被测系统没起时 AI 会按执行规则 §0.3 反复
 *    `curl` 探活、永不终止（用户反馈的「无限重试」缺陷）。
 */

export const PROBE_TIMEOUT_MS = 6000;

export interface ProbeResult {
  /** true=站点在监听且完成 HTTP 握手（含 3xx/4xx/5xx）。 */
  reachable: boolean;
  /** HTTP 状态码（可达时）。 */
  status?: number;
  /** 本次探测耗时（ms）。 */
  latencyMs: number;
  /** 不可达 / 非法 URL 时的原因（timeout / 连接被拒 / invalid url / unsupported protocol）。 */
  error?: string;
}

/**
 * 单次可达性探测。只放行 http/https（挡掉 file:// 等本地协议探测，SSRF 面收敛 + 语义正确）。
 * 先 GET（HEAD 常被 dev server 401/405，GET 更能反映真实可达性），redirect:'manual' 不追
 * 跳转——拿到首个响应即证明握手成功；no-store 避免任何缓存层。
 */
export async function probeUrl(
  url: string,
  opts?: { timeoutMs?: number; signal?: AbortSignal },
): Promise<ProbeResult> {
  const timeoutMs = opts?.timeoutMs ?? PROBE_TIMEOUT_MS;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { reachable: false, latencyMs: 0, error: 'invalid url' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { reachable: false, latencyMs: 0, error: 'unsupported protocol' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // 外部信号（客户端断开 / 用户点停止）也能提前中止本次探测。
  const onExtAbort = () => controller.abort();
  if (opts?.signal) {
    if (opts.signal.aborted) controller.abort();
    else opts.signal.addEventListener('abort', onExtAbort, { once: true });
  }
  const startedMs = Date.now();
  try {
    const res = await fetch(parsed.toString(), {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
      cache: 'no-store',
      headers: { 'User-Agent': 'AI-Native-Lab/probe' },
    });
    const latencyMs = Date.now() - startedMs;
    // 任意响应（含 3xx/4xx/5xx）都算可达：服务在监听、TCP/HTTP 握手成功。
    return { reachable: true, status: res.status, latencyMs };
  } catch (e) {
    const latencyMs = Date.now() - startedMs;
    const aborted = controller.signal.aborted;
    const message = aborted ? 'timeout' : e instanceof Error ? e.message : String(e);
    return { reachable: false, latencyMs, error: message };
  } finally {
    clearTimeout(timer);
    if (opts?.signal) opts.signal.removeEventListener('abort', onExtAbort);
  }
}

export interface ProbeRetryResult {
  /** 最终是否可达（任一次成功即 true）。 */
  reachable: boolean;
  /** 实际尝试次数。 */
  attempts: number;
  /** 最后一次探测结果（用于取错误原因 / 状态码）。 */
  last: ProbeResult;
}

/**
 * 带重试的可达性探测：最多 attempts 次，任一次可达即返回；每次之间隔 delayMs（给「刚启动
 * 中」的 dev server 一点时间）。非法地址 / 不支持协议不重试（重试无意义）。外部 signal
 * 中止则提前收尾。供执行步开跑前的可达性闸门用——连续 attempts 次仍不可达 → 调用方拦下
 * 并请用户检查被测系统是否正常。
 */
export async function probeUrlWithRetry(
  url: string,
  opts?: { attempts?: number; timeoutMs?: number; delayMs?: number; signal?: AbortSignal },
): Promise<ProbeRetryResult> {
  const maxAttempts = Math.max(1, opts?.attempts ?? 3);
  const delayMs = opts?.delayMs ?? 800;
  let last: ProbeResult = { reachable: false, latencyMs: 0, error: 'not attempted' };
  let tried = 0;
  for (let i = 0; i < maxAttempts; i++) {
    if (opts?.signal?.aborted) break;
    tried++;
    last = await probeUrl(url, { timeoutMs: opts?.timeoutMs, signal: opts?.signal });
    if (last.reachable) return { reachable: true, attempts: tried, last };
    // 地址本身非法 → 再试也一样，直接返回。
    if (last.error === 'invalid url' || last.error === 'unsupported protocol') {
      return { reachable: false, attempts: tried, last };
    }
    // 最后一次失败后不再等待。
    if (i < maxAttempts - 1 && delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return { reachable: false, attempts: tried, last };
}
