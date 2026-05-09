"use client";

import { useState, useCallback, useSyncExternalStore } from "react";
import { type Icon, Gear, Code, UserCircle, Plug, ChartBar, Lightning, Terminal } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { GeneralSection } from "./GeneralSection";
import { ProviderManager } from "./ProviderManager";
import { CliSettingsSection } from "./CliSettingsSection";
import { UsageStatsSection } from "./UsageStatsSection";
import { AssistantWorkspaceSection } from "./AssistantWorkspaceSection";
// Skills / MCP / CLI Tools managers — embedded as settings sub-sections so
// users have a single panel for everything customizable. The /skills, /mcp,
// /cli-tools routes still exist (FileTreePanel deep-links etc.) but the
// sidebar links to them have been hidden in NavRail / ChatListPanel.
import { SkillsManager } from "@/components/skills/SkillsManager";
import { McpManager } from "@/components/plugins/McpManager";
import { CliToolsManager } from "@/components/cli-tools/CliToolsManager";
import { useTranslation } from "@/hooks/useTranslation";
import type { TranslationKey } from "@/i18n";

type Section = "general" | "providers" | "cli" | "usage" | "assistant" | "skills" | "mcp" | "cli-tools";

interface SidebarItem {
  id: Section;
  label: string;
  icon: Icon;
}

const sidebarItems: SidebarItem[] = [
  { id: "general", label: "General", icon: Gear },
  { id: "providers", label: "Providers", icon: Plug },
  { id: "cli", label: "Claude CLI", icon: Code },
  { id: "usage", label: "Usage", icon: ChartBar },
  // Hidden from settings sidebar — assistant section + AssistantWorkspaceSection
  // logic still in the codebase. Restore by uncommenting.
  // { id: "assistant", label: "Assistant", icon: UserCircle },
  // Phase: Skills / MCP / CLI Tools moved here from the main app sidebar so
  // the settings panel becomes the single home for all customization. The
  // standalone routes remain navigable via direct URL or deep links.
  { id: "skills", label: "Skills", icon: Lightning },
  { id: "mcp", label: "MCP", icon: Plug },
  { id: "cli-tools", label: "CLI Tools", icon: Terminal },
];

function getSectionFromHash(): Section {
  if (typeof window === "undefined") return "general";
  const hash = window.location.hash.replace("#", "");
  if (sidebarItems.some((item) => item.id === hash)) {
    return hash as Section;
  }
  return "general";
}

function subscribeToHash(callback: () => void) {
  window.addEventListener("hashchange", callback);
  return () => window.removeEventListener("hashchange", callback);
}

export function SettingsLayout() {
  // useSyncExternalStore subscribes to hash changes without triggering
  // the react-hooks/set-state-in-effect lint rule.
  const hashSection = useSyncExternalStore(subscribeToHash, getSectionFromHash, () => "general" as Section);

  // Local state allows immediate UI update on click before the hash updates.
  const [overrideSection, setOverrideSection] = useState<Section | null>(null);
  const activeSection = overrideSection ?? hashSection;

  const { t } = useTranslation();

  const settingsLabelKeys: Record<string, TranslationKey> = {
    'General': 'settings.general',
    'Providers': 'settings.providers',
    'Claude CLI': 'settings.claudeCli',
    'Usage': 'settings.usage',
    'Assistant': 'settings.assistant',
    // Reuse the existing nav.* keys from when these sections lived in the
    // main app sidebar — keeps the labels in lockstep across both surfaces
    // for the lifetime of the migration (and beyond if anyone restores
    // those NavRail / ChatListPanel entries).
    'Skills': 'nav.skills',
    'MCP': 'nav.mcp',
    'CLI Tools': 'nav.cliTools',
  };

  const handleSectionChange = useCallback((section: Section) => {
    setOverrideSection(section);
    window.history.replaceState(null, "", `/settings#${section}`);
    // Clear override so subsequent hash changes take effect
    queueMicrotask(() => setOverrideSection(null));
  }, []);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border/50 px-6 pt-4 pb-4">
        <h1 className="text-xl font-semibold">{t('settings.title')}</h1>
        {/* Subtitle hidden — restore by uncommenting below */}
        {/* <p className="text-sm text-muted-foreground">
          {t('settings.description')}
        </p> */}
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Sidebar */}
        <nav className="flex w-52 shrink-0 flex-col gap-1 border-r border-border/50 p-3">
          {sidebarItems.map((item) => (
            <Button
              key={item.id}
              variant="ghost"
              onClick={() => handleSectionChange(item.id)}
              className={cn(
                "justify-start gap-3 px-3 py-2 text-sm font-medium text-left w-full",
                activeSection === item.id
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              )}
            >
              <item.icon size={16} className="shrink-0" />
              {t(settingsLabelKeys[item.label])}
            </Button>
          ))}
        </nav>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          {activeSection === "general" && <GeneralSection />}
          {activeSection === "providers" && <ProviderManager />}
          {activeSection === "cli" && <CliSettingsSection />}
          {activeSection === "usage" && <UsageStatsSection />}
          {activeSection === "assistant" && <AssistantWorkspaceSection />}
          {activeSection === "skills" && <SkillsManager />}
          {activeSection === "mcp" && <McpManager />}
          {activeSection === "cli-tools" && <CliToolsManager />}
        </div>
      </div>
    </div>
  );
}
