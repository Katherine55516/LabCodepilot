/**
 * File-based persistence for the managed-account login system.
 *
 * All state lives under {dataDir}/anlcode/. Token file gets chmod 0600 on
 * Unix; chmodSync errors are swallowed on Windows where the call is a no-op.
 *
 * Token is NEVER stored in SQLite — deliberate divergence from the OpenAI
 * OAuth module (which stores tokens in the settings table) to keep the two
 * systems isolated and to make cross-process sharing (main + Next.js
 * standalone server) trivial via the filesystem.
 *
 * 敏感文件加密：session_token / configs.json 经 crypto-seal（safeStorage 主密钥
 * + AES-256-GCM）加密落盘，read 时静默迁移老明文、解密失败 fail-safe 返回 null。
 * device_id / configs.hash / selected_config_id 无敏感，保持明文。详见
 * docs/handover/credential-encryption.md。
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import { anlcodePath, getAnlcodeDir } from './paths';
import type { CoworkRemoteConfig, ImageProviderConfig, ModelConfig } from './types';
import { logWarn } from './log';
import { seal, open, isSealed, getKey } from './crypto-seal';

function safeUnlink(file: string): void {
  try {
    fs.unlinkSync(file);
  } catch {
    /* missing file is fine */
  }
}

// ── Token ────────────────────────────────────────────────────────────────────

export function saveToken(token: string): void {
  const file = anlcodePath('sessionToken');
  // 敏感：safeStorage 主密钥 + AES-256-GCM 加密落盘（无密钥时透明明文，见 crypto-seal）。
  fs.writeFileSync(file, seal(token, getKey()), 'utf-8');
  try {
    fs.chmodSync(file, 0o600);
  } catch (err) {
    // Windows: chmod is a no-op; do not surface as an error.
    if (process.platform !== 'win32') {
      logWarn('chmod 0600 failed on session_token:', err);
    }
  }
}

export function loadToken(): string | null {
  try {
    const raw = fs.readFileSync(anlcodePath('sessionToken'), 'utf-8').trim();
    const key = getKey();
    const token = open(raw, key).trim();
    if (!token) return null; // 解密失败 → null，触发重新登录（绝不返回密文）
    // 静默迁移：磁盘上是老明文且当前有密钥 → 机会性重写为密文
    if (key && !isSealed(raw)) {
      try { saveToken(token); } catch { /* best effort */ }
    }
    return token;
  } catch {
    return null;
  }
}

export function clearToken(): void {
  safeUnlink(anlcodePath('sessionToken'));
}

// ── Device ID ────────────────────────────────────────────────────────────────

export function getOrCreateDeviceId(): string {
  const file = anlcodePath('deviceId');
  try {
    const existing = fs.readFileSync(file, 'utf-8').trim();
    if (existing) return existing;
  } catch {
    /* fall through and create */
  }
  const id = crypto.randomUUID();
  fs.writeFileSync(file, id, 'utf-8');
  return id;
}

// ── Configs ──────────────────────────────────────────────────────────────────

export function saveConfigs(configs: ModelConfig[], hash: string): void {
  // configs 每条含 auth_token + base_url，整体加密落盘。
  fs.writeFileSync(anlcodePath('configs'), seal(JSON.stringify(configs), getKey()), 'utf-8');
  // hash 是 ETag，无敏感，保持明文，便于不解密即可做缓存比对。
  fs.writeFileSync(anlcodePath('configsHash'), hash, 'utf-8');
}

export function loadConfigs(): ModelConfig[] | null {
  try {
    const raw = fs.readFileSync(anlcodePath('configs'), 'utf-8').trim();
    const key = getKey();
    const json = open(raw, key);
    if (!json) return null; // 解密失败/空 → 触发重新拉取
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return null;
    // 静默迁移：老明文 → 重写为密文
    if (key && !isSealed(raw)) {
      try { saveConfigs(parsed as ModelConfig[], loadConfigsHash() ?? ''); } catch { /* best effort */ }
    }
    return parsed as ModelConfig[];
  } catch {
    return null;
  }
}

export function loadConfigsHash(): string | null {
  try {
    const raw = fs.readFileSync(anlcodePath('configsHash'), 'utf-8').trim();
    return raw || null;
  } catch {
    return null;
  }
}

