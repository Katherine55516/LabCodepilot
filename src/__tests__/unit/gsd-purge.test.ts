/**
 * Tests for electron/gsd-purge.ts — the one-shot cleanup of the retired
 * vendor-bundled GSD plugin.
 *
 * The suite builds a synthetic ~/.claude tree per test rather than leaning on
 * a real bundle fixture: the vendor pipeline and gsd-source snapshot were
 * removed along with the plugin, so there is nothing left to generate one from.
 *
 * The shapes that matter are the four kinds of user on disk today:
 *   1. v3 user      — every mirrored file matches the manifest hash
 *   2. v1/v2 user   — same paths, older content (three transform generations
 *                     shipped inside a four-hour window on 2026-05-26, and the
 *                     old mirror refused to overwrite a hash mismatch)
 *   3. edited user  — same paths, user's own content
 *   4. official user — has their own get-shit-done install alongside ours
 *
 * Shapes 2 and 3 are exactly what hash-only matching would strand on disk
 * forever, so they get the most attention here.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

import {
  purge,
  pruneEmptyDirs,
  detectOfficialInstall,
  defaultPurgePaths,
  type PurgePaths,
  type PurgeManifest,
} from '../../../electron/gsd-purge';

// ────────────────────────── fixture helpers ──────────────────────────

const sha1 = (s: string) => crypto.createHash('sha1').update(s).digest('hex');

/** Bundle content keyed the way the real manifest keys it. */
const BUNDLE = {
  commands: {
    'gsd-debug.md': 'command body: debug\n',
    'gsd-plan-phase.md': 'command body: plan\n',
  },
  agents: {
    'gsd-debugger.md': 'agent body: debugger\n',
    'gsd-planner.md': 'agent body: planner\n',
  },
  assets: {
    'workflows/execute-phase/steps/run.md': 'asset: run\n',
    'workflows/discuss-phase/modes/ask.md': 'asset: ask\n',
    'references/style.md': 'asset: style\n',
    'bin/lib/installer-migrations/000-baseline.cjs': '// asset: baseline\n',
  },
} as const;

function buildManifest(): PurgeManifest {
  const mapHashes = (o: Record<string, string>) =>
    Object.fromEntries(Object.entries(o).map(([k, v]) => [k, sha1(v)]));
  return {
    sourceCommit: 'deadbeef',
    transformVersion: 3,
    bundleVersion: 'deadbeef-v3',
    counts: { commands: 2, agents: 2, assets: 4 },
    commands: mapHashes(BUNDLE.commands),
    agents: mapHashes(BUNDLE.agents),
    assets: mapHashes(BUNDLE.assets),
  };
}

let home: string;

function paths(): PurgePaths {
  const p = defaultPurgePaths(home);
  return { ...p, manifestPath: path.join(home, 'manifest.json') };
}

function write(file: string, body: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body, 'utf-8');
}

interface SeedOptions {
  /** 'exact' = v3 user, 'stale' = v1/v2 user, 'edited' = hand-modified. */
  variant?: 'exact' | 'stale' | 'edited';
  withAssets?: boolean;
  /** Adds the official-install signals. */
  official?: boolean;
  /** GSD runtime output that was never part of the bundle. */
  userProfile?: boolean;
}

function seed(opts: SeedOptions = {}): void {
  const { variant = 'exact', withAssets = true, official = false, userProfile = false } = opts;
  const p = paths();
  const body = (original: string) =>
    variant === 'exact'
      ? original
      : variant === 'stale'
        ? original.replace('body', 'body v1').replace('asset', 'asset v1')
        : `${original}\n<!-- user edit -->\n`;

  // plugin dir (app-owned)
  write(path.join(p.pluginDir, 'VERSION'), 'deadbeef-v3\n');
  write(path.join(p.pluginDir, 'plugin.json'), '{}\n');
  write(path.join(p.pluginDir, 'commands', 'gsd-debug.md'), 'x\n');

  for (const [name, content] of Object.entries(BUNDLE.commands)) {
    write(path.join(p.commandsDir, name), body(content));
  }
  for (const [name, content] of Object.entries(BUNDLE.agents)) {
    write(path.join(p.agentsDir, name), body(content));
  }
  if (withAssets) {
    for (const [rel, content] of Object.entries(BUNDLE.assets)) {
      write(path.join(p.assetsDir, ...rel.split('/')), body(content));
    }
  }
  if (userProfile) {
    write(path.join(p.assetsDir, 'USER-PROFILE.md'), 'the user profile\n');
  }
  if (official) {
    // Official layout: namespaced commands dir + skills subtree. Neither was
    // ever produced by our vendor pipeline.
    write(path.join(p.commandsDir, 'gsd', 'debug.md'), 'official command\n');
    write(path.join(p.assetsDir, 'skills', 'thing', 'SKILL.md'), 'official skill\n');
  }
  fs.writeFileSync(path.join(home, 'manifest.json'), JSON.stringify(buildManifest()), 'utf-8');
}

