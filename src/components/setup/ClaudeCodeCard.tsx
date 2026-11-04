'use client';

import { useEffect, useState, useCallback } from 'react';
import { SetupCard } from './SetupCard';
import { useTranslation } from '@/hooks/useTranslation';
import type { SetupCardStatus } from '@/types';

interface ClaudeStatus {
  connected: boolean;
  version: string | null;
  bundled?: boolean;
  missingGit?: boolean;
}

interface ClaudeCodeCardProps {
  status: SetupCardStatus;
  onStatusChange: (status: SetupCardStatus) => void;
}

/**
 * ClaudeCodeCard — Setup card for Claude Code.
 *
 * Since v0.55, Claude Code is bundled inside the installer via the
 * @anthropic-ai/claude-agent-sdk-<platform>-<arch> subpackage. The card no
 * longer guides the user through CLI installation — it just confirms the
 * bundled version is ready and surfaces auxiliary warnings (e.g. Git Bash
 * missing on Windows, which some hooks still need).
 */
export function ClaudeCodeCard({ status, onStatusChange }: ClaudeCodeCardProps) {
  const { t } = useTranslation();
  const [claudeStatus, setClaudeStatus] = useState<ClaudeStatus | null>(null);
  const [checking, setChecking] = useState(true);

  const checkStatus = useCallback(async () => {
    setChecking(true);
    try {
      const res = await fetch('/api/claude-status');
      if (res.ok) {
        const data: ClaudeStatus = await res.json();
        setClaudeStatus(data);
        // Bundled Claude Code is always considered ready — the install card
        // immediately transitions to 'completed' so the rest of the Setup
        // flow can proceed.
        if (data.connected) {
          onStatusChange('completed');
        }
      }
    } catch {
      // ignore — show the card in checking state
    } finally {
      setChecking(false);
    }
  }, [onStatusChange]);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  const description = claudeStatus?.connected
    ? `${t('setup.claude.bundled')} — ${claudeStatus.version ?? 'bundled'}`
    : t('setup.claude.description');

  return (
    <SetupCard title={t('setup.claude.title')} description={description} status={status}>
      {checking ? (
        <p className="text-xs text-muted-foreground">Checking...</p>
      ) : claudeStatus?.connected ? (
        <div className="space-y-1">
          <p className="text-xs">{claudeStatus.version ?? 'bundled'}</p>
          {claudeStatus.missingGit && (
            <p className="text-[11px] text-muted-foreground">
              {t('setup.claude.missingGit')}
            </p>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{t('setup.claude.description')}</p>
      )}
    </SetupCard>
  );
}
