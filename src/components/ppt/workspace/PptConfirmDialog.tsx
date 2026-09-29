'use client';

import { useTranslation } from '@/hooks/useTranslation';

export function PptConfirmDialog({ title, message, confirmLabel, dangerous = false, onConfirm, onClose }: {
  title: string; message: string; confirmLabel?: string; dangerous?: boolean; onConfirm: () => void; onClose: () => void;
}) {
  const { t } = useTranslation();
  return <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/55 p-4" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="ppt-confirm-title" className="w-full max-w-md rounded-xl border border-border bg-background p-6 shadow-2xl">
      <h2 id="ppt-confirm-title" className="text-lg font-semibold">{title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{message}</p>
      <div className="mt-6 flex justify-end gap-2"><button className="rounded-lg border border-border px-4 py-2 text-sm" onClick={onClose}>{t('ppt.cancel')}</button><button autoFocus className={`rounded-lg px-4 py-2 text-sm text-white ${dangerous ? 'bg-destructive' : 'bg-primary'}`} onClick={onConfirm}>{confirmLabel || t('ppt.confirm')}</button></div>
    </section>
  </div>;
}
