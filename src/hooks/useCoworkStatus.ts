'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface CoworkAssetProgress {
  state: 'missing' | 'downloading' | 'verifying' | 'installing' | 'ready' | 'failed';
  receivedBytes: number;
  totalBytes: number;
  pct: number;
  error?: string;
}

export interface CoworkAssetsStatus {
  image: CoworkAssetProgress;
  claude: CoworkAssetProgress;
  /** unsupported = 非 macOS 且未下发 remote(R5-6):办公由公司远程沙箱提供,本地无可下载资产。 */
  overall: 'ready' | 'downloading' | 'missing' | 'failed' | 'unsupported';
  totalPct: number;
  /** 当前落盘资产可用(升级下载期间仍 true)——"能否开工/发消息"看这个,别看 overall。 */
  usable: boolean;
  /** 有新版可下载(现有资产仍可用,升级可选)。 */
  upgradeAvailable: boolean;
}

export interface CoworkStatusData {
  enabled: boolean;
  imageProvisioned: boolean;
  vmPhase: string;
  assets?: CoworkAssetsStatus;
}

/**
 * Cowork 可用性/资产状态共享 hook(镜像流水线 M2)。
 * - 挂载(且 active)时拉一次;assets.overall==='downloading' 期间 2s 轮询
 * - 监听 'cowork-status-changed'(设置开关)与 'cowork-assets-changed'
 *   (下载启停)即时刷新
 * - startDownload / cancelDownload 封装 /api/cowork/assets 并广播事件,
 *   让同屏的其他挂载点(侧边栏空态卡/设置页/落地页)同步进入下载态
 */
export function useCoworkStatus(active: boolean = true) {
  const [data, setData] = useState<CoworkStatusData | null>(null);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/cowork/status');
      if (!res.ok) return;
      const d = (await res.json()) as CoworkStatusData;
      if (mountedRef.current) setData(d);
    } catch {
      // 探测失败保持现状(fail-closed 由使用方兜底)
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!active) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- refresh 为 async,setData 在 await 之后的异步回调里,并非同步 setState(规则误报)
    refresh();
    window.addEventListener('cowork-status-changed', refresh);
    window.addEventListener('cowork-assets-changed', refresh);
    return () => {
      window.removeEventListener('cowork-status-changed', refresh);
      window.removeEventListener('cowork-assets-changed', refresh);
    };
  }, [active, refresh]);

  // 下载进行中轮询进度;结束(ready/failed)自动停
  const overall = data?.assets?.overall;
  useEffect(() => {
    if (!active || overall !== 'downloading') return;
    const timer = setInterval(refresh, 2000);
    return () => clearInterval(timer);
  }, [active, overall, refresh]);

  const startDownload = useCallback(async () => {
    try {
      await fetch('/api/cowork/assets', { method: 'POST' });
    } catch {
      // 启动失败由下一次 refresh 的状态兜底
    }
    window.dispatchEvent(new CustomEvent('cowork-assets-changed'));
  }, []);

  const cancelDownload = useCallback(async () => {
    try {
      await fetch('/api/cowork/assets', { method: 'DELETE' });
    } catch {
      // ignore
    }
    window.dispatchEvent(new CustomEvent('cowork-assets-changed'));
  }, []);

  return { data, refresh, startDownload, cancelDownload };
}
