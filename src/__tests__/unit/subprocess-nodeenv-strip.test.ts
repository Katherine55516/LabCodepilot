/**
 * Regression: the host runtime's NODE_ENV must NOT leak into subprocesses that
 * run user commands (Claude's native `claude` CLI + its Bash tool, and our own
 * Bash tool).
 *
 * Why this matters: in the PACKAGED desktop build the embedded Next standalone
 * server runs with process.env.NODE_ENV='production' (server.js sets it
 * unconditionally). If that value reaches `npm install` run by Claude's Bash
 * tool in an unrelated user project, npm silently skips devDependencies and
 * breaks the build. The fix strips NODE_ENV at every subprocess-env boundary
 * (sdk-subprocess-env.ts, claude-client.ts PTL retry, tools/bash.ts). These
 * tests pin the two hermetically-testable boundaries.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { prepareSdkSubprocessEnv } from '../../lib/sdk-subprocess-env';
import type { ResolvedProvider } from '../../lib/provider-resolver';
import { createBashTool } from '../../lib/tools/bash';

// Minimal provider-mode ResolvedProvider. Provider mode keeps toClaudeCodeEnv on
// its pure branch (no DB getSetting call), so the test stays hermetic.
function fakeResolved(): ResolvedProvider {
  return {
    provider: { api_key: 'test-key', base_url: '' },
    protocol: 'anthropic',
    authStyle: 'api_key',
    model: undefined,
    upstreamModel: undefined,
    modelDisplayName: undefined,
    headers: {},
    envOverrides: {},
    roleModels: {},
    hasCredentials: true,
    availableModels: [],
    settingSources: [],
  } as unknown as ResolvedProvider;
}

describe('subprocess env: NODE_ENV must not leak from host to child', () => {
  // process.env.NODE_ENV is typed read-only in this project; go through a
  // widened view to set/clear it in the test.
  const mutableEnv = process.env as Record<string, string | undefined>;
  const origHome = process.env.HOME;
  const origUserProfile = process.env.USERPROFILE;
  const origNodeEnv = process.env.NODE_ENV;
  let tempHome: string;

  beforeEach(() => {
    // Empty temp HOME → no ~/.claude → shadow-home builder returns pass-through
    // (no filesystem side effects), keeping the test hermetic.
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-nodeenv-test-'));
    process.env.HOME = tempHome;
    process.env.USERPROFILE = tempHome;
    // Simulate the packaged Next standalone server runtime.
    mutableEnv.NODE_ENV = 'production';
  });

  afterEach(() => {
    if (origHome !== undefined) process.env.HOME = origHome; else delete process.env.HOME;
    if (origUserProfile !== undefined) process.env.USERPROFILE = origUserProfile; else delete process.env.USERPROFILE;
    if (origNodeEnv !== undefined) mutableEnv.NODE_ENV = origNodeEnv; else delete mutableEnv.NODE_ENV;
    try { fs.rmSync(tempHome, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('prepareSdkSubprocessEnv drops NODE_ENV even when host is production', () => {
    const { env, shadow } = prepareSdkSubprocessEnv(fakeResolved());
    try {
      assert.equal(env.NODE_ENV, undefined, 'host production NODE_ENV must not appear in the SDK subprocess env');
      assert.ok(!('NODE_ENV' in env), 'NODE_ENV key should be absent entirely, not just empty');
      // Sanity: other real env still flows through (we did not nuke the env).
      assert.ok(typeof env.PATH === 'string' && env.PATH.length > 0, 'PATH should still be present');
    } finally {
      shadow.cleanup();
    }
  });

  it('native Bash tool runs the command without a leaked production NODE_ENV', { skip: process.platform === 'win32' }, async () => {
    const bashTool = createBashTool({ workingDirectory: os.tmpdir() } as never);
    // $NODE_ENV expands to empty when the child did not inherit it.
    const out = await (bashTool as unknown as { execute: (i: { command: string }, o: unknown) => Promise<string> })
      .execute({ command: 'printf "NE=[%s]" "$NODE_ENV"' }, {});
    assert.match(String(out), /NE=\[\]/, `expected empty NODE_ENV in child, got: ${out}`);
  });
});
