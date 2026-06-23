"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Input } from "@/components/ui/input";
import { MagnifyingGlass, SpinnerGap, Storefront } from "@/components/ui/icon";
import { useTranslation } from "@/hooks/useTranslation";
import { McpMarketplaceServerCard } from "./McpMarketplaceServerCard";
import { McpMarketplaceServerDetail } from "./McpMarketplaceServerDetail";
import type { MarketplaceMcpServer } from "@/types";

interface McpMarketplaceBrowserProps {
  onInstalled: () => void;
}

export function McpMarketplaceBrowser({ onInstalled }: McpMarketplaceBrowserProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<MarketplaceMcpServer[]>([]);
  const [selected, setSelected] = useState<MarketplaceMcpServer | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  // 请求序号守卫：只有最新一次请求的结果/错误能落地，避免慢响应覆盖新结果。
  const seqRef = useRef(0);

  const doSearch = useCallback(async (query: string): Promise<MarketplaceMcpServer[]> => {
    const seq = ++seqRef.current;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (query) params.set("q", query);
      params.set("limit", "50");
      const res = await fetch(`/api/plugins/mcp/marketplace/search?${params}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      const servers: MarketplaceMcpServer[] = data.servers || [];
      if (seq === seqRef.current) setResults(servers);
      return servers;
    } catch (err) {
      if (seq === seqRef.current) {
        setError((err as Error).message);
        setResults([]);
      }
      return [];
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }, []);

  // 单一来源：防抖 effect 在 mount 时即以 search="" 触发首次加载，
  // 不再单独发初始请求（否则与防抖并发双调用，慢的那次会覆盖结果）。
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(search), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [search, doSearch]);

  const handleInstallComplete = useCallback(async () => {
    const fresh = await doSearch(search);
    setSelected((prev) => (prev ? fresh.find((s) => s.name === prev.name) ?? prev : prev));
    onInstalled();
  }, [search, doSearch, onInstalled]);

  return (
    <div className="flex flex-1 min-h-0">
      {/* Left: search + results */}
      <div className="w-64 shrink-0 flex flex-col overflow-hidden pl-4">
        <div className="px-2 pt-4 pb-2">
          <div className="relative">
            <MagnifyingGlass size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={t("mcp.marketSearch")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-7 h-8 text-sm"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto min-h-0">
          <div className="p-1">
            {loading && results.length === 0 && (
              <div className="flex items-center justify-center py-8">
                <SpinnerGap size={20} className="animate-spin text-muted-foreground" />
              </div>
            )}
            {error && (
              <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground px-3">
                <p className="text-xs text-center text-status-error-foreground">{t("mcp.marketError")}</p>
                <p className="text-[10px] text-center">{error}</p>
              </div>
            )}
            {!loading && !error && results.length === 0 && (
              <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
                <Storefront size={32} className="opacity-40" />
                <p className="text-xs">{t("mcp.marketNoResults")}</p>
              </div>
            )}
            {results.map((s) => (
              <McpMarketplaceServerCard
                key={s.name}
                server={s}
                selected={selected?.name === s.name}
                onSelect={() => setSelected(s)}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Divider */}
      <div className="shrink-0 w-px bg-border/50" />

      {/* Right: detail */}
      <div className="flex-1 min-w-0 overflow-hidden">
        {selected ? (
          <McpMarketplaceServerDetail
            key={selected.name}
            server={selected}
            onInstallComplete={handleInstallComplete}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
            <Storefront size={48} className="opacity-30" />
            <div className="text-center">
              <p className="text-sm font-medium">{t("mcp.marketHint")}</p>
              <p className="text-xs">{t("mcp.marketHintDesc")}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
