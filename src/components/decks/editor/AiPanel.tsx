'use client';

import { useEffect, useRef, useState } from 'react';
import { PaperPlaneRight, Sparkle } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { ErrorBanner } from '@/components/ui/error-banner';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { decksApi } from '@/lib/decks/client';
import type { Block, Card, CardDimensions, CardStage, DeckJob, DeckTheme, EditProposal } from '@/lib/decks/types';
import { useDecksT, type DecksStringKey } from '../i18n';
import { AiScope, effectiveScope } from './AiScope';
import { ProposalCompare } from './ProposalCompare';
import type { AiScopeKind, RunAction } from './types';

const QUICK_ACTIONS = ['improve', 'shorter', 'longer', 'simplify', 'visual', 'grammar', 'translate'] as const;
const STAGE_ORDER: CardStage[] = ['writing', 'imaging', 'checking', 'polishing', 'queued'];

interface AiPanelProps {
  deckId: string;
  deckTitle: string;
  cards: Card[];
  card: Card | undefined;
  cardIndex: number;
  block: Block | undefined;
  scopeKind: AiScopeKind;
  onScopeKind: (kind: AiScopeKind) => void;
  job: DeckJob | undefined;
  proposals: EditProposal[];
  theme: DeckTheme;
  dimensions: CardDimensions;
  runAction: RunAction;
  busy: string | null;
  refresh: () => void;
  /** Changes whenever another control asks to focus the instruction box. */
  focusToken: number;
}

const isActive = (job: DeckJob | undefined) => !!job && (job.status === 'pending' || job.status === 'running');

export function AiPanel(props: AiPanelProps) {
  const t = useDecksT();
  const { job, proposals, refresh } = props;
  const [instruction, setInstruction] = useState('');
  const [startedJobId, setStartedJobId] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editRunning = isActive(job) && job?.kind === 'edit';
  const buildRunning = isActive(job) && job?.kind !== 'edit';
  const proposal = proposals.filter(p => p.status === 'proposed').sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const scope = effectiveScope(props.scopeKind, props.card, props.block);

  useEffect(() => { if (props.focusToken) textareaRef.current?.focus(); }, [props.focusToken]);
  // The live stream carries { deck, job }; fetch proposals once our edit job finishes.
  // `refresh` is a new function each render, so it is read through a ref.
  const refreshRef = useRef(refresh);
  useEffect(() => { refreshRef.current = refresh; });
  const finished = job?.kind === 'edit' && job.status === 'completed' ? job.id : null;
  useEffect(() => { if (finished) refreshRef.current(); }, [finished]);

  const submit = async (text: string) => {
    const value = text.trim();
    if (!value || props.busy !== null) return;
    if (buildRunning) {
      // Report 06 §3.4: instructions sent during generation queue and run afterwards.
      const ok = await props.runAction('ai-queue', async () => ({ job: (await decksApi.queueInstruction(props.deckId, value)).job }));
      if (ok) setInstruction('');
      return;
    }
    const ok = await props.runAction('ai-edit', async () => {
      const { job: started } = await decksApi.aiEdit(props.deckId, { scope, instruction: value });
      setStartedJobId(started.id);
      return { job: started };
    });
    if (ok) setInstruction('');
  };

  const quick = (key: typeof QUICK_ACTIONS[number]) => {
    if (key === 'translate') {
      setInstruction(t('decks.editor.ai.q.translatePrefill'));
      requestAnimationFrame(() => { const el = textareaRef.current; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } });
      return;
    }
    void submit(t(`decks.editor.ai.qi.${key}` as DecksStringKey));
  };

  const decide = (action: 'apply' | 'discard') => proposal && props.runAction(action, async () => {
    const { deck } = action === 'apply'
      ? await decksApi.applyProposal(props.deckId, proposal.id)
      : await decksApi.discardProposal(props.deckId, proposal.id);
    return { deck, proposals: proposals.map(p => (p.id === proposal.id ? { ...p, status: action === 'apply' ? 'applied' : 'discarded' } : p)) };
  });

  const stage = job && STAGE_ORDER.find(s => (job.progress.stages[s] ?? 0) > 0);
  const failed = job?.kind === 'edit' && job.status === 'failed' && job.id === startedJobId ? job.error || t('decks.error') : null;
  const locked = editRunning || !!proposal;

  return (
    <div className="flex flex-col gap-4">
      <AiScope kind={props.scopeKind} onKind={props.onScopeKind} deckTitle={props.deckTitle} card={props.card} cardIndex={props.cardIndex} block={props.block} disabled={locked} />

      {!proposal && (
        <form className="flex flex-col gap-2" onSubmit={e => { e.preventDefault(); void submit(instruction); }}>
          <Textarea
            ref={textareaRef}
            value={instruction}
            onChange={e => setInstruction(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void submit(instruction); }
              if (e.key === 'Escape') setInstruction('');
            }}
            placeholder={t('decks.editor.ai.placeholder')}
            aria-label={t('decks.editor.ai.placeholder')}
            disabled={editRunning}
            className="min-h-24 resize-y text-sm"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground">{buildRunning ? t('decks.editor.ai.queueHint') : t('decks.editor.ai.enterHint')}</span>
            <Button type="submit" size="sm" disabled={!instruction.trim() || editRunning || props.busy !== null}>
              {props.busy === 'ai-edit' || props.busy === 'ai-queue' ? <Spinner className="size-4" /> : <PaperPlaneRight size={16} />}
              {buildRunning ? t('decks.editor.ai.queue') : t('decks.editor.ai.send')}
            </Button>
          </div>
        </form>
      )}

      {!proposal && (
        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-medium text-muted-foreground">{t('decks.editor.ai.quick')}</h3>
          <div className="flex flex-wrap gap-1.5">
            {QUICK_ACTIONS.map(key => (
              <Button key={key} size="xs" variant="outline" disabled={editRunning || props.busy !== null} onClick={() => quick(key)}>
                {t(`decks.editor.ai.q.${key}` as DecksStringKey)}
              </Button>
            ))}
          </div>
        </section>
      )}

      {editRunning && job && (
        <div className="flex flex-col gap-1.5 rounded-md border p-3" role="status" aria-live="polite">
          <div className="flex items-center gap-2 text-sm"><Sparkle size={16} className="animate-pulse text-primary" />
            {stage ? t(`decks.stage.${stage}` as DecksStringKey) : t('decks.editor.ai.editing')}
            <span className="ml-auto text-xs tabular-nums text-muted-foreground">{job.progress.percent}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${Math.max(4, job.progress.percent)}%` }} />
          </div>
        </div>
      )}

      {buildRunning && job && job.queuedInstructions.length > 0 && (
        <ul className="flex flex-col gap-1 text-xs">
          {job.queuedInstructions.map(q => (
            <li key={q.id} className="flex items-center gap-2 rounded border px-2 py-1">
              <span className="min-w-0 flex-1 truncate">{q.text}</span>
              <span className="shrink-0 text-muted-foreground">{t(`decks.editor.ai.queued.${q.status}` as DecksStringKey)}</span>
            </li>
          ))}
        </ul>
      )}

      {failed && <ErrorBanner message={t('decks.editor.ai.failed')} description={failed} onDismiss={() => setStartedJobId(null)} />}

      {proposal && (
        <ProposalCompare proposal={proposal} deckCards={props.cards} theme={props.theme} dimensions={props.dimensions} busy={props.busy}
          onApply={() => { void decide('apply'); }} onDiscard={() => { void decide('discard'); }} />
      )}
    </div>
  );
}
