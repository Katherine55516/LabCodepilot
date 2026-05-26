/**
 * Unit tests for electron/gsd-installer.ts — vendor GSD bundle sync logic.
 *
 * Strategy:
 * - Use vendor/gsd-bundle/ in the repo as the read-only "bundle fixture" (it's
 *   produced deterministically by `npm run vendor:gsd`).
 * - mkdtempSync gives each test an isolated fake $HOME root.
 * - Inject paths via the InstallerPaths argument; never touch the real
 *   ~/.claude/.
 *
 * Run with: npx tsx --test src/__tests__/unit/gsd-installer.test.ts
 */

import { describe, it, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  install,
  resync,
  disable,
  enable,
  uninstall,
  getStatus,
  readManifest,
  readBundledVersion,
  type InstallerPaths,
} from '../../../electron/gsd-installer';

// ── fixtures ──

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const BUNDLE_FIXTURE = path.join(REPO_ROOT, 'vendor', 'gsd-bundle');

function buildPaths(homeRoot: string): InstallerPaths {
  return {
    bundleDir: BUNDLE_FIXTURE,
    installPath: path.join(
      homeRoot,
      '.claude',
      'plugins',
      'external_plugins',
      'codepilot-gsd-vendor',
    ),
    agentsMirrorPath: path.join(homeRoot, '.claude', 'agents'),
    commandsMirrorPath: path.join(homeRoot, '.claude', 'commands'),
  };
}

let tmpHome: string;
let paths: InstallerPaths;

// Bundle is gitignored (regenerated on demand). On CI, vendor/gsd-bundle/
// is not present after a fresh checkout, so the suite self-bootstraps once
// at module load by invoking the same prepare script the build pipeline uses.
before(() => {
  if (!fs.existsSync(BUNDLE_FIXTURE)) {
    const script = path.join(REPO_ROOT, 'scripts', 'vendor-gsd-prepare.js');
    execFileSync(process.execPath, [script], {
      cwd: REPO_ROOT,
      stdio: 'inherit',
    });
  }
  if (!fs.existsSync(BUNDLE_FIXTURE)) {
    throw new Error(
      `vendor/gsd-bundle/ still missing after running prepare script — check vendor/gsd-source/`,
    );
  }
});

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-installer-test-'));
  paths = buildPaths(tmpHome);
});

