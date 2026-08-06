"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowClockwise, CaretRight, Clock, WarningCircle } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useTranslation } from "@/hooks/useTranslation";
import { showToast } from "@/hooks/useToast";
import type { CoworkRoutine, RoutineRun } from "@/types";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/routine-ui";
import { takeRoutineDraft, type RoutineDraft } from "@/lib/routine-draft";
import { RoutineList } from "./RoutineList";
import { RoutineDetail } from "./RoutineDetail";
import { RoutineRunView } from "./RoutineRunView";
import { RoutineForm, type RoutinePayload, type ModelOption } from "./RoutineForm";

type View =
  | { kind: "list" }
  | { kind: "create" }
  | { kind: "edit"; id: string }
  | { kind: "detail"; id: string }
  | { kind: "run"; id: string; runId: string };

interface ListResponse {
  routines: CoworkRoutine[];
  offline?: boolean;
  error?: string;
  reason?: string;
  max?: number;
  dailyCap?: number;
  usedToday?: number;
}

/**
 * 定时任务面板 —— 三层导航的容器(P6)。
 *
 * 三层**都在这一个页面区域里完成**,靠面包屑回上层,不跳到对话列表去。这是改版的核心:
 * 定时任务产生的会话不进办公对话列表(用户否掉过混排:「很乱很疑惑」),所以它必须
 * 自带一套完整的浏览路径,否则那些会话就成了查无此处的孤儿。
 *
 * 未开通(账号没下发沙箱配置)时**整个入口不该渲染**,由侧边栏判断;万一走到了这里,
 * 也给一句明确的说明而不是空白页。
 */
