'use client';
/* eslint-disable @next/next/no-img-element -- IR images are local data URLs rendered inside the editor canvas. */

import { useRef, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import type { PptBounds, PptRenderElement, PptRenderSlide } from '../types';

function ElementContent({ element }: { element: PptRenderElement }) {
  const { t } = useTranslation();
  const style = { color: element.style?.color, fontFamily: element.style?.eastAsiaFontFamily || element.style?.fontFamily, fontSize: `${(element.style?.fontSizePt || 18) / 10}vw`, fontWeight: element.style?.fontWeight };
  if (element.kind === 'text') return <div className="h-full overflow-hidden whitespace-pre-wrap" style={style}>{element.content?.text}</div>;
  if (['list', 'timeline', 'metric'].includes(element.kind)) return <div className="h-full overflow-hidden" style={style}>{element.content?.items?.map((item, index) => <div key={item.id}>{element.kind === 'timeline' ? `${index + 1}. ` : element.kind === 'list' ? '• ' : ''}{item.text}</div>)}</div>;
  if (element.kind === 'image' && element.content?.dataUrl) return <img src={element.content.dataUrl} alt="" className="h-full w-full object-contain" />;
  if (element.kind === 'table') return <div className="grid h-full place-items-center overflow-hidden text-xs">{t('ppt.structured.tableRows', { count: element.content?.rows?.length || 0 })}</div>;
  if (element.kind === 'chart') return <div className="grid h-full place-items-center overflow-hidden text-xs">{t('ppt.structured.chartItems', { count: element.content?.labels?.length || 0 })}</div>;
  return <div className="grid h-full place-items-center overflow-hidden text-xs">{element.content?.text || element.kind}</div>;
}

export function PptCanvas({ slide, selectedId, onSelect, onGeometry }: { slide: PptRenderSlide; selectedId: string | null; onSelect: (id: string | null) => void; onGeometry: (element: PptRenderElement, bounds: PptBounds) => void }) {
  const root = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<Record<string, PptBounds>>({});
  const drag = useRef<{ element: PptRenderElement; mode: 'move' | 'resize'; startX: number; startY: number; bounds: PptBounds } | null>(null);
  const pct = (value: number, total: number) => `${value / total * 100}%`;
  return <div ref={root} className="relative aspect-video w-full overflow-hidden rounded-lg border border-border shadow-sm" style={{ background: slide.background || '#fff' }} onPointerMove={event => {
    if (!drag.current || !root.current) return;
    const rect = root.current.getBoundingClientRect(); const dx = (event.clientX - drag.current.startX) / rect.width * slide.size.width; const dy = (event.clientY - drag.current.startY) / rect.height * slide.size.height;
    setDraft(current => ({ ...current, [drag.current!.element.id]: drag.current!.mode === 'move'
      ? { ...drag.current!.bounds, x: Math.round(drag.current!.bounds.x + dx), y: Math.round(drag.current!.bounds.y + dy) }
      : { ...drag.current!.bounds, width: Math.max(91440, Math.round(drag.current!.bounds.width + dx)), height: Math.max(91440, Math.round(drag.current!.bounds.height + dy)) } }));
  }} onPointerUp={() => { if (!drag.current) return; const current = draft[drag.current.element.id]; if (current) onGeometry(drag.current.element, current); drag.current = null; }} onPointerLeave={() => { drag.current = null; }}>
    {slide.elements.map(element => { const b = draft[element.id] || element.bounds; const movable = Boolean(element.nodeId && element.id === element.nodeId && !element.locked); return <button type="button" key={element.id} data-node-id={element.nodeId || undefined} onClick={event => { event.stopPropagation(); if (element.nodeId) onSelect(element.nodeId); }} onPointerDown={event => { if (!movable) return; event.currentTarget.setPointerCapture(event.pointerId); drag.current = { element, mode: 'move', startX: event.clientX, startY: event.clientY, bounds: b }; }} className={`absolute overflow-hidden text-left ${selectedId === element.nodeId ? 'ring-2 ring-primary' : ''} ${movable ? 'cursor-move' : 'cursor-default'}`} style={{ left: pct(b.x, slide.size.width), top: pct(b.y, slide.size.height), width: pct(b.width, slide.size.width), height: pct(b.height, slide.size.height), zIndex: element.zIndex, background: element.kind === 'shape' ? element.style?.fill : undefined }}><ElementContent element={element} />{movable && selectedId === element.nodeId && <span className="absolute bottom-0 right-0 h-3 w-3 cursor-se-resize bg-primary" onPointerDown={event => { event.stopPropagation(); drag.current = { element, mode: 'resize', startX: event.clientX, startY: event.clientY, bounds: b }; }} />}</button>; })}
  </div>;
}
