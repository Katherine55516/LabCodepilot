import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import type { SkillKind } from "@/types";

interface SkillFile {
  name: string;
  description: string;
  content: string;
  source: "global" | "project" | "plugin" | "installed" | "sdk";
  kind: SkillKind;
  installedSource?: "agents" | "claude";
  filePath: string;
  /**
   * For project-scoped skills, the working directory of the project they
   * belong to. Set when the request enumerates multiple projects via the
   * `cwds` param (Skills settings aggregate view) so the client can group by
   * project and target the right cwd for save/delete.
   */
  projectCwd?: string;
  /**
   * True when this command comes from a plugin whose plugin.json has
   * `builtIn: true` (i.e. AI Native Lab-bundled plugins like GSD). Bundled
   * plugins are always considered "loaded" — the SDK whitelist does not
   * apply because AI Native Lab itself put the files there.
   */
  builtInPlugin?: boolean;
}

/**
 * Walk up from a plugin command's filePath to find its plugin.json and
 * return whether the plugin is marked `builtIn: true`. Cached per call
 * via the passed-in Map so we don't re-read the same JSON 67 times.
 */
function isBuiltInPlugin(
  commandFilePath: string,
  cache: Map<string, boolean>
): boolean {
  // Walk up until we find either a plugin.json or hit the filesystem root.
  let dir = path.dirname(commandFilePath);
  while (dir && dir !== path.dirname(dir)) {
    if (cache.has(dir)) return cache.get(dir)!;
    const manifestPath = path.join(dir, "plugin.json");
    if (fs.existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as {
          builtIn?: boolean;
        };
        const built = manifest.builtIn === true;
        cache.set(dir, built);
        return built;
      } catch {
        cache.set(dir, false);
        return false;
      }
    }
    dir = path.dirname(dir);
  }
  return false;
}

type InstalledSource = "agents" | "claude";
type InstalledSkill = SkillFile & { installedSource: InstalledSource; contentHash: string };

function getGlobalCommandsDir(): string {
  return path.join(os.homedir(), ".claude", "commands");
}

function getProjectCommandsDir(cwd?: string): string {
  return path.join(cwd || process.cwd(), ".claude", "commands");
}

function getProjectSkillsDir(cwd?: string): string {
  return path.join(cwd || process.cwd(), ".claude", "skills");
}

/**
 * Returns true if the plugin at `pluginRoot` has `builtIn: true` in its
 * plugin.json. Bundled plugins (e.g. GSD) mirror their commands into
 * `~/.claude/commands/` so the Claude Agent SDK can actually execute
 * them; we must skip the plugin-dir copy here or the popover shows each
 * /gsd-* twice (once from global, once from plugin).
 */
function isPluginBuiltIn(pluginRoot: string): boolean {
  try {
    const raw = fs.readFileSync(path.join(pluginRoot, "plugin.json"), "utf-8");
    return (JSON.parse(raw) as { builtIn?: boolean }).builtIn === true;
  } catch {
    return false;
  }
}

function getPluginCommandsDirs(): string[] {
  const dirs: string[] = [];
  const pluginsRoot = path.join(os.homedir(), ".claude", "plugins");

  // Scan marketplaces: ~/.claude/plugins/marketplaces/{mkt}/plugins/*/commands
  const marketplacesDir = path.join(pluginsRoot, "marketplaces");
  if (fs.existsSync(marketplacesDir)) {
    try {
      const marketplaces = fs.readdirSync(marketplacesDir);
      for (const marketplace of marketplaces) {
        const pluginsDir = path.join(marketplacesDir, marketplace, "plugins");
        if (!fs.existsSync(pluginsDir)) continue;
        const plugins = fs.readdirSync(pluginsDir);
        for (const plugin of plugins) {
          const pluginRoot = path.join(pluginsDir, plugin);
          if (isPluginBuiltIn(pluginRoot)) continue;
          const commandsDir = path.join(pluginRoot, "commands");
          if (fs.existsSync(commandsDir)) {
            dirs.push(commandsDir);
          }
        }
      }
    } catch {
      // ignore
    }
  }

  // Scan external plugins: ~/.claude/plugins/external_plugins/*/commands
  const externalDir = path.join(pluginsRoot, "external_plugins");
  if (fs.existsSync(externalDir)) {
    try {
      const externals = fs.readdirSync(externalDir);
      for (const plugin of externals) {
        const pluginRoot = path.join(externalDir, plugin);
        if (isPluginBuiltIn(pluginRoot)) continue;
        const commandsDir = path.join(pluginRoot, "commands");
        if (fs.existsSync(commandsDir)) {
          dirs.push(commandsDir);
        }
      }
    } catch {
      // ignore
    }
  }

  return dirs;
}

