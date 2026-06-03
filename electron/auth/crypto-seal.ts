/**
 * crypto-seal — 对称加密原语（Electron 主进程侧镜像）。
 *
 * 与 src/lib/crypto-seal.ts 内容镜像（刻意重复、不跨 electron/<->src 边界互引，
 * 沿用 paths.ts 的约定）。两侧 seal/open/isSealed/getKey 逐字一致，保证产出的
 * "enc:v1:" 密文可互相解密。
 *
 * 主密钥来源统一为环境变量 CLAUDE_GUI_SECRET_KEY：
 *   - 主进程侧：secret-key.ts 的 initMasterKey() 解封后写入 process.env；
 *   - server 侧：Electron fork 时注入。
 * 这样 encryptedStorage.ts / db.ts 都只依赖 crypto-seal（无 electron 依赖），
 * 可在 tsx 测试里通过设置该 env 跑真加密。
 *
 * 格式：密文 = "enc:v1:" + base64(iv[12] ‖ authTag[16] ‖ ciphertext)，AES-256-GCM。
 * fail-safe：密文但无 key / GCM 校验失败 → 返回 ''，绝不把密文当明文返回。
 */

import * as crypto from 'crypto';

const MAGIC = 'enc:v1:';
const IV_LEN = 12;
const TAG_LEN = 16;

let warned = false;
function warnOnce(reason: string): void {
  if (warned) return;
  warned = true;
  console.warn(`[crypto-seal] decrypt fail-safe engaged (${reason}); returning empty`);
}

/** 是否为本模块产出的密文（用于幂等重封迁移的探测）。 */
export function isSealed(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith(MAGIC);
}

/** 加密。无 key 或空串 → 原样返回（透明直通）。 */
export function seal(plaintext: string, key: Buffer | null): string {
  if (!key || plaintext === '') return plaintext;
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return MAGIC + Buffer.concat([iv, tag, ct]).toString('base64');
}

/**
 * 解密。非密文 → 老明文原样返回（静默迁移探测器）。
 * 密文但无 key / 损坏 / 篡改 → '' + 告警一次。永不返回密文当明文。
 */
export function open(value: string, key: Buffer | null): string {
  if (typeof value !== 'string' || !value.startsWith(MAGIC)) return value;
  if (!key) {
    warnOnce('no key');
    return '';
  }
  try {
    const raw = Buffer.from(value.slice(MAGIC.length), 'base64');
    const iv = raw.subarray(0, IV_LEN);
    const tag = raw.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const ct = raw.subarray(IV_LEN + TAG_LEN);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(ct, undefined, 'utf8') + decipher.final('utf8');
  } catch {
    warnOnce('gcm verify failed');
    return '';
  }
}

// ── 主密钥来源 ─────────────────────────────────────────────────────────────

let cachedHex: string | undefined;
let cachedKey: Buffer | null = null;

/**
 * 从 CLAUDE_GUI_SECRET_KEY（64 位 hex）解析主密钥；缺失/格式错 → null。
 * 主进程侧由 initMasterKey() 写入该 env；缺失时（safeStorage 不可用）seal/open 直通。
 * 仅当 env 值变化时重新解析。
 */
export function getKey(): Buffer | null {
  const hex = process.env.CLAUDE_GUI_SECRET_KEY;
  if (hex !== cachedHex) {
    cachedHex = hex;
    cachedKey = hex && /^[0-9a-fA-F]{64}$/.test(hex) ? Buffer.from(hex, 'hex') : null;
  }
  return cachedKey;
}
