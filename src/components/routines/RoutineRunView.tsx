"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { MessageList } from "@/components/chat/MessageList";
import { VmArtifactsCard } from "@/components/chat/VmArtifactsCard";
import { useTranslation } from "@/hooks/useTranslation";
import type { Message, MessagesResponse, RoutineRun, VmArtifactFile } from "@/types";
import { cn } from "@/lib/utils";
import { formatCost, formatDateTime, formatDuration, runStatusText, runTone } from "@/lib/routine-ui";

const BANNER_TONE = {
  ok: "border-status-success-border bg-status-success-muted text-status-success-foreground",
  warn: "border-status-warning-border bg-status-warning-muted text-status-warning-foreground",
  err: "border-status-error-border bg-status-error-muted text-status-error-foreground",
} as const;

/**
 * 第三层:某次运行的完整过程(P6)。
 *
 * **只读回放** —— 内容来自沙箱回传的执行记录,不能在这里接着对话。渲染直接复用
 * `MessageList`(工具调用折叠、Markdown、产物卡片、下载全都现成),因为 P5 物化出来的
 * 消息与实时回合**同形状**。另写一个渲染器等于重新实现一遍这些能力还会慢慢走样。
 *
 * 面包屑右侧的「上一次 / 下一次」是定时任务特有的浏览需求:用户要横向比对连续几天的结果。
 */
export function RoutineRunView({
  run,
  routineId,
  sessionId,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
}: {
  run: RoutineRun;
  /** 任务 id —— 同时也是沙箱侧的 sid,产物按它取(工作区归任务所有,不归某一次运行)。 */
  routineId: string;
  /** 本地物化会话 id。没有就说明还没同步下来 */
  sessionId: string;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  const { t } = useTranslation();
  // 结果连同它属于哪个 sessionId 一起存,`loading` 由此**派生**而不是单独一个 state。
  // 这样 effect 里不需要同步 setState(会引发级联渲染,eslint 也拦),而且切换
  // 上一次/下一次时不会出现"新运行的界面上短暂显示上一次的消息"。
  const [result, setResult] = useState<{ sessionId: string; messages: Message[]; error: string } | null>(null);
  // 产物按**任务**取而不是按某次运行:工作区是任务独占且跨运行累积的(D2),
  // 昨天生成的文件今天还在。所以切换「上一次/下一次」时这一份不需要重拉。
  const [artifacts, setArtifacts] = useState<VmArtifactFile[]>([]);
  const tone = runTone(run.status);
  const tt = t as (k: string, p?: Record<string, string | number>) => string;

  useEffect(() => {
    if (!routineId) return;
    let cancelled = false;
    fetch(`/api/routines/${routineId}/artifacts?list=1`)
      .then((r) => (r.ok ? r.json() : { files: [] }))
      .then((d: { files?: VmArtifactFile[] }) => { if (!cancelled) setArtifacts(d.files || []); })
      .catch(() => { /* 拿不到产物不该影响回放本身 */ });
    return () => { cancelled = true; };
  }, [routineId]);

  const settled = result?.sessionId === sessionId ? result : null;
  const loading = !!sessionId && !settled;
  const messages = settled?.messages ?? [];
  const error = settled?.error ?? "";

  useEffect(() => {
    // 没有本地会话就什么都不做 —— 渲染层会直接走「还没同步」分支,它不读 messages。
    if (!sessionId) return;
    let cancelled = false;
    // 定时会话不在办公列表里,但按 id 取消息是允许的 —— 那条路由的可见性守卫只看
    // owner_uid,不看 routine_id(排除只针对列表,不针对访问)。
    fetch(`/api/chat/sessions/${sessionId}/messages?limit=500`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: MessagesResponse) => {
        if (!cancelled) setResult({ sessionId, messages: data.messages || [], error: "" });
      })
      .catch((e) => {
        if (!cancelled) {
          setResult({ sessionId, messages: [], error: e instanceof Error ? e.message : String(e) });
        }
      });
    return () => { cancelled = true; };
  }, [sessionId]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 pb-2">
        <span className="flex-1" />
        <Button variant="ghost" size="sm" className="h-6 gap-1 px-2 text-xs" disabled={!hasPrev} onClick={onPrev}>
          <ArrowLeft size={11} />
          {t("routines.run.prev")}
        </Button>
        <Button variant="ghost" size="sm" className="h-6 gap-1 px-2 text-xs" disabled={!hasNext} onClick={onNext}>
          {t("routines.run.next")}
          <ArrowRight size={11} />
        </Button>
      </div>

      <div className={cn("mb-3 rounded-md border px-3 py-2 text-xs", BANNER_TONE[tone])}>
        {[
          runStatusText(run, tt),
          formatDateTime(run.startedAt),
          run.durationMs != null ? formatDuration(run.durationMs) : "",
          run.costUsd != null ? formatCost(run.costUsd) : "",
          run.model || "",
        ].filter(Boolean).join(" · ")}
        {run.status !== "success" && run.error && (
          <div className="mt-1 font-normal opacity-90">{run.error}</div>
        )}
      </div>

      {/* 🔴 必须是 flex 容器:`MessageList` 内部的 `<Conversation>` 是 `flex-1`,
          放进非 flex 的父级里 `flex-1` 不生效 → 高度塌陷 → 整个回放滚不动
          (内容超出一屏就再也看不到后半截)。
          `relative` 给产物浮窗(absolute right-3 top-3)当定位父级。 */}
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* 产物浮窗:定时任务跑出来的文件在这里下载。工作区归**任务**所有,
            所以即使这一次运行没产出文件,之前累积的也列得出来。 */}
        {artifacts.length > 0 && (
          <VmArtifactsCard
            sessionId={routineId}
            files={artifacts}
            endpointBase={`/api/routines/${encodeURIComponent(routineId)}/artifacts`}
          />
        )}
        {/* 「还没同步」要判在 loading 前面:没有本地会话时上面的 effect 直接返回,
            loading 会停在上一次的值,判在后面就可能一直转圈。 */}
        {!sessionId ? (
          // 服务端有这次运行,但本地还没物化 —— 说的要是「还没同步」而不是「没有内容」,
          // 后者会让用户以为任务白跑了。
          <p className="py-8 text-center text-xs text-muted-foreground">{t("routines.run.notSynced")}</p>
        ) : loading ? (
          <div className="flex items-center gap-2 py-8 text-xs text-muted-foreground">
            <Spinner className="size-3.5" />
            {t("common.loading")}
          </div>
        ) : error ? (
          <p className="py-8 text-center text-xs text-status-error-foreground">
            {t("routines.run.loadFailed", { error })}
          </p>
        ) : (
          <MessageList
            messages={messages}
            streamingContent=""
            isStreaming={false}
            sessionId={sessionId}
            sandboxEnabled
          />
        )}
      </div>
    </div>
  );
}
