/**
 * runtime/registry.ts — Runtime registration and resolution.
 *
 * Keeps a Map of available runtimes. resolveRuntime() picks the best one
 * based on user settings.
 *
 * auto 语义（自 v0.55 起 SDK runtime 永远可用）：
 *   - cli_enabled=false (应急 fallback) → Native runtime
 *   - 否则 → SDK runtime
 *
 * Claude Code 原生二进制已通过 @anthropic-ai/claude-agent-sdk-<platform>-<arch>
 * 平台子包随应用一起分发，无需用户自行安装 CLI。
 *
 * 此前 auto 会综合 env vars / DB provider / ~/.claude/settings.json 做凭据推断，
 * 但推断逻辑在边缘场景（cc-switch 代理占位符、全新未配置用户等）频繁出错，
 * 导致 Sentry NEXT-2Z "No provider credentials" 长期高位。改为二元判定后，
 * 没凭据的场景由 Chat API 入口的 NEEDS_PROVIDER_SETUP 精准拦截，不再由
 * runtime 决策层胡乱猜测。
 */

import type { AgentRuntime } from './types';
import { getSetting } from '@/lib/db';
import { resolveProvider } from '@/lib/provider-resolver';

export function providerRequiresNative(providerId?: string): boolean {
  if (providerId === 'openai-oauth') return true;
  const protocol = resolveProvider({ providerId }).protocol;
  return ['openai-compatible', 'openrouter', 'google'].includes(protocol);
}

const runtimes = new Map<string, AgentRuntime>();

export function registerRuntime(runtime: AgentRuntime): void {
  runtimes.set(runtime.id, runtime);
}

export function getRuntime(id: string): AgentRuntime | undefined {
  return runtimes.get(id);
}

export function getAllRuntimes(): AgentRuntime[] {
  return Array.from(runtimes.values());
}

export function getAvailableRuntimes(): AgentRuntime[] {
  return getAllRuntimes().filter(r => r.isAvailable());
}

/**
 * Pick the runtime to use for a given request.
 *
 * Priority:
 * 0. cli_enabled=false → ALWAYS use native (highest-priority constraint)
 * 1. Explicit override (from function arg or per-session setting)
 * 2. Global user setting (agent_runtime)
 * 3. Auto: SDK runtime (always available since Claude Code is bundled)
 */
export function resolveRuntime(overrideId?: string, providerId?: string): AgentRuntime {
  // 0. cli_enabled=false is an absolute constraint — never return SDK.
  //    Kept as an emergency fallback for users hit by AV blocking the spawned
  //    binary, restrictive enterprise policies, etc.
  if (providerRequiresNative(providerId)) {
    const native = getRuntime('native');
    if (native?.isAvailable()) return native;
    throw new Error('This provider requires Native runtime');
  }
  const cliDisabled = getSetting('cli_enabled') === 'false';

  if (cliDisabled) {
    const native = getRuntime('native');
    if (native) return native;
    throw new Error('Native runtime not registered but CLI is disabled. This is a bug.');
  }

  // 1. Explicit override
  if (overrideId && overrideId !== 'auto') {
    const r = getRuntime(overrideId);
    if (r?.isAvailable()) return r;
  }

  // 2. Global setting
  const settingId = getSetting('agent_runtime');
  if (settingId && settingId !== 'auto') {
    const r = getRuntime(settingId);
    if (r?.isAvailable()) return r;
  }

  // 3. Auto: SDK runtime is always available (Claude Code binary is bundled
  //    via the @anthropic-ai/claude-agent-sdk-<platform>-<arch> subpackage).
  //    Missing credentials are caught earlier at /api/chat by
  //    hasCodePilotProvider(); if we reach this point the user has at least
  //    one provider source the caller expects to work.
  const sdk = getRuntime('claude-code-sdk');
  if (sdk) return sdk;

  // Defensive fallback: if for some reason SDK runtime isn't registered,
  // fall back to native rather than crash.
  const native = getRuntime('native');
  if (native) return native;

  throw new Error('No agent runtime registered. This is a bug — please report it.');
}

/**
 * Predict whether the native runtime will be used for a given request.
 *
 * Mirrors resolveRuntime() logic WITHOUT instantiating the runtime, so callers
 * (chat route, bridge) can prepare the right MCP config upfront.
 *
 * @param providerId - The provider for this request ('openai-oauth' forces native)
 */
export function predictNativeRuntime(providerId?: string): boolean {
  // Non-Anthropic providers always force native
  if (providerRequiresNative(providerId)) return true;

  // cli_enabled=false → always native (emergency fallback)
  if (getSetting('cli_enabled') === 'false') return true;

  // Explicit user setting
  const settingId = getSetting('agent_runtime');
  if (settingId === 'native') return true;

  // Auto / 'claude-code-sdk': SDK runtime is always available since the
  // Claude Code binary is bundled with the installer.
  return false;
}
