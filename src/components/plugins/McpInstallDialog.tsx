"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Warning, SpinnerGap, CheckCircle, X, DownloadSimple } from "@/components/ui/icon";
import { useTranslation } from "@/hooks/useTranslation";
import { stripAnsi } from "@/lib/strip-ansi";
import type { MarketplaceMcpServer, MCPServerConfig, McpRuntimeRequirement } from "@/types";

/** 详情接口返回的映射结果（与 server-json-mapper 的 RequiredInput 对齐）。 */
export interface MappedDetail {
  suggestedKey: string;
  kind: "stdio" | "remote" | "none";
  config: MCPServerConfig | null;
  requiredInputs: Array<{
    name: string;
    target: "env" | "header" | "urlVar";
    description?: string;
    isSecret: boolean;
    isRequired: boolean;
    default?: string;
    choices?: string[];
    placeholder?: string;
  }>;
  notes: string[];
}

interface McpInstallDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  server: MarketplaceMcpServer;
  mapped: MappedDetail;
  runtime?: McpRuntimeRequirement | null;
  onComplete: () => void;
}

type Phase = "form" | "installing" | "success" | "error";

/** 把映射配置渲染成「将运行」的人类可读预览（安全确认屏障的核心）。 */
function commandPreview(config: MCPServerConfig | null): string {
  if (!config) return "";
  if (config.command) return `${config.command} ${(config.args || []).join(" ")}`.trim();
  if (config.url) return `${config.type || "http"}  ${config.url}`;
  return "";
}

