/**
 * Reconcile: `~/.agents/skills/<name>` → `~/.claude/skills/<name>`.
 *
 * The bundled Claude Code binary only discovers user-scope skills from
 * `~/.claude/skills/`. The `skills` CLI can install into the agent-neutral
 * `~/.agents/skills/`, which the binary can't load. This reconciler COPIES
 * (never moves — the source belongs to the external CLI) those skills into
 * `~/.claude/skills/`, marking its copies so it can refresh/remove them
 * without ever clobbering a foreign skill.
 *
 * These tests pin the contract:
 *   - copy when missing, leave the source intact, stamp a marker
 *   - re-entrant (a second call changes nothing)
 *   - refresh when the source folder hash changes (SKILL.md OR a resource)
 *   - a same-named skill in ~/.claude/skills/ WITHOUT our marker wins (skipped)
 *   - our orphaned mirror is removed when the source is gone
 *   - a foreign skill is never removed, even when no source exists
 *   - creates ~/.claude/skills/ when absent; ignores dirs without SKILL.md
 */
import { beforeEach, afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  reconcileAgentsSkillsToClaudeSkills,
} from '../../lib/skill-reconcile';

const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
let tempHome: string;

const MARKER = '.codepilot-mirror.json';

function agentSkillDir(name: string): string {
  return path.join(tempHome, '.agents', 'skills', name);
}
function claudeSkillDir(name: string): string {
  return path.join(tempHome, '.claude', 'skills', name);
}

function writeAgentSkill(name: string, skillMd: string, extra: Record<string, string> = {}): void {
  const dir = agentSkillDir(name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), skillMd);
  for (const [rel, content] of Object.entries(extra)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
}

function writeForeignClaudeSkill(name: string, skillMd: string): void {
  const dir = claudeSkillDir(name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), skillMd);
  // intentionally NO marker — simulates a direct `--agent claude-code` install
  // or a user-authored skill
}

function readClaudeSkillMd(name: string): string {
  return fs.readFileSync(path.join(claudeSkillDir(name), 'SKILL.md'), 'utf-8');
}
function claudeSkillExists(name: string): boolean {
  return fs.existsSync(path.join(claudeSkillDir(name), 'SKILL.md'));
}
function hasMarker(name: string): boolean {
  return fs.existsSync(path.join(claudeSkillDir(name), MARKER));
}

