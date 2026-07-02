/**
 * Tests for the per-request shadow ~/.claude/ used to isolate DB-provider
 * auth from cc-switch's settings.json env block.
 *
 * Acceptance scenarios (mirrored from the user-stated rules):
 *   1. env group + settings.json credentials → pass-through (real HOME)
 *   2. DB provider + settings.json credentials coexist → shadow built,
 *      stripped settings.json has no ANTHROPIC_*, but mcpServers /
 *      enabledPlugins / hooks / sub-directories survive
 *   3. DB provider but settings.json has NO auth keys → pass-through
 *   4. No settings.json on disk → pass-through
 *   5. Cleanup actually removes the temp dir
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
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-shadow-test-home-'));
  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;
});

afterEach(() => {
  if (originalHome !== undefined) process.env.HOME = originalHome; else delete process.env.HOME;
  if (originalUserProfile !== undefined) process.env.USERPROFILE = originalUserProfile; else delete process.env.USERPROFILE;
  try { fs.rmSync(tempHome, { recursive: true, force: true }); } catch { /* ignore */ }
});

function writeRealClaudeDir(layout: {
  settings?: Record<string, unknown>;
  /** Content for ~/.claude.json (root-level, NOT inside .claude/) */
  rootClaudeJson?: Record<string, unknown>;
  files?: Record<string, string>;
  dirs?: Record<string, Record<string, string>>;
}) {
  const dir = path.join(tempHome, '.claude');
  fs.mkdirSync(dir, { recursive: true });
  if (layout.settings !== undefined) {
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(layout.settings, null, 2));
  }
  if (layout.rootClaudeJson !== undefined) {
    // ~/.claude.json sits at HOME root, NOT inside ~/.claude/
    fs.writeFileSync(path.join(tempHome, '.claude.json'), JSON.stringify(layout.rootClaudeJson, null, 2));
  }
  for (const [name, content] of Object.entries(layout.files || {})) {
    fs.writeFileSync(path.join(dir, name), content);
  }
  for (const [dirName, contents] of Object.entries(layout.dirs || {})) {
    const subdir = path.join(dir, dirName);
    fs.mkdirSync(subdir, { recursive: true });
    for (const [filePath, body] of Object.entries(contents)) {
      // filePath may include a subdirectory like 'verifier-x/SKILL.md'
      const target = path.join(subdir, filePath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, body);
    }
  }
}

async function loadModule() {
  return await import('../../lib/claude-home-shadow');
}

