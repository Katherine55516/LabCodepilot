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
import { MultiplierBadge } from "@/components/patterns";
import { formatMultiplier } from "@/lib/model-multiplier";
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
  configId: string;
  schedule: ReturnType<typeof draftToSchedule>;
}

/**
 * 可选的账号配置(= managed provider)。
 *
 * **粒度必须与聊天页的模型下拉一致** —— 那里列的是「账号配置」(Qwen3.8-Max、
 * 高阶模型-G55…),一个配置一项。早前这里列的是配置**内部**的 model 标识
 * (`qwen3.8-max[1m]`/`Sonnet 4.6`…),同一个东西两个地方两种叫法,用户没法对应。
 */
export interface ModelOption {
  /** managed 配置 id(= provider id 去掉 `managed-` 前缀,也是服务端的 configId) */
  configId: string;
  label: string;
  multimodal: boolean;
  /** 相对基准模型的成本倍率;账号未下发时为 null,不渲染。 */
  multiplier: number | null;
}

/** 「默认(跟随账号配置)」的哨兵值 —— Radix Select 不接受空字符串作 value。 */
const DEFAULT_VALUE = "__default__";
/** 存量任务只存了 model 没存 configId 时,给它保留一项,避免编辑一次就把原值冲掉。 */
const LEGACY_PREFIX = "legacy:";

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
  presetName,
}: {
  /** 给了就是编辑,不给就是新建 */
  routine?: CoworkRoutine;
  /** 账号下发的可选模型。空数组 = 只能用默认(本地 dev 常态) */
  models: ModelOption[];
  submitting?: boolean;
  onSubmit: (p: RoutinePayload) => void;
  onCancel: () => void;
  /** 「存为定时任务」带过来的预填指令(P7) */
  presetPrompt?: string;
  /** 同上,预填任务名(取自原会话标题) */
  presetName?: string;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(routine?.name || presetName || "");
  const [description, setDescription] = useState(routine?.description || "");
  const [prompt, setPrompt] = useState(routine?.prompt || presetPrompt || "");
  // 选中项统一编码成一个字符串:哨兵 / 配置 id / `legacy:<model>`。
  // '' = 跟随账号配置的第一个(D9)。服务端本来就这么兜底,所以留空是**正确的默认**,
  // 而不是"没选"。
  const [choice, setChoice] = useState(() => {
    if (routine?.config_id) return routine.config_id;
    if (routine?.model) return LEGACY_PREFIX + routine.model;  // 存量:只有 model
    return DEFAULT_VALUE;
  });
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
          <Select value={choice} onValueChange={setChoice} disabled={submitting}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={DEFAULT_VALUE} className="text-xs">
                {t("routines.form.modelDefault")}
              </SelectItem>
              {/* 存量任务的原值:它不在账号配置列表里,不补这一项的话打开编辑就被
                  静默改成「默认」,用户按下保存才发现模型换了。 */}
              {choice.startsWith(LEGACY_PREFIX) && (
                <SelectItem value={choice} className="text-xs">
                  {choice.slice(LEGACY_PREFIX.length)}
                </SelectItem>
              )}
              {models.map((m) => (
                <SelectItem key={m.configId} value={m.configId} className="text-xs">
                  {m.label}
                  {/* 倍率紧跟模型名、排在(多模态)之前 —— 与聊天页下拉同一顺序;
                      徽标本身也复用同一个组件,样式不会两处走偏。 */}
                  <MultiplierBadge label={formatMultiplier(m.multiplier)} className="ml-1" />
                  {m.multimodal && (
                    <span className="ml-1 text-muted-foreground">{t("routines.form.multimodal")}</span>
                  )}
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
              // 选了配置就只传 configId,model 留空让服务端按该配置的 opus 角色兜底
              // (D9)—— 与聊天页「选配置、模型跟着配置走」同义。只有存量的 legacy
              // 值才继续走 model。
              model: choice.startsWith(LEGACY_PREFIX) ? choice.slice(LEGACY_PREFIX.length) : "",
              configId: choice === DEFAULT_VALUE || choice.startsWith(LEGACY_PREFIX) ? "" : choice,
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