export function RoutinePanel() {
  const { t } = useTranslation();
  const [view, setView] = useState<View>({ kind: "list" });
  const [routines, setRoutines] = useState<CoworkRoutine[]>([]);
  const [meta, setMeta] = useState<{ max: number; dailyCap?: number; usedToday?: number }>({ max: 50 });
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [notProvisioned, setNotProvisioned] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [runs, setRuns] = useState<RoutineRun[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [sessionByRun, setSessionByRun] = useState<Record<string, string>>({});
  const [models, setModels] = useState<ModelOption[]>([]);
  // 从办公对话「存为定时任务」跳过来时的预填(P7)。读完即焚,见 routine-draft.ts。
  const [draft, setDraft] = useState<RoutineDraft | null>(null);

  const current = useMemo(
    () => routines.find((r) => "id" in view && r.id === (view as { id: string }).id),
    [routines, view],
  );

  // ── 列表 ──
  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/routines");
      const data: ListResponse = await res.json();
      if (res.status === 503 && data.reason === "not_provisioned") {
        setNotProvisioned(true);
        setRoutines([]);
        return;
      }
      setNotProvisioned(false);
      setRoutines(data.routines || []);
      setOffline(!!data.offline);
      setMeta({ max: data.max ?? 50, dailyCap: data.dailyCap, usedToday: data.usedToday });
      // 侧边栏徽标跟上(它读的是本地缓存,而这次拉取刚把缓存刷新过)
      window.dispatchEvent(new Event("routines-changed"));
    } catch {
      setOffline(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadList(); }, [loadList]);

  // 「存为定时任务」跳转:带着草稿直接落到新建表单,用户不必再点一次「新建」。
  //
  // ⚠️ 必须**等列表加载完、且确实能用**再取 —— `takeRoutineDraft` 是读完即焚的。
  // 挂载时就取的话,碰上未开通/离线(此时渲染的是空态,根本没有表单)草稿就被静默吃掉了,
  // 用户退回去再点也找不回来,只能重打一遍指令。
  const draftTaken = useRef(false);
  useEffect(() => {
    if (draftTaken.current || loading || notProvisioned) return;
    draftTaken.current = true;
    const d = takeRoutineDraft();
    if (d) {
      setDraft(d);
      setView({ kind: "create" });
    }
  }, [loading, notProvisioned]);

  // 进页面就拉一次服务端的新运行并物化(D14:不推送,回来汇总)。
  // 失败静默:同步是后台动作,连不上沙箱时列表还有本地缓存可看。
  useEffect(() => {
    let cancelled = false;
    fetch("/api/routines/sync", { method: "POST" })
      .then((r) => r.json())
      .then((r: { summary?: string | null }) => {
        if (!cancelled && r?.summary) showToast({ type: "info", message: r.summary });
      })
      .catch(() => { /* 静默 */ });
    return () => { cancelled = true; };
  }, []);

  // 模型下拉:只列账号下发的 managed 模型。**绝不兜底成 sonnet/opus** ——
  // 本账号未必有,选了就是必然失败,而失败要等到下次触发才看得见。
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/providers").then((r) => (r.ok ? r.json() : { providers: [] })).catch(() => ({ providers: [] })),
      fetch("/api/providers/models").then((r) => (r.ok ? r.json() : { groups: [] })).catch(() => ({ groups: [] })),
    ]).then(([p, m]) => {
      if (cancelled) return;
      const managedIds = new Set(
        (p?.providers ?? [])
          .filter((x: { source?: string }) => x.source === "managed")
          .map((x: { id: string }) => x.id),
      );
      const opts: ModelOption[] = [];
      for (const g of m?.groups ?? []) {
        if (!managedIds.has(g.provider_id)) continue;
        for (const model of g.models ?? []) {
          opts.push({ value: model.value, label: model.label || model.value });
        }
      }
      setModels(opts);
    });
    return () => { cancelled = true; };
  }, []);

  // ── 运行历史 + 本地物化会话 ──
  const loadRuns = useCallback(async (id: string) => {
    setLoadingRuns(true);
    try {
      const [runsRes, sessRes] = await Promise.all([
        fetch(`/api/routines/${id}/runs`).then((r) => (r.ok ? r.json() : { runs: [] })),
        fetch(`/api/routines/${id}/sessions`).then((r) => (r.ok ? r.json() : { sessions: [] })),
      ]);
      setRuns(runsRes.runs || []);
      const map: Record<string, string> = {};
      for (const s of sessRes.sessions || []) if (s.runId) map[s.runId] = s.sessionId;
      setSessionByRun(map);
    } catch {
      setRuns([]);
    } finally {
      setLoadingRuns(false);
    }
  }, []);

  const openDetail = useCallback((r: CoworkRoutine) => {
    setView({ kind: "detail", id: r.id });
    void loadRuns(r.id);
  }, [loadRuns]);

  // ── 操作 ──
  const act = useCallback(async (id: string, fn: () => Promise<Response>, okKey: string) => {
    setBusyId(id);
    try {
      const res = await fn();
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // 服务端的中文校验消息原样显示(如「触发间隔 5 分钟,低于最小间隔 15 分钟」)——
        // 自己编一句「操作失败」等于把服务端辛苦做的说明扔掉。
        showToast({ type: "error", message: data?.error || t("routines.toast.failed") });
        return false;
      }
      showToast({ type: "success", message: t(okKey as Parameters<typeof t>[0]) });
      await loadList();
      return true;
    } catch (e) {
      showToast({ type: "error", message: e instanceof Error ? e.message : String(e) });
      return false;
    } finally {
      setBusyId("");
    }
  }, [loadList, t]);

  const toggle = (r: CoworkRoutine) =>
    act(r.id, () => fetch(`/api/routines/${r.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: !r.enabled }),
    }), r.enabled ? "routines.toast.paused" : "routines.toast.resumed");

  const runNow = (r: CoworkRoutine) =>
    act(r.id, () => fetch(`/api/routines/${r.id}/run`, { method: "POST" }), "routines.toast.started");

  const remove = async (r: CoworkRoutine) => {
    if (!window.confirm(t("routines.confirmDelete", { name: r.name }))) return;
    const ok = await act(r.id, () => fetch(`/api/routines/${r.id}`, { method: "DELETE" }), "routines.toast.deleted");
    if (ok) setView({ kind: "list" });
  };

  const submit = async (payload: RoutinePayload) => {
    const editing = view.kind === "edit" ? view.id : "";
    setSubmitting(true);
    try {
      const res = await fetch(editing ? `/api/routines/${editing}` : "/api/routines", {
        method: editing ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast({ type: "error", message: data?.error || t("routines.toast.failed") });
        return;
      }
      showToast({ type: "success", message: t(editing ? "routines.toast.saved" : "routines.toast.created") });
      await loadList();
      setView(editing ? { kind: "detail", id: editing } : { kind: "list" });
      if (editing) void loadRuns(editing);
    } finally {
      setSubmitting(false);
    }
  };

  // ── 第三层的上一次/下一次 ──
  // runs 是新→旧,所以「上一次」= 下标 +1(更早),「下一次」= 下标 -1(更近)。
  const runIndex = view.kind === "run" ? runs.findIndex((r) => r.runId === view.runId) : -1;
  const gotoRun = (delta: number) => {
    if (view.kind !== "run") return;
    const next = runs[runIndex + delta];
    if (next) setView({ kind: "run", id: view.id, runId: next.runId });
  };

  // ── 渲染 ──
  if (notProvisioned) {
    return (
      <Empty
        icon={<WarningCircle size={30} className="mx-auto text-muted-foreground/60" />}
        title={t("routines.notProvisioned")}
        hint={t("routines.notProvisionedHint")}
      />
    );
  }

  const crumbs: { label: string; onClick?: () => void }[] = [
    { label: t("routines.title"), onClick: view.kind === "list" ? undefined : () => setView({ kind: "list" }) },
  ];
  if (view.kind === "create") crumbs.push({ label: t("routines.list.create") });
  if ((view.kind === "detail" || view.kind === "edit" || view.kind === "run") && current) {
    crumbs.push({
      label: current.name,
      onClick: view.kind === "detail" ? undefined : () => openDetail(current),
    });
  }
  if (view.kind === "edit") crumbs.push({ label: t("routines.edit") });
  if (view.kind === "run") {
    const run = runs.find((r) => r.runId === view.runId);
    crumbs.push({ label: t("routines.run.crumb", { time: formatDateTime(run?.startedAt) }) });
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex items-center gap-1.5 border-b border-border px-5 py-2.5 text-xs">
        <Clock size={13} className="text-muted-foreground" />
        {crumbs.map((c, i) => (
          <span key={i} className="flex items-center gap-1.5">
            {i > 0 && <CaretRight size={10} className="text-muted-foreground/60" />}
            {c.onClick ? (
              <button className="text-muted-foreground hover:text-foreground" onClick={c.onClick}>
                {c.label}
              </button>
            ) : (
              <span className="font-medium">{c.label}</span>
            )}
          </span>
        ))}
        <span className="flex-1" />
        {view.kind === "list" && (
          <Button variant="ghost" size="sm" className="h-6 gap-1 px-2 text-xs" onClick={() => void loadList()}>
            <ArrowClockwise size={11} className={cn(loading && "animate-spin")} />
            {t("routines.refresh")}
          </Button>
        )}
      </div>

      {offline && (
        <div className="border-b border-status-warning-border bg-status-warning-muted px-5 py-2 text-xs text-status-warning-foreground">
          {t("routines.offlineBanner")}
        </div>
      )}

      <div className={cn("min-h-0 flex-1 overflow-y-auto px-5 py-4", view.kind === "run" && "overflow-hidden")}>
        {loading && view.kind === "list" ? (
          <div className="flex items-center gap-2 py-10 text-xs text-muted-foreground">
            <Spinner className="size-3.5" />
            {t("common.loading")}
          </div>
        ) : view.kind === "list" ? (
          <RoutineList
            routines={routines}
            max={meta.max}
            usedToday={meta.usedToday}
            dailyCap={meta.dailyCap}
            offline={offline}
            busyId={busyId}
            onOpen={openDetail}
            onCreate={() => setView({ kind: "create" })}
            onToggle={toggle}
            onRunNow={runNow}
          />
        ) : view.kind === "create" || view.kind === "edit" ? (
          <RoutineForm
            routine={view.kind === "edit" ? current : undefined}
            models={models}
            submitting={submitting}
            presetPrompt={view.kind === "create" ? draft?.prompt : undefined}
            presetName={view.kind === "create" ? draft?.name : undefined}
            onSubmit={submit}
            onCancel={() =>
              setView(view.kind === "edit" ? { kind: "detail", id: view.id } : { kind: "list" })
            }
          />
        ) : !current ? (
          <Empty title={t("routines.gone")} hint={t("routines.goneHint")} />
        ) : view.kind === "detail" ? (
          <RoutineDetail
            routine={current}
            runs={runs}
            loadingRuns={loadingRuns}
            sessionByRun={sessionByRun}
            offline={offline}
            busy={busyId === current.id}
            onOpenRun={(run) => setView({ kind: "run", id: current.id, runId: run.runId })}
            onEdit={() => setView({ kind: "edit", id: current.id })}
            onDelete={() => void remove(current)}
            onToggle={() => void toggle(current)}
            onRunNow={() => void runNow(current)}
          />
        ) : (
          (() => {
            const run = runs.find((r) => r.runId === view.runId);
            if (!run) return <Empty title={t("routines.run.gone")} />;
            return (
              <RoutineRunView
                run={run}
                sessionId={sessionByRun[run.runId] || ""}
                hasPrev={runIndex >= 0 && runIndex + 1 < runs.length}
                hasNext={runIndex > 0}
                onPrev={() => gotoRun(1)}
                onNext={() => gotoRun(-1)}
              />
            );
          })()
        )}
      </div>
    </div>
  );
}

function Empty({ icon, title, hint }: { icon?: React.ReactNode; title: string; hint?: string }) {
  return (
    <div className="py-16 text-center">
      {icon}
      <p className="mt-3 text-xs text-muted-foreground">{title}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground/80">{hint}</p>}
    </div>
  );
}
