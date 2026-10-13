'use client';

import { useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import type { PptRenderElement } from '../types';

export const editorFonts = ['Aptos', 'Arial', 'Calibri', 'Georgia', 'Times New Roman', 'Libre Baskerville', 'Inter', 'Consolas', 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC'];
type Style = NonNullable<PptRenderElement['style']>;

export function PptTextToolbar({ elements, fonts = [], onApply, onSelectText }: {
  elements: PptRenderElement[]; fonts?: string[];
  onApply: (patch: Style) => Promise<unknown>; onSelectText: () => void;
}) {
  const { t } = useTranslation();
  const [patch, setPatch] = useState<Style>({});
  const [busy, setBusy] = useState(false);
  const base = elements[0]?.style || {};
  const value = { ...base, ...patch };
  const disabled = busy || !elements.length || elements.some(element => element.locked);
  const field = 'rounded border border-border bg-background px-2 py-1.5 text-xs';
  function set<K extends keyof Style>(key: K, next: Style[K]) { setPatch(current => ({ ...current, [key]: next })); }
  async function apply() { setBusy(true); try { await onApply(patch); } finally { setBusy(false); } }
  return <form data-testid="ppt-text-toolbar" aria-label={t('ppt.editor.format')} className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-card p-2" onSubmit={event => { event.preventDefault(); void apply(); }}>
    <button type="button" className={field} onClick={onSelectText}>{t('ppt.editor.selectPageText')}</button>
    <label className="flex items-center gap-1 text-xs">{t('ppt.inspector.fontFamily')}<select aria-label={t('ppt.inspector.fontFamily')} className={field} disabled={disabled} value={value.fontFamily || fonts[0] || 'Arial'} onChange={event => setPatch(current => ({...current,fontFamily:event.target.value,eastAsiaFontFamily:event.target.value}))}>
      {[...new Set([value.fontFamily, ...fonts, ...editorFonts].filter((font): font is string => Boolean(font)))].map(font => <option key={font}>{font}</option>)}
    </select></label>
    <label className="flex items-center gap-1 text-xs">{t('ppt.inspector.fontSize')}<input aria-label={t('ppt.inspector.fontSize')} className={`${field} w-16`} type="number" min={8} max={96} required disabled={disabled} value={value.fontSizePt || 18} onChange={event => set('fontSizePt', Number(event.target.value))}/></label>
    <button type="button" aria-label={t('ppt.editor.weightBold')} aria-pressed={(value.fontWeight || 400) >= 600} className={`${field} font-bold`} disabled={disabled} onClick={() => set('fontWeight', (value.fontWeight || 400) >= 600 ? 400 : 700)}>B</button>
    <button type="button" aria-label={t('ppt.editor.italic')} aria-pressed={value.fontStyle === 'italic'} className={`${field} italic`} disabled={disabled} onClick={() => set('fontStyle', value.fontStyle === 'italic' ? 'normal' : 'italic')}>I</button>
    <button type="button" aria-label={t('ppt.editor.underline')} aria-pressed={value.textDecoration === 'underline'} className={`${field} underline`} disabled={disabled} onClick={() => set('textDecoration', value.textDecoration === 'underline' ? 'none' : 'underline')}>U</button>
    <label className="flex items-center gap-1 text-xs">{t('ppt.inspector.alignment')}<select aria-label={t('ppt.inspector.alignment')} className={field} disabled={disabled} value={value.textAlign || 'left'} onChange={event => set('textAlign', event.target.value)}>{['left', 'center', 'right'].map(align => <option key={align} value={align}>{t(`ppt.inspector.${align}` as never)}</option>)}</select></label>
    <label className="flex items-center gap-1 text-xs">{t('ppt.editor.lineHeight')}<input aria-label={t('ppt.editor.lineHeight')} className={`${field} w-16`} type="number" min={0.8} max={3} step={0.05} required disabled={disabled} value={value.lineHeight || 1.2} onChange={event => set('lineHeight', Number(event.target.value))}/></label>
    <input aria-label={t('ppt.inspector.color')} type="color" className="h-8 w-9" disabled={disabled} value={value.color || '#111111'} onChange={event => set('color', event.target.value)}/>
    <button type="submit" className={`${field} bg-primary text-primary-foreground disabled:opacity-50`} disabled={disabled || !Object.keys(patch).length}>{t('ppt.inspector.applyStyle')}</button>
  </form>;
}
