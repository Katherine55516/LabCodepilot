/**
 * codepilot-skill MCP — in-process MCP server that exposes PROJECT-level skills
 * to the SDK runtime.
 *
 * ## Why this exists
 *
 * Project-level skills/commands live in `<cwd>/.claude/skills/*​/SKILL.md` and
 * `<cwd>/.claude/commands/*.md`. The Claude Agent SDK only discovers them when
 * `settingSources` includes `'project'` — but DB/managed providers drop that
 * layer (see provider-resolver.ts) to prevent project settings from overriding
 * the selected provider's auth. As a result, a skill the user creates in-app OR
 * drops manually into `.claude/` is invisible to the agent under managed
 * providers (and only conditionally visible in env mode).
 *
 * The native runtime already solved this with a filesystem-direct Skill tool
 * (src/lib/tools/skill.ts → skill-discovery.ts). This module brings the same
 * capability to the SDK runtime as an in-process MCP server, so project skills
 * are discoverable and usable across EVERY provider — without re-enabling the
 * risky project settings layer or touching the shadow-HOME machinery.
 *
 * User-level skills (`~/.claude/skills`) are intentionally NOT surfaced here:
 * the SDK already loads them natively via the `'user'` settingSource (mirrored
 * through the shadow HOME). We only fill the project-level gap.
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import path from 'path';
import { discoverSkills, getSkill, invalidateSkillCache } from './skill-discovery';
import { prepareSkillExecution } from './skill-executor';
import type { SkillDefinition } from './skill-parser';

const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });

/**
 * Discover skills whose files live under `<cwd>/.claude/` — i.e. project-level
 * skills and commands. These are exactly the ones the SDK can't load itself
 * under DB/managed providers.
 */
function getProjectSkills(workingDirectory: string): SkillDefinition[] {
  if (!workingDirectory) return [];
  const projectPrefix = path.join(workingDirectory, '.claude');
  return discoverSkills(workingDirectory).filter((s) =>
    s.filePath.startsWith(projectPrefix)
  );
}

/**
 * Build the system-prompt section that tells the model which project skills are
 * available and how to invoke them. Returns null when the project has none, so
 * the caller can skip both the append and the MCP registration (avoids SDK
 * tool-discovery overhead on projects without skills).
 *
 * Invalidates the skill cache first so skills added mid-session are picked up
 * on the next turn.
 */
export function buildSkillSystemPrompt(workingDirectory: string): string | null {
  invalidateSkillCache();
  const skills = getProjectSkills(workingDirectory);
  if (skills.length === 0) return null;

  const list = skills
    .map((s) => {
      const parts = [`- **${s.name}**`];
      if (s.description) parts.push(`: ${s.description}`);
      if (s.whenToUse) parts.push(` (use when: ${s.whenToUse})`);
      return parts.join('');
    })
    .join('\n');

  return `## 项目技能 (Project Skills)

本项目 .claude/ 目录下定义了以下项目级技能。当用户要求使用某个技能，或当前任务与某技能用途匹配时，调用 \`codepilot_skill\` 工具来获取并执行它（传 \`skill_name\` 执行指定技能；不传参数则列出全部）：

${list}`;
}

/**
 * Create the codepilot-skill MCP server bound to a working directory. Exposes a
 * single `codepilot_skill` tool that lists project skills (no args) or returns a
 * skill's prompt body for execution (with `skill_name`).
 */
export function createSkillMcpServer(workingDirectory: string) {
  return createSdkMcpServer({
    name: 'codepilot-skill',
    version: '1.0.0',
    tools: [
      tool(
        'codepilot_skill',
        'List or run a project-level skill defined in this project\'s .claude/ folder ' +
          '(.claude/skills/*/SKILL.md or .claude/commands/*.md). ' +
          'Call with no skill_name to list all available project skills. ' +
          'Call with skill_name to retrieve a skill\'s instructions, then follow them.',
        {
          skill_name: z
            .string()
            .optional()
            .describe('Name of the skill to run. Omit to list all project skills.'),
          arguments: z
            .record(z.string(), z.string())
            .optional()
            .describe('Optional key-value arguments substituted into the skill body.'),
        },
        async ({ skill_name, arguments: args }) => {
          // List mode
          if (!skill_name) {
            const skills = getProjectSkills(workingDirectory);
            if (skills.length === 0) {
              return text(
                'No project-level skills available. Add SKILL.md files under .claude/skills/ or command files under .claude/commands/.'
              );
            }
            return text(
              skills
                .map((s) => {
                  const parts = [`- **${s.name}**`];
                  if (s.description) parts.push(`: ${s.description}`);
                  if (s.whenToUse) parts.push(` (use when: ${s.whenToUse})`);
                  return parts.join('');
                })
                .join('\n')
            );
          }

          // Execute mode — resolve by name (project skills take priority).
          const skill = getSkill(skill_name, workingDirectory);
          if (!skill) {
            const available = getProjectSkills(workingDirectory)
              .map((s) => s.name)
              .join(', ');
            return text(
              `Skill "${skill_name}" not found. Available project skills: ${available || 'none'}`
            );
          }

          const result = prepareSkillExecution(skill, args || {});
          // Fork execution (sub-agent) isn't available from an MCP tool — return
          // the prompt body for inline execution either way; the model follows it.
          return text(result.prompt);
        }
      ),
    ],
  });
}
