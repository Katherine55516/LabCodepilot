'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { FilePdf, Flask, PresentationChart } from '@phosphor-icons/react';
import { ArrowSquareOut, Play } from '@/components/ui/icon';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { ErrorBanner } from '@/components/ui/error-banner';
import { Switch } from '@/components/ui/switch';
import { CardView } from '@/components/decks/CardView';
import { useDecksT } from '@/components/decks/i18n';
import { TEXT_AMOUNTS } from '@/components/decks/create/options';
import { mediaUrl, useDeckLive } from '@/lib/decks/client';
import { deckTheme } from '@/lib/decks/themes';
import type { DeckTheme, TextAmount } from '@/lib/decks/types';

/**
 * Decks Lab: upload a long source (and optionally a template), inspect the
 * parse — chunks with card budgets, figures with kind/series/home chunk,
 * the template's theme, artwork, logo and rhythm — then generate with a
 * chosen model and read every card's media decision.
 */

interface SourceView {
  uploadId: string; fileName: string; title: string; authors?: string; pages?: number; targetCards: number; defaultTarget: number;
  blocks: { headings: number; paragraphs: number; tables: number; figures: number };
  chunks: { id: string; path: string[]; title: string; kind: string; chars: number; cardBudget: number; pages?: [number, number]; figureIds: string[]; refFigureIds: string[]; preview: string }[];
  figures: { id: string; label: string; caption: string; kind?: string; series?: string; chunkId?: string; width?: number; height?: number; traits: string; url: string | null }[];
  dropped: { label: string; chars: number }[];
  droppedSamples: { label: string; text: string; page: number }[];
  warnings: string[];
}
interface TemplateView {
  uploadId: string; fileName: string; slides: number; theme: DeckTheme; rhythm: string[]; notes: string[];
  images: { index: number; role: string; share: number; width?: number; height?: number; url: string }[];
  logo: { slot: string; slides: number; url: string } | null;
  components: { id: string; slide: number; kind: string; units: number; numbered: boolean; hasBody: boolean; imageSlots: number; fixed: boolean; titles: string[] }[];
}
interface ModelsView {
  providers: { id: string; name: string; protocol: string; baseHost: string; hasKey: boolean; models: string[] }[];
  defaultProviderId: string | null;
  env: { available: boolean; baseHost: string; model: string; extraModels: string[] };
  configured?: { name: string; models: string[] };
}

async function json<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || res.statusText);
  return data as T;
}

