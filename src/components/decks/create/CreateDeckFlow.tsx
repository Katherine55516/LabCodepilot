'use client';

import { useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, FileArrowUp, Lightning, ListChecks, Sparkle } from '@phosphor-icons/react';
import type { GenerationSettings, ImportIntent, TextMode } from '@/lib/decks/types';
import { decksApi } from '@/lib/decks/client';
import { getTheme } from '@/lib/decks/themes';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { ErrorBanner } from '@/components/ui/error-banner';
import { useDecksT } from '../i18n';
import { ThemePicker } from '../ThemePicker';
import { Field, RadioCards } from './controls';
import { ImportPanel } from './ImportPanel';
import { InputPanel, type InputTab } from './InputPanel';
import { SettingsPanel } from './SettingsPanel';
import { DEFAULT_DRAFT, buildSettings, countSections, errorMessage, type SettingsDraft } from './options';

type FlowMode = NonNullable<GenerationSettings['mode']>;

/**
 * Intake + settings (report 02 §5.1 "Intake", report 03 §1–2). Submitting
 * creates the deck (or imports a file, report 06 §5) and starts the outline
 * job; the deck page then shows the plan streaming in. In Express mode
 * (report 02 §3) the engine starts the build as soon as the outline is ready.
 */
export function CreateDeckFlow() {
  const t = useDecksT();
  const router = useRouter();
  const [tab, setTab] = useState<InputTab>('generate');
  const [prompt, setPrompt] = useState('');
  const [pasted, setPasted] = useState('');
  const [pasteMode, setPasteMode] = useState<TextMode>('condense');
  const [splitByBreaks, setSplitByBreaks] = useState(false);
  const [title, setTitle] = useState('');
  const [draft, setDraft] = useState<SettingsDraft>(DEFAULT_DRAFT);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importIntent, setImportIntent] = useState<ImportIntent>('asIs');
  const [mode, setMode] = useState<FlowMode>('plan');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPaste = tab === 'paste';
  const isImport = tab === 'import';
  const textMode: TextMode = isPaste ? pasteMode : 'generate';
  const inputText = (isPaste ? pasted : prompt).trim();
  const sectionCount = useMemo(() => countSections(pasted), [pasted]);
  const split = isPaste && splitByBreaks;
  const canSubmit = (isImport ? Boolean(importFile) : inputText.length > 0) && !submitting;
  const submitLabel = mode === 'express' ? t('decks.create.submitExpress') : isImport ? t('decks.create.submitImport') : t('decks.create.submit');

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const { deck } = isImport && importFile
        ? await decksApi.importFile(importFile, { intent: importIntent, themeId: draft.themeId, mode })
        : await decksApi.create({
          settings: { ...buildSettings(draft, { inputText, textMode, splitByBreaks: split }), mode },
          title: title.trim() || undefined,
          source: { kind: isPaste ? 'paste' : 'prompt' },
        });
      router.push(`/decks/${deck.id}`);
    } catch (e) {
      setError(errorMessage(e));
      setSubmitting(false);
    }
  };
  const onSubmit = (event: FormEvent) => { event.preventDefault(); void submit(); };

  return (
    <form onSubmit={onSubmit} className="flex h-full flex-col overflow-hidden">
      <header className="flex shrink-0 items-center gap-2 border-b border-border/50 px-4 py-3 sm:px-6">
        <Button asChild variant="ghost" size="icon-sm" aria-label={t('decks.create.back')}>
          <Link href="/decks"><ArrowLeft /></Link>
        </Button>
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold">{t('decks.create.title')}</h1>
          <p className="truncate text-xs text-muted-foreground">{t('decks.create.subtitle')}</p>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-5 sm:px-6 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="flex min-w-0 flex-col gap-6">
            <section className="rounded-xl border border-border/60 bg-card p-4">
              <InputPanel
                tab={tab}
                onTabChange={setTab}
                prompt={prompt}
                onPromptChange={setPrompt}
                pasted={pasted}
                onPastedChange={setPasted}
                pasteMode={pasteMode}
                onPasteModeChange={setPasteMode}
                splitByBreaks={splitByBreaks}
                onSplitChange={setSplitByBreaks}
                sectionCount={sectionCount}
                onSubmitShortcut={() => void submit()}
                importContent={<ImportPanel file={importFile} onFileChange={setImportFile} intent={importIntent} onIntentChange={setImportIntent} />}
              />
              {!isImport && (
                <Field label={t('decks.create.deckTitle')} htmlFor="decks-title" className="mt-4">
                  <Input id="decks-title" value={title} maxLength={500} placeholder={t('decks.create.deckTitlePlaceholder')} onChange={event => setTitle(event.target.value)} />
                </Field>
              )}
            </section>

            <section aria-labelledby="decks-theme-heading" className="flex flex-col gap-3">
              <div className="flex items-baseline justify-between gap-2">
                <h2 id="decks-theme-heading" className="text-sm font-semibold">{t('decks.theme.label')}</h2>
                <span className="text-xs text-muted-foreground">{getTheme(draft.themeId).name}</span>
              </div>
              <ThemePicker value={draft.themeId} onChange={themeId => setDraft(d => ({ ...d, themeId }))} />
            </section>
          </div>

          <aside aria-label={t('decks.create.settings')} className="flex min-w-0 flex-col gap-3 lg:sticky lg:top-0 lg:self-start">
            <h2 className="text-sm font-semibold">{t('decks.create.settings')}</h2>
            <div className="rounded-xl border border-border/60 bg-card p-4">
              <RadioCards<FlowMode>
                name="decks-flow-mode"
                legend={t('decks.create.flow')}
                value={mode}
                onChange={setMode}
                options={[
                  { value: 'plan', icon: <ListChecks className="size-4" />, label: t('decks.create.flow.plan'), description: t('decks.create.flow.plan.hint') },
                  { value: 'express', icon: <Lightning className="size-4" />, label: t('decks.create.flow.express'), description: t('decks.create.flow.express.hint') },
                ]}
              />
            </div>
            <div className="rounded-xl border border-border/60 bg-card p-4">
              {isImport ? (
                <p className="text-sm text-muted-foreground">{t('decks.create.import.settingsNote')}</p>
              ) : (
                <SettingsPanel
                  value={draft}
                  onChange={patch => setDraft(d => ({ ...d, ...patch }))}
                  textMode={textMode}
                  splitByBreaks={split}
                  sectionCount={sectionCount}
                />
              )}
            </div>
          </aside>
        </div>
      </div>

      <footer className="flex shrink-0 flex-col gap-2 border-t border-border/50 bg-background px-4 py-3 sm:flex-row sm:items-center sm:justify-end sm:px-6">
        {error && <ErrorBanner message={t('decks.create.failed')} description={error} onDismiss={() => setError(null)} className="sm:mr-auto sm:max-w-xl" />}
        <span className="hidden text-xs text-muted-foreground sm:inline">{t('decks.create.shortcut')}</span>
        <Button type="submit" disabled={!canSubmit} className="w-full sm:w-auto">
          {submitting ? <Spinner /> : isImport ? <FileArrowUp weight="fill" aria-hidden /> : <Sparkle weight="fill" aria-hidden />}
          {submitting ? t('decks.create.submitting') : submitLabel}
        </Button>
      </footer>
    </form>
  );
}
