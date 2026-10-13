'use client';

import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';
import type { PptProject, PptSlide } from '../types';
import {PptCanvas,RichText} from '../canvas/PptCanvas';

export type PptDraft = NonNullable<PptProject['drafts']>[string];

/** A page that is not render-ready yet (V-P0-2/V-P0-3): the planned title,
 * section and key points in the template colours, the real sub-stage, and —
 * while the writer streams — a draft layer marked as not yet validated. The
 * skeleton is never an editable or exportable object. */
export function GenerationSkeleton({ project, slide, index, stage, draft }: { project: PptProject; slide?: PptSlide; index: number; stage: string; draft?: PptDraft }) {
  const { t } = useTranslation();
  const palette = project.templateSpec?.palette;
  const planned = (slide?.keyPoints || []).map(point => point.text).filter(Boolean).slice(0, 3);
  const title = draft?.title || slide?.title || '';
    const live = stage === 'writing' && Boolean(draft);
  const scene=slide&&project.generationSkeletons?.[slide.id];
  if(scene)return <section data-testid="ppt-generation-skeleton" data-stage={stage} aria-busy={stage!=='ready'} className="mb-3 overflow-hidden rounded-lg border border-border">
    <p className="bg-background px-3 py-1 text-xs">{index+1} · {t(`ppt.stage.${stage}` as TranslationKey)}{live&&draft?.chars?` · ${t('ppt.skeleton.chars').replace('{n}',String(draft.chars))}`:''}</p>
    {live&&<div data-testid="ppt-generation-draft" aria-live="polite" className="max-h-40 space-y-2 overflow-auto border-b border-border bg-background p-3 text-sm"><p className="sticky top-0 bg-background text-xs text-muted-foreground">{t('ppt.skeleton.draft')}</p>{draft?.blocks?.map((block,i)=>block.type==='CodeBlock'?<pre key={i} className="overflow-x-auto whitespace-pre-wrap font-mono">{block.text}</pre>:<p key={i}>{block.richText?<RichText value={block.richText}/>:block.text}</p>)}{draft?.typing&&<span aria-hidden className="inline-block h-4 w-0.5 animate-pulse bg-current"/>}</div>}
    <div data-testid="ppt-template-skeleton" className="pointer-events-none"><PptCanvas slide={scene} readOnly selectedIds={[]} onSelect={()=>{}} onSelectMany={()=>{}} onGeometry={()=>{}} onRotation={()=>{}} onContent={()=>{}} onAction={()=>{}}/></div>
  </section>;
  return (
    <div data-testid="ppt-generation-skeleton" data-stage={stage} aria-busy={stage !== 'ready'}
      className="relative mb-3 aspect-video w-full overflow-hidden rounded-lg border border-border p-[5%]"
      style={{ background: palette?.background || 'var(--background)', color: palette?.foreground || 'var(--foreground)' }}>
      <span className="absolute right-3 top-3 rounded-full border border-current/20 bg-background/70 px-2 py-0.5 text-[11px] text-foreground">
        {index + 1} · {t(`ppt.stage.${stage}` as TranslationKey)}{live && draft?.chars ? ` · ${t('ppt.skeleton.chars').replace('{n}', String(draft.chars))}` : ''}
      </span>
      {slide?.section && <p className="text-xs uppercase tracking-wider" style={{ color: palette?.muted }}>{slide.section}</p>}
      <h3 className="mt-2 text-xl font-semibold md:text-3xl">{title}</h3>
      {live ? (
        <div className="mt-5 space-y-3 text-sm md:text-base" data-testid="ppt-generation-draft">
          <p className="text-[11px] opacity-60">{t('ppt.skeleton.draft')}</p>
          {draft?.blocks?.map((block,i)=>block.type==='CodeBlock'?<pre key={i} className="whitespace-pre-wrap font-mono">{block.text}</pre>:<p key={i} className="opacity-80">{block.richText?<RichText value={block.richText}/>:block.text}</p>)}
          {draft?.typing && <p className="opacity-80">{draft.typing}<span className="ml-0.5 inline-block h-[1em] w-0.5 animate-pulse bg-current align-[-2px]" /></p>}
        </div>
      ) : (
        <div className="mt-5 space-y-3">
          {slide?.focus && <p className="text-sm opacity-70 md:text-base">{slide.focus}</p>}
          {planned.length ? <><p className="text-[11px] opacity-50">{t('ppt.skeleton.planned')}</p>{planned.map((text, i) => <p key={i} className="text-sm opacity-50">• {text}</p>)}</>
            : [72, 88, 64].map(width => <div key={width} className="h-3 animate-pulse rounded bg-current opacity-10" style={{ width: `${width}%` }} />)}
        </div>
      )}
    </div>
  );
}
