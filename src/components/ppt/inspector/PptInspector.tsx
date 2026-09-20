'use client';

import { useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import type { PptRenderElement } from '../types';

export function PptInspector({ element, slideId, onCommand }: { element: PptRenderElement; slideId: string; onCommand: (type: string, payload: unknown) => Promise<void> }) {
  const { t } = useTranslation();
  const text = element.kind === 'text' ? element.content?.text || '' : element.content?.items?.map(item => item.text).join('\n') || '';
  const [value, setValue] = useState(text);
  return <div className="space-y-2">
    <p className="truncate text-xs text-muted-foreground">{element.kind} · {element.nodeId}</p>
    {['text', 'list', 'timeline', 'metric'].includes(element.kind) && <>
      <textarea aria-label={t('ppt.structured.properties')} className="min-h-32 w-full rounded border border-border bg-background p-2 text-sm" value={value} onChange={event => setValue(event.target.value)} />
      <button className="w-full rounded border border-border px-3 py-2 text-sm" onClick={() => void onCommand('node.setContent', { slideId, nodeId: element.nodeId, content: element.kind === 'text' ? { text: value } : { items: value.split('\n').filter(Boolean).map((line, index) => ({ id: element.content?.items?.[index]?.id || crypto.randomUUID().replaceAll('-', ''), text: line })) } })}>{t('ppt.structured.applyContent')}</button>
    </>}
  </div>;
}
