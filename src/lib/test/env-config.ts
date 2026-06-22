import fs from 'fs';
import path from 'path';
import { sanitizeAccountKey } from '@/lib/test-accounts-export';

/**
 * Resolve a project's test environment from its exported `environments.json`.
 *
 * Bridges the colleague's 测试账号设置 (Settings) to the test workbench: the user
 * configures a system there (one system ↔ one project folder, keyed by its
 * `project_root`), exports → `{project_root}/AI_LabTest/environments.json`
 * (+ `.auth/` storageState). When the workbench runs a task for that project,
 * the execution step reads this file for the target baseUrl + login state — the
 * exact contract the AI_LabTest framework consumes (see
 * docs/handover/test-account-settings.md). Pure fs read — unit-tested.
 */

export interface ResolvedTestEnv {
  /** environments.json exists AND the chosen env has a real frontendBaseUrl (not TBD). */
  configured: boolean;
  /** Resolved env key (honors the file's `default` + `allowedEnvs` when env arg is absent/invalid). */
  env: string;
  /** Target frontend base URL, or null when missing / "TBD". */
  frontendBaseUrl: string | null;
  apiBaseUrl: string | null;
  defaultAccount: string | null;
  /** Absolute path to the captured Playwright storageState, if the file exists. */
  storageStatePath: string | null;
  allowedEnvs: string[];
}

function emptyResolved(env: string): ResolvedTestEnv {
  return {
    configured: false,
    env,
    frontendBaseUrl: null,
    apiBaseUrl: null,
    defaultAccount: null,
    storageStatePath: null,
    allowedEnvs: ['local', 'sit'],
  };
}

const cleanUrl = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() && v.trim() !== 'TBD' ? v.trim() : null;

export function resolveProjectEnv(projectPath: string, envArg?: string): ResolvedTestEnv {
  let raw: Record<string, unknown>;
  try {
    const file = path.join(projectPath, 'AI_LabTest', 'environments.json');
    raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return emptyResolved(envArg || 'local');
  }

  const allowedEnvs = Array.isArray(raw.allowedEnvs) && raw.allowedEnvs.length
    ? (raw.allowedEnvs as unknown[]).map(String)
    : ['local', 'sit'];
  // env: honor the requested env if allowed, else the file's default, else first allowed.
  const def = typeof raw.default === 'string' ? raw.default : '';
  const env =
    envArg && allowedEnvs.includes(envArg)
      ? envArg
      : def && allowedEnvs.includes(def)
        ? def
        : allowedEnvs[0] || 'local';

  const environments = (raw.environments ?? {}) as Record<string, Record<string, unknown>>;
  const e = environments[env];
  if (!e) return { ...emptyResolved(env), allowedEnvs };

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
  };
}
