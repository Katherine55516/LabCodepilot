/**
 * Type definitions for the managed-account login system.
 *
 * Strictly isolated from the OpenAI OAuth module (src/lib/openai-oauth.ts) —
 * naming, storage, and concepts must NOT cross-reference.
 */

// ── Server-pushed model config (one item from /api/v1/configs) ─────────────

export interface ModelConfig {
  /** UUID — the server-side stable id, used as upsert key */
  id: string;
  /** Display name (e.g. "Claude 4.7 Sonnet") */
  name: string;
  /** Short description (may be empty) */
  description: string;
  /** API base URL for this model */
  base_url: string;
  /** API key for this model (treat as secret — mask in logs) */
  auth_token: string;
  /** Model id (e.g. "claude-sonnet-4.7") */
  model: string;
  /** Substitute model when the user picks "opus" */
  default_opus_model: string;
  /** Substitute model when the user picks "sonnet" */
  default_sonnet_model: string;
  /** Substitute model when the user picks "haiku" */
  default_haiku_model: string;
  /** Default model for subagents */
  subagent_model: string;
  /** Effort level: "low" | "medium" | "high" | "xhigh" */
  effort_level: string;
  /** Server-side free-form extension fields */
  extra: Record<string, unknown>;
  /** Sort key — smaller comes first; 0 is the default */
  sort_order: number;
}

// ── /api/v1/usage response ─────────────────────────────────────────────────

export interface UsageQuota {
  /** 本期总额度(周期重置时填充) */
  renewal: number;
  /** 当前剩余 */
  remaining: number;
  /** 本期已用 = renewal - remaining */
  used: number;
}

export interface UsageInfo {
  username: string;
  /** 总额度(= 国内 + 国外) */
  quota: UsageQuota;
  /** 国内分项 */
  quota_cn: UsageQuota;
  /** 国外分项 */
  quota_intl: UsageQuota;
  /** 额度→货币换算单位,500000 = $1(本期不展示货币) */
  quota_per_unit: number;
}

// ── /api/v1/image/config response (文生图凭证下发) ───────────────────────────

/** 文生图页可选模型的一项；服务端下发，客户端不硬编码。 */
export interface ImageModelOption {
  /** 模型 id（如 qwen-image-2.0-pro），直接作为生成请求的 model */
  id: string;
  /** 展示名（如「通义万相 2.0 Pro」）；缺省时前端回退用 id */
  label: string;
  /** 是否默认选中（与顶层 model 一致） */
  default?: boolean;
}

/**
 * 百炼文生图配置——本期全局一份，所有登录用户下发相同内容。
 * `/encrypted` 变体里 apiKey 为密文（同 configs 的 auth_token），客户端解密后使用。
 * apiKey 永不出主进程 + 嵌入式 Next 服务，绝不下行 renderer。
 */
export interface ImageProviderConfig {
  /** 百炼 DashScope key（image scope，sk-...）。空串=未配置/未登录 */
  apiKey: string;
  /** 百炼工作空间 id（ws-...），用作端点子域 */
  workspaceId: string;
  /** 默认模型 id */
  model: string;
  /** DashScope MaaS region，如 cn-beijing */
  region: string;
  /** 文生图页可选模型列表 */
  models: ImageModelOption[];
}

/**
 * Cowork 远程沙箱配置(R5-5 账号下发)—— server 地址 + 当前用户的 HMAC token。
 * `/encrypted` 变体里 token 为密文(同 configs 的 auth_token),客户端解密后使用。
 * token 经 broker 推嵌入式 Next 服务密封落库(SENSITIVE settings),不以明文下行 renderer。
 */
export interface CoworkRemoteConfig {
  /** cowork-server 地址,如 https://cowork.example.com(https 时 forwarder 自动走 wss) */
  serverUrl: string;
  /** 当前用户的 HMAC 签名 token(账号后端用与 cowork-server 相同的 COWORK_AUTH_SECRET 签发) */
  token: string;
}

// ── /api/v1/me response ────────────────────────────────────────────────────

export interface MeInfo {
  /**
   * 账号 UUID。服务端 `upsert_from_claims` 用 `UUID(claims.sub)` 建档,所以它**就是**
   * 签发 cowork HMAC token 时用的那个 uid —— 客户端拿它做办公会话归属,与沙箱侧
   * 容器/卷的 `cowork.uid` label 天然对齐。
   */
  id?: string;
  username: string;
  display_name: string;
  email?: string;
  plan?: string;
  config_version?: number;
  [key: string]: unknown;
}

// ── Snapshot pushed to renderer via IPC ─────────────────────────────────────

export interface AuthSnapshotMe {
  username: string;
  display_name: string;
  email?: string;
  plan?: string;
}

export interface AuthSnapshot {
  authenticated: boolean;
  offline: boolean;
  me: AuthSnapshotMe | null;
  managedConfigCount: number;
}

// ── Probe result ────────────────────────────────────────────────────────────

export interface AuthProbeResult {
  /** True when token is usable (including offline-fallback) */
  alive: boolean;
  /** True when probe failed due to network — token kept, degrade gracefully */
  offline: boolean;
}

// ── Custom error types ──────────────────────────────────────────────────────

export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkError';
  }
}

export class AuthExpiredError extends Error {
  constructor(message = 'Token expired or invalid') {
    super(message);
    this.name = 'AuthExpiredError';
  }
}

/**
 * Non-401 HTTP error (>= 400) carrying the status code, so callers can branch
 * on it (e.g. 503 → fall back to the plaintext configs endpoint, 409 → "gateway
 * not provisioned"). Extends Error → backward-compatible with existing
 * `catch (e as Error)` / instanceof NetworkError|AuthExpiredError handlers.
 */
export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}
