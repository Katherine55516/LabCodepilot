'use client';

import { useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import type { PptRenderElement } from '../types';

export const editorFonts = ['Aptos', 'Arial', 'Calibri', 'Georgia', 'Times New Roman', 'Libre Baskerville', 'Inter', 'Consolas', 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC'];
type Style = NonNullable<PptRenderElement['style']>;
/** Point cards render their measured plan, which may differ from the template token. */
export function effectiveTextStyle(element: PptRenderElement): Style {
  const layout=element.kind==='list'?element.content?.pointLayout:undefined;
  return {...element.style,...(layout?{fontSizePt:layout.fontSizePt,lineHeight:layout.lineHeight||1.18}:{})};
}


/** Text actions never select locked counters or navigation as editable body. */
export function editableTextIds(elements:PptRenderElement[],scope:'title'|'body'|'all') {
  return [...new Set(elements.filter(e=>e.nodeId&&!e.locked&&['text','list','timeline','metric'].includes(e.kind)&&
    (scope==='all'||scope==='title'?scope==='all'||['title','template-title'].includes(e.semanticRole||''):!['title','template-title','title-translation','eyebrow','page-number','closing-greeting'].includes(e.semanticRole||''))).map(e=>e.nodeId!))];
}

export function PptTextToolbar({ elements, fonts = [], onApply, onSelectText, onSelectTitle,onSelectBody, disabledReason }: {
  elements: PptRenderElement[]; fonts?: string[]; disabledReason?:string;onSelectTitle?:()=>void;onSelectBody?:()=>void;
  onApply: (patch: Style) => Promise<unknown>; onSelectText: () => void;
}) {
  const { t } = useTranslation();
  const [patch, setPatch] = useState<Style>({});
  const [busy, setBusy] = useState(false);
  const styles=elements.map(effectiveTextStyle);
  const base = styles[0] || {};
  const mixed=(key:keyof Style)=>!(key in patch)&&styles.some(style=>style[key]!==base[key]);
  const mixedKeys=(['fontFamily','fontSizePt','fontWeight','fontStyle','textDecoration','textAlign','lineHeight','color'] as const).filter(mixed);
  const value = { ...base, ...patch };
  const disabled = Boolean(disabledReason) || busy || !elements.length || elements.some(element => element.locked);
  const field = 'rounded border border-border bg-background px-2 py-1.5 text-xs';
  function set<K extends keyof Style>(key: K, next: Style[K]) { setPatch(current => ({ ...current, [key]: next })); }
  async function apply() { setBusy(true); try { await onApply(patch); } finally { setBusy(false); } }
  return <form data-testid="ppt-text-toolbar" aria-label={t('ppt.editor.format')} className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-card p-2" onSubmit={event => { event.preventDefault(); void apply(); }}>
    <span className="text-xs" role="status">{t('ppt.editor.formatSelectedCount',{count:elements.length})}{mixedKeys.length>0?` · ${t('ppt.editor.mixedValues')}`:''}</span>{(disabledReason||elements.some(element=>element.locked))&&<span className="text-xs text-muted-foreground">{disabledReason||t('ppt.editor.lockedSelection')}</span>}
    {onSelectTitle&&<button type="button" className={field} onClick={onSelectTitle}>{t('ppt.editor.selectTitle')}</button>}{onSelectBody&&<button type="button" className={field} onClick={onSelectBody}>{t('ppt.editor.selectBody')}</button>}<button type="button" className={field} onClick={onSelectText}>{t('ppt.editor.selectPageText')}</button>
    <label className="flex items-center gap-1 text-xs">{t('ppt.inspector.fontFamily')}<select aria-label={t('ppt.inspector.fontFamily')} className={field} disabled={disabled} value={mixed('fontFamily')?'':value.fontFamily || fonts[0] || 'Arial'} onChange={event => setPatch(current => ({...current,fontFamily:event.target.value,eastAsiaFontFamily:event.target.value}))}>
      {mixed('fontFamily')&&<option value="">{t('ppt.editor.mixedValues')}</option>}{[...new Set([value.fontFamily, ...fonts, ...editorFonts].filter((font): font is string => Boolean(font)))].map(font => <option key={font}>{font}</option>)}
    </select></label>
    <label className="flex items-center gap-1 text-xs">{t('ppt.inspector.fontSize')}<input aria-label={t('ppt.inspector.fontSize')} className={`${field} w-16`} type="number" min={8} max={96} step="any" placeholder={t('ppt.editor.mixedValues')} disabled={disabled} value={mixed('fontSizePt')?'':value.fontSizePt || 18} onChange={event => set('fontSizePt', Number(event.target.value)||undefined)}/></label>
    <button type="button" aria-label={t('ppt.editor.weightBold')} aria-pressed={mixed('fontWeight')?'mixed':(value.fontWeight || 400) >= 600} className={`${field} font-bold`} disabled={disabled} onClick={() => set('fontWeight', (value.fontWeight || 400) >= 600 ? 400 : 700)}>B</button>
    <button type="button" aria-label={t('ppt.editor.italic')} aria-pressed={mixed('fontStyle')?'mixed':value.fontStyle === 'italic'} className={`${field} italic`} disabled={disabled} onClick={() => set('fontStyle', value.fontStyle === 'italic' ? 'normal' : 'italic')}>I</button>
    <button type="button" aria-label={t('ppt.editor.underline')} aria-pressed={mixed('textDecoration')?'mixed':value.textDecoration === 'underline'} className={`${field} underline`} disabled={disabled} onClick={() => set('textDecoration', value.textDecoration === 'underline' ? 'none' : 'underline')}>U</button>
    <label className="flex items-center gap-1 text-xs">{t('ppt.inspector.alignment')}<select aria-label={t('ppt.inspector.alignment')} className={field} disabled={disabled} value={mixed('textAlign')?'':value.textAlign || 'left'} onChange={event => set('textAlign', event.target.value)}>{mixed('textAlign')&&<option value="">{t('ppt.editor.mixedValues')}</option>}{['left', 'center', 'right'].map(align => <option key={align} value={align}>{t(`ppt.inspector.${align}` as never)}</option>)}</select></label>
    <label className="flex items-center gap-1 text-xs">{t('ppt.editor.lineHeight')}<input aria-label={t('ppt.editor.lineHeight')} className={`${field} w-16`} type="number" min={0.8} max={3} step="any" placeholder={t('ppt.editor.mixedValues')} disabled={disabled} value={mixed('lineHeight')?'':value.lineHeight || 1.2} onChange={event => set('lineHeight', Number(event.target.value)||undefined)}/></label>
    <input aria-label={t('ppt.inspector.color')} type="color" className="h-8 w-9" disabled={disabled} value={value.color || '#111111'} onChange={event => set('color', event.target.value)}/>
    <button type="submit" className={`${field} bg-primary text-primary-foreground disabled:opacity-50`} disabled={disabled || !Object.keys(patch).length}>{t('ppt.inspector.applyStyle')}</button>
  </form>;
}
