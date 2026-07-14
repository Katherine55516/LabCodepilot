'use client';

import { useMemo, useState } from 'react';
import type { VmArtifactFile } from '@/types';
import { useTranslation } from '@/hooks/useTranslation';
import { showToast } from '@/hooks/useToast';
import { Button } from '@/components/ui/button';
import { ShieldCheck, DownloadSimple, Package, SpinnerGap } from '@/components/ui/icon';

interface VmArtifactsCardProps {
  sessionId: string;
  files: VmArtifactFile[];
  /** VM 在线状态:false 时显示"沙箱休眠"徽标(列表来自持久化,下载会自动唤醒 VM)。 */
  vmOnline?: boolean;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Cowork 沙箱产物卡片 — 展示 agent 在 VM 内新建/修改的文件,提供
 * 单文件下载与整包下载(经 /api/cowork/artifacts 流式拉出)。
 * 下载是用户主动导出动作,也是沙箱会话中唯一落真机的路径。
 *
 * 下载走受控 fetch(不用裸 <a download>):VM 休眠时下载接口会先唤醒 VM
 * (数秒冷启动),期间给对应条目转圈动画,避免"点了没反应像卡死"的困惑。
 */
export function VmArtifactsCard({ sessionId, files, vmOnline = true }: VmArtifactsCardProps) {
  const { t } = useTranslation();
  // 正在下载的 key 集合('__all__' 表示整包下载)。
  const [busy, setBusy] = useState<Set<string>>(new Set());

  const sorted = useMemo(
    () => [...files].sort((a, b) => b.mtime - a.mtime),
    [files],
  );

  if (sorted.length === 0) return null;

  const setKeyBusy = (key: string, on: boolean) =>
    setBusy((prev) => {
      const next = new Set(prev);
      if (on) next.add(key); else next.delete(key);
      return next;
    });

  /**
   * fetch → blob → 触发浏览器另存。fetch 会命中服务端 ensureRunning(VM 休眠时
   * 唤醒),响应到达前 spinner 一直转。saveName 为空时用响应头/后备名。
   */
  const download = async (url: string, key: string, saveName: string) => {
    if (busy.has(key)) return;
    setKeyBusy(key, true);
    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.warn(`[VmArtifactsCard] download failed: ${res.status}`);
        // E4.2: 大概率是文件已被 agent 删除(清单残留)。给出提示并触发
        // 清单重拉 —— list 端点在 VM 在线时会对账剔除已不存在的文件。
        showToast({ type: 'warning', message: t('sandbox.artifacts.downloadMissing') });
        window.dispatchEvent(new CustomEvent('vm-artifacts-refresh'));
        return;
      }
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = saveName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // 释放放到下一帧,确保下载已触发
      setTimeout(() => URL.revokeObjectURL(objUrl), 0);
    } catch (err) {
      console.warn('[VmArtifactsCard] download error:', err);
    } finally {
      setKeyBusy(key, false);
    }
  };

  const fileUrl = (p: string) =>
    `/api/cowork/artifacts?sessionId=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(p)}`;
  const archiveUrl = `/api/cowork/artifacts?sessionId=${encodeURIComponent(sessionId)}&archive=1`;

  return (
    <div className="mx-4 mb-2 rounded-lg border border-status-success-border bg-status-success-muted/40 px-3 py-2">
      <div className="flex items-center gap-1.5 text-xs font-medium text-status-success-foreground">
        <ShieldCheck size={14} />
        <span>{t('sandbox.artifacts.title')}</span>
        <span className="text-muted-foreground font-normal">· {sorted.length}</span>
        {!vmOnline && (
          <span
            className="ml-1 rounded-full border border-border/60 bg-background px-2 py-0.5 text-[11px] font-normal text-muted-foreground"
            title={t('sandbox.artifacts.sleepingHint')}
          >
            {t('sandbox.artifacts.sleeping')}
          </span>
        )}
        <div className="flex-1" />
        {sorted.length > 1 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs gap-1 text-muted-foreground hover:text-foreground"
            disabled={busy.has('__all__')}
            onClick={() => download(archiveUrl, '__all__', `sandbox-${sessionId.slice(0, 8)}.tar.gz`)}
          >
            {busy.has('__all__') ? <SpinnerGap size={13} className="animate-spin" /> : <Package size={13} />}
            {t('sandbox.artifacts.downloadAll')}
          </Button>
        )}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {sorted.map((f) => {
          const isBusy = busy.has(f.path);
          return (
            <button
              key={f.path}
              type="button"
              disabled={isBusy}
              onClick={() => download(fileUrl(f.path), f.path, f.name)}
              className="group inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background px-2 py-1 text-xs hover:border-foreground/30 transition-colors disabled:opacity-70"
              title={isBusy ? t('sandbox.artifacts.starting') : `${f.path} · ${formatSize(f.size)}`}
            >
              <span className="max-w-[220px] truncate">{f.name}</span>
              <span className="text-muted-foreground">{formatSize(f.size)}</span>
              {isBusy
                ? <SpinnerGap size={13} className="animate-spin text-status-success-foreground" />
                : <DownloadSimple size={13} className="text-muted-foreground group-hover:text-foreground" />}
            </button>
          );
        })}
      </div>
      {busy.size > 0 && !vmOnline && (
        <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <SpinnerGap size={12} className="animate-spin" />
          {t('sandbox.artifacts.starting')}
        </div>
      )}
    </div>
  );
}
