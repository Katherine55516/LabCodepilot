"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Input } from "@/components/ui/input";
import { MagnifyingGlass, SpinnerGap, Storefront } from "@/components/ui/icon";
import { useTranslation } from "@/hooks/useTranslation";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import { MarketplaceSkillCard } from "./MarketplaceSkillCard";
import { MarketplaceSkillDetail } from "./MarketplaceSkillDetail";
import type { MarketplaceSkill } from "@/types";

interface MarketplaceBrowserProps {
  onInstalled: () => void;
}

// 每页步长。skills.sh 不支持 offset/cursor,只能加大 limit 重取;其结果按相关度
// 排序且前缀稳定(limit=2N 的前 N 条 === limit=N),故"加载更多"= 用更大的 limit
// 整体替换,无需去重、key 稳定不跳滚动。返回数 < 请求 limit 即为到底。
const PAGE_SIZE = 20;

export function MarketplaceBrowser({ onInstalled }: MarketplaceBrowserProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<MarketplaceSkill[]>([]);
  const [selected, setSelected] = useState<MarketplaceSkill | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  // 请求序号守卫:只有最新一次查询的结果能落地,避免慢响应覆盖新结果。
  const seqRef = useRef(0);
  // 当前已加载到的 limit(= 列表深度)。
  const limitRef = useRef(PAGE_SIZE);
  // 加载更多的重入锁(observer 可能在 state 更新前连续触发)。
  const loadingMoreRef = useRef(false);

  // 纯请求,不触碰 state。
  const fetchPage = useCallback(async (query: string, limit: number): Promise<MarketplaceSkill[]> => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    params.set("limit", String(limit));
    const res = await fetch(`/api/skills/marketplace/search?${params}`);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    const data = await res.json();
    return (data.skills || []) as MarketplaceSkill[];
  }, []);

  // 首屏 / 查询变化 / 安装后刷新:整体替换。
  const doSearch = useCallback(
    async (query: string, limit: number = PAGE_SIZE): Promise<MarketplaceSkill[]> => {
      const seq = ++seqRef.current;
      setLoading(true);
      setError(null);
      try {
        const skills = await fetchPage(query, limit);
        if (seq === seqRef.current) {
          setResults(skills);
          limitRef.current = limit;
          setHasMore(skills.length >= limit);
        }
        return skills;
      } catch (err) {
        if (seq === seqRef.current) {
          setError((err as Error).message);
          setResults([]);
          setHasMore(false);
        }
        return [];
      } finally {
        if (seq === seqRef.current) setLoading(false);
      }
    },
    [fetchPage],
  );

  // 加载更多:加大 limit 重取,前缀稳定 → 整体替换。
  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || loading || !hasMore) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    const seq = seqRef.current; // 沿用当前查询序号;查询变化会令其失效。
    const nextLimit = limitRef.current + PAGE_SIZE;
    try {
      const skills = await fetchPage(search, nextLimit);
      if (seq === seqRef.current) {
        setResults(skills);
        limitRef.current = nextLimit;
        setHasMore(skills.length >= nextLimit);
      }
    } catch {
      // 加载更多失败:保留已有结果,仅停止继续加载。
      if (seq === seqRef.current) setHasMore(false);
    } finally {
      loadingMoreRef.current = false;
      if (seq === seqRef.current) setLoadingMore(false);
    }
  }, [fetchPage, search, loading, hasMore]);

  // 单一来源:防抖 effect 在 mount 时即以 search="" 触发首次加载,
  // 不再单独发初始请求(否则与防抖并发双调用,慢的那次会覆盖结果)。
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(search, PAGE_SIZE), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [search, doSearch]);

  const handleInstallComplete = useCallback(async () => {
    // 重拉当前深度(而非回到第一页),保留滚动位置;再同步详情页选中项,
    // 让其安装/卸载按钮即时翻转(否则仍显示操作前的旧状态)。
    const fresh = await doSearch(search, limitRef.current);
    setSelected((prev) => (prev ? fresh.find((s) => s.id === prev.id) ?? prev : prev));
    onInstalled();
  }, [search, doSearch, onInstalled]);

  const sentinelRef = useInfiniteScroll({
    hasMore,
    loading: loading || loadingMore,
    onLoadMore: loadMore,
  });

  return (
    <div className="flex flex-1 min-h-0">
      {/* Left: search + results */}
      <div className="w-64 shrink-0 flex flex-col overflow-hidden pl-4">
        <div className="px-2 pt-4 pb-2">
          <div className="relative">
            <MagnifyingGlass
              size={14}
              className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              placeholder={t('skills.marketplaceSearch')}
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
                <p className="text-xs text-center text-status-error-foreground">{t('skills.marketplaceError')}</p>
                <p className="text-[10px] text-center">{error}</p>
              </div>
            )}
            {!loading && !error && results.length === 0 && (
              <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
                <Storefront size={32} className="opacity-40" />
                <p className="text-xs">{t('skills.searchNoResults')}</p>
              </div>
            )}
            {results.map((skill) => (
              <MarketplaceSkillCard
                key={skill.id}
                skill={skill}
                selected={selected?.id === skill.id}
                onSelect={() => setSelected(skill)}
              />
            ))}
            {results.length > 0 && hasMore && (
              <div ref={sentinelRef} className="flex justify-center py-3">
                {loadingMore && (
                  <SpinnerGap size={16} className="animate-spin text-muted-foreground" />
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Divider */}
      <div className="shrink-0 w-px bg-border/50" />

      {/* Right: detail */}
      <div className="flex-1 min-w-0 overflow-hidden">
        {selected ? (
          <MarketplaceSkillDetail
            key={selected.id}
            skill={selected}
            onInstallComplete={handleInstallComplete}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
            <Storefront size={48} className="opacity-30" />
            <div className="text-center">
              <p className="text-sm font-medium">{t('skills.marketplaceHint')}</p>
              <p className="text-xs">{t('skills.marketplaceHintDesc')}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
