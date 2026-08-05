"use client";

import { useState } from "react";
import { CaretRight } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTranslation } from "@/hooks/useTranslation";
import { cn } from "@/lib/utils";
import type { TranslationKey } from "@/i18n";
import {
  SCHEDULE_PRESETS,
  PRESET_LABEL_KEY,
  WEEKDAY_KEY,
  draftToSchedule,
  type ScheduleDraft,
  type SchedulePreset,
} from "@/lib/routine-ui";

/**
 * 调度选择器(P6)。
 *
 * **六个预设是刻意的**:覆盖绝大多数场景,cron 收进「高级」折叠。原因见 D6 ——
 * 把 cron 摆在主路径上,等于要求用户先学会 cron 才能用定时任务。
 *
 * 预设里**不提供 <15 分钟的选项**:服务端最小间隔是 15 分钟,给了用户选、
 * 提交时再报错,是自己制造挫败。
 */
export function SchedulePicker({
  value,
  onChange,
  disabled,
}: {
  value: ScheduleDraft;
  onChange: (d: ScheduleDraft) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [advancedOpen, setAdvancedOpen] = useState(value.preset === "cron");

  const set = (patch: Partial<ScheduleDraft>) => onChange({ ...value, ...patch });
  const needsTime = value.preset === "daily" || value.preset === "weekday" || value.preset === "weekly";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {SCHEDULE_PRESETS.map((p: SchedulePreset) => (
          <Button
            key={p}
            type="button"
            size="sm"
            variant={value.preset === p ? "default" : "outline"}
            disabled={disabled}
            className="h-7 text-xs"
            onClick={() => set({ preset: p })}
          >
            {t(PRESET_LABEL_KEY[p] as TranslationKey)}
          </Button>
        ))}
      </div>

      {value.preset === "hourly" && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">{t("routines.form.atMinute")}</span>
          <Input
            type="number"
            min={0}
            max={59}
            disabled={disabled}
            className="h-7 w-20 text-xs"
            value={value.minute}
            onChange={(e) => set({ minute: Math.min(59, Math.max(0, parseInt(e.target.value, 10) || 0)) })}
          />
        </div>
      )}

      {value.preset === "weekly" && (
        <div className="flex flex-wrap gap-1.5">
          {[1, 2, 3, 4, 5, 6, 0].map((d) => (
            <Button
              key={d}
              type="button"
              size="sm"
              variant={value.weekday === d ? "default" : "outline"}
              disabled={disabled}
              className="h-7 w-11 px-0 text-xs"
              onClick={() => set({ weekday: d })}
            >
              {t(WEEKDAY_KEY[d] as TranslationKey)}
            </Button>
          ))}
        </div>
      )}

      {needsTime && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">{t("routines.form.time")}</span>
          <Input
            type="time"
            disabled={disabled}
            className="h-7 w-28 text-xs"
            value={value.time}
            onChange={(e) => set({ time: e.target.value })}
          />
          <span className="text-muted-foreground">
            {t("routines.form.timezone", { tz: value.tz })}
          </span>
        </div>
      )}

      {value.preset === "once" && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">{t("routines.form.fireAt")}</span>
          <Input
            type="datetime-local"
            disabled={disabled}
            className="h-7 w-52 text-xs"
            value={value.fireAtLocal}
            onChange={(e) => set({ fireAtLocal: e.target.value })}
          />
        </div>
      )}

      {value.preset === "manual" && (
        <p className="text-xs text-muted-foreground">{t("routines.form.manualHint")}</p>
      )}

      {/* 高级:cron。折叠起来,但**编辑一个本来就是 cron 的任务时默认展开** ——
          否则用户看到的是一个认不出自己调度的表单。 */}
      {value.preset !== "manual" && value.preset !== "once" && (
        <div>
          <button
            type="button"
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setAdvancedOpen((v) => !v)}
          >
            <CaretRight size={11} className={cn("transition-transform", advancedOpen && "rotate-90")} />
            {t("routines.form.advancedCron")}
          </button>
          {advancedOpen && (
            <div className="mt-2 space-y-1.5">
              {/* 显示**当前预设真正会生成的**表达式,而不是草稿里那个陈旧的 expr ——
                  选了「每周·周一」却看到 `0 9 * * *`,用户没法判断到底哪个算数。
                  一旦手改,就切到 cron 预设,以手改的为准。 */}
              <Input
                disabled={disabled}
                className="h-7 max-w-xs font-mono text-xs"
                placeholder="0 9 * * 1-5"
                value={value.preset === "cron" ? value.expr : (draftToSchedule(value).expr || "")}
                onChange={(e) => set({ preset: "cron", expr: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">{t("routines.form.cronHint")}</p>
            </div>
          )}
        </div>
      )}

      {value.preset !== "manual" && (
        <p className="text-xs text-muted-foreground">{t("routines.form.intervalHint")}</p>
      )}
    </div>
  );
}