function getInstalledSkillsDir(): string {
  return path.join(os.homedir(), ".agents", "skills");
}

function getClaudeSkillsDir(): string {
  return path.join(os.homedir(), ".claude", "skills");
}

/**
 * Scan project-level skills from .claude/skills/{name}/SKILL.md.
 * Each subdirectory may contain a SKILL.md with optional YAML front matter.
 */
function scanProjectSkills(dir: string): SkillFile[] {
  const skills: SkillFile[] = [];
  if (!fs.existsSync(dir)) return skills;

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const skillMdPath = path.join(dir, entry.name, "SKILL.md");
      if (!fs.existsSync(skillMdPath)) continue;

      const content = fs.readFileSync(skillMdPath, "utf-8");
      const meta = parseSkillFrontMatter(content);
      const name = meta.name || entry.name;
      const description = meta.description || `Skill: /${name}`;

      skills.push({
        name,
        description,
        content,
        source: "project",
        kind: "agent_skill",
        filePath: skillMdPath,
      });
    }
  } catch {
    // ignore read errors
  }
  return skills;
}

function computeContentHash(content: string): string {
  return crypto.createHash("sha1").update(content, "utf8").digest("hex");
}

/**
 * Parse YAML front matter from SKILL.md content.
 * Extracts `name` and `description` fields from the --- delimited block.
 */
function parseSkillFrontMatter(content: string): { name?: string; description?: string } {
  // Extract front matter between --- delimiters
  const fmMatch = content.match(/^---\r?\n([\s\S]+?)\r?\n---/);
  if (!fmMatch) return {};

  const frontMatter = fmMatch[1];
  const lines = frontMatter.split(/\r?\n/);
  const result: { name?: string; description?: string } = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Match name: value
    const nameMatch = line.match(/^name:\s*(.+)/);
    if (nameMatch) {
      result.name = nameMatch[1].trim();
      continue;
    }

    // Match description: | (multi-line YAML block scalar) — check FIRST
    if (/^description:\s*\|/.test(line)) {
      const descLines: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        if (/^\s+/.test(lines[j])) {
          descLines.push(lines[j].trim());
        } else {
          break;
        }
      }
      if (descLines.length > 0) {
        result.description = descLines.filter(Boolean).join(" ");
      }
      continue;
    }

    // Match description: value (single-line)
    const descMatch = line.match(/^description:\s+(.+)/);
    if (descMatch) {
      result.description = descMatch[1].trim();
    }
  }
  return result;
}

/**
 * Scan a directory for installed skills.
 * Each skill is a subdirectory containing a SKILL.md with YAML front matter.
 * Used for both ~/.agents/skills/ and ~/.claude/skills/.
 */
function scanInstalledSkills(
  dir: string,
  installedSource: InstalledSource
): InstalledSkill[] {
  const skills: InstalledSkill[] = [];
  if (!fs.existsSync(dir)) return skills;

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const skillMdPath = path.join(dir, entry.name, "SKILL.md");
      if (!fs.existsSync(skillMdPath)) continue;

      const content = fs.readFileSync(skillMdPath, "utf-8");
      const meta = parseSkillFrontMatter(content);
      const name = meta.name || entry.name;
      const description = meta.description || `Installed skill: /${name}`;
      const contentHash = computeContentHash(content);

      skills.push({
        name,
        description,
        content,
        source: "installed",
        kind: "agent_skill",
        installedSource,
        contentHash,
        filePath: skillMdPath,
      });
    }
  } catch {
    // ignore read errors
  }
  return skills;
}

