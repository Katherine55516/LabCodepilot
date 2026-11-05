'use client';

import { useRef, useState } from 'react';
import { ArrowsClockwise, Link as LinkIcon, TextAlignCenter, TextAlignLeft, Trash, UploadSimple } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { decksApi, mediaUrl } from '@/lib/decks/client';
import type { AccentPosition, Card, CardDimensions, CardLayout, DeckTheme } from '@/lib/decks/types';
import { cn } from '@/lib/utils';
import { CardView } from '../CardView';
import { useDecksT, type DecksStringKey } from '../i18n';
import type { RunAction } from './types';

const POSITIONS: AccentPosition[] = ['none', 'left', 'right', 'top', 'background'];

interface LayoutPanelProps {
  deckId: string;
  card: Card;
  theme: DeckTheme;
  dimensions: CardDimensions;
  onLayout: (layout: CardLayout) => void;
  runAction: RunAction;
  busy: string | null;
}

/**
 * Standard layouts as live previews of this card (report 04 §2.2: same
 * content, different accent position), accent image actions and alignment.
 */
export function LayoutPanel({ deckId, card, theme, dimensions, onLayout, runAction, busy }: LayoutPanelProps) {
  const t = useDecksT();
  const [url, setUrl] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const layout = card.layout;
  const hasAccent = layout.accent !== 'none';
  const accentAction = (key: string, body: Parameters<typeof decksApi.accent>[2]) =>
    runAction(key, async () => ({ deck: (await decksApi.accent(deckId, card.id, body)).deck }));

  const applyUrl = () => runAction('accent-url', async () => {
    const { media } = await decksApi.addMediaFromUrl(deckId, url.trim());
    const { deck } = await decksApi.accent(deckId, card.id, { action: 'set', mediaId: media.id, position: hasAccent ? layout.accent : 'right' });
    setUrl('');
    return { deck, media };
  });
  const upload = (file: File) => runAction('accent-upload', async () => {
    const { media } = await decksApi.uploadMedia(deckId, file);
    const { deck } = await decksApi.accent(deckId, card.id, { action: 'set', mediaId: media.id, position: hasAccent ? layout.accent : 'right' });
    return { deck, media };
  });
  const spin = (key: string) => busy === key ? <Spinner className="size-4" /> : null;

  return (
    <div className="flex flex-col gap-5">
      <section>
        <h3 className="mb-2 text-xs font-medium text-muted-foreground">{t('decks.editor.layout.accent')}</h3>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t('decks.editor.layout.accent')}>
          {POSITIONS.map(position => {
            const active = layout.accent === position;
            return (
              <button
                key={position}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onLayout({ ...layout, accent: position })}
                className={cn('flex flex-col gap-1 rounded-md border-2 p-1 text-left text-xs transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  active ? 'border-primary' : 'border-transparent hover:border-border')}
              >
                <div className="pointer-events-none max-h-24 overflow-hidden rounded">
                  <CardView card={{ ...card, layout: { ...layout, accent: position } }} theme={theme} dimensions={dimensions} mediaUrl={mediaUrl} width={128} />
                </div>
                <span className={active ? 'font-medium' : 'text-muted-foreground'}>{t(`decks.editor.accent.${position}` as DecksStringKey)}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-medium text-muted-foreground">{t('decks.editor.layout.image')}</h3>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => { void accentAction('accent-regen', { action: 'regenerate', position: hasAccent ? layout.accent : 'right' }); }}>
            {spin('accent-regen') ?? <ArrowsClockwise size={16} />}{t('decks.editor.layout.newImage')}
          </Button>
          <Button size="sm" variant="outline" disabled={busy !== null || (!hasAccent && !layout.accentMediaId)} onClick={() => { void accentAction('accent-clear', { action: 'clear' }); }}>
            {spin('accent-clear') ?? <Trash size={16} />}{t('decks.editor.layout.removeImage')}
          </Button>
          <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => fileRef.current?.click()}>
            {spin('accent-upload') ?? <UploadSimple size={16} />}{t('decks.editor.layout.upload')}
          </Button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" aria-label={t('decks.editor.layout.upload')}
            onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void upload(file); }} />
        </div>
        <form className="flex gap-2" onSubmit={e => { e.preventDefault(); if (url.trim()) void applyUrl(); }}>
          <Input value={url} onChange={e => setUrl(e.target.value)} type="url" inputMode="url" placeholder="https://…" aria-label={t('decks.editor.layout.imageUrl')} className="h-8" />
          <Button size="sm" type="submit" variant="secondary" disabled={busy !== null || !/^https?:\/\/\S+$/.test(url.trim())}>
            {spin('accent-url') ?? <LinkIcon size={16} />}{t('decks.editor.layout.useUrl')}
          </Button>
        </form>
        <p className="text-xs text-muted-foreground">{hasAccent ? t('decks.editor.layout.imageHint') : t('decks.editor.layout.noAccentHint')}</p>
      </section>

      <section>
        <h3 className="mb-2 text-xs font-medium text-muted-foreground">{t('decks.editor.layout.align')}</h3>
        <div className="inline-flex rounded-md border p-0.5" role="radiogroup" aria-label={t('decks.editor.layout.align')}>
          {(['left', 'center'] as const).map(align => (
            <Button key={align} size="sm" variant={layout.align === align ? 'secondary' : 'ghost'} role="radio" aria-checked={layout.align === align}
              onClick={() => onLayout({ ...layout, align })}>
              {align === 'left' ? <TextAlignLeft size={16} /> : <TextAlignCenter size={16} />}
              {t(`decks.editor.align.${align}` as DecksStringKey)}
            </Button>
          ))}
        </div>
      </section>
    </div>
  );
}
