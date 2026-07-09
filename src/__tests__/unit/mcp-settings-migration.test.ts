/**
 * Migration: `~/.claude/settings.json.mcpServers` → `~/.claude.json.mcpServers`.
 *
 * The bundled Claude Code binary (2.1.203; first verified on 2.1.141) only
 * reads user-scope MCP servers
 * from `~/.claude.json` — settings.json.mcpServers is a dead field that
 * was the legacy write target of the MCP Manager UI. The migration
 * function moves any stragglers and clears the dead field so the SDK
 * actually picks up what the user configured.
 *
 * These tests pin the migration contract:
 *   - move entries to .claude.json
 *   - clear settings.json.mcpServers
 *   - preserve every other field in both files
 *   - re-entrant (second call is a no-op)
 *   - on name conflict, .claude.json wins (it's the working source)
 *   - empty/missing input is a no-op
 */
import { beforeEach, afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
let tempHome: string;

function settingsPath() {
  return path.join(tempHome, '.claude', 'settings.json');
}
function claudeJsonPath() {
  return path.join(tempHome, '.claude.json');
}

function writeSettings(content: object) {
  const dir = path.join(tempHome, '.claude');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(content, null, 2));
}

function writeClaudeJson(content: object) {
  fs.writeFileSync(claudeJsonPath(), JSON.stringify(content, null, 2));
}

function readSettings(): Record<string, unknown> {
  if (!fs.existsSync(settingsPath())) return {};
  return JSON.parse(fs.readFileSync(settingsPath(), 'utf-8'));
}

function readClaudeJson(): Record<string, unknown> {
  if (!fs.existsSync(claudeJsonPath())) return {};
  return JSON.parse(fs.readFileSync(claudeJsonPath(), 'utf-8'));
}

beforeEach(() => {
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-mcp-migration-'));
  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;
});

