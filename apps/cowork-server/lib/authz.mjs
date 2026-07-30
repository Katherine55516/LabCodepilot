/**
 * 多用户认证 / 授权(R4)—— HMAC 签名 token(RD7,用户拍板)。
 *
 * 无状态:token 自带 userId + 签名,server 只需一个共享密钥(COWORK_AUTH_SECRET)
 * 验签取 userId,不存用户表。R5 由账号后端用**同密钥**签发 per-user token(登录后
 * 下发,复刻 image-cred-account-delivery 范式)。
 *
 * token 结构(简化 HS256,不引依赖 —— cowork-server 只依赖 ws):
 *   token = base64url(JSON{uid, exp?}) + "." + base64url(HMAC_SHA256(secret, payload))
 * exp 是可选的 Unix 秒过期时间(R5 账号下发建议带,限制被盗 token 的窗口)。
 *
 * dev 兼容:COWORK_AUTH_SECRET 为空 → authz 关闭,回退 R1-R3 的单用户模式
 * (resolveUser 返回固定 uid '__single__',op 不做 scope 校验)。开启 authz 时,
 * 无效/过期/缺失 token → 401;会话按 uid label 打标,跨 uid 访问 → 404(防枚举)。
 */
import crypto from 'node:crypto';

const SECRET = process.env.COWORK_AUTH_SECRET || '';
const SINGLE_UID = '__single__'; // authz 关闭时的占位 uid(不做 scope)

export const authzEnabled = !!SECRET;

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s) {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}
function hmac(payloadB64, secret) {
  return b64url(crypto.createHmac('sha256', secret).update(payloadB64).digest());
}

/** 签发 token(dev 工具 / 单测用;生产由账号后端做)。ttlSec 省略 = 不过期。 */
export function signToken(uid, secret = SECRET, ttlSec) {
  if (!secret) throw new Error('COWORK_AUTH_SECRET required to sign');
  if (!uid || !/^[a-zA-Z0-9._:-]{1,128}$/.test(uid)) throw new Error('invalid uid');
  const claims = { uid };
  if (ttlSec && ttlSec > 0) claims.exp = Math.floor(Date.now() / 1000) + ttlSec;
  const payload = b64url(JSON.stringify(claims));
  return `${payload}.${hmac(payload, secret)}`;
}

/**
 * 从 Authorization: Bearer <token> 解析并验签,返回 { uid } 或 null。
 * authz 关闭时:恒返回 { uid: SINGLE_UID }(单用户,兼容旧行为)。
 * nowSec 可注入(单测确定性;默认取当前时间)。
 */
export function resolveUser(req, nowSec = Math.floor(Date.now() / 1000)) {
  if (!authzEnabled) return { uid: SINGLE_UID };
  const auth = req.headers?.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const payloadB64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  // 恒定时间比对签名(防时序侧信道)
  const expected = hmac(payloadB64, SECRET);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  let claims;
  try { claims = JSON.parse(b64urlDecode(payloadB64).toString('utf8')); } catch { return null; }
  if (!claims || typeof claims.uid !== 'string' || !claims.uid) return null;
  if (claims.exp && nowSec >= claims.exp) return null; // 过期
  return { uid: claims.uid };
}

/** authz 关闭时的占位 uid(orchestrator 判定"是否 scope"用)。 */
export const singleUid = SINGLE_UID;

export const _internals = { b64url, hmac, SECRET };
