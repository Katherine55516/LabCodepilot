"use client";

import { CalendarBlank, Clock, Play, Pause, PencilSimple, Trash, Robot } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useTranslation } from "@/hooks/useTranslation";
import type { TranslationKey } from "@/i18n";
import type { CoworkRoutine, RoutineRun } from "@/types";
import { cn } from "@/lib/utils";
import {
  describeSchedule, formatDateTime, formatDuration,
  routineBadge, runResultText, runStatusText, runTone,
} from "@/lib/routine-ui";
import { StatusChip } from "./StatusChip";

/**
 * 第二层:任务详情 = 配置摘要 + 运行历史(P6)。
 *
 * 历史里每一行都能点开成完整会话(第三层)—— 这是「我怎么知道它到底干了什么」的答案。
 * **「跳过」也要列出来并给原因**(上次没跑完 / 并发满 / 配额用尽):没有这一行,
 * 用户只会看到「今天怎么没跑」,无从判断是坏了还是被限了。
 */
export function RoutineDetail({
  routine,
  runs,
  loadingRuns,
  sessionByRun,
  configName,
  offline,
  busy,
  onOpenRun,
  onEdit,
  onDelete,
  onToggle,
  onRunNow,
}: {
  routine: CoworkRoutine;
  runs: RoutineRun[];
  loadingRuns: boolean;
  /** 该任务绑定的账号配置显示名。空 = 跟随账号配置 / 配置已下架 */
  configName: string;
  /** runId → 本地会话 id。没有的行不可点(还没同步到本地) */
  sessionByRun: Record<string, string>;
  offline: boolean;
  busy: boolean;
  onOpenRun: (run: RoutineRun) => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
  onRunNow: () => void;
}) {
  const { t } = useTranslation();
  const badge = routineBadge(routine);
  const tt = t as (k: string, p?: Record<string, string | number>) => string;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-medium">{routine.name}</h2>
        <StatusChip tone={badge.tone}>{t(badge.key as TranslationKey, badge.params)}</StatusChip>
        <span className="flex-1" />
        <div className="flex gap-1.5">
          {!!routine.enabled && (
            <Button size="sm" className="h-7 gap-1 text-xs" disabled={offline || busy} onClick={onRunNow}>
              <Play size={11} />
              {t("routines.action.runNow")}
            </Button>
          )}
          <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" disabled={offline || busy} onClick={onToggle}>
            {routine.enabled ? <Pause size={11} /> : <Play size={11} />}
            {routine.enabled ? t("routines.action.pause") : t("routines.action.resume")}
          </Button>
          <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" disabled={offline || busy} onClick={onEdit}>
            <PencilSimple size={11} />
            {t("routines.edit")}
          </Button>
          <Button
            variant="outline" size="sm"
            className="h-7 gap-1 text-xs text-status-error-foreground hover:text-status-error-foreground"
            disabled={offline || busy}
            onClick={onDelete}
          >
            <Trash size={11} />
            {t("common.delete")}
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-3">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <CalendarBlank size={11} />
            {describeSchedule(routine, tt)}
            {routine.schedule_tz && <span className="opacity-70">（{routine.schedule_tz}）</span>}
          </span>
          {!!routine.enabled && routine.next_run_at && (
            <span className="flex items-center gap-1">
              <Clock size={11} />
              {t("routines.list.next", { time: formatDateTime(routine.next_run_at) })}
            </span>
          )}
          <span className="flex items-center gap-1">
            <Robot size={11} />
            {/* 显示**账号配置名**(与聊天页、表单下拉同一套叫法)。configName 由列表
                接口按 config_id 投影而来;拿不到时才退回裸 model(存量任务只存了
                model 没存 config_id)。 */}
            {configName || routine.model || t("routines.form.modelDefault")}
          </span>
        </div>
        {routine.description && (
          <p className="mt-2 text-xs text-muted-foreground">{routine.description}</p>
        )}
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
            {t("routines.detail.showPrompt")}
          </summary>
          <pre className="mt-1.5 whitespace-pre-wrap rounded border border-border bg-muted/40 p-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
            {routine.prompt}
          </pre>
        </details>
      </div>

      <div>
        <h3 className="mb-2 text-xs font-medium">{t("routines.detail.history")}</h3>
        {loadingRuns ? (
          <div className="flex items-center gap-2 py-6 text-xs text-muted-foreground">
            <Spinner className="size-3.5" />
            {t("common.loading")}
          </div>
        ) : runs.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border py-8 text-center text-xs text-muted-foreground">
            {t("routines.detail.noRuns")}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-muted-foreground">
                  <th className="px-3 py-2 text-left font-medium">{t("routines.detail.colTime")}</th>
                  <th className="px-3 py-2 text-left font-medium">{t("routines.detail.colStatus")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("routines.detail.colDuration")}</th>
                  {/* 成本列已按产品决策移除:后端仍记 costUsd,只是不给用户看。 */}
                  <th className="px-3 py-2 text-left font-medium">{t("routines.detail.colResult")}</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => {
                  const tone = runTone(run.status);
                  const openable = !!sessionByRun[run.runId];
                  return (
                    <tr
                      key={run.runId}
                      onClick={() => openable && onOpenRun(run)}
                      className={cn(
                        "border-b border-border last:border-0",
                        openable ? "cursor-pointer hover:bg-accent/40" : "cursor-default",
                      )}
                    >
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-muted-foreground">
                        {formatDateTime(run.startedAt)}
                      </td>
                      <td className="px-3 py-2">
                        <StatusChip tone={tone}>{runStatusText(run, tt)}</StatusChip>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-muted-foreground">
                        {formatDuration(run.durationMs)}
                      </td>
                      <td className={cn("px-3 py-2", tone === "err" && "text-status-error-foreground")}>
                        <span className="line-clamp-1">{runResultText(run, tt)}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-[11px] text-muted-foreground">{t("routines.detail.historyHint")}</p>
      </div>
    </div>
  );
}