afterEach(() => {
  try {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

// ── tests ──

describe('gsd-installer / bundle metadata', () => {
  it('reads plugin.json with expected fields', () => {
    const m = readManifest(BUNDLE_FIXTURE);
    assert.ok(m, 'manifest should exist');
    assert.equal(m!.name, 'codepilot-gsd-vendor');
    assert.equal(m!.commandPrefix, 'gsd-');
    assert.equal(m!.commandCount, 67);
    assert.equal(m!.agentCount, 33);
    assert.equal(m!.license, 'MIT');
  });

  it('reads VERSION file', () => {
    const v = readBundledVersion(BUNDLE_FIXTURE);
    assert.ok(v, 'VERSION should exist');
    assert.match(v!, /^[0-9a-f]{7,12}-v\d+$/);
  });
});

describe('gsd-installer / first install', () => {
  it('creates plugin dir with commands + agents + LICENSE + plugin.json + VERSION', () => {
    const status = install({ paths });
    assert.equal(status.installed, true);
    assert.equal(status.needsSync, false, 'needsSync should be false post-install');
    assert.equal(status.bundledVersion, status.installedVersion);
    assert.equal(status.lastError, undefined);

    const cmdDir = path.join(paths.installPath, 'commands');
    const agentsDir = path.join(paths.installPath, 'agents');
    assert.ok(fs.existsSync(cmdDir), 'commands/ should exist');
    assert.ok(fs.existsSync(agentsDir), 'agents/ should exist');
    assert.ok(fs.existsSync(path.join(paths.installPath, 'LICENSE')));
    assert.ok(fs.existsSync(path.join(paths.installPath, 'plugin.json')));
    assert.ok(fs.existsSync(path.join(paths.installPath, 'VERSION')));

    const commands = fs.readdirSync(cmdDir).filter((n) => n.endsWith('.md'));
    const agents = fs.readdirSync(agentsDir).filter((n) => n.endsWith('.md'));
    assert.equal(commands.length, 67);
    assert.equal(agents.length, 33);

    // ns-* should have been renamed by transform; verify a sample
    assert.ok(commands.includes('gsd-context.md'), 'gsd-context.md should exist (renamed from ns-context)');
    assert.ok(commands.includes('gsd-debug.md'));
    assert.ok(!commands.includes('gsd-ns-context.md'), 'gsd-ns-context.md should NOT exist');
  });

  it('does NOT include transform-report.json on user disk', () => {
    install({ paths });
    assert.equal(
      fs.existsSync(path.join(paths.installPath, 'transform-report.json')),
      false,
      'transform-report is build-time debug artifact, not for users',
    );
  });

  it('mirrors agents to ~/.claude/agents/', () => {
    install({ paths });
    const mirrored = fs
      .readdirSync(paths.agentsMirrorPath)
      .filter((n) => n.endsWith('.md'));
    assert.equal(mirrored.length, 33);
    assert.ok(mirrored.includes('gsd-debugger.md'));
  });

  // Without this mirror, /gsd-* commands show in the popover but the SDK
  // doesn't know what they are at execution time — chat just no-ops.
  it('mirrors commands to ~/.claude/commands/ so the SDK can execute them', () => {
    install({ paths });
    const mirrored = fs
      .readdirSync(paths.commandsMirrorPath)
      .filter((n) => n.endsWith('.md'));
    assert.equal(mirrored.length, 67);
    assert.ok(mirrored.includes('gsd-debug.md'));
    assert.ok(mirrored.includes('gsd-new-project.md'));
  });

  // Edge case: when an existing v1/v2 install ships without the commands
  // mirror feature, the next launch (version still matches) must still
  // backfill the missing files. Otherwise upgrades silently leave users
  // broken.
  it('backfills missing command mirror even when version is up-to-date', () => {
    install({ paths });
    // Simulate: user deleted the mirror directory manually
    fs.rmSync(paths.commandsMirrorPath, { recursive: true, force: true });
    // And the version stamps already match → status.needsSync would be false
    const status = install({ paths });
    assert.equal(status.needsSync, false, 'precondition: version matches');
    const restored = fs
      .readdirSync(paths.commandsMirrorPath)
      .filter((n) => n.endsWith('.md'));
    assert.equal(restored.length, 67, 'mirror should be restored despite no-op sync');
  });
});

describe('gsd-installer / version idempotency', () => {
  it('second install() when version matches is a no-op for commands/', () => {
    install({ paths });
    const cmdFile = path.join(paths.installPath, 'commands', 'gsd-debug.md');
    const mtimeBefore = fs.statSync(cmdFile).mtimeMs;

    // Wait a tiny bit so any rewrite would change mtime
    const status = install({ paths });
    assert.equal(status.needsSync, false);
    const mtimeAfter = fs.statSync(cmdFile).mtimeMs;
    assert.equal(mtimeAfter, mtimeBefore, 'no-op install should not touch files');
  });

  it('resync() forces overwrite even when version matches', () => {
    install({ paths });
    const cmdFile = path.join(paths.installPath, 'commands', 'gsd-debug.md');
    // Mutate file to detect overwrite
    fs.writeFileSync(cmdFile, 'TAMPERED', 'utf-8');
    assert.equal(fs.readFileSync(cmdFile, 'utf-8'), 'TAMPERED');

    resync({ paths });
    assert.notEqual(
      fs.readFileSync(cmdFile, 'utf-8'),
      'TAMPERED',
      'resync should overwrite',
    );
  });

  it('version mismatch triggers sync on next install()', () => {
    install({ paths });
    // Tamper VERSION to simulate a stale install (older version on disk)
    fs.writeFileSync(
      path.join(paths.installPath, 'VERSION'),
      'oldcommit-v0\n',
      'utf-8',
    );
    const cmdFile = path.join(paths.installPath, 'commands', 'gsd-debug.md');
    fs.writeFileSync(cmdFile, 'STALE', 'utf-8');

    const status = install({ paths });
    assert.equal(status.needsSync, false, 'after sync needsSync should be false');
    assert.notEqual(
      fs.readFileSync(cmdFile, 'utf-8'),
      'STALE',
      'mismatched version should trigger overwrite',
    );
  });
});

describe('gsd-installer / extras preservation', () => {
  it('preserves extras/ subdirectory across resync', () => {
    install({ paths });
    const extrasDir = path.join(paths.installPath, 'extras');
    fs.mkdirSync(extrasDir, { recursive: true });
    fs.writeFileSync(path.join(extrasDir, 'my-note.md'), 'user note', 'utf-8');

    resync({ paths });
    const extrasFile = path.join(extrasDir, 'my-note.md');
    assert.ok(fs.existsSync(extrasFile), 'extras file should survive resync');
    assert.equal(fs.readFileSync(extrasFile, 'utf-8'), 'user note');
  });
});

describe('gsd-installer / agents mirror conflicts', () => {
  it('skips mirror when target hash already matches', () => {
    install({ paths });
    const dst = path.join(paths.agentsMirrorPath, 'gsd-debugger.md');
    const beforeMtime = fs.statSync(dst).mtimeMs;
    // Second install: hash matches → skip
    const status = install({ paths });
    assert.equal(status.conflicts.length, 0);
    assert.equal(fs.statSync(dst).mtimeMs, beforeMtime, 'should not rewrite');
  });

  it('records conflict + leaves file untouched when user-modified', () => {
    // Pre-seed user-modified agent
    fs.mkdirSync(paths.agentsMirrorPath, { recursive: true });
    const dst = path.join(paths.agentsMirrorPath, 'gsd-debugger.md');
    fs.writeFileSync(dst, '# USER CUSTOM', 'utf-8');

    const status = resync({ paths });
    assert.ok(status.conflicts.length >= 1);
    const conflict = status.conflicts.find((c) => c.agentName === 'gsd-debugger');
    assert.ok(conflict, 'should record gsd-debugger conflict');
    assert.equal(conflict!.reason, 'hash-mismatch');
    assert.equal(
      fs.readFileSync(dst, 'utf-8'),
      '# USER CUSTOM',
      'user file must not be overwritten',
    );
  });
});

describe('gsd-installer / disable / enable', () => {
  it('disable() renames commands/ -> commands.disabled/ + writes .disabled', () => {
    install({ paths });
    const status = disable({ paths });
    assert.equal(status.enabled, false);
    assert.ok(fs.existsSync(path.join(paths.installPath, '.disabled')));
    assert.ok(fs.existsSync(path.join(paths.installPath, 'commands.disabled')));
    assert.ok(!fs.existsSync(path.join(paths.installPath, 'commands')));
  });

  it('install() is no-op when disabled', () => {
    install({ paths });
    disable({ paths });

    // Tamper VERSION to simulate version drift; install should still skip
    fs.writeFileSync(
      path.join(paths.installPath, 'VERSION'),
      'oldcommit-v0\n',
      'utf-8',
    );
    const status = install({ paths });
    assert.equal(status.enabled, false);
    assert.equal(
      readBundledVersion(paths.installPath),
      'oldcommit-v0',
      'should NOT have overwritten VERSION while disabled',
    );
  });

  it('enable() restores commands/ + removes .disabled + re-syncs', () => {
    install({ paths });
    disable({ paths });
    const status = enable({ paths });
    assert.equal(status.enabled, true);
    assert.ok(fs.existsSync(path.join(paths.installPath, 'commands')));
    assert.ok(!fs.existsSync(path.join(paths.installPath, '.disabled')));
    assert.ok(!fs.existsSync(path.join(paths.installPath, 'commands.disabled')));
  });
});

describe('gsd-installer / uninstall', () => {
  it('removes installPath entirely', () => {
    install({ paths });
    assert.ok(fs.existsSync(paths.installPath));
    uninstall({ paths });
    assert.ok(!fs.existsSync(paths.installPath));
  });

  it('removes mirrored agents that still match bundle hash', () => {
    install({ paths });
    const dst = path.join(paths.agentsMirrorPath, 'gsd-debugger.md');
    assert.ok(fs.existsSync(dst));
    uninstall({ paths });
    assert.ok(!fs.existsSync(dst), 'unmodified mirrored agent should be removed');
  });

  it('removes mirrored commands that still match bundle hash', () => {
    install({ paths });
    const dst = path.join(paths.commandsMirrorPath, 'gsd-debug.md');
    assert.ok(fs.existsSync(dst));
    uninstall({ paths });
    assert.ok(!fs.existsSync(dst), 'unmodified mirrored command should be removed');
  });

  it('preserves user-modified mirrored commands on uninstall', () => {
    install({ paths });
    const dst = path.join(paths.commandsMirrorPath, 'gsd-debug.md');
    fs.writeFileSync(dst, '# USER EDITED AFTER INSTALL', 'utf-8');
    uninstall({ paths });
    assert.ok(fs.existsSync(dst), 'user-modified mirror should remain');
    assert.equal(
      fs.readFileSync(dst, 'utf-8'),
      '# USER EDITED AFTER INSTALL',
      'content untouched',
    );
  });

  it('preserves user-modified mirrored agents on uninstall', () => {
    install({ paths });
    const dst = path.join(paths.agentsMirrorPath, 'gsd-debugger.md');
    fs.writeFileSync(dst, '# USER EDITED AFTER INSTALL', 'utf-8');
    uninstall({ paths });
    assert.ok(fs.existsSync(dst), 'modified agent must be preserved');
    assert.equal(fs.readFileSync(dst, 'utf-8'), '# USER EDITED AFTER INSTALL');
  });
});

describe('gsd-installer / getStatus', () => {
  it('reports installed=false before first install', () => {
    const status = getStatus(paths);
    assert.equal(status.installed, false);
    assert.equal(status.installedVersion, null);
    assert.equal(status.needsSync, true, 'needsSync=true when bundle present but install missing');
    assert.equal(status.enabled, true, 'enabled defaults to true when no install yet');
  });

  it('reports needsSync=false after install', () => {
    install({ paths });
    const status = getStatus(paths);
    assert.equal(status.installed, true);
    assert.equal(status.needsSync, false);
  });
});
