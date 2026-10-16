'use client';

import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';
import type { PptProject, PptSlide } from '../types';
import {RichText} from '../canvas/PptCanvas';

export type PptDraft = NonNullable<PptProject['drafts']>[string];

/** The page being written (Gamma page by page, round 7 A2/A7): first its
 * structure and title, then each point streams in (short heading, then body)
 * until the validated page replaces it. The draft layer grows with its text —
 * it never clips — and is never an editable or exportable object. */
export function GenerationSkeleton({ project, slide, index, stage, draft }: { project: PptProject; slide?: PptSlide; index: number; stage: string; draft?: PptDraft }) {
  const { t } = useTranslation();
  const palette = project.templateSpec?.palette;
  const title = draft?.title || slide?.title || '';
  const live = Boolean(draft && (draft.blocks?.length || draft.typing || draft.title));
  const scene = slide && project.generationSkeletons?.[slide.id];
  const badge = <span className="inline-flex items-center gap-1 rounded-full border border-current/20 bg-background/80 px-2 py-0.5 text-[11px] text-foreground" data-testid="ppt-ai-generating">
    ✦ {t('ppt.generation.aiGenerating')} · {index + 1} · {t(`ppt.stage.${stage}` as TranslationKey)}{live && draft?.chars ? ` · ${t('ppt.skeleton.chars').replace('{n}', String(draft.chars))}` : ''}
  </span>;
  const points = <div className="space-y-3 text-sm md:text-base" data-testid="ppt-generation-draft" aria-live="polite">
    {draft?.blocks?.map((block, i) => block.type === 'CodeBlock'
      ? <pre key={i} className="whitespace-pre-wrap break-words font-mono text-xs">{block.text}</pre>
      : <div key={i} data-testid="ppt-draft-point" className="rounded-md border border-current/15 p-3">
        {block.heading && <p className="mb-1 font-semibold">{block.heading}</p>}
        <p className="whitespace-pre-wrap break-words opacity-90">{block.richText ? <RichText value={block.richText}/> : block.text}</p>
      </div>)}
    {draft?.typing && <p className="whitespace-pre-wrap break-words opacity-80">{draft.typing}<span className="ml-0.5 inline-block h-[1em] w-0.5 animate-pulse bg-current align-[-2px]" /></p>}
    {!live && [72, 88, 64].map(width => <div key={width} className="h-3 animate-pulse rounded bg-current opacity-10" style={{ width: `${width}%` }} />)}
  </div>;
  // A draft is one growing page, including when a native template is present.
  // Rendering the full template first and putting live copy underneath it made
  // an empty slide appear above the actual writing (and kept report artwork in
  // the reading path). Use its palette/fonts until the validated native scene
  // replaces this transient flow layout.
  return (
    <div data-testid="ppt-generation-skeleton" data-stage={stage} aria-busy={stage !== 'ready'}
      className="relative mb-3 w-full rounded-lg border border-border p-[5%]"
      data-template-draft={scene ? 'true' : undefined}
      style={{ aspectRatio: '16 / 9', background: scene?.background || palette?.background || 'var(--background)', color: palette?.foreground || 'var(--foreground)', fontFamily: project.templateSpec?.fonts?.body }}>
      <div className="mb-3 flex justify-end">{badge}</div>
      {slide?.section && <p className="text-xs uppercase tracking-wider" style={{ color: palette?.muted }}>{slide.section}</p>}
      <h3 className="mt-2 break-words text-xl font-semibold md:text-3xl" style={{fontFamily:project.templateSpec?.fonts?.title}}>{title}</h3>
      {!live && slide?.focus && <p className="mt-3 text-sm opacity-70 md:text-base">{slide.focus}</p>}
      <div className="mt-5">{points}</div>
      {slide && project.generationMedia?.[slide.id]?.map(media => <figure key={media.id} className="mx-auto mt-5" style={{width:'min(100%, 22rem)'}}>
        <div data-testid="ppt-draft-media" role="img" aria-label={media.caption || t('ppt.skeleton.media')} className="grid place-items-center rounded-md border border-current/20 bg-current/5 text-sm opacity-70" style={{aspectRatio:`${media.width} / ${media.height}`}}>{t('ppt.skeleton.media')}</div>
        {media.caption && <figcaption className="mt-2 break-words text-sm opacity-80">{media.caption}</figcaption>}
      </figure>)}
    </div>
  );
}