describe('createShadowClaudeHome — provider-group ownership of credentials', () => {
  it('Scenario 1: env group → pass-through real HOME (cc-switch path stays intact)', async () => {
    writeRealClaudeDir({
      settings: { env: { ANTHROPIC_AUTH_TOKEN: 'sk-cc-switch', ANTHROPIC_BASE_URL: 'https://relay.example.com' } },
    });
    const { createShadowClaudeHome } = await loadModule();
    const shadow = createShadowClaudeHome({ stripAuth: false });
    try {
      assert.equal(shadow.isShadow, false, 'env group must NOT build a shadow');
      assert.equal(shadow.home, tempHome, 'env group must use real HOME');
    } finally { shadow.cleanup(); }
  });

  it('Scenario 2: DB provider + settings.json with auth → builds shadow, strips ANTHROPIC_*, preserves rest', async () => {
    writeRealClaudeDir({
      settings: {
        env: {
          ANTHROPIC_AUTH_TOKEN: 'sk-cc-switch-leak',
          ANTHROPIC_BASE_URL: 'https://relay.example.com',
          ANTHROPIC_MODEL: 'claude-sonnet-4-5',
          // Non-auth env that should survive
          DEBUG: '1',
          MY_CUSTOM_VAR: 'preserved',
        },
        // Non-env top-level fields that MUST be preserved
        mcpServers: {
          'user-mcp-foo': { command: 'foo', args: ['--bar'] },
        },
        enabledPlugins: { 'plugin-x': true },
        hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'true' }] }] },
        permissions: { allow: ['Read(*)'], deny: [] },
        apiKeyHelper: '/usr/local/bin/my-key-helper',
      },
    });
    const { createShadowClaudeHome } = await loadModule();
    const shadow = createShadowClaudeHome({ stripAuth: true });
    try {
      assert.equal(shadow.isShadow, true, 'DB-provider request with auth-bearing settings.json must build a shadow');
      assert.notEqual(shadow.home, tempHome, 'shadow HOME must differ from real HOME');

      const shadowSettingsPath = path.join(shadow.home, '.claude', 'settings.json');
      assert.ok(fs.existsSync(shadowSettingsPath), 'shadow settings.json must exist');
      const shadowSettings = JSON.parse(fs.readFileSync(shadowSettingsPath, 'utf-8')) as {
        env?: Record<string, string>;
        mcpServers?: Record<string, unknown>;
        enabledPlugins?: Record<string, unknown>;
        hooks?: unknown;
        permissions?: unknown;
        apiKeyHelper?: string;
      };

      // Auth keys must be GONE from env block
      assert.equal(shadowSettings.env?.ANTHROPIC_AUTH_TOKEN, undefined,
        'ANTHROPIC_AUTH_TOKEN must be stripped — DB provider auth would otherwise be overridden');
      assert.equal(shadowSettings.env?.ANTHROPIC_BASE_URL, undefined,
        'ANTHROPIC_BASE_URL must be stripped');
      assert.equal(shadowSettings.env?.ANTHROPIC_MODEL, undefined,
        'ANTHROPIC_MODEL must be stripped — provider catalog must win');

      // Non-auth env entries must survive
      assert.equal(shadowSettings.env?.DEBUG, '1', 'non-auth env (DEBUG) must survive');
      assert.equal(shadowSettings.env?.MY_CUSTOM_VAR, 'preserved', 'non-auth env (MY_CUSTOM_VAR) must survive');

      // Top-level user-scoped features must survive
      assert.deepEqual(shadowSettings.mcpServers, { 'user-mcp-foo': { command: 'foo', args: ['--bar'] } },
        'mcpServers must survive — user-installed MCP servers are critical');
      assert.deepEqual(shadowSettings.enabledPlugins, { 'plugin-x': true },
        'enabledPlugins must survive');
      assert.ok(shadowSettings.hooks, 'hooks must survive');
      assert.ok(shadowSettings.permissions, 'permissions must survive');
      assert.equal(shadowSettings.apiKeyHelper, '/usr/local/bin/my-key-helper',
        'apiKeyHelper must survive (it is non-env auth bridging logic, not the auth itself)');
    } finally { shadow.cleanup(); }
  });

  it('Scenario 2b: shadow preserves user-level skills/agents/commands via symlink (or copy fallback)', async () => {
    writeRealClaudeDir({
      settings: { env: { ANTHROPIC_AUTH_TOKEN: 'sk-leak' } },
      dirs: {
        skills: { 'verifier-x/SKILL.md': '# Verifier X skill' },
        agents: { 'planner.md': '# Planner agent' },
        commands: { 'do-thing.md': '# /do-thing command' },
        plugins: { 'foo/manifest.json': '{}' },
      },
    });
    const { createShadowClaudeHome } = await loadModule();
    const shadow = createShadowClaudeHome({ stripAuth: true });
    try {
      assert.equal(shadow.isShadow, true);

      // Through the shadow root, all user-level subdirectories must be reachable
      // (symlink on Unix, junction on Windows for dirs, copy fallback for files).
      const shadowClaude = path.join(shadow.home, '.claude');
      assert.ok(fs.existsSync(path.join(shadowClaude, 'skills', 'verifier-x', 'SKILL.md')),
        'user skills must remain reachable through shadow');
      assert.ok(fs.existsSync(path.join(shadowClaude, 'agents', 'planner.md')),
        'user agents must remain reachable');
      assert.ok(fs.existsSync(path.join(shadowClaude, 'commands', 'do-thing.md')),
        'user commands must remain reachable');
      assert.ok(fs.existsSync(path.join(shadowClaude, 'plugins', 'foo', 'manifest.json')),
        'user plugins must remain reachable');

      // Verify that the skills file content is the live content, not stale
      const live = fs.readFileSync(path.join(shadowClaude, 'skills', 'verifier-x', 'SKILL.md'), 'utf-8');
      assert.equal(live, '# Verifier X skill');
    } finally { shadow.cleanup(); }
  });

  it('Scenario 3: DB provider but settings.json has no auth keys → pass-through (no shadow needed)', async () => {
    writeRealClaudeDir({
      settings: {
        env: { DEBUG: '1' }, // no ANTHROPIC_*
        mcpServers: { 'foo': { command: 'foo' } },
      },
    });
    const { createShadowClaudeHome } = await loadModule();
    const shadow = createShadowClaudeHome({ stripAuth: true });
    try {
      assert.equal(shadow.isShadow, false,
        'no auth keys in settings.json env → no shadow needed (avoids unnecessary IO)');
      assert.equal(shadow.home, tempHome);
    } finally { shadow.cleanup(); }
  });

  it('Scenario 4: settings.json absent → pass-through', async () => {
    // Don't write any settings — just create empty .claude dir
    fs.mkdirSync(path.join(tempHome, '.claude'), { recursive: true });
    const { createShadowClaudeHome } = await loadModule();
    const shadow = createShadowClaudeHome({ stripAuth: true });
    try {
      assert.equal(shadow.isShadow, false);
      assert.equal(shadow.home, tempHome);
    } finally { shadow.cleanup(); }
  });

  it('Scenario 5: cleanup actually removes the temp dir', async () => {
    writeRealClaudeDir({
      settings: { env: { ANTHROPIC_AUTH_TOKEN: 'sk-leak' } },
    });
    const { createShadowClaudeHome } = await loadModule();
    const shadow = createShadowClaudeHome({ stripAuth: true });
    const shadowDir = shadow.home;
    assert.equal(shadow.isShadow, true);
    assert.ok(fs.existsSync(shadowDir), 'shadow dir exists pre-cleanup');
    shadow.cleanup();
    assert.ok(!fs.existsSync(shadowDir), 'shadow dir must be removed by cleanup');
    // double cleanup is a no-op
    shadow.cleanup();
  });

  // Regression for the P1 review finding: shadow HOME must mirror ~/.claude.json
  // (root-level, not inside .claude/), otherwise user-scoped MCP servers
  // defined there are silently lost when HOME points at the shadow root.
  it('Scenario 6: shadow mirrors ~/.claude.json (user-scoped MCP source)', async () => {
    writeRealClaudeDir({
      settings: { env: { ANTHROPIC_AUTH_TOKEN: 'sk-leak' } },
      rootClaudeJson: {
        // mcp-loader.ts:46 reads ~/.claude.json for user-scoped MCP servers
        mcpServers: {
          'user-mcp-from-root-claude-json': { command: '/usr/local/bin/foo', args: ['--bar'] },
        },
        // Some user installs also put telemetry/autoUpdate prefs here
        autoUpdaterStatus: 'enabled',
      },
    });
    const { createShadowClaudeHome } = await loadModule();
    const shadow = createShadowClaudeHome({ stripAuth: true });
    try {
      assert.equal(shadow.isShadow, true);
      const shadowRootClaudeJson = path.join(shadow.home, '.claude.json');
      assert.ok(fs.existsSync(shadowRootClaudeJson),
        'shadow HOME must contain a mirrored ~/.claude.json — without it, SDK reading from $HOME/.claude.json would silently lose user MCP servers');

      const mirrored = JSON.parse(fs.readFileSync(shadowRootClaudeJson, 'utf-8')) as {
        mcpServers?: Record<string, unknown>;
        autoUpdaterStatus?: string;
      };
      assert.deepEqual(
        mirrored.mcpServers,
        { 'user-mcp-from-root-claude-json': { command: '/usr/local/bin/foo', args: ['--bar'] } },
        'user MCP servers from ~/.claude.json must be preserved verbatim',
      );
      assert.equal(mirrored.autoUpdaterStatus, 'enabled',
        'unrelated top-level keys must survive');
    } finally { shadow.cleanup(); }
  });

  it('Scenario 6b: shadow strips ANTHROPIC_* from ~/.claude.json env block too', async () => {
    // Some users put auth env in ~/.claude.json instead of ~/.claude/settings.json.
    // Both files must be sanitized so neither leaks through to the subprocess.
    writeRealClaudeDir({
      settings: { env: { DEBUG: '1' } }, // settings.json has no auth
      rootClaudeJson: {
        env: {
          ANTHROPIC_AUTH_TOKEN: 'sk-leak-from-claude-json',
          ANTHROPIC_BASE_URL: 'https://leak.example.com',
          MY_VAR: 'kept',
        },
        mcpServers: { 'foo': { command: 'foo' } },
      },
    });
    const { createShadowClaudeHome } = await loadModule();
    const shadow = createShadowClaudeHome({ stripAuth: true });
    try {
      // Even though settings.json has no auth, .claude.json does → shadow must build
      assert.equal(shadow.isShadow, true,
        'shadow must build when EITHER settings.json OR .claude.json has auth env');

      const mirrored = JSON.parse(fs.readFileSync(path.join(shadow.home, '.claude.json'), 'utf-8')) as {
        env?: Record<string, string>;
        mcpServers?: unknown;
      };
      assert.equal(mirrored.env?.ANTHROPIC_AUTH_TOKEN, undefined, 'auth env stripped from .claude.json');
      assert.equal(mirrored.env?.ANTHROPIC_BASE_URL, undefined);
      assert.equal(mirrored.env?.MY_VAR, 'kept', 'non-auth env survives in .claude.json');
      assert.deepEqual(mirrored.mcpServers, { 'foo': { command: 'foo' } });
    } finally { shadow.cleanup(); }
  });

  it('Scenario 6c: ~/.claude.json absent → shadow does NOT create one (matches real-HOME semantics)', async () => {
    writeRealClaudeDir({
      settings: { env: { ANTHROPIC_AUTH_TOKEN: 'sk-leak' } },
      // no rootClaudeJson
    });
    const { createShadowClaudeHome } = await loadModule();
    const shadow = createShadowClaudeHome({ stripAuth: true });
    try {
      assert.equal(shadow.isShadow, true);
      assert.ok(!fs.existsSync(path.join(shadow.home, '.claude.json')),
        'when ~/.claude.json absent, shadow must NOT fabricate one — SDK should see the same "no file" state as real HOME');
    } finally { shadow.cleanup(); }
  });

  // Scenario 7 series: persistent cache dir mirroring (MCP browser/model downloads).
  // Without these, Playwright MCP downloads chrome-for-testing every request,
  // loses it at cleanup, and the next browser_navigate call fails with
  // "Browser X is not installed". See the file header for the full failure chain.
  it('Scenario 7a (darwin): ~/Library/Caches/ is symlinked into shadow root', async (t) => {
    if (process.platform !== 'darwin') {
      t.skip('darwin-only path layout');
      return;
    }
    // Pre-create the real cache dir with a sentinel file
    const realCaches = path.join(tempHome, 'Library', 'Caches');
    fs.mkdirSync(realCaches, { recursive: true });
    fs.writeFileSync(path.join(realCaches, 'sentinel.txt'), 'real-content');

    writeRealClaudeDir({ settings: { env: { ANTHROPIC_AUTH_TOKEN: 'sk-leak' } } });
    const { createShadowClaudeHome } = await loadModule();
    const shadow = createShadowClaudeHome({ stripAuth: true });
    try {
      assert.equal(shadow.isShadow, true);

      // The shadow root should have Library/Caches reachable via symlink
      const shadowCaches = path.join(shadow.home, 'Library', 'Caches');
      assert.ok(fs.existsSync(shadowCaches),
        'shadow Library/Caches must exist (via symlink) so MCP downloads land in real cache');

      // The sentinel from real cache must be readable through the shadow path
      const sentinel = fs.readFileSync(path.join(shadowCaches, 'sentinel.txt'), 'utf-8');
      assert.equal(sentinel, 'real-content',
        'reading through shadow path must show real cache contents');

      // Writes through the shadow path must land in real cache
      fs.writeFileSync(path.join(shadowCaches, 'new-from-shadow.txt'), 'written-via-shadow');
      const fromReal = fs.readFileSync(path.join(realCaches, 'new-from-shadow.txt'), 'utf-8');
      assert.equal(fromReal, 'written-via-shadow',
        'writes through shadow path must persist to real cache (this is the whole point of the symlink)');

      // Verify it's actually a symlink, not a copy
      const stat = fs.lstatSync(shadowCaches);
      assert.ok(stat.isSymbolicLink(),
        'shadow Library/Caches must be a symlink (not a copy) — otherwise writes don\'t reach real cache');
    } finally { shadow.cleanup(); }
  });

  it('Scenario 7b (darwin, CRITICAL): cleanup does NOT delete real ~/Library/Caches contents', async (t) => {
    if (process.platform !== 'darwin') {
      t.skip('darwin-only path layout');
      return;
    }
    // Set up real cache with a file that MUST survive cleanup
    const realCaches = path.join(tempHome, 'Library', 'Caches');
    fs.mkdirSync(realCaches, { recursive: true });
    const survivor = path.join(realCaches, 'must-survive.txt');
    fs.writeFileSync(survivor, 'real-data-that-must-not-be-deleted');

    writeRealClaudeDir({ settings: { env: { ANTHROPIC_AUTH_TOKEN: 'sk-leak' } } });
    const { createShadowClaudeHome } = await loadModule();
    const shadow = createShadowClaudeHome({ stripAuth: true });
    assert.equal(shadow.isShadow, true);
    const shadowRoot = shadow.home;

    // Write something through the shadow symlink (simulates MCP browser install)
    fs.writeFileSync(path.join(shadowRoot, 'Library', 'Caches', 'from-mcp.txt'), 'browser-binary-proxy');

    // CRITICAL: cleanup must remove only the shadow root, NOT follow symlinks
    shadow.cleanup();
    assert.ok(!fs.existsSync(shadowRoot), 'shadow root removed');

    // The sentinel in real cache MUST survive
    assert.ok(fs.existsSync(survivor),
      'cleanup() recursive remove must NOT follow the symlink and destroy real ~/Library/Caches/. ' +
      'If this fails, the entire user cache is being wiped each request — catastrophic data loss.');
    const surviving = fs.readFileSync(survivor, 'utf-8');
    assert.equal(surviving, 'real-data-that-must-not-be-deleted',
      'survivor content unchanged');

    // The file written through shadow must ALSO survive (it's in real cache now)
    const writtenViaShadow = path.join(realCaches, 'from-mcp.txt');
    assert.ok(fs.existsSync(writtenViaShadow),
      'writes through shadow symlink must persist in real cache after cleanup ' +
      '(this is the whole point — MCP browser binaries must outlive the request)');
  });

  it('Scenario 7c (linux): ~/.cache/ is symlinked into shadow root', async (t) => {
    if (process.platform !== 'linux') {
      t.skip('linux-only path layout');
      return;
    }
    const realCache = path.join(tempHome, '.cache');
    fs.mkdirSync(realCache, { recursive: true });
    fs.writeFileSync(path.join(realCache, 'sentinel.txt'), 'real-content');

    writeRealClaudeDir({ settings: { env: { ANTHROPIC_AUTH_TOKEN: 'sk-leak' } } });
    const { createShadowClaudeHome } = await loadModule();
    const shadow = createShadowClaudeHome({ stripAuth: true });
    try {
      assert.equal(shadow.isShadow, true);
      const shadowCache = path.join(shadow.home, '.cache');
      assert.ok(fs.existsSync(shadowCache), 'shadow .cache must exist via symlink');
      assert.equal(fs.readFileSync(path.join(shadowCache, 'sentinel.txt'), 'utf-8'), 'real-content');
      assert.ok(fs.lstatSync(shadowCache).isSymbolicLink(), 'shadow .cache must be a symlink');
    } finally { shadow.cleanup(); }
  });

  it('Scenario 7e (darwin/linux): ~/.npm is symlinked so npx-launched MCP servers reuse the warm cache', async (t) => {
    // Regression: a project .mcp.json using `npx -y @playwright/mcp@latest`
    // re-downloads into $HOME/.npm under a cold shadow and exceeds the 30s MCP
    // connection timeout. Mirroring ~/.npm makes npx hit the real warm cache.
    if (process.platform === 'win32') {
      t.skip('npm cache lives under AppData on win32, already covered by AppData/Local');
      return;
    }
    const realNpm = path.join(tempHome, '.npm');
    fs.mkdirSync(realNpm, { recursive: true });
    fs.writeFileSync(path.join(realNpm, 'sentinel.txt'), 'real-npx-cache');

    writeRealClaudeDir({ settings: { env: { ANTHROPIC_AUTH_TOKEN: 'sk-leak' } } });
    const { createShadowClaudeHome } = await loadModule();
    const shadow = createShadowClaudeHome({ stripAuth: true });
    try {
      assert.equal(shadow.isShadow, true);
      const shadowNpm = path.join(shadow.home, '.npm');
      assert.ok(fs.existsSync(shadowNpm), 'shadow .npm must exist via symlink so npx reuses the warm cache');
      assert.ok(fs.lstatSync(shadowNpm).isSymbolicLink(), 'shadow .npm must be a symlink (not a copy)');
      assert.equal(fs.readFileSync(path.join(shadowNpm, 'sentinel.txt'), 'utf-8'), 'real-npx-cache');
    } finally { shadow.cleanup(); }
  });

  it('Scenario 7d: missing persist dir is silently skipped (no error)', async () => {
    // Don't pre-create Library/Caches — should just skip, not crash
    writeRealClaudeDir({ settings: { env: { ANTHROPIC_AUTH_TOKEN: 'sk-leak' } } });
    const { createShadowClaudeHome } = await loadModule();
    const shadow = createShadowClaudeHome({ stripAuth: true });
    try {
      assert.equal(shadow.isShadow, true, 'shadow still built even if persist dirs are missing');
      // No symlinks should exist for missing dirs
      if (process.platform === 'darwin') {
        assert.ok(!fs.existsSync(path.join(shadow.home, 'Library', 'Caches')),
          'no symlink created for non-existent real dir');
      }
    } finally { shadow.cleanup(); }
  });
});

