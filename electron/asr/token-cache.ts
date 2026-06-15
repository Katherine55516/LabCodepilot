import { fetchAsrToken } from '../auth/client';

let cached: { token: string; expiresAt: number } | null = null;
// 距过期 <120s 就提前换，留出握手 + 时钟偏差余量
const REFRESH_MARGIN_S = 120;

/** 拿一个有效临时 token：命中缓存直接返回，否则向服务器换新。 */
export async function getAsrToken(): Promise<string> {
  const now = Date.now() / 1000;
  if (cached && cached.expiresAt - now > REFRESH_MARGIN_S) {
    return cached.token;
  }
  const fresh = await fetchAsrToken(); // { token, expiresAt }
  cached = fresh;
  return fresh.token;
}

/** 握手被拒（401）时清缓存，下次强制换新。 */
export function invalidateAsrToken(): void {
  cached = null;
}
