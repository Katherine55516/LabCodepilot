'use client';
/* eslint-disable @next/next/no-img-element -- slide images are resized locally and embedded in the editable IR */

import { useTranslation } from '@/hooks/useTranslation';

export type VisualBlock =
  | { id: string; type: 'image'; dataUrl: string; caption: string; fileName?: string }
  | { id: string; type: 'chart'; chartType: 'bar' | 'pie'; labels: string[]; values: number[]; unit: string }
  | { id: string; type: 'table'; rows: string[][] }
  | { id: string; type: 'shape'; shape: 'rect' | 'ellipse'; fill: string; text: string };

const field = 'w-full rounded border border-border bg-background px-2 py-1 text-sm';
const button = 'rounded border border-border px-2 py-1 text-xs hover:bg-accent';

export async function prepareImage(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png'].includes(file.type) || file.size > 8 * 1024 * 1024) throw new Error('Choose a PNG or JPEG under 8 MB');
  const source = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1200 / source.width, 900 / source.height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(source.width * scale));
    canvas.height = Math.max(1, Math.round(source.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image canvas unavailable');
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.82, 0.65, 0.45]) {
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      if (dataUrl.length < 700000) return dataUrl;
    }
    throw new Error('Image remains over 512 KB after resizing');
  } finally { source.close(); }
}

export function BlockPreview({ blocks, compact = false }: { blocks: VisualBlock[]; compact?: boolean }) {
  const { t } = useTranslation();
  if (!blocks?.length) return null;
  return <div className={`mt-3 grid gap-2 ${blocks.length > 1 ? 'grid-cols-2' : ''}`}>
    {blocks.map(block => <div key={block.id} className={`flex items-center justify-center overflow-hidden rounded bg-white/95 p-2 text-slate-900 ${compact ? 'min-h-16' : 'min-h-24'}`}>
      {block.type === 'image' && <figure className="w-full">{block.dataUrl ? <img src={block.dataUrl} alt={block.caption || t('ppt.m4.image')} className={`w-full object-contain ${compact ? 'max-h-20' : 'max-h-40'}`} /> : <span className="text-xs text-slate-500">{t('ppt.m4.uploadImage')}</span>}{block.caption && <figcaption className="truncate text-center text-[10px]">{block.caption}</figcaption>}</figure>}
      {block.type === 'chart' && (block.chartType === 'bar' ? <div className={`flex w-full items-end justify-around gap-1 ${compact ? 'h-20' : 'h-32'}`}>{block.values.map((value, index) => <div key={index} className="flex h-full min-w-0 flex-1 flex-col justify-end text-center"><span className="text-[10px]">{value}{block.unit}</span><div className="mx-auto w-4/5 rounded-t bg-violet-500" style={{ height: `${Math.max(2, value / Math.max(...block.values, 1) * 65)}%` }} /><span className="truncate text-[10px]">{block.labels[index]}</span></div>)}</div> : <div className="flex items-center gap-2"><div className={`rounded-full ${compact ? 'h-16 w-16' : 'h-24 w-24'}`} style={{ background: `conic-gradient(${block.values.map((value, i) => { const sum = block.values.reduce((a, b) => a + b, 0) || 1; const start = block.values.slice(0, i).reduce((a, b) => a + b, 0) / sum * 100; return `hsl(${i * 65} 70% 55%) ${start}% ${(start + value / sum * 100)}%`; }).join(',')})` }} /><div className="space-y-1 text-[10px]">{block.labels.map((label, i) => <div key={i}>{label}: {block.values[i]}</div>)}</div></div>)}
      {block.type === 'table' && <table className="w-full table-fixed border-collapse text-[10px]"><tbody>{block.rows.map((row, r) => <tr key={r}>{row.map((cell, c) => <td key={c} className={`border border-slate-300 p-1 ${r === 0 ? 'bg-slate-200 font-semibold' : ''}`}>{cell}</td>)}</tr>)}</tbody></table>}
      {block.type === 'shape' && <div className={`flex w-3/4 items-center justify-center px-3 text-center text-sm text-white ${compact ? 'min-h-12' : 'min-h-20'} ${block.shape === 'ellipse' ? 'rounded-full' : 'rounded-xl'}`} style={{ background: block.fill }}>{block.text}</div>}
    </div>)}
  </div>;
}