function resolveInstalledSkills(
  agentsSkills: InstalledSkill[],
  claudeSkills: InstalledSkill[],
  preferredSource: InstalledSource
): SkillFile[] {
  const all = [...agentsSkills, ...claudeSkills];
  const byName = new Map<string, InstalledSkill[]>();
  for (const skill of all) {
    const existing = byName.get(skill.name);
    if (existing) {
      existing.push(skill);
    } else {
      byName.set(skill.name, [skill]);
    }
  }

  const resolved: InstalledSkill[] = [];
  for (const group of byName.values()) {
    if (group.length === 1) {
      resolved.push(group[0]);
      continue;
    }

    const uniqueHashes = new Set(group.map((s) => s.contentHash));
    if (uniqueHashes.size === 1) {
      const preferred =
        group.find((s) => s.installedSource === preferredSource) || group[0];
      resolved.push(preferred);
      continue;
    }

    resolved.push(...group);
  }

  return resolved.map(({ contentHash: _contentHash, ...rest }) => rest);
}

function scanDirectory(
  dir: string,
  source: "global" | "project" | "plugin",
  prefix = ""
): SkillFile[] {
  const skills: SkillFile[] = [];
  if (!fs.existsSync(dir)) return skills;

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        // Recurse into subdirectories (e.g. ~/.claude/commands/review/pr.md)
        const subPrefix = prefix ? `${prefix}:${entry.name}` : entry.name;
        skills.push(...scanDirectory(fullPath, source, subPrefix));
        continue;
      }

      if (!entry.name.endsWith(".md")) continue;
      const baseName = entry.name.replace(/\.md$/, "");
      const name = prefix ? `${prefix}:${baseName}` : baseName;
      const filePath = fullPath;
      const content = fs.readFileSync(filePath, "utf-8");

      // Prefer YAML frontmatter `description:` (used by GSD and most modern
      // Claude Code slash-command files). Fall back to the first non-empty
      // line of the body (post-frontmatter), then a generic placeholder.
      let description = "";
      const meta = parseSkillFrontMatter(content);
      if (meta.description) {
        description = meta.description;
      } else {
        const body = content.replace(/^---\r?\n[\s\S]+?\r?\n---\r?\n?/, "");
        const firstNonEmpty = body
          .split("\n")
          .map((line) => line.trim())
          .find((line) => line.length > 0) || "";
        description = firstNonEmpty.startsWith("#")
          ? firstNonEmpty.replace(/^#+\s*/, "")
          : firstNonEmpty || `Skill: /${name}`;
      }

      skills.push({ name, description, content, source, kind: "slash_command", filePath });
    }
  } catch {
    // ignore read errors
  }
  return skills;
}

