"use client";

import { cn } from "@/lib/utils";

/** 状态色调 → 语义 token。裸色值会被 `npm run lint:colors` 拦下,且不跟随明暗主题。 */
const TONE_CLASS = {
  ok: "bg-status-success-muted text-status-success-foreground border-status-success-border",
  warn: "bg-status-warning-muted text-status-warning-foreground border-status-warning-border",
  err: "bg-status-error-muted text-status-error-foreground border-status-error-border",
  muted: "bg-muted text-muted-foreground border-border",
} as const;

export type ChipTone = keyof typeof TONE_CLASS;

/** 定时任务各处共用的状态徽标(列表卡片、详情页标题、历史表格)。 */
export function StatusChip({
  tone,
  children,
  className,
}: {
  tone: ChipTone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 text-[10.5px] font-medium leading-none",
        TONE_CLASS[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
