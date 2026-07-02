"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import type {
  TestAccountSystemView,
  TestEnvironment,
  TestLoginAccount,
  TestEnvKey,
  TestAuthMethod,
  TestTokenStorage,
} from "@/types";
import { toEnvironmentsJson, sanitizeAccountKey } from "@/lib/test-accounts-export";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import {
  Plus,
  Trash,
  X,
  FloppyDisk,
  DownloadSimple,
  Lock,
  Folder,
  CheckCircle,
  Warning,
  CaretDown,
} from "@/components/ui/icon";
import { cn } from "@/lib/utils";

// 测试账号设置面板。系统下拉 + local/SIT 环境标签 + 三种登录方式（密码/token/获取登录态）。
// 导出到 AI_LabTest/environments.json（复用 toEnvironmentsJson，预览与导出同源）。
// 设计/契约见 docs/exec-plans/active/test-account-settings.md。

const ENV_KEYS: TestEnvKey[] = ["local", "sit"];
const STORAGE_TYPES: TestTokenStorage[] = ["header", "localStorage", "sessionStorage", "cookie"];
const AUTH_METHODS: TestAuthMethod[] = ["password", "token", "capture"];

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
  const mutateSystem = useCallback(
    (updater: (s: TestAccountSystemView) => TestAccountSystemView) => {
      setSystems((prev) => prev.map((s) => (s.id === activeId ? updater(s) : s)));
    },
    [activeId],
  );

  const mutateEnv = useCallback(
    (updater: (e: TestEnvironment) => TestEnvironment) => {
      mutateSystem((s) => ({
        ...s,
        environments: { ...s.environments, [activeEnv]: updater(s.environments[activeEnv]) },
      }));
    },
    [mutateSystem, activeEnv],
  );

  const mutateAccount = useCallback(
    (idx: number, updater: (a: TestLoginAccount) => TestLoginAccount) => {
      mutateEnv((e) => ({ ...e, accounts: e.accounts.map((a, i) => (i === idx ? updater(a) : a)) }));
    },
    [mutateEnv],
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
    mutateAccount(idx, (a) => ({ ...a, captured: false, capturedAt: "" }));
  }, [activeSystem, env, activeEnv, mutateAccount]);

  // ── 账号增删 / 默认 ──────────────────────────────────────────────
  const addAccount = useCallback(() => {
    mutateEnv((e) => {
      const nextKey = `role${e.accounts.length + 1}`;
      return { ...e, accounts: [...e.accounts, { key: nextKey, role: "", authMethod: "password" }] };
    });
  }, [mutateEnv]);

  const deleteAccount = useCallback((idx: number) => {
    mutateEnv((e) => {
      const removed = e.accounts[idx];
      const accounts = e.accounts.filter((_, i) => i !== idx);
      const defaultAccountKey = e.defaultAccountKey === removed?.key ? "" : e.defaultAccountKey;
      return { ...e, accounts, defaultAccountKey };
    });
  }, [mutateEnv]);

  const setAccountKey = useCallback((idx: number, value: string) => {
    mutateEnv((e) => {
      const old = e.accounts[idx]?.key;
      const accounts = e.accounts.map((a, i) => (i === idx ? { ...a, key: value } : a));
      // key 改名时同步默认账号引用，避免悬挂。
      const defaultAccountKey = e.defaultAccountKey === old ? value : e.defaultAccountKey;
      return { ...e, accounts, defaultAccountKey };
    });
  }, [mutateEnv]);

  const authLabel = (m: TestAuthMethod): string =>
    m === "password" ? t("testAccounts.authPassword") : m === "token" ? t("testAccounts.authToken") : t("testAccounts.authCapture");

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
          {/* System meta */}
          <div className="rounded-lg border border-border/50 p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1 block">
                <span className="text-xs text-muted-foreground">{t("testAccounts.systemName")}</span>
                <Input
                  value={activeSystem.name}
                  placeholder={t("testAccounts.systemNamePlaceholder")}
                  onChange={(e) => mutateSystem((s) => ({ ...s, name: e.target.value }))}
                />
              </label>
              <label className="space-y-1 block">
                <span className="text-xs text-muted-foreground">{t("testAccounts.projectRoot")}</span>
                <div className="flex gap-1.5">
                  <Input value={activeSystem.project_root} readOnly placeholder={t("testAccounts.notSelected")} className="bg-muted/40" />
                  <Button variant="outline" size="sm" onClick={chooseFolder} className="gap-1.5 shrink-0">
                    <Folder size={14} /> {t("testAccounts.chooseFolder")}
                  </Button>
                </div>
              </label>
            </div>
            <div className="flex items-center gap-3 pt-1">
              <Button onClick={doExport} disabled={exporting} className="gap-1.5">
                <DownloadSimple size={15} /> {exporting ? t("testAccounts.exporting") : t("testAccounts.export")}
              </Button>
              <span className="text-[11px] text-muted-foreground font-mono truncate">
                → {(activeSystem.project_root || "〈" + t("testAccounts.notSelected") + "〉") + "/AI_LabTest/environments.json"}
              </span>
            </div>
          </div>

          {/* Env tabs */}
          <Tabs value={activeEnv} onValueChange={(v) => setActiveEnv(v as TestEnvKey)}>
            <TabsList>
              <TabsTrigger value="local">{t("testAccounts.tabLocal")}</TabsTrigger>
              <TabsTrigger value="sit">{t("testAccounts.tabSit")}</TabsTrigger>
            </TabsList>
          </Tabs>

          {/* Env panel */}
          <div className="rounded-lg border border-border/50 p-4 space-y-4">
            {/* Access URLs */}
            <div className="space-y-3">
              <h3 className="text-sm font-medium">{t("testAccounts.accessSection")}</h3>
              <label className="space-y-1 block">
                <span className="text-xs text-muted-foreground">{t("testAccounts.frontendUrl")}</span>
                <Input
                  value={env.frontendBaseUrl}
                  placeholder={t("testAccounts.frontendUrlPlaceholder")}
                  onChange={(e) => mutateEnv((en) => ({ ...en, frontendBaseUrl: e.target.value }))}
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1 block">
                  <span className="text-xs text-muted-foreground">{t("testAccounts.apiUrl")}</span>
                  <Input
                    value={env.apiBaseUrl}
                    placeholder={t("testAccounts.apiUrlPlaceholder")}
                    onChange={(e) => mutateEnv((en) => ({ ...en, apiBaseUrl: e.target.value }))}
                  />
                </label>
                <label className="space-y-1 block">
                  <span className="text-xs text-muted-foreground">{t("testAccounts.healthEndpoint")}</span>
                  <Input
                    value={env.healthEndpoint}
                    placeholder={t("testAccounts.healthEndpointPlaceholder")}
                    onChange={(e) => mutateEnv((en) => ({ ...en, healthEndpoint: e.target.value }))}
                  />
                </label>
              </div>
            </div>

            {/* Accounts */}
            <div className="border-t border-border/30 pt-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">{t("testAccounts.accountsSection")}</h3>
                <Button variant="outline" size="sm" onClick={addAccount} className="gap-1.5">
                  <Plus size={14} /> {t("testAccounts.addAccount")}
                </Button>
              </div>

              {env.accounts.length === 0 && (
                <p className="text-xs text-muted-foreground">{t("testAccounts.noAccounts")}</p>
              )}

              {env.accounts.map((acct, idx) => {
                const isCapturing = capturing?.systemId === activeSystem?.id && capturing?.env === activeEnv && capturing?.key === acct.key;
                const isDefault = env.defaultAccountKey === acct.key && acct.key !== "";
                return (
                  <div key={idx} className="rounded-md border border-border/50 bg-muted/30 p-3 space-y-3">
                    {/* head */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <label className="flex items-center gap-1 text-xs text-muted-foreground whitespace-nowrap cursor-pointer">
                        <input
                          type="radio"
                          name={`default-${activeEnv}`}
                          checked={isDefault}
                          onChange={() => mutateEnv((en) => ({ ...en, defaultAccountKey: acct.key }))}
                          className="accent-primary"
                        />
                        {t("testAccounts.default")}
                      </label>
                      <Input
                        value={acct.key}
                        placeholder={t("testAccounts.accountKey")}
                        onChange={(e) => setAccountKey(idx, e.target.value)}
                        className="h-8 w-[130px]"
                      />
                      <Input
                        value={acct.role}
                        placeholder={t("testAccounts.role")}
                        onChange={(e) => mutateAccount(idx, (a) => ({ ...a, role: e.target.value }))}
                        className="h-8 w-[130px]"
                      />
                      {/* auth method pills */}
                      <div className="flex items-center rounded-md border border-border/50 overflow-hidden" role="radiogroup">
                        {AUTH_METHODS.map((m) => {
                          const selected = acct.authMethod === m;
                          return (
                            <button
                              key={m}
                              type="button"
                              role="radio"
                              aria-checked={selected}
                              onClick={() => mutateAccount(idx, (a) => ({ ...a, authMethod: m }))}
                              className={cn(
                                "px-2.5 py-1 text-xs transition-colors border-r border-border/50 last:border-r-0",
                                selected
                                  ? "bg-emerald-600 text-white font-medium"
                                  : "text-muted-foreground hover:bg-accent",
                              )}
                            >
                              {authLabel(m)}
                            </button>
                          );
                        })}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t("testAccounts.deleteAccount")}
                        onClick={() => deleteAccount(idx)}
                        className="ml-auto h-7 w-7 text-destructive hover:text-destructive"
                      >
                        <X size={14} />
                      </Button>
                    </div>

                    {/* method fields */}
                    {acct.authMethod === "password" && (
                      <div className="grid grid-cols-2 gap-2">
                        <label className="space-y-1 block">
                          <span className="text-xs text-muted-foreground">{t("testAccounts.username")}</span>
                          <Input value={acct.username ?? ""} className="h-8" onChange={(e) => mutateAccount(idx, (a) => ({ ...a, username: e.target.value }))} />
                        </label>
                        <label className="space-y-1 block">
                          <span className="text-xs text-muted-foreground">{t("testAccounts.password")}</span>
                          <Input value={acct.password ?? ""} className="h-8" onChange={(e) => mutateAccount(idx, (a) => ({ ...a, password: e.target.value }))} />
                        </label>
                      </div>
                    )}

                    {acct.authMethod === "token" && (
                      <div className="space-y-2">
                        <label className="space-y-1 block">
                          <span className="text-xs text-muted-foreground">{t("testAccounts.token")}</span>
                          <Textarea
                            value={acct.token ?? ""}
                            rows={2}
                            placeholder={t("testAccounts.tokenPlaceholder")}
                            onChange={(e) => mutateAccount(idx, (a) => ({ ...a, token: e.target.value }))}
                          />
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                          <label className="space-y-1 block">
                            <span className="text-xs text-muted-foreground">{t("testAccounts.storageType")}</span>
                            <Select
                              value={acct.storageType ?? "header"}
                              onValueChange={(v) => mutateAccount(idx, (a) => ({ ...a, storageType: v as TestTokenStorage }))}
                            >
                              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {STORAGE_TYPES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </label>
                          <label className="space-y-1 block">
                            <span className="text-xs text-muted-foreground">{t("testAccounts.storageKey")}</span>
                            <Input value={acct.storageKey ?? ""} className="h-8" placeholder="Authorization" onChange={(e) => mutateAccount(idx, (a) => ({ ...a, storageKey: e.target.value }))} />
                          </label>
                        </div>
                      </div>
                    )}

                    {acct.authMethod === "capture" && (
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          {acct.captured ? (
                            <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                              <CheckCircle size={14} /> {t("testAccounts.captured", { time: acct.capturedAt ?? "" })}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                              <Warning size={14} /> {t("testAccounts.capturePending")}
                            </span>
                          )}
                          {isCapturing ? (
                            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                              <Lock size={14} /> {t("testAccounts.captureInWindow")}
                            </span>
                          ) : (
                            <>
                              <Button
                                size="sm"
                                onClick={() => startCapture(idx)}
                                disabled={!captureAvailable}
                                className="gap-1.5"
                              >
                                <Lock size={14} /> {acct.captured ? t("testAccounts.recapture") : t("testAccounts.captureBtn")}
                              </Button>
                              {acct.captured && (
                                <Button size="sm" variant="outline" onClick={() => clearCapture(idx)}>{t("testAccounts.clearCapture")}</Button>
                              )}
                            </>
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                          {captureAvailable ? t("testAccounts.captureHint") : t("testAccounts.captureElectronOnly")}
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

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