afterEach(() => {
  if (originalHome !== undefined) process.env.HOME = originalHome;
  else delete process.env.HOME;
  if (originalUserProfile !== undefined) process.env.USERPROFILE = originalUserProfile;
  else delete process.env.USERPROFILE;
  try { fs.rmSync(tempHome, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('migrateSettingsMcpServersToClaudeJson', () => {
  it('moves entries from settings.json to .claude.json and clears the dead field', async () => {
    writeSettings({
      env: { ANTHROPIC_AUTH_TOKEN: 'should-survive' },
      mcpServers: {
        pw: { command: 'npx', args: ['-y', '@playwright/mcp@latest'] },
      },
    });
    writeClaudeJson({ numStartups: 42, mcpServers: {} });

    const { migrateSettingsMcpServersToClaudeJson } = await import('../../lib/mcp-loader');
    const result = migrateSettingsMcpServersToClaudeJson();

    assert.deepEqual(result.migrated, ['pw']);
    assert.deepEqual(result.conflictsResolved, []);
    assert.equal(result.cleared, true);
    assert.equal(result.error, undefined);

    const claudeJson = readClaudeJson();
    assert.deepEqual(claudeJson.mcpServers, {
      pw: { command: 'npx', args: ['-y', '@playwright/mcp@latest'] },
    });
    // Preserve binary-owned state
    assert.equal(claudeJson.numStartups, 42);

    const settings = readSettings();
    assert.equal('mcpServers' in settings, false, 'mcpServers field must be removed');
    // Preserve other settings
    assert.deepEqual(settings.env, { ANTHROPIC_AUTH_TOKEN: 'should-survive' });
  });

  it('is a no-op when settings.json has no mcpServers field', async () => {
    writeSettings({ env: { FOO: 'bar' } });
    writeClaudeJson({ numStartups: 1 });

    const { migrateSettingsMcpServersToClaudeJson } = await import('../../lib/mcp-loader');
    const result = migrateSettingsMcpServersToClaudeJson();

    assert.deepEqual(result.migrated, []);
    assert.equal(result.cleared, false);
    assert.deepEqual(readSettings(), { env: { FOO: 'bar' } });
    assert.deepEqual(readClaudeJson(), { numStartups: 1 });
  });

  it('is a no-op when settings.json.mcpServers is an empty object', async () => {
    writeSettings({ mcpServers: {} });
    writeClaudeJson({});

    const { migrateSettingsMcpServersToClaudeJson } = await import('../../lib/mcp-loader');
    const result = migrateSettingsMcpServersToClaudeJson();

    assert.deepEqual(result.migrated, []);
    assert.equal(result.cleared, false);
  });

  it('is a no-op when settings.json does not exist', async () => {
    writeClaudeJson({});

    const { migrateSettingsMcpServersToClaudeJson } = await import('../../lib/mcp-loader');
    const result = migrateSettingsMcpServersToClaudeJson();

    assert.deepEqual(result.migrated, []);
    assert.equal(result.cleared, false);
  });

  it('on name collision, keeps the .claude.json entry and discards settings.json', async () => {
    writeSettings({
      mcpServers: {
        pw: { command: 'OLD-from-settings' },
        only_in_settings: { command: 'should-move' },
      },
    });
    writeClaudeJson({
      mcpServers: {
        pw: { command: 'KEEP-from-claude-json' },
      },
    });

    const { migrateSettingsMcpServersToClaudeJson } = await import('../../lib/mcp-loader');
    const result = migrateSettingsMcpServersToClaudeJson();

    assert.deepEqual(result.migrated.sort(), ['only_in_settings']);
    assert.deepEqual(result.conflictsResolved.sort(), ['pw']);
    assert.equal(result.cleared, true);

    const claudeJson = readClaudeJson();
    assert.deepEqual(claudeJson.mcpServers, {
      pw: { command: 'KEEP-from-claude-json' },
      only_in_settings: { command: 'should-move' },
    });

    const settings = readSettings();
    assert.equal('mcpServers' in settings, false);
  });

  it('is re-entrant: second call after a successful migration is a no-op', async () => {
    writeSettings({
      mcpServers: { foo: { command: 'foo-cmd' } },
    });
    writeClaudeJson({});

    const { migrateSettingsMcpServersToClaudeJson } = await import('../../lib/mcp-loader');

    const first = migrateSettingsMcpServersToClaudeJson();
    assert.deepEqual(first.migrated, ['foo']);

    const second = migrateSettingsMcpServersToClaudeJson();
    assert.deepEqual(second.migrated, []);
    assert.equal(second.cleared, false);

    // .claude.json is unchanged on the second call
    assert.deepEqual(readClaudeJson().mcpServers, { foo: { command: 'foo-cmd' } });
  });

  it('preserves every other field in .claude.json (numStartups, projects, etc.)', async () => {
    writeSettings({ mcpServers: { new: { command: 'new-cmd' } } });
    writeClaudeJson({
      numStartups: 99,
      projects: { '/some/path': { trustAccepted: true } },
      userID: 'abc-123',
      mcpServers: { existing: { command: 'existing-cmd' } },
    });

    const { migrateSettingsMcpServersToClaudeJson } = await import('../../lib/mcp-loader');
    migrateSettingsMcpServersToClaudeJson();

    const c = readClaudeJson();
    assert.equal(c.numStartups, 99);
    assert.deepEqual(c.projects, { '/some/path': { trustAccepted: true } });
    assert.equal(c.userID, 'abc-123');
    assert.deepEqual(c.mcpServers, {
      existing: { command: 'existing-cmd' },
      new: { command: 'new-cmd' },
    });
  });

  it('preserves every other field in settings.json (env, permissions, hooks, mcpServerOverrides)', async () => {
    writeSettings({
      env: { ANTHROPIC_BASE_URL: 'https://example.com' },
      permissions: { allow: ['Bash(npm:*)'] },
      hooks: { preCommit: ['lint'] },
      mcpServerOverrides: { 'project-foo': { enabled: false } },
      mcpServers: { pw: { command: 'npx' } },
    });
    writeClaudeJson({});

    const { migrateSettingsMcpServersToClaudeJson } = await import('../../lib/mcp-loader');
    migrateSettingsMcpServersToClaudeJson();

    const s = readSettings();
    assert.deepEqual(s.env, { ANTHROPIC_BASE_URL: 'https://example.com' });
    assert.deepEqual(s.permissions, { allow: ['Bash(npm:*)'] });
    assert.deepEqual(s.hooks, { preCommit: ['lint'] });
    assert.deepEqual(s.mcpServerOverrides, { 'project-foo': { enabled: false } });
    assert.equal('mcpServers' in s, false);
  });

  it('creates .claude.json when it does not exist yet', async () => {
    writeSettings({ mcpServers: { foo: { command: 'foo-cmd' } } });
    // intentionally NOT calling writeClaudeJson

    const { migrateSettingsMcpServersToClaudeJson } = await import('../../lib/mcp-loader');
    const result = migrateSettingsMcpServersToClaudeJson();

    assert.deepEqual(result.migrated, ['foo']);
    assert.equal(result.cleared, true);
    assert.deepEqual(readClaudeJson(), { mcpServers: { foo: { command: 'foo-cmd' } } });
  });
});
