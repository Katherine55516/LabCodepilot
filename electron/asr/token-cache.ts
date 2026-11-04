import { fetchAsrToken } from '../auth/client';

/** 连接百炼所需配置：临时 token + 服务端下发的模型名/WS 地址。 */
export interface AsrConfig {
  token: string;
  model: string;
  wsUrl: string;
}

let cached: { config: AsrConfig; expiresAt: number } | null = null;
// 距过期 <120s 就提前换，留出握手 + 时钟偏差余量
const REFRESH_MARGIN_S = 120;

/** 拿一份有效配置（token + model + wsUrl）：命中缓存直接返回，否则向服务器换新。 */
export async function getAsrConfig(): Promise<AsrConfig> {
  const now = Date.now() / 1000;
  if (cached && cached.expiresAt - now > REFRESH_MARGIN_S) {
    return cached.config;
  }
  const fresh = await fetchAsrToken(); // { token, expiresAt, model, wsUrl }
  cached = { config: { token: fresh.token, model: fresh.model, wsUrl: fresh.wsUrl }, expiresAt: fresh.expiresAt };
  return cached.config;
}

/** 握手被拒（401）时清缓存，下次强制换新。 */
export function invalidateAsrToken(): void {
  cached = null;
}
