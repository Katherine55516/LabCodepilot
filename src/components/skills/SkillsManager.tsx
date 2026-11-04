"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePanel } from "@/hooks/usePanel";

import { Plus, MagnifyingGlass, Lightning, SpinnerGap } from "@/components/ui/icon";
import { SkillListItem } from "./SkillListItem";
import { SkillEditor } from "./SkillEditor";
import { CreateSkillDialog } from "./CreateSkillDialog";
import { MarketplaceBrowser } from "./MarketplaceBrowser";
import { InternalStoreBrowser } from "./internal/InternalStoreBrowser";
import { useTranslation } from "@/hooks/useTranslation";
import type { TranslationKey } from "@/i18n";
import { cn } from "@/lib/utils";
import { groupSessionsByProject } from "@/components/layout/chat-list-utils";
import type { ChatSession } from "@/types";
import type { SkillItem } from "./SkillListItem";

type ViewTab = "local" | "marketplace" | "internal";

/**
 * 内部市场 tab 可见性的会话级缓存（方案 D5）：SKILLS_NOT_CONFIGURED（服务端
 * 未启用）在应用生命周期内不会变 → 缓存 hidden 避免每次进设置都探测;
 * 探测失败(网络/未登录)不缓存 — tab 显示,具体状态由 Browser 内部呈现。
 */
let internalProbeCache: boolean | null = null;

/** A project the user can scope skills to — derived from conversation groups. */
export interface SkillProject {
  cwd: string;
  name: string;
}

/** Match two skills as the same entry (project skills disambiguate by cwd). */
function sameSkill(a: SkillItem, b: SkillItem): boolean {
  return (
    a.name === b.name &&
    a.source === b.source &&
    a.installedSource === b.installedSource &&
    a.projectCwd === b.projectCwd
  );
}