export function BlockEditor({ blocks = [], onChange, onRewrite, canRewrite = false }: { blocks?: VisualBlock[]; onChange: (blocks: VisualBlock[]) => void; onRewrite?: (id: string) => void; canRewrite?: boolean }) {
  const { t } = useTranslation();
  const update = (id: string, patch: Partial<VisualBlock>) => onChange(blocks.map(block => block.id === id ? { ...block, ...patch } as VisualBlock : block));
  const add = (type: VisualBlock['type']) => {
    const id = crypto.randomUUID().replaceAll('-', '').slice(0, 32);
    const block: VisualBlock = type === 'image' ? { id, type, dataUrl: '', caption: '' }
      : type === 'chart' ? { id, type, chartType: 'bar', labels: ['A', 'B'], values: [1, 2], unit: '' }
      : type === 'table' ? { id, type, rows: [['Name', 'Value'], ['A', '1']] }
      : { id, type, shape: 'rect', fill: '#6877c8', text: 'Label' };
    onChange([...blocks, block]);
  };
  return <div className="mt-3 space-y-2 border-t border-border pt-3"><div className="flex flex-wrap items-center gap-2"><span className="text-xs font-medium">{t('ppt.m4.visuals')}</span>{(['image', 'chart', 'table', 'shape'] as const).map(type => <button key={type} type="button" className={button} disabled={blocks.length >= 2} onClick={() => add(type)}>{t(`ppt.m4.${type}`)}</button>)}</div>
    {blocks.map(block => <div key={block.id} className="space-y-2 rounded border border-border p-2"><div className="flex justify-between text-xs font-medium"><span>{t(`ppt.m4.${block.type}`)}</span><span className="flex gap-2">{(block.type === 'image' || block.type === 'shape') && <button type="button" disabled={!canRewrite} onClick={() => onRewrite?.(block.id)}>{t('ppt.m4.aiBlock')}</button>}<button type="button" onClick={() => onChange(blocks.filter(item => item.id !== block.id))}>{t('ppt.delete')}</button></span></div>
      {block.type === 'image' && <><input type="file" accept="image/png,image/jpeg" aria-label={t('ppt.m4.image')} onChange={async event => { const file = event.target.files?.[0]; if (file) try { update(block.id, { dataUrl: await prepareImage(file) }); } catch (error) { window.alert((error as Error).message); } }} /><input className={field} aria-label={t('ppt.m4.caption')} value={block.caption} onChange={event => update(block.id, { caption: event.target.value })} maxLength={100} /></>}
      {block.type === 'chart' && <><select className={field} value={block.chartType} onChange={event => update(block.id, { chartType: event.target.value as 'bar' | 'pie' })}><option value="bar">{t('ppt.m4.bar')}</option><option value="pie">{t('ppt.m4.pie')}</option></select><input className={field} aria-label={t('ppt.m4.labels')} value={block.labels.join(', ')} onChange={event => update(block.id, { labels: event.target.value.split(',').map(value => value.trim()).slice(0, 6) })} /><input className={field} aria-label={t('ppt.m4.values')} value={block.values.join(', ')} onChange={event => update(block.id, { values: event.target.value.split(',').map(Number).slice(0, 6) })} /><input className={field} aria-label={t('ppt.m4.unit')} value={block.unit} onChange={event => update(block.id, { unit: event.target.value })} maxLength={16} /></>}
      {block.type === 'table' && <textarea className={field} aria-label={t('ppt.m4.tableData')} rows={4} value={block.rows.map(row => row.join('\t')).join('\n')} onChange={event => update(block.id, { rows: event.target.value.split('\n').slice(0, 6).map(row => row.split('\t').slice(0, 4)) })} />}
      {block.type === 'shape' && <div className="grid grid-cols-[1fr_auto] gap-2"><select className={field} value={block.shape} onChange={event => update(block.id, { shape: event.target.value as 'rect' | 'ellipse' })}><option value="rect">{t('ppt.m4.rectangle')}</option><option value="ellipse">{t('ppt.m4.ellipse')}</option></select><input type="color" aria-label={t('ppt.m4.color')} value={block.fill} onChange={event => update(block.id, { fill: event.target.value })} /><input className={`${field} col-span-2`} value={block.text} onChange={event => update(block.id, { text: event.target.value })} maxLength={100} /></div>}
    </div>)}
  </div>;
}
