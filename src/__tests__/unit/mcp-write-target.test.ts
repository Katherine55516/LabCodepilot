/**
 * /api/plugins/mcp must write user-scope MCP servers to `~/.claude.json` —
 * NOT to `~/.claude/settings.json`. The bundled Claude Code binary only
 * reads `~/.claude.json.mcpServers` for user-scope MCPs; the settings.json
 * field is a dead one that gets ignored at runtime.
 *
 * These tests pin the write contract for POST and PUT so the bug we just
 * fixed can't silently come back.
 */
import { beforeEach, afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';

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
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-mcp-write-'));
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

function postReq(body: object) {
  return new NextRequest('http://localhost/api/plugins/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
function putReq(body: object) {
  return new NextRequest('http://localhost/api/plugins/mcp', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/plugins/mcp — write target', () => {
  it('writes the new MCP server to ~/.claude.json (NOT settings.json)', async () => {
    writeSettings({ env: { ANTHROPIC_BASE_URL: 'https://example.com' } });
    writeClaudeJson({ numStartups: 5 });

    const { POST } = await import('../../app/api/plugins/mcp/route');
    const res = await POST(postReq({
      name: 'pw',
      server: { command: 'npx', args: ['-y', '@playwright/mcp@latest'] },
    }));
    assert.equal(res.status, 200);

    // Lives in .claude.json — the only place the bundled binary reads
    const c = readClaudeJson();
    assert.deepEqual(c.mcpServers, {
      pw: { command: 'npx', args: ['-y', '@playwright/mcp@latest'] },
    });
    assert.equal(c.numStartups, 5, 'binary-owned state preserved');

    // settings.json mcpServers MUST stay empty/absent. The env block is preserved.
    const s = readSettings();
    assert.equal('mcpServers' in s, false, 'settings.json.mcpServers must not be written to');
    assert.deepEqual(s.env, { ANTHROPIC_BASE_URL: 'https://example.com' });
  });

  it('returns 409 when the name already exists in .claude.json', async () => {
    writeClaudeJson({
      mcpServers: { pw: { command: 'existing' } },
    });

    const { POST } = await import('../../app/api/plugins/mcp/route');
    const res = await POST(postReq({
      name: 'pw',
      server: { command: 'npx' },
    }));
    assert.equal(res.status, 409);
  });

  it('migrates legacy settings.json.mcpServers entries on first POST', async () => {
    writeSettings({
      mcpServers: { legacy_pw: { command: 'old-cmd' } },
    });
    writeClaudeJson({});

    const { POST } = await import('../../app/api/plugins/mcp/route');
    await POST(postReq({
      name: 'new_server',
      server: { command: 'new-cmd' },
    }));

    const c = readClaudeJson();
    assert.deepEqual(c.mcpServers, {
      legacy_pw: { command: 'old-cmd' },   // migrated from settings.json
      new_server: { command: 'new-cmd' },   // added by this POST
    });
    assert.equal('mcpServers' in readSettings(), false);
  });

  it('rejects stdio server with no command (400)', async () => {
    const { POST } = await import('../../app/api/plugins/mcp/route');
    const res = await POST(postReq({ name: 'nope', server: {} }));
    assert.equal(res.status, 400);
  });
});

describe('PUT /api/plugins/mcp — write target', () => {
  it('routes user-scope entries to .claude.json regardless of incoming _source tag', async () => {
    writeSettings({});
    writeClaudeJson({});

    const { PUT } = await import('../../app/api/plugins/mcp/route');
    const res = await PUT(putReq({
      mcpServers: {
        // Even with the legacy _source tag, the route must write to .claude.json
        a: { command: 'a-cmd', _source: 'legacy-settings.json' },
        b: { command: 'b-cmd', _source: 'claude.json' },
        c: { command: 'c-cmd' }, // no _source — default user-scope
      },
    }));
    assert.equal(res.status, 200);

    assert.deepEqual(readClaudeJson().mcpServers, {
      a: { command: 'a-cmd' },
      b: { command: 'b-cmd' },
      c: { command: 'c-cmd' },
    });
    assert.equal('mcpServers' in readSettings(), false);
  });

  it('persists project-scope enable/disable to settings.json.mcpServerOverrides only', async () => {
    writeSettings({});
    writeClaudeJson({});

    const { PUT } = await import('../../app/api/plugins/mcp/route');
    await PUT(putReq({
      mcpServers: {
        'chrome-devtools': { command: 'npx', _source: 'project', enabled: false },
      },
    }));

    const s = readSettings();
    assert.deepEqual(s.mcpServerOverrides, { 'chrome-devtools': { enabled: false } });
    // Project servers MUST NOT be copied into .claude.json (the file there
    // is canonical and would shadow the project version on next read).
    assert.deepEqual(readClaudeJson().mcpServers, {});
  });

  it('strips any lingering settings.json.mcpServers field on PUT', async () => {
    writeSettings({
      env: { FOO: 'bar' },
      mcpServers: { phantom: { command: 'leftover' } },
    });
    writeClaudeJson({});

    const { PUT } = await import('../../app/api/plugins/mcp/route');
    await PUT(putReq({
      mcpServers: {
        real: { command: 'real-cmd' },
      },
    }));

    const s = readSettings();
    assert.equal('mcpServers' in s, false, 'phantom entries must be cleared');
    assert.deepEqual(s.env, { FOO: 'bar' });
  });
});

describe('GET /api/plugins/mcp — read source merge', () => {
  it('returns user-scope MCPs with _source=claude.json and runs migration first', async () => {
    writeSettings({
      // Legacy stragglers — migration should move them out before GET reads
      mcpServers: { straggler: { command: 'old-cmd' } },
    });
    writeClaudeJson({
      mcpServers: { stable: { command: 'stable-cmd' } },
    });

    const { GET } = await import('../../app/api/plugins/mcp/route');
    const res = await GET();
    assert.equal(res.status, 200);
    const body = await res.json() as { mcpServers: Record<string, { _source?: string }> };

    assert.equal(body.mcpServers.stable._source, 'claude.json');
    assert.equal(body.mcpServers.straggler._source, 'claude.json',
      'after migration, all user-scope MCPs have _source=claude.json');

    // Filesystem reflects migration too
    assert.equal('mcpServers' in readSettings(), false);
  });
});