const exists = (...seg: string[]) => fs.existsSync(path.join(...seg));

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-purge-'));
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

// ────────────────────────── suites ──────────────────────────

describe('gsd-purge / v3 user (every file hash-matches)', () => {
  it('removes the plugin dir, all mirrors, and the empty scaffolding', () => {
    seed({ variant: 'exact' });
    const p = paths();
    const r = purge({ paths: p });

    assert.equal(r.ran, true);
    assert.equal(r.pluginDirRemoved, true);
    assert.equal(r.commandsRemoved, 2);
    assert.equal(r.agentsRemoved, 2);
    assert.equal(r.assetsRemoved, 4);
    assert.equal(r.errors.length, 0);
    assert.equal(r.markerWritten, true);

    assert.equal(fs.existsSync(p.pluginDir), false);
    assert.equal(fs.existsSync(p.assetsDir), false, 'get-shit-done/ should be gone entirely');
    assert.deepEqual(fs.readdirSync(p.commandsDir), []);
    assert.deepEqual(fs.readdirSync(p.agentsDir), []);
  });

  it('prunes nested empty directories, not just the root', () => {
    seed({ variant: 'exact' });
    const p = paths();
    purge({ paths: p });
    // bin/lib/installer-migrations was three levels deep.
    assert.equal(exists(p.assetsDir, 'bin'), false);
    assert.equal(exists(p.assetsDir, 'workflows', 'execute-phase', 'steps'), false);
  });
});

describe('gsd-purge / v1-v2 user (stale content, hashes differ)', () => {
  it('still removes everything — path membership, not hash', () => {
    seed({ variant: 'stale' });
    const p = paths();
    const r = purge({ paths: p });

    assert.equal(r.commandsRemoved, 2, 'flat gsd-*.md is ours regardless of content');
    assert.equal(r.agentsRemoved, 2, 'no official install → name-based removal');
    assert.equal(r.assetsRemoved, 4, 'no official install → path-based removal');
    assert.equal(r.keptForOfficial, 0);
    assert.equal(fs.existsSync(p.assetsDir), false);
  });
});

describe('gsd-purge / hand-edited user', () => {
  it('removes edited mirrors too, since the framework is gone', () => {
    seed({ variant: 'edited' });
    const r = purge({ paths: paths() });
    assert.equal(r.commandsRemoved, 2);
    assert.equal(r.agentsRemoved, 2);
    assert.equal(r.assetsRemoved, 4);
  });
});

describe('gsd-purge / user with an independent official GSD install', () => {
  it('detects the install from either signal', () => {
    seed({ official: true });
    assert.equal(detectOfficialInstall(paths()), true);
  });

  it('still removes what is unambiguously ours', () => {
    seed({ variant: 'stale', official: true });
    const p = paths();
    const r = purge({ paths: p });

    assert.equal(r.officialInstallDetected, true);
    assert.equal(r.pluginDirRemoved, true, 'codepilot- prefix is ours alone');
    assert.equal(r.commandsRemoved, 2, 'flat gsd-*.md is ours alone');
    // The official namespaced command must survive untouched.
    assert.equal(exists(p.commandsDir, 'gsd', 'debug.md'), true);
  });

  it('spares agents and assets whose hashes do not match the bundle', () => {
    seed({ variant: 'stale', official: true });
    const p = paths();
    const r = purge({ paths: p });

    assert.equal(r.agentsRemoved, 0);
    assert.equal(r.assetsRemoved, 0);
    assert.equal(r.keptForOfficial, 6, '2 agents + 4 assets left alone');
    assert.equal(exists(p.agentsDir, 'gsd-debugger.md'), true);
    assert.equal(exists(p.assetsDir, 'references', 'style.md'), true);
    assert.equal(exists(p.assetsDir, 'skills', 'thing', 'SKILL.md'), true);
  });

  it('removes hash-exact files even when an official install is present', () => {
    seed({ variant: 'exact', official: true });
    const r = purge({ paths: paths() });
    assert.equal(r.agentsRemoved, 2);
    assert.equal(r.assetsRemoved, 4);
    assert.equal(r.keptForOfficial, 0);
  });
});

