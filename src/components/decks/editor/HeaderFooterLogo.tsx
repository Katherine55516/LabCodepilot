'use client';

import { useRef } from 'react';
import { Trash, UploadSimple } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { mediaUrl } from '@/lib/decks/client';
import type { HeaderFooterSlot } from '@/lib/decks/types';
import { useDecksT } from '../i18n';
import { UPLOAD_ACCEPT } from './useMediaUpload';

export type LogoSize = NonNullable<HeaderFooterSlot['size']>;
const SIZES: LogoSize[] = ['sm', 'md', 'lg', 'xl'];

interface HeaderFooterLogoProps {
  slot: HeaderFooterSlot;
  onChange: (next: HeaderFooterSlot) => void;
  /** Starts an upload; the dialog applies the result to this slot when it arrives. */
  onPickFile: (file: File) => void;
  uploading: boolean;
  /** Another slot is uploading (one upload at a time). */
  blocked: boolean;
  error: string | null;
}

/**
 * Report 05 §6: a logo slot shows an image (here an uploaded file, the
 * `custom` source) at sm / md / lg / xl, and falls back to its text.
 */
export function HeaderFooterLogo({ slot, onChange, onPickFile, uploading, blocked, error }: HeaderFooterLogoProps) {
  const t = useDecksT();
  const fileRef = useRef<HTMLInputElement>(null);
  const removeImage = () => {
    const next: HeaderFooterSlot = { ...slot };
    delete next.mediaId;
    delete next.size;
    onChange(next);
  };
  return (
    <div className="flex flex-col gap-1.5">
      {slot.mediaId && (
        <div className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={mediaUrl(slot.mediaId)} alt={t('decks.editor.hf.logoImage')} className="h-8 max-w-28 rounded border bg-muted/40 object-contain p-0.5" />
          <Button type="button" size="icon-xs" variant="ghost" aria-label={t('decks.editor.hf.removeLogo')} title={t('decks.editor.hf.removeLogo')}
            disabled={uploading} onClick={removeImage} className="text-muted-foreground hover:text-destructive">
            <Trash size={14} />
          </Button>
        </div>
      )}
      <Button type="button" size="xs" variant="outline" className="self-start" disabled={uploading || blocked} aria-busy={uploading || undefined}
        onClick={() => fileRef.current?.click()}>
        {uploading ? <Spinner className="size-3" /> : <UploadSimple size={12} />}
        {uploading ? t('decks.editor.inspector.uploading') : slot.mediaId ? t('decks.editor.hf.replaceLogo') : t('decks.editor.hf.uploadLogo')}
      </Button>
      <input ref={fileRef} type="file" accept={UPLOAD_ACCEPT} className="hidden" aria-label={t('decks.editor.hf.uploadLogo')}
        onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) onPickFile(file); }} />
      {slot.mediaId && (
        <Select value={slot.size ?? 'md'} onValueChange={size => onChange({ ...slot, size: size as LogoSize })}>
          <SelectTrigger size="sm" className="w-full" aria-label={t('decks.editor.hf.logoSize')}><SelectValue /></SelectTrigger>
          <SelectContent>
            {SIZES.map(size => <SelectItem key={size} value={size}>{t(`decks.editor.hf.size.${size}`)}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      {!error && slot.mediaId && <p className="text-xs text-muted-foreground">{t('decks.editor.hf.logoFallback')}</p>}
    </div>
  );
}
