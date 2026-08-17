/**
 * Unit tests for the CONTENT_BLOCKED classification (upstream safety / AUP
 * refusal).
 *
 * Field case: packaged v4.2.0 main.log recorded 4 occurrences between
 * 2026-08-13 and 2026-08-17 of
 *   "API Error: Fable 5 can't help with this. Start a new session to continue."
 * Nothing matched it, so it degraded to UNKNOWN ("An unexpected error
 * occurred … run Provider Doctor") and the user spent the session diagnosing a
 * provider that was fine — while repeatedly typing 「继续」, which resends the
 * blocked prefix and re-trips the block every time.
 *
 * The verbatim strings below were extracted from the bundled CLI binary
 * (node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude), which
 * builds these messages and stamps `stop_reason: "refusal"` on them.
 *
 * Run with: npx tsx --test src/__tests__/unit/error-classifier-refusal.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyError } from '../../lib/error-classifier';

/** Shape 1 — verbatim from the field log (SDK wrapper prefix included). */
const REAL_REFUSAL =
  "Claude Code returned an error result: API Error: Fable 5 can't help with this. " +
  'Start a new session to continue.\n\nLearn more: https://www.anthropic.com/legal/aup';

/** Shape 2 — the "safeguards flagged" variant. */
const SAFEGUARDS_REFUSAL =
  "Claude Code returned an error result: API Error: Fable 5's safeguards flagged this message " +
  '(https://www.anthropic.com/legal/aup). This sometimes happens with safe, normal conversations. ' +
  "Claude Code can't respond to this message with Fable 5. " +
  'Try rephrasing the request in a new session or change your model.';

/** Shape 3 — the cyber category (no AUP url; its own help-center link). */
const CYBER_REFUSAL =
  "Claude Code returned an error result: API Error: Fable 5's safeguards flagged this message. " +
  'This model has safety measures that flagged this message for a cybersecurity topic. ' +
  'To learn about the Cyber Verification Program and apply for access, visit our help center.';

describe('CONTENT_BLOCKED classification', () => {
  it('classifies the real field refusal, not UNKNOWN', () => {
    const r = classifyError({
      error: new Error(REAL_REFUSAL),
      providerName: 'Fable 5',
    });
    assert.equal(r.category, 'CONTENT_BLOCKED');
    assert.equal(r.retryable, false, 'resending the same prefix is exactly what re-trips it');
    assert.ok(r.userMessage.includes('安全策略'), 'message must name the real cause');
    assert.ok(r.userMessage.includes('Fable 5'), 'provider name should appear');
  });

  it('explicitly rules out the misdirections users chased', () => {
    const r = classifyError({ error: new Error(REAL_REFUSAL) });
    assert.ok(r.userMessage.includes('API Key'), 'must say it is NOT an API Key problem');
    assert.ok(
      !/Provider Doctor/i.test(r.userMessage + r.actionHint),
      'must not send the user to Provider Doctor',
    );
  });

  it('tells the user to start a NEW session and offers it as an action', () => {
    const r = classifyError({ error: new Error(REAL_REFUSAL) });
    assert.ok(r.actionHint.includes('新建会话'), 'hint must say start a new session');
    assert.ok(r.actionHint.includes('继续'), 'hint must warn that 「继续」 re-trips the block');
    const actions = r.recoveryActions ?? [];
    assert.ok(
      actions.some((a) => a.action === 'new_conversation'),
      'should offer a new-conversation action',
    );
    assert.ok(
      !actions.some((a) => a.action === 'retry' || a.action === 'open_settings'),
      'must NOT offer retry or Open Settings — both are wrong here',
    );
  });

  it('matches the safeguards-flagged variant', () => {
    const r = classifyError({ error: new Error(SAFEGUARDS_REFUSAL) });
    assert.equal(r.category, 'CONTENT_BLOCKED');
  });

  it('adds the Cyber Verification note only for the cyber variant', () => {
    const cyber = classifyError({ error: new Error(CYBER_REFUSAL) });
    assert.equal(cyber.category, 'CONTENT_BLOCKED');
    assert.ok(
      cyber.actionHint.includes('Cyber Verification Program'),
      'cyber refusals should surface the verification programme',
    );

    const plain = classifyError({ error: new Error(REAL_REFUSAL) });
    assert.ok(
      !plain.actionHint.includes('Cyber Verification Program'),
      'non-cyber refusals must not mention it',
    );
  });

  it('matches when the phrase arrives via stderr instead of message', () => {
    const r = classifyError({
      error: new Error('Claude Code process exited with code 1'),
      stderr: "API Error: Claude can't help with this. Start a new session to continue.",
    });
    assert.equal(r.category, 'CONTENT_BLOCKED');
  });

  it('survives a JSON-wrapped refusal from the gateway (no upstream override)', () => {
    // extractUpstreamMessage would otherwise promote the raw sentence and clear
    // actionHint + recoveryActions, dropping the only actionable guidance.
    const r = classifyError({
      error: new Error(
        'Claude Code returned an error result: API Error: 400 ' +
          '{"error":{"message":"Fable 5 can\'t help with this. Start a new session to continue."}}',
      ),
    });
    assert.equal(r.category, 'CONTENT_BLOCKED');
    assert.ok(r.actionHint.includes('新建会话'), 'actionHint must survive the override');
    assert.ok(
      (r.recoveryActions ?? []).some((a) => a.action === 'new_conversation'),
      'recoveryActions must survive the override',
    );
  });

  it('does not shadow the categories that share the message shape', () => {
    // These all arrive as "API Error: …" too and must keep their own category.
    const cases: Array<[string, string]> = [
      ['API Error: 429 too many requests', 'RATE_LIMITED'],
      ['API Error: 403 用户高阶模型额度不足', 'AUTH_FORBIDDEN'],
      [
        'Claude Code returned an error result: API Error: Connection closed mid-response. The response above may be incomplete.',
        'STREAM_DISCONNECTED',
      ],
      ['Claude Code process exited with code 1', 'PROCESS_CRASH'],
    ];
    for (const [msg, expected] of cases) {
      const r = classifyError({ error: new Error(msg) });
      assert.equal(r.category, expected, `${msg} should stay ${expected}`);
    }
  });

  it('does not fire on unrelated errors', () => {
    const r = classifyError({ error: new Error('something completely different went wrong') });
    assert.equal(r.category, 'UNKNOWN');
  });

  it('uses ASCII apostrophes so the substring match actually works', () => {
    // Guard against a well-meaning "typography fix" in the pattern list: the
    // CLI emits U+0027, verified against both the binary and the field log.
    const withTypographic = classifyError({
      error: new Error('API Error: Fable 5 can’t help with this. Start a new session to continue.'),
    });
    // A typographic-apostrophe message is NOT expected in practice; this test
    // documents that we key off the ASCII form the CLI really emits.
    assert.equal(withTypographic.category, 'UNKNOWN');
    assert.equal(classifyError({ error: new Error(REAL_REFUSAL) }).category, 'CONTENT_BLOCKED');
  });
});