describe('gsd-purge / files that are not ours', () => {
  it('keeps GSD runtime output such as USER-PROFILE.md', () => {
    seed({ variant: 'exact', userProfile: true });
    const p = paths();
    const r = purge({ paths: p });

    assert.equal(r.assetsRemoved, 4);
    assert.equal(r.keptUnknown, 1);
    assert.equal(exists(p.assetsDir, 'USER-PROFILE.md'), true);
    assert.equal(exists(p.assetsDir, 'references'), false, 'emptied dirs still pruned around it');
  });

  it('keeps agent filenames the bundle never shipped', () => {
    seed({ variant: 'exact' });
    const p = paths();
    write(path.join(p.agentsDir, 'gsd-someone-elses.md'), 'not ours\n');
    const r = purge({ paths: p });

    assert.equal(r.agentsRemoved, 2);
    assert.equal(exists(p.agentsDir, 'gsd-someone-elses.md'), true);
  });

  it('ignores a directory that happens to match the gsd-*.md pattern', () => {
    seed({ variant: 'exact' });
    const p = paths();
    fs.mkdirSync(path.join(p.commandsDir, 'gsd-weird.md'), { recursive: true });
    const r = purge({ paths: p });

    assert.equal(r.commandsRemoved, 2);
    assert.equal(exists(p.commandsDir, 'gsd-weird.md'), true);
  });
});

describe('gsd-purge / idempotency and safety', () => {
  it('is a no-op once the marker exists', () => {
    seed({ variant: 'exact' });
    const p = paths();
    const first = purge({ paths: p });
    assert.equal(first.ran, true);
    assert.equal(fs.existsSync(p.markerPath), true);

    // Re-seed to prove the second run really does nothing.
    seed({ variant: 'exact' });
    const second = purge({ paths: p });
    assert.equal(second.ran, false);
    assert.equal(second.commandsRemoved, 0);
    assert.equal(exists(p.commandsDir, 'gsd-debug.md'), true);
  });

  it('force re-runs past the marker', () => {
    seed({ variant: 'exact' });
    const p = paths();
    purge({ paths: p });
    seed({ variant: 'exact' });
    const again = purge({ paths: p, force: true });
    assert.equal(again.ran, true);
    assert.equal(again.commandsRemoved, 2);
  });

  it('does nothing at all when the manifest is unreadable', () => {
    seed({ variant: 'exact' });
    const p = { ...paths(), manifestPath: path.join(home, 'missing.json') };
    const r = purge({ paths: p });

    assert.equal(r.ran, false);
    assert.equal(r.errors.length, 1);
    assert.equal(r.markerWritten, false, 'no marker → a fixed build retries later');
    assert.equal(exists(p.commandsDir, 'gsd-debug.md'), true);
    assert.equal(fs.existsSync(p.pluginDir), true);
  });

  it('survives a machine with nothing installed', () => {
    fs.writeFileSync(path.join(home, 'manifest.json'), JSON.stringify(buildManifest()), 'utf-8');
    const r = purge({ paths: paths() });
    assert.equal(r.ran, true);
    assert.equal(r.errors.length, 0);
    assert.equal(r.pluginDirRemoved, false);
    assert.equal(r.commandsRemoved, 0);
    assert.equal(r.markerWritten, true);
  });

  it('leaves unrelated commands and agents alone', () => {
    seed({ variant: 'exact' });
    const p = paths();
    write(path.join(p.commandsDir, 'my-command.md'), 'mine\n');
    write(path.join(p.agentsDir, 'my-agent.md'), 'mine\n');
    purge({ paths: p });

    assert.equal(exists(p.commandsDir, 'my-command.md'), true);
    assert.equal(exists(p.agentsDir, 'my-agent.md'), true);
  });
});

describe('gsd-purge / pruneEmptyDirs', () => {
  it('removes depth-first and reports the count', () => {
    const root = path.join(home, 'tree');
    fs.mkdirSync(path.join(root, 'a', 'b', 'c'), { recursive: true });
    fs.mkdirSync(path.join(root, 'd'), { recursive: true });
    const removed = pruneEmptyDirs(root);
    assert.equal(removed, 5, 'a/b/c, a/b, a, d, root');
    assert.equal(fs.existsSync(root), false);
  });

  it('stops at directories that still hold files', () => {
    const root = path.join(home, 'tree');
    fs.mkdirSync(path.join(root, 'keep'), { recursive: true });
    fs.mkdirSync(path.join(root, 'drop', 'deep'), { recursive: true });
    fs.writeFileSync(path.join(root, 'keep', 'f.txt'), 'x', 'utf-8');
    pruneEmptyDirs(root);

    assert.equal(fs.existsSync(path.join(root, 'keep', 'f.txt')), true);
    assert.equal(fs.existsSync(path.join(root, 'drop')), false);
    assert.equal(fs.existsSync(root), true);
  });
});

describe('gsd-purge / default paths', () => {
  it('points at the locations the retired installer wrote to', () => {
    const p = defaultPurgePaths('/tmp/fakehome');
    assert.equal(
      p.pluginDir,
      '/tmp/fakehome/.claude/plugins/external_plugins/codepilot-gsd-vendor',
    );
    assert.equal(p.commandsDir, '/tmp/fakehome/.claude/commands');
    assert.equal(p.agentsDir, '/tmp/fakehome/.claude/agents');
    assert.equal(p.assetsDir, '/tmp/fakehome/.claude/get-shit-done');
    assert.equal(p.markerPath, '/tmp/fakehome/.codepilot/.gsd-purged');
  });
});
