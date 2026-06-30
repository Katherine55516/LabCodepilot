/**
 * Bailian (Aliyun DashScope) text-to-image credentials/config.
 *
 * Stored as a single JSON blob in the `settings` table under the key
 * `bailian_image_config`, which is in db.ts's SENSITIVE_SETTINGS — so
 * setSetting/getSetting transparently AES-256-GCM seal/unseal it (the api key
 * is never persisted plaintext in the packaged app). In `npm run dev` / tests
 * there's no master key, so it's stored plaintext (crypto-seal passthrough) —
 * same behaviour as every other credential.
 *
 * The default below is seeded into the DB on first read so the packaged app
 * works out of the box. It can later be overridden via setBailianImageConfig()
 * (e.g. a settings UI) without touching code.
 *
 * SECURITY NOTE: the api key is NOT committed to source. It is injected at
 * BUILD time via the BAILIAN_IMAGE_API_KEY env var (inlined by next.config.ts's
 * `env`), so the packaged build carries it while git keeps no plaintext key.
 * At runtime getBailianImageConfig() seeds it into the DB encrypted on first
 * use. Build with: `BAILIAN_IMAGE_API_KEY=sk-... npm run electron:pack:mac`.
 * Rotate by rebuilding with a new env value (or via setBailianImageConfig()).
 */

import { getSetting, setSetting } from '@/lib/db';

const SETTING_KEY = 'bailian_image_config';

/** 文生图页可选模型的一项；由账号服务端下发。 */
export interface ImageModelOption {
  id: string;
  label: string;
  default?: boolean;
}

export interface BailianImageConfig {
  /** DashScope API key (sk-...). Image generation uses a key with image scope. */
  apiKey: string;
  /** Workspace id (ws-...). Used as the endpoint subdomain. */
  workspaceId: string;
  /** Image model id. */
  model: string;
  /** DashScope region for the MaaS endpoint host, e.g. 'cn-beijing'. */
  region: string;
  /** 文生图页可选模型列表（账号下发；为空时前端回退仅显示默认 model）。 */
  models: ImageModelOption[];
}

const DEFAULT_IMAGE_MODEL = process.env.BAILIAN_IMAGE_MODEL || 'qwen-image-2.0-pro';

const BAILIAN_IMAGE_DEFAULTS: BailianImageConfig = {
  // dev/自测兜底：仍读 BAILIAN_IMAGE_* env；正式 release 走账号下发覆盖（见
  // docs/exec-plans/active/image-model-managed-delivery-client.md）。
  apiKey: process.env.BAILIAN_IMAGE_API_KEY || '',
  workspaceId: process.env.BAILIAN_IMAGE_WORKSPACE_ID || 'ws-10a6dp04so0g3te6',
  model: DEFAULT_IMAGE_MODEL,
  region: process.env.BAILIAN_IMAGE_REGION || 'cn-beijing',
  models: [{ id: DEFAULT_IMAGE_MODEL, label: DEFAULT_IMAGE_MODEL, default: true }],
};

/**
 * Read the Bailian image config. Seeds the default (encrypted) into the DB on
 * first access so subsequent reads/edits persist. Missing fields fall back to
 * the defaults so a partial override can't leave the config unusable.
 */
export function getBailianImageConfig(): BailianImageConfig {
  const raw = getSetting(SETTING_KEY);
  if (raw === undefined) {
    setSetting(SETTING_KEY, JSON.stringify(BAILIAN_IMAGE_DEFAULTS));
    return { ...BAILIAN_IMAGE_DEFAULTS };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<BailianImageConfig>;
    return {
      apiKey: parsed.apiKey || BAILIAN_IMAGE_DEFAULTS.apiKey,
      workspaceId: parsed.workspaceId || BAILIAN_IMAGE_DEFAULTS.workspaceId,
      model: parsed.model || BAILIAN_IMAGE_DEFAULTS.model,
      region: parsed.region || BAILIAN_IMAGE_DEFAULTS.region,
      // 账号下发后 models 由服务端决定；显式空数组（已下发但无模型）也尊重，
      // 仅在字段缺失（老数据/从未下发）时回退默认。
      models: Array.isArray(parsed.models) ? parsed.models : BAILIAN_IMAGE_DEFAULTS.models,
    };
  } catch {
    return { ...BAILIAN_IMAGE_DEFAULTS };
  }
}

/** Persist a (partial) config update; merges over the current effective config. */
export function setBailianImageConfig(patch: Partial<BailianImageConfig>): BailianImageConfig {
  const next = { ...getBailianImageConfig(), ...patch };
  setSetting(SETTING_KEY, JSON.stringify(next));
  return next;
}

/**
 * 清空下发的图片配置（登出 / 401）。写入全空标记：apiKey 空 → 文生图触发
 * NoImageProviderError（登录态降级）。dev 下若设了 BAILIAN_IMAGE_* env，getter 仍会
 * 用 env 兜底回填——属本地自测便利，打包 release 无 env 故真正清空。
 */
export function clearBailianImageConfig(): void {
  setSetting(
    SETTING_KEY,
    JSON.stringify({ apiKey: '', workspaceId: '', model: '', region: '', models: [] } satisfies BailianImageConfig),
  );
}
