/**
 * Pin the legacy-runtime coercion used by both SettingsCli migration and
 * RuntimeBadge display. If these rules drift between call sites the UI and
 * the persisted value disagree.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveLegacyRuntimeForDisplay, isConcreteRuntime } from '@/lib/runtime/legacy';

describe('resolveLegacyRuntimeForDisplay (v0.55+: SDK runtime always available)', () => {
  // Since v0.55, the Claude Code native binary is bundled inside the
  // application via @anthropic-ai/claude-agent-sdk-<platform>-<arch>.
  // SDK runtime is therefore always available, so legacy 'auto' / null /
  // undefined / garbage values always coerce to 'claude-code-sdk'.
  // The legacy `cliConnected` parameter is retained for ABI compatibility
  // but ignored — these tests pin that contract.

  it('preserves explicit claude-code-sdk regardless of cliConnected argument', () => {
    assert.equal(resolveLegacyRuntimeForDisplay('claude-code-sdk', true), 'claude-code-sdk');
    assert.equal(resolveLegacyRuntimeForDisplay('claude-code-sdk', false), 'claude-code-sdk');
  });

  it('preserves explicit native regardless of cliConnected argument', () => {
    assert.equal(resolveLegacyRuntimeForDisplay('native', true), 'native');
    assert.equal(resolveLegacyRuntimeForDisplay('native', false), 'native');
  });

  it('migrates legacy auto to claude-code-sdk (cliConnected ignored)', () => {
    assert.equal(resolveLegacyRuntimeForDisplay('auto', true), 'claude-code-sdk');
    assert.equal(resolveLegacyRuntimeForDisplay('auto', false), 'claude-code-sdk');
  });

  it('treats null / undefined / empty as legacy → claude-code-sdk', () => {
    assert.equal(resolveLegacyRuntimeForDisplay(null, true), 'claude-code-sdk');
    assert.equal(resolveLegacyRuntimeForDisplay(null, false), 'claude-code-sdk');
    assert.equal(resolveLegacyRuntimeForDisplay(undefined, true), 'claude-code-sdk');
    assert.equal(resolveLegacyRuntimeForDisplay('', false), 'claude-code-sdk');
  });

  it('treats unknown garbage values as legacy (defensive) → claude-code-sdk', () => {
    assert.equal(resolveLegacyRuntimeForDisplay('whatever', true), 'claude-code-sdk');
    assert.equal(resolveLegacyRuntimeForDisplay('whatever', false), 'claude-code-sdk');
  });

  it('works without the legacy cliConnected argument (optional after v0.55)', () => {
    assert.equal(resolveLegacyRuntimeForDisplay('auto'), 'claude-code-sdk');
    assert.equal(resolveLegacyRuntimeForDisplay(null), 'claude-code-sdk');
    assert.equal(resolveLegacyRuntimeForDisplay('native'), 'native');
    assert.equal(resolveLegacyRuntimeForDisplay('claude-code-sdk'), 'claude-code-sdk');
  });
});

describe('isConcreteRuntime', () => {
  it('accepts the two concrete runtime ids', () => {
    assert.equal(isConcreteRuntime('claude-code-sdk'), true);
    assert.equal(isConcreteRuntime('native'), true);
  });

  it('rejects legacy auto and everything else', () => {
    assert.equal(isConcreteRuntime('auto'), false);
    assert.equal(isConcreteRuntime(null), false);
    assert.equal(isConcreteRuntime(undefined), false);
    assert.equal(isConcreteRuntime(''), false);
    assert.equal(isConcreteRuntime('Claude Code'), false);
  });
});
