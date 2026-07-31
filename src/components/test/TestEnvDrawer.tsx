"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import type { TestAccountSystemView, TestEnvKey, TestEnvironment } from "@/types";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { FloppyDisk, Folder, CheckCircle } from "@/components/ui/icon";
import { TestSystemEditor } from "@/components/settings/TestSystemEditor";
import { showToast } from "@/hooks/useToast";
import { normalizeProjectPath } from "@/lib/projectDedupe";

// 测试工作台·就地环境配置抽屉。项目 = 系统按归一化路径自动绑定；打开时 resolve，
// 未命中以「未绑定」空壳进入，保存时 find-or-create（POST 建库，project_root 存归一化路径）。
// 编辑主体复用设置页同一份 TestSystemEditor → 写同一张表、同一份数据。
// 设计见 docs/exec-plans/active/test-env-inline-config.md。

interface TestEnvDrawerProps {
  /** 工作台当前项目文件夹路径（自动绑定的锚点）。 */
  projectPath: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 保存并同步成功后回调（工作台据此重拉 env-config 刷新访问地址）。 */
  onSaved?: () => void;
}

function nowStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function emptyEnv(label: string): TestEnvironment {
  return { label, frontendBaseUrl: "", apiBaseUrl: "", healthEndpoint: "/", defaultAccountKey: "", accounts: [] };
}

/** 未绑定时的空壳系统（id 为空 = 尚未入库，保存时 find-or-create 建库）。 */
function buildShell(projectPath: string): TestAccountSystemView {
  const name = normalizeProjectPath(projectPath).split(/[/\\]+/).filter(Boolean).pop() || projectPath;
  return {
    id: "",
    name,
    project_root: normalizeProjectPath(projectPath),
    sort_order: 0,
    environments: { local: emptyEnv("本地开发环境"), sit: emptyEnv("SIT 集成测试环境") },
    created_at: "",
    updated_at: "",
  };
}

/** 持久化字段快照，用于脏标记比较（与设置页同源）。 */
function snapshot(sys: TestAccountSystemView): string {
  return JSON.stringify({ name: sys.name, project_root: sys.project_root, environments: sys.environments });
}