// ── Image config (文生图凭证下发离线缓存) ─────────────────────────────────────

/**
 * 缓存下发的百炼文生图配置。含 apiKey（明文，已在 client 解密），整体 crypto-seal
 * 加密落盘。供网络失败时降级使用（同 configs 的离线策略）。
 */
export function saveImageConfig(cfg: ImageProviderConfig): void {
  fs.writeFileSync(anlcodePath('imageConfig'), seal(JSON.stringify(cfg), getKey()), 'utf-8');
}

export function loadImageConfig(): ImageProviderConfig | null {
  try {
    const raw = fs.readFileSync(anlcodePath('imageConfig'), 'utf-8').trim();
    const key = getKey();
    const json = open(raw, key);
    if (!json) return null; // 解密失败/空 → 触发重新拉取
    const parsed = JSON.parse(json) as ImageProviderConfig;
    if (!parsed || typeof parsed !== 'object') return null;
    // 静默迁移：老明文 → 重写为密文
    if (key && !isSealed(raw)) {
      try { saveImageConfig(parsed); } catch { /* best effort */ }
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearImageConfig(): void {
  safeUnlink(anlcodePath('imageConfig'));
}

// ── Cowork config (办公沙箱配置下发离线缓存,R5-5) ───────────────────────────

/** 缓存下发的 cowork 配置(token 已解密,整体 crypto-seal 加密落盘;断网降级用)。 */
export function saveCoworkConfig(cfg: CoworkRemoteConfig): void {
  fs.writeFileSync(anlcodePath('coworkConfig'), seal(JSON.stringify(cfg), getKey()), 'utf-8');
}

export function loadCoworkConfig(): CoworkRemoteConfig | null {
  try {
    const raw = fs.readFileSync(anlcodePath('coworkConfig'), 'utf-8').trim();
    const key = getKey();
    const json = open(raw, key);
    if (!json) return null;
    const parsed = JSON.parse(json) as CoworkRemoteConfig;
    if (!parsed || typeof parsed !== 'object') return null;
    if (key && !isSealed(raw)) {
      try { saveCoworkConfig(parsed); } catch { /* best effort */ }
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearCoworkConfig(): void {
  safeUnlink(anlcodePath('coworkConfig'));
}

// ── Selected Config ──────────────────────────────────────────────────────────

export function saveSelectedConfigId(id: string): void {
  fs.writeFileSync(anlcodePath('selectedConfigId'), id, 'utf-8');
}

export function loadSelectedConfigId(): string | null {
  try {
    const raw = fs.readFileSync(anlcodePath('selectedConfigId'), 'utf-8').trim();
    return raw || null;
  } catch {
    return null;
  }
}

export function clearSelectedConfigId(): void {
  safeUnlink(anlcodePath('selectedConfigId'));
}

// ── Test-usage upload watermark ───────────────────────────────────────────────

/**
 * 测试用量上报的水位：已成功上报到的北京自然日（'YYYY-MM-DD'）。无敏感，明文。
 * 读不到 → null（首次上报，回退到近 N 天）。离线期间不推进，下次在线自动回补。
 */
export function loadTestUsageWatermark(): string | null {
  try {
    const raw = fs.readFileSync(anlcodePath('testUsageWatermark'), 'utf-8').trim();
    return raw || null;
  } catch {
    return null;
  }
}

export function saveTestUsageWatermark(date: string): void {
  fs.writeFileSync(anlcodePath('testUsageWatermark'), date, 'utf-8');
}

// ── Cleanup paths ────────────────────────────────────────────────────────────

/**
 * Logout-time cleanup. Removes the bearer token + the user's "currently
 * selected managed config" pointer. Keeps device_id (so the server still
 * recognises this machine on next login) and configs.json (so a re-login
 * can hit the cache before the network round-trip finishes).
 */
export function clearAuthState(): void {
  clearToken();
  clearSelectedConfigId();
}

/** Nuclear option: clear the entire anlcode/ dir. Reserved for explicit reset. */
export function clearAll(): void {
  try {
    fs.rmSync(getAnlcodeDir(), { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}
