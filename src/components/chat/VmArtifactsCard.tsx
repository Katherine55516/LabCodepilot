'use client';

import { useMemo } from 'react';
import type { VmArtifactFile } from '@/types';
import { useTranslation } from '@/hooks/useTranslation';
import { Button } from '@/components/ui/button';
import { ShieldCheck, DownloadSimple, Package } from '@/components/ui/icon';

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
 */
export function VmArtifactsCard({ sessionId, files, vmOnline = true }: VmArtifactsCardProps) {
  const { t } = useTranslation();

  const sorted = useMemo(
    () => [...files].sort((a, b) => b.mtime - a.mtime),
    [files],
  );

  if (sorted.length === 0) return null;

  const downloadUrl = (p: string) =>
    `/api/cowork/artifacts?sessionId=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(p)}`;

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
          <a href={`/api/cowork/artifacts?sessionId=${encodeURIComponent(sessionId)}&archive=1`} download>
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs gap-1 text-muted-foreground hover:text-foreground">
              <Package size={13} />
              {t('sandbox.artifacts.downloadAll')}
            </Button>
          </a>
        )}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {sorted.map((f) => (
          <a
            key={f.path}
            href={downloadUrl(f.path)}
            download={f.name}
            className="group inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background px-2 py-1 text-xs hover:border-foreground/30 transition-colors"
            title={`${f.path} · ${formatSize(f.size)}`}
          >
            <span className="max-w-[220px] truncate">{f.name}</span>
            <span className="text-muted-foreground">{formatSize(f.size)}</span>
            <DownloadSimple size={13} className="text-muted-foreground group-hover:text-foreground" />
          </a>
        ))}
      </div>
    </div>
  );
}
