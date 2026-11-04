/**
 * Cowork 远程沙箱配置(R5-5 账号下发)—— settings 三键的唯一自动写入口。
 *
 * 账号后端按当前用户签发 { serverUrl, token },Electron 主进程登录后拉取
 * (electron/auth/client.ts fetchCoworkConfig),经 /api/auth/cowork-config/sync
 * 推到本模块落库:
 *   cowork_remote_url   — cowork-server 地址(https 时 forwarder 自动走 wss)
 *   cowork_remote_token — 用户 HMAC token(db.ts SENSITIVE_SETTINGS → 密封落盘)
 *   cowork_backend      — 'remote'(getCoworkBackend 据此选远程实现)
 *
 * clear(登出/401)三键置空 → cowork_backend '' 回落 vfkit 默认,办公模式按
 * cowork_status gate 诚实降级(RD5)。注意 404「未开通/后端未上线」由主进程侧
 * 跳过、**不会**调 clear —— R1 起 dev 手写三键的联调后门因此不受登录轮询打扰。
 * 读侧(cowork-backend-remote.ts)零改动。
 */
import { setSetting } from './db';

export interface CoworkRemoteSettings {
  serverUrl: string;
  token: string;
}

/** 校验并写入三键(下发即切 remote)。serverUrl 非法 / 任一为空 → 抛出(route 转 400)。 */
export function setCoworkRemoteConfig(cfg: Partial<CoworkRemoteSettings>): void {
  const serverUrl = (cfg.serverUrl || '').trim();
  const token = (cfg.token || '').trim();
  if (!serverUrl || !token) throw new Error('serverUrl and token are both required');
  new URL(serverUrl); // 非法 URL 在此抛出,绝不落半截配置
  setSetting('cowork_remote_url', serverUrl);
  setSetting('cowork_remote_token', token);
  setSetting('cowork_backend', 'remote');
}

/** 登出/401:三键置空(与 image-config 同语义,置空不删行)。 */
export function clearCoworkRemoteConfig(): void {
  setSetting('cowork_remote_url', '');
  setSetting('cowork_remote_token', '');
  setSetting('cowork_backend', '');
}
