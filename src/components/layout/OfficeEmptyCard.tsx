'use client';

import { useTranslation } from '@/hooks/useTranslation';
import { Button } from '@/components/ui/button';
import { Plus, ShieldCheck } from '@/components/ui/icon';

interface OfficeEmptyCardProps {
  /** 本机 VM 镜像是否就绪(来自 /api/cowork/status);未就绪时不给新建按钮 */
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
 * 「办公」模式空态卡(cowork-office-mode.md E3/E4)。
 * 说明沙箱语义 + 一键开始;镜像未预置时显示提示而非按钮(P1 镜像手动预置)。
 */
export function OfficeEmptyCard({ imageProvisioned, creating, onStart, variant = 'sidebar' }: OfficeEmptyCardProps) {
  const { t } = useTranslation();

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
          {imageProvisioned ? (
            <Button className="gap-1.5" disabled={creating} onClick={onStart}>
              <Plus size={15} />
              {t('workspace.office.start')}
            </Button>
          ) : (
            <p className="text-xs leading-relaxed text-status-warning-foreground">
              {t('workspace.office.imageMissing')}
            </p>
          )}
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
      {imageProvisioned ? (
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1 text-xs"
          disabled={creating}
          onClick={onStart}
        >
          <Plus size={13} />
          {t('workspace.office.start')}
        </Button>
      ) : (
        <p className="text-[11px] leading-relaxed text-status-warning-foreground">
          {t('workspace.office.imageMissing')}
        </p>
      )}
    </div>
  );
}
