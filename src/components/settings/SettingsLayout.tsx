"use client";

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

export type Section = "general" | "account" | "providers" | "cli" | "usage" | "assistant" | "skills" | "mcp" | "cli-tools" | "bridge" | "plugins" | "test-accounts" | "feedback" | "help";

interface SidebarItem {
  id: Section;
  label: string;
  icon: Icon;
}

const sidebarItems: SidebarItem[] = [
  { id: "general", label: "General", icon: Gear },
  { id: "account", label: "Account", icon: UserCircle },
  { id: "providers", label: "Providers", icon: Plug },
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
  // Built-in plugins panel — currently hosts vendor-bundled AI_LabTest.
  // See electron/ailab-installer.ts + docs/handover/ailab-plugin.md.
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

/** 把任意字符串归一成合法 Section —— 非法值一律回落 general。深链的 hash
 *  可能指向已隐藏的 tab(providers / usage / assistant),这些 Section 分支仍在
 *  渲染,所以此处按全集校验而非 sidebarItems。 */
const ALL_SECTIONS: Section[] = [
  "general", "account", "providers", "cli", "usage", "assistant", "skills",
  "mcp", "cli-tools", "bridge", "plugins", "test-accounts", "feedback", "help",
];

export function normalizeSection(raw: string | null | undefined): Section {
  return ALL_SECTIONS.includes(raw as Section) ? (raw as Section) : "general";
}

export interface SettingsLayoutProps {
  /**
   * 当前分类 —— 受控,由 SettingsDialog 持有。
   *
   * 以前这里自己读写 URL hash(`/settings#cli`),因为设置是一整页。现在设置是浮在
   * 应用之上的弹窗,底层路由必须保持不动:否则点一下侧栏分类就会把地址栏改成
   * /settings,顶掉用户正待着的会话。
   */
  section: Section;
  onSectionChange: (section: Section) => void;
  /** 顶部标题栏。弹窗需要它是 DialogTitle 才满足 Radix 的 a11y 要求,故由外部传入。 */
  titleSlot?: React.ReactNode;
}

export function SettingsLayout({ section: activeSection, onSectionChange, titleSlot }: SettingsLayoutProps) {
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

  return (
    <div className="flex h-full min-h-0 flex-col">
      {titleSlot}

      {/* 窄屏(<sm)分类改为顶部横向条 —— 208px 的竖侧栏在手机宽度下会把内容区
          压到只剩百来像素,文字被逼成竖排。宽屏维持左右分栏。 */}
      <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
        {/* Sidebar —— 分类多于弹窗高度时侧栏自己滚动,不把整个弹窗撑高 */}
        <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-border/50 p-2 sm:w-52 sm:flex-col sm:overflow-x-visible sm:overflow-y-auto sm:border-r sm:border-b-0 sm:p-3">
          {sidebarItems.map((item) => (
            <Button
              key={item.id}
              variant="ghost"
              onClick={() => onSectionChange(item.id)}
              className={cn(
                "shrink-0 justify-start gap-3 px-3 py-2 text-sm font-medium text-left sm:w-full",
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

        {/* Content —— key 让切换分类时滚动位置回到顶部(否则从长页面切到短页面
            会停在中间);min-w-0 防止宽内容(表格/代码块)把弹窗撑破。 */}
        <div key={activeSection} className="min-w-0 flex-1 overflow-auto p-6">
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
