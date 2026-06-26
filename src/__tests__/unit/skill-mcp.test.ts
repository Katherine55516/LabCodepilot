/**
 * Tests for the codepilot-skill MCP system-prompt builder.
 *
 * Verifies that buildSkillSystemPrompt surfaces PROJECT-level skills (under
 * <cwd>/.claude) and ignores user-level / unrelated skills — the exact gap the
 * SDK runtime leaves under DB/managed providers.
 *
 * Run with: npx tsx --test src/__tests__/unit/skill-mcp.test.ts
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildSkillSystemPrompt } from '../../lib/skill-mcp';
import { invalidateSkillCache } from '../../lib/skill-discovery';

function writeFile(p: string, content: string) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

describe('buildSkillSystemPrompt', () => {
  let projectDir: string;

  before(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-mcp-test-'));
    // A project-level Agent Skill (manual-drop style: folder + SKILL.md)
    writeFile(
      path.join(projectDir, '.claude', 'skills', 'pdf-filler', 'SKILL.md'),
      '---\nname: pdf-filler\ndescription: Fill PDF forms\nwhen_to_use: when the user has a PDF form\n---\nFill the PDF.'
    );
    // A project-level slash command
    writeFile(
      path.join(projectDir, '.claude', 'commands', 'mytest.md'),
      '# mytest\nDo my test thing.'
    );
    invalidateSkillCache();
  });

  after(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
    invalidateSkillCache();
  });

  it('lists project-level skills and commands', () => {
    const prompt = buildSkillSystemPrompt(projectDir);
    assert.ok(prompt, 'prompt should not be null when project has skills');
    assert.match(prompt!, /pdf-filler/);
    assert.match(prompt!, /Fill PDF forms/);
    assert.match(prompt!, /when the user has a PDF form/);
    assert.match(prompt!, /codepilot_skill/);
  });

  it('returns null for a project with no .claude skills/commands', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-mcp-empty-'));
    try {
      invalidateSkillCache();
      assert.equal(buildSkillSystemPrompt(empty), null);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
      invalidateSkillCache();
    }
  });

  it('returns null when no working directory is given', () => {
    assert.equal(buildSkillSystemPrompt(''), null);
  });
});
