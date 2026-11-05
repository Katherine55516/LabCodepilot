'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowCounterClockwise } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ErrorBanner } from '@/components/ui/error-banner';
import { Spinner } from '@/components/ui/spinner';
import { decksApi } from '@/lib/decks/client';
import type { DeckVersion } from '@/lib/decks/types';
import { useDecksT } from '../i18n';

interface HistoryDialogProps {
  deckId: string;
  currentVersion: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Restores a version; resolves to an error message or null. */
  onRestore: (version: number) => Promise<string | null>;
}

export function HistoryDialog(props: HistoryDialogProps) {
  const t = useDecksT();
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('decks.editor.history')}</DialogTitle>
          <DialogDescription>{t('decks.editor.history.description')}</DialogDescription>
        </DialogHeader>
        {props.open && <VersionList {...props} />}
      </DialogContent>
    </Dialog>
  );
}

function VersionList({ deckId, currentVersion, onRestore, onOpenChange }: HistoryDialogProps) {
  const t = useDecksT();
  const [versions, setVersions] = useState<DeckVersion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<number | null>(null);

  const load = useCallback(() => {
    decksApi.versions(deckId)
      .then(r => { setVersions([...r.versions].sort((a, b) => b.version - a.version)); setError(null); })
      .catch(e => setError(e instanceof Error ? e.message : String(e)));
  }, [deckId]);
  useEffect(() => { load(); }, [load]);

  const restore = async (version: number) => {
    setRestoring(version);
    const failure = await onRestore(version);
    setRestoring(null);
    if (failure) setError(failure); else onOpenChange(false);
  };

  if (error) return <ErrorBanner message={t('decks.editor.history.error')} description={error} actions={[{ label: t('decks.retry'), onClick: () => { setError(null); load(); } }]} />;
  if (!versions) return <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Spinner className="size-4" />{t('decks.loading')}</div>;
  if (versions.length === 0) return <p className="py-6 text-sm text-muted-foreground">{t('decks.editor.history.empty')}</p>;
  return (
    <ul className="-mx-2 max-h-[55vh] overflow-y-auto">
      {versions.map(v => (
        <li key={v.version} className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-muted/60">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">
              {t('decks.editor.history.version', { v: v.version })}
              {v.version === currentVersion && <span className="ml-2 text-xs text-muted-foreground">{t('decks.editor.history.current')}</span>}
            </div>
            <div className="truncate text-xs text-muted-foreground">{v.reason} · {new Date(v.createdAt).toLocaleString()}</div>
          </div>
          {v.version !== currentVersion && (
            <Button size="sm" variant="outline" disabled={restoring !== null} onClick={() => { void restore(v.version); }}>
              {restoring === v.version ? <Spinner className="size-3.5" /> : <ArrowCounterClockwise size={14} />}
              {t('decks.editor.history.restore')}
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