describe('settingsJsonHasAuthOverride — quick predicate', () => {
  it('returns true when settings.json env has any ANTHROPIC_* key', async () => {
    writeRealClaudeDir({ settings: { env: { ANTHROPIC_AUTH_TOKEN: 'x' } } });
    const { settingsJsonHasAuthOverride } = await loadModule();
    assert.equal(settingsJsonHasAuthOverride(), true);
  });

  it('returns false for empty env block', async () => {
    writeRealClaudeDir({ settings: { env: {} } });
    const { settingsJsonHasAuthOverride } = await loadModule();
    assert.equal(settingsJsonHasAuthOverride(), false);
  });

  it('returns false for env block with only non-auth keys', async () => {
    writeRealClaudeDir({ settings: { env: { DEBUG: '1', NODE_OPTIONS: '--no-warnings' } } });
    const { settingsJsonHasAuthOverride } = await loadModule();
    assert.equal(settingsJsonHasAuthOverride(), false);
  });

  it('returns false when no settings.json on disk', async () => {
    fs.mkdirSync(path.join(tempHome, '.claude'), { recursive: true });
    const { settingsJsonHasAuthOverride } = await loadModule();
    assert.equal(settingsJsonHasAuthOverride(), false);
  });

  it('returns true when ~/.claude.json (root-level) has auth env, even if settings.json is clean', async () => {
    writeRealClaudeDir({
      settings: { env: { DEBUG: '1' } },
      rootClaudeJson: { env: { ANTHROPIC_AUTH_TOKEN: 'sk-from-root' } },
    });
    const { settingsJsonHasAuthOverride } = await loadModule();
    assert.equal(settingsJsonHasAuthOverride(), true,
      'detector must inspect ~/.claude.json env block too — that file is also a documented user-scoped config source (mcp-loader.ts:46)');
  });
});

