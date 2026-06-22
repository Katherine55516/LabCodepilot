import { readEnvFile, resolveFromRaw, type ResolvedTestEnv } from '@/lib/test/env-config';
import { getAllTestAccountSystems } from '@/lib/db';
import { toEnvironmentsJson } from '@/lib/test-accounts-export';

/**
 * Resolve a project's test env with a DB fallback (server-only — imports @/lib/db).
 *
 * Order:
 *  1. exported `{projectPath}/AI_LabTest/environments.json` — wins, matches what the
 *     AI_LabTest framework runner actually reads.
 *  2. no file → live 设置·测试账号 row matched by `project_root == projectPath`, so
 *     the user gets a target without having to click 导出.
 *  3. nothing → unconfigured.
 *
 * `.auth/` login files (written by the capture flow) are read off disk in all cases
 * via resolveFromRaw. The matching key is the exact `project_root` string, so a
 * system's 项目目录 must equal the workbench project's folder path.
 */
export function resolveProjectEnvWithDb(projectPath: string, envArg?: string): ResolvedTestEnv {
  // 1) exported file wins
  const raw = readEnvFile(projectPath);
  if (raw != null) return resolveFromRaw(raw, projectPath, envArg, 'file');

  // 2) live DB config matched by project_root
  try {
    const sys = getAllTestAccountSystems().find((s) => s.project_root === projectPath);
    if (sys) return resolveFromRaw(toEnvironmentsJson(sys), projectPath, envArg, 'db');
  } catch {
    /* DB unavailable → fall through to unconfigured */
  }

  // 3) nothing configured
  return resolveFromRaw(null, projectPath, envArg, 'none');
}
