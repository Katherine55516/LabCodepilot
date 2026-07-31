"use client";

import { useCallback, type ReactNode } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import type {
  TestAccountSystemView,
  TestEnvironment,
  TestLoginAccount,
  TestEnvKey,
  TestAuthMethod,
  TestTokenStorage,
} from "@/types";
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
import { Plus, X, Lock, Folder, CheckCircle, Warning } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

// 共享的「单系统」测试环境编辑主体（受控组件，无自持 fetch）。
// 设置·测试账号面板（TestAccountsSection，多系统总览）与测试工作台就地配置抽屉
// （TestEnvDrawer）都渲染这同一份 → 字段/校验零漂移，是「一份数据两个入口」的落点。
// 容器专属职责（系统下拉/增删、保存栏、导出、导出预览、feedback、抓取完成订阅）
// 留在各自父组件；本组件只做「一个系统的可编辑字段」+ 通过回调请求选目录/抓取。
// 设计见 docs/exec-plans/active/test-env-inline-config.md。

const STORAGE_TYPES: TestTokenStorage[] = ["header", "localStorage", "sessionStorage", "cookie"];
const AUTH_METHODS: TestAuthMethod[] = ["password", "token", "capture"];

export interface TestSystemEditorProps {
  /** 当前编辑的系统（受控）。 */
  system: TestAccountSystemView;
  /** 当前环境标签（受控）。 */
  activeEnv: TestEnvKey;
  onActiveEnvChange: (env: TestEnvKey) => void;
  /** 不可变更新当前系统。 */
  onSystemChange: (updater: (s: TestAccountSystemView) => TestAccountSystemView) => void;
  /** 获取登录态是否可用（仅 Electron）。 */
  captureAvailable: boolean;
  /** 正在抓取的账号（env+key）；为 null 表示无进行中的抓取。 */
  capturing: { env: TestEnvKey; key: string } | null;
  /** 请求对第 idx 个账号发起抓取（父级持有 project_root/electron API）。 */
  onStartCapture: (idx: number) => void;
  /** 请求清除第 idx 个账号的登录态。 */
  onClearCapture: (idx: number) => void;
  /**
   * 选择项目目录的回调。提供时项目目录旁显示「选择目录」按钮（设置页）；
   * 省略时项目目录只读展示（工作台抽屉 —— 目录已由项目自动绑定，不可改）。
   */
  onChooseFolder?: () => void;
  /** 渲染在系统元信息卡「名称/项目目录」之下的插槽（设置页放导出按钮+路径提示；抽屉省略）。 */
  metaFooter?: ReactNode;
}

export function TestSystemEditor({
  system,
  activeEnv,
  onActiveEnvChange,
  onSystemChange,
  captureAvailable,
  capturing,
  onStartCapture,
  onClearCapture,
  onChooseFolder,
  metaFooter,
}: TestSystemEditorProps) {
  const { t } = useTranslation();
  const env = system.environments[activeEnv];

  // ── 不可变更新辅助（从 onSystemChange 派生，作用域到当前 env / account） ──────
  const mutateEnv = useCallback(
    (updater: (e: TestEnvironment) => TestEnvironment) => {
      onSystemChange((s) => ({
        ...s,
        environments: { ...s.environments, [activeEnv]: updater(s.environments[activeEnv]) },
      }));
    },
    [onSystemChange, activeEnv],
  );

  const mutateAccount = useCallback(
    (idx: number, updater: (a: TestLoginAccount) => TestLoginAccount) => {
      mutateEnv((e) => ({ ...e, accounts: e.accounts.map((a, i) => (i === idx ? updater(a) : a)) }));
    },
    [mutateEnv],
  );

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

  return (
    <>
      {/* System meta */}
      <div className="rounded-lg border border-border/50 p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1 block">
            <span className="text-xs text-muted-foreground">{t("testAccounts.systemName")}</span>
            <Input
              value={system.name}
              placeholder={t("testAccounts.systemNamePlaceholder")}
              onChange={(e) => onSystemChange((s) => ({ ...s, name: e.target.value }))}
            />
          </label>
          <label className="space-y-1 block">
            <span className="text-xs text-muted-foreground">{t("testAccounts.projectRoot")}</span>
            <div className="flex gap-1.5">
              <Input value={system.project_root} readOnly placeholder={t("testAccounts.notSelected")} className="bg-muted/40" />
              {onChooseFolder && (
                <Button variant="outline" size="sm" onClick={onChooseFolder} className="gap-1.5 shrink-0">
                  <Folder size={14} /> {t("testAccounts.chooseFolder")}
                </Button>
              )}
            </div>
          </label>
        </div>
        {metaFooter}
      </div>

      {/* Env tabs */}
      <Tabs value={activeEnv} onValueChange={(v) => onActiveEnvChange(v as TestEnvKey)}>
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
            const isCapturing = capturing?.env === activeEnv && capturing?.key === acct.key;
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
                            onClick={() => onStartCapture(idx)}
                            disabled={!captureAvailable}
                            className="gap-1.5"
                          >
                            <Lock size={14} /> {acct.captured ? t("testAccounts.recapture") : t("testAccounts.captureBtn")}
                          </Button>
                          {acct.captured && (
                            <Button size="sm" variant="outline" onClick={() => onClearCapture(idx)}>{t("testAccounts.clearCapture")}</Button>
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
    </>
  );
}
