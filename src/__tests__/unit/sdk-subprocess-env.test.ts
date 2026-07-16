/**
 * Tests for prepareSdkSubprocessEnv — the single helper that every SDK
 * subprocess spawn (main stream, generateTextViaSdk, provider-doctor probe)
 * MUST go through, so the provider-group ownership rule is applied
 * uniformly across entry points.
 *
 * P2 review motivation: a previous version of the cc-switch fix only built
 * the shadow HOME inside `streamClaudeSdk`. `generateTextViaSdk` (used by
 * context-compressor and cli-tools description generator) and
 * `runLiveProbe` in provider-doctor still ran against the real HOME, so
 * auxiliary requests bled cc-switch creds and the doctor diagnostic could
 * disagree with the real chat result. This helper closes that gap.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
let tempHome: string;

beforeEach(() => {
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-sdkenv-test-'));
  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;
});

afterEach(() => {
  if (originalHome !== undefined) process.env.HOME = originalHome; else delete process.env.HOME;
  if (originalUserProfile !== undefined) process.env.USERPROFILE = originalUserProfile; else delete process.env.USERPROFILE;
  try { fs.rmSync(tempHome, { recursive: true, force: true }); } catch { /* ignore */ }
});

function writeUserSettingsAuth(creds: Record<string, string>) {
  const dir = path.join(tempHome, '.claude');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ env: creds }));
}

describe('prepareSdkSubprocessEnv — uniform provider-group ownership', () => {
  it('env-mode (resolved.provider undefined): pass-through real HOME, cc-switch path intact', async () => {
    writeUserSettingsAuth({ ANTHROPIC_AUTH_TOKEN: 'sk-cc-switch' });
    const { prepareSdkSubprocessEnv } = await import('../../lib/sdk-subprocess-env');

    const setup = prepareSdkSubprocessEnv({
      provider: undefined,
      protocol: 'anthropic',
      authStyle: 'api_key',
      model: undefined,
      modelDisplayName: undefined,
      upstreamModel: undefined,
      headers: {},
      envOverrides: {},
      roleModels: {},
      hasCredentials: true,
      availableModels: [],
      settingSources: ['user', 'project', 'local'],
    });
    try {
      assert.equal(setup.shadow.isShadow, false, 'env-mode must NOT build a shadow');
      assert.equal(setup.env.HOME, tempHome, 'env-mode HOME stays real so SDK reads cc-switch settings.json');
      assert.equal(setup.env.USERPROFILE, tempHome);
    } finally { setup.shadow.cleanup(); }
  });

  it('explicit DB provider: builds shadow, points HOME at it', async () => {
    writeUserSettingsAuth({ ANTHROPIC_AUTH_TOKEN: 'sk-cc-switch-leak', ANTHROPIC_BASE_URL: 'https://leak.example.com' });
    const { prepareSdkSubprocessEnv } = await import('../../lib/sdk-subprocess-env');

    const setup = prepareSdkSubprocessEnv({
      provider: {
        id: 'kimi', name: 'Kimi', provider_type: 'anthropic', protocol: 'anthropic',
        base_url: 'https://kimi.example.com', api_key: 'sk-real-kimi',
        is_active: 1, sort_order: 0, extra_env: '{}', headers_json: '{}',
        env_overrides_json: '', role_models_json: '{}', notes: '', options_json: '{}',
        created_at: '', updated_at: '',
      },
      protocol: 'anthropic',
      authStyle: 'api_key',
      model: 'sonnet',
      modelDisplayName: undefined,
      upstreamModel: 'sonnet',
      headers: {},
      envOverrides: {},
      roleModels: { default: 'sonnet' },
      hasCredentials: true,
      availableModels: [],
      settingSources: ['user', 'project', 'local'],
    });
    try {
      assert.equal(setup.shadow.isShadow, true,
        'explicit DB provider with cc-switch settings.json present must build shadow');
      assert.notEqual(setup.env.HOME, tempHome, 'HOME must point at shadow root, not real HOME');
      assert.equal(setup.env.HOME, setup.shadow.home);
      assert.equal(setup.env.USERPROFILE, setup.shadow.home);

      // Provider's auth must be in the spawn env (SDK subprocess will see this
      // BEFORE qZq() runs against the stripped settings.json).
      assert.equal(setup.env.ANTHROPIC_API_KEY, 'sk-real-kimi');
      assert.equal(setup.env.ANTHROPIC_BASE_URL, 'https://kimi.example.com');

      // CLAUDECODE must be cleared (nested-session guard)
      assert.equal(setup.env.CLAUDECODE, undefined);

      // PATH must be expanded (consistent across entry points)
      assert.ok(setup.env.PATH && setup.env.PATH.length > 0);
    } finally { setup.shadow.cleanup(); }
  });

  it('cleanup() called twice is idempotent', async () => {
    writeUserSettingsAuth({ ANTHROPIC_AUTH_TOKEN: 'sk-leak' });
    const { prepareSdkSubprocessEnv } = await import('../../lib/sdk-subprocess-env');

    const setup = prepareSdkSubprocessEnv({
      provider: {
        id: 'p1', name: 'P', provider_type: 'anthropic', protocol: 'anthropic',
        base_url: 'https://p.example.com', api_key: 'sk-p',
        is_active: 1, sort_order: 0, extra_env: '{}', headers_json: '{}',
        env_overrides_json: '', role_models_json: '{}', notes: '', options_json: '{}',
        created_at: '', updated_at: '',
      },
      protocol: 'anthropic',
      authStyle: 'api_key',
      model: 'sonnet',
      modelDisplayName: undefined,
      upstreamModel: 'sonnet',
      headers: {},
      envOverrides: {},
      roleModels: {},
      hasCredentials: true,
      availableModels: [],
      settingSources: ['user', 'project', 'local'],
    });
    const dir = setup.shadow.home;
    assert.ok(fs.existsSync(dir));
    setup.shadow.cleanup();
    assert.ok(!fs.existsSync(dir));
    setup.shadow.cleanup(); // second call must not throw
  });
});

