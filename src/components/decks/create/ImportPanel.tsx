'use client';

import { useState, type DragEvent } from 'react';
import { ArrowsClockwise, Copy, FileArrowUp, FilePpt, FileText, Scissors, X } from '@phosphor-icons/react';
import type { ImportIntent } from '@/lib/decks/types';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useDecksT } from '../i18n';
import { RadioCards } from './controls';
import { IMPORT_ACCEPT, IMPORT_INTENT_OPTIONS, formatBytes, importFileProblem } from './options';

const INTENT_ICONS: Record<ImportIntent, typeof Copy> = { asIs: Copy, restyle: ArrowsClockwise, condense: Scissors };
const INPUT_ID = 'decks-import-file';

interface ImportPanelProps {
  file: File | null;
  onFileChange: (file: File | null) => void;
  intent: ImportIntent;
  onIntentChange: (intent: ImportIntent) => void;
}

/**
 * Import input (report 06 §5): pick or drop a file, then say what should
 * happen with it (Gamma's prompt-directed import as three explicit choices).
 * The drop zone is the file input's label, so it opens the picker on click,
 * and the (visually hidden) input stays focusable for keyboard users.
 */
export function ImportPanel({ file, onFileChange, intent, onIntentChange }: ImportPanelProps) {
  const t = useDecksT();
  const [dragging, setDragging] = useState(false);
  const [problem, setProblem] = useState<'badType' | 'tooLarge' | null>(null);

  const accept = (candidate: File | undefined) => {
    if (!candidate) return;
    const issue = importFileProblem(candidate);
    setProblem(issue);
    onFileChange(issue ? null : candidate);
  };
  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragging(false);
    accept(event.dataTransfer.files[0]);
  };
  const onDragOver = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    if (!dragging) setDragging(true);
  };
  const isSlides = file ? /\.(pptx|potx)$/i.test(file.name) : false;
  const FileIcon = isSlides ? FilePpt : FileText;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={INPUT_ID}
          onDragOver={onDragOver}
          onDragEnter={onDragOver}
          onDragLeave={event => { if (!(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) setDragging(false); }}
          onDrop={onDrop}
          className={cn(
            'flex min-h-36 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors',
            'has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50',
            dragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/60 hover:bg-muted/40',
          )}
        >
          <input
            id={INPUT_ID}
            type="file"
            accept={IMPORT_ACCEPT.join(',')}
            aria-label={t('decks.create.import.file')}
            aria-describedby="decks-import-types"
            className="sr-only"
            onChange={event => { accept(event.target.files?.[0]); event.target.value = ''; }}
          />
          <FileArrowUp aria-hidden className="size-8 text-muted-foreground" />
          <span className="text-sm font-medium">
            {dragging ? t('decks.create.import.dropActive') : file ? t('decks.create.import.change') : t('decks.create.import.drop')}
          </span>
          <span id="decks-import-types" className="max-w-md text-xs text-muted-foreground">{t('decks.create.import.types')}</span>
        </label>

        {problem && <p role="alert" className="text-xs text-destructive">{t(`decks.create.import.${problem}`)}</p>}

        {file && (
          <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
            <FileIcon aria-hidden className="size-5 shrink-0 text-muted-foreground" />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-medium" title={file.name}>{file.name}</span>
              <span className="text-xs tabular-nums text-muted-foreground">{formatBytes(file.size)}</span>
            </div>
            <Button type="button" variant="ghost" size="icon-sm" aria-label={t('decks.create.import.remove')} onClick={() => { onFileChange(null); setProblem(null); }}>
              <X />
            </Button>
          </div>
        )}
      </div>

      <RadioCards<ImportIntent>
        name="decks-import-intent"
        legend={t('decks.create.import.intent')}
        value={intent}
        onChange={onIntentChange}
        options={IMPORT_INTENT_OPTIONS.map(value => {
          const Icon = INTENT_ICONS[value];
          return {
            value,
            icon: <Icon className="size-4" />,
            label: t(`decks.create.import.intent.${value}`),
            description: t(`decks.create.import.intent.${value}.hint`),
          };
        })}
      />
    </div>
  );
}
