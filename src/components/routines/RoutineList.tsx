"use client";

import { CalendarBlank, Clock, Play, Pause, Plus, CheckCircle, XCircle } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/hooks/useTranslation";
import type { TranslationKey } from "@/i18n";
import type { CoworkRoutine } from "@/types";
import { cn } from "@/lib/utils";
import { describeSchedule, formatDateTime, routineBadge } from "@/lib/routine-ui";
import { StatusChip } from "./StatusChip";

/**
 * 第一层:任务列表(P6)。
 *
 * 每张卡回答三个问题:**干什么的、什么时候跑、上次跑得怎么样**。
 * 失败原因直接摊在卡片上而不是藏进详情页 —— 定时任务最需要被看见的恰恰是失败,
 * 藏一层就等于要求用户先怀疑、再点进去确认。
 */
export function RoutineList({
  routines,
  max,
  usedToday,
  dailyCap,
  offline,
  busyId,
  onOpen,
  onCreate,
  onToggle,
  onRunNow,
}: {
  routines: CoworkRoutine[];
  max: number;
  usedToday?: number;
  dailyCap?: number;
  offline: boolean;
  /** 正在提交操作的 routine id,用来禁用按钮防重复点击 */
  busyId: string;
  onOpen: (r: CoworkRoutine) => void;
  onCreate: () => void;
  onToggle: (r: CoworkRoutine) => void;
  onRunNow: (r: CoworkRoutine) => void;
}) {
  const { t } = useTranslation();
  const atLimit = routines.length >= max;
  const quotaExhausted = usedToday != null && dailyCap != null && usedToday >= dailyCap;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip tone="muted">{`${routines.length} / ${max}`}</StatusChip>
        {usedToday != null && dailyCap != null && (
          <StatusChip tone={quotaExhausted ? "err" : "muted"}>
            {t("routines.list.quota", { used: usedToday, cap: dailyCap })}
          </StatusChip>
        )}
        <span className="flex-1" />
        <Button
          size="sm"
          className="h-7 gap-1.5 text-xs"
          disabled={offline || atLimit}
          onClick={onCreate}
        >
          <Plus size={13} />
          {t("routines.list.create")}
        </Button>
      </div>

      {/* 边界信息要说清「发生了什么、什么时候恢复、现在能做什么」——
          定时任务无人值守,用户对它的信任全靠这些边界建立。 */}
      {atLimit && (
        <p className="rounded-md border border-status-error-border bg-status-error-muted px-3 py-2 text-xs text-status-error-foreground">
          {t("routines.list.atLimit", { max })}
        </p>
      )}
      {quotaExhausted && (
        <p className="rounded-md border border-status-error-border bg-status-error-muted px-3 py-2 text-xs text-status-error-foreground">
          {t("routines.list.quotaExhausted", { cap: dailyCap! })}
        </p>
      )}

      {routines.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-14 text-center">
          <Clock size={30} className="mx-auto text-muted-foreground/60" />
          <p className="mt-3 text-xs text-muted-foreground">{t("routines.list.empty")}</p>
          <p className="mt-1 text-xs text-muted-foreground/80">{t("routines.list.emptyHint")}</p>
        </div>
      ) : (
        routines.map((r) => {
          const badge = routineBadge(r);
          const failed = r.last_status && r.last_status !== "success";
          const busy = busyId === r.id;
          return (
            <div
              key={r.id}
              role="button"
              tabIndex={0}
              onClick={() => onOpen(r)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(r); } }}
              className={cn(
                "cursor-pointer rounded-lg border border-border bg-card p-3 transition-colors hover:border-foreground/20 hover:bg-accent/40",
                !r.enabled && "opacity-65",
              )}
            >
              <div className="flex items-center gap-2">
                <span className="truncate text-[13px] font-medium">{r.name}</span>
                <StatusChip tone={badge.tone}>{t(badge.key as TranslationKey, badge.params)}</StatusChip>
                <span className="flex-1" />
                <div className="flex shrink-0 gap-1" onClick={(e) => e.stopPropagation()}>
                  {!!r.enabled && (
                    <Button
                      variant="ghost" size="sm" className="h-6 gap-1 px-2 text-xs"
                      disabled={offline || busy}
                      onClick={() => onRunNow(r)}
                    >
                      <Play size={11} />
                      {t("routines.action.runNow")}
                    </Button>
                  )}
                  <Button
                    variant="ghost" size="sm" className="h-6 gap-1 px-2 text-xs"
                    disabled={offline || busy}
                    onClick={() => onToggle(r)}
                  >
                    {r.enabled ? <Pause size={11} /> : <Play size={11} />}
                    {r.enabled ? t("routines.action.pause") : t("routines.action.resume")}
                  </Button>
                </div>
              </div>

              {r.description && (
                <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{r.description}</p>
              )}

              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <CalendarBlank size={11} />
                  {describeSchedule(r, t as (k: string, p?: Record<string, string | number>) => string)}
                </span>
                {!!r.enabled && r.next_run_at && (
                  <span className="flex items-center gap-1">
                    <Clock size={11} />
                    {t("routines.list.next", { time: formatDateTime(r.next_run_at) })}
                  </span>
                )}
                {r.last_run_at && (
                  <span className={cn("flex items-center gap-1", failed && "text-status-error-foreground")}>
                    {failed ? <XCircle size={11} /> : <CheckCircle size={11} />}
                    {t("routines.list.last", { time: formatDateTime(r.last_run_at) })}
                  </span>
                )}
                {!r.enabled && r.disabled_reason && (
                  <span className="text-status-error-foreground">{r.disabled_reason}</span>
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
