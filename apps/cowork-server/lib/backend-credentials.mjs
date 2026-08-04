/**
 * 向账号后端直取用户的模型凭证(RD4 方案 C 的沙箱侧半边)。
 *
 * 为什么要有它:定时任务在**没有客户端在场**时也要跑,而真 key 只存在于客户端本地
 * 加密库(safeStorage 主密钥绑机器),沙箱原理上拿不到。于是反向由沙箱凭 uid 取。
 * 取到后立刻喂进 cred-proxy(lib/cred-proxy.mjs 的 registerCredentials)——
 * 那是**唯一登记入口**,真 key 不落宿主盘、不进会话容器。
 *
 * 对端契约:codeagent-server `docs/cowork-internal-credentials-api.md`
 *   GET /api/v1/internal/cowork/model-credentials?uid=&config_id=
 *   Authorization: Bearer <HMAC token, uid=__sandbox__, exp ≤60s>
 *
 * ⚠️ 密钥用 COWORK_INTERNAL_SECRET,**不是** COWORK_AUTH_SECRET。两者刻意分开:
 * 后者就存在本机,而本机是跑不可信 agent 代码的沙箱;同值会让「攻破沙箱」从
 * 「冒充用户访问沙箱」升级为「批量导出全体用户模型 key」。别图省事合并。
 *
 * env:
 *   COWORK_BACKEND_URL       账号后端根地址,如 https://api.example.com
 *   COWORK_INTERNAL_SECRET   内部接口密钥(与账号后端 APP_COWORK_INTERNAL_SECRET 同值)
 *   COWORK_BACKEND_TIMEOUT_MS 取凭证超时,默认 10s
 */
import { signToken } from './authz.mjs';

const BACKEND_URL = (process.env.COWORK_BACKEND_URL || '').replace(/\/+$/, '');
const INTERNAL_SECRET = process.env.COWORK_INTERNAL_SECRET || '';
const TIMEOUT_MS = parseInt(process.env.COWORK_BACKEND_TIMEOUT_MS || '10000', 10);

/** 账号后端认的保留身份。用户 uid 恒为 UUID,不可能碰撞。 */
export const SANDBOX_UID = '__sandbox__';
/** 签发 TTL。账号后端会校验 exp 的**上界** ≤60s,签长了会被拒。 */
const TOKEN_TTL_SEC = 30;

export const backendConfigured = !!(BACKEND_URL && INTERNAL_SECRET);

/** 带 reason 的错误,便于 runner 把失败归类进运行记录(而不是笼统"取凭证失败")。 */
export class CredentialError extends Error {
  constructor(reason, message) {
    super(message);
    this.name = 'CredentialError';
    this.reason = reason;
  }
}

export function signInternalToken(secret = INTERNAL_SECRET) {
  if (!secret) throw new CredentialError('not_configured', 'COWORK_INTERNAL_SECRET 未配置');
  return signToken(SANDBOX_UID, secret, TOKEN_TTL_SEC);
}

/**
 * 取某用户的模型凭证。成功返回 { realKey, realBase, authStyle, configId, configName,
 * defaultModels, effortLevel };失败抛 CredentialError(带 reason)。
 *
 * ⚠️ **返回值含真 key —— 调用方拿到后应尽快交给 registerCredentials 并丢弃引用,
 * 绝不要 log 它、绝不要放进任何会被写盘的结构。**
 */
export async function fetchModelCredentials(uid, { configId } = {}) {
  if (!backendConfigured) {
    throw new CredentialError('not_configured', 'COWORK_BACKEND_URL / COWORK_INTERNAL_SECRET 未配置');
  }
  const qs = new URLSearchParams({ uid });
  if (configId) qs.set('config_id', configId);
  const url = `${BACKEND_URL}/api/v1/internal/cowork/model-credentials?${qs}`;

  let res;
  try {
    res = await fetch(url, {
      headers: { authorization: `Bearer ${signInternalToken()}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    // 网络/超时 —— 与"后端明确拒绝"分开归类,运维排查方向完全不同
    throw new CredentialError('backend_unreachable', String(e?.message || e));
  }

  if (res.status === 404) {
    // 账号后端刻意不区分"未开通/密钥错/用户不存在/无配置",这里也只能笼统归类。
    // 排查顺序见 docs/cowork-internal-credentials-api.md §6。
    throw new CredentialError('not_provisioned', '后端 404(未开通 / 密钥不符 / 该用户无可用配置)');
  }
  if (res.status === 409) {
    throw new CredentialError('newapi_user_missing', '该用户在 new-api 尚未建号');
  }
  if (res.status === 429) {
    throw new CredentialError('rate_limited', '账号后端频控');
  }
  if (!res.ok) {
    throw new CredentialError('backend_error', `后端返回 ${res.status}`);
  }

  let body;
  try {
    body = await res.json();
  } catch {
    throw new CredentialError('backend_error', '后端响应不是合法 JSON');
  }
  if (!body?.base_url || !body?.auth_token) {
    // 空 key 不能当成功往下走:塞进容器只会触发 401 重试风暴,白烧三分钟(P0 实测 181s)。
    throw new CredentialError('backend_error', '后端响应缺 base_url / auth_token');
  }

  return {
    realBase: String(body.base_url),
    realKey: String(body.auth_token),
    // 默认 api_key:managed 配置在客户端经 inferAuthStyleFromLegacy 落的就是这个分支
    // (注入 x-api-key)。后端可由配置的 extra.auth_style 覆盖。
    authStyle: body.auth_style === 'auth_token' ? 'auth_token' : 'api_key',
    configId: body.config_id ? String(body.config_id) : '',
    configName: body.config_name ? String(body.config_name) : '',
    defaultModels: body.default_models || {},
    effortLevel: body.effort_level ? String(body.effort_level) : '',
  };
}

export const _internals = { BACKEND_URL, TOKEN_TTL_SEC, TIMEOUT_MS };
