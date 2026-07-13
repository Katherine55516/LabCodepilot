'use client';

import { useTranslation } from '@/hooks/useTranslation';
import { Button } from '@/components/ui/button';
import { Plus, ShieldCheck } from '@/components/ui/icon';

interface OfficeEmptyCardProps {
  /** 本机 VM 镜像是否就绪(来自 /api/cowork/status);未就绪时不给新建按钮 */
  imageProvisioned: boolean;
  creating?: boolean;
  onStart: () => void;
}

/**
 * E3 — 「办公」tab 的空态介绍卡(cowork-office-mode.md)。
 * 说明沙箱语义 + 一键开始;镜像未预置时显示提示而非按钮(P1 镜像手动预置)。
 */
export function OfficeEmptyCard({ imageProvisioned, creating, onStart }: OfficeEmptyCardProps) {
  const { t } = useTranslation();

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
