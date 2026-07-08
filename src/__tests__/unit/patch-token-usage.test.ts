/**
 * Locks patchLatestAssistantTokenUsage — the late context-usage snapshot
 * backfill (FIX(权威分子)). The turn must NOT wait for getContextUsage (it can
 * take tens of seconds in packaged env), so the snapshot lands via this patch
 * after the message row already exists. Guards: latest-assistant-only,
 * match-mismatch rejection (next turn already started), merge-not-replace.
 *
 * Run with: npx tsx --test src/__tests__/unit/patch-token-usage.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import os from 'os';
import fs from 'fs';

// Set a temp data dir before importing db module
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-patch-usage-test-'));
process.env.CLAUDE_GUI_DATA_DIR = tmpDir;

/* eslint-disable @typescript-eslint/no-require-imports */
const {
  createSession,
  addMessage,
  getMessages,
  patchLatestAssistantTokenUsage,
} = require('../../lib/db') as typeof import('../../lib/db');

function latestUsage(sessionId: string): Record<string, unknown> {
  const { messages } = getMessages(sessionId);
  const assistants = messages.filter((m) => m.role === 'assistant');
  const last = assistants[assistants.length - 1];
  return last?.token_usage ? JSON.parse(last.token_usage) : {};
}

describe('patchLatestAssistantTokenUsage', () => {
  it('merges snapshot fields into the latest assistant message', () => {
    const s = createSession('t1', 'stub-model');
    addMessage(s.id, 'user', 'hi');
    addMessage(
      s.id, 'assistant', 'ok',
      JSON.stringify({ input_tokens: 12345, output_tokens: 5, model: 'stub-model' }),
    );

    const ok = patchLatestAssistantTokenUsage(
      s.id,
      { input_tokens: 12345, output_tokens: 5 },
      { context_used_tokens: 65432, cli_context_window: 200000 },
    );

    assert.equal(ok, true);
    const usage = latestUsage(s.id);
    assert.equal(usage.context_used_tokens, 65432);
    assert.equal(usage.cli_context_window, 200000);
    assert.equal(usage.input_tokens, 12345); // merge, not replace
    assert.equal(usage.model, 'stub-model');
  });

  it('rejects when match mismatches (next turn already persisted)', () => {
    const s = createSession('t2', 'stub-model');
    addMessage(
      s.id, 'assistant', 'turn-2 answer',
      JSON.stringify({ input_tokens: 999, output_tokens: 9 }),
    );

    // Snapshot from turn-1 (input 12345) arrives late — latest row is turn-2.
    const ok = patchLatestAssistantTokenUsage(
      s.id,
      { input_tokens: 12345, output_tokens: 5 },
      { context_used_tokens: 65432 },
    );

    assert.equal(ok, false);
    assert.equal(latestUsage(s.id).context_used_tokens, undefined); // untouched
  });

  it('patches only the latest assistant message', () => {
    const s = createSession('t3', 'stub-model');
    addMessage(s.id, 'assistant', 'old', JSON.stringify({ input_tokens: 1, output_tokens: 1 }));
    addMessage(s.id, 'assistant', 'new', JSON.stringify({ input_tokens: 2, output_tokens: 2 }));

    const ok = patchLatestAssistantTokenUsage(
      s.id,
      { input_tokens: 2, output_tokens: 2 },
      { context_used_tokens: 100 },
    );

    assert.equal(ok, true);
    const { messages } = getMessages(s.id);
    const assistants = messages.filter((m) => m.role === 'assistant');
    const oldUsage = JSON.parse(assistants[0].token_usage!);
    const newUsage = JSON.parse(assistants[1].token_usage!);
    assert.equal(oldUsage.context_used_tokens, undefined);
    assert.equal(newUsage.context_used_tokens, 100);
  });

  it('returns false when the session has no assistant message', () => {
    const s = createSession('t4', 'stub-model');
    addMessage(s.id, 'user', 'hi');
    assert.equal(
      patchLatestAssistantTokenUsage(s.id, null, { context_used_tokens: 1 }),
      false,
    );
  });

  it('null match patches unconditionally (no cross-turn guard requested)', () => {
    const s = createSession('t5', 'stub-model');
    addMessage(s.id, 'assistant', 'ok', null);
    const ok = patchLatestAssistantTokenUsage(s.id, null, { context_used_tokens: 7 });
    assert.equal(ok, true);
    assert.equal(latestUsage(s.id).context_used_tokens, 7);
  });
});