export function SkillsManager() {
  // workingDirectory is only used to pre-select the current project in the
  // create dialog — the skill list itself spans ALL projects, independent of
  // which conversation is selected.
  const { workingDirectory } = usePanel();
  const { t } = useTranslation();
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [projects, setProjects] = useState<SkillProject[]>([]);
  const [selected, setSelected] = useState<SkillItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [viewTab, setViewTab] = useState<ViewTab>("local");
  // 内部市场 tab:纯浏览器(无 electronAPI)不渲染;probe 拿到「未启用」也不渲染。
  const [internalVisible, setInternalVisible] = useState<boolean>(internalProbeCache ?? false);

  useEffect(() => {
    const api = typeof window !== "undefined" ? window.electronAPI?.skillsStore : undefined;
    if (!api) return; // 纯浏览器 dev:保持隐藏
    if (internalProbeCache !== null) {
      setInternalVisible(internalProbeCache);
      return;
    }
    let cancelled = false;
    api.probe().then((r) => {
      if (cancelled) return;
      if (r.ok) {
        internalProbeCache = true;
        setInternalVisible(true);
      } else if (r.error === "SKILLS_NOT_CONFIGURED") {
        internalProbeCache = false;
        setInternalVisible(false);
      } else {
        // 未登录/网络异常:显示 tab,登录态与错误由 Browser 内部处理;不缓存
        setInternalVisible(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /** 登录后首次列表才探到「未启用」→ 隐藏 tab 并回落本地列表。 */
  const handleInternalUnavailable = useCallback(() => {
    internalProbeCache = false;
    setInternalVisible(false);
    setViewTab("local");
  }, []);

  const fetchSkills = useCallback(async () => {
    try {
      // 1. Enumerate all projects from the conversation list (grouped by cwd).
      let projList: SkillProject[] = [];
      try {
        const sessRes = await fetch("/api/chat/sessions");
        if (sessRes.ok) {
          const { sessions } = (await sessRes.json()) as { sessions: ChatSession[] };
          projList = groupSessionsByProject(sessions || [])
            .filter((g) => g.workingDirectory)
            .map((g) => ({ cwd: g.workingDirectory, name: g.displayName }));
        }
      } catch {
        // sessions unavailable — fall back to no projects
      }
      setProjects(projList);

      // 2. Fetch skills across every project at once (cwds=[] → no project
      //    items, never the server's own process.cwd()).
      const cwds = projList.map((p) => p.cwd);
      const res = await fetch(`/api/skills?cwds=${encodeURIComponent(JSON.stringify(cwds))}`);
      if (res.ok) {
        const data = await res.json();
        const nameByCwd = new Map(projList.map((p) => [p.cwd, p.name]));
        const items: SkillItem[] = (data.skills || []).map((s: SkillItem) =>
          s.source === "project" && s.projectCwd
            ? {
                ...s,
                projectName:
                  nameByCwd.get(s.projectCwd) ||
                  s.projectCwd.split(/[\\/]/).filter(Boolean).pop() ||
                  s.projectCwd,
              }
            : s
        );
        setSkills(items);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSkills();
  }, [fetchSkills]);

  const handleCreate = useCallback(
    async (
      name: string,
      scope: "global" | "project",
      content: string,
      projectCwd?: string
    ) => {
      const cwd = scope === "project" ? projectCwd : undefined;
      const res = await fetch("/api/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, content, scope, cwd }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create skill");
      }
      const data = await res.json();
      const created: SkillItem =
        scope === "project" && projectCwd
          ? {
              ...data.skill,
              projectCwd,
              projectName:
                projects.find((p) => p.cwd === projectCwd)?.name ||
                projectCwd.split(/[\\/]/).filter(Boolean).pop() ||
                projectCwd,
            }
          : data.skill;
      // Refresh the aggregate so the new skill lands in the right section.
      await fetchSkills();
      setSelected(created);
    },
    [projects, fetchSkills]
  );

  const buildSkillUrl = useCallback((skill: SkillItem) => {
    const params = new URLSearchParams();
    if (skill.source === "installed" && skill.installedSource) {
      params.set("source", skill.installedSource);
    }
    // Project skills must target their OWN project directory, not whatever
    // conversation happens to be selected.
    if (skill.source === "project" && skill.projectCwd) {
      params.set("cwd", skill.projectCwd);
    }
    const qs = params.toString();
    return `/api/skills/${encodeURIComponent(skill.name)}${qs ? `?${qs}` : ""}`;
  }, []);

  const handleSave = useCallback(
    async (skill: SkillItem, content: string) => {
      const res = await fetch(buildSkillUrl(skill), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save skill");
      }
      const data = await res.json();
      // PUT response doesn't carry project tagging — preserve it from the
      // original item.
      const updated: SkillItem = {
        ...data.skill,
        projectCwd: skill.projectCwd,
        projectName: skill.projectName,
      };
      setSkills((prev) => prev.map((s) => (sameSkill(s, skill) ? updated : s)));
      setSelected(updated);
    },
    [buildSkillUrl]
  );

  const handleDelete = useCallback(
    async (skill: SkillItem) => {
      const res = await fetch(buildSkillUrl(skill), { method: "DELETE" });
      if (res.ok) {
        setSkills((prev) => prev.filter((s) => !sameSkill(s, skill)));
        if (selected && sameSkill(selected, skill)) {
          setSelected(null);
        }
      }
    },
    [buildSkillUrl, selected]
  );

  const filtered = skills.filter(
    (s) =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.description.toLowerCase().includes(search.toLowerCase())
  );

  const globalSkills = filtered.filter((s) => s.source === "global");
  const installedSkills = filtered.filter((s) => s.source === "installed");
  const pluginSkills = filtered.filter((s) => s.source === "plugin");

  // Group project skills by their owning project, preserving project order.
  const projectSections = projects
    .map((p) => ({
      project: p,
      skills: filtered.filter((s) => s.source === "project" && s.projectCwd === p.cwd),
    }))
    .filter((g) => g.skills.length > 0);

  const isSelected = (skill: SkillItem) => !!selected && sameSkill(selected, skill);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <SpinnerGap size={20} className="animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">
          {t('skills.loadingSkills')}
        </span>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Fixed header */}
      <div className="shrink-0 border-b border-border/50 px-6 pt-4 pb-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">{t('extensions.skills')}</h1>
            <p className="text-sm text-muted-foreground mt-1">{t('skills.description' as TranslationKey)}</p>
          </div>
          {viewTab === "local" && (
            <Button size="sm" onClick={() => setShowCreate(true)} className="gap-1">
              <Plus size={14} />
              {t('skills.newSkill')}
            </Button>
          )}
        </div>
        {/* Segmented control */}
        <div className="flex items-center bg-muted rounded-md p-0.5 mt-3 w-fit">
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "px-3 py-1 text-xs font-medium rounded h-auto",
              viewTab === "local"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
            onClick={() => setViewTab("local")}
          >
            {t('skills.mySkills')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "px-3 py-1 text-xs font-medium rounded h-auto",
              viewTab === "marketplace"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
            onClick={() => setViewTab("marketplace")}
          >
            {t('skills.marketplace')}
          </Button>
          {internalVisible && (
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                "px-3 py-1 text-xs font-medium rounded h-auto",
                viewTab === "internal"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
              onClick={() => setViewTab("internal")}
            >
              {t('skills.internalMarketplace')}
            </Button>
          )}
        </div>
      </div>

      {/* Main content */}
      {viewTab === "internal" && internalVisible ? (
        <InternalStoreBrowser
          onInstalled={fetchSkills}
          onUnavailable={handleInternalUnavailable}
        />
      ) : viewTab === "marketplace" ? (
        <MarketplaceBrowser onInstalled={fetchSkills} />
      ) : (
      <div className="flex flex-1 min-h-0">
        {/* Left: skill list */}
        <div className="w-64 shrink-0 flex flex-col overflow-hidden pl-4">
          <div className="px-2 pt-4 pb-2">
            <div className="relative">
              <MagnifyingGlass size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder={t('skills.searchSkills')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-7 h-8 text-sm"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto min-h-0">
            <div className="p-1">
              {/* One section per project that has skills */}
              {projectSections.map(({ project, skills: projSkills }) => (
                <div className="mb-1" key={`proj:${project.cwd}`}>
                  <span
                    className="block truncate px-3 py-1 text-[10px] font-medium uppercase text-muted-foreground"
                    title={project.cwd}
                  >
                    {project.name}
                  </span>
                  {projSkills.map((skill) => (
                    <SkillListItem
                      key={`${skill.projectCwd}:${skill.name}`}
                      skill={skill}
                      selected={isSelected(skill)}
                      onSelect={() => setSelected(skill)}
                      onDelete={handleDelete}
                    />
                  ))}
                </div>
              ))}
              {globalSkills.length > 0 && (
                <div className="mb-1">
                  <span className="px-3 py-1 text-[10px] font-medium uppercase text-muted-foreground">
                    Global
                  </span>
                  {globalSkills.map((skill) => (
                    <SkillListItem
                      key={`${skill.source}:${skill.installedSource ?? "default"}:${skill.name}`}
                      skill={skill}
                      selected={isSelected(skill)}
                      onSelect={() => setSelected(skill)}
                      onDelete={handleDelete}
                    />
                  ))}
                </div>
              )}
              {installedSkills.length > 0 && (
                <div className="mb-1">
                  <span className="px-3 py-1 text-[10px] font-medium uppercase text-muted-foreground">
                    Installed
                  </span>
                  {installedSkills.map((skill) => (
                    <SkillListItem
                      key={`${skill.source}:${skill.installedSource ?? "default"}:${skill.name}`}
                      skill={skill}
                      selected={isSelected(skill)}
                      onSelect={() => setSelected(skill)}
                      onDelete={handleDelete}
                    />
                  ))}
                </div>
              )}
              {pluginSkills.length > 0 && (
                <div className="mb-1">
                  <span className="px-3 py-1 text-[10px] font-medium uppercase text-muted-foreground">
                    Plugins
                  </span>
                  {pluginSkills.map((skill) => (
                    <SkillListItem
                      key={skill.filePath || `${skill.source}:${skill.installedSource ?? "default"}:${skill.name}`}
                      skill={skill}
                      selected={isSelected(skill)}
                      onSelect={() => setSelected(skill)}
                      onDelete={handleDelete}
                    />
                  ))}
                </div>
              )}
              {filtered.length === 0 && (
                <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
                  <Lightning size={32} className="opacity-40" />
                  <p className="text-xs">
                    {search ? t('skills.noSkillsFound') : t('skills.noSkillsFound')}
                  </p>
                  {!search && (
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={() => setShowCreate(true)}
                      className="gap-1"
                    >
                      <Plus size={12} />
                      Create one
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Divider */}
        <div className="shrink-0 w-px bg-border/50" />

        {/* Right: editor */}
        <div className="flex-1 min-w-0 overflow-hidden">
          {selected ? (
            <SkillEditor
              key={`${selected.source}:${selected.projectCwd ?? ""}:${selected.name}`}
              skill={selected}
              onSave={handleSave}
              onDelete={handleDelete}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
              <Lightning size={48} className="opacity-30" />
              <div className="text-center">
                <p className="text-sm font-medium">{t('skills.noSelected')}</p>
                <p className="text-xs">
                  {t('skills.selectOrCreate')}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowCreate(true)}
                className="gap-1"
              >
                <Plus size={14} />
                {t('skills.newSkill')}
              </Button>
            </div>
          )}
        </div>
      </div>
      )}

      <CreateSkillDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        onCreate={handleCreate}
        projects={projects}
        defaultProjectCwd={workingDirectory || undefined}
      />
    </div>
  );
}
