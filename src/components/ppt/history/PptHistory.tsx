'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';

type Operation = { id: string; kind: string; revision: number; at: string; command?: { type?: string } };

export function PptHistory({ projectId, revision }: { projectId: string; revision: number }) {
  const { t } = useTranslation();
  const [operations, setOperations] = useState<Operation[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/ppt/projects/${projectId}/commands`, { cache: 'no-store', signal: controller.signal })
      .then(response => response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`)))
      .then(value => setOperations((value.operations || []).slice(-8).reverse()))
      .catch(error => { if (error.name !== 'AbortError') setOperations([]); });
    return () => controller.abort();
  }, [projectId, revision]);
  return <details className="border-t border-border pt-3">
    <summary className="cursor-pointer text-xs font-medium">{t('ppt.structured.history')}</summary>
    {operations.length ? <ol className="mt-2 space-y-1">{operations.map(operation => <li key={operation.id} className="flex justify-between gap-2 text-xs text-muted-foreground"><span className="truncate">{operation.kind === 'command' ? operation.command?.type : operation.kind}</span><span>r{operation.revision}</span></li>)}</ol> : <p className="mt-2 text-xs text-muted-foreground">{t('ppt.structured.noHistory')}</p>}
  </details>;
}
