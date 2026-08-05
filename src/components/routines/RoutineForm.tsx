"use client";

import { useState } from "react";
import { Warning } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useTranslation } from "@/hooks/useTranslation";
import type { CoworkRoutine } from "@/types";
import {
  draftToSchedule, emptyScheduleDraft, routineToDraft, type ScheduleDraft,
} from "@/lib/routine-ui";
import { SchedulePicker } from "./SchedulePicker";

/** 服务端接受的创建/更新载荷。 */
export interface RoutinePayload {
  name: string;
  description: string;
  prompt: string;
  model: string;
  schedule: ReturnType<typeof draftToSchedule>;
}

export interface ModelOption {
  value: string;
  label: string;
}

/**
 * 新建 / 编辑定时任务(P6)。
 *
 * 最重要的一栏是**指令**:每次运行都是全新对话、无人值守、没有追问的机会。
 * 所以输入框下方常驻提醒 —— 这不是装饰,是这个功能最常见的失败来源
 * (指令写得像对话里的一句追问,单独跑起来根本看不懂)。
 */
export function RoutineForm({
  routine,
  models,
  submitting,
  onSubmit,
  onCancel,
  presetPrompt,
}: {
  /** 给了就是编辑,不给就是新建 */
  routine?: CoworkRoutine;
  /** 账号下发的可选模型。空数组 = 只能用默认(本地 dev 常态) */
  models: ModelOption[];
  submitting?: boolean;
  onSubmit: (p: RoutinePayload) => void;
  onCancel: () => void;
  /** 「存为定时任务」带过来的预填指令(P7 用) */
  presetPrompt?: string;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(routine?.name || "");
  const [description, setDescription] = useState(routine?.description || "");
  const [prompt, setPrompt] = useState(routine?.prompt || presetPrompt || "");
  // '' = 跟随账号配置的第一个(D9)。服务端本来就这么兜底,所以这里留空是**正确的默认**,
  // 而不是"没选"——列一堆本账号未必有的模型才是错的。
  const [model, setModel] = useState(routine?.model || "");
  const [draft, setDraft] = useState<ScheduleDraft>(
    routine ? routineToDraft(routine) : emptyScheduleDraft(),
  );

  const nameOk = name.trim().length > 0;
  const promptOk = prompt.trim().length > 0;
  const onceOk = draft.preset !== "once" || !!draft.fireAtLocal;
  const canSubmit = nameOk && promptOk && onceOk && !submitting;

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs">{t("routines.form.name")}</Label>
          <Input
            className="h-8 text-xs"
            value={name}
            disabled={submitting}
            placeholder={t("routines.form.namePlaceholder")}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">{t("routines.form.model")}</Label>
          <Select value={model || "__default__"} onValueChange={(v) => setModel(v === "__default__" ? "" : v)} disabled={submitting}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__default__" className="text-xs">
                {t("routines.form.modelDefault")}
              </SelectItem>
              {models.map((m) => (
                <SelectItem key={m.value} value={m.value} className="text-xs">
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">
          {t("routines.form.description")}
          <span className="ml-1 font-normal text-muted-foreground">{t("routines.form.descriptionHint")}</span>
        </Label>
        <Input
          className="h-8 text-xs"
          value={description}
          disabled={submitting}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">{t("routines.form.prompt")}</Label>
        <Textarea
          className="min-h-40 font-mono text-xs leading-relaxed"
          value={prompt}
          disabled={submitting}
          placeholder={t("routines.form.promptPlaceholder")}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Warning size={13} className="mt-0.5 shrink-0 text-status-warning-foreground" />
          <span>{t("routines.form.promptWarning")}</span>
        </p>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">{t("routines.form.schedule")}</Label>
        <SchedulePicker value={draft} onChange={setDraft} disabled={submitting} />
      </div>

      {/* 工作区语义要说在前面:多次运行之间文件累积,这与"每次都是全新对话"并存,
          很容易被理解反 —— 上下文不累积,但**文件累积**。 */}
      <div className="rounded-md border border-border bg-muted/40 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
        <b className="text-foreground">{t("routines.form.workspaceTitle")}</b>
        {t("routines.form.workspaceBody")}
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={onCancel} disabled={submitting}>
          {t("common.cancel")}
        </Button>
        <Button
          size="sm"
          className="h-8 gap-1.5 text-xs"
          disabled={!canSubmit}
          onClick={() =>
            onSubmit({
              name: name.trim(),
              description: description.trim(),
              prompt: prompt.trim(),
              model,
              schedule: draftToSchedule(draft),
            })
          }
        >
          {submitting && <Spinner className="size-3" />}
          {routine ? t("common.save") : t("routines.form.create")}
        </Button>
      </div>
    </div>
  );
}
