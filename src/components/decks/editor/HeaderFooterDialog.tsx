'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import type { HeaderFooter, HeaderFooterSlot } from '@/lib/decks/types';
import { useDecksT, type DecksStringKey } from '../i18n';

type SlotKey = 'topLeft' | 'topCenter' | 'topRight' | 'bottomLeft' | 'bottomCenter' | 'bottomRight';
const SLOTS: SlotKey[] = ['topLeft', 'topCenter', 'topRight', 'bottomLeft', 'bottomCenter', 'bottomRight'];
type SlotChoice = 'none' | HeaderFooterSlot['type'];

interface HeaderFooterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: HeaderFooter;
  onSave: (next: HeaderFooter) => void;
}

/** Six slots (report 04 §6.1): text / card number / logo, plus hide on first / last card. */
export function HeaderFooterDialog({ open, onOpenChange, value, onSave }: HeaderFooterDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        {/* Remount the form on every open so it starts from the saved value. */}
        {open && <HeaderFooterForm value={value} onCancel={() => onOpenChange(false)} onSave={next => { onSave(next); onOpenChange(false); }} />}
      </DialogContent>
    </Dialog>
  );
}

function HeaderFooterForm({ value, onCancel, onSave }: { value: HeaderFooter; onCancel: () => void; onSave: (next: HeaderFooter) => void }) {
  const t = useDecksT();
  const [draft, setDraft] = useState<HeaderFooter>(value);
  const setSlot = (key: SlotKey, slot: HeaderFooterSlot | undefined) => setDraft(d => ({ ...d, [key]: slot }));

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
              <Select value={choice} onValueChange={v => setSlot(key, v === 'none' ? undefined : { type: v as HeaderFooterSlot['type'], value: v === 'cardNumber' ? undefined : slot?.value })}>
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
        <Button onClick={() => onSave(draft)}>{t('decks.save')}</Button>
      </DialogFooter>
    </>
  );
}