export default function DecksLabPage() {
  const t = useDecksT();
  const [models, setModels] = useState<ModelsView | null>(null);
  const [modelRef, setModelRef] = useState('');
  const [source, setSource] = useState<SourceView | null>(null);
  const [template, setTemplate] = useState<TemplateView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState(12);
  const [express, setExpress] = useState(true);
  const [amount, setAmount] = useState<TextAmount>('medium');
  const [deckId, setDeckId] = useState<string | null>(null);

  const loadModels = useCallback(async (configure = false) => {
    try {
      const data = await json<ModelsView>(await fetch('/api/decks/lab/models', { method: configure ? 'POST' : 'GET' }));
      setModels(data);
      const preferred = data.providers.find(p => p.name === 'Decks Lab (env)') || data.providers.find(p => p.id === data.defaultProviderId && p.hasKey);
      if (preferred?.models[0]) setModelRef(r => r || `${preferred.id}::${preferred.models[0]}`);
      if (configure) setModelRef(`${data.providers.find(p => p.name === 'Decks Lab (env)')?.id}::${data.configured?.models[0] || ''}`);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { void loadModels(); }, [loadModels]);

  const upload = async (file: File, kind: 'source' | 'template') => {
    setBusy(t('decks.lab.analyzing', { name: file.name }));
    setError(null);
    try {
      const q = new URLSearchParams({ kind, fileName: file.name });
      const data = await json<SourceView | TemplateView>(await fetch(`/api/decks/lab/analyze?${q}`, { method: 'POST', body: file, headers: { 'content-type': 'application/octet-stream' } }));
      if (kind === 'source') { const s = data as SourceView; setSource(s); setTarget(s.targetCards); } else setTemplate(data as TemplateView);
      setDeckId(null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  const rechunkTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const changeTarget = (n: number) => {
    setTarget(n);
    if (!source) return;
    clearTimeout(rechunkTimer.current);
    rechunkTimer.current = setTimeout(async () => {
      try { setSource(await json<SourceView>(await fetch('/api/decks/lab/rechunk', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ uploadId: source.uploadId, targetCards: n }) }))); }
      catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    }, 250);
  };

  const run = async () => {
    if (!source) { setError(t('decks.lab.needSource')); return; }
    setBusy(t('decks.lab.running'));
    setError(null);
    try {
      const [providerId, model] = modelRef ? modelRef.split('::') : ['', ''];
      const res = await json<{ deck: { id: string } }>(await fetch('/api/decks/lab/run', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sourceUploadId: source.uploadId, templateUploadId: template?.uploadId, targetCards: target, settings: { mode: express ? 'express' : 'plan', amount }, ...(providerId && model ? { model: { providerId, model } } : {}) }),
      }));
      setDeckId(res.deck.id);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  const hasRealModel = Boolean(models?.providers.some(p => p.hasKey && p.models.length));

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
        <header className="space-y-1">
          <h1 className="flex items-center gap-2 text-xl font-semibold"><Flask size={22} />{t('decks.lab.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('decks.lab.subtitle')}</p>
        </header>

        {error && <ErrorBanner message={error} />}

        {/* Model */}
        <section className="rounded-lg border p-4 space-y-3" aria-label={t('decks.lab.model')}>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium">{t('decks.lab.model')}</span>
            <select aria-label={t('decks.lab.model')} className="h-9 min-w-[16rem] rounded-md border bg-background px-2 text-sm" value={modelRef} onChange={e => setModelRef(e.target.value)}>
              <option value="">{t('decks.lab.model.default')}</option>
              {models?.providers.filter(p => p.hasKey).map(p => p.models.map(m => <option key={`${p.id}::${m}`} value={`${p.id}::${m}`}>{p.name} · {m}</option>))}
            </select>
            {models?.env.available && (
              <Button size="sm" variant="outline" onClick={() => void loadModels(true)}>{t('decks.lab.model.env', { host: models.env.baseHost || 'Anthropic', model: models.env.model })}</Button>
            )}
            <Link href="/settings" className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:underline">{t('decks.lab.model.settings')}<ArrowSquareOut size={14} /></Link>
          </div>
          {models?.configured && <p className="text-sm text-emerald-600">{t('decks.lab.model.envDone', { name: models.configured.name, models: models.configured.models.join(', ') })}</p>}
          {models && !hasRealModel && <p className="text-sm text-amber-600">{t('decks.lab.model.none')}</p>}
        </section>

        {/* Uploads */}
        <div className="grid gap-4 md:grid-cols-2">
          <UploadPanel icon={<FilePdf size={20} />} title={t('decks.lab.source')} hint={t('decks.lab.source.hint')} accept=".pdf,.md,.markdown,.txt" label={t('decks.lab.choose')} fileName={source?.fileName} onFile={f => void upload(f, 'source')} testId="lab-source" />
          <UploadPanel icon={<PresentationChart size={20} />} title={t('decks.lab.template')} hint={t('decks.lab.template.hint')} accept=".pptx,.potx" label={t('decks.lab.choose')} fileName={template?.fileName} onFile={f => void upload(f, 'template')} testId="lab-template" />
        </div>
        {busy && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner className="size-4" />{busy}</p>}

        {source && <SourcePanel source={source} target={target} onTarget={changeTarget} />}
        {template && <TemplatePanel template={template} />}

        {/* Run */}
        {source && (
          <section className="flex flex-wrap items-center gap-4 rounded-lg border p-4">
            <label className="flex items-center gap-2 text-sm"><Switch checked={express} onCheckedChange={setExpress} aria-label={t('decks.lab.express')} />{t('decks.lab.express')}</label>
            <label className="flex items-center gap-2 text-sm">{t('decks.lab.amount')}
              <select className="h-9 rounded-md border bg-background px-2 text-sm" value={amount} onChange={e => setAmount(e.target.value as TextAmount)}>
                {TEXT_AMOUNTS.map(a => <option key={a} value={a}>{t(`decks.create.amount.${a}` as Parameters<typeof t>[0])}</option>)}
              </select>
            </label>
            <Button onClick={() => void run()} disabled={Boolean(busy)}><Play size={16} />{t('decks.lab.run')}</Button>
          </section>
        )}

        {deckId && <ResultPanel deckId={deckId} />}
      </div>
    </div>
  );
}

function UploadPanel(props: { icon: React.ReactNode; title: string; hint: string; accept: string; label: string; fileName?: string; onFile: (f: File) => void; testId: string }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <section className="rounded-lg border p-4 space-y-2" data-testid={props.testId}>
      <h2 className="flex items-center gap-2 font-medium">{props.icon}{props.title}</h2>
      <p className="text-xs text-muted-foreground">{props.hint}</p>
      <div className="flex items-center gap-3">
        <Button size="sm" variant="outline" onClick={() => ref.current?.click()}>{props.label}</Button>
        {props.fileName && <span className="truncate text-sm">{props.fileName}</span>}
      </div>
      <input ref={ref} type="file" accept={props.accept} className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) props.onFile(f); e.target.value = ''; }} />
    </section>
  );
}

