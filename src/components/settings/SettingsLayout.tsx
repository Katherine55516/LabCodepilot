"use client";

import { useState, useCallback, useSyncExternalStore } from "react";
import { type Icon, Gear, Code, UserCircle, Plug, ChartBar, Lightning, Terminal, Sparkle, WifiHigh, ListChecks, ChatCircleText, Question } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { GeneralSection } from "./GeneralSection";
import { ProviderManager } from "./ProviderManager";
import { CliSettingsSection } from "./CliSettingsSection";
import { UsageStatsSection } from "./UsageStatsSection";
import { AssistantWorkspaceSection } from "./AssistantWorkspaceSection";
import { TestAccountsSection } from "./TestAccountsSection";
import { FeedbackSection } from "./FeedbackSection";
import { HelpSection } from "./HelpSection";
import { AccountSection } from "@/components/account/AccountSection";
// Skills / MCP / CLI Tools managers — embedded as settings sub-sections so
// users have a single panel for everything customizable. The /skills, /mcp,
// /cli-tools routes still exist (FileTreePanel deep-links etc.) but the
// sidebar links to them have been hidden in NavRail / ChatListPanel.
import { SkillsManager } from "@/components/skills/SkillsManager";
import { McpManager } from "@/components/plugins/McpManager";
import { CliToolsManager } from "@/components/cli-tools/CliToolsManager";
import { PluginsManager } from "./PluginsManager";
// Remote Bridge — moved into Settings as a sub-section. /bridge route still
// works for users with a bookmarked URL; embedded={true} disables BridgeLayout's
// own hash routing so it doesn't fight with SettingsLayout's hash routing.
import { BridgeLayout } from "@/components/bridge/BridgeLayout";
import { useTranslation } from "@/hooks/useTranslation";
import type { TranslationKey } from "@/i18n";

type Section = "general" | "account" | "providers" | "cli" | "usage" | "assistant" | "skills" | "mcp" | "cli-tools" | "bridge" | "plugins" | "test-accounts" | "feedback" | "help";

interface SidebarItem {
  id: Section;
  label: string;
  icon: Icon;
}

const sidebarItems: SidebarItem[] = [
  { id: "general", label: "General", icon: Gear },
  { id: "account", label: "Account", icon: UserCircle },
  // Providers tab hidden — API providers are pushed by the managed-account
  // login system; users no longer self-configure them. The "providers"
  // Section value, ProviderManager render branch, and hash-bridge to
  // /settings#providers stay live (used by error toasts + bootstrap
  // flows) so this is UI-only. Restore by uncommenting.
  // { id: "providers", label: "Providers", icon: Plug },
  { id: "cli", label: "Claude CLI", icon: Code },
  // Usage tab hidden — UsageStatsSection render branch, Section type entry,
  // i18n key, and #usage hash bridge stay live so deep links still resolve.
  // Restore by uncommenting.
  // { id: "usage", label: "Usage", icon: ChartBar },
  // Hidden from settings sidebar — assistant section + AssistantWorkspaceSection
  // logic still in the codebase. Restore by uncommenting.
  // { id: "assistant", label: "Assistant", icon: UserCircle },
  // Phase: Skills / MCP / CLI Tools moved here from the main app sidebar so
  // the settings panel becomes the single home for all customization. The
  // standalone routes remain navigable via direct URL or deep links.
  { id: "skills", label: "Skills", icon: Lightning },
  { id: "mcp", label: "MCP", icon: Plug },
  { id: "cli-tools", label: "CLI Tools", icon: Terminal },
  // Remote Bridge — IM channels (Telegram / Feishu / Discord / QQ / WeChat).
  // Standalone /bridge route still exists; this is the primary entry point.
  { id: "bridge", label: "Bridge", icon: WifiHigh },
  // Built-in plugins panel — currently hosts vendor-bundled GSD.
  // See electron/gsd-installer.ts + docs/handover/gsd-bundle.md.
  { id: "plugins", label: "Plugins", icon: Sparkle },
  // Test Accounts — multi-system test credentials, exported to AI_LabTest
  // environments.json. See docs/handover/test-account-settings.md.
  { id: "test-accounts", label: "Test Accounts", icon: ListChecks },
  // 问题反馈 — 登录态一键上报到账号后端（admin 管理页可见）。
  // See docs/exec-plans/active/bug-report-feedback.md.
  { id: "feedback", label: "Feedback", icon: ChatCircleText },
  // 帮助 — 在线用户手册入口，点击后由系统默认浏览器打开。放在最后一项。
  { id: "help", label: "Help", icon: Question },
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
    'Account': 'auth.account',
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
    'Bridge': 'settings.bridge',
    'Plugins': 'settings.plugins.title',
    'Test Accounts': 'settings.testAccounts',
    'Feedback': 'settings.feedback',
    'Help': 'settings.help',
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
          {activeSection === "account" && <AccountSection />}
          {activeSection === "providers" && <ProviderManager />}
          {activeSection === "cli" && <CliSettingsSection />}
          {activeSection === "usage" && <UsageStatsSection />}
          {activeSection === "assistant" && <AssistantWorkspaceSection />}
          {activeSection === "skills" && <SkillsManager />}
          {activeSection === "mcp" && <McpManager />}
          {activeSection === "cli-tools" && <CliToolsManager />}
          {activeSection === "bridge" && <BridgeLayout embedded />}
          {activeSection === "plugins" && <PluginsManager />}
          {activeSection === "test-accounts" && <TestAccountsSection />}
          {activeSection === "feedback" && <FeedbackSection />}
          {activeSection === "help" && <HelpSection />}
        </div>
      </div>
    </div>
  );
}
