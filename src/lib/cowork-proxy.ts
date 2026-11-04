/**
 * cowork-proxy.ts — 宿主凭证注入代理(P3-B:真 key 永不进 VM)。
 *
 * 威胁:办公模式把不可信文件喂给 agent,提示注入可诱导 agent 读自己的 env
 * 偷 managed key(它还能自由出网外发)。对策:真凭证只留宿主,VM 里的 claude
 * 只拿一个按会话签发的一次性 token。
 *
 * 拓扑(NAT 网关,P3-B-0 POC 验证 claude 侧可行 + guest→host 网关可达):
 *   VM claude ──http──▶ 192.168.64.1:<port>(本代理,绑 vmnet 网关)──https──▶ 真 API
 *     base_url=http://<gw>:<port>          校验一次性token→剥→注入真key→转发
 *     ANTHROPIC_*=<一次性token>            (真 key 只在本进程内存)
 *
 * 边界:只代理 claude 的 API 调用;agent 脚本的通用出网走 VM NAT 不经此代理
 * (与"保留自由上网"决策一致)。三重防护:绑 vmnet 网关 IP(仅该接口可达)
 * + 来源 IP 须在 vmnet 网段 + 一次性 token。token 随会话删除废止。
 */
import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import os from 'node:os';

const PROXY_PORT = 8788;
/** vfkit/Virtualization.framework NAT 默认网段;网关(宿主)在 .1。 */
const VMNET_PREFIX = '192.168.64.';

export type AuthStyle = 'api_key' | 'auth_token';

interface SessionCred {
  sessionId: string;
  realKey: string;
  realBase: string;
  authStyle: AuthStyle;
}

interface ProxyState {
  server: http.Server | null;
  boundHost: string | null;
  starting: Promise<string> | null;
  /** token → 真凭证(内存态,绝不落盘)。 */
  byToken: Map<string, SessionCred>;
  /** sessionId → token(幂等复用 + 废止)。 */
  tokenBySession: Map<string, string>;
}

const STATE_KEY = '__coworkProxyState__';
function state(): ProxyState {
  const g = globalThis as Record<string, unknown>;
  if (!g[STATE_KEY]) {
    g[STATE_KEY] = { server: null, boundHost: null, starting: null, byToken: new Map(), tokenBySession: new Map() } as ProxyState;
  }
  return g[STATE_KEY] as ProxyState;
}

/** 发现 vmnet 网关(宿主在 vmnet 接口上的 IP,即 guest 的默认网关)。 */
export function discoverGatewayIp(): string {
  const ifaces = os.networkInterfaces();
  for (const addrs of Object.values(ifaces)) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal && a.address.startsWith(VMNET_PREFIX)) return a.address;
    }
  }
  return VMNET_PREFIX + '1'; // 回退默认网关
}

function isFromVmnet(remoteAddr: string | undefined): boolean {
  if (!remoteAddr) return false;
  // Node 可能给 ::ffff:192.168.64.x
  const v4 = remoteAddr.replace(/^::ffff:/, '');
  return v4.startsWith(VMNET_PREFIX);
}

/** 起代理(幂等)。绑 vmnet 网关 IP;失败回退 0.0.0.0(靠来源 IP+token 兜底)。返回绑定的 host。 */
export function ensureProxyRunning(): Promise<string> {
  const s = state();
  if (s.server && s.boundHost) return Promise.resolve(s.boundHost);
  if (s.starting) return s.starting;

  s.starting = new Promise<string>((resolve, reject) => {
    const server = http.createServer(handleRequest);
    const gw = discoverGatewayIp();
    const bind = (host: string, isFallback: boolean) => {
      server.once('error', (err: NodeJS.ErrnoException) => {
        if (!isFallback) {
          console.warn(`[cowork-proxy] bind ${host}:${PROXY_PORT} failed (${err.code}), retrying 0.0.0.0`);
          bind('0.0.0.0', true);
        } else {
          s.starting = null;
          reject(err);
        }
      });
      server.listen(PROXY_PORT, host, () => {
        s.server = server;
        s.boundHost = host;
        s.starting = null;
        console.log(`[cowork-proxy] listening on ${host}:${PROXY_PORT} (credential injection; real keys never leave host)`);
        resolve(host);
      });
    };
    bind(gw, false);
  });
  return s.starting;
}

/**
 * 为会话签发一次性 token 并登记真凭证(幂等:同会话复用同 token)。
 * 返回给 claude 用的 { token, baseUrl }。真凭证只进内存 Map。
 */
export function registerSession(sessionId: string, cred: Omit<SessionCred, 'sessionId'>): { token: string; baseUrl: string } {
  const s = state();
  let token = s.tokenBySession.get(sessionId);
  if (token) {
    s.byToken.set(token, { sessionId, ...cred }); // 刷新凭证(可能换模型/provider)
  } else {
    token = 'cwk_' + crypto.randomBytes(24).toString('hex');
    s.tokenBySession.set(sessionId, token);
    s.byToken.set(token, { sessionId, ...cred });
  }
  const host = s.boundHost && s.boundHost !== '0.0.0.0' ? s.boundHost : discoverGatewayIp();
  void import('./cowork-audit').then((m) => m.audit('cred_issued', { sessionId })); // P3-C 安全审计
  return { token, baseUrl: `http://${host}:${PROXY_PORT}` };
}

/** 废止会话 token(会话删除时调;VM 攻陷拿到的 token 从此失效)。 */
export function revokeSession(sessionId: string): void {
  const s = state();
  const token = s.tokenBySession.get(sessionId);
  if (token) {
    s.byToken.delete(token);
    s.tokenBySession.delete(sessionId);
    void import('./cowork-audit').then((m) => m.audit('cred_revoked', { sessionId }));
  }
}

function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  const s = state();
  // ① 来源必须是 vmnet 网段(绑网关 IP 已限接口,这是纵深)
  if (!isFromVmnet(req.socket.remoteAddress)) {
    res.writeHead(403); res.end('forbidden'); return;
  }
  // ② 校验一次性 token(x-api-key 或 Authorization: Bearer)
  const xApiKey = req.headers['x-api-key'];
  const auth = req.headers['authorization'];
  const presented = (typeof xApiKey === 'string' && xApiKey)
    || (typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7) : '');
  const cred = presented ? s.byToken.get(presented) : undefined;
  if (!cred) {
    // claude 会发个别无 auth 的预检请求 → 401,它容错重试(P3-B-0 已验)
    res.writeHead(401); res.end('invalid or missing one-shot token'); return;
  }

  // ③ 剥一次性 token,注入真凭证,转发真 base_url
  const target = new URL(req.url || '/', cred.realBase);
  const headers: Record<string, string | string[]> = { ...req.headers } as Record<string, string | string[]>;
  delete headers['x-api-key'];
  delete headers['authorization'];
  if (cred.authStyle === 'auth_token') headers['authorization'] = `Bearer ${cred.realKey}`;
  else headers['x-api-key'] = cred.realKey;
  headers['host'] = target.host;

  const upstream = https.request(
    { hostname: target.hostname, port: 443, path: target.pathname + target.search, method: req.method, headers },
    (pres) => { res.writeHead(pres.statusCode || 502, pres.headers); pres.pipe(res); }, // SSE 流式回传
  );
  upstream.on('error', (e) => {
    console.error('[cowork-proxy] upstream error:', e.message);
    if (!res.headersSent) res.writeHead(502);
    res.end();
  });
  req.pipe(upstream);
}
