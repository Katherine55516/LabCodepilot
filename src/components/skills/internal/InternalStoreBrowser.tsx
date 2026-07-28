"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MagnifyingGlass, SpinnerGap, Storefront } from "@/components/ui/icon";
import { useTranslation } from "@/hooks/useTranslation";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import { InternalSkillCard } from "./InternalSkillCard";
import { InternalSkillDetail } from "./InternalSkillDetail";
import type { InternalStoreSkill } from "@/types/electron";

interface InternalStoreBrowserProps {
  /** 安装/卸载后回调（刷新「我的技能」聚合）。 */
  onInstalled: () => void;
  /** 首次列表就拿到 SKILLS_NOT_CONFIGURED（登录前 probe 探不到）→ 通知上层隐藏 tab。 */
  onUnavailable: () => void;
}

const PAGE_SIZE = 20;

type GateState = "ready" | "login" | "error";

/**
 * 技能市场（内部）浏览器 — 左列表右详情，对照外部 MarketplaceBrowser。
 * 与外部的关键差异：服务端是真分页（page/pageSize + totalPages），
 * 「加载更多」= page+1 **追加**（外部 skills.sh 无分页,是加大 limit 整体替换）;
 * 数据走主进程 IPC（token 不下发 renderer），不走 Next route。
 */
export function InternalStoreBrowser({ onInstalled, onUnavailable }: InternalStoreBrowserProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<InternalStoreSkill[]>([]);
  const [selected, setSelected] = useState<InternalStoreSkill | null>(null);
  const [gate, setGate] = useState<GateState>("ready");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  // 请求序号守卫:只有最新一次查询的结果能落地(与外部市场同款防竞态)。
  const seqRef = useRef(0);
  // 已加载到的页码;加载更多的重入锁。
  const pageRef = useRef(1);
  const loadingMoreRef = useRef(false);

  const api = typeof window !== "undefined" ? window.electronAPI?.skillsStore : undefined;

  /** 首屏/查询变化/安装后刷新:从第 1 页重拉到当前深度(保留滚动位置)。 */
  const doSearch = useCallback(
    async (query: string, depthPages: number = 1) => {
      if (!api) return;
      const seq = ++seqRef.current;
      setLoading(true);
      setErrorDetail(null);
      try {
        // 真分页下的"重拉当前深度" = 顺序拉 1..N 页合并(N 很小,安装后刷新才 >1)
        const merged: InternalStoreSkill[] = [];
        let morePages = false;
        for (let p = 1; p <= depthPages; p++) {
          const r = await api.list({ keyword: query || undefined, page: p, pageSize: PAGE_SIZE });
          if (seq !== seqRef.current) return;
          if (!r.ok) {
            if (r.error === "not-logged-in") {
              setGate("login");
            } else if (r.error === "SKILLS_NOT_CONFIGURED") {
              onUnavailable();
            } else {
              setGate("error");
              setErrorDetail(r.message || r.error);
            }
            setItems([]);
            setHasMore(false);
            return;
          }
          merged.push(...(r.items as InternalStoreSkill[]));
          const totalPages = Number(r.pagination?.totalPages ?? 1);
          morePages = p < totalPages;
          if (!morePages) break;
        }
        setGate("ready");
        setItems(merged);
        pageRef.current = Math.max(1, Math.min(depthPages, Math.ceil(merged.length / PAGE_SIZE)));
        setHasMore(morePages);
        // 详情选中项同步(安装/卸载后徽章即时翻转)
        setSelected((prev) => (prev ? merged.find((s) => s.id === prev.id) ?? prev : prev));
      } finally {
        if (seq === seqRef.current) setLoading(false);
      }
    },
    [api, onUnavailable],
  );

  /** 加载更多:page+1 追加。 */
  const loadMore = useCallback(async () => {
    if (!api || loadingMoreRef.current || loading || !hasMore) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    const seq = seqRef.current; // 沿用当前查询;查询变化令其失效
    const nextPage = pageRef.current + 1;
    try {
      const r = await api.list({ keyword: search || undefined, page: nextPage, pageSize: PAGE_SIZE });
      if (seq !== seqRef.current) return;
      if (!r.ok) {
        // 加载更多失败:保留已有结果,仅停止继续加载
        setHasMore(false);
        return;
      }
      setItems((prev) => {
        // 追加去重(翻页窗口期上游数据变动可能造成重复 id)
        const seen = new Set(prev.map((s) => s.id));
        return [...prev, ...(r.items as InternalStoreSkill[]).filter((s) => !seen.has(s.id))];
      });
      pageRef.current = nextPage;
      const totalPages = Number(r.pagination?.totalPages ?? nextPage);
      setHasMore(nextPage < totalPages);
    } finally {
      loadingMoreRef.current = false;
      if (seq === seqRef.current) setLoadingMore(false);
    }
  }, [api, search, loading, hasMore]);

  // 防抖统一入口:mount 时以 search="" 触发首次加载(与外部市场同构)。
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(search, 1), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [search, doSearch]);

  const handleChanged = useCallback(() => {
    // 重拉当前深度,保留滚动位置;再通知上层刷新「我的技能」
    doSearch(search, pageRef.current);
    onInstalled();
  }, [doSearch, search, onInstalled]);

  const handleLogin = useCallback(async () => {
    const r = await window.electronAPI?.auth?.triggerLogin();
    if (r?.ok) doSearch(search, 1);
  }, [doSearch, search]);

  const sentinelRef = useInfiniteScroll({
    hasMore,
    loading: loading || loadingMore,
    onLoadMore: loadMore,
  });

  // ── 门禁态(未登录/错误)整版占位 ──
  if (gate === "login") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
        <Storefront size={48} className="opacity-30" />
        <p className="text-sm">{t("skills.internalLoginRequired")}</p>
        <Button variant="outline" size="sm" onClick={handleLogin}>
          {t("skills.internalLoginAction")}
        </Button>
      </div>
    );
  }
  if (gate === "error") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
        <Storefront size={48} className="opacity-30" />
        <p className="text-sm text-status-error-foreground">{t("skills.internalError")}</p>
        {errorDetail && <p className="text-xs">{errorDetail}</p>}
        <Button variant="outline" size="sm" onClick={() => doSearch(search, 1)}>
          {t("skills.internalRetry")}
        </Button>
      </div>
    );
  }

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
              placeholder={t("skills.internalSearch")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-7 h-8 text-sm"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto min-h-0">
          <div className="p-1">
            {loading && items.length === 0 && (
              <div className="flex items-center justify-center py-8">
                <SpinnerGap size={20} className="animate-spin text-muted-foreground" />
              </div>
            )}
            {!loading && items.length === 0 && (
              <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
                <Storefront size={32} className="opacity-40" />
                <p className="text-xs">{t("skills.searchNoResults")}</p>
              </div>
            )}
            {items.map((skill) => (
              <InternalSkillCard
                key={skill.id}
                skill={skill}
                selected={selected?.id === skill.id}
                onSelect={() => setSelected(skill)}
              />
            ))}
            {items.length > 0 && hasMore && (
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
          <InternalSkillDetail key={selected.id} skill={selected} onChanged={handleChanged} />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
            <Storefront size={48} className="opacity-30" />
            <div className="text-center">
              <p className="text-sm font-medium">{t("skills.internalHint")}</p>
              <p className="text-xs">{t("skills.internalHintDesc")}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
