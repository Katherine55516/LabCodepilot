/**
 * Platform / arch / channel resolution for the research-platform V2 updates API.
 *
 * Maps Electron's process.platform/arch onto the values the V2 API expects
 * (see 文档/updates-v2-api.md §3). Decisions (exec-plan updates-v2-migration):
 *   - 只服务 windows-x64 与 darwin-arm64（Intel mac 不考虑）
 *   - channel 固定 stable
 *   - current = app.getVersion()，须与服务端录入版本号字符串完全一致
 */

import { app } from 'electron';

export type UpdatePlatform = 'windows' | 'darwin';
export type UpdateArch = 'x64' | 'arm64';

export interface UpdateQueryParams {
  platform: UpdatePlatform;
  arch: UpdateArch;
  channel: string;
  current: string;
}

/** V2 release channel — fixed to stable for now (decision #4). */
export const UPDATE_CHANNEL = 'stable';

/** Map process.platform → V2 platform. Returns null on unsupported (e.g. linux). */
export function getUpdatePlatform(): UpdatePlatform | null {
  switch (process.platform) {
    case 'win32':
      return 'windows';
    case 'darwin':
      return 'darwin';
    default:
      return null;
  }
}

/**
 * V2 arch. Only x64 / arm64 are valid; default x64.
 * Windows ships x64, macOS ships arm64 (Intel mac not served — decision #3).
 */
export function getUpdateArch(): UpdateArch {
  return process.arch === 'arm64' ? 'arm64' : 'x64';
}

/**
 * Build the V2 /check query params for the current runtime, or null when the
 * platform is unsupported (the caller should treat that as "no update").
 */
export function getUpdateQueryParams(): UpdateQueryParams | null {
  const platform = getUpdatePlatform();
  if (!platform) return null;
  return {
    platform,
    arch: getUpdateArch(),
    channel: UPDATE_CHANNEL,
    current: app.getVersion(),
  };
}