beforeEach(() => {
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-skill-reconcile-'));
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

describe('reconcileAgentsSkillsToClaudeSkills', () => {
  it('copies a skill missing from ~/.claude/skills/, preserves the source, and stamps a marker', () => {
    writeAgentSkill('find-skills', '---\nname: find-skills\n---\nbody');

    const result = reconcileAgentsSkillsToClaudeSkills();

    assert.deepEqual(result.mirrored, ['find-skills']);
    assert.deepEqual(result.refreshed, []);
    assert.deepEqual(result.removed, []);
    assert.equal(result.changed, true);
    assert.equal(result.error, undefined);

    // mirrored into ~/.claude/skills/ with identical content
    assert.equal(claudeSkillExists('find-skills'), true);
    assert.equal(readClaudeSkillMd('find-skills'), '---\nname: find-skills\n---\nbody');
    assert.equal(hasMarker('find-skills'), true);

    // source left intact (copy, not move)
    assert.equal(fs.existsSync(path.join(agentSkillDir('find-skills'), 'SKILL.md')), true);
  });

  it('is re-entrant: a second call after a successful mirror changes nothing', () => {
    writeAgentSkill('a', 'v1');

    const first = reconcileAgentsSkillsToClaudeSkills();
    assert.deepEqual(first.mirrored, ['a']);

    const second = reconcileAgentsSkillsToClaudeSkills();
    assert.deepEqual(second.mirrored, []);
    assert.deepEqual(second.refreshed, []);
    assert.equal(second.changed, false);
  });

  it('refreshes the mirror when the source SKILL.md changes', () => {
    writeAgentSkill('a', 'v1');
    reconcileAgentsSkillsToClaudeSkills();
    assert.equal(readClaudeSkillMd('a'), 'v1');

    writeAgentSkill('a', 'v2'); // overwrite SKILL.md
    const result = reconcileAgentsSkillsToClaudeSkills();

    assert.deepEqual(result.refreshed, ['a']);
    assert.deepEqual(result.mirrored, []);
    assert.equal(result.changed, true);
    assert.equal(readClaudeSkillMd('a'), 'v2');
  });

  it('refreshes the mirror when a resource file (not SKILL.md) changes', () => {
    writeAgentSkill('a', 'md', { 'scripts/run.sh': 'r1' });
    reconcileAgentsSkillsToClaudeSkills();
    assert.equal(
      fs.readFileSync(path.join(claudeSkillDir('a'), 'scripts', 'run.sh'), 'utf-8'),
      'r1',
    );

    fs.writeFileSync(path.join(agentSkillDir('a'), 'scripts', 'run.sh'), 'r2');
    const result = reconcileAgentsSkillsToClaudeSkills();

    assert.deepEqual(result.refreshed, ['a']);
    assert.equal(
      fs.readFileSync(path.join(claudeSkillDir('a'), 'scripts', 'run.sh'), 'utf-8'),
      'r2',
    );
  });

  it('skips a same-named skill that already exists in ~/.claude/skills/ without our marker', () => {
    writeAgentSkill('dup', 'agent-version');
    writeForeignClaudeSkill('dup', 'claude-version');

    const result = reconcileAgentsSkillsToClaudeSkills();

    assert.deepEqual(result.skipped, ['dup']);
    assert.deepEqual(result.mirrored, []);
    assert.deepEqual(result.refreshed, []);
    assert.equal(result.changed, false);
    // foreign copy is the source of truth for the binary — untouched
    assert.equal(readClaudeSkillMd('dup'), 'claude-version');
    assert.equal(hasMarker('dup'), false);
  });

  it('removes our orphaned mirror when the source is gone', () => {
    writeAgentSkill('gone', 'md');
    reconcileAgentsSkillsToClaudeSkills();
    assert.equal(claudeSkillExists('gone'), true);

    // simulate `skills remove` deleting the source
    fs.rmSync(agentSkillDir('gone'), { recursive: true, force: true });

    const result = reconcileAgentsSkillsToClaudeSkills();
    assert.deepEqual(result.removed, ['gone']);
    assert.equal(result.changed, true);
    assert.equal(fs.existsSync(claudeSkillDir('gone')), false);
  });

  it('never removes a foreign ~/.claude/skills/ skill, even with no source', () => {
    writeForeignClaudeSkill('keep', 'x');

    const result = reconcileAgentsSkillsToClaudeSkills();

    assert.deepEqual(result.removed, []);
    assert.equal(result.changed, false);
    assert.equal(claudeSkillExists('keep'), true);
  });

  it('creates ~/.claude/skills/ when it does not exist yet', () => {
    writeAgentSkill('solo', 'md');
    // ~/.claude/skills does not exist at all
    assert.equal(fs.existsSync(path.join(tempHome, '.claude', 'skills')), false);

    const result = reconcileAgentsSkillsToClaudeSkills();

    assert.deepEqual(result.mirrored, ['solo']);
    assert.equal(claudeSkillExists('solo'), true);
  });

  it('ignores agent subdirectories that have no SKILL.md', () => {
    const dir = path.join(tempHome, '.agents', 'skills', 'notaskill');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'README.md'), 'no skill here');

    const result = reconcileAgentsSkillsToClaudeSkills();

    assert.deepEqual(result.mirrored, []);
    assert.equal(result.changed, false);
    assert.equal(fs.existsSync(claudeSkillDir('notaskill')), false);
  });

  it('is a no-op when ~/.agents/skills/ does not exist', () => {
    const result = reconcileAgentsSkillsToClaudeSkills();

    assert.deepEqual(result.mirrored, []);
    assert.deepEqual(result.removed, []);
    assert.equal(result.changed, false);
    assert.equal(result.error, undefined);
  });
});
