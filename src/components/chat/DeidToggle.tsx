'use client';

import { ShieldCheck } from '@/components/ui/icon';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';
import { PromptInputButton } from '@/components/ai-elements/prompt-input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface DeidToggleProps {
  enabled: boolean;
  onToggle: () => void;
  disabled?: boolean;
}

/**
 * 脱敏网关开关 — 办公(沙箱)会话输入区工具排(effort 下拉右侧)。
 * 开:发送前经 deid-service 识别 + 预览确认,模型只见占位符;
 * 关:原文直发。状态会话级持久(PUT /api/deid/state)。
 */
export function DeidToggle({ enabled, onToggle, disabled }: DeidToggleProps) {
  const { t } = useTranslation();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <PromptInputButton
          onClick={onToggle}
          disabled={disabled}
          aria-pressed={enabled}
          className={cn('max-w-full', enabled && 'text-primary')}
        >
          <ShieldCheck size={16} weight={enabled ? 'fill' : 'regular'} />
          <span className="text-xs truncate">
            {t('deid.toggleLabel')}
            {enabled ? ` · ${t('deid.stateOn')}` : ''}
          </span>
        </PromptInputButton>
      </TooltipTrigger>
      <TooltipContent>
        {enabled ? t('deid.tooltipOn') : t('deid.tooltipOff')}
      </TooltipContent>
    </Tooltip>
  );
}
