'use client';

import type { VmStatusEvent } from '@/types';
import { useTranslation } from '@/hooks/useTranslation';
import { SpinnerGap, ShieldCheck, WarningCircle } from '@/components/ui/icon';

interface VmProvisioningBannerProps {
  status: VmStatusEvent | undefined;
}

/**
 * Cowork 沙箱就绪窗口横幅(P1-D)。冷启动 VM 期间(spawn + provision,数秒~
 * 数十秒)显示"沙箱准备中",把原本静默的"生成中"变成有反馈的等待 —— 消息已
 * 发出、就绪后自动开始。ready 态不渲染(横幅消失,进入正常流转);failed 态
 * 显示失败与重试提示。仅在沙箱会话且有进行中的 vm_status 时渲染。
 */
export function VmProvisioningBanner({ status }: VmProvisioningBannerProps) {
  const { t } = useTranslation();
  if (!status || status.phase === 'ready') return null;

  if (status.phase === 'failed') {
    return (
      <div className="mx-4 mb-2 flex items-center gap-2 rounded-lg border border-status-error-foreground/30 bg-status-error-muted px-3 py-2 text-xs text-status-error-foreground">
        <WarningCircle size={15} />
        <span className="font-medium">{t('sandbox.provisioning.failedTitle')}</span>
        <span className="text-muted-foreground font-normal">{t('sandbox.provisioning.failedHint')}</span>
      </div>
    );
  }

  // starting / booting / provisioning — indeterminate progress with phase label
  const phaseLabel =
    status.phase === 'provisioning'
      ? t('sandbox.provisioning.preparing')
      : status.phase === 'booting'
        ? t('sandbox.provisioning.booting')
        : t('sandbox.provisioning.starting');

  return (
    <div className="mx-4 mb-2 flex items-center gap-2 rounded-lg border border-status-success-border bg-status-success-muted/40 px-3 py-2 text-xs text-status-success-foreground">
      <ShieldCheck size={15} />
      <SpinnerGap size={13} className="animate-spin" />
      <span className="font-medium">{phaseLabel}</span>
      <span className="text-muted-foreground font-normal">{t('sandbox.provisioning.autostart')}</span>
    </div>
  );
}
