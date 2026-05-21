/**
 * Type definitions for the managed-account login system.
 *
 * Strictly isolated from the OpenAI OAuth module (src/lib/openai-oauth.ts) —
 * naming, storage, and concepts must NOT cross-reference.
 */

// ── Server-pushed model config (one item from /api/v1/configs) ─────────────

export interface ModelConfig {
  /** UUID — the server-side stable id, used as upsert key */
  id: string;
  /** Display name (e.g. "Claude 4.7 Sonnet") */
  name: string;
  /** Short description (may be empty) */
  description: string;
  /** API base URL for this model */
  base_url: string;
  /** API key for this model (treat as secret — mask in logs) */
  auth_token: string;
  /** Model id (e.g. "claude-sonnet-4.7") */
  model: string;
  /** Substitute model when the user picks "opus" */
  default_opus_model: string;
  /** Substitute model when the user picks "sonnet" */
  default_sonnet_model: string;
  /** Substitute model when the user picks "haiku" */
  default_haiku_model: string;
  /** Default model for subagents */
  subagent_model: string;
  /** Effort level: "low" | "medium" | "high" | "xhigh" */
  effort_level: string;
  /** Server-side free-form extension fields */
  extra: Record<string, unknown>;
  /** Sort key — smaller comes first; 0 is the default */
  sort_order: number;
}

// ── /api/v1/me response ────────────────────────────────────────────────────

export interface MeInfo {
  username: string;
  display_name: string;
  email?: string;
  plan?: string;
  config_version?: number;
  [key: string]: unknown;
}

// ── Snapshot pushed to renderer via IPC ─────────────────────────────────────

export interface AuthSnapshotMe {
  username: string;
  display_name: string;
  email?: string;
  plan?: string;
}

export interface AuthSnapshot {
  authenticated: boolean;
  offline: boolean;
  me: AuthSnapshotMe | null;
  managedConfigCount: number;
}

// ── Probe result ────────────────────────────────────────────────────────────

export interface AuthProbeResult {
  /** True when token is usable (including offline-fallback) */
  alive: boolean;
  /** True when probe failed due to network — token kept, degrade gracefully */
  offline: boolean;
}

// ── Custom error types ──────────────────────────────────────────────────────

export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkError';
  }
}

export class AuthExpiredError extends Error {
  constructor(message = 'Token expired or invalid') {
    super(message);
    this.name = 'AuthExpiredError';
  }
}