const KIND_TONE: Record<string, string> = { front: 'bg-sky-500/15 text-sky-700 dark:text-sky-300', body: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300', appendix: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-300' };

function SourcePanel({ source, target, onTarget }: { source: SourceView; target: number; onTarget: (n: number) => void }) {
  const t = useDecksT();
  const maxChars = Math.max(...source.chunks.map(c => c.chars), 1);
  const figById = useMemo(() => new Map(source.figures.map(f => [f.id, f])), [source.figures]);
  return (
    <section className="space-y-4 rounded-lg border p-4" aria-label={t('decks.lab.source')}>
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">{source.title}</h2>
        {source.authors && <p className="text-sm text-muted-foreground">{source.authors}</p>}
        <p className="text-sm text-muted-foreground">{t('decks.lab.stats', { pages: source.pages ?? '–', headings: source.blocks.headings, paragraphs: source.blocks.paragraphs, tables: source.blocks.tables, figures: source.blocks.figures })}</p>
        {source.warnings.map(w => <p key={w} className="text-sm text-amber-600">{w}</p>)}
      </div>
      {source.dropped.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer">{t('decks.lab.dropped')}: {source.dropped.map(d => `${d.label} (${d.chars.toLocaleString()})`).join(' · ')}</summary>
          <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs text-muted-foreground">
            {source.droppedSamples.map((d, i) => <li key={i}><Badge variant="outline" className="mr-2">{d.label} · p{d.page}</Badge>{d.text}</li>)}
          </ul>
        </details>
      )}
      <label className="flex items-center gap-3 text-sm">
        {t('decks.lab.target')}
        <input type="range" min={4} max={30} value={target} onChange={e => onTarget(Number(e.target.value))} className="w-48" aria-label={t('decks.lab.target')} />
        <span className="tabular-nums font-medium">{target}</span>
      </label>
      <div>
        <h3 className="mb-2 font-medium">{t('decks.lab.chunks', { n: source.chunks.length })}</h3>
        <ol className="space-y-2">
          {source.chunks.map(c => (
            <li key={c.id} className="rounded-md border p-2 text-sm" data-chunk={c.id}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs font-semibold">{c.id}</span>
                <span className={`rounded px-1.5 py-0.5 text-xs ${KIND_TONE[c.kind] || ''}`}>{c.kind}</span>
                <span className="min-w-0 flex-1 truncate">{c.path.length ? c.path.join(' › ') : c.title}</span>
                <span className="text-xs text-muted-foreground">p{c.pages?.join('–')}</span>
                <Badge variant={c.cardBudget ? 'secondary' : 'outline'}>{t('decks.lab.chunk.cards', { n: c.cardBudget })}</Badge>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <div className="h-1.5 flex-1 rounded bg-muted"><div className="h-1.5 rounded bg-primary/60" style={{ width: `${(c.chars / maxChars) * 100}%` }} /></div>
                <span className="w-16 text-right text-xs tabular-nums text-muted-foreground">{c.chars.toLocaleString()}</span>
              </div>
              {(c.figureIds.length > 0 || c.refFigureIds.length > 0) && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {c.figureIds.map(id => figById.get(id)).map(f => f && <FigureChip key={f.id} f={f} />)}
                  {c.refFigureIds.map(id => <span key={id} className="text-xs text-muted-foreground">↗ {id}</span>)}
                </div>
              )}
              <details className="mt-1"><summary className="cursor-pointer text-xs text-muted-foreground">{c.preview.slice(0, 120)}…</summary><p className="mt-1 whitespace-pre-wrap text-xs">{c.preview}…</p></details>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function FigureChip({ f }: { f: SourceView['figures'][number] }) {
  const t = useDecksT();
  return (
    <figure className="w-36 rounded border bg-white p-1 text-[11px] text-zinc-700" title={f.caption}>
      {f.url ? <img src={f.url} alt={f.caption} className="h-20 w-full object-contain" /> : <div className="grid h-20 place-items-center text-zinc-400">{f.label}</div>}
      <figcaption className="mt-1 leading-tight"><b>{f.id}</b> · {f.traits}{f.chunkId ? ` · ${t('decks.lab.figure.home', { chunk: f.chunkId })}` : ''}</figcaption>
    </figure>
  );
}

function TemplatePanel({ template }: { template: TemplateView }) {
  const t = useDecksT();
  const c = template.theme.colors;
  return (
    <section className="space-y-3 rounded-lg border p-4" aria-label={t('decks.lab.theme')}>
      <h2 className="font-medium">{t('decks.lab.theme')} · {template.fileName}</h2>
      <div className="flex flex-wrap gap-3">
        {Object.entries(c).map(([k, v]) => (
          <div key={k} className="flex items-center gap-2 text-xs"><span className="size-6 rounded border" style={{ background: v }} />{k} <code>{v}</code></div>
        ))}
      </div>
      <p className="text-sm"><span className="font-medium">{t('decks.lab.fonts')}:</span> <span style={{ fontFamily: template.theme.fonts.heading }}>{template.theme.fonts.heading.split(',')[0]}</span> / <span style={{ fontFamily: template.theme.fonts.body }}>{template.theme.fonts.body.split(',')[0]}</span></p>
      <p className="flex flex-wrap items-center gap-1 text-sm"><span className="font-medium">{t('decks.lab.rhythm')}:</span>{template.rhythm.map((r, i) => <Badge key={i} variant="outline">{i + 1}·{r}</Badge>)}</p>
      <div>
        <h3 className="mb-2 text-sm font-medium">{t('decks.lab.art', { n: template.images.length })}</h3>
        <div className="flex flex-wrap gap-2">
          {template.images.map(img => (
            <figure key={img.index} className="w-32 text-[11px]"><img src={img.url} alt="" className="h-20 w-full rounded object-cover" /><figcaption>{img.role} · {Math.round(img.share * 100)}% · {img.width}×{img.height}</figcaption></figure>
          ))}
          {template.logo && <figure className="w-40 text-[11px]"><img src={template.logo.url} alt="logo" className="h-20 w-full rounded border bg-white object-contain p-2" /><figcaption>{t('decks.lab.logo', { slot: template.logo.slot })}</figcaption></figure>}
        </div>
      </div>
      {template.components.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-medium">{t('decks.lab.components', { n: template.components.length })}</h3>
          <ul className="grid gap-1 text-xs sm:grid-cols-2" data-testid="lab-components">
            {template.components.map(c => (
              <li key={c.id} className="rounded border px-2 py-1">
                <b className="font-mono">{c.id}</b> · {t('decks.lab.component.line', { slide: c.slide, kind: c.kind, n: c.units })}{c.numbered ? ' · #' : ''}{c.hasBody ? ' · +text' : ''}{c.imageSlots ? ` · 🖼×${c.imageSlots}` : ''}{c.fixed ? ` · ${t('decks.lab.component.fixed')}` : ''}
                <div className="truncate text-muted-foreground">{c.titles.join(' / ')}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
      <details className="text-sm"><summary className="cursor-pointer">{t('decks.lab.notes')}</summary><ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">{template.notes.map(n => <li key={n}>{n}</li>)}</ul></details>
    </section>
  );
}

function ResultPanel({ deckId }: { deckId: string }) {
  const t = useDecksT();
  const { data } = useDeckLive(deckId);
  if (!data) return <p className="flex items-center gap-2 text-sm"><Spinner className="size-4" /></p>;
  const { deck, job } = data;
  const theme = deckTheme(deck);
  const figures = deck.sourceDoc?.figures || [];
  const label = (id: string) => figures.find(f => f.id === id)?.label || id;
  const placed = new Set(deck.cards.flatMap(c => c.media?.figuresPlaced || []));
  const unused = figures.filter(f => f.mediaId && !placed.has(f.id)).map(f => f.id);
  const templateIds = new Set(deck.template?.accentMediaIds || []);
  const withArt = deck.cards.filter(c => (c.layout.accentMediaId && templateIds.has(c.layout.accentMediaId)) || c.layout.band).length;
  const withBand = deck.cards.filter(c => c.layout.band).length;
  const withFigures = deck.cards.filter(c => c.media?.figuresPlaced.length).length;
  return (
    <section className="space-y-4 rounded-lg border p-4" aria-label={t('decks.lab.result')} data-testid="lab-result">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-semibold">{t('decks.lab.result')}: {deck.title}</h2>
        <Badge>{t(`decks.status.${deck.status}` as Parameters<typeof t>[0])}</Badge>
        {job && job.status === 'running' && <span className="text-sm text-muted-foreground">{job.progress.percent}%</span>}
        {deck.modelLabel && <span className="text-xs text-muted-foreground">{t('decks.lab.writtenBy', { model: deck.modelLabel })}</span>}
        <Link href={`/decks/${deck.id}`} className="ml-auto inline-flex items-center gap-1 text-sm underline-offset-4 hover:underline">{deck.status === 'outline_ready' ? t('decks.lab.openOutline') : t('decks.lab.openDeck')}<ArrowSquareOut size={14} /></Link>
      </div>
      {deck.warnings.map(w => <p key={w.code + w.message} className="text-sm text-amber-600">{w.message}</p>)}
      {deck.outline.length > 0 && (
        <details open={deck.cards.length === 0}>
          <summary className="cursor-pointer text-sm font-medium">{t('decks.lab.outline')}</summary>
          <ol className="mt-2 space-y-1 text-sm">
            {deck.outline.map((c, i) => <li key={c.id}><span className="tabular-nums text-muted-foreground">{i + 1}.</span> {c.title} <span className="font-mono text-xs text-muted-foreground">[{(c.sourceIds || []).join(', ')}] {(c.figureIds || []).join(', ')}</span></li>)}
          </ol>
        </details>
      )}
      {deck.cards.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium">{t('decks.lab.cards')}</h3>
          {deck.template && <p className="text-xs" data-testid="lab-coverage">{t('decks.lab.coverage', { n: withArt, total: deck.cards.length, bands: withBand, figs: withFigures })}</p>}
          {unused.length > 0 && <p className="text-xs text-muted-foreground">{t('decks.lab.unused', { list: unused.join(', ') })}</p>}
          {deck.cards.map((card, i) => (
            <div key={card.id} className="grid gap-3 rounded-md border p-2 md:grid-cols-[320px_1fr]" data-card-index={i}>
              <CardView card={card} theme={theme} dimensions={deck.settings.dimensions} mediaUrl={mediaUrl} width={320} pending={card.stage !== 'done' && card.stage !== 'failed'} headerFooter={deck.headerFooter} cardNumber={i + 1} cardCount={deck.cards.length} deckTitle={deck.title} />
              <dl className="grid grid-cols-[7rem_1fr] gap-x-2 gap-y-1 text-xs">
                <dt className="text-muted-foreground">{t('decks.lab.col.card')}</dt><dd>{i + 1} · {card.stage}</dd>
                <dt className="text-muted-foreground">{t('decks.lab.col.sources')}</dt><dd className="font-mono">{(card.sourceIds || []).join(', ') || '–'}</dd>
                <dt className="text-muted-foreground">{t('decks.lab.col.figures')}</dt>
                <dd>{card.media ? <>{card.media.figuresPlaced.map(label).join(', ') || '–'}{card.media.figuresDeferred.length > 0 && <span className="text-amber-600"> · ✕ {card.media.figuresDeferred.map(label).join(', ')}</span>}</> : '–'}</dd>
                <dt className="text-muted-foreground">{t('decks.lab.col.fill')}</dt><dd className="tabular-nums">{card.media ? `${Math.round(card.media.fill * 100)}%` : '–'}</dd>
                <dt className="text-muted-foreground">{t('decks.lab.col.rule')}</dt><dd>{card.media?.rule || '–'}</dd>
                {card.issues?.map((issue, k) => <Fragment key={k}><dt className="text-amber-600">{issue.code}</dt><dd className="text-amber-600">{issue.message}</dd></Fragment>)}
              </dl>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