describe('createStderrCollector — bounded stderr capture for spawn points', () => {
  it('accumulates appended chunks and snapshots them', async () => {
    const { createStderrCollector } = await import('../../lib/sdk-subprocess-env');
    const c = createStderrCollector();
    c.append('Claude Code on Windows requires either Git for Windows (for bash) or PowerShell. ');
    c.append('Install one of:\n - Git for Windows: https://git-scm.com/downloads/win\n');
    const snap = c.snapshot();
    assert.ok(snap.includes('requires either Git for Windows'));
    assert.ok(snap.includes('Install one of:'));
  });

  it('strips ANSI escape sequences and control chars, keeps \\t and \\n', async () => {
    const { createStderrCollector } = await import('../../lib/sdk-subprocess-env');
    const c = createStderrCollector();
    c.append('\x1B[31mError:\x1B[0m Git Bash was not found.\x07\r\n\tdetail');
    assert.equal(c.snapshot(), 'Error: Git Bash was not found.\n\tdetail');
  });

  it('truncates to head + tail with a marker when over the limit', async () => {
    const { createStderrCollector } = await import('../../lib/sdk-subprocess-env');
    const c = createStderrCollector(100); // half = 50
    const head = 'H'.repeat(60);
    const tail = 'T'.repeat(200);
    c.append(head);
    c.append(tail);
    const snap = c.snapshot();
    assert.ok(snap.includes('…[stderr truncated]…'), 'must mark truncation');
    assert.ok(snap.startsWith('H'.repeat(50)), 'keeps the first half (startup banners)');
    assert.ok(snap.endsWith('T'.repeat(50)), 'keeps the last half (pre-crash output)');
    assert.ok(snap.length < 130, 'stays bounded');
  });

  it('empty / whitespace-only input snapshots to empty string', async () => {
    const { createStderrCollector } = await import('../../lib/sdk-subprocess-env');
    const c = createStderrCollector();
    assert.equal(c.snapshot(), '');
    c.append('   \n  ');
    assert.equal(c.snapshot(), '');
  });
});
