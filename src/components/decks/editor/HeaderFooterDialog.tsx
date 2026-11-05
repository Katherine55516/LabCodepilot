'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import type { HeaderFooter, HeaderFooterSlot, MediaItem } from '@/lib/decks/types';
import { useDecksT, type DecksStringKey } from '../i18n';
import { HeaderFooterLogo } from './HeaderFooterLogo';
import { useMediaUpload } from './useMediaUpload';

type SlotKey = 'topLeft' | 'topCenter' | 'topRight' | 'bottomLeft' | 'bottomCenter' | 'bottomRight';
const SLOTS: SlotKey[] = ['topLeft', 'topCenter', 'topRight', 'bottomLeft', 'bottomCenter', 'bottomRight'];
type SlotChoice = 'none' | HeaderFooterSlot['type'];

interface HeaderFooterDialogProps {
  deckId: string;
  /** A logo upload joins the deck's media list. */
  onMediaAdded?: (media: MediaItem) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: HeaderFooter;
  onSave: (next: HeaderFooter) => void;
}

/** Six slots (report 05 §6): text / card number / logo (uploaded image at sm–xl, else text), plus hide on first / last card. */
export function HeaderFooterDialog({ deckId, onMediaAdded, open, onOpenChange, value, onSave }: HeaderFooterDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        {/* Remount the form on every open so it starts from the saved value. */}
        {open && <HeaderFooterForm deckId={deckId} onMediaAdded={onMediaAdded} value={value} onCancel={() => onOpenChange(false)} onSave={next => { onSave(next); onOpenChange(false); }} />}
      </DialogContent>
    </Dialog>
  );
}

interface FormProps { deckId: string; onMediaAdded?: (media: MediaItem) => void; value: HeaderFooter; onCancel: () => void; onSave: (next: HeaderFooter) => void }

function HeaderFooterForm({ deckId, onMediaAdded, value, onCancel, onSave }: FormProps) {
  const t = useDecksT();
  const [draft, setDraft] = useState<HeaderFooter>(value);
  const setSlot = (key: SlotKey, slot: HeaderFooterSlot | undefined) => setDraft(d => ({ ...d, [key]: slot }));
  const { upload, uploading, error } = useMediaUpload(deckId, onMediaAdded);
  const [uploadKey, setUploadKey] = useState<SlotKey | null>(null);
  const pickLogo = async (key: SlotKey, file: File) => {
    setUploadKey(key);
    const media = await upload(file);
    if (!media) return;
    // Apply to the slot as it is now; skip it if the slot stopped being a logo meanwhile.
    setDraft(d => {
      const slot = d[key];
      return slot?.type === 'logo' ? { ...d, [key]: { ...slot, mediaId: media.id, size: slot.size ?? 'md' } } : d;
    });
  };
  const choose = (key: SlotKey, v: string, slot: HeaderFooterSlot | undefined) => {
    if (v === 'none') return setSlot(key, undefined);
    const type = v as HeaderFooterSlot['type'];
    const keep = type === 'logo' && slot?.mediaId ? { mediaId: slot.mediaId, size: slot.size } : {};
    setSlot(key, { type, value: type === 'cardNumber' ? undefined : slot?.value, ...keep });
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('decks.editor.headerFooter')}</DialogTitle>
        <DialogDescription>{t('decks.editor.hf.description')}</DialogDescription>
      </DialogHeader>
      <div className="grid gap-3 sm:grid-cols-3">
        {SLOTS.map(key => {
          const slot = draft[key];
          const choice: SlotChoice = slot?.type ?? 'none';
          return (
            <div key={key} className="flex flex-col gap-1.5 rounded-md border p-2.5">
              <Label className="text-xs text-muted-foreground">{t(`decks.editor.hf.${key}` as DecksStringKey)}</Label>
              <Select value={choice} onValueChange={v => choose(key, v, slot)}>
                <SelectTrigger size="sm" className="w-full" aria-label={t(`decks.editor.hf.${key}` as DecksStringKey)}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('decks.editor.hf.none')}</SelectItem>
                  <SelectItem value="text">{t('decks.editor.hf.text')}</SelectItem>
                  <SelectItem value="cardNumber">{t('decks.editor.hf.cardNumber')}</SelectItem>
                  <SelectItem value="logo">{t('decks.editor.hf.logo')}</SelectItem>
                </SelectContent>
              </Select>
              {(choice === 'text' || choice === 'logo') && slot && (
                <Input
                  className="h-8"
                  value={slot.value ?? ''}
                  maxLength={500}
                  onChange={e => setSlot(key, { ...slot, value: e.target.value })}
                  placeholder={choice === 'logo' ? t('decks.editor.hf.logoPlaceholder') : t('decks.editor.hf.textPlaceholder')}
                  aria-label={t('decks.editor.hf.value')}
                />
              )}
              {choice === 'logo' && slot && (
                <HeaderFooterLogo slot={slot} onChange={next => setSlot(key, next)} onPickFile={file => { void pickLogo(key, file); }}
                  uploading={uploading && uploadKey === key} blocked={uploading && uploadKey !== key} error={uploadKey === key ? error : null} />
              )}
            </div>
          );
        })}
      </div>
      <div className="flex flex-col gap-2">
        <Label className="flex items-center justify-between gap-3 font-normal">
          {t('decks.editor.hf.hideFirst')}
          <Switch checked={!!draft.hideFromFirstCard} onCheckedChange={v => setDraft(d => ({ ...d, hideFromFirstCard: v }))} />
        </Label>
        <Label className="flex items-center justify-between gap-3 font-normal">
          {t('decks.editor.hf.hideLast')}
          <Switch checked={!!draft.hideFromLastCard} onCheckedChange={v => setDraft(d => ({ ...d, hideFromLastCard: v }))} />
        </Label>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>{t('decks.cancel')}</Button>
        <Button onClick={() => onSave(draft)} disabled={uploading}>{t('decks.save')}</Button>
      </DialogFooter>
    </>
  );
}
