import fs from 'fs';
import path from 'path';
import { sanitizeAccountKey } from '@/lib/test-accounts-export';

/**
 * Resolve a project's test environment for the test workbench.
 *
 * Bridges the colleague's 测试账号设置 (Settings) to the workbench. Two sources,
 * same shape:
 *  - `file`: the exported `{project_root}/AI_LabTest/environments.json` — the exact
 *    contract the AI_LabTest framework consumes (see docs/handover/test-account-settings.md).
 *  - `db`: the live 设置·测试账号 row matched by `project_root` (see env-resolve.ts),
 *    so the user doesn't have to export just to run from the workbench.
 *
 * This module is the PURE (file + fs) half — unit-tested, no DB import. The DB
 * fallback lives in env-resolve.ts (server-only). `.auth/` storageState files are
 * always read off disk (the capture flow writes them regardless of export).
 */

export type EnvConfigSource = 'file' | 'db' | 'none';

export interface ResolvedTestEnv {
  /** A real frontendBaseUrl (not TBD) is available for the chosen env. */
  configured: boolean;
  /** Resolved env key (honors the requested env, else `default`, else first allowed). */
  env: string;
  /** Target frontend base URL, or null when missing / "TBD". */
  frontendBaseUrl: string | null;
  apiBaseUrl: string | null;
  defaultAccount: string | null;
  /** Absolute path to the captured Playwright storageState, if the file exists. */
  storageStatePath: string | null;
  allowedEnvs: string[];
  /** Where the config came from: exported file, live DB, or nothing. */
  source: EnvConfigSource;
}

function emptyResolved(env: string, source: EnvConfigSource): ResolvedTestEnv {
  return {
    configured: false,
    env,
    frontendBaseUrl: null,
    apiBaseUrl: null,
    defaultAccount: null,
    storageStatePath: null,
    allowedEnvs: ['local', 'sit'],
    source,
  };
}

const cleanUrl = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() && v.trim() !== 'TBD' ? v.trim() : null;

/** Parse a project's exported environments.json, or null if absent/unreadable. */
export function readEnvFile(projectPath: string): unknown | null {
  try {
    const file = path.join(projectPath, 'AI_LabTest', 'environments.json');
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Resolve a ResolvedTestEnv from an already-parsed environments.json-shaped object.
 * Shared by the file reader and the DB fallback (both produce this shape — the DB
 * path via toEnvironmentsJson). storageStatePath is still checked on disk.
 */
export function resolveFromRaw(
  raw: unknown,
  projectPath: string,
  envArg?: string,
  source: EnvConfigSource = 'file',
): ResolvedTestEnv {
  const r = (raw ?? {}) as Record<string, unknown>;

  const allowedEnvs = Array.isArray(r.allowedEnvs) && r.allowedEnvs.length
    ? (r.allowedEnvs as unknown[]).map(String)
    : ['local', 'sit'];
  // env: honor the requested env if allowed, else the file's default, else first allowed.
  const def = typeof r.default === 'string' ? r.default : '';
  const env =
    envArg && allowedEnvs.includes(envArg)
      ? envArg
      : def && allowedEnvs.includes(def)
        ? def
        : allowedEnvs[0] || 'local';

  const environments = (r.environments ?? {}) as Record<string, Record<string, unknown>>;
  const e = environments[env];
  if (!e) return { ...emptyResolved(env, source), allowedEnvs };

  const frontendBaseUrl = cleanUrl(e.frontendBaseUrl);
  const apiBaseUrl = cleanUrl(e.apiBaseUrl);
  const defaultAccount =
    typeof e.defaultAccount === 'string' && e.defaultAccount ? e.defaultAccount : null;

  let storageStatePath: string | null = null;
  if (defaultAccount) {
    const p = path.join(
      projectPath,
      'AI_LabTest',
      '.auth',
      `${env}.${sanitizeAccountKey(defaultAccount)}.storageState.json`,
    );
    try {
      if (fs.existsSync(p)) storageStatePath = p;
    } catch {
      /* ignore */
    }
  }

  return {
    configured: !!frontendBaseUrl,
    env,
    frontendBaseUrl,
    apiBaseUrl,
    defaultAccount,
    storageStatePath,
    allowedEnvs,
    source,
  };
}

/**
 * Pure, file-only resolver (reads the exported environments.json). Used by the
 * unit tests and as the first source in env-resolve.ts. No DB.
 */
export function resolveProjectEnv(projectPath: string, envArg?: string): ResolvedTestEnv {
  const raw = readEnvFile(projectPath);
  if (raw == null) return emptyResolved(envArg || 'local', 'none');
  return resolveFromRaw(raw, projectPath, envArg, 'file');
}
