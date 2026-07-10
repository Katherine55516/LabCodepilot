'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';
import { Button } from '@/components/ui/button';
import { ShieldCheck } from '@/components/ui/icon';

interface SandboxToggleProps {
  sessionId?: string;
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  disabled?: boolean;
}

/**
 * Cowork POC — 沙箱模式开关(输入条上方,权限选择器右侧)。
 *
 * 开 = 本会话的 AI 在隔离虚拟机内执行文件工具,真机文件不可见。
 * 切换即 PATCH sandbox_enabled;后端会连带清空 sdk_session_id(执行目标变了,
 * 跨 VM 边界 resume 会失败),下一条消息重开 SDK 会话链。
 */
export function SandboxToggle({ sessionId, enabled, onChange, disabled }: SandboxToggleProps) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);

  const toggle = async () => {
    if (disabled || busy) return;
    const next = !enabled;
    // New chat (no sessionId yet) — local-only, persisted at session creation.
    if (!sessionId) {
      onChange(next);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/chat/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sandbox_enabled: next ? 1 : 0 }),
      });
      if (!res.ok) {
        console.warn(`[SandboxToggle] PATCH failed: ${res.status}`);
        return;
      }
      onChange(next);
    } catch (err) {
      console.warn('[SandboxToggle] PATCH error:', err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={toggle}
      disabled={disabled || busy}
      title={t('sandbox.tooltip')}
      className={cn(
        'rounded-md px-2.5 h-7 text-xs font-medium border transition-all gap-1',
        enabled
          ? 'bg-status-success-muted text-status-success-foreground border-status-success-foreground/30'
          : 'text-muted-foreground border-border/60 hover:text-foreground hover:border-foreground/30 hover:bg-accent/50'
      )}
    >
      <ShieldCheck size={14} className={enabled ? 'text-status-success-foreground' : undefined} />
      <span>{enabled ? t('sandbox.on') : t('sandbox.off')}</span>
    </Button>
  );
}
