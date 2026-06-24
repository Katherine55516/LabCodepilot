'use client';

import { useEffect, useRef } from 'react';

interface UseInfiniteScrollOptions {
  /** 是否还有下一页;为 false 时不再观察哨兵。 */
  hasMore: boolean;
  /** 是否正在加载(首屏或加载更多);为 true 时不重复触发。 */
  loading: boolean;
  /** 哨兵进入视口且可加载时回调。 */
  onLoadMore: () => void;
  /** 触发提前量,默认提前 200px。 */
  rootMargin?: string;
}

/**
 * 列表无限滚动:把返回的哨兵 ref 挂到列表末尾的占位元素上,
 * 当它进入视口(含 rootMargin 提前量)且 hasMore && !loading 时调用 onLoadMore。
 *
 * 与 gallery 页内联实现同构,抽出以供 skills / mcp 市场复用。
 */
export function useInfiniteScroll<T extends HTMLElement = HTMLDivElement>({
  hasMore,
  loading,
  onLoadMore,
  rootMargin = '200px',
}: UseInfiniteScrollOptions) {
  const sentinelRef = useRef<T>(null);
  // 始终调用最新的 onLoadMore,避免它频繁变化时反复重建 observer。
  const onLoadMoreRef = useRef(onLoadMore);
  onLoadMoreRef.current = onLoadMore;

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loading) {
          onLoadMoreRef.current();
        }
      },
      { rootMargin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loading, rootMargin]);

  return sentinelRef;
}
