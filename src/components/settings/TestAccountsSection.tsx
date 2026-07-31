"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import type { TestAccountSystemView, TestEnvKey } from "@/types";
import { toEnvironmentsJson, sanitizeAccountKey } from "@/lib/test-accounts-export";
import { TestSystemEditor } from "./TestSystemEditor";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Plus, Trash, FloppyDisk, DownloadSimple, CaretDown } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

// 测试账号设置面板。系统下拉 + 多系统总览 + 增删系统 + 保存/导出/导出预览。
// 单系统的可编辑主体（元信息/env 标签/地址/账号/三种登录方式）由共享组件
// TestSystemEditor 渲染 —— 与测试工作台就地配置抽屉（TestEnvDrawer）同一份，零漂移。
// 导出到 AI_LabTest/environments.json（复用 toEnvironmentsJson，预览与导出同源）。
// 设计/契约见 docs/exec-plans/active/test-account-settings.md、test-env-inline-config.md。

const ENV_KEYS: TestEnvKey[] = ["local", "sit"];

type Feedback = { kind: "ok" | "err" | "info"; text: string } | null;

/** 持久化字段快照，用于脏标记比较（不含运行时态）。 */
function snapshot(sys: TestAccountSystemView): string {
  return JSON.stringify({ name: sys.name, project_root: sys.project_root, environments: sys.environments });
}

function nowStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function TestAccountsSection() {
  const { t } = useTranslation();

  const [systems, setSystems] = useState<TestAccountSystemView[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeEnv, setActiveEnv] = useState<TestEnvKey>("local");
  const [savedSnapshots, setSavedSnapshots] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [showPreview, setShowPreview] = useState(false);
  // 当前正在抓取登录态的账号；为 null 表示无进行中的抓取。抓取在独立窗口里进行，
  // 完成/取消由主进程通过 onDone/onCancelled 推送回来（见下方订阅）。
  const [capturing, setCapturing] = useState<{ systemId: string; env: TestEnvKey; key: string } | null>(null);
  const [captureAvailable, setCaptureAvailable] = useState(false);
  // 推送回调里要读到最新的 capturing（拿 systemId 定位账号），用 ref 避免闭包过期。
  const capturingRef = useRef(capturing);
  useEffect(() => { capturingRef.current = capturing; }, [capturing]);

  useEffect(() => {
    setCaptureAvailable(typeof window !== "undefined" && !!window.electronAPI?.testAuthCapture);
  }, []);

  const flash = useCallback((kind: "ok" | "err" | "info", text: string) => {
    setFeedback({ kind, text });
    window.setTimeout(() => setFeedback((f) => (f && f.text === text ? null : f)), 4000);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/test-accounts");
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { systems: TestAccountSystemView[] };
      const list = data.systems ?? [];
      setSystems(list);
      setSavedSnapshots(Object.fromEntries(list.map((s) => [s.id, snapshot(s)])));
      setActiveId((cur) => cur && list.some((s) => s.id === cur) ? cur : (list[0]?.id ?? null));
    } catch {
      flash("err", t("testAccounts.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [flash, t]);

  useEffect(() => { void load(); }, [load]);

  const activeSystem = useMemo(
    () => systems.find((s) => s.id === activeId) ?? null,
    [systems, activeId],
  );
  const env = activeSystem ? activeSystem.environments[activeEnv] : null;
  const dirty = activeSystem ? snapshot(activeSystem) !== savedSnapshots[activeSystem.id] : false;

  // ── 不可变更新辅助 ───────────────────────────────────────────────
  // 系统级 setter（传给 TestSystemEditor 作 onSystemChange，也供 chooseFolder 写 project_root）。
  // env/account 级的不可变更新已下沉到 TestSystemEditor 内部（从此 setter 派生）。
  const mutateSystem = useCallback(
    (updater: (s: TestAccountSystemView) => TestAccountSystemView) => {
      setSystems((prev) => prev.map((s) => (s.id === activeId ? updater(s) : s)));
    },
    [activeId],
  );

  // ── 系统级操作 ───────────────────────────────────────────────────
  const addSystem = useCallback(async () => {
    try {
      const res = await fetch("/api/test-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: t("testAccounts.defaultSystemName") }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const { system } = (await res.json()) as { system: TestAccountSystemView };
      setSystems((prev) => [...prev, system]);
      setSavedSnapshots((prev) => ({ ...prev, [system.id]: snapshot(system) }));
      setActiveId(system.id);
      setActiveEnv("local");
    } catch {
      flash("err", t("testAccounts.saveFailed"));
    }
  }, [t, flash]);

  const deleteSystem = useCallback(async () => {
    if (!activeSystem) return;
    const id = activeSystem.id;
    try {
      const res = await fetch(`/api/test-accounts/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(String(res.status));
      setSystems((prev) => {
        const next = prev.filter((s) => s.id !== id);
        setActiveId(next[0]?.id ?? null);
        return next;
      });
      setSavedSnapshots((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch {
      flash("err", t("testAccounts.saveFailed"));
    }
  }, [activeSystem, flash, t]);

  const saveActive = useCallback(async (): Promise<boolean> => {
    if (!activeSystem) return false;
    setSaving(true);
    try {
      const res = await fetch(`/api/test-accounts/${activeSystem.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: activeSystem.name,
          project_root: activeSystem.project_root,
          environments: activeSystem.environments,
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const { system } = (await res.json()) as { system: TestAccountSystemView };
      setSavedSnapshots((prev) => ({ ...prev, [system.id]: snapshot(system) }));
      // R3 保存即自动同步：已设项目目录 → 自动写 {project_root}/AI_LabTest/environments.json，
      // 工作台与 AI_LabTest 框架始终读到最新地址，无需手动「导出」。同步失败不回滚保存（软提示）。
      if (system.project_root.trim()) {
        try {
          const exp = await fetch(`/api/test-accounts/${system.id}/export`, { method: "POST" });
          const data = (await exp.json().catch(() => ({}))) as { success?: boolean; error?: string };
          if (exp.ok && data.success) flash("ok", t("testAccounts.savedAndSynced"));
          else flash("info", t("testAccounts.savedSyncFailed", { error: data.error || String(exp.status) }));
        } catch (e) {
          flash("info", t("testAccounts.savedSyncFailed", { error: e instanceof Error ? e.message : "" }));
        }
      } else {
        flash("ok", t("testAccounts.saved"));
      }
      return true;
    } catch {
      flash("err", t("testAccounts.saveFailed"));
      return false;
    } finally {
      setSaving(false);
    }
  }, [activeSystem, flash, t]);

  const chooseFolder = useCallback(async () => {
    const api = typeof window !== "undefined" ? window.electronAPI?.dialog?.openFolder : undefined;
    if (!api) {
      flash("info", t("testAccounts.captureElectronOnly"));
      return;
    }
    try {
      const res = await api({ title: t("testAccounts.projectRoot") });
      if (!res.canceled && res.filePaths[0]) {
        mutateSystem((s) => ({ ...s, project_root: res.filePaths[0] }));
      }
    } catch {
      /* user cancelled / no-op */
    }
  }, [flash, t, mutateSystem]);

  const doExport = useCallback(async () => {
    if (!activeSystem) return;
    if (!activeSystem.project_root.trim()) {
      flash("err", t("testAccounts.exportNeedsRoot"));
      return;
    }
    // dirty → saveActive 已会保存并自动同步(写 environments.json)，直接复用，避免重复导出与重复提示。
    if (dirty) { await saveActive(); return; }
    setExporting(true);
    try {
      const res = await fetch(`/api/test-accounts/${activeSystem.id}/export`, { method: "POST" });
      const data = (await res.json()) as { success?: boolean; path?: string; error?: string };
      if (!res.ok || !data.success) throw new Error(data.error || String(res.status));
      flash("ok", t("testAccounts.exportSuccess", { path: data.path ?? "" }));
    } catch (e) {
      flash("err", t("testAccounts.exportFailed", { error: e instanceof Error ? e.message : "" }));
    } finally {
      setExporting(false);
    }
  }, [activeSystem, dirty, saveActive, flash, t]);

  // ── 获取登录态 ───────────────────────────────────────────────────
  const startCapture = useCallback(async (idx: number) => {
    if (!activeSystem || !env) return;
    const api = window.electronAPI?.testAuthCapture;
    if (!api) { flash("info", t("testAccounts.captureElectronOnly")); return; }
    const acct = env.accounts[idx];
    if (!activeSystem.project_root.trim() || !env.frontendBaseUrl.trim() || !acct.key.trim()) {
      flash("err", t("testAccounts.captureNeedsRoot"));
      return;
    }
    try {
      const res = await api.start({
        frontendBaseUrl: env.frontendBaseUrl,
        username: acct.username,
        password: acct.password,
        projectRoot: activeSystem.project_root,
        env: activeEnv,
        accountKey: acct.key,
        systemLabel: activeSystem.name,
      });
      if (!res.ok) throw new Error(res.error || "start failed");
      setCapturing({ systemId: activeSystem.id, env: activeEnv, key: acct.key });
      flash("info", t("testAccounts.capturing"));
    } catch (e) {
      flash("err", t("testAccounts.captureFailed", { error: e instanceof Error ? e.message : "" }));
    }
  }, [activeSystem, env, activeEnv, flash, t]);

  // 抓取在独立窗口内完成 —— 主进程推送 done/cancelled 回来，这里更新徽章 / 清理「抓取中」态。
  useEffect(() => {
    const api = window.electronAPI?.testAuthCapture;
    if (!api?.onDone || !api?.onCancelled) return;
    const offDone = api.onDone((data) => {
      const cap = capturingRef.current;
      const targetId = cap?.systemId;
      setSystems((prev) =>
        prev.map((s) => {
          if (targetId ? s.id !== targetId : false) return s;
          const e = s.environments[data.env as TestEnvKey];
          if (!e) return s;
          return {
            ...s,
            environments: {
              ...s.environments,
              [data.env]: {
                ...e,
                accounts: e.accounts.map((a) =>
                  a.key === data.accountKey ? { ...a, captured: true, capturedAt: nowStamp() } : a,
                ),
              },
            },
          };
        }),
      );
      setCapturing(null);
      flash("ok", t("testAccounts.captureSuccess"));
    });
    const offCancelled = api.onCancelled((data) => {
      setCapturing((cur) => (cur && cur.env === data.env && cur.key === data.accountKey ? null : cur));
    });
    return () => { offDone(); offCancelled(); };
  }, [flash, t]);

  const clearCapture = useCallback(async (idx: number) => {
    if (!activeSystem || !env) return;
    const acct = env.accounts[idx];
    await window.electronAPI?.testAuthCapture
      ?.clear({ projectRoot: activeSystem.project_root, env: activeEnv, accountKey: acct.key })
      .catch(() => {});
    mutateSystem((s) => ({
      ...s,
      environments: {
        ...s.environments,
        [activeEnv]: {
          ...s.environments[activeEnv],
          accounts: s.environments[activeEnv].accounts.map((a, i) =>
            i === idx ? { ...a, captured: false, capturedAt: "" } : a,
          ),
        },
      },
    }));
  }, [activeSystem, env, activeEnv, mutateSystem]);

  // 账号增删 / 默认 / 三种登录方式字段编辑均下沉到 TestSystemEditor（见 onSystemChange）。

  // ── 渲染 ─────────────────────────────────────────────────────────
  if (loading) {
    return <div className="text-sm text-muted-foreground">…</div>;
  }

  return (
    <div className="space-y-4 max-w-3xl">
      {/* Header */}
      <div>
        <h2 className="text-sm font-medium">{t("testAccounts.title")}</h2>
        <p className="text-xs text-muted-foreground">{t("testAccounts.description")}</p>
      </div>

      {/* Toolbar: system selector + add/delete */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground shrink-0">{t("testAccounts.system")}</span>
        <Select value={activeId ?? ""} onValueChange={(v) => { setActiveId(v); setActiveEnv("local"); }}>
          <SelectTrigger className="w-[220px]">
            <SelectValue placeholder={t("testAccounts.noSystems")} />
          </SelectTrigger>
          <SelectContent>
            {systems.map((s) => (
              <SelectItem key={s.id} value={s.id}>{s.name || t("testAccounts.defaultSystemName")}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={addSystem} className="gap-1.5">
          <Plus size={14} /> {t("testAccounts.addSystem")}
        </Button>
        {activeSystem && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={t("testAccounts.deleteSystem")} className="text-destructive hover:text-destructive">
                <Trash size={16} />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("testAccounts.deleteSystemTitle")}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t("testAccounts.deleteSystemDesc", { name: activeSystem.name })}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("testAccounts.clearCapture")}</AlertDialogCancel>
                <AlertDialogAction onClick={deleteSystem} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                  {t("testAccounts.deleteSystem")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
        {feedback && (
          <span className={cn(
            "ml-auto text-xs truncate max-w-[260px]",
            feedback.kind === "ok" && "text-emerald-600 dark:text-emerald-400",
            feedback.kind === "err" && "text-destructive",
            feedback.kind === "info" && "text-muted-foreground",
          )}>
            {feedback.text}
          </span>
        )}
      </div>

      {!activeSystem && (
        <div className="rounded-lg border border-border/50 p-6 text-sm text-muted-foreground text-center">
          {t("testAccounts.noSystems")}
        </div>
      )}

      {activeSystem && env && (
        <>
          {/* 单系统可编辑主体 —— 与工作台就地配置抽屉共享同一组件（零漂移）。
              导出按钮 + environments.json 路径提示放进 metaFooter，保持原布局位置。 */}
          <TestSystemEditor
            system={activeSystem}
            activeEnv={activeEnv}
            onActiveEnvChange={setActiveEnv}
            onSystemChange={mutateSystem}
            captureAvailable={captureAvailable}
            capturing={capturing && capturing.systemId === activeSystem.id ? { env: capturing.env, key: capturing.key } : null}
            onStartCapture={startCapture}
            onClearCapture={clearCapture}
            onChooseFolder={chooseFolder}
            metaFooter={
              <div className="flex items-center gap-3 pt-1">
                <Button onClick={doExport} disabled={exporting} className="gap-1.5">
                  <DownloadSimple size={15} /> {exporting ? t("testAccounts.exporting") : t("testAccounts.export")}
                </Button>
                <span className="text-[11px] text-muted-foreground font-mono truncate">
                  → {(activeSystem.project_root || "〈" + t("testAccounts.notSelected") + "〉") + "/AI_LabTest/environments.json"}
                </span>
              </div>
            }
          />

          {/* Save bar */}
          <div className="flex items-center gap-3">
            <Button onClick={saveActive} disabled={!dirty || saving} className="gap-1.5">
              <FloppyDisk size={15} /> {saving ? t("testAccounts.saving") : t("testAccounts.save")}
            </Button>
            {dirty && <span className="text-xs text-amber-600 dark:text-amber-400">● {t("testAccounts.unsaved")}</span>}
          </div>

          {/* Export preview (collapsible) */}
          <div className="rounded-lg border border-border/50 overflow-hidden">
            <button
              type="button"
              onClick={() => setShowPreview((v) => !v)}
              className="flex w-full items-center gap-2 px-4 py-2.5 text-sm font-medium hover:bg-accent/40"
            >
              <CaretDown size={14} className={cn("transition-transform", !showPreview && "-rotate-90")} />
              {t("testAccounts.exportPreview")}
              <span className="text-xs font-normal text-muted-foreground">{t("testAccounts.exportPreviewHint")}</span>
            </button>
            {showPreview && (
              <div className="border-t border-border/40 p-4 space-y-3">
                <pre className="text-[11px] font-mono leading-relaxed whitespace-pre-wrap break-all max-h-[360px] overflow-auto bg-muted/30 rounded-md p-3">
                  {JSON.stringify(toEnvironmentsJson(activeSystem), null, 2)}
                </pre>
                <div>
                  <h4 className="text-xs font-medium mb-1">{t("testAccounts.authFiles")}</h4>
                  <CaptureFilesList system={activeSystem} />
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function CaptureFilesList({ system }: { system: TestAccountSystemView }) {
  const { t } = useTranslation();
  const files: string[] = [];
  for (const ek of ENV_KEYS) {
    for (const a of system.environments[ek].accounts) {
      if (a.authMethod === "capture") {
        const base = `${system.project_root || "〈dir〉"}/AI_LabTest/.auth/${ek}.${sanitizeAccountKey(a.key)}.storageState.json`;
        files.push(a.captured ? base : `${base}  (${t("testAccounts.captureMissing")})`);
      }
    }
  }
  if (files.length === 0) {
    return <p className="text-[11px] text-muted-foreground">{t("testAccounts.noCaptureAccounts")}</p>;
  }
  return (
    <div className="space-y-0.5">
      {files.map((f, i) => (
        <div key={i} className="text-[11px] font-mono text-muted-foreground break-all">{f}</div>
      ))}
    </div>
  );
}
