'use client';

import { useTranslation } from '@/hooks/useTranslation';
import { useCoworkStatus, type CoworkAssetsStatus } from '@/hooks/useCoworkStatus';
import { Button } from '@/components/ui/button';
import { Plus, ShieldCheck, DownloadSimple } from '@/components/ui/icon';

interface OfficeEmptyCardProps {
  /** 兼容字段:assets 信息缺席时(旧 payload)回退用。就绪判定以 assets.overall 为准。 */
  imageProvisioned: boolean;
  creating?: boolean;
  onStart: () => void;
  /**
   * sidebar(默认)= 侧边栏列表区的紧凑卡(E3);
   * landing = /chat 落地页主区的居中大卡(E4,办公 tab 下替代「项目对话/选择文件夹」)。
   */
  variant?: 'sidebar' | 'landing';
}

/**
 * 沙箱资产动作区(镜像流水线 M2):就绪 → 开始按钮;缺失/失败 → 「下载沙箱
 * 环境」按钮(+错误行);下载中 → 进度条。设置页复用(compact)。
 * assets 未下发(旧 server)时回退 imageProvisioned 语义。
 */
export function CoworkAssetsAction({
  assets,
  fallbackProvisioned,
  compact,
  startLabel,
  onStart,
  starting,
  onDownload,
  showUpgrade,
}: {
  assets: CoworkAssetsStatus | undefined;
  fallbackProvisioned: boolean;
  compact?: boolean;
  /** 可用时的主按钮;不传则可用时不渲染任何东西(设置页场景)。 */
  startLabel?: string;
  onStart?: () => void;
  starting?: boolean;
  onDownload: () => void;
  /** M3:可用但有新版时显示"下载新版"按钮(仅设置页开启;办公卡不打扰)。 */
  showUpgrade?: boolean;
}) {
  const { t } = useTranslation();
  const btnSize = compact ? ('sm' as const) : ('default' as const);
  const btnClass = compact ? 'h-7 gap-1 text-xs' : 'gap-1.5';
  const textClass = compact ? 'text-[11px] leading-relaxed' : 'text-xs leading-relaxed';

  // "能否开工"看 usable(升级下载期间仍可用);无 assets(旧 payload)回退兼容字段
  const usable = assets ? assets.usable : fallbackProvisioned;
  if (usable) {
    // 可选升级面(仅设置页):下载中显示进度,有新版显示升级按钮
    if (showUpgrade && assets?.overall === 'downloading') {
      return (
        <div className="flex flex-col gap-1.5">
          <div className={`${textClass} text-muted-foreground`}>{`${t('workspace.office.downloading')} ${assets.totalPct}%`}</div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${Math.max(2, assets.totalPct)}%` }} />
          </div>
        </div>
      );
    }
    if (showUpgrade && assets?.upgradeAvailable) {
      return (
        <Button variant="outline" size={btnSize} className={btnClass} onClick={onDownload}>
          <DownloadSimple size={compact ? 13 : 15} />
          {t('workspace.office.upgrade')}
        </Button>
      );
    }
    if (!startLabel || !onStart) return null;
    return (
      <Button variant={compact ? 'outline' : 'default'} size={btnSize} className={btnClass} disabled={starting} onClick={onStart}>
        <Plus size={compact ? 13 : 15} />
        {startLabel}
      </Button>
    );
  }

  if (assets?.overall === 'downloading') {
    const stateLine =
      assets.image.state === 'verifying' || assets.claude.state === 'installing'
        ? t('workspace.office.verifying')
        : `${t('workspace.office.downloading')} ${assets.totalPct}%`;
    return (
      <div className="flex flex-col gap-1.5">
        <div className={`${textClass} text-muted-foreground`}>{stateLine}</div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-500"
            style={{ width: `${Math.max(2, assets.totalPct)}%` }}
          />
        </div>
      </div>
    );
  }

  // missing / failed → 下载(失败时同按钮即重试,.part 自动续传)
  return (
    <div className="flex flex-col gap-1.5">
      {assets?.overall === 'failed' && (
        <p className={`${textClass} text-status-error-foreground`}>
          {t('workspace.office.downloadFailed')}
          {assets.image.error || assets.claude.error ? `:${assets.image.error || assets.claude.error}` : ''}
        </p>
      )}
      <Button variant="outline" size={btnSize} className={btnClass} onClick={onDownload}>
        <DownloadSimple size={compact ? 13 : 15} />
        {assets?.overall === 'failed' ? t('workspace.office.retryDownload') : t('workspace.office.download')}
      </Button>
    </div>
  );
}

/**
 * 「办公」模式空态卡(cowork-office-mode.md E3/E4;M2 加资产下载引导)。
 * 说明沙箱语义 + 一键开始;资产未就绪时给「下载沙箱环境」按钮与进度(D3 显式
 * 触发),就绪后变回开始按钮。
 */
export function OfficeEmptyCard({ imageProvisioned, creating, onStart, variant = 'sidebar' }: OfficeEmptyCardProps) {
  const { t } = useTranslation();
  const { data, startDownload } = useCoworkStatus();
  const assets = data?.assets;

  if (variant === 'landing') {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="flex w-full max-w-md flex-col gap-3 rounded-xl border border-border/50 bg-card/50 p-6">
          <div className="flex items-center gap-2 text-base font-medium">
            <ShieldCheck size={20} className="text-status-success-foreground" />
            {t('workspace.office.emptyTitle')}
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {t('workspace.office.emptyDesc')}
          </p>
          <CoworkAssetsAction
            assets={assets}
            fallbackProvisioned={imageProvisioned}
            startLabel={t('workspace.office.start')}
            onStart={onStart}
            starting={creating}
            onDownload={startDownload}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-1 mt-2 flex flex-col gap-2 rounded-lg border border-border/50 bg-card/50 p-3">
      <div className="flex items-center gap-1.5 text-xs font-medium">
        <ShieldCheck size={14} className="text-status-success-foreground" />
        {t('workspace.office.emptyTitle')}
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {t('workspace.office.emptyDesc')}
      </p>
      <CoworkAssetsAction
        assets={assets}
        fallbackProvisioned={imageProvisioned}
        compact
        startLabel={t('workspace.office.start')}
        onStart={onStart}
        starting={creating}
        onDownload={startDownload}
      />
    </div>
  );
}