export async function GET(request: NextRequest) {
  try {
    // Mirror ~/.agents/skills/ → ~/.claude/skills/ before scanning, so the
    // skills this endpoint lists (which include the agent-neutral
    // ~/.agents/skills/ location) match what the bundled Claude Code binary
    // can actually load. TTL-cached. See src/lib/skill-reconcile.ts.
    try {
      const { reconcileSkillsCached } = await import("@/lib/skill-reconcile");
      reconcileSkillsCached();
    } catch {
      // non-fatal — listing still proceeds
    }

    // Accept optional cwd query param for project-level skills.
    // `cwds` (JSON array) enables the Skills-settings aggregate view: scan
    // project-level skills for EVERY project working directory at once, tagging
    // each with its projectCwd. Falls back to single `cwd` (or process.cwd()).
    const cwd = request.nextUrl.searchParams.get("cwd") || undefined;
    const cwdsParam = request.nextUrl.searchParams.get("cwds");
    let projectCwdList: (string | undefined)[];
    if (cwdsParam) {
      try {
        const parsed = JSON.parse(cwdsParam);
        projectCwdList = Array.isArray(parsed)
          ? parsed.filter((x): x is string => typeof x === "string" && x.length > 0)
          : [];
      } catch {
        projectCwdList = [];
      }
    } else {
      projectCwdList = [cwd];
    }

    // Resolve provider ID from session for correct capability cache lookup.
    // Falls back to 'env' when no session is specified.
    const sessionId = request.nextUrl.searchParams.get("sessionId");
    let providerId = 'env';
    if (sessionId) {
      try {
        const { getSession } = await import('@/lib/db');
        const session = getSession(sessionId);
        providerId = session?.provider_id || 'env';
      } catch {
        // DB not available, fall back to 'env'
      }
    }
    const globalDir = getGlobalCommandsDir();
    console.log(`[skills] Scanning global: ${globalDir} (exists: ${fs.existsSync(globalDir)})`);
    console.log(`[skills] HOME=${process.env.HOME}, homedir=${os.homedir()}`);

    const globalSkills = scanDirectory(globalDir, "global");

    // Scan project-level skills for each requested project working directory.
    // Each item is tagged with projectCwd so the aggregate view can group by
    // project and so save/delete can target the right directory.
    const projectScanned: SkillFile[] = [];
    for (const projectCwd of projectCwdList) {
      const projectDir = getProjectCommandsDir(projectCwd);
      const projectCmds = scanDirectory(projectDir, "project");

      const projectSkillsDir = getProjectSkillsDir(projectCwd);
      const projectLevelSkills = scanProjectSkills(projectSkillsDir);

      // Deduplicate within a project: project commands take priority over
      // project skills with the same name.
      const projectCommandNames = new Set(projectCmds.map((s) => s.name));
      const dedupedProjectSkills = projectLevelSkills.filter(
        (s) => !projectCommandNames.has(s.name)
      );

      for (const s of [...projectCmds, ...dedupedProjectSkills]) {
        projectScanned.push(projectCwd ? { ...s, projectCwd } : s);
      }
    }
    console.log(`[skills] Scanned ${projectScanned.length} project-level items across ${projectCwdList.length} project dir(s)`);

    const agentsSkillsDir = getInstalledSkillsDir();
    const claudeSkillsDir = getClaudeSkillsDir();
    console.log(`[skills] Scanning installed: ${agentsSkillsDir} (exists: ${fs.existsSync(agentsSkillsDir)})`);
    console.log(`[skills] Scanning installed: ${claudeSkillsDir} (exists: ${fs.existsSync(claudeSkillsDir)})`);
    const agentsSkills = scanInstalledSkills(agentsSkillsDir, "agents");
    const claudeSkills = scanInstalledSkills(claudeSkillsDir, "claude");
    const preferredInstalledSource: InstalledSource =
      agentsSkills.length === claudeSkills.length
        ? "claude"
        : agentsSkills.length > claudeSkills.length
          ? "agents"
          : "claude";
    console.log(
      `[skills] Installed counts: agents=${agentsSkills.length}, claude=${claudeSkills.length}, preferred=${preferredInstalledSource}`
    );
    const installedSkills = resolveInstalledSkills(
      agentsSkills,
      claudeSkills,
      preferredInstalledSource
    );

    // Scan installed plugin skills
    const pluginSkills: SkillFile[] = [];
    for (const dir of getPluginCommandsDirs()) {
      pluginSkills.push(...scanDirectory(dir, "plugin"));
    }

    // Cross-reference plugin skills with loaded plugins from SDK init meta.
    // Uses provider-scoped cache so custom providers see their own plugin set.
    let loadedPluginPaths: Set<string> | null = null;
    try {
      const { getCachedPlugins } = await import('@/lib/agent-sdk-capabilities');
      const loaded = getCachedPlugins(providerId);
      loadedPluginPaths = new Set(loaded.map(p => p.path));
    } catch {
      // SDK capabilities not available
    }

    // Annotate plugin skills with loaded status. AI Native Lab-bundled plugins
    // (plugin.json has `builtIn: true`) are always treated as loaded — the
    // Claude Code SDK doesn't actively register them, but AI Native Lab itself
    // put the files there so they are guaranteed available. Without this
    // override, the two SDK-whitelist filters in useSlashCommands.ts strip
    // them out and the popover shows zero /gsd-* commands.
    const builtInCache = new Map<string, boolean>();
    const annotatedPluginSkills = pluginSkills.map(skill => {
      const builtIn = isBuiltInPlugin(skill.filePath, builtInCache);
      const sdkLoaded = loadedPluginPaths ? loadedPluginPaths.has(
        (() => {
          let dir = path.dirname(skill.filePath);
          while (dir && dir !== path.dirname(dir)) {
            if (loadedPluginPaths!.has(dir)) return dir;
            dir = path.dirname(dir);
          }
          return '';
        })()
      ) : false;
      return {
        ...skill,
        builtInPlugin: builtIn,
        loaded: builtIn || sdkLoaded,
      };
    });

    const all: Array<SkillFile & { loaded?: boolean }> = [
      ...globalSkills, ...projectScanned, ...installedSkills, ...annotatedPluginSkills,
    ];
    console.log(`[skills] Found: global=${globalSkills.length}, project=${projectScanned.length}, installed=${installedSkills.length}, plugin=${pluginSkills.length}`);

    // Merge SDK slash commands if available
    try {
      const { getCachedCommands } = await import('@/lib/agent-sdk-capabilities');
      const sdkCommands = getCachedCommands(providerId);
      if (sdkCommands.length > 0) {
        const existingNames = new Set(all.map(s => s.name));
        for (const cmd of sdkCommands) {
          if (!existingNames.has(cmd.name)) {
            all.push({
              name: cmd.name,
              description: cmd.description || `SDK command: /${cmd.name}`,
              content: '', // SDK commands don't have local content
              source: 'sdk',
              kind: 'sdk_command',
              filePath: '',
            });
          }
        }
        console.log(`[skills] Added ${sdkCommands.length} SDK commands (${sdkCommands.filter(c => !existingNames.has(c.name)).length} unique)`);
      }
    } catch {
      // SDK capabilities not available, skip
    }

    return NextResponse.json({ skills: all });
  } catch (error) {
    console.error('[skills] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load skills" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, content, scope, cwd } = body as {
      name: string;
      content: string;
      scope: "global" | "project";
      cwd?: string;
    };

    if (!name || typeof name !== "string") {
      return NextResponse.json(
        { error: "Skill name is required" },
        { status: 400 }
      );
    }

    // Sanitize name: only allow alphanumeric, hyphens, underscores
    const safeName = name.replace(/[^a-zA-Z0-9_-]/g, "-");
    if (!safeName) {
      return NextResponse.json(
        { error: "Invalid skill name" },
        { status: 400 }
      );
    }

    const dir =
      scope === "project" ? getProjectCommandsDir(cwd) : getGlobalCommandsDir();

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const filePath = path.join(dir, `${safeName}.md`);
    if (fs.existsSync(filePath)) {
      return NextResponse.json(
        { error: "A skill with this name already exists" },
        { status: 409 }
      );
    }

    fs.writeFileSync(filePath, content || "", "utf-8");

    const firstLine = (content || "").split("\n")[0]?.trim() || "";
    const description = firstLine.startsWith("#")
      ? firstLine.replace(/^#+\s*/, "")
      : firstLine || `Skill: /${safeName}`;

    return NextResponse.json(
      {
        skill: {
          name: safeName,
          description,
          content: content || "",
          source: scope || "global",
          filePath,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create skill" },
      { status: 500 }
    );
  }
}
