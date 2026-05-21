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
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import { anlcodePath, getAnlcodeDir } from './paths';
import type { ModelConfig } from './types';
import { logWarn } from './log';

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
  fs.writeFileSync(file, token, 'utf-8');
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
    return raw || null;
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
  fs.writeFileSync(anlcodePath('configs'), JSON.stringify(configs, null, 2), 'utf-8');
  fs.writeFileSync(anlcodePath('configsHash'), hash, 'utf-8');
}

export function loadConfigs(): ModelConfig[] | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(anlcodePath('configs'), 'utf-8'));
    return Array.isArray(parsed) ? (parsed as ModelConfig[]) : null;
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
