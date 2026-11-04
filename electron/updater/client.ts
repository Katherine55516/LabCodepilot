/**
 * Research-platform V2 updates API client.
 *
 * Thin wrapper over the managed-account `apiRequest()` (electron/auth/http.ts),
 * which auto-injects the Bearer session token and resolves the same backend
 * base URL used for login / model-config download (electron/auth/config.ts).
 * Mirrors the existing `fetchUsage()` pattern (electron/auth/client.ts).
 *
 * Endpoints: 文档/updates-v2-api.md §4.
 */

import { apiRequest } from '../auth/http';
import type { UpdatePlatform, UpdateQueryParams } from './platform';

/** V2 CheckResult — identical shape for /check and /latest (api doc §5). */
export interface CheckResult {
  /** 是否"有更新"。升级与否以此字段为准（download_url 非空≠要下载）。 */
  has_update: boolean;
  /** 是否强制升级。true 时旧版应被阻断，强制走升级流程。 */
  must_upgrade: boolean;
  /** 最新版本号（如 1.5.1）；无可用版本时 null。 */
  latest_version: string | null;
  /** CDN 安装包直链；客户端直接下载此地址。 */
  download_url: string | null;
  /** 安装包 SHA-256，64 位十六进制；下载后必须校验。 */
  sha256: string | null;
  /** 安装包字节数；用于进度展示与二次校验。 */
  file_size: number | null;
  /** 发布说明（可能为空字符串）。 */
  release_notes: string | null;
  /** 发布时间，ISO 8601 带时区。 */
  released_at: string | null;
}

/**
 * GET /api/v1/updates/v2/check — 传当前版本，判断是否需要升级。
 * Bearer 由 apiRequest 自动注入。失败抛 AuthExpiredError(401) / HttpError(>=400)
 * / NetworkError；由调用方归类。
 */
export async function checkUpdateV2(params: UpdateQueryParams): Promise<CheckResult> {
  const r = await apiRequest<CheckResult>('/api/v1/updates/v2/check', {
    query: {
      platform: params.platform,
      arch: params.arch,
      channel: params.channel,
      current: params.current,
    },
  });
  if (!r.json) throw new Error('/api/v1/updates/v2/check returned empty body');
  return r.json;
}

/**
 * GET /api/v1/updates/v2/latest/{platform} — 无条件取某平台最新版元数据，不比较
 * current。用于"关于页手动检查"。has_update 在"有版本"时恒 true，是否升级需客户端
 * 自行比较 latest_version 与本地版本。
 */
export async function getLatestV2(
  platform: UpdatePlatform,
  arch: string,
  channel: string,
): Promise<CheckResult> {
  const r = await apiRequest<CheckResult>(`/api/v1/updates/v2/latest/${platform}`, {
    query: { arch, channel },
  });
  if (!r.json) throw new Error('/api/v1/updates/v2/latest returned empty body');
  return r.json;
}
