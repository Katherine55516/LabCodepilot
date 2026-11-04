/**
 * Map server-pushed ModelConfig → ManagedProviderRow that the DB layer
 * understands. Pure transform — no I/O, no electron deps — so the main
 * process can shape the payload before POSTing to the Next.js server's
 * /api/auth/managed-providers/sync endpoint.
 *
 * Mapping strategy:
 *   - id: prefix with "managed-" to namespace away from user-created rows
 *   - provider_type / protocol: hard-coded to 'anthropic' for now; the
 *     ModelConfig.extra field can override in a future iteration
 *   - role_models_json: condenses the four "default_*_model" fields into the
 *     shape provider-resolver already understands
 *   - options_json: stores effort_level so the model picker can read it
 *   - managed_extra_json: preserves the raw ModelConfig so any field added
 *     server-side later is still recoverable without redeploying the client
 */

import type { ModelConfig } from './types';

// Local type — must stay in sync with src/lib/db.ts ManagedProviderRow.
// Duplicated rather than imported because electron/auth/* deliberately
// does not import from src/.
export interface ManagedProviderRow {
  id: string;
  name: string;
  provider_type: string;
  protocol: string;
  base_url: string;
  api_key: string;
  sort_order: number;
  extra_env?: string;
  headers_json?: string;
  env_overrides_json?: string;
  role_models_json?: string;
  options_json?: string;
  notes?: string;
  managed_config_id: string;
  managed_extra_json: string;
}

export function modelConfigToManagedProviderRow(cfg: ModelConfig): ManagedProviderRow {
  // Semantic role mapping — provider-resolver injects these as
  // ANTHROPIC_MODEL / ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU}_MODEL env vars.
  const roleModels: Record<string, string> = {};
  if (cfg.model) roleModels.default = cfg.model;
  if (cfg.default_opus_model) roleModels.opus = cfg.default_opus_model;
  if (cfg.default_sonnet_model) roleModels.sonnet = cfg.default_sonnet_model;
  if (cfg.default_haiku_model) roleModels.haiku = cfg.default_haiku_model;

  // Env overrides — Claude Code SDK reads these from the subprocess env.
  // `subagent_model` and `effort_level` map to dedicated CLAUDE_CODE_* keys
  // rather than role-models because they're SDK-runtime knobs, not provider
  // aliases.
  const envOverrides: Record<string, string> = {};
  if (cfg.subagent_model) envOverrides.CLAUDE_CODE_SUBAGENT_MODEL = cfg.subagent_model;
  if (cfg.effort_level) envOverrides.CLAUDE_CODE_EFFORT_LEVEL = cfg.effort_level;

  return {
    id: `managed-${cfg.id}`,
    name: cfg.name,
    provider_type: 'anthropic',
    protocol: 'anthropic',
    base_url: cfg.base_url,
    api_key: cfg.auth_token,
    sort_order: cfg.sort_order ?? 0,
    role_models_json: JSON.stringify(roleModels),
    env_overrides_json: JSON.stringify(envOverrides),
    options_json: '{}',
    notes: cfg.description ?? '',
    managed_config_id: cfg.id,
    managed_extra_json: JSON.stringify({
      effort_level: cfg.effort_level,
      subagent_model: cfg.subagent_model,
      extra: cfg.extra,
      raw: cfg,
    }),
  };
}
