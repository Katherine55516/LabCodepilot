"use client";

import { Button } from "@/components/ui/button";
import { ArrowSquareOut, Book } from "@/components/ui/icon";
import { SettingsCard } from "@/components/patterns/SettingsCard";
import { useTranslation } from "@/hooks/useTranslation";

/** 在线用户手册（MrDoc 站点）。桌面端点击后由主进程 shell.openExternal 交给系统默认浏览器。 */
const USER_MANUAL_URL = "https://mrdoc.ai-native-lab.com/doc/3/";

/**
 * 设置页「帮助」— 目前只有一个入口：跳转在线用户手册。
 *
 * 用 window.open(url, "_blank") 而非 <a>：Electron 主进程的 setWindowOpenHandler
 * （electron/main.ts）会拦下 http(s) 目标交给 shell.openExternal，因此桌面端
 * 打开的是系统默认浏览器而非应用内窗口；浏览器 dev 环境下则是新标签页。
 */
export function HelpSection() {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{t("help.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("help.description")}</p>
      </div>

      <SettingsCard>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <Book size={20} className="mt-0.5 shrink-0 text-muted-foreground" />
            <div className="space-y-0.5 min-w-0">
              <div className="text-sm font-medium">{t("help.manual")}</div>
              <p className="text-xs text-muted-foreground">{t("help.manualHint")}</p>
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="shrink-0 gap-2"
            onClick={() => window.open(USER_MANUAL_URL, "_blank", "noopener,noreferrer")}
          >
            <ArrowSquareOut size={14} />
            {t("help.openManual")}
          </Button>
        </div>
      </SettingsCard>
    </div>
  );
}