/**
 * Regression guard for the shadow-cleanup data-loss bug.
 *
 * The shadow tree links real ~/.claude subdirectories (skills, agents, plugins,
 * ...) in via symlinks (Unix) / junctions (Windows). The old cleanup did
 * `fs.rmSync(shadowRoot, { recursive: true })`, which on Windows DESCENDS
 * THROUGH directory junctions and deletes the user's real files. The fix uses
 * `safeRmRecursive`, which lstat's every node and detaches links instead of
 * recursing into them.
 *
 * Note on platform coverage: the original bug only manifests on Windows
 * (junction-following). On macOS/Linux `fs.rmSync(recursive)` already does NOT
 * follow symlinks, so the "preserve real data" tests pass for BOTH old and new
 * code here — they are regression guards (they FAIL with the old code on
 * Windows) and they positively exercise the new link-detachment logic. The
 * source-guard test is platform-independent. Real Windows verification is
 * documented in the handover doc.
 */
describe('shadow cleanup — must never delete through symlinks/junctions (data-loss regression)', () => {
  function makeDirLink(realTarget: string, linkPath: string) {
    // Mirror mirrorEntry(): junction for dirs on Windows, plain symlink elsewhere.
    if (process.platform === 'win32') {
      fs.symlinkSync(realTarget, linkPath, 'junction');
    } else {
      fs.symlinkSync(realTarget, linkPath);
    }
  }

  it('safeRmRecursive removes a real nested tree completely (cleanup still works)', async () => {
    const { safeRmRecursive } = await loadModule();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-saferm-tree-'));
    fs.mkdirSync(path.join(root, 'a', 'b'), { recursive: true });
    fs.writeFileSync(path.join(root, 'a', 'b', 'f.txt'), 'x');
    fs.writeFileSync(path.join(root, 'top.txt'), 'y');
    safeRmRecursive(root);
    assert.ok(!fs.existsSync(root), 'safeRmRecursive must remove the whole real throwaway tree');
  });

  it('safeRmRecursive detaches a linked dir WITHOUT deleting the target contents', async () => {
    const { safeRmRecursive } = await loadModule();
    // The "real" user data we must never touch.
    const realData = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-saferm-real-'));
    fs.mkdirSync(path.join(realData, 'skills', 'x'), { recursive: true });
    fs.writeFileSync(path.join(realData, 'skills', 'x', 'SKILL.md'), '# do not delete me');

    // The throwaway "shadow" that links the real skills dir in.
    const shadow = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-saferm-shadow-'));
    makeDirLink(path.join(realData, 'skills'), path.join(shadow, 'skills'));
    fs.writeFileSync(path.join(shadow, 'settings.json'), '{}'); // a real file we own

    safeRmRecursive(shadow);

    assert.ok(!fs.existsSync(shadow), 'shadow must be removed');
    assert.ok(
      fs.existsSync(path.join(realData, 'skills', 'x', 'SKILL.md')),
      'real ~/.claude/skills content must NOT be deleted through the link',
    );
    assert.equal(
      fs.readFileSync(path.join(realData, 'skills', 'x', 'SKILL.md'), 'utf-8'),
      '# do not delete me',
    );

    fs.rmSync(realData, { recursive: true, force: true }); // fixture is a real dir (no links left)
  });

  it('full flow: createShadowClaudeHome().cleanup() preserves real ~/.claude subdirectories', async () => {
    writeRealClaudeDir({
      settings: { env: { ANTHROPIC_AUTH_TOKEN: 'sk-leak' } },
      dirs: {
        skills: { 'verifier-x/SKILL.md': '# Verifier X skill' },
        agents: { 'planner.md': '# Planner agent' },
        plugins: { 'foo/manifest.json': '{}' },
      },
    });
    const { createShadowClaudeHome } = await loadModule();
    const shadow = createShadowClaudeHome({ stripAuth: true });
    assert.equal(shadow.isShadow, true);
    shadow.cleanup();

    const realClaude = path.join(tempHome, '.claude');
    assert.ok(fs.existsSync(path.join(realClaude, 'skills', 'verifier-x', 'SKILL.md')),
      'real skills must survive shadow cleanup');
    assert.ok(fs.existsSync(path.join(realClaude, 'agents', 'planner.md')),
      'real agents must survive shadow cleanup');
    assert.ok(fs.existsSync(path.join(realClaude, 'plugins', 'foo', 'manifest.json')),
      'real plugins must survive shadow cleanup');
    assert.equal(
      fs.readFileSync(path.join(realClaude, 'skills', 'verifier-x', 'SKILL.md'), 'utf-8'),
      '# Verifier X skill', 'real skill content must be byte-for-byte intact');
  });

  it('source guard: cleanup must NOT fs.rmSync(shadowRoot) and MUST use safeRmRecursive', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src/lib/claude-home-shadow.ts'), 'utf-8');
    assert.ok(!/fs\.rmSync\(\s*shadowRoot/.test(src),
      'shadow cleanup must NOT call fs.rmSync(shadowRoot, ...) — it follows junctions on Windows and deletes real ~/.claude data');
    assert.match(src, /safeRmRecursive\(shadowRoot\)/,
      'cleanup must use safeRmRecursive(), which detaches links instead of recursing through them');
  });
});
