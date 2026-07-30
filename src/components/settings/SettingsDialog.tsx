"use client";

import { useEffect, useState } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { X } from "@/components/ui/icon";
import { DialogPortal, DialogOverlay, DialogTitle } from "@/components/ui/dialog";
import { SettingsLayout, normalizeSection, type Section } from "./SettingsLayout";
import { useTranslation } from "@/hooks/useTranslation";

/**
 * 打开设置弹窗的全局事件。
 *
 *   window.dispatchEvent(new CustomEvent('open-settings', { detail: { section: 'cli' } }))
 *
 * 与既有的 'open-setup-center' 同一套路子:不引入全局 store,任何组件(包括在
 * SSE 流里渲染出来的 markdown 链接经 /settings 兼容层转发的那些)都能触发。
 */
export const OPEN_SETTINGS_EVENT = "open-settings";

export function openSettings(section?: Section | string) {
  window.dispatchEvent(
    new CustomEvent(OPEN_SETTINGS_EVENT, { detail: { section } })
  );
}

/**
 * 设置弹窗 —— 浮在应用中央、背景虚化,取代原来的 /settings 整页。
 *
 * 挂在 AppShell 顶层,全局唯一一份。底层路由完全不动,所以从任何会话打开设置、
 * 关掉之后都还停在原来的对话上,不会像整页设置那样丢掉当前上下文。
 *
 * 这里直接用 Radix 的 Content 而不是 ui/dialog 的 DialogContent:后者写死了
 * p-6 / gap-4 / sm:max-w-lg,而设置要的是无内边距的左右分栏大面板。
 */
export function SettingsDialog() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<Section>("general");

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setSection(normalizeSection(detail?.section));
      setOpen(true);
    };
    window.addEventListener(OPEN_SETTINGS_EVENT, handler);
    return () => window.removeEventListener(OPEN_SETTINGS_EVENT, handler);
  }, []);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPortal>
        {/* 背景虚化 —— 与 Claude 桌面版一致:底层应用仍可见但推到焦点之外 */}
        <DialogOverlay className="bg-black/30 backdrop-blur-sm dark:bg-black/50" />
        <DialogPrimitive.Content
          data-slot="settings-dialog"
          className={
            "bg-background fixed top-[50%] left-[50%] z-50 flex w-[calc(100vw-2rem)] max-w-4xl " +
            "h-[calc(100vh-3rem)] max-h-[720px] translate-x-[-50%] translate-y-[-50%] flex-col " +
            "sm:w-[calc(100vw-4rem)] sm:h-[calc(100vh-6rem)] " +
            "overflow-hidden rounded-xl border shadow-2xl outline-none duration-200 " +
            "data-[state=open]:animate-in data-[state=closed]:animate-out " +
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 " +
            "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
          }
          // 设置面板没有一句话摘要,显式置空避免 Radix 的 aria-describedby 警告
          aria-describedby={undefined}
        >
          <SettingsLayout
            section={section}
            onSectionChange={setSection}
            titleSlot={
              <div className="flex shrink-0 items-center justify-between border-b border-border/50 px-6 py-4">
                <DialogTitle className="text-base font-semibold">
                  {t("settings.title")}
                </DialogTitle>
                <DialogPrimitive.Close
                  className="text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring -mr-2 rounded-md p-1.5 transition-colors focus-visible:ring-2 focus-visible:outline-none"
                  aria-label={t("common.close")}
                >
                  <X size={18} />
                </DialogPrimitive.Close>
              </div>
            }
          />
        </DialogPrimitive.Content>
      </DialogPortal>
    </DialogPrimitive.Root>
  );
}
