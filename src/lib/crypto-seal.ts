/**
 * crypto-seal — 对称加密原语，用于把敏感凭证以密文落盘。
 *
 * 设计要点（详见 docs/handover/credential-encryption.md）：
 *   - 算法：AES-256-GCM（Node 内置 crypto，零原生依赖）。
 *   - 密钥：一把 32 字节主密钥，由 Electron 主进程用 safeStorage 封存到
 *     ~/.codepilot/secret.key.enc，启动时解封后以 hex 注入到 Next.js
 *     standalone server 的环境变量 CLAUDE_GUI_SECRET_KEY。safeStorage 在
 *     utilityProcess 子进程不可用，故 server 侧只能拿现成的 key（见
 *     electron/auth/secret-key.ts）。
 *   - 格式：密文 = "enc:v1:" + base64(iv[12] ‖ authTag[16] ‖ ciphertext)。
 *   - 静默迁移：open() 遇到不带 "enc:v1:" 前缀的值，视为老明文原样返回。
 *   - fail-safe：密文但无 key / GCM 校验失败 → 返回 ''（触发重新登录/重输），
 *     绝不把密文当明文返回。
 *
 * 这是 electron/auth/crypto-seal.ts 的镜像（内容刻意重复，不跨 electron/<->src
 * 边界互引，沿用 paths.ts 的约定）。核心 seal/open/isSealed 两边保持一致；
 * getKey() 仅本（server 侧）版本需要——它从环境变量取主密钥。
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

/**
 * 加密。无 key（dev / 无 Electron 注入）或空串 → 原样返回（透明直通）。
 * 空串不加密，保留 `api_key != ''` 与脱敏判空等既有语义。
 */
export function seal(plaintext: string, key: Buffer | null): string {
  if (!key || plaintext === '') return plaintext;
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return MAGIC + Buffer.concat([iv, tag, ct]).toString('base64');
}

/**
 * 解密。非密文（无前缀）→ 老明文，原样返回（静默迁移探测器）。
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

// ── 主密钥来源（server 侧）─────────────────────────────────────────────────

let cachedHex: string | undefined;
let cachedKey: Buffer | null = null;

/**
 * 从 CLAUDE_GUI_SECRET_KEY（64 位 hex）解析主密钥；缺失/格式错 → null。
 * 缺失发生在 `npm run dev`（无 Electron 注入）与测试环境，此时 seal/open 透明直通。
 * 仅当 env 值变化时重新解析，测试可中途设置 env 后立即生效。
 */
export function getKey(): Buffer | null {
  const hex = process.env.CLAUDE_GUI_SECRET_KEY;
  if (hex !== cachedHex) {
    cachedHex = hex;
    cachedKey = hex && /^[0-9a-fA-F]{64}$/.test(hex) ? Buffer.from(hex, 'hex') : null;
  }
  return cachedKey;
}
