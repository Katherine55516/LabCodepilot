'use client';

// Localized replacement for Streamdown's built-in (English-only) external-link
// confirmation modal. Passed to every <Streamdown> via the `linkSafety` prop so
// the confirmation follows the app's UI language (en / zh / zh-HK) instead of
// being hard-coded English inside the streamdown package.

import { useState } from 'react';
import { Copy, Check, ArrowSquareOut } from '@phosphor-icons/react';
import type { LinkSafetyConfig, LinkSafetyModalProps } from 'streamdown';
import { useTranslation } from '@/hooks/useTranslation';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

function LinkSafetyModal({ url, isOpen, onClose, onConfirm }: LinkSafetyModalProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — ignore */
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowSquareOut className="size-5 shrink-0" />
            {t('linkSafety.title')}
          </DialogTitle>
          <DialogDescription>{t('linkSafety.description')}</DialogDescription>
        </DialogHeader>

        <div className="break-all rounded-md bg-muted px-3 py-2 font-mono text-sm text-foreground">
          {url}
        </div>

        <DialogFooter className="grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={handleCopy}>
            {copied ? <Check /> : <Copy />}
            {copied ? t('linkSafety.copied') : t('linkSafety.copy')}
          </Button>
          <Button onClick={onConfirm}>
            <ArrowSquareOut />
            {t('linkSafety.open')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Shared linkSafety config for all Streamdown instances. `enabled: true` keeps
 * the safety gate (anti prompt-injection); `renderModal` swaps the default
 * English modal for the localized one above.
 */
export const linkSafetyConfig: LinkSafetyConfig = {
  enabled: true,
  renderModal: (props) => <LinkSafetyModal {...props} />,
};
