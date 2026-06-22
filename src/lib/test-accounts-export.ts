import type { TestAccountSystemView, TestEnvironment, TestLoginAccount, TestEnvKey } from '@/types';

// 把 CodePilot 内部模型映射成 AI_LabTest 运行时 environments.json。
// 字段映射、形态规则、TBD/"/" 强制与 AI_LabTest renderer 的 ecBuildJson 完全一致，
// 必须能被 AI_LabTest loadEnvCfg 无损读回。契约见
// docs/exec-plans/active/test-account-settings.md / docs/handover/test-account-settings.md。

const ENV_TAG: Record<TestEnvKey, string> = { local: 'local', sit: 'SIT' };

const SCHEMA_DESC =
  '环境注册表 — 由 AI_LabTest 读取以决定测试目标、账号与登录方式。UAT/生产永不在白名单内。';

/** AI_LabTest storageState 文件名里的 account key sanitize —— 必须与 runner 完全一致。 */
export function sanitizeAccountKey(key: string): string {
  return String(key).replace(/[^A-Za-z0-9_-]/g, '_');
}

/**
 * 单个账号 → environments[env].accounts[] 条目。
 * authType 由「形状」推断（与 AI_LabTest 一致）：
 *   - capture：只写 { key, role, authType:'capture' }，登录态在独立 storageState 文件
 *   - token：写 token + capturedAt + storageType + storageKey，不写 authType（靠 token 识别）
 *   - password：写 username + password，不写 authType
 */
function buildAccount(a: TestLoginAccount): Record<string, unknown> {
  if (a.authMethod === 'capture') {
    return { key: a.key, role: a.role, authType: 'capture' };
  }
  if (a.authMethod === 'token') {
    return {
      key: a.key,
      role: a.role,
      token: a.token || '',
      capturedAt: a.capturedAt || '',
      storageType: a.storageType || 'header',
      storageKey: a.storageKey || 'Authorization',
    };
  }
  return { key: a.key, role: a.role, username: a.username || '', password: a.password || '' };
}

function buildEnv(env: TestEnvironment, key: TestEnvKey): Record<string, unknown> {
  return {
    label: env.label,
    frontendBaseUrl: env.frontendBaseUrl.trim() || 'TBD',
    apiBaseUrl: env.apiBaseUrl.trim() || 'TBD',
    healthEndpoint: env.healthEndpoint.trim() || '/',
    defaultAccount: env.defaultAccountKey || (env.accounts[0]?.key ?? ''),
    accounts: env.accounts.map(buildAccount),
    tag: ENV_TAG[key],
  };
}

/** 系统 → environments.json 顶层对象（键序与 AI_LabTest 输出一致）。 */
export function toEnvironmentsJson(system: TestAccountSystemView): Record<string, unknown> {
  return {
    $schema: SCHEMA_DESC,
    default: 'local',
    allowedEnvs: ['local', 'sit'],
    environments: {
      local: buildEnv(system.environments.local, 'local'),
      sit: buildEnv(system.environments.sit, 'sit'),
    },
  };
}