export function TestEnvDrawer({ projectPath, open, onOpenChange, onSaved }: TestEnvDrawerProps) {
  const { t } = useTranslation();
  const [system, setSystem] = useState<TestAccountSystemView | null>(null);
  const [activeEnv, setActiveEnv] = useState<TestEnvKey>("local");
  const [savedSnapshot, setSavedSnapshot] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [captureAvailable, setCaptureAvailable] = useState(false);
  const [capturing, setCapturing] = useState<{ env: TestEnvKey; key: string } | null>(null);

  useEffect(() => {
    setCaptureAvailable(typeof window !== "undefined" && !!window.electronAPI?.testAuthCapture);
  }, []);

  // 打开时按项目路径 resolve 定位系统；未命中 → 空壳（保存时建库）。
  useEffect(() => {
    if (!open || !projectPath) return;
    let cancelled = false;
    setSystem(null); // loading
    setActiveEnv("local");
    fetch(`/api/test-accounts/resolve?projectPath=${encodeURIComponent(projectPath)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return;
        const sys = (d?.system as TestAccountSystemView | null) ?? buildShell(projectPath);
        setSystem(sys);
        setSavedSnapshot(snapshot(sys));
      })
      .catch(() => {
        if (cancelled) return;
        const sh = buildShell(projectPath);
        setSystem(sh);
        setSavedSnapshot(snapshot(sh));
      });
    return () => { cancelled = true; };
  }, [open, projectPath]);

  const dirty = system ? snapshot(system) !== savedSnapshot : false;

  const mutateSystem = useCallback(
    (updater: (s: TestAccountSystemView) => TestAccountSystemView) => {
      setSystem((prev) => (prev ? updater(prev) : prev));
    },
    [],
  );

  // ── 保存并同步（find-or-create）─────────────────────────────────
  const save = useCallback(async () => {
    if (!system) return;
    setSaving(true);
    try {
      let saved: TestAccountSystemView;
      if (!system.id) {
        // 未绑定 → 建库（project_root 存归一化路径，name 默认取文件夹名）
        const res = await fetch("/api/test-accounts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: system.name || buildShell(projectPath).name,
            project_root: normalizeProjectPath(projectPath),
            environments: system.environments,
          }),
        });
        if (!res.ok) throw new Error(String(res.status));
        saved = ((await res.json()) as { system: TestAccountSystemView }).system;
      } else {
        const res = await fetch(`/api/test-accounts/${system.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: system.name,
            project_root: system.project_root,
            environments: system.environments,
          }),
        });
        if (!res.ok) throw new Error(String(res.status));
        saved = ((await res.json()) as { system: TestAccountSystemView }).system;
      }
      setSystem(saved);
      setSavedSnapshot(snapshot(saved));
      // 保存即同步：写 {project_root}/AI_LabTest/environments.json（同设置页逻辑）。
      const exp = await fetch(`/api/test-accounts/${saved.id}/export`, { method: "POST" });
      const data = (await exp.json().catch(() => ({}))) as { success?: boolean; error?: string };
      if (exp.ok && data.success) showToast({ type: "success", message: t("testEnvDrawer.savedAndSynced") });
      else showToast({ type: "warning", message: t("testAccounts.savedSyncFailed", { error: data.error || String(exp.status) }) });
      onSaved?.();
      onOpenChange(false);
    } catch {
      showToast({ type: "error", message: t("testAccounts.saveFailed") });
    } finally {
      setSaving(false);
    }
  }, [system, projectPath, t, onSaved, onOpenChange]);

  // ── 获取登录态（单系统）─────────────────────────────────────────
  const startCapture = useCallback(async (idx: number) => {
    if (!system) return;
    const api = window.electronAPI?.testAuthCapture;
    if (!api) { showToast({ type: "info", message: t("testAccounts.captureElectronOnly") }); return; }
    const env = system.environments[activeEnv];
    const acct = env.accounts[idx];
    const root = system.project_root || normalizeProjectPath(projectPath);
    if (!root.trim() || !env.frontendBaseUrl.trim() || !acct.key.trim()) {
      showToast({ type: "error", message: t("testAccounts.captureNeedsRoot") });
      return;
    }
    try {
      const res = await api.start({
        frontendBaseUrl: env.frontendBaseUrl,
        username: acct.username,
        password: acct.password,
        projectRoot: root,
        env: activeEnv,
        accountKey: acct.key,
        systemLabel: system.name,
      });
      if (!res.ok) throw new Error(res.error || "start failed");
      setCapturing({ env: activeEnv, key: acct.key });
      showToast({ type: "info", message: t("testAccounts.capturing") });
    } catch (e) {
      showToast({ type: "error", message: t("testAccounts.captureFailed", { error: e instanceof Error ? e.message : "" }) });
    }
  }, [system, activeEnv, projectPath, t]);

  // 抓取在独立窗口内完成 —— 主进程推送 done/cancelled，更新徽章 / 清「抓取中」态。
  useEffect(() => {
    const api = window.electronAPI?.testAuthCapture;
    if (!api?.onDone || !api?.onCancelled) return;
    const offDone = api.onDone((data) => {
      setSystem((prev) => {
        if (!prev) return prev;
        const e = prev.environments[data.env as TestEnvKey];
        if (!e) return prev;
        return {
          ...prev,
          environments: {
            ...prev.environments,
            [data.env]: {
              ...e,
              accounts: e.accounts.map((a) =>
                a.key === data.accountKey ? { ...a, captured: true, capturedAt: nowStamp() } : a,
              ),
            },
          },
        };
      });
      setCapturing(null);
      showToast({ type: "success", message: t("testAccounts.captureSuccess") });
    });
    const offCancelled = api.onCancelled((data) => {
      setCapturing((cur) => (cur && cur.env === data.env && cur.key === data.accountKey ? null : cur));
    });
    return () => { offDone(); offCancelled(); };
  }, [t]);

  const clearCapture = useCallback(async (idx: number) => {
    if (!system) return;
    const env = system.environments[activeEnv];
    const acct = env.accounts[idx];
    const root = system.project_root || normalizeProjectPath(projectPath);
    await window.electronAPI?.testAuthCapture
      ?.clear({ projectRoot: root, env: activeEnv, accountKey: acct.key })
      .catch(() => {});
    setSystem((prev) =>
      prev
        ? {
            ...prev,
            environments: {
              ...prev.environments,
              [activeEnv]: {
                ...prev.environments[activeEnv],
                accounts: prev.environments[activeEnv].accounts.map((a, i) =>
                  i === idx ? { ...a, captured: false, capturedAt: "" } : a,
                ),
              },
            },
          }
        : prev,
    );
  }, [system, activeEnv, projectPath]);

  const bound = useMemo(() => normalizeProjectPath(projectPath), [projectPath]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-lg">
        <SheetHeader className="border-b border-border/50">
          <SheetTitle>{t("testEnvDrawer.title")}</SheetTitle>
          <SheetDescription>{t("testEnvDrawer.description")}</SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {/* 自动绑定的项目目录（只读；工作台项目 == 系统 project_root） */}
          <div className="flex items-center gap-2 rounded-lg border border-border/50 bg-muted/40 px-3 py-2">
            <Folder size={15} className="shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground" title={bound}>{bound}</span>
            <span className="inline-flex shrink-0 items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
              <CheckCircle size={12} /> {t("testEnvDrawer.autoBound")}
            </span>
          </div>

          {system ? (
            <TestSystemEditor
              system={system}
              activeEnv={activeEnv}
              onActiveEnvChange={setActiveEnv}
              onSystemChange={mutateSystem}
              captureAvailable={captureAvailable}
              capturing={capturing}
              onStartCapture={startCapture}
              onClearCapture={clearCapture}
            />
          ) : (
            <div className="text-sm text-muted-foreground">…</div>
          )}
        </div>

        <SheetFooter className="flex-row items-center gap-3 border-t border-border/50">
          <Button onClick={save} disabled={saving || !system} className="gap-1.5">
            <FloppyDisk size={15} /> {saving ? t("testEnvDrawer.saving") : t("testEnvDrawer.saveAndSync")}
          </Button>
          {dirty && <span className="text-xs text-amber-600 dark:text-amber-400">● {t("testAccounts.unsaved")}</span>}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
