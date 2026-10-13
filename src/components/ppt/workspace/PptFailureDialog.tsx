'use client';
import {createPortal} from 'react-dom';
import {useTranslation} from '@/hooks/useTranslation';
import {pptFailureMessage} from '@/lib/ppt-error';
export function PptFailureDialog({message,onClose,onReviewOutline}:{message:string;onClose:()=>void;onReviewOutline?:()=>void}){
 const {t,locale}=useTranslation();
 return createPortal(<div onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();onClose();}}} className="fixed inset-0 z-[110] flex items-center justify-center bg-black/55 p-4">
  <section role="alertdialog" aria-modal="true" aria-labelledby="ppt-failure-title" aria-describedby="ppt-failure-reason"
   className="w-full max-w-lg space-y-4 rounded-xl border border-border bg-background p-6 shadow-xl">
   <h2 id="ppt-failure-title" className="text-lg font-semibold">{t('ppt.failure.title')}</h2>
   <p id="ppt-failure-reason" className="whitespace-pre-wrap break-words text-sm">{pptFailureMessage(message,locale)}</p>
   <div className="flex justify-end gap-2">{onReviewOutline&&<button className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-accent" onClick={onReviewOutline}>{t('ppt.failure.reviewOutline')}</button>}<button autoFocus className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-accent"
    onClick={onClose}>{t('ppt.failure.dismiss')}</button></div>
  </section>
 </div>,document.body);
}
