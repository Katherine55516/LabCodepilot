/**
 * secret-key.ts — 主密钥（master key）生命周期，凭证本地加密的信任根。
 *
 * 一把 32 字节随机主密钥，用 Electron safeStorage 封存到磁盘：
 *   ~/.codepilot/secret.key.enc
 * （放数据目录根，**不放 anlcode/**——它必须在登出/clearAll 清空 anlcode 后存活，
 *   且它还保护 local BYOK key，与 managed 登录解耦。）
 *
 * safeStorage 后端：Windows=DPAPI（绑当前用户 SID）、macOS=Keychain、
 * Linux=libsecret/kwallet（缺失则退化 basic_text，仅混淆非真加密 → 打 WARN）。
 *
 * 主进程在 app.whenReady 后调 initMasterKey() 解封（或首次生成），并把明文主密钥
 * 的 hex 写入 process.env.CLAUDE_GUI_SECRET_KEY：
 *   - 供主进程自己的 encryptedStorage.ts（经 crypto-seal.getKey()）读取；
 *   - 经 getMasterKeyHex() 显式注入到 Next.js server 子进程 env（safeStorage 在
 *     utilityProcess 不可用，server 只能拿现成 key）。
 *
 * 跨机迁移 / 重装系统 / keychain 重置会让旧密钥解封失败：此时旋转出一把新密钥，
 * 旧密文 → fail-safe（managed 重新登录重灌，local BYOK 需重输）。这是预期行为。
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { safeStorage } from 'electron';
import { getDataDir } from './paths';
import { logInfo, logWarn } from './log';

const ENV_KEY = 'CLAUDE_GUI_SECRET_KEY';
let masterKey: Buffer | null | undefined; // undefined=未初始化, null=无加密能力

function secretKeyPath(): string {
  return path.join(getDataDir(), 'secret.key.enc');
}

/** 设定主密钥并同步到 process.env，供本进程 crypto-seal.getKey() 读取。 */
function setMasterKey(key: Buffer | null): void {
  masterKey = key;
  process.env[ENV_KEY] = key ? key.toString('hex') : '';
}

export interface SafeStorageStatus {
  available: boolean;
  backend: string;
  encrypts: boolean;
}

/** 诊断当前平台 safeStorage 是否真加密。Win/Mac 恒 true；Linux 可能 basic_text。 */
export function getSafeStorageStatus(): SafeStorageStatus {
  let available = false;
  try {
    available = safeStorage.isEncryptionAvailable();
  } catch {
    /* app 未就绪等极端情况 */
  }
  let backend = 'unknown';
  try {
    const fn = (safeStorage as unknown as { getSelectedStorageBackend?: () => string })
      .getSelectedStorageBackend;
    if (typeof fn === 'function') backend = fn.call(safeStorage) || 'unknown';
  } catch {
    /* ignore — 非 Linux 平台无此方法 */
  }
  return { available, backend, encrypts: available && backend !== 'basic_text' };
}

/**
 * 解封已有主密钥，或首次生成并封存。幂等——重复调用是 no-op。
 * 必须在 app.whenReady 之后、且 startServer fork 之前调用。
 */
export function initMasterKey(): void {
  if (masterKey !== undefined) return;

  const file = secretKeyPath();

  // 1) 尝试解封已有密钥
  try {
    const buf = fs.readFileSync(file);
    if (buf.length > 0) {
      const hex = safeStorage.decryptString(buf).trim();
      if (/^[0-9a-fA-F]{64}$/.test(hex)) {
        setMasterKey(Buffer.from(hex, 'hex'));
        return;
      }
      logWarn('[secret-key] secret.key.enc 内容非法，将旋转新密钥');
    }
  } catch (e) {
    // 文件不存在 → 首次；解封失败 → 跨机/重装，旋转新密钥（旧密文走 fail-safe）
    if (fs.existsSync(file)) {
      logWarn('[secret-key] 主密钥解封失败（跨机迁移/重装？），旋转新密钥:', (e as Error).message);
    }
  }

  // 2) 生成新密钥并封存
  try {
    if (!safeStorage.isEncryptionAvailable()) {
      logWarn('[secret-key] safeStorage 不可用，凭证将以明文落盘（Linux 需装 libsecret-tools）');
      setMasterKey(null);
      return;
    }
    const key = crypto.randomBytes(32);
    const blob = safeStorage.encryptString(key.toString('hex'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, blob);
    try {
      fs.chmodSync(file, 0o600);
    } catch {
      /* Windows: chmod 为 no-op */
    }
    setMasterKey(key);
  } catch (e) {
    logWarn('[secret-key] 主密钥封存失败，凭证将以明文落盘:', (e as Error).message);
    setMasterKey(null);
  }
}

/** 注入到 server 子进程 env 的 hex。无密钥时返回 ''（server 侧据此透明直通）。 */
export function getMasterKeyHex(): string {
  return masterKey ? masterKey.toString('hex') : '';
}

/** 启动时打一行 safeStorage 状态日志，便于运维/自检确认加密是否生效。 */
export function logSafeStorageStatus(): void {
  try {
    const s = getSafeStorageStatus();
    logInfo(`[safe-storage] available=${s.available} backend=${s.backend} encrypts=${s.encrypts}`);
    if (s.available && !s.encrypts) {
      logWarn('[safe-storage] backend=basic_text 不真加密，凭证仍近似明文持久化');
    }
  } catch (e) {
    logWarn('[safe-storage] 状态检测失败:', (e as Error).message);
  }
}
