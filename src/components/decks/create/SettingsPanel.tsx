'use client';

import type { DeckLanguage, ImageSource, TextAmount, TextMode } from '@/lib/decks/types';
import { DECK_LANGUAGES, FORMAT_DIMENSIONS, NUM_CARDS_RANGE } from '@/lib/decks/types';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useTranslation } from '@/hooks/useTranslation';
import { useDecksT } from '../i18n';
import { Field, Segmented } from './controls';
import { DECK_FORMATS, IMAGE_SOURCES, TEXT_AMOUNTS, clampCards, languageName, type SettingsDraft } from './options';

interface SettingsPanelProps {
  value: SettingsDraft;
  onChange: (patch: Partial<SettingsDraft>) => void;
  textMode: TextMode;
  /** One card per `---` section: the card count follows the sections instead. */
  splitByBreaks: boolean;
  sectionCount: number;
}

export function SettingsPanel({ value, onChange, textMode, splitByBreaks, sectionCount }: SettingsPanelProps) {
  const t = useDecksT();
  const { locale } = useTranslation();
  const generateOnly = textMode !== 'generate';
  const amountIgnored = textMode === 'preserve';
  return (
    <div className="flex flex-col gap-5">
      <Field
        label={t('decks.create.numCards')}
        htmlFor="decks-num-cards"
        hint={splitByBreaks ? t('decks.create.numCardsSections', { n: sectionCount }) : t('decks.create.numCardsHint')}
      >
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={NUM_CARDS_RANGE.min}
            max={NUM_CARDS_RANGE.max}
            value={value.numCards}
            disabled={splitByBreaks}
            aria-label={t('decks.create.numCards')}
            onChange={event => onChange({ numCards: clampCards(Number(event.target.value)) })}
            className="h-1.5 min-w-0 flex-1 cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-50"
          />
          <Input
            id="decks-num-cards"
            type="number"
            inputMode="numeric"
            min={NUM_CARDS_RANGE.min}
            max={NUM_CARDS_RANGE.max}
            value={value.numCards}
            disabled={splitByBreaks}
            onChange={event => onChange({ numCards: event.target.value === '' ? NUM_CARDS_RANGE.min : clampCards(Number(event.target.value)) })}
            className="w-20 shrink-0"
          />
        </div>
      </Field>

      <Field label={t('decks.create.format')}>
        <Segmented
          ariaLabel={t('decks.create.format')}
          value={value.format}
          onChange={format => onChange({ format, dimensions: FORMAT_DIMENSIONS[format][0] })}
          options={DECK_FORMATS.map(format => ({ value: format, label: t(`decks.create.format.${format}`) }))}
        />
      </Field>

      <Field label={t('decks.create.dimensions')}>
        <Segmented
          ariaLabel={t('decks.create.dimensions')}
          value={value.dimensions}
          onChange={dimensions => onChange({ dimensions })}
          options={FORMAT_DIMENSIONS[value.format].map(dim => ({ value: dim, label: t(`decks.create.dim.${dim}`) }))}
        />
      </Field>

      <Field label={t('decks.create.amount')} hint={amountIgnored ? t('decks.create.amountIgnored') : undefined}>
        <Segmented<TextAmount>
          ariaLabel={t('decks.create.amount')}
          value={value.amount}
          disabled={amountIgnored}
          onChange={amount => onChange({ amount })}
          options={TEXT_AMOUNTS.map(amount => ({ value: amount, label: t(`decks.create.amount.${amount}`) }))}
        />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
        <Field label={t('decks.create.tone')} htmlFor="decks-tone">
          <Input id="decks-tone" value={value.tone} maxLength={500} disabled={generateOnly} placeholder={t('decks.create.tonePlaceholder')} onChange={event => onChange({ tone: event.target.value })} />
        </Field>
        <Field label={t('decks.create.audience')} htmlFor="decks-audience">
          <Input id="decks-audience" value={value.audience} maxLength={500} disabled={generateOnly} placeholder={t('decks.create.audiencePlaceholder')} onChange={event => onChange({ audience: event.target.value })} />
        </Field>
      </div>
      {generateOnly && <p className="-mt-3 text-xs text-muted-foreground">{t('decks.create.toneIgnored')}</p>}

      <Field label={t('decks.create.language')} htmlFor="decks-language">
        <Select value={value.language} onValueChange={language => onChange({ language: language as DeckLanguage })}>
          <SelectTrigger id="decks-language" className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            {DECK_LANGUAGES.map(code => (
              <SelectItem key={code} value={code}>{code === 'auto' ? t('decks.create.language.auto') : languageName(code, locale)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <ImageSourceField value={value.imageSource} onChange={imageSource => onChange({ imageSource })} />
      {value.imageSource === 'aiGenerated' && (
        <Field label={t('decks.create.imageStyle')} htmlFor="decks-image-style" hint={t('decks.create.imageStyleHint')}>
          <Input id="decks-image-style" value={value.imageStyle} placeholder={t('decks.create.imageStylePlaceholder')} onChange={event => onChange({ imageStyle: event.target.value })} />
        </Field>
      )}

      <Field label={t('decks.create.instructions')} htmlFor="decks-instructions" hint={t('decks.create.instructionsHint')}>
        <Textarea
          id="decks-instructions"
          value={value.additionalInstructions}
          maxLength={5000}
          rows={3}
          className="max-h-48"
          placeholder={t('decks.create.instructionsPlaceholder')}
          onChange={event => onChange({ additionalInstructions: event.target.value })}
        />
      </Field>
    </div>
  );
}

/** Image source select, also used in the outline header. */
export function ImageSourceField({ value, onChange, disabled, id = 'decks-image-source', compact }: { value: ImageSource; onChange: (value: ImageSource) => void; disabled?: boolean; id?: string; compact?: boolean }) {
  const t = useDecksT();
  const select = (
    <Select value={value} disabled={disabled} onValueChange={next => onChange(next as ImageSource)}>
      <SelectTrigger id={id} size={compact ? 'sm' : 'default'} className={compact ? 'w-auto min-w-0' : 'w-full'} aria-label={compact ? t('decks.create.imageSource') : undefined}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {IMAGE_SOURCES.map(source => (
          <SelectItem key={source} value={source}>{t(`decks.create.image.${source}`)}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
  if (compact) return select;
  return <Field label={t('decks.create.imageSource')} htmlFor={id} hint={t(`decks.create.image.${value}.hint`)}>{select}</Field>;
}
