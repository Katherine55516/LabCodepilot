'use client';

import type { KeyboardEvent, ReactNode } from 'react';
import { ClipboardText, FileArrowUp, Sparkle } from '@phosphor-icons/react';
import type { TextMode } from '@/lib/decks/types';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useDecksT } from '../i18n';
import { Segmented } from './controls';
import { PASTE_MODES } from './options';

export type InputTab = 'generate' | 'paste' | 'import';
/** Gamma-style input limit (report 03 §1.5: ~400,000 chars). */
export const INPUT_MAX = 400_000;

interface InputPanelProps {
  tab: InputTab;
  onTabChange: (tab: InputTab) => void;
  prompt: string;
  onPromptChange: (value: string) => void;
  pasted: string;
  onPastedChange: (value: string) => void;
  pasteMode: TextMode;
  onPasteModeChange: (mode: TextMode) => void;
  splitByBreaks: boolean;
  onSplitChange: (value: boolean) => void;
  sectionCount: number;
  /** Ctrl/Cmd+Enter submits. */
  onSubmitShortcut: () => void;
  /** Content of the Import tab (ImportPanel). */
  importContent: ReactNode;
}

export function InputPanel(props: InputPanelProps) {
  const t = useDecksT();
  const { tab, onTabChange, pasteMode, sectionCount } = props;
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); props.onSubmitShortcut(); }
  };
  return (
    <Tabs value={tab} onValueChange={value => onTabChange(value as InputTab)} className="gap-3">
      <TabsList className="w-full sm:w-fit">
        <TabsTrigger value="generate"><Sparkle aria-hidden />{t('decks.create.tab.generate')}</TabsTrigger>
        <TabsTrigger value="paste"><ClipboardText aria-hidden />{t('decks.create.tab.paste')}</TabsTrigger>
        <TabsTrigger value="import"><FileArrowUp aria-hidden />{t('decks.create.tab.import')}</TabsTrigger>
      </TabsList>

      <TabsContent value="generate" className="flex flex-col gap-2">
        <Label htmlFor="decks-prompt" className="sr-only">{t('decks.create.promptLabel')}</Label>
        <Textarea
          id="decks-prompt"
          autoFocus
          value={props.prompt}
          maxLength={INPUT_MAX}
          rows={4}
          onKeyDown={onKeyDown}
          onChange={event => props.onPromptChange(event.target.value)}
          placeholder={t('decks.create.promptPlaceholder')}
          className="min-h-28 max-h-72 text-base"
        />
        <p className="text-xs text-muted-foreground">{t('decks.create.promptHint')}</p>
      </TabsContent>

      <TabsContent value="paste" className="flex flex-col gap-3">
        <Label htmlFor="decks-paste" className="sr-only">{t('decks.create.pasteLabel')}</Label>
        <Textarea
          id="decks-paste"
          value={props.pasted}
          maxLength={INPUT_MAX}
          rows={10}
          onKeyDown={onKeyDown}
          onChange={event => props.onPastedChange(event.target.value)}
          placeholder={t('decks.create.pastePlaceholder')}
          className="min-h-56 max-h-[28rem] font-mono text-sm"
        />
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>{t('decks.create.breakHint')}</span>
          <span className="tabular-nums">{t('decks.create.chars', { n: props.pasted.length.toLocaleString() })}</span>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">{t('decks.create.textMode')}</span>
          <Segmented<TextMode>
            ariaLabel={t('decks.create.textMode')}
            value={pasteMode}
            onChange={props.onPasteModeChange}
            options={PASTE_MODES.map(mode => ({ value: mode, label: t(`decks.create.mode.${mode}`) }))}
          />
          <p className="text-xs text-muted-foreground">{t(`decks.create.mode.${pasteMode}.hint`)}</p>
        </div>

        <div className="flex items-start gap-3 rounded-lg border border-border/60 p-3">
          <Switch id="decks-split" checked={props.splitByBreaks} onCheckedChange={props.onSplitChange} className="mt-0.5" />
          <div className="flex min-w-0 flex-col gap-1">
            <Label htmlFor="decks-split">{t('decks.create.splitLabel')}</Label>
            <p className="text-xs text-muted-foreground">
              {sectionCount > 1 ? t('decks.create.splitDetected', { n: sectionCount }) : t('decks.create.splitNone')}
            </p>
          </div>
        </div>
      </TabsContent>

      <TabsContent value="import">{props.importContent}</TabsContent>
    </Tabs>
  );
}
