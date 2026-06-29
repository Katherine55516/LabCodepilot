"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Plug,
  Globe,
  DownloadSimple,
  Trash,
  CheckCircle,
  ArrowSquareOut,
  SpinnerGap,
  Warning,
} from "@/components/ui/icon";
import { useTranslation } from "@/hooks/useTranslation";
import { McpInstallDialog, type MappedDetail } from "./McpInstallDialog";
import type { MarketplaceMcpServer, McpRuntimeRequirement } from "@/types";

interface McpMarketplaceServerDetailProps {
  server: MarketplaceMcpServer;
  onInstallComplete: () => void;
}

function displayName(s: MarketplaceMcpServer): string {
  return s.title || s.name.split("/").pop() || s.name;
}

export function McpMarketplaceServerDetail({
  server,
  onInstallComplete,
}: McpMarketplaceServerDetailProps) {
  const { t } = useTranslation();
  const [mapped, setMapped] = useState<MappedDetail | null>(null);
  const [runtime, setRuntime] = useState<McpRuntimeRequirement | null>(null);
  const [loading, setLoading] = useState(true);
  const [showInstall, setShowInstall] = useState(false);
  const [uninstalling, setUninstalling] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setMapped(null);
    setRuntime(null);
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/plugins/mcp/marketplace/detail?name=${encodeURIComponent(server.name)}`);
        if (!cancelled && res.ok) {
          const data = await res.json();
          setMapped(data.mapped || null);
          setRuntime(data.runtime || null);
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [server.name]);

  const handleUninstall = async () => {
    setUninstalling(true);
    try {
      const res = await fetch("/api/plugins/mcp/marketplace/uninstall", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serverName: server.name }),
      });
      if (res.ok) onInstallComplete();
    } finally {
      setUninstalling(false);
    }
  };

  const verifiedLabel =
    server.namespaceKind === "github" ? t("mcp.verifiedGithub") : t("mcp.verifiedDomain");

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-border px-6 py-4 shrink-0">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/50 shrink-0">
            {server.hasPackages ? (
              <Plug size={20} className="text-muted-foreground" />
            ) : (
              <Globe size={20} className="text-muted-foreground" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold truncate">{displayName(server)}</h3>
              {server.isInstalled && (
                <Badge
                  variant="outline"
                  className="text-[10px] px-1.5 py-0 border-status-success-border text-status-success-foreground shrink-0"
                >
                  <CheckCircle size={10} className="mr-0.5" />
                  {t("mcp.installed")}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-sm text-muted-foreground truncate">{server.name}</span>
              {server.repositoryUrl && (
                <a
                  href={server.repositoryUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                  title={t("mcp.viewRepo")}
                >
                  <ArrowSquareOut size={14} />
                </a>
              )}
            </div>
          </div>
          <div className="shrink-0 flex items-center gap-2">
            {server.isInstalled && server.updateAvailable && (
              <Button
                size="sm"
                className="gap-1.5"
                disabled={loading || !mapped || !!server.trust?.blocked}
                onClick={() => setShowInstall(true)}
              >
                <DownloadSimple size={14} />
                {t("mcp.update")}
              </Button>
            )}
            {server.isInstalled ? (
              <Button variant="destructive" size="sm" className="gap-1.5" onClick={handleUninstall} disabled={uninstalling}>
                {uninstalling ? <SpinnerGap size={14} className="animate-spin" /> : <Trash size={14} />}
                {t("mcp.uninstall")}
              </Button>
            ) : (
              <Button
                size="sm"
                className="gap-1.5"
                disabled={loading || !mapped || !!server.trust?.blocked}
                onClick={() => setShowInstall(true)}
              >
                <DownloadSimple size={14} />
                {t("mcp.install")}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto min-h-0 px-6 py-4 space-y-4">
        {server.description && <p className="text-sm text-foreground/90">{server.description}</p>}

        {/* 版本变更复查（rug-pull 防线）：已装版本 < 注册中心 latest */}
        {server.isInstalled && server.updateAvailable && (
          <div className="rounded-md border border-status-warning-border bg-status-warning/10 p-3">
            <div className="flex items-start gap-2">
              <Warning size={14} className="text-status-warning-foreground shrink-0 mt-0.5" />
              <div className="text-xs">
                <p className="font-medium">
                  {t("mcp.updateAvailable")}：v{server.installedVersion} → v{server.version}
                </p>
                <p className="text-muted-foreground mt-0.5">{t("mcp.updateReviewHint")}</p>
              </div>
            </div>
          </div>
        )}

        {/* 信任信号 */}
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="text-[10px] gap-1">
            <CheckCircle size={10} className="text-status-success-foreground" />
            {verifiedLabel}
          </Badge>
          {server.version && (
            <Badge variant="outline" className="text-[10px]">v{server.version}</Badge>
          )}
          {server.hasPackages
            ? server.registryTypes.map((rt) => (
                <Badge key={rt} variant="outline" className="text-[10px]">{rt}</Badge>
              ))
            : server.remoteTypes.map((rt) => (
                <Badge key={rt} variant="outline" className="text-[10px]">{rt}</Badge>
              ))}
        </div>
        <p className="text-[11px] text-muted-foreground">{t("mcp.trustNote")}</p>

        {/* 黑名单硬拦横幅 */}
        {server.trust?.blocked && (
          <div className="rounded-md border border-status-error-border bg-status-error/10 p-3">
            <p className="text-xs font-medium text-status-error-foreground">{t("mcp.blockedHint")}</p>
            {server.trust.blockReason && (
              <p className="text-[11px] text-muted-foreground mt-1">{server.trust.blockReason}</p>
            )}
          </div>
        )}

        {/* 风险提示 */}
        {!server.trust?.blocked && (server.trust?.risks?.length ?? 0) > 0 && (
          <div className="space-y-1">
            <p className="text-[11px] font-medium text-muted-foreground">{t("mcp.consentRisks")}</p>
            {server.trust!.risks.map((r, idx) => (
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

        {/* 将安装的内容预览 */}
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <SpinnerGap size={18} className="animate-spin text-muted-foreground" />
          </div>
        ) : mapped?.config ? (
          <div className="space-y-1">
            <p className="text-[11px] font-medium text-muted-foreground">
              {server.hasPackages ? t("mcp.localPackage") : t("mcp.remoteEndpoint")}
            </p>
            <pre className="text-xs font-mono bg-muted/50 rounded-md p-3 whitespace-pre-wrap break-all">
              {mapped.config.command
                ? `${mapped.config.command} ${(mapped.config.args || []).join(" ")}`.trim()
                : `${mapped.config.type || "http"}  ${mapped.config.url || ""}`}
            </pre>
          </div>
        ) : null}
      </div>

      {mapped && (
        <McpInstallDialog
          open={showInstall}
          onOpenChange={setShowInstall}
          server={server}
          mapped={mapped}
          runtime={runtime}
          onComplete={onInstallComplete}
        />
      )}
    </div>
  );
}
