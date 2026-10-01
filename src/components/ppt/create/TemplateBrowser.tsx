'use client';
/* eslint-disable @next/next/no-img-element -- authenticated previews from the PPT renderer */
import { useEffect, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import type { PptTemplate } from '../types';

export function TemplateBrowser({ templates, selectedId, onSelect, locked = false }: { templates: PptTemplate[]; selectedId: string; onSelect: (id: string) => void; locked?: boolean }) {
  const { t } = useTranslation();
  const [page, setPage] = useState(0);
  const [failed, setFailed] = useState(false);
  const selected = templates.find(item => item.id === selectedId);
  useEffect(() => { setPage(0); setFailed(false); }, [selectedId]);
  useEffect(() => { setFailed(false); }, [page]);
  const total = Math.max(1, selected?.pages || 1);
  return <section className="rounded-xl border border-border bg-card p-5" data-testid="ppt-template-browser">
    <h3 className="font-semibold">{t('ppt.edit.templateMain')}</h3>
    <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(10rem,.7fr)_minmax(0,1.3fr)]">
      <div className="grid max-h-[34rem] grid-cols-2 content-start gap-3 overflow-y-auto xl:grid-cols-1">
        {templates.filter(item => item.compatibility === 'mapped' && (!locked || item.id === selectedId)).map(item => <button key={item.id} disabled={locked} aria-pressed={item.id === selectedId} className={`rounded-lg border p-3 text-left disabled:opacity-100 ${item.id === selectedId ? 'border-primary bg-primary/5' : 'border-border'}`} onClick={() => onSelect(item.id)}>
          <div className="aspect-video rounded border-t-4 p-3 text-sm" style={{ background: item.palette?.background, color: item.palette?.foreground, borderColor: item.palette?.accent }}>{item.sampleTitles?.[0] || item.name}</div>
          <strong className="mt-2 block text-sm">{item.name}</strong>
        </button>)}
      </div>
      <div className="flex min-w-0 flex-col rounded-xl border border-border bg-background p-3">
        {selected ? <><b className="text-sm">{selected.name}</b><p className="mt-1 text-xs text-muted-foreground">{selected.description}</p>
          <div className="my-5 flex flex-1 items-center">
            {!failed ? <img className="aspect-video w-full rounded border border-border object-contain" src={`/api/ppt/templates/${selected.id}/preview?slide=${page}`} alt={`${selected.name} ${page + 1}`} onError={() => setFailed(true)}/> : <p role="alert" className="text-sm text-destructive">{t('ppt.edit.templateMissing')}</p>}
          </div><p className="text-xs text-muted-foreground">{t('ppt.edit.stylePreview')}</p>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2"><button className="rounded border border-border px-2 py-1 text-sm disabled:opacity-50" disabled={page === 0} onClick={() => setPage(value => value - 1)}>{t('ppt.edit.previous')}</button><span className="text-xs">{page + 1} / {total}</span><button className="rounded border border-border px-2 py-1 text-sm disabled:opacity-50" disabled={page >= total - 1} onClick={() => setPage(value => value + 1)}>{t('ppt.edit.next')}</button></div>
        </> : <p role="alert" className="text-sm text-destructive">{t('ppt.edit.templateMissing')}</p>}
      </div>
    </div>
  </section>;
}
