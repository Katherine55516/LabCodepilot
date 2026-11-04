'use client';
import { useTranslation } from '@/hooks/useTranslation';

/** Show measured node evidence without guessing that every overflow is a title. */
export function PptCapacityDetails({details}:{details:unknown}){
 const {t}=useTranslation();
 if(!details||typeof details!=='object')return null;
 const d=details as Record<string,unknown>;
 if(!['render_text_contract','source_component_contract'].includes(String(d.measurement))||d.units!=='emu'||!d.bounds||typeof d.bounds!=='object')return null;
 const b=d.bounds as Record<string,unknown>;
 const frame=['width','height'].map(k=>typeof b[k]==='number'?(b[k]/914400).toFixed(2):'?').join(' × ');
 const title=d.nodeRole==='title'||d.nodeRole==='template-title';
 return <p className="mt-1 text-muted-foreground" data-testid="ppt-capacity-details">
  {t('ppt.capacity.role')}: {t(title?'ppt.capacity.title':'ppt.capacity.body')} · {t('ppt.capacity.page')}: {typeof d.pageIndex==='number'?d.pageIndex+1:'?'} · {t('ppt.capacity.font')}: {typeof d.fontSizePt==='number'?d.fontSizePt:'?'} pt · {t('ppt.capacity.frame')}: {frame} in
 </p>;
}
