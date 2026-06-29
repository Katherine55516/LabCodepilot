"use client";

import { Plug, Globe, CheckCircle } from "@/components/ui/icon";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/hooks/useTranslation";
import type { MarketplaceMcpServer } from "@/types";

interface McpMarketplaceServerCardProps {
  server: MarketplaceMcpServer;
  selected: boolean;
  onSelect: () => void;
}

/** 服务器短名（反向 DNS 的最后一段，优先 title）。 */
function displayName(s: MarketplaceMcpServer): string {
  return s.title || s.name.split("/").pop() || s.name;
}

export function McpMarketplaceServerCard({
  server,
  selected,
  onSelect,
}: McpMarketplaceServerCardProps) {
  const { t } = useTranslation();
  const typeLabel = server.hasPackages
    ? server.registryTypes.join("/") || "local"
    : server.remoteTypes.length
      ? "remote"
      : "";

  return (
    <div
      className={cn(
        "group flex items-center gap-2 rounded-md px-3 py-2 cursor-pointer transition-colors",
        selected ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
      )}
      onClick={onSelect}
    >
      {server.hasPackages ? (
        <Plug size={16} className="shrink-0 text-muted-foreground" />
      ) : (
        <Globe size={16} className="shrink-0 text-muted-foreground" />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{displayName(server)}</span>
          {server.isInstalled && !server.updateAvailable && (
            <Badge
              variant="outline"
              className="text-[10px] px-1.5 py-0 border-status-success-border text-status-success-foreground shrink-0"
            >
              <CheckCircle size={10} className="mr-0.5" />
              {t("mcp.installed")}
            </Badge>
          )}
          {server.isInstalled && server.updateAvailable && (
            <Badge
              variant="outline"
              className="text-[10px] px-1.5 py-0 border-status-warning-border text-status-warning-foreground shrink-0"
            >
              {t("mcp.updateAvailable")}
            </Badge>
          )}
          {server.status === "deprecated" && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-status-warning-foreground shrink-0">
              {t("mcp.deprecated")}
            </Badge>
          )}
          {server.trust?.blocked && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-status-error-border text-status-error-foreground shrink-0">
              {t("mcp.blocked")}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="truncate">{server.namespace}</span>
          {typeLabel && <span className="shrink-0 opacity-70">· {typeLabel}</span>}
        </div>
      </div>
    </div>
  );
}
