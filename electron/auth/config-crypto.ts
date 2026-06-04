/**
 * 解密服务器下发的「加密版配置」(GET /api/v1/configs/encrypted)里的 auth_token。
 *
 * 算法见 文档/config-delivery-api.md §4:
 *   - AES-256-GCM,key = SHA-256(UTF-8(口令)) → 32 字节
 *   - 密文 base64 解码后 = nonce(12B) ‖ ciphertext ‖ tag(16B),无 AAD
 *   - 空 key 时 auth_token 为空字符串,不加密
 *
 * 口令:默认 'ZJH2026',支持环境变量 ANLCODE_CONFIG_SECRET 覆盖(与 config.ts
 * 的 BACKEND_BASE「硬编码默认 + env 覆盖」模式一致,正式打包可注入不同口令)。
 *
 * 注意:这是「下发/传输」层解密——与本地 crypto-seal 落盘加密正交。解出的明文
 * auth_token 仍会经 storage.saveConfigs → crypto-seal 加密落盘。
 *
 * 安全:对称口令经 SHA-256(未加盐)派生,口令会进 bundle、逆向可提取;仅适合
 * 受控场景。更强隔离需服务器侧改每用户密钥 / 加盐 KDF。
 */

import * as crypto from 'crypto';
import type { ModelConfig } from './types';
import { logWarn } from './log';

const DEFAULT_PASSPHRASE = 'ZJH2026';
const NONCE_LEN = 12;
const TAG_LEN = 16;

let cachedPassphrase: string | undefined;
let cachedKey: Buffer | null = null;

/** SHA-256(口令) → 32B AES key;仅在口令(env)变化时重算。 */
function deriveKey(): Buffer {
  const passphrase = process.env.ANLCODE_CONFIG_SECRET?.trim() || DEFAULT_PASSPHRASE;
  if (passphrase !== cachedPassphrase) {
    cachedPassphrase = passphrase;
    cachedKey = crypto.createHash('sha256').update(passphrase, 'utf8').digest();
  }
  return cachedKey!;
}

/**
 * 解密单个 auth_token 密文(base64)。空串原样返回(空 key 不加密)。
 * 密文损坏 / 截断 / 口令不符 → 抛错,由调用方决定 fail-safe。
 */
export function decryptAuthToken(blobB64: string): string {
  if (!blobB64) return '';
  const key = deriveKey();
  const raw = Buffer.from(blobB64, 'base64');
  if (raw.length < NONCE_LEN + TAG_LEN) {
    throw new Error(`ciphertext too short: ${raw.length}B (need >= ${NONCE_LEN + TAG_LEN})`);
  }
  const nonce = raw.subarray(0, NONCE_LEN);
  const tag = raw.subarray(raw.length - TAG_LEN);
  const ciphertext = raw.subarray(NONCE_LEN, raw.length - TAG_LEN);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/**
 * 逐条解密配置的 auth_token,返回明文配置数组。
 * 单条失败 → 置 '' + warn(fail-safe:该条降级为无凭证,不 crash、不影响其他条);
 * 空串跳过。口令整体配错会表现为大量 warn + 该用户 managed 配置全无凭证。
 */
export function decryptConfigAuthTokens(configs: ModelConfig[]): ModelConfig[] {
  let failures = 0;
  const out = configs.map((c) => {
    if (!c.auth_token) return c;
    try {
      return { ...c, auth_token: decryptAuthToken(c.auth_token) };
    } catch (e) {
      failures++;
      logWarn(
        `[config-crypto] decrypt auth_token failed for config ${c.id} (${c.name}); treating as no-key:`,
        (e as Error).message,
      );
      return { ...c, auth_token: '' };
    }
  });
  if (failures > 0) {
    logWarn(
      `[config-crypto] ${failures}/${configs.length} auth_token(s) failed to decrypt — ` +
        'check ANLCODE_CONFIG_SECRET / server passphrase',
    );
  }
  return out;
}
