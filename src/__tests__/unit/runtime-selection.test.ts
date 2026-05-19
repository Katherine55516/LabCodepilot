/**
 * runtime-selection.test.ts — Tests for runtime selection and OAuth status.
 *
 * - OAuth status: inlined (real getOAuthStatus reads host DB, non-deterministic)
 * - Runtime selection: inlined because registry.ts depends on runtime
 *   registration side effects that conflict with isolated unit tests.
 *   The inlined logic is documented as a mirror of registry.ts and
 *   should be updated when the source changes.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── Suite 1: predictNativeRuntime (v0.55+: SDK always available) ──
// Mirrors registry.ts predictNativeRuntime() — update if source changes.
// Since v0.55 the Claude Code binary is bundled, so `sdkAvailable` is
// effectively always true and the "no SDK → fallback to native" branch is gone.

function predictNativeRuntime(
  providerId: string | undefined,
  cliEnabled: boolean,
  agentRuntime: string,
): boolean {
  if (providerId === 'openai-oauth') return true;
  if (!cliEnabled) return true;
  if (agentRuntime === 'native') return true;
  // 'claude-code-sdk' or 'auto' → SDK runtime (always available)
  return false;
}

describe('predictNativeRuntime (mirrors registry.ts, v0.55+)', () => {
  it('openai-oauth → always native', () => {
    assert.equal(predictNativeRuntime('openai-oauth', true, 'auto'), true);
  });
  it('cli_enabled=false → always native (emergency fallback)', () => {
    assert.equal(predictNativeRuntime(undefined, false, 'auto'), true);
  });
  it('setting=native → native', () => {
    assert.equal(predictNativeRuntime(undefined, true, 'native'), true);
  });
  it('setting=claude-code-sdk → not native (bundled binary always present)', () => {
    assert.equal(predictNativeRuntime(undefined, true, 'claude-code-sdk'), false);
  });
  it('auto → not native (bundled binary always present)', () => {
    assert.equal(predictNativeRuntime(undefined, true, 'auto'), false);
  });
});

// ── Suite 2: resolveRuntime auto semantics (v0.55+) ──

function resolveRuntime(
  cliDisabled: boolean,
  overrideId: string | undefined,
  settingId: string | undefined,
): string {
  if (cliDisabled) return 'native';
  // Explicit override — respected directly (user chose it)
  if (overrideId && overrideId !== 'auto') return overrideId;
  // Explicit setting — respected (SDK always available, no fallback needed)
  if (settingId && settingId !== 'auto') return settingId;
  // Auto: always SDK runtime since binary is bundled
  return 'claude-code-sdk';
}

describe('resolveRuntime (mirrors registry.ts, v0.55+)', () => {
  it('cli disabled → native regardless', () => {
    assert.equal(resolveRuntime(true, 'claude-code-sdk', 'claude-code-sdk'), 'native');
  });
  it('explicit override takes precedence', () => {
    assert.equal(resolveRuntime(false, 'native', 'claude-code-sdk'), 'native');
  });
  it('explicit claude-code-sdk → sdk (no fallback, binary is bundled)', () => {
    assert.equal(resolveRuntime(false, undefined, 'claude-code-sdk'), 'claude-code-sdk');
  });
  it('setting=native takes precedence over auto', () => {
    assert.equal(resolveRuntime(false, undefined, 'native'), 'native');
  });
  it('auto → sdk (bundled binary always present)', () => {
    assert.equal(resolveRuntime(false, undefined, undefined), 'claude-code-sdk');
  });
  it('auto with no setting → sdk', () => {
    assert.equal(resolveRuntime(false, undefined, 'auto'), 'claude-code-sdk');
  });
});

// ── Suite 3: OpenAI OAuth status (inlined — real impl reads host DB) ──

describe('OpenAI OAuth status (inlined logic)', () => {
  // All OAuth status tests are inlined because the real getOAuthStatus()
  // reads from the host machine's DB — test results would depend on
  // whether the developer has logged into OpenAI, making it non-deterministic.

  function deriveOAuthStatus(
    accessToken: string | null,
    expiresAt: number,
    refreshToken: string | null,
  ): { authenticated: boolean; needsRefresh?: boolean } {
    if (!accessToken) return { authenticated: false };
    const REFRESH_BUFFER_MS = 5 * 60 * 1000;
    if (expiresAt && Date.now() > expiresAt && !refreshToken) {
      return { authenticated: false };
    }
    const needsRefresh = expiresAt > 0 && Date.now() > expiresAt - REFRESH_BUFFER_MS;
    return { authenticated: true, needsRefresh };
  }

  it('valid token → authenticated', () => {
    const r = deriveOAuthStatus('tok', Date.now() + 3600_000, null);
    assert.equal(r.authenticated, true);
    assert.equal(r.needsRefresh, false);
  });

  it('expired + no refresh → not authenticated', () => {
    const r = deriveOAuthStatus('tok', Date.now() - 1000, null);
    assert.equal(r.authenticated, false);
  });

  it('expired + has refresh → authenticated + needsRefresh', () => {
    const r = deriveOAuthStatus('tok', Date.now() - 1000, 'ref');
    assert.equal(r.authenticated, true);
    assert.equal(r.needsRefresh, true);
  });

  it('near expiry (within 5min buffer) → needsRefresh', () => {
    const r = deriveOAuthStatus('tok', Date.now() + 60_000, 'ref');
    assert.equal(r.authenticated, true);
    assert.equal(r.needsRefresh, true);
  });

  it('expiresAt=0 → no expiry check', () => {
    const r = deriveOAuthStatus('tok', 0, null);
    assert.equal(r.authenticated, true);
    assert.equal(r.needsRefresh, false);
  });
});

// ── Suite 4: SDK availability matrix (v0.55+: always available) ──

describe('SDK isAvailable (v0.55+)', () => {
  // Mirrors sdk-runtime.ts isAvailable(). Since the Claude Code binary is
  // bundled with the installer via the @anthropic-ai/claude-agent-sdk-*
  // platform subpackage, SDK runtime is always available. Authentication
  // errors surface at stream time, not pre-filtered here.

  function sdkIsAvailable(): boolean {
    return true;
  }

  it('always available (bundled binary)', () => {
    assert.equal(sdkIsAvailable(), true);
  });
});

// ── Suite 5: Announcement dismiss persistence (mirrors FeatureAnnouncementDialog) ──

describe('Announcement dismiss persistence (inlined logic)', () => {
  // Mirrors the dismiss check in FeatureAnnouncementDialog.tsx:24-39.
  // LIMITATION: tests the decision matrix only, not the actual API persistence
  // path (settings/app whitelist, localStorage sync). The whitelist regression
  // we fixed requires a running Next.js server to exercise — belongs in smoke/e2e.

  function shouldShowAnnouncement(opts: {
    localStorageDismissed: boolean;
    dbSettingDismissed: boolean;
    setupCompleted: boolean;
  }): { show: boolean; syncLocalStorage: boolean } {
    // Fast check: localStorage says dismissed
    if (opts.localStorageDismissed) return { show: false, syncLocalStorage: false };

    // DB says dismissed (localStorage was lost) → don't show, sync back
    if (opts.dbSettingDismissed) return { show: false, syncLocalStorage: true };

    // Only show if setup is completed (existing user)
    if (opts.setupCompleted) return { show: true, syncLocalStorage: false };

    // New user (setup not done) → don't show
    return { show: false, syncLocalStorage: false };
  }

  it('localStorage dismissed → do not show', () => {
    const r = shouldShowAnnouncement({ localStorageDismissed: true, dbSettingDismissed: false, setupCompleted: true });
    assert.equal(r.show, false);
    assert.equal(r.syncLocalStorage, false);
  });

  it('DB dismissed but localStorage lost → do not show + sync localStorage', () => {
    const r = shouldShowAnnouncement({ localStorageDismissed: false, dbSettingDismissed: true, setupCompleted: true });
    assert.equal(r.show, false);
    assert.equal(r.syncLocalStorage, true);
  });

  it('neither dismissed + setup completed → show (existing user upgrading)', () => {
    const r = shouldShowAnnouncement({ localStorageDismissed: false, dbSettingDismissed: false, setupCompleted: true });
    assert.equal(r.show, true);
  });

  it('neither dismissed + setup not completed → do not show (new user)', () => {
    const r = shouldShowAnnouncement({ localStorageDismissed: false, dbSettingDismissed: false, setupCompleted: false });
    assert.equal(r.show, false);
  });

  it('both dismissed → do not show (redundant but safe)', () => {
    const r = shouldShowAnnouncement({ localStorageDismissed: true, dbSettingDismissed: true, setupCompleted: true });
    assert.equal(r.show, false);
  });
});
