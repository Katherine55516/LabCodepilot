'use client';

import { useEffect, useRef } from 'react';
import { Trash, UploadSimple } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { mediaUrl } from '@/lib/decks/client';
import type { Block, MediaItem } from '@/lib/decks/types';
import { cn } from '@/lib/utils';
import { useDecksT } from '../../i18n';
import { UPLOAD_ACCEPT, useMediaUpload } from '../useMediaUpload';
import { Section, Segmented, TextField } from './fields';

type ImageBlock = Extract<Block, { type: 'image' }>;

interface ImageBlockEditorProps {
  deckId: string;
  block: ImageBlock;
  media: MediaItem[];
  onChange: (next: ImageBlock) => void;
  onMediaAdded: (media: MediaItem) => void;
  disabled?: boolean;
}

/** Alt text, caption, fit, and the picture itself: upload a new one or reuse one already in the deck. */
export function ImageBlockEditor({ deckId, block, media, onChange, onMediaAdded, disabled }: ImageBlockEditorProps) {
  const t = useDecksT();
  const fileRef = useRef<HTMLInputElement>(null);
  const { upload, uploading, error } = useMediaUpload(deckId, onMediaAdded);
  // The upload resolves later; apply it to the block as it is then, not as it was when it started.
  const latest = useRef(block);
  useEffect(() => { latest.current = block; }, [block]);

  const setMedia = (mediaId: string | undefined) => {
    const next: ImageBlock = { ...latest.current, ...(mediaId ? { mediaId } : { placeholder: true }) };
    if (mediaId) delete next.placeholder;
    else delete next.mediaId;
    onChange(next);
  };
  const onFile = async (file: File) => {
    const item = await upload(file);
    if (item && latest.current.id === block.id) setMedia(item.id);
  };
  const setOptional = (key: 'caption', value: string) => {
    const next: ImageBlock = { ...block, [key]: value };
    if (!value) delete next[key];
    onChange(next);
  };
  const library = media.slice(-12).reverse();

  return (
    <div className="flex flex-col gap-4">
      <Section title={t('decks.editor.inspector.image')}>
        <div className="overflow-hidden rounded-md border bg-muted/30">
          {block.mediaId
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={mediaUrl(block.mediaId)} alt={block.alt} className={cn('h-36 w-full', block.fit === 'contain' ? 'object-contain' : 'object-cover')} />
            : <p className="grid h-24 place-items-center px-3 text-center text-xs text-muted-foreground">{t('decks.editor.inspector.noImage')}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" disabled={disabled || uploading} onClick={() => fileRef.current?.click()} aria-busy={uploading || undefined}>
            {uploading ? <Spinner className="size-4" /> : <UploadSimple size={16} />}
            {uploading ? t('decks.editor.inspector.uploading') : block.mediaId ? t('decks.editor.inspector.replace') : t('decks.editor.inspector.upload')}
          </Button>
          {block.mediaId && (
            <Button type="button" size="sm" variant="ghost" disabled={disabled || uploading} onClick={() => setMedia(undefined)}>
              <Trash size={16} />{t('decks.editor.inspector.removeImage')}
            </Button>
          )}
          <input ref={fileRef} type="file" accept={UPLOAD_ACCEPT} className="hidden" aria-label={t('decks.editor.inspector.upload')}
            onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void onFile(file); }} />
        </div>
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        {library.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">{t('decks.editor.inspector.library')}</span>
            <div className="grid grid-cols-4 gap-1.5">
              {library.map((item, i) => {
                const active = item.id === block.mediaId;
                return (
                  <button key={item.id} type="button" disabled={disabled || uploading} aria-pressed={active} aria-label={t('decks.editor.inspector.useImage', { n: i + 1 })}
                    onClick={() => setMedia(item.id)}
                    className={cn('aspect-square overflow-hidden rounded border-2 outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
                      active ? 'border-primary' : 'border-transparent hover:border-border')}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={mediaUrl(item.id)} alt="" loading="lazy" className="size-full object-cover" />
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </Section>
      <Segmented
        label={t('decks.editor.inspector.fit')}
        value={block.fit}
        disabled={disabled}
        options={[{ value: 'cover', label: t('decks.editor.inspector.fit.cover') }, { value: 'contain', label: t('decks.editor.inspector.fit.contain') }]}
        onChange={fit => onChange({ ...block, fit })}
      />
      <TextField label={t('decks.editor.inspector.alt')} hint={t('decks.editor.inspector.altHint')} value={block.alt} maxLength={200} disabled={disabled}
        onChange={alt => onChange({ ...block, alt })} />
      <TextField label={t('decks.editor.inspector.caption')} value={block.caption ?? ''} maxLength={200} disabled={disabled}
        onChange={value => setOptional('caption', value)} />
    </div>
  );
}