export function McpInstallDialog({
  open,
  onOpenChange,
  server,
  mapped,
  runtime,
  onComplete,
}: McpInstallDialogProps) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>("form");
  const [values, setValues] = useState<Record<string, string>>({});
  const [acked, setAcked] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const trust = server.trust;
  const blocked = !!trust?.blocked;
  const risks = trust?.risks ?? [];
  const needsAck = trust?.friction === "extra-confirm";

  // Reset when (re)opened
  useEffect(() => {
    if (open) {
      setPhase("form");
      setLogs([]);
      setAcked(false);
      const initial: Record<string, string> = {};
      for (const i of mapped.requiredInputs) if (i.default) initial[i.name] = i.default;
      setValues(initial);
    }
  }, [open, mapped]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const missingRequired = mapped.requiredInputs.some(
    (i) => i.isRequired && !(values[i.name] && values[i.name].trim()),
  );

  const startInstall = useCallback(async () => {
    setPhase("installing");
    setLogs([]);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch("/api/plugins/mcp/marketplace/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serverName: server.name, inputs: values }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        setPhase("error");
        setLogs((p) => [...p, `HTTP ${res.status}`]);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        let event = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) event = line.slice(7).trim();
          else if (line.startsWith("data: ")) {
            let data: string;
            try {
              data = JSON.parse(line.slice(6));
            } catch {
              data = line.slice(6);
            }
            if (event === "output") setLogs((p) => [...p, data]);
            else if (event === "done") setPhase("success");
            else if (event === "error") {
              setPhase("error");
              setLogs((p) => [...p, `Error: ${data}`]);
            }
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setPhase("error");
        setLogs((p) => [...p, (err as Error).message]);
      }
    }
  }, [server.name, values]);

  const handleClose = () => {
    abortRef.current?.abort();
    if (phase === "success") onComplete();
    onOpenChange(false);
  };

  const preview = commandPreview(mapped.config);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto" showCloseButton={false} aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {phase === "installing" && <SpinnerGap size={18} className="animate-spin text-primary" />}
            {phase === "success" && <CheckCircle size={18} className="text-status-success-foreground" />}
            {phase === "error" && <X size={18} className="text-status-error-foreground" />}
            {phase === "form"
              ? t("mcp.installServer")
              : phase === "installing"
                ? t("mcp.installing")
                : phase === "success"
                  ? t("mcp.installSuccess")
                  : t("mcp.installFailed")}
          </DialogTitle>
        </DialogHeader>

        {phase === "form" ? (
          <div className="space-y-4 py-1">
            {/* 安全确认屏障 */}
            <div className="rounded-md border border-status-warning-border bg-status-warning/10 p-3 space-y-2">
              <div className="flex items-start gap-2">
                <Warning size={16} className="text-status-warning-foreground shrink-0 mt-0.5" />
                <p className="text-xs text-muted-foreground">{t("mcp.consentWarning")}</p>
              </div>
              {preview && (
                <div>
                  <p className="text-[11px] font-medium text-muted-foreground mb-1">{t("mcp.consentCommand")}</p>
                  <pre className="text-xs font-mono bg-muted/60 rounded p-2 whitespace-pre-wrap break-all">{preview}</pre>
                </div>
              )}
              {mapped.config?.env && Object.keys(mapped.config.env).length > 0 && (
                <div>
                  <p className="text-[11px] font-medium text-muted-foreground mb-1">{t("mcp.consentEnv")}</p>
                  <pre className="text-xs font-mono bg-muted/60 rounded p-2 whitespace-pre-wrap break-all">
                    {Object.keys(mapped.config.env).join("\n")}
                  </pre>
                </div>
              )}
            </div>

            {/* 运行时预检：缺失给软警告 + 安装链接 */}
            {runtime && !runtime.available && (
              <div className="rounded-md border border-status-warning-border bg-status-warning/10 p-3">
                <div className="flex items-start gap-2">
                  <Warning size={14} className="text-status-warning-foreground shrink-0 mt-0.5" />
                  <div className="text-xs">
                    <p className="font-medium">{t("mcp.runtimeMissing")}：{runtime.name}</p>
                    <p className="text-muted-foreground mt-0.5">
                      {t("mcp.runtimeMissingHint")}
                      {runtime.url && (
                        <>
                          {" "}
                          <a href={runtime.url} target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">
                            {runtime.url}
                          </a>
                        </>
                      )}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* 黑名单硬拦 */}
            {blocked && (
              <div className="rounded-md border border-status-error-border bg-status-error/10 p-3">
                <p className="text-xs font-medium text-status-error-foreground">{t("mcp.blockedHint")}</p>
                {trust?.blockReason && <p className="text-[11px] text-muted-foreground mt-1">{trust.blockReason}</p>}
              </div>
            )}

            {/* 风险标记（启发式提示，非判定） */}
            {risks.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium">{t("mcp.consentRisks")}</p>
                {risks.map((r, idx) => (
                  <div
                    key={`${r.code}-${idx}`}
                    className={
                      "flex items-start gap-1.5 text-xs " +
                      (r.severity === "high" ? "text-status-error-foreground" : "text-status-warning-foreground")
                    }
                  >
                    <Warning size={13} className="shrink-0 mt-0.5" />
                    <span>{r.detail}</span>
                  </div>
                ))}
              </div>
            )}

            {/* 动态表单 */}
            {mapped.requiredInputs.length > 0 && (
              <div className="space-y-3">
                <p className="text-xs font-medium">{t("mcp.requiredConfig")}</p>
                {mapped.requiredInputs.map((i) => (
                  <div key={i.name} className="space-y-1">
                    <Label htmlFor={`mcp-in-${i.name}`} className="text-xs flex items-center gap-1.5">
                      {i.name}
                      {i.isRequired && <span className="text-status-error-foreground">*</span>}
                      {i.isSecret && (
                        <span className="text-[10px] px-1 rounded bg-muted text-muted-foreground">{t("mcp.secret")}</span>
                      )}
                    </Label>
                    {i.choices && i.choices.length > 0 ? (
                      <select
                        id={`mcp-in-${i.name}`}
                        className="w-full h-8 text-sm rounded-md border border-input bg-background px-2"
                        value={values[i.name] || ""}
                        onChange={(e) => setValues((p) => ({ ...p, [i.name]: e.target.value }))}
                      >
                        <option value="">—</option>
                        {i.choices.map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    ) : (
                      <Input
                        id={`mcp-in-${i.name}`}
                        type={i.isSecret ? "password" : "text"}
                        className="h-8 text-sm"
                        placeholder={i.placeholder || (i.target === "urlVar" ? `{${i.name}}` : "")}
                        value={values[i.name] || ""}
                        onChange={(e) => setValues((p) => ({ ...p, [i.name]: e.target.value }))}
                      />
                    )}
                    {i.description && <p className="text-[11px] text-muted-foreground">{i.description}</p>}
                  </div>
                ))}
              </div>
            )}

            {/* extra-confirm：高风险强制勾选才解锁安装 */}
            {needsAck && !blocked && (
              <label className="flex items-start gap-2 text-xs cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="mt-0.5 accent-primary"
                  checked={acked}
                  onChange={(e) => setAcked(e.target.checked)}
                />
                <span className="text-muted-foreground">{t("mcp.consentAck")}</span>
              </label>
            )}
          </div>
        ) : (
          <div className="bg-muted/50 rounded-md p-3 max-h-64 overflow-y-auto font-mono text-xs leading-relaxed">
            {logs.length === 0 && phase === "installing" && (
              <span className="text-muted-foreground">{t("mcp.installing")}</span>
            )}
            {logs.map((line, idx) => (
              <div key={idx} className="whitespace-pre-wrap break-all">{stripAnsi(line)}</div>
            ))}
            <div ref={logsEndRef} />
          </div>
        )}

        <DialogFooter>
          {phase === "form" ? (
            <>
              <Button variant="outline" onClick={handleClose}>{t("common.cancel")}</Button>
              <Button
                className="gap-1.5"
                disabled={missingRequired || blocked || (needsAck && !acked)}
                onClick={startInstall}
              >
                <DownloadSimple size={14} />
                {t("mcp.confirmInstall")}
              </Button>
            </>
          ) : (
            <Button onClick={handleClose} disabled={phase === "installing"}>
              {phase === "installing" ? t("mcp.installing") : t("common.close")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
