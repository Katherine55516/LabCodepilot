/**
 * 脱敏网关(deid-service)服务端客户端 — 仅在 Next 服务端使用。
 *
 * 调用密钥服务端持有(决策 D7),renderer 一律走 /api/deid/* 代理,
 * 不直连脱敏服务、不接触密钥。密钥仅作调用方归因(服务端日志只存
 * SHA-256 短指纹),非高敏凭证,故不进 SENSITIVE_SETTINGS。
 *
 * 目标域名 http://deid-api.ai-native-lab.com 已实测 301 → https,默认直接走 https。
 */

import { getSetting } from '@/lib/db';
import type { DeidDenyValue, DeidImageResponse, DeidReidentifyResponse, DeidTextResponse } from '@/types/deid';

const DEFAULT_BASE_URL = 'https://deid-api.ai-native-lab.com';
const DEFAULT_API_KEY = 'cmwork-desktop';
const TEXT_TIMEOUT_MS = 30_000; // LLM 层实测 ~0.7s,长文本留余量
// 图片管道 = OCR + 视觉 + 渲染,实测 760×300 小图首次 9.5s / 复用 6.1s;
// 大图与冷启动留足余量,超时按 502 归一(fail-closed,不外发原图)。
const IMAGE_TIMEOUT_MS = 120_000;
const REID_TIMEOUT_MS = 15_000;
const META_TIMEOUT_MS = 8_000;
const META_CACHE_TTL_MS = 10 * 60 * 1000;

/** 上游/网络失败。status: 400/401 透传上游语义,其余(含网络失败)归一为 502(契约 §11)。 */
export class DeidServiceError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'DeidServiceError';
    this.status = status === 400 || status === 401 ? status : 502;
  }
}

function baseUrl(): string {
  const fromEnv = process.env.DEID_API_URL;
  let fromSetting = '';
  try {
    fromSetting = getSetting('deid_api_url') || '';
  } catch {
    // DB 不可用时(极早期启动)按默认走
  }
  return (fromEnv || fromSetting || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

function apiKey(): string {
  let fromSetting = '';
  try {
    fromSetting = getSetting('deid_api_key') || '';
  } catch {
    // 同上
  }
  return process.env.DEID_API_KEY || fromSetting || DEFAULT_API_KEY;
}

async function deidFetch<T>(path: string, init: RequestInit, timeoutMs: number): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': apiKey(),
        ...(init.headers || {}),
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    // 网络失败/超时 → 502 语义(脱敏服务暂不可用,内容尚未发送)
    throw new DeidServiceError(502, err instanceof Error ? err.message : 'deid-service unreachable');
  }
  if (!res.ok) {
    let message = `deid-service HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      // body 非 JSON,保留默认 message
    }
    throw new DeidServiceError(res.status, message);
  }
  return (await res.json()) as T;
}

/** POST /v1/deidentify/text — mapping/denyValues 由调用方(路由层)从会话状态取 */
export function deidentifyText(
  text: string,
  mapping: Record<string, string>,
  denyValues: DeidDenyValue[],
): Promise<DeidTextResponse> {
  return deidFetch<DeidTextResponse>(
    '/v1/deidentify/text',
    { method: 'POST', body: JSON.stringify({ text, mapping, denyValues, level: 'high', language: 'zh' }) },
    TEXT_TIMEOUT_MS,
  );
}

/**
 * POST /v1/deidentify/image — 图片脱敏(OCR + 识别 + 打码渲染)。
 * 与文本共用同一本 mapping(契约 §8:跨模态复用占位符,已实测邮箱复用
 * <EMAIL_1>、新手机号顺延 <PHONE_NUMBER_4>)。
 *
 * 走 JSON(imageBase64)而非 multipart:服务端已持有裸 base64
 * (FileAttachment.data),免去构造 FormData 与二次编解码。
 *
 * ⚠️ 返回的 redactedImageBase64 仅作服务端渲染参照;真正外发的图由客户端
 * 从原图 canvas 重绘(契约 §7.2),否则用户取消某区域后无法还原该区域。
 */
export function deidentifyImage(
  imageBase64: string,
  mapping: Record<string, string>,
  denyValues: DeidDenyValue[],
  mode: 'placeholder' | 'fill',
): Promise<DeidImageResponse> {
  return deidFetch<DeidImageResponse>(
    '/v1/deidentify/image',
    { method: 'POST', body: JSON.stringify({ imageBase64, mapping, denyValues, mode }) },
    IMAGE_TIMEOUT_MS,
  );
}

/** POST /v1/reidentify — 占位符还原 + unknownPlaceholders 检测 */
export function reidentifyText(
  text: string,
  mapping: Record<string, string>,
): Promise<DeidReidentifyResponse> {
  return deidFetch<DeidReidentifyResponse>(
    '/v1/reidentify',
    { method: 'POST', body: JSON.stringify({ text, mapping }) },
    REID_TIMEOUT_MS,
  );
}

/**
 * /v1/meta 的 recommendedSystemPrompt 兜底副本(2026-07-31 从真实服务抓取)。
 * meta 不可达时用它,保证脱敏会话的外部模型永远带占位符使用规则(决策 D9)。
 */
export const FALLBACK_RECOMMENDED_SYSTEM_PROMPT = `用户消息中的个人信息已做脱敏处理:真实的姓名、邮箱、电话、地址、证件号等已被替换为形如 <类型_序号> 的占位符,例如 <PERSON_1>、<EMAIL_1>、<PHONE_NUMBER_2>。

严格遵守以下规则:
1. 每个占位符代表该类型的一个具体真实实体——<PERSON_1> 是某个特定的人,<EMAIL_1> 是一个真实邮箱;同一占位符在整个对话中始终指代同一实体。
2. 占位符是不可拆改的整体记号。回复中需要提及对应实体时,必须从对话中原样逐字复制整个占位符,尖括号、大小写、下划线、编号一个字符都不能变。
3. 严禁以任何形式改写占位符,包括:缩写、扩写或改换类型名(例如把 <EMAIL_1> 写成 <EMAIL_ADDRESS_1> 或 <邮箱_1>,或反过来)、翻译类型名、增删尖括号、改动编号,或编造看似真实的姓名/邮箱/电话来代替占位符。
4. 只能使用对话中已经出现过的占位符,不得自行发明新占位符(例如 <日期>、<公司_1>);需要用户补充的信息请用「(请补充)」等中文说明表达。
5. 输出前自查:回复中每一个形如 <...> 的记号,都必须能在之前的对话中找到完全相同的字符串;找不到就说明你改写了它,必须改回原样。
6. 除非用户主动问起,不要解释或评论这些占位符,直接当作真实信息正常回答。`;

let metaCache: { prompt: string; fetchedAt: number } | null = null;

/** 脱敏会话追加给外部模型的系统提示词(meta 内存缓存 10min,失败回落兜底副本,永不 throw) */
export async function getRecommendedSystemPrompt(): Promise<string> {
  if (metaCache && Date.now() - metaCache.fetchedAt < META_CACHE_TTL_MS) {
    return metaCache.prompt;
  }
  try {
    const meta = await deidFetch<{ recommendedSystemPrompt?: string }>('/v1/meta', { method: 'GET' }, META_TIMEOUT_MS);
    const prompt = meta.recommendedSystemPrompt || FALLBACK_RECOMMENDED_SYSTEM_PROMPT;
    metaCache = { prompt, fetchedAt: Date.now() };
    return prompt;
  } catch {
    return FALLBACK_RECOMMENDED_SYSTEM_PROMPT;
  }
}
