import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";
import { readLockFile } from "@/lib/skills-lock";
import type { MarketplaceSkill } from "@/types";

/**
 * Folder names of skills actually present on disk — a directory containing a
 * SKILL.md under the agent-neutral ~/.agents/skills or the Claude mirror
 * ~/.claude/skills. This mirrors how the "My Skills" tab and the agent's
 * slash-command list decide what is installed, so the marketplace badge stays
 * consistent with them (and self-heals when a skill is deleted there).
 */
function getInstalledSkillFolderNames(): Set<string> {
  const dirs = [
    path.join(os.homedir(), ".agents", "skills"),
    path.join(os.homedir(), ".claude", "skills"),
  ];
  const names = new Set<string>();
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
        if (fs.existsSync(path.join(dir, entry.name, "SKILL.md"))) {
          names.add(entry.name);
        }
      }
    } catch {
      // ignore unreadable dirs
    }
  }
  return names;
}

export async function GET(request: NextRequest) {
  try {
    const q = request.nextUrl.searchParams.get("q") || "";
    const limit = request.nextUrl.searchParams.get("limit") || "20";

    // Skills.sh requires query >= 2 chars; use a popular fallback for empty/short queries
    const query = q.length >= 2 ? q : "claude";

    const url = new URL("https://skills.sh/api/search");
    url.searchParams.set("q", query);
    url.searchParams.set("limit", limit);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    let response: Response;
    try {
      response = await fetch(url.toString(), { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      return NextResponse.json(
        { error: `Skills.sh API returned ${response.status}` },
        { status: 502 }
      );
    }

    const data = await response.json();
    const results: unknown[] = Array.isArray(data) ? data : (data.results || data.skills || []);

    // Mark installed skills. A skill counts as installed only when THIS specific
    // skill — matched to its lock entry by the installed folder name AND its
    // source — is still present on disk.
    //
    // The previous logic matched by `source` alone, which was wrong: a single
    // repo (e.g. anthropics/skills) ships dozens of skills, so installing one
    // marked the whole repo "installed", and uninstalling one never cleared the
    // badge because sibling skills kept the source present — leaving the user
    // unable to reinstall. Requiring on-disk presence also self-heals stale
    // lock entries left behind when a skill is removed via the "My Skills" tab
    // (which deletes the file but not the lock).
    const lockFile = readLockFile();
    const installedNames = getInstalledSkillFolderNames();

    const resolveInstalled = (
      source: string,
      skillId: string,
      name: string
    ): { isInstalled: boolean; installedAt?: string } => {
      for (const key of [skillId, name]) {
        if (!key) continue;
        const entry = lockFile.skills[key];
        if (entry && entry.source === source && installedNames.has(key)) {
          return { isInstalled: true, installedAt: entry.installedAt };
        }
      }
      return { isInstalled: false };
    };

    const skills: MarketplaceSkill[] = results.map((item: unknown) => {
      const r = item as Record<string, unknown>;
      const source = String(r.source || r.slug || r.name || "");
      const skillId = String(r.skillId || r.name || r.slug || "");
      const name = String(r.name || r.slug || "");
      const { isInstalled, installedAt } = resolveInstalled(source, skillId, name);
      return {
        id: String(r.id || r.slug || r.name || ""),
        skillId,
        name,
        installs: Number(r.installs || r.downloads || 0),
        source,
        isInstalled,
        installedAt,
      };
    });

    return NextResponse.json({ skills });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return NextResponse.json(
        { error: "Skills.sh API request timed out" },
        { status: 504 }
      );
    }
    console.error("[marketplace/search] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Search failed" },
      { status: 502 }
    );
  }
}
