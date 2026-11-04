"use client";
import { pptFailureMessage } from "@/lib/ppt-error";
import {currentGenerationDraft,generationPageStage,generationPageStarted} from '@/lib/ppt-generation-view';
/* eslint-disable @next/next/no-img-element -- SVG previews are authenticated PPT routes and cannot use the Next image optimizer. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import {usePptTemplateFonts} from "../usePptTemplateFonts";
import {PptSelect} from "../PptSelect";
import {textareaSelectionRect} from "./selection-anchor";
import {SelectionAiComposer} from "./SelectionAiComposer";
import { PptCanvas } from "../canvas/PptCanvas";
import { AiBeforeAfterPreview } from "./AiBeforeAfterPreview";
import {AiCandidateControls} from "./AiCandidateControls";
import {AiVersionHistory} from "./AiVersionHistory";
import { PptHistory } from "../history/PptHistory";
import {PptExecutionPanel} from './PptExecutionPanel';
import {PptMediaRetirements} from '../workspace/PptMediaRetirements';
import { PptTextToolbar,editableTextIds } from "./PptTextToolbar";
import { PptInspector } from "../inspector/PptInspector";
import { prepareImage } from "../PptBlocks";
import { GenerationSkeleton, type PptDraft } from "../generation/GenerationSkeleton";
import { inlineListItems } from "@/lib/ppt-inline-list";
import { PptCommandQueue, isRevisionConflict, type OptimisticPatch, type QueueError } from "@/lib/ppt-command-queue";
import type { TranslationKey } from "@/i18n";
import type {
  PptAiProposal, PptMutationType,
  PptBounds,
  PptRenderElement,
  PptRenderSlide,
  PptReviewAdvisory,
  StructuredProjectView,
} from "../types";

// Flagged page problems an AI edit can fix (kept with pageFlagFixable in review-advisories.mjs).
const PAGE_FLAG_FIXABLE = new Set(['rendered_title_capacity','title_overflow','planned_native_title_overflow','template_cjk_title_frame_capacity','render_overflow','template_slot_overflow','card_page_capacity','typography_capacity','point_layout_capacity','source_artifact_capacity','component_label_capacity','table_cell_capacity','export_page_visibility']);
const DECK_STAGES = new Set(["outlining", "writing", "reviewing", "repairing", "publishing"]);
const button =
  "rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent disabled:opacity-50";
const primary =
  "rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50";
const field =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm";
const layouts = [
  "cover",
  "summary",
  "editorial",
  "big-number",
  "comparison",
  "chart",
  "table",
  "image-text",
  "timeline",
  "two-panel",
  "formula-variables",
  "item-icons",
  "conclusion",
];
type Tool =
  | "search"
  | "format"
  | "image"
  | "layout"
  | "shape"
  | "chart"
  | "table"
  | "ai"
  | "theme"
  | "arrange"
  | null;
function PublishBlockedList({ blockers, onPage, onClose }: { blockers: PublishBlockers; onPage: (page: number) => void; onClose?: () => void }) {
  const { t } = useTranslation();
  return <section role="alert" data-testid="ppt-publish-blocked" className="space-y-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-foreground">
    <div className="flex items-start justify-between gap-3"><p className="font-medium text-destructive">{t("ppt.editor.publishBlockedTitle").replace("{count}", String(blockers.issues.length))}</p>
      {onClose && <button type="button" className="text-xs underline" onClick={onClose}>{t("ppt.editor.publishBlockedClose")}</button>}</div>
    <ul className="max-h-48 space-y-1 overflow-y-auto">{blockers.issues.map((issue, k) => <li key={k} className="flex gap-2">
      {issue.page ? <button type="button" data-testid="ppt-publish-blocked-page" className="shrink-0 underline" onClick={() => onPage(issue.page!)}>{t("ppt.editor.publishBlockedPage").replace("{page}", String(issue.page))}</button>
        : <span className="shrink-0 text-muted-foreground">{t("ppt.editor.publishBlockedDeck")}</span>}
      <span className="break-words">{issue.message}</span></li>)}</ul>
    {blockers.warnings > 0 && <p className="text-xs text-muted-foreground">{t("ppt.editor.publishWarnings").replace("{count}", String(blockers.warnings))}</p>}
    {blockers.fallbacks.length > 0 && <ul className="space-y-1 text-xs text-muted-foreground">{blockers.fallbacks.map((issue, k) => <li key={k} className="flex gap-2">
      {issue.page && <button type="button" className="shrink-0 underline" onClick={() => onPage(issue.page!)}>{t("ppt.editor.publishBlockedPage").replace("{page}", String(issue.page))}</button>}<span>{issue.message}</span></li>)}</ul>}
  </section>;
}
type PublishBlockers = { issues: { message: string; page: number | null }[]; warnings: number; fallbacks: { message: string; page: number | null }[] };
type ReviewIssue = { severity?: string; message?: string; code?: string; slideId?: string | null; pageIndex?: number };
/** The error-level findings that blocked a publish, with their page numbers
 * (an export-verification failure names its slide), and the notes besides. */
function publishBlockers(project: StructuredProjectView): PublishBlockers {
  const issues = ((project.quality?.deterministic?.issues || []) as ReviewIssue[]);
  const slides = project.deck?.slides || [];
  const pageOf = (issue: ReviewIssue) => {
    if (Number.isInteger(issue.pageIndex) && issue.pageIndex! >= 0) return issue.pageIndex! + 1;
    const at = issue.slideId ? slides.findIndex(slide => slide.id === issue.slideId) : -1;
    if (at >= 0) return at + 1;
    const named = String(issue.message || "").match(/\bslide (\d+)\b|\u7b2c\s*(\d+)\s*\u9875|\bPage (\d+)\b/iu);
    return named ? Number(named[1] || named[2] || named[3]) : null;
  };
  const errors = issues.filter(issue => issue.severity === "error");
  const listed = (issue: ReviewIssue) => ({ message: String(issue.message || issue.code || ""), page: pageOf(issue) });
  // Pages the export re-laid out by code after a failed verification are named among the notes.
  return { issues: errors.map(listed), warnings: issues.length - errors.length, fallbacks: issues.filter(issue => issue.code === "export_page_fallback").map(listed) };
}
async function request(
  projectId: string,
  path: string,
  method = "GET",
  payload?: unknown,
) {
  const response = await fetch(`/api/ppt/projects${projectId?'/'+projectId:''}${path}${path.includes('?')?'&':'?'}view=live`, {
    method,
    headers: payload ? { "content-type": "application/json" } : undefined,
    body: payload ? JSON.stringify(payload) : undefined,
    cache: "no-store",
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok)
    throw Object.assign(new Error(value.error || `HTTP ${response.status}`), {
      status: response.status,
      details: value.details,
      code: value.code,
    });
  return value;
}

export function StructuredPptEditor({
  project,
  chatOpen = false,
  embedded = false,
  activeSlideId,
  drafts,
  onPageChange,
  onProject,
  onClose,
  onFailureDetails,
  initialSlideId,
  onUserScroll,
}: {
  project: StructuredProjectView;
  chatOpen?: boolean;
  embedded?: boolean;
  activeSlideId?: string;
  initialSlideId?: string;
  drafts?: Record<string, PptDraft>;
  onPageChange?: (id:string)=>void;
  /** Called when the user scrolls the canvas themselves (pauses follow). */
  onUserScroll?: () => void;
  onProject: (project: StructuredProjectView) => void;
  onClose?: () => void;
  onFailureDetails?: () => void;
}) {
  const { t, locale } = useTranslation();
  const [page, setPage] = useState(0);
  const generating=['generating','paused'].includes(project.status);
  const structureLocked=generating||Boolean(project.externalPptx||project.templateFidelity?.mode==='preserve');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [instruction, setInstruction] = useState("");
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [query, setQuery] = useState("");
  const [conversionOpen,setConversionOpen]=useState(false);
  const [railCollapsed,setRailCollapsed]=useState(false);
  const [railWidth,setRailWidth]=useState(208);
  const [thumbMode, setThumbMode] = useState<"list" | "grid">("grid");
  const [presenting, setPresenting] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [recreating,setRecreating]=useState(false);
  const [tool, setTool] = useState<Tool>(null);
  const [docTitle, setDocTitle] = useState(project.title);
  const [exitOpen, setExitOpen] = useState(false);
  const [exitBusy, setExitBusy] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [aiProposal, setAiProposal] = useState<PptAiProposal | null>(null);
  const [textTarget,setTextTarget]=useState<{nodeId:string;kind:string;itemId?:string;paragraphIndex?:number;start?:number;end?:number;expectedText:string}|null>(null);
  const [inlineAi,setInlineAi]=useState<{slideId:string;nodeId?:string;nodeIds?:string[];revision:number;advisory?:PptReviewAdvisory;target?:{nodeId:string;kind:string;itemId?:string;paragraphIndex?:number;start?:number;end?:number;expectedText:string}}|null>(null);
  const [advisoryPanel,setAdvisoryPanel]=useState<string|null>(null);
  const [advisoryBusy,setAdvisoryBusy]=useState<string|null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const aiAttempt = useRef(0);
  const imageRetry = useRef<{ taskId: string; key: string } | null>(null);
  const [aiMode, setAiMode] = useState<PptMutationType>("auto");
  const [lastAiOperation, setLastAiOperation] = useState<string | null>(null);
  useEffect(() => () => { aiAttempt.current++; }, []);
  const [revisions, setRevisions] = useState<
    { revision: number; reason: string; createdAt: string }[]
  >([]);
  const [dragSlide, setDragSlide] = useState<number | null>(null);
  const refs = useRef<Record<string, HTMLElement | null>>({});
  const canvasRef=useRef<HTMLElement|null>(null);
  const restoredProject=useRef<string|null>(null);
  const restoringSelection=useRef(false);
  const controlledSlide = useRef<string | undefined>(undefined);
  // Copied objects are pasted from the page they were copied on.
  const clipboard = useRef<{ slideId: string; nodeIds: string[] } | null>(null);
  const preserveNative = Boolean(project.externalPptx || project.templateFidelity?.mode === "preserve");
  const templateFontState=usePptTemplateFonts(project.id,project.template);
  const tree = project.renderTree;
  const paused = project.status === 'paused';
  const pageDone = (id: string) => ['done', 'completed'].includes(project.nodes?.[id]?.status || '') || Boolean(project.outline.find(outline => outline.id === id)?.manualBlank);
  // Gamma page by page (round 7, A2/A7): while generating, the canvas shows the
  // finished pages and the page being written; later pages are only listed.
  const generationView=drafts?{...project,drafts}:project;
  // Edits go through one serial queue per project (see ppt-command-queue):
  // revision-linked, geometry-coalesced, shown optimistically until answered.
  const acceptRef = useRef<(next: StructuredProjectView) => void>(() => {});
  const tRef = useRef(t); tRef.current = t;
  const [overlayVersion, setOverlayVersion] = useState(0);
  const queue = useMemo(() => new PptCommandQueue<StructuredProjectView>(project.revision, {
    send: body => request(project.id, "/commands", "POST", body),
    onProject: next => acceptRef.current(next),
    onError: (fault: QueueError) => {
      const raced = isRevisionConflict(fault);
      setConflict(raced);
      setError(raced ? tRef.current("ppt.editor.revisionConflict") : fault.code === "node_locked" ? tRef.current("ppt.editor.nodeLocked") : fault.message);
    },
    onOverlay: () => setOverlayVersion(value => value + 1),
  // eslint-disable-next-line react-hooks/exhaustive-deps -- one queue per project; later revisions arrive through observe()
  }), [project.id]);
  useEffect(() => { queue.observe(project.revision); }, [queue, project.revision]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- overlayVersion signals queue changes
  const overlay = useMemo(() => queue.overlay(), [queue, overlayVersion]);
  const slides = useMemo(() => (tree?.slides || []).filter(item => generating ? pageDone(item.slideId) || generationPageStarted(generationView,item.slideId) : true).map(item => withOptimistic(item, overlay)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tree, paused, project.status, project.nodes, project.outline, project.drafts,project.generationStages,project.runtime,drafts,overlay]);
  const plannedPages = project.status === 'generating' ? project.outline.map((outline, index) => ({ outline, index })).filter(({ outline }) => !pageDone(outline.id) && !generationPageStarted(generationView,outline.id)) : [];
  useEffect(() => { if (initialSlideId) { const index = slides.findIndex(item => item.slideId === initialSlideId); if (index >= 0) setPage(index); } }, [initialSlideId, slides]);
  const slide = slides[page];
  function freezeSourceSelection(el:HTMLTextAreaElement) {
    if(!selected?.nodeId)return;
    const original=selected.content?.richText?.source??selected.content?.rawText??selected.content?.text??'';
    if(el.value!==original||el.selectionEnd<=el.selectionStart)return;
    setTextTarget({nodeId:selected.nodeId,kind:'range',start:el.selectionStart,end:el.selectionEnd,expectedText:el.value.slice(el.selectionStart,el.selectionEnd)});
  }
  function sourceSelectionKey(event:React.KeyboardEvent<HTMLTextAreaElement>) {
    if(!event.shiftKey||event.metaKey||event.ctrlKey||event.altKey||!['ArrowLeft','ArrowRight'].includes(event.key))return;
    // Chromium's readonly textarea scrolls on arrows instead of exposing a
    // caret. Give this source inspector explicit selection-only navigation.
    const el=event.currentTarget,text=el.value,backward=el.selectionDirection==='backward';
    const anchor=backward?el.selectionEnd:el.selectionStart,focus=backward?el.selectionStart:el.selectionEnd;
    const boundaries=[...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(text)].map(part=>part.index);boundaries.push(text.length);
    const next=event.key==='ArrowRight'?boundaries.find(at=>at>focus)??text.length:[...boundaries].reverse().find(at=>at<focus)??0;
    event.preventDefault();el.setSelectionRange(Math.min(anchor,next),Math.max(anchor,next),next<anchor?'backward':'forward');freezeSourceSelection(el);
  }


  const liveEditing = ['generating','failed'].includes(project.status);
  const aiSlideId=inlineAi?.slideId||slide?.slideId;
  const targetRuntime = aiSlideId ? project.runtime?.slides[aiSlideId] : undefined;
  const localAiReady = !liveEditing || Boolean((project.status!=='failed'||project.stage==='generation') && aiSlideId && project.nodes?.[aiSlideId]?.status==='done' && targetRuntime?.phase==='render_ready' && targetRuntime.preview && !targetRuntime.quality?.issues?.some(issue=>issue.severity==='error'));

  const [nearbySlides,setNearbySlides]=useState<Set<string>>(()=>new Set());
  const slideOrder=slides.map(item=>item.id).join('|');
  useEffect(()=>{
    const root=canvasRef.current;if(!root||typeof IntersectionObserver==='undefined')return;
    const visible=new Set<string>();
    const observer=new IntersectionObserver(entries=>{
      for(const entry of entries){const id=(entry.target as HTMLElement).dataset.renderSlideId;if(!id)continue;if(entry.isIntersecting)visible.add(id);else visible.delete(id);}
      setNearbySlides(new Set(visible));
    },{root,rootMargin:'1200px 0px'});
    for(const element of Object.values(refs.current))if(element)observer.observe(element);
    return ()=>observer.disconnect();
  },[project.id,slideOrder]);
  useEffect(()=>{const element=canvasRef.current;if(!element||restoredProject.current===project.id)return;const value=sessionStorage.getItem(`ppt-editor-scroll:${project.id}`);let saved:{slideId?:string;scrollTop?:number}|null=null;try{saved=value?JSON.parse(value):null;}catch{}if(saved&&typeof saved==='object'&&saved.slideId===activeSlideId&&Number.isFinite(saved.scrollTop)){element.scrollTop=saved.scrollTop||0;controlledSlide.current=activeSlideId;}else controlledSlide.current=undefined;restoredProject.current=project.id;},[project.id,slides.length,activeSlideId]);
  useEffect(()=>{restoringSelection.current=true;try{const saved=JSON.parse(sessionStorage.getItem(`ppt-selection:${project.id}:${slide?.slideId}`)||'[]');setSelectedIds(Array.isArray(saved)?saved.filter(id=>typeof id==='string'&&slide?.elements.some(n=>n.nodeId===id)):[]);}catch{setSelectedIds([]);}},[project.id,slide?.slideId]);
  useEffect(()=>{if(restoringSelection.current){restoringSelection.current=false;return;}if(slide?.slideId)sessionStorage.setItem(`ppt-selection:${project.id}:${slide.slideId}`,JSON.stringify(selectedIds));},[project.id,slide?.slideId,selectedIds]);

  useEffect(() => {
    if (!activeSlideId) { controlledSlide.current = undefined; return; }
    const at = slides.findIndex(s => s.slideId === activeSlideId);
    if (at < 0) return;
    setPage(at);
    // Live selection must move the actual canvas, not only the thumbnail.
    // Repeated snapshots of the same page must not steal the user's scroll.
    if (controlledSlide.current === activeSlideId) return;
    const target = refs.current[slides[at].id];
    if (!target) return;
    controlledSlide.current = activeSlideId;
    target.scrollIntoView({ behavior: 'auto', block: 'start' });
  }, [activeSlideId, slides]);
  function choosePage(index:number){setPage(index);const id=slides[index]?.slideId;if(id){sessionStorage.setItem(`ppt-viewed-page:${project.id}`,id);onPageChange?.(id);}}
  // A neighbouring page/tool is read-only navigation for an existing frozen AI target.
  // Only explicit discard or project unmount invalidates the request token.
  const pointElement = slide?.elements.find(
    (element) => element.kind === "list" && element.content?.pointLayout,
  );
  const pointLayout = pointElement?.content?.pointLayout;
  const pointCount = pointElement?.content?.items?.length || 0;
  const selected = useMemo(
    () => slide?.elements.find((element) => element.nodeId === selectedIds[0]),
    [slide, selectedIds],
  );
  // A source table drawn as cards can be shown as the original table, and back (Fable plan T5).
  // It redraws one page's region, not the deck structure, so template decks allow it too.
  const tableForm = useMemo(() => {
    const artifact = (selected as { sourceArtifact?: { sourceUnitId?: string; type?: string; tableRepresentation?: string } } | undefined)?.sourceArtifact;
    if (!artifact?.sourceUnitId || !['TableBlock', 'SummaryTableBlock'].includes(String(artifact.type))) return null;
    if (selected?.kind === 'list' && (selected.content as { diagram?: unknown } | undefined)?.diagram) return { sourceUnitId: artifact.sourceUnitId, next: 'table' as const };
    if (selected?.kind === 'table' && artifact.tableRepresentation === 'table') return { sourceUnitId: artifact.sourceUnitId, next: 'diagram' as const };
    return null;
  }, [selected]);
  const [tableFormBusy, setTableFormBusy] = useState(false);
  useEffect(()=>{setTextTarget(current=>current?.nodeId===selected?.nodeId?current:null);},[selected?.nodeId]);
  const selectedElements = useMemo(
    () =>
      slide?.elements.filter(
        (element) =>
          element.nodeId &&
          selectedIds.includes(element.nodeId) &&
          element.id === element.nodeId,
      ) || [],
    [slide, selectedIds],
  );
  // Judged deck-review findings that did not block publishing, by flagged page.
  // The server resolves each page's target node; older payloads only list pages.
  const advisoriesBySlide = useMemo(() => {
    const result = new Map<string, { issue: PptReviewAdvisory; nodeId: string | null }[]>();
    for (const issue of project.quality?.modelIssues || []) {
      if (!issue.advisory) continue;
      for (const target of issue.targets || (issue.slideIds || []).map(slideId => ({ slideId, nodeId: issue.nodeId || null })))
        result.set(target.slideId, [...(result.get(target.slideId) || []), { issue, nodeId: target.nodeId }]);
    }
    // D2 (2026-10-31): page-local errors no longer block publishing; the deck
    // publishes and each flagged page shows its problem here for the author.
    for (const flag of project.quality?.deterministic?.issues || []) {
      if (!flag.pageFlag) continue;
      const issue: PptReviewAdvisory = { code: flag.code, severity: 'warning', detail: flag.message, advisory: true, pageFlag: true };
      for (const slideId of flag.slideIds?.length ? flag.slideIds : flag.slideId ? [flag.slideId] : [])
        result.set(slideId, [...(result.get(slideId) || []), { issue, nodeId: flag.nodeIds?.[0] || null }]);
    }
    return result;
  }, [project.quality?.modelIssues, project.quality?.deterministic?.issues]);
  const openAdvisories = (slideId: string) => (advisoriesBySlide.get(slideId) || []).filter(entry => !entry.issue.review);
  const advisoryNodes = (slideId: string) => Object.fromEntries(openAdvisories(slideId).filter(entry => entry.nodeId).map(entry => [entry.nodeId!, openAdvisories(slideId).filter(other => other.nodeId === entry.nodeId).map(other => other.issue.detail || '').join('\n')]));
  const advisoryLabel = (code: string, pageFlag?: boolean) => t((pageFlag ? 'ppt.advisory.code.pageFlag' : ['model_missing', 'model_repeated', 'model_conflict', 'model_unsupported', 'claim_redundant'].includes(code) ? `ppt.advisory.code.${code}` : 'ppt.advisory.code.other') as TranslationKey);
  const matches = useMemo(
    () =>
      slides
        .map((item, index) => ({ item, index }))
        .filter(({ item }) =>
          `${project.deck?.slides.find((deckSlide) => deckSlide.id === item.slideId)?.title || ""} ${item.elements.flatMap((element) => [element.content?.text, ...(element.content?.items || []).map((value) => value.text)]).join(" ")}`
            .toLocaleLowerCase()
            .includes(query.trim().toLocaleLowerCase()),
        )
        .slice(0, 100),
    [slides, project.deck, query],
  );
  const saved = project.status === 'completed' && (project.publishedRevision ?? -1) === project.revision && !project.renderUpgradePending;
  // D3: a card deck is reviewed by a model only when the author asks (AI check);
  // its findings are notes and never block publishing.
  const cardDeck = Boolean(project.planningContract || project.planningPhase);
  const [aiCheck, setAiCheck] = useState<{ running: boolean; result?: string }>({ running: false });
  function requestExit() { if (generating || saved || !project.publishedRevision || ['failed','quality_blocked'].includes(project.status)) onClose?.(); else setExitOpen(true); }
  async function finishExit(keep: boolean) {
    setExitBusy(true); setError("");
    try {
      // Every publish goes through publishNow: edits flushed, one at a time, a blocked list on failure.
      // null: a publish is already running (the dialog stays open), never "blocked".
      if (keep) {
        const published = await publishNow();
        if (published === null) return;
        if (!published) { setExitOpen(false); return; }
      } else {
        const revision = project.publishedRevision ?? 0;
        if (revision < 1) throw new Error(t("ppt.editor.restoreMissing"));
        // A field still being typed is committed before the restore, so the restore discards it too.
        await flushEdits();
        const restored = await request(project.id, `/revisions/${revision}/restore`, "POST");
        accept(restored.project);
        const published = await publishNow();
        if (published === null) return;
        if (!published) throw new Error(t("ppt.editor.restoreBlocked"));
      }
      setExitOpen(false); onClose?.();
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setExitBusy(false); }
  }
  async function runAiCheck() {
    setAiCheck({ running: true }); setError("");
    try {
      const result = await request(project.id, "/ai-check", "POST");
      accept(result.project);
      const review = result.project?.quality?.modelReview;
      const notes = review ? (['missing', 'repeated', 'conflicts', 'unsupported'] as const).reduce((sum, key) => sum + (review[key]?.length || 0), 0) : 0;
      setAiCheck({ running: false, result: notes ? t("ppt.ai.checkNotes", { n: notes }) : t("ppt.ai.checkClean") });
    } catch (reason) { setAiCheck({ running: false }); setError(reason instanceof Error ? reason.message : String(reason)); }
  }

  useEffect(() => {
    setDocTitle(project.title);
  }, [project.title]);
  useEffect(() => {
    setPage((value) => Math.min(value, Math.max(0, slides.length - 1)));
  }, [slides.length]);
  useEffect(() => {
    setSelectedIds((current) =>
      current.filter((id) =>
        slide?.elements.some((element) => element.nodeId === id),
      ),
    );
  }, [slide]);
  useEffect(() => {
    if (versionsOpen)
      request(project.id, "/revisions")
        .then((value) => setRevisions(value.revisions || []))
        .catch(() => setRevisions([]));
  }, [project.id, project.revision, versionsOpen]);

  const accept = useCallback(
    (next: StructuredProjectView) => {
      onProject(next);
      setConflict(false);
      setError("");
    },
    [onProject],
  );
  acceptRef.current = accept;
  // A tool panel takes the selection's place: the floating AI composer would
  // cover the panel's own buttons on a narrow window (Fable L4). The next
  // selection opens it again; a running or proposed AI edit keeps it.
  useEffect(() => { if (tool && !aiBusy && !aiProposal) setInlineAi(null); }, [tool]); // eslint-disable-line react-hooks/exhaustive-deps
  const switchTableForm = useCallback(async () => {
    if (!tableForm || !slide) return;
    setTableFormBusy(true);
    try {
      const value = await request(project.id, '/table-representation', 'POST', { slideId: slide.slideId, sourceUnitId: tableForm.sourceUnitId, representation: tableForm.next, baseRevision: project.revision });
      if (value.project) accept(value.project);
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { setTableFormBusy(false); }
  }, [tableForm, slide, project.id, project.revision, accept]);
  const command = useCallback(
    async (type: string, payload: unknown, patches: OptimisticPatch[] = []) => {
      setError("");
      const next = await queue.enqueue(type, payload as Record<string, unknown>, patches);
      return next ? { project: next } : null;
    },
    [queue],
  );
  const commandVoid = useCallback(async (type: string, payload: unknown) => { await command(type, payload); }, [command]);
  // Undo, redo and publish change the revision too: keep them in edit order.
  const direct = useCallback(
    async (path: string, payload?: unknown) => {
      await queue.run(async () => (await request(project.id, path, "POST", payload)).project);
    },
    [queue, project.id],
  );
  // Save & publish (Fable G1/G2, 2026-11-01): one labelled action; a blocked
  // publish lists what blocks it, page by page, instead of one generic line.
  // A blocked list belongs to the revision it was found on; any later edit hides it.
  const [blockedState, setBlocked] = useState<(PublishBlockers & { revision: number }) | null>(null);
  const blocked = blockedState && blockedState.revision === project.revision ? blockedState : null;
  const [publishing, setPublishing] = useState(false);
  const publishingRef = useRef(false);
  const renaming = useRef<Promise<void> | null>(null);
  // Text being typed commits on blur: let it reach the queue (and a title
  // rename finish) before anything is published, so the revision has it.
  const flushEdits = useCallback(async () => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    await new Promise(resolve => setTimeout(resolve, 0));
    await renaming.current;
  }, []);
  const publishNow = useCallback(async () => {
    if (publishingRef.current) return null;
    publishingRef.current = true; setPublishing(true); setError("");
    try {
      await flushEdits();
      let published = false, latest: StructuredProjectView | null = null;
      await queue.run(async () => { const result = await request(project.id, "/publish", "POST"); published = Boolean(result.published); latest = result.project; return result.project; });
      const found = latest as StructuredProjectView | null;
      setBlocked(published || !found ? null : { ...publishBlockers(found), revision: found.revision });
      return published;
    } finally { publishingRef.current = false; setPublishing(false); }
  }, [queue, project.id, flushEdits]);
  const savedRef = useRef(saved); savedRef.current = saved;
  // Ctrl/⌘+S always commits the field being edited; it publishes only a draft.
  const saveShortcut = useCallback(async () => {
    await flushEdits();
    await new Promise(resolve => setTimeout(resolve, 0));
    if (!savedRef.current && !generatingRef.current) await publishNow();
  }, [flushEdits, publishNow]);
  const generatingRef = useRef(generating); generatingRef.current = generating;
  const publishRef = useRef(saveShortcut); publishRef.current = saveShortcut;
  async function reload() {
    try {
      accept((await request(project.id, "")).project);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }
  async function rename() {
    const title = docTitle.trim();
    if (!title || title === project.title) {
      setDocTitle(project.title);
      return;
    }
    try {
      const pending = request(project.id, "", "PATCH", { title }).then(value => { accept(value.project); });
      renaming.current = pending.catch(() => undefined);
      await pending;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }
  function openInline(targetSlide:PptRenderSlide,nodeId?:string,target?:typeof textTarget,useSelection=false){
    if(aiBusy||aiProposal)return;
    setError('');setAiMode('auto');setAiAction('custom');if(tool==='ai')setTool(null);
    setInlineAi({slideId:targetSlide.slideId,nodeId,...(useSelection&&nodeId&&selectedIds.includes(nodeId)&&selectedIds.length>1?{nodeIds:[...selectedIds]}:{}),revision:project.revision,...(target?{target}:{})});
  }
  function inlineAnchor(){
    if(!inlineAi)return null;
    const parent=refs.current[slides.find(s=>s.slideId===inlineAi.slideId)?.id||''];
    const object=inlineAi.nodeId?parent?.querySelector(`[data-node-id="${CSS.escape(inlineAi.nodeId)}"]`):parent;
    const member=inlineAi.target?.itemId?object?.querySelector(`[data-item-id="${CSS.escape(inlineAi.target.itemId)}"]`):null;
    if(member)return member.getBoundingClientRect();
    const textarea=object?.querySelector('textarea');
    if(textarea instanceof HTMLTextAreaElement&&inlineAi.target?.start!==undefined&&inlineAi.target.end!==undefined)return textareaSelectionRect(textarea,inlineAi.target.start,inlineAi.target.end);
    return object?.getBoundingClientRect()||null;
  }
  function select(id: string | null, additive = false) {
    if (!id) {
      setSelectedIds([]);
      if(!aiBusy&&!aiProposal)setInlineAi(null);
      return;
    }
    setSelectedIds((current) =>
      additive
        ? current.includes(id)
          ? current.filter((value) => value !== id)
          : [...current, id]
        : [id],
    );
  }
  function go(index: number) {
    choosePage(index);
    setSelectedIds([]);
    refs.current[slides[index]?.id]?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }
  function reorder(from: number, to: number) {
    if (from === to || from < 0 || to < 0) return;
    const ids = slides.map((item) => item.slideId);
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved);
    void command("slide.reorder", { slideIds: ids });
  }
  function insertNode(
    type: "text" | "shape" | "chart" | "table",
    content: PptRenderElement["content"],
  ) {
    if (!slide) return;
    void command("node.insert", {
      slideId: slide.slideId,
      node: {
        type,
        content,
        geometry: {
          x: Math.round(slide.size.width * 0.29),
          y: Math.round(slide.size.height * 0.39),
          width: Math.round(slide.size.width * 0.42),
          height: Math.round(slide.size.height * 0.22),
        },
        style:
          type === "shape"
            ? {
                fill: project.templateSpec?.palette?.accent || "#7c70d6",
                shape: content?.shape || "rect",
              }
            : {},
      },
    });
  }
  async function insertImage(file: File, replace = false) {
    if (!slide) return;
    const content = { dataUrl: await prepareImage(file), text: file.name };
    if (replace && selected?.kind === "image")
      await command("node.setContent", {
        slideId: slide.slideId,
        nodeId: selected.nodeId,
        content,
      });
    else
      await command("node.insert", {
        slideId: slide.slideId,
        node: {
          type: "image",
          content,
          geometry: {
            x: Math.round(slide.size.width * 0.55),
            y: Math.round(slide.size.height * 0.24),
            width: Math.round(slide.size.width * 0.34),
            height: Math.round(slide.size.height * 0.48),
          },
          style: {},
        },
      });
  }
  async function generateImage() {
    if (!selected || selected.kind !== "image" || !instruction.trim() || !slide)
      return;
    const attempt = ++aiAttempt.current;
    const originalSlideId = slide.slideId, originalNodeId = selected.nodeId, originalRevision = project.revision, originalInstruction = instruction;
    let taskId: string | undefined; let assetAttempt = 1;
    const assetKey = JSON.stringify([originalSlideId, originalNodeId, originalInstruction]);
    setAiBusy(true);
    setError("");
    try {
      const registered = imageRetry.current?.key === assetKey
        ? await request(project.id, `/asset-tasks/${imageRetry.current.taskId}/retry`, 'POST', {})
        : await request(project.id, '/asset-tasks', 'POST', { slideId: originalSlideId, nodeId: originalNodeId, instruction: originalInstruction, baseRevision: originalRevision });
      taskId = registered.task.id; assetAttempt = registered.task.attempts; imageRetry.current = { taskId: taskId!, key: assetKey };
      const response = await fetch("/api/image/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: instruction,
          qualityLevel:project.executionPolicy?.qualityLevel,
          aspectRatio: "16:9",
          n: 1,
        }),
      });
      const value = await response.json();
      if (!response.ok || !value.images?.[0]?.localPath)
        throw new Error(t("ppt.editor.imageGenerationFailed"));
      const imageResponse = await fetch(
        `/api/media/serve?path=${encodeURIComponent(value.images[0].localPath)}`,
      );
      if (!imageResponse.ok) throw new Error(t("ppt.editor.imageLoadFailed"));
      const blob = await imageResponse.blob();
      const dataUrl = await prepareImage(
        new File([blob], "ai-image.png", { type: blob.type || "image/png" }),
      );
      const result = await request(project.id, `/asset-tasks/${taskId}`, "POST", { attempt: assetAttempt, content: { dataUrl, text: originalInstruction.slice(0, 200) } });
      if (aiAttempt.current === attempt) setAiProposal(result.proposal);
      else { void request(project.id, `/proposals/${result.proposal.id}/discard`, 'POST').catch(() => {}); imageRetry.current = null; }
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      if (taskId) void request(project.id, `/asset-tasks/${taskId}`, "POST", { error: message, attempt: assetAttempt }).catch(() => {});
      if (aiAttempt.current === attempt) setError(message);
    } finally { if (aiAttempt.current === attempt) setAiBusy(false); }
  }
  async function discardAi() {
    aiAttempt.current++;
    setAiBusy(false);
    if (!aiProposal) return;
    try { await request(project.id, `/proposals/${aiProposal.id}/discard`, "POST"); setAiProposal(null); if (aiProposal.type === 'asset') imageRetry.current = null; }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  }
  const [aiAction, setAiAction] = useState('custom');
  const [aiLanguage, setAiLanguage] = useState('en');
  const [aiTranslationMode, setAiTranslationMode] = useState('replace');
  const [aiRegion, setAiRegion] = useState('');
  const [aiGlossary, setAiGlossary] = useState('');
  const [aiRatio, setAiRatio] = useState(1.5);
  useEffect(()=>setTextTarget(null),[project.revision,selected?.nodeId]);
  async function proposeAi(scope: "object" | "slide" | "deck", mode: PptMutationType = aiMode, nativeReflow=false) {
    const targetSlide=inlineAi?slides.find(s=>s.slideId===inlineAi.slideId):slide;
    const targetNode=inlineAi?.nodeId?targetSlide?.elements.find(n=>n.nodeId===inlineAi.nodeId):selected;
    if ((!instruction.trim()&&!nativeReflow) || !targetSlide || (scope === "object" && !targetNode?.nodeId) || (["layout", "structure"].includes(mode) && preserveNative&&!nativeReflow&&!(mode==="layout"&&project.editCapabilities?.relayout))) return;
    if(inlineAi&&inlineAi.revision!==project.revision){setError(t('ppt.inline.stale'));return;}
    const attempt = ++aiAttempt.current;
    setAiBusy(true); setError("");
    const target=inlineAi?.target||textTarget;
    try {
      const value = await request(project.id, "/ai-edit", "POST", { scope, type: mode,...(nativeReflow?{mode:'native-content'}:{}), preview: true, ...(scope==='object'&&inlineAi?.nodeIds?.length?{nodeIds:inlineAi.nodeIds}:{}), ...(scope==='object'&&['auto','content','title'].includes(mode)&&target?.nodeId===targetNode?.nodeId?{target}:{}), ...(aiAction !== 'custom' && ['auto','title','content'].includes(mode) ? { action: aiAction, parameters: aiAction === 'translate' ? { targetLanguage: aiLanguage, mode: aiTranslationMode, region: aiRegion, glossary: aiGlossary } : aiAction === 'expand' ? { lengthRatio: aiRatio } : {} } : {}), slideId: targetSlide.slideId, nodeId: targetNode?.nodeId, instruction: instruction.trim()||(nativeReflow?t('ppt.inline.nativeLayout'):''), baseRevision: project.revision });
      if (aiAttempt.current !== attempt) { void request(project.id, `/proposals/${value.proposal.id}/discard`, "POST").catch(() => {}); return; }
      setAiProposal(value.proposal);
    } catch (reason) {
      if (aiAttempt.current !== attempt) return;
      const fault = reason as QueueError; setConflict(isRevisionConflict(fault)); setError(fault.message);
    } finally { if (aiAttempt.current === attempt) setAiBusy(false); }
  }
  async function applyAi() {
    if (!aiProposal || aiBusy) return;
    setAiBusy(true); setError("");
    try {
      const result = await request(project.id, `/proposals/${aiProposal.id}/apply`, "POST");
      accept(result.project); if (aiProposal.type === 'asset') imageRetry.current = null; setLastAiOperation(result.operation.id);
      const index = result.project.deck.slides.findIndex((item: { id: string }) => item.id === aiProposal.slideId);
      if (index >= 0) choosePage(index);
      setAiProposal(null); setTextTarget(null); setInstruction(""); setInlineAi(null);
    } catch (reason) {
      const fault = reason as QueueError; setConflict(isRevisionConflict(fault)); setError(fault.message);
    } finally { setAiBusy(false); }
  }
  /** "Apply suggestion": the server turns the stored finding into an AI edit of
   * its target; the preview is applied like any AI edit (proposal → command). */
  async function applyAdvisory(targetSlide: PptRenderSlide, issue: PptReviewAdvisory, nodeId: string | null) {
    if ((!issue.id && !issue.pageFlag) || aiBusy || aiProposal) return;
    selectOnPage(slides.findIndex(item => item.slideId === targetSlide.slideId), nodeId ? [nodeId] : []);
    setInstruction(''); setTextTarget(null); setAiAction('custom'); setAiMode('auto'); if (tool === 'ai') setTool(null);
    setInlineAi({ slideId: targetSlide.slideId, ...(nodeId ? { nodeId } : {}), revision: project.revision, advisory: issue });
    const attempt = ++aiAttempt.current;
    setAiBusy(true); setError('');
    try {
      // A flagged page (D2) is fixed from its stored flag, like a finding from its stored suggestion.
      const value = await request(project.id, '/ai-edit', 'POST', { ...(issue.id ? { reviewAdvisoryId: issue.id } : { pageFlagCode: issue.code }), slideId: targetSlide.slideId, baseRevision: project.revision, preview: true });
      if (aiAttempt.current !== attempt) { void request(project.id, `/proposals/${value.proposal.id}/discard`, 'POST').catch(() => {}); return; }
      setAiProposal(value.proposal);
    } catch (reason) {
      if (aiAttempt.current !== attempt) return;
      const fault = reason as Error & { status?: number }; setConflict(fault.status === 409); setError(fault.message);
    } finally { if (aiAttempt.current === attempt) setAiBusy(false); }
  }
  /** Dismiss or restore a finding. A review decision, not a deck edit. */
  async function decideAdvisory(id: string, status: 'dismissed' | 'open') {
    setAdvisoryBusy(id);
    try { accept((await request(project.id, `/review-advisories/${id}`, 'POST', { status, baseRevision: project.revision })).project); }
    catch (reason) { const fault = reason as Error & { status?: number }; setConflict(fault.status === 409); setError(fault.message); }
    finally { setAdvisoryBusy(null); }
  }
  /** The page's stored selection is restored when the page changes; store this one first. */
  function selectOnPage(index: number, ids: string[]) {
    const slideId = slides[index]?.slideId; if (!slideId) return;
    sessionStorage.setItem(`ppt-selection:${project.id}:${slideId}`, JSON.stringify(ids));
    choosePage(index); setSelectedIds(ids);
  }
  function showAdvisory(index: number, nodeId: string) {
    selectOnPage(index, [nodeId]);
    refs.current[slides[index]?.id]?.querySelector(`[data-node-id="${CSS.escape(nodeId)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  async function undoAi() {
    if (!lastAiOperation || aiBusy) return;
    setAiBusy(true);
    try { accept((await request(project.id, "/undo", "POST", { operationId: lastAiOperation })).project); setLastAiOperation(null); }
    catch (reason) { const fault = reason as QueueError; setConflict(isRevisionConflict(fault)); setError(fault.message); }
    finally { setAiBusy(false); }
  }
  async function restore(revision: number) {
    try {
      accept(
        (await request(project.id, `/revisions/${revision}/restore`, "POST"))
          .project,
      );
      setVersionsOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }
  function moveGeometry(
    targetSlideId: string,
    changes: { element: PptRenderElement; bounds: PptBounds }[],
  ) {
    if (!changes.length) return;
    void command("nodes.setGeometry", {
      slideId: targetSlideId,
      changes: changes.map((change) => ({
        nodeId: change.element.nodeId,
        geometry: change.bounds,
      })),
    }, geometryPatches(changes.map(change => ({ nodeId: change.element.nodeId, geometry: change.bounds }))));
  }
  function inlineContent(
    targetSlideId: string,
    element: PptRenderElement,
    text: string,
  ): string | void {
    if (!element.nodeId) return;
    const original=element.kind==='text'?(element.content?.richText?.source??element.content?.rawText??element.content?.text??''):(element.content?.items||[]).map(item=>item.richText?.source??item.text).join('\n');
    if(text===original)return;
    let content: { text: string } | { items: { id: string; text: string }[] };
    if (element.kind === "text") content = { text };
    else {
      const list = inlineListItems(element.content?.items || [], text, () => crypto.randomUUID().replaceAll("-", ""));
      if ("error" in list) return t("ppt.editor.listItemLimit", list.error);
      content = { items: list.items };
    }
    void command("node.setContent", {
      slideId: targetSlideId,
      nodeId: element.nodeId,
      content,
    });
  }
  function act(
    targetSlide: PptRenderSlide,
    action: "delete" | "duplicate" | "lock" | "front" | "back" | "ai",
    element: PptRenderElement,
  ) {
    if (!element.nodeId) return;
    if (action === "delete")
      void command("node.delete", {
        slideId: targetSlide.slideId,
        nodeId: element.nodeId,
      });
    if (action === "duplicate")
      void command("node.duplicate", {
        slideId: targetSlide.slideId,
        nodeId: element.nodeId,
      });
    if (action === "lock")
      void command("node.setLocked", {
        slideId: targetSlide.slideId,
        nodeId: element.nodeId,
        locked: !element.locked,
      });
    if (action === "front")
      void command("node.setZIndex", {
        slideId: targetSlide.slideId,
        nodeId: element.nodeId,
        zIndex: Math.min(
          1000,
          Math.max(...targetSlide.elements.map((item) => item.zIndex), 0) + 1,
        ),
      });
    if (action === "back")
      void command("node.setZIndex", {
        slideId: targetSlide.slideId,
        nodeId: element.nodeId,
        zIndex: Math.max(
          0,
          Math.min(...targetSlide.elements.map((item) => item.zIndex), 1) - 1,
        ),
      });
    if (action === "ai") openInline(targetSlide,element.nodeId||undefined);
  }
  function align(
    kind:
      | "left"
      | "center"
      | "right"
      | "top"
      | "middle"
      | "bottom"
      | "horizontal"
      | "vertical",
  ) {
    if (!slide || selectedElements.length < 2) return;
    const rows = [...selectedElements];
    let changes: { nodeId: string | null; geometry: PptBounds }[] = [];
    if (kind === "horizontal" || kind === "vertical") {
      if (rows.length < 3) return;
      const sorted = rows.sort((a, b) =>
        kind === "horizontal"
          ? a.bounds.x - b.bounds.x
          : a.bounds.y - b.bounds.y,
      );
      const first = sorted[0].bounds;
      const last = sorted.at(-1)!.bounds;
      const start = kind === "horizontal" ? first.x : first.y;
      const end = kind === "horizontal" ? last.x : last.y;
      changes = sorted.map((item, index) => ({
        nodeId: item.nodeId,
        geometry: {
          ...item.bounds,
          [kind === "horizontal" ? "x" : "y"]: Math.round(
            start + ((end - start) * index) / (sorted.length - 1),
          ),
        },
      }));
    } else {
      const anchor = rows[0].bounds;
      changes = rows.map((item) => {
        const geometry = { ...item.bounds };
        if (kind === "left") geometry.x = anchor.x;
        if (kind === "center")
          geometry.x = Math.round(
            anchor.x + anchor.width / 2 - item.bounds.width / 2,
          );
        if (kind === "right")
          geometry.x = anchor.x + anchor.width - item.bounds.width;
        if (kind === "top") geometry.y = anchor.y;
        if (kind === "middle")
          geometry.y = Math.round(
            anchor.y + anchor.height / 2 - item.bounds.height / 2,
          );
        if (kind === "bottom")
          geometry.y = anchor.y + anchor.height - item.bounds.height;
        return { nodeId: item.nodeId, geometry };
      });
    }
    void command("nodes.setGeometry", { slideId: slide.slideId, changes }, geometryPatches(changes));
  }

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (presenting) {
        if (event.key === "Escape") setPresenting(false);
        if (event.key === "ArrowRight")
          setPage((value) => Math.min(slides.length - 1, value + 1));
        if (event.key === "ArrowLeft")
          setPage((value) => Math.max(0, value - 1));
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (!generatingRef.current) void publishRef.current();
        return;
      }
      if(event.target instanceof HTMLElement&&event.target.closest('input,textarea,[contenteditable="true"],[role="textbox"]'))return;
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === "z") {
        event.preventDefault();
        void direct(event.shiftKey ? "/redo" : "/undo");
        return;
      }
      if (meta && event.key.toLowerCase() === "c") {
        if (slide && selectedIds.length) clipboard.current = { slideId: slide.slideId, nodeIds: [...selectedIds] };
        return;
      }
      if (
        meta &&
        event.key.toLowerCase() === "v" &&
        clipboard.current &&
        slide &&
        !preserveNative
      ) {
        event.preventDefault();
        const copied = clipboard.current;
        void command("nodes.duplicate", {
          slideId: slide.slideId,
          nodeIds: copied.nodeIds,
          ...(copied.slideId === slide.slideId ? {} : { sourceSlideId: copied.slideId }),
        });
        return;
      }
      if (
        meta &&
        event.key.toLowerCase() === "d" &&
        selectedIds.length &&
        slide &&
        !preserveNative
      ) {
        event.preventDefault();
        void command("nodes.duplicate", {
          slideId: slide.slideId,
          nodeIds: selectedIds,
        });
        return;
      }
      if (
        meta &&
        event.key.toLowerCase() === "g" &&
        selectedIds.length &&
        slide &&
        !preserveNative
      ) {
        event.preventDefault();
        void command(event.shiftKey ? "nodes.ungroup" : "nodes.group", {
          slideId: slide.slideId,
          nodeIds: selectedIds,
        });
        return;
      }
      if (
        (event.key === "Delete" || event.key === "Backspace") &&
        selectedIds.length &&
        slide &&
        // A template's layout picture may be deleted even on a preserved deck (Fable G1).
        (!preserveNative || selectedIds.every((id) => slide.elements.some((element) => element.nodeId === id && element.pinned))) &&
        !(
          event.target instanceof HTMLInputElement ||
          event.target instanceof HTMLTextAreaElement
        )
      ) {
        event.preventDefault();
        void command("nodes.delete", {
          slideId: slide.slideId,
          nodeIds: selectedIds,
        });
        return;
      }
      if (event.key === "Escape" && !event.defaultPrevented && !document.querySelector('[role="listbox"]')) {
        setSelectedIds([]);
        setTool(null);
        setAiProposal(null);
        return;
      }
      if (
        slide &&
        selectedElements.length &&
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
          event.key,
        ) &&
        !(
          event.target instanceof HTMLInputElement ||
          event.target instanceof HTMLTextAreaElement
        )
      ) {
        event.preventDefault();
        const delta = event.shiftKey ? 91440 : 18288;
        const changes = selectedElements.map((element) => ({
          nodeId: element.nodeId,
          geometry: {
            ...element.bounds,
            x: Math.max(
              0,
              Math.min(
                slide.size.width - element.bounds.width,
                element.bounds.x +
                  (event.key === "ArrowLeft"
                    ? -delta
                    : event.key === "ArrowRight"
                      ? delta
                      : 0),
              ),
            ),
            y: Math.max(
              0,
              Math.min(
                slide.size.height - element.bounds.height,
                element.bounds.y +
                  (event.key === "ArrowUp"
                    ? -delta
                    : event.key === "ArrowDown"
                      ? delta
                      : 0),
              ),
            ),
          },
        }));
        void command("nodes.setGeometry", { slideId: slide.slideId, changes }, geometryPatches(changes));
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [
    command,
    direct,
    presenting,
    selectedElements,
    selectedIds,
    slide,
    slides.length,
    preserveNative,
  ]);

  function renderAdvisories(item: PptRenderSlide, index: number) {
    const entries = advisoriesBySlide.get(item.slideId) || [];
    const open = entries.filter(entry => !entry.issue.review), reviewed = entries.filter(entry => entry.issue.review);
    // Selecting a flagged object shows the reviewer's reason without a click.
    const focusNode = page === index ? selected?.nodeId : undefined;
    const focused = open.some(entry => entry.nodeId && entry.nodeId === focusNode);
    if (!entries.length || (advisoryPanel !== item.slideId && !focused)) return null;
    const small = "rounded-md border border-border bg-background px-2 py-1 text-xs hover:bg-accent disabled:opacity-50";
    return <section data-testid="ppt-slide-advisories" aria-label={t('ppt.advisory.title')} className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-foreground">
      <div className="flex items-start justify-between gap-2"><b className="text-xs">{t('ppt.advisory.title')}</b>{advisoryPanel === item.slideId && <button type="button" aria-label={t('ppt.cancel')} className="px-1 text-xs" onClick={() => setAdvisoryPanel(null)}>×</button>}</div>
      {open.length > 0 && <p className="mt-1 text-xs text-muted-foreground">{t('ppt.advisory.hint')}</p>}
      <ul className="mt-2 space-y-2">{open.map(({ issue, nodeId }) => {
        const current = Boolean(nodeId && nodeId === focusNode);
        return <li key={issue.id || issue.detail} data-advisory-id={issue.id} data-focused={current || undefined} className={`rounded-md border bg-background p-2 ${current ? 'border-amber-500 ring-1 ring-amber-500' : 'border-border'}`}>
          <p className="text-xs font-medium text-amber-700 dark:text-amber-300">{advisoryLabel(issue.code, issue.pageFlag)}{nodeId ? '' : ` · ${t('ppt.advisory.wholePage')}`}</p>
          <p className="mt-1 whitespace-pre-wrap break-words">{issue.detail}</p>
          {issue.suggestedFix && <div className="mt-1 text-xs text-muted-foreground"><span className="block font-medium">{t('ppt.advisory.suggestion')}</span><span className="whitespace-pre-wrap break-words">{issue.suggestedFix}</span></div>}
          <div className="mt-2 flex flex-wrap gap-2">
            {nodeId && <button type="button" className={small} onClick={() => showAdvisory(index, nodeId)}>{t('ppt.advisory.show')}</button>}
            {issue.id && issue.suggestedFix && <button type="button" className="rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground disabled:opacity-50" disabled={aiBusy || Boolean(aiProposal) || generating} onClick={() => void applyAdvisory(item, issue, nodeId)}>{t('ppt.advisory.apply')}</button>}
            {issue.pageFlag && PAGE_FLAG_FIXABLE.has(issue.code) && <button type="button" data-testid="ppt-page-flag-fix" className="rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground disabled:opacity-50" disabled={aiBusy || Boolean(aiProposal) || generating} onClick={() => void applyAdvisory(item, issue, nodeId)}>{t('ppt.advisory.fixPage')}</button>}
            {issue.id && <button type="button" className={small} disabled={advisoryBusy === issue.id} onClick={() => void decideAdvisory(issue.id!, 'dismissed')}>{t('ppt.advisory.dismiss')}</button>}
          </div>
        </li>;
      })}</ul>
      {reviewed.length > 0 && <details className="mt-2 text-xs" data-testid="ppt-reviewed-advisories"><summary className="cursor-pointer">{t('ppt.advisory.reviewed').replace('{count}', String(reviewed.length))}</summary>
        <ul className="mt-1 space-y-1">{reviewed.map(({ issue }) => <li key={issue.id || issue.detail} data-advisory-id={issue.id} className="flex items-start justify-between gap-2 rounded-md border border-border bg-background p-2">
          <span className="min-w-0"><span className="block text-muted-foreground">{t(issue.review?.status === 'applied' ? 'ppt.advisory.applied' : 'ppt.advisory.dismissed')}</span><span className="break-words">{issue.detail}</span></span>
          {issue.review?.status === 'dismissed' && issue.id && <button type="button" className={small} disabled={advisoryBusy === issue.id} onClick={() => void decideAdvisory(issue.id!, 'open')}>{t('ppt.advisory.restore')}</button>}
        </li>)}</ul></details>}
    </section>;
  }

  if (!tree || !slide) return null;
  const tools: { icon: string; id: Exclude<Tool, null>; label: string }[] = [
    { icon: "⌕", id: "search", label: t("ppt.editor.search") },
    { icon: "Aa", id: "format", label: t("ppt.editor.format") },
    { icon: "▧", id: "image", label: t("ppt.editor.image") },
    { icon: "▦", id: "layout", label: t("ppt.editor.layout") },
    { icon: "◔", id: "shape", label: t("ppt.editor.shape") },
    { icon: "▥", id: "chart", label: t("ppt.editor.chart") },
    { icon: "☷", id: "table", label: t("ppt.editor.table") },
    { icon: "↔", id: "arrange", label: t("ppt.editor.arrange") },
    { icon: "✎", id: "ai", label: t("ppt.editor.ai") },
  ];
  const canvasProps = {
    slide,
    selectedIds,
    onSelect: select,
    onSelectMany: setSelectedIds,
    onSelectionComplete:(element:PptRenderElement)=>openInline(slide,element.nodeId||undefined),
    onMemberSelection:(element:PptRenderElement,itemId:string)=>{
      const member=element.content?.items?.find(item=>item.id===itemId),owner=slides.find(s=>s.elements.some(n=>n.id===element.id));
      if(element.nodeId&&member&&owner){const target={nodeId:element.nodeId,kind:element.content?.pointLayout?'graph-node':'item',itemId,expectedText:member.richText?.source??member.text};setTextTarget(target);openInline(owner,element.nodeId,target);}
    },

    onGeometry: (changes: { element: PptRenderElement; bounds: PptBounds }[]) =>
      moveGeometry(slide.slideId, changes),
    onRotation: (element: PptRenderElement, rotation: number) =>
      void command("node.setRotation", {
        slideId: slide.slideId,
        nodeId: element.nodeId,
        rotation,
      }, element.nodeId ? [{ nodeId: element.nodeId, rotation }] : []),
    onTextSelection:(element:PptRenderElement,start:number,end:number,text:string)=>{if(element.kind==='text'&&element.nodeId){const target={nodeId:element.nodeId,kind:'range',start,end,expectedText:text};setTextTarget(target);openInline(slide,element.nodeId,target);}},
    onContent: (element: PptRenderElement, text: string) =>
      inlineContent(slide.slideId, element, text),
    onAction: (
      action: "delete" | "duplicate" | "lock" | "front" | "back" | "ai",
      element: PptRenderElement,
    ) => act(slide, action, element),
    allowStructure: !structureLocked,
  };
  return (
    <section
      data-testid="ppt-structured-editor" data-font-state={templateFontState}
      className={`ppt-prototype ${embedded?'relative min-h-0 flex-1':'fixed inset-0 z-[70]'} flex flex-col overflow-hidden bg-background text-foreground ${chatOpen ? "lg:right-[400px]" : ""}`}
    >
      {generating&&<div data-testid="ppt-live-editor-state" className="border-b border-border px-3 py-1 text-xs">{project.generationStages?.deck&&DECK_STAGES.has(project.generationStages.deck)?t(`ppt.deckStage.${project.generationStages.deck}` as TranslationKey):t(`ppt.task.${project.status}`)} · {t("ppt.task.preview")} {project.progress?.previewReady||0}/{project.progress?.total||project.pages}</div>}
      <header className="ppt-editor-header flex min-h-16 shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2 md:px-4">
        <button
          className="grid h-9 w-9 place-items-center rounded-lg border border-border"
          aria-label={t("ppt.editor.back")}
          onClick={requestExit}
        >
          ←
        </button>
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary font-semibold text-primary-foreground">
          A
        </span>
        <input
          className="min-w-36 max-w-md flex-1 bg-transparent text-sm font-semibold outline-none"
          aria-label={t("ppt.editor.fileName")}
          value={docTitle}
          maxLength={160}
          onChange={(event) => setDocTitle(event.target.value)}
          onBlur={() => void rename()}
        />
        <span
          role="status"
          data-testid="ppt-publish-state"
          className={`rounded-full px-2 py-1 text-xs ${saved ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}
        >
          {generating?t("ppt.task.generating"):saved
            ? t("ppt.structured.published")
            : t("ppt.editor.stateDraft")}
        </span>
        <span data-testid="ppt-artifact-version" className="text-xs text-muted-foreground" title={t('ppt.quality.review.versionHelp')}>{t('ppt.quality.review.version').replace('{draft}',String(project.revision)).replace('{published}',String(project.publishedRevision??'—')).replace('{render}',String(project.publishedRenderContractVersion??project.publishedRenderTree?.renderContractVersion??(project.quality?.exportVerification?.revision===project.publishedRevision?project.quality?.exportVerification?.renderContractVersion:undefined)??'—'))}</span>
        <details className="relative text-xs" data-testid="ppt-version-details"><summary className="cursor-pointer rounded-lg border border-border px-3 py-2">{t('ppt.version.details')}</summary><div className="absolute right-0 top-full z-50 mt-2 max-h-[70vh] w-[min(420px,90vw)] space-y-3 overflow-y-auto rounded-xl border border-border bg-background p-4 shadow-xl">
          <p className="text-muted-foreground">{t('ppt.quality.review.versionHelp')}</p>
          <dl className="space-y-1 break-all"><dt>{t('ppt.version.source')}</dt><dd>{project.versionDetails?.source?.parser||t('ppt.version.unknown')} · {project.versionDetails?.source?.implementationHash?.slice(0,12)||'—'}</dd><dt>{t('ppt.version.code')}</dt><dd>{project.versionDetails?.generation?.implementationHash?.slice(0,12)||t('ppt.version.unknown')}</dd><dt>{t('ppt.version.prompt')}</dt><dd>{project.versionDetails?.generation?.promptContractVersion??project.promptContractVersion??'—'}</dd><dt>SHA-256</dt><dd>{project.versionDetails?.sourceHash||'—'}</dd></dl>
          <p>{t('ppt.version.models')}</p>{project.versionDetails?.models?.length?<ul className="max-h-36 overflow-y-auto">{project.versionDetails.models.map((row,k)=><li key={k}>{row.stage} · {row.model}</li>)}</ul>:<p className="text-muted-foreground">{t('ppt.version.unknown')}</p>}
          <p className="text-muted-foreground">{t('ppt.version.republishHelp')}</p><button className={`${button} w-full`} disabled={generating||recreating} onClick={()=>void publishNow()}>{t('ppt.version.republish')}</button>
          <p className="text-muted-foreground">{t('ppt.version.reparseHelp')}</p><button data-testid="ppt-reparse-copy" className={`${button} w-full`} disabled={generating||recreating} onClick={async()=>{setRecreating(true);setError('');try{const value=await request('','','POST',{reparseFrom:project.id,baseRevision:project.revision});window.location.assign('/ppt?projectId='+encodeURIComponent(value.project.id));}catch(reason){setError((reason as Error).message);setRecreating(false);}}}>{recreating?t('ppt.loading'):t('ppt.version.reparse')}</button>
        </div></details>
        <div className="ml-auto flex flex-wrap items-center gap-1 md:gap-2"><button className={button} aria-expanded={!railCollapsed} aria-label={t('ppt.editor.toggleRail')} onClick={()=>setRailCollapsed(value=>!value)}>☷</button>{project.status==='failed'&&onFailureDetails&&<button className={button} onClick={onFailureDetails}>{t('ppt.failure.details')}</button>}{['failed','quality_blocked'].includes(project.status)&&<button className={button} onClick={()=>void direct('/retry')}>{t(project.status==='failed'?'ppt.retry':'ppt.media.recheck')}</button>}{['completed','quality_blocked'].includes(project.status)&&project.pageDecision?.mode==='explicit'&&!project.externalPptx&&<button className={button} onClick={()=>void direct('/page-policy',{mode:'auto',baseRevision:project.revision})}>{t('ppt.editor.autoPageBudget')}</button>}<button className={button} onClick={() => openInline(slide,selected?.nodeId||undefined,undefined,true)}>{t("ppt.edit.optimize")}</button>
          <button className={button} onClick={() => setTool("theme")}>
            ◐ <span className="hidden lg:inline">{t("ppt.editor.theme")}</span>
          </button>
          {aiCheck.result && <span role="status" data-testid="ppt-ai-check-result" className="hidden text-xs text-muted-foreground md:inline">{aiCheck.result}</span>}
          {cardDeck && <button data-testid="ppt-ai-check" className={button} disabled={generating || aiCheck.running || !['completed', 'quality_blocked'].includes(project.status)} title={t("ppt.ai.checkHint")} onClick={() => void runAiCheck()}>
            ✦ <span className="hidden sm:inline">{aiCheck.running ? t("ppt.ai.checking") : t("ppt.ai.check")}</span>
          </button>}
          <button
            data-testid="ppt-save-publish"
            className={saved ? button : primary}
            disabled={saved || generating || publishing}
            aria-busy={publishing}
            title={t("ppt.editor.savePublishHint")}
            onClick={() => void publishNow()}
          >
            {publishing ? "…" : "✓"} {t("ppt.editor.savePublish")}
          </button>
          <button className={primary} onClick={() => setPresenting(true)}>
            ▶ <span className="hidden sm:inline">{t("ppt.present")}</span>
          </button>
          <button className={button} disabled={generating} onClick={() => setExportOpen(true)}>
            ⇩ <span className="hidden sm:inline">{t("ppt.editor.export")}</span>
          </button>
        </div>
      </header>
      <PptTextToolbar key={`${slide.slideId}:${project.revision}:${selectedIds.join(',')}`} elements={selectedElements.filter(element => ['text', 'list', 'timeline', 'metric'].includes(element.kind))} fonts={Object.values(project.templateSpec?.fonts || {}).filter((font): font is string => typeof font === 'string')}
        disabledReason={generating&&!pageDone(slide.slideId)?t('ppt.editor.currentDraftReadonly'):undefined} onSelectTitle={()=>setSelectedIds(editableTextIds(slide.elements,'title'))} onSelectBody={()=>setSelectedIds(editableTextIds(slide.elements,'body'))} onSelectText={()=>setSelectedIds(editableTextIds(slide.elements,'all'))}
        onApply={patch => command('nodes.setStyle', { slideId: slide.slideId, changes: selectedElements.filter(element => ['text', 'list', 'timeline', 'metric'].includes(element.kind)).map(element => ({ nodeId: element.nodeId, style: patch, merge: true })) })}/>
      {paused && <p className="shrink-0 border-b border-border px-3 py-1 text-xs text-muted-foreground">{t('ppt.editor.pausedEditing')}</p>}
      {conversionOpen&&<div role="dialog" aria-modal="true" aria-label={t('ppt.template.convertCopy')} className="fixed inset-0 z-[90] grid place-items-center bg-black/60 p-4"><section className="max-w-lg space-y-4 rounded-xl bg-background p-5"><h2 className="font-semibold">{t('ppt.template.convertCopy')}</h2><p className="text-sm">{t('ppt.template.convertWarning')}</p><div className="flex justify-end gap-2"><button className={button} onClick={()=>setConversionOpen(false)}>{t('ppt.cancel')}</button><button className={primary} onClick={()=>void request(project.id,'/component-copy','POST',{baseRevision:project.revision}).then(result=>{setConversionOpen(false);accept(result.project);history.replaceState(null,'',`/ppt?projectId=${result.project.id}`);}).catch(error=>setError(error.message))}>{t('ppt.template.openCopy')}</button></div></section></div>}
      {blocked && !exportOpen && <div className="shrink-0 border-b border-destructive/30 px-4 py-2"><PublishBlockedList blockers={blocked} onPage={page => go(page - 1)} onClose={() => setBlocked(null)} /></div>}
      {error && (
        <div
          role="alert"
          className="flex shrink-0 items-center justify-between gap-3 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive"
        >
          <span>{pptFailureMessage(error, locale)}</span>
          {conflict && (
            <button className={button} onClick={() => void reload()}>
              {t("ppt.structured.reloadConflict")}
            </button>
          )}
        </div>
      )}
      <div style={{"--ppt-editor-rail":railCollapsed?"0px":`${railWidth}px`} as React.CSSProperties} className="ppt-editor-body ppt-editor-resizable relative grid min-h-0 flex-1 grid-cols-1">
        <aside
          className={`${railCollapsed?'invisible overflow-hidden p-0':'hidden md:block'} min-h-0 overflow-y-auto border-r border-border p-3`}
          aria-label={t("ppt.editor.thumbnails")}
        >
          <label className="mb-2 block text-xs text-muted-foreground">{t('ppt.editor.railWidth')}<input aria-label={t('ppt.editor.railWidth')} type="range" min={160} max={300} step={10} value={railWidth} className="w-full" onChange={event=>setRailWidth(Number(event.target.value))}/></label>
          <div className="flex items-center justify-between">
            <div className="flex rounded-lg border border-border p-1">
              <button
                className={`rounded px-2 py-1 ${thumbMode === "grid" ? "bg-accent" : ""}`}
                aria-label={t("ppt.editor.grid")}
                onClick={() => setThumbMode("grid")}
              >
                ▦
              </button>
              <button
                className={`rounded px-2 py-1 ${thumbMode === "list" ? "bg-accent" : ""}`}
                aria-label={t("ppt.editor.list")}
                onClick={() => setThumbMode("list")}
              >
                ☷
              </button>
            </div>
            <button
              className="grid h-8 w-8 place-items-center rounded-lg border border-border"
              aria-label={t("ppt.editor.closeEditor")}
              onClick={requestExit}
            >
              ×
            </button>
          </div>
          <button
            className="mt-3 w-full rounded-lg border border-dashed border-border px-2 py-2 text-sm hover:bg-accent"
            disabled={slides.length >= 100 || Boolean(preserveNative)}
            onClick={() =>
              void command("slide.insert", {
                index: page + 1,
                slide: {
                  title: t("ppt.newSlide"),
                  bullets: [],
                  blocks: [],
                  layoutId: "summary",
                },
              })
            }
          >
            ＋ {t("ppt.editor.newSlide")}
          </button>
          <div
            className={`mt-3 ${thumbMode === "grid" ? "grid grid-cols-1 gap-2" : "space-y-2"}`}
          >
            {(query
              ? matches
              : slides.map((item, index) => ({ item, index }))
            ).map(({ item, index }) => (
              <div
                key={item.id}
                draggable={!preserveNative}
                onDragStart={() => setDragSlide(index)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => {
                  if (dragSlide !== null) reorder(dragSlide, index);
                  setDragSlide(null);
                }}
                data-review-advisories={openAdvisories(item.slideId).length || undefined}
                className={`group relative rounded-lg border p-1 ${page === index ? "border-primary bg-primary/5" : "border-border"} ${openAdvisories(item.slideId).length ? "ring-2 ring-amber-500/70" : ""}`}
              >
                <button className="w-full text-left" onClick={() => go(index)}>
                  {openAdvisories(item.slideId).length > 0 && <span data-testid="ppt-thumb-advisory" role="img"
                    aria-label={t('ppt.advisory.thumbBadge').replace('{count}', String(openAdvisories(item.slideId).length))}
                    title={openAdvisories(item.slideId).map(entry => entry.issue.detail).join('\n')}
                    className="absolute left-2 top-2 z-10 rounded bg-amber-500 px-1.5 text-[10px] font-semibold leading-4 text-white shadow">⚑ {openAdvisories(item.slideId).length}</span>}
                  <div className="aspect-video overflow-hidden rounded bg-muted">
                    {item.elements.length > 0 || project.generationSkeletons?.[item.slideId] ? <img
                      alt=""
                      loading="lazy"
                      decoding="async"
                      src={`/api/ppt/projects/${project.id}/slides/${item.slideId}/preview?format=svg${!item.elements.length?'&draft=1':''}&v=${project.runtime?.slides[item.slideId]?.renderHash || project.renderTree?.hash || project.revision}`}
                      className="h-full w-full object-contain"
                    /> : <span className="flex h-full items-center justify-center text-xs text-muted-foreground">{t(`ppt.stage.${project.generationStages?.pages?.[item.slideId] || (project.nodes?.[item.slideId]?.status === "running" ? "writing" : "waiting")}` as TranslationKey)}</span>}
                  </div>
                  {generating&&<span className="block text-[10px] text-muted-foreground">{t(`ppt.stage.${project.generationStages?.pages?.[item.slideId]||'waiting'}` as TranslationKey)}</span>}
                  <span className="mt-1 block truncate text-xs">
                    {item.index + 1}.{" "}
                    {project.deck?.slides.find(
                      (value) => value.id === item.slideId,
                    )?.title || item.layoutId}
                  </span>
                </button>
                <div className="absolute right-1 top-1 hidden gap-1 group-hover:flex">
                  <button
                    className="rounded bg-background/90 px-1 text-xs"
                    aria-label={t("ppt.editor.duplicateSlide")}
                    disabled={structureLocked}
                    onClick={() =>
                      void command("slide.duplicate", { slideId: item.slideId })
                    }
                  >
                    ⧉
                  </button>
                  <button
                    className="rounded bg-background/90 px-1 text-xs text-destructive"
                    aria-label={t("ppt.editor.deleteSlide")}
                    disabled={
                      slides.length <= 1 || Boolean(preserveNative)
                    }
                    onClick={() =>
                      void command("slide.delete", { slideId: item.slideId })
                    }
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>
          {plannedPages.length > 0 && <ol className="mt-4 space-y-1 border-t border-border pt-3 text-xs text-muted-foreground" data-testid="ppt-planned-pages" aria-label={t('ppt.generation.plannedPages')}>
            <li className="font-medium text-foreground">{t('ppt.generation.plannedPages')}</li>
            {plannedPages.map(({ outline, index }) => <li key={outline.id} className="flex gap-1 truncate"><span>{index + 1}.</span><span className="truncate">{outline.title}</span><span className="ml-auto shrink-0">{t('ppt.stage.waiting')}</span></li>)}
          </ol>}
        </aside>
        <main
          className={`min-h-0 space-y-8 overflow-y-auto bg-background p-3 pb-20 md:p-6 md:pb-6 ${tool ? "md:mr-[23rem]" : ""}`}
          onWheel={() => onUserScroll?.()}
          onTouchMove={() => onUserScroll?.()}
          onKeyDown={event => { if (['PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'Home', 'End', ' '].includes(event.key)) onUserScroll?.(); }}
          ref={canvasRef}
          onScroll={event=>sessionStorage.setItem(`ppt-editor-scroll:${project.id}`,JSON.stringify({slideId:activeSlideId||slide?.slideId,scrollTop:event.currentTarget.scrollTop}))}
          id="ppt-editor-canvas"
        >
          <PptExecutionPanel key={project.id+String(project.executionPolicy?.qualityLevel)} project={project} onProject={onProject}/>
          <PptMediaRetirements key={project.id} project={project} onProject={onProject} onRecheck={()=>void direct('/retry')}/>
          {project.postWriterPlan && !generating && <details className="mx-auto max-w-6xl rounded border border-border p-3 text-xs" data-testid="ppt-postwriter-plan"><summary>{t('ppt.task.replanning')} · {project.postWriterPlan.mergeProposals.length}</summary><p className="my-2">{project.postWriterPlan.application}</p>{project.postWriterPlan.mergeProposals.map((proposal,index)=><p key={index} className="my-2">{proposal.slideIds.join(' + ')} · {proposal.layoutId} · {proposal.fontSizePt} pt · {proposal.reason}</p>)}<button className={button} onClick={()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(project.postWriterPlan,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='ppt-postwriter-plan.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}>{t('ppt.candidate.download')}</button></details>}
          {slide && project.runtime?.slides[slide.slideId]?.repairComparison && <details className="mb-4 rounded border border-border bg-card p-3" data-testid="ppt-repair-comparison"><summary>{t('ppt.stage.repairing')} · {slide.index+1}</summary><div className="mt-3 grid gap-3 md:grid-cols-2">{(['before','after'] as const).map(part=>{const comparison=project.runtime!.slides[slide.slideId].repairComparison!;return <figure key={part}><figcaption className="text-xs">{t(part==='before'?'ppt.edit.before':'ppt.edit.after')}</figcaption><img src={part==='before'?comparison.beforeUrl:comparison.afterUrl} alt={t(part==='before'?'ppt.edit.before':'ppt.edit.after')} className="w-full rounded border border-border"/></figure>;})}</div></details>}
          {slides.map((item, index) => (
            <article
              key={item.id}
              data-render-slide-id={item.id}
              ref={(node) => {
                refs.current[item.id] = node;
              }}
              className="mx-auto scroll-m-6"
              style={{ width: `${zoom}%`, maxWidth: "72rem" }}
              onFocus={() => choosePage(index)}
              onClick={() => choosePage(index)}
            >
              <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {t("ppt.structured.slide")} {item.index + 1}
                  {generating && project.generationStages?.pages?.[item.slideId] === "repairing" && <span data-testid="ppt-page-repairing" className="ml-2 rounded bg-primary/10 px-2 py-0.5 text-primary">{t("ppt.stage.repairing")}</span>}
                </span>
                <div className="flex items-center gap-3">
                  {page === index && <span>{t("ppt.structured.editing")}</span>}
                  {!generating && (advisoriesBySlide.get(item.slideId)?.length ?? 0) > 0 && <button type="button" data-testid="ppt-slide-advisory-toggle" aria-expanded={advisoryPanel === item.slideId}
                    className={`rounded border px-2 py-1 ${openAdvisories(item.slideId).length ? 'border-amber-500/50 bg-amber-500/15 text-amber-800 dark:text-amber-200' : 'border-border hover:bg-accent'}`}
                    onClick={(event) => { event.stopPropagation(); choosePage(index); setAdvisoryPanel(current => current === item.slideId ? null : item.slideId); }}>
                    ⚑ {openAdvisories(item.slideId).length ? t('ppt.advisory.slideBadge').replace('{count}', String(openAdvisories(item.slideId).length)) : t('ppt.advisory.reviewed').replace('{count}', String(advisoriesBySlide.get(item.slideId)!.length))}
                  </button>}
                  <button className="rounded border border-border px-2 py-1 hover:bg-accent"
                    onClick={(event) => { event.stopPropagation(); choosePage(index); setSelectedIds([]); openInline(item); }}>
                    ✎ {t("ppt.editor.ai")}
                  </button>
                </div>
              </div>
              {generating && project.runtime?.slides?.[item.slideId]?.phase!=='render_ready' && (!item.elements.length||Boolean(currentGenerationDraft(project,item.slideId,(drafts||project.drafts)?.[item.slideId]))) && <GenerationSkeleton project={project} index={item.index}
                slide={project.outline?.find(outlineSlide => outlineSlide.id === (item.slideId || item.id))}
                stage={generationPageStage(project,item.slideId||item.id)}
                draft={currentGenerationDraft(project,item.slideId,(drafts || project.drafts)?.[item.slideId])} />}
              {generating && item.elements.length>0 && project.runtime?.slides?.[item.slideId||item.id]?.componentCommit && project.runtime?.slides?.[item.slideId || item.id]?.phase !== 'render_ready' && <p data-testid="ppt-source-component-committed" className="mb-2 text-xs text-muted-foreground">{t('ppt.skeleton.sourceCommitted')}</p>}
              {!(generating && project.runtime?.slides?.[item.slideId]?.phase!=='render_ready' && (!item.elements.length||Boolean(currentGenerationDraft(project,item.slideId,(drafts||project.drafts)?.[item.slideId])))) && (nearbySlides.has(item.id)||page===index ? <PptCanvas
                key={item.id}
                {...canvasProps}
                slide={item}
                readOnly={generating && project.runtime?.slides?.[item.slideId || item.id]?.phase !== 'render_ready'}
                advisories={generating ? undefined : advisoryNodes(item.slideId)}
                selectedIds={page === index ? selectedIds : []}
                onSelectionComplete={element=>openInline(item,element.nodeId||undefined)}
                onTextSelection={(element,start,end,text)=>{if(element.kind==='text'&&element.nodeId){const target={nodeId:element.nodeId,kind:'range',start,end,expectedText:text};setTextTarget(target);openInline(item,element.nodeId,target);}}}
                onSelect={(id, additive) => {
                  choosePage(index);
                  select(id, additive);
                }}
                onSelectMany={(ids) => {
                  choosePage(index);
                  setSelectedIds(ids);
                }}
                onGeometry={(changes) => moveGeometry(item.slideId, changes)}
                onRotation={(element, rotation) =>
                  void command("node.setRotation", {
                    slideId: item.slideId,
                    nodeId: element.nodeId,
                    rotation,
                  }, element.nodeId ? [{ nodeId: element.nodeId, rotation }] : [])
                }
                onContent={(element, text) =>
                  inlineContent(item.slideId, element, text)
                }
                onAction={(action, element) => act(item, action, element)}
              /> : <div className="aspect-video overflow-hidden rounded bg-muted" data-testid="ppt-deferred-canvas"><img alt="" loading="lazy" decoding="async" className="h-full w-full object-contain" src={`/api/ppt/projects/${project.id}/slides/${item.slideId}/preview?format=svg&v=${project.runtime?.slides[item.slideId]?.renderHash||project.renderTree?.hash||project.revision}`}/></div>)}
              {/* Below the canvas: selecting a flagged object must not move the slide under the pointer. */}
              {!generating && renderAdvisories(item, index)}
              {index < slides.length - 1 && !preserveNative && (
                <button className="mx-auto mt-5 block rounded-full border border-dashed border-border px-4 py-1.5 text-xs text-muted-foreground hover:border-primary hover:text-primary"
                  onClick={(event) => {
                    event.stopPropagation();
                    void command("slide.insert", { index: index + 1, slide: {
                      title: t("ppt.newSlide"), bullets: [], blocks: [], layoutId: "summary",
                    } });
                  }}>
                  ＋ {t("ppt.editor.newSlide")}
                </button>
              )}
            </article>
          ))}
        </main>
        <aside
          className="fixed bottom-10 left-0 right-0 z-20 flex items-center justify-center gap-2 border-t border-border bg-background/95 p-2 md:static md:flex-col md:justify-start md:border-l md:border-t-0"
          aria-label={t("ppt.editor.insertTools")}
        >
          {tools.map((item) => (
            <button
              key={item.id}
              className={`grid h-9 w-9 place-items-center rounded border text-xs ${tool === item.id ? "border-primary bg-primary/10 text-primary" : "border-border"}`}
              title={item.label}
              aria-label={item.label}
              onClick={() =>
                setTool((current) => (current === item.id ? null : item.id))
              }
            >
              {item.icon}
            </button>
          ))}
        </aside>
      </div>
      <div className="ppt-editor-status flex h-10 shrink-0 items-center gap-3 border-t border-border px-4 text-xs">
        <button onClick={() => setZoom((value) => Math.max(50, value - 10))}>
          −
        </button>
        <span>{zoom}%</span>
        <button onClick={() => setZoom((value) => Math.min(160, value + 10))}>
          ＋
        </button>
        <div className="h-1.5 flex-1 overflow-hidden rounded bg-muted">
          <i
            className="block h-full bg-primary"
            style={{
              width: `${Math.round((((slide?.index ?? page) + 1) / (project.outline.length || slides.length)) * 100)}%`,
            }}
          />
        </div>
        <span>
          {(slide?.index ?? page) + 1}/{project.outline.length || slides.length}
        </span>
      </div>

      {tool && (
        <>
          <button
            className="fixed inset-0 z-[71] cursor-default bg-black/10"
            aria-label={t("ppt.editor.closeTool")}
            onClick={() => setTool(null)}
          />
          <aside className="fixed bottom-0 left-0 right-0 top-[28%] z-[72] overflow-y-auto border-l border-border bg-background p-5 shadow-2xl md:bottom-0 md:left-auto md:top-16 md:w-[23rem]">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="font-semibold">
                  {tools.find((item) => item.id === tool)?.label ||
                    t("ppt.editor.theme")}
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("ppt.structured.slide")} {(slide?.index ?? page) + 1}
                </p>
                {pointLayout && (
                  <p className={`mt-2 text-xs ${pointLayout.overflow ? "text-destructive" : "text-muted-foreground"}`} role={pointLayout.overflow ? "alert" : undefined}>
                    {t("ppt.editor.pointCapacity", { count: pointCount, size: pointLayout.fontSizePt, columns: pointLayout.columns })}
                    {pointLayout.overflow && ` · ${t("ppt.editor.pointOverflow", { count: pointLayout.suggestedSplitCount || 2 })}`}
                  </p>
                )}
              </div>
              <button
                className="grid h-8 w-8 place-items-center rounded border border-border"
                aria-label={t("ppt.editor.close")}
                onClick={() => setTool(null)}
              >
                ×
              </button>
            </div>
            <div className="mt-5 space-y-4">
              {tool === "search" && (
                <label className="block space-y-2 text-sm">
                  {t("ppt.editor.searchSlides")}
                  <input
                    autoFocus
                    className={field}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </label>
              )}
              {tool === "theme" && (
                <>
                  <div className="rounded-lg border border-border p-4">
                    <b>{project.templateSpec?.name || project.template}</b>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {t("ppt.editor.themeHelp")}
                    </p>
                    {project.templateSpec?.fonts && (
                      <p className="mt-3 text-xs">
                        {t("ppt.editor.titleFont")}:{" "}
                        {project.templateSpec.fonts.title || project.templateSpec.fonts.titleEastAsia}
                        {project.templateSpec.fonts.titleEastAsia && project.templateSpec.fonts.titleEastAsia!==project.templateSpec.fonts.title && ` · ${t('ppt.inspector.eastAsiaFontFamily')}: ${project.templateSpec.fonts.titleEastAsia}`}
                        <br />
                        {t("ppt.editor.bodyFont")}:{" "}
                        {project.templateSpec.fonts.body || project.templateSpec.fonts.bodyEastAsia}
                        {project.templateSpec.fonts.bodyEastAsia && project.templateSpec.fonts.bodyEastAsia!==project.templateSpec.fonts.body && ` · ${t('ppt.inspector.eastAsiaFontFamily')}: ${project.templateSpec.fonts.bodyEastAsia}`}
                      </p>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      {
                        background: "#181818",
                        foreground: "#f7f7f7",
                        muted: "#c9c9c9",
                        accent: "#9b8cff",
                      },
                      {
                        background: "#ffffff",
                        foreground: "#181818",
                        muted: "#555b66",
                        accent: "#6758c8",
                      },
                      {
                        background: "#10233f",
                        foreground: "#ffffff",
                        muted: "#cad7ea",
                        accent: "#50b7ff",
                      },
                    ].map((palette, index) => (
                      <button
                        key={index}
                        className="aspect-video rounded-lg border border-border"
                        style={{
                          background: palette.background,
                          color: palette.foreground,
                        }}
                        disabled={structureLocked}
                        onClick={() =>
                          void command("theme.setPalette", { palette })
                        }
                      >
                        Aa
                      </button>
                    ))}
                  </div>
                  <div className="space-y-2 rounded-lg border border-border p-4">
                    <strong className="text-sm">{t("ppt.editor.restyle")}</strong>
                    <p className="text-xs text-muted-foreground">{t("ppt.editor.restyleHelp")}</p>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { label: "ppt.editor.restyleCompact", tokens: { titleScale: 1, bodyScale: 1, spacingScale: 0.95 } },
                        { label: "ppt.editor.restyleBalanced", tokens: { titleScale: 1, bodyScale: 1, spacingScale: 1 } },
                        { label: "ppt.editor.restyleComfortable", tokens: { titleScale: 1.05, bodyScale: 1.08, spacingScale: 1.12 } },
                      ].map(({ label, tokens }) => (
                        <button key={label} className={button} disabled={structureLocked}
                          aria-pressed={JSON.stringify(project.deck?.themeTokens || { titleScale: 1, bodyScale: 1, spacingScale: 1 }) === JSON.stringify(tokens)}
                          onClick={() => void command("theme.setTokens", { tokens })}>
                          {t(label as never)}
                        </button>
                      ))}
                    </div>
                  </div>
                  <button
                    className={`${button} w-full`}
                    onClick={() => setVersionsOpen(true)}
                  >
                    {t("ppt.structured.versionHistory")}
                  </button>
                </>
              )}
              {tool === "format" &&
                (selected ? (
                  <PptInspector
                    key={`${selected.id}-${project.revision}`}
                    element={selected}
                    slideId={slide.slideId}
                    onCommand={commandVoid}
                    onAi={() => openInline(slide,selected?.nodeId||undefined,undefined,true)}
                    allowStructure={!generating}
                    fonts={Object.values(project.templateSpec?.fonts || {}).filter((font): font is string => typeof font === "string")}
                  />
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground">
                      {t("ppt.structured.selectObject")}
                    </p>
                    <button
                      className={`${button} w-full`}
                      disabled={structureLocked}
                      onClick={() =>
                        insertNode("text", { text: t("ppt.editor.newText") })
                      }
                    >
                      ＋ {t("ppt.editor.addText")}
                    </button>
                  </>
                ))}
              {tool === "image" && (
                <label className="block cursor-pointer rounded-xl border border-dashed border-border p-8 text-center text-sm">
                  ▧
                  <strong className="mt-2 block">
                    {selected?.kind === "image"
                      ? t("ppt.editor.replaceImage")
                      : t("ppt.editor.chooseImage")}
                  </strong>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    PNG / JPEG · 8 MB
                  </span>
                  <input
                    className="sr-only"
                    type="file"
                    accept="image/png,image/jpeg"
                    disabled={structureLocked}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file)
                        void insertImage(file, selected?.kind === "image");
                    }}
                  />
                </label>
              )}
              {tool === "layout" && tableForm && <div className="mb-3 space-y-2 rounded-xl border border-border p-3" data-testid="ppt-table-form"><p className="text-xs text-muted-foreground">{t(tableForm.next==='table'?'ppt.editor.tableAsCardsHint':'ppt.editor.tableAsTableHint')}</p><button className={`${button} w-full`} disabled={generating||Boolean(project.externalPptx)||tableFormBusy} onClick={()=>void switchTableForm()}>{t(tableForm.next==='table'?'ppt.editor.showAsTable':'ppt.editor.showAsCards')}</button></div>}
              {tool === "layout" && preserveNative && <div className="space-y-3"><p className="text-sm">{t('ppt.editor.nativeLayout')}</p><button data-testid="ppt-smart-layout" disabled={aiBusy||!localAiReady||(generating&&!paused)} className={`${button} w-full`} onClick={()=>{setInlineAi({slideId:slide.slideId,revision:project.revision});void proposeAi('slide','layout',true);}}>{t('ppt.inline.nativeLayout')}</button><button className={`${button} w-full`} onClick={() => setSelectedIds(slide.elements.filter(element => element.nodeId && !element.locked && !['title','template-title','eyebrow'].includes(element.semanticRole || '')).map(element => element.nodeId!))}>{t('ppt.editor.selectBodyObjects')}</button><button className={`${button} w-full`} onClick={() => setTool('arrange')}>{t('ppt.editor.arrangeObjects')}</button><button disabled={generating&&!paused} className={`${button} w-full`} onClick={()=>setConversionOpen(true)}>{t('ppt.template.convertCopy')}</button></div>}
              {tool === "layout" && !preserveNative && (
                <div className="grid grid-cols-2 gap-2">
                  {layouts.map((value) => (
                    <button
                      key={value}
                      className={`${slide.layoutId === value ? primary : button} text-left`}
                      disabled={structureLocked}
                      onClick={() =>
                        void command("slide.setLayout", {
                          slideId: slide.slideId,
                          layoutId: value,
                        })
                      }
                    >
                      {t(`ppt.layout.${value}` as never)}
                    </button>
                  ))}
                </div>
              )}
              {tool === "shape" && (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    className={button}
                    disabled={structureLocked}
                    onClick={() =>
                      insertNode("shape", { text: "", shape: "rect" })
                    }
                  >
                    {t("ppt.m4.rectangle")}
                  </button>
                  <button
                    className={button}
                    disabled={structureLocked}
                    onClick={() =>
                      insertNode("shape", { text: "", shape: "ellipse" })
                    }
                  >
                    {t("ppt.m4.ellipse")}
                  </button>
                </div>
              )}
              {tool === "chart" && (
                <button
                  className={`${button} w-full`}
                  disabled={structureLocked}
                  onClick={() =>
                    insertNode("chart", {
                      chartType: "bar",
                      labels: ["A", "B", "C"],
                      values: [42, 68, 55],
                      unit: "",
                    })
                  }
                >
                  ＋ {t("ppt.editor.addChart")}
                </button>
              )}
              {tool === "table" && (
                <button
                  className={`${button} w-full`}
                  disabled={structureLocked}
                  onClick={() =>
                    insertNode("table", {
                      rows: [
                        [
                          t("ppt.editor.item"),
                          t("ppt.editor.current"),
                          t("ppt.editor.target"),
                        ],
                        ["A", "42", "60"],
                        ["B", "68", "80"],
                      ],
                    })
                  }
                >
                  ＋ {t("ppt.editor.addTable")}
                </button>
              )}
              {tool === "arrange" && (
                <>
                  <p className="text-xs text-muted-foreground">
                    {t("ppt.editor.selectedCount", {
                      count: selectedIds.length,
                    })}
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    {(
                      [
                        "left",
                        "center",
                        "right",
                        "top",
                        "middle",
                        "bottom",
                        "horizontal",
                        "vertical",
                      ] as const
                    ).map((kind) => (
                      <button
                        key={kind}
                        className={button}
                        disabled={
                          selectedElements.length < 2 ||
                          ((kind === "horizontal" || kind === "vertical") &&
                            selectedElements.length < 3)
                        }
                        onClick={() => align(kind)}
                      >
                        {t(`ppt.editor.align.${kind}` as never)}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      className={button}
                      disabled={
                        selectedIds.length < 2 || Boolean(preserveNative)
                      }
                      onClick={() =>
                        void command("nodes.group", {
                          slideId: slide.slideId,
                          nodeIds: selectedIds,
                        })
                      }
                    >
                      {t("ppt.editor.group")}
                    </button>
                    <button
                      className={button}
                      disabled={
                        !selectedIds.length || Boolean(preserveNative)
                      }
                      onClick={() =>
                        void command("nodes.ungroup", {
                          slideId: slide.slideId,
                          nodeIds: selectedIds,
                        })
                      }
                    >
                      {t("ppt.editor.ungroup")}
                    </button>
                  </div>
                </>
              )}
              {tool === "ai" && (
                <>
                  {!localAiReady && <p role="status" className="text-sm text-muted-foreground">{t("ppt.edit.waitValidatedPage")}</p>}
                  <label className="block space-y-2 text-sm">{t("ppt.edit.target")}
                    <PptSelect className={field} ariaLabel={t("ppt.edit.target")} value={aiSlideId||slide.slideId} disabled={aiBusy||Boolean(aiProposal)} onValueChange={value=>{setInlineAi(null);setTextTarget(null);setPage(slides.findIndex(item=>item.slideId===value));setSelectedIds([]);}} options={slides.map((item,index)=>({value:item.slideId,label:`${index+1}. ${item.elements.find(element=>['title','template-title'].includes(element.semanticRole||''))?.content?.text||project.outline?.find(o=>o.id===item.slideId)?.title||t('ppt.slide')+' '+(index+1)}`}))}/>

                  </label>
                  <label className="block space-y-2 text-sm">{t('ppt.mutation.type')}<PptSelect className={field} ariaLabel={t('ppt.mutation.type')} disabled={aiBusy||Boolean(aiProposal)} value={aiMode} onValueChange={value=>{setAiMode(value as PptMutationType);setAiAction('custom');}} options={(['auto','title','content','layout','style','data','structure'] as const).map(type=>({value:type,label:t(`ppt.mutation.${type}`),disabled:Boolean(preserveNative)&&['layout','data','structure'].includes(type)}))}/></label>
                  <button className={button} disabled={aiBusy} onClick={async () => { try { const value = await request(project.id, `/slides/${slide.slideId}/accept`, 'POST', { accepted: !project.runtime?.slides[slide.slideId]?.accepted, renderHash: project.runtime?.slides[slide.slideId]?.renderHash, baseRevision: project.revision }); accept(value.project); } catch (reason) { setError(String((reason as Error).message)); } }}>{t(project.runtime?.slides[slide.slideId]?.accepted ? 'ppt.runtime.unlock' : 'ppt.runtime.accept')}</button>
                  <div className="flex flex-wrap gap-2">{(['shorten', 'enrich', 'executive', 'conclusion', 'columns'] as const).map(preset => <button key={preset} className={button} disabled={aiBusy || Boolean(aiProposal) || (preset === 'columns' && preserveNative)} onClick={() => { setAiAction('custom'); setInstruction(t(`ppt.edit.${preset}Prompt`)); setAiMode(preset === "columns" ? "layout" : "content"); }}>{t(`ppt.edit.${preset}`)}</button>)}</div>
                  <label className="block space-y-2 text-sm">{t('ppt.ai.action')}<PptSelect className={field} ariaLabel={t('ppt.ai.action')} disabled={aiBusy||Boolean(aiProposal)} value={aiAction} onValueChange={action=>{setAiAction(action);if(action!=='custom'){setAiMode('content');setInstruction(t(`ppt.ai.${action}` as never));}}} options={['custom','improve','grammar','translate','expand','shorten','simplify','specific'].map(action=>({value:action,label:t(`ppt.ai.${action}` as never)}))}/></label>
                  {aiAction === 'translate' && <div className="space-y-2"><label className="block text-sm">{t('ppt.ai.language')}<PptSelect className={field} ariaLabel={t('ppt.ai.language')} value={aiLanguage} disabled={aiBusy||Boolean(aiProposal)} onValueChange={setAiLanguage} options={['en','zh','zh-Hant','ja','ko','de','fr','es'].map(value=>({value,label:t(`ppt.ai.lang.${value}` as never)}))}/></label><PptSelect ariaLabel={t('ppt.ai.translationMode')} className={field} value={aiTranslationMode} disabled={aiBusy||Boolean(aiProposal)} onValueChange={setAiTranslationMode} options={[{value:'replace',label:t('ppt.ai.replace')},{value:'bilingual',label:t('ppt.ai.bilingual')}]}/><input className={field} aria-label={t('ppt.ai.region')} placeholder={t('ppt.ai.region')} maxLength={120} value={aiRegion} disabled={aiBusy || Boolean(aiProposal)} onChange={event => setAiRegion(event.target.value)}/><textarea className={field} aria-label={t('ppt.ai.glossary')} placeholder={t('ppt.ai.glossary')} maxLength={1000} value={aiGlossary} disabled={aiBusy || Boolean(aiProposal)} onChange={event => setAiGlossary(event.target.value)}/></div>}
                  {aiAction === 'expand' && <label className="block space-y-2 text-sm">{t('ppt.ai.ratio')}<PptSelect className={field} ariaLabel={t('ppt.ai.ratio')} value={String(aiRatio)} disabled={aiBusy||Boolean(aiProposal)} onValueChange={value=>setAiRatio(Number(value))} options={[1.5,2,3].map(value=>({value:String(value),label:`≈ ${value}×`}))}/></label>}
                  {selected?.kind==='text'&&<textarea readOnly aria-label={t('ppt.target.selectText')} className={`${field} min-h-24 text-xs`} value={selected.content?.richText?.source??selected.content?.rawText??selected.content?.text??''} onSelect={event=>freezeSourceSelection(event.currentTarget)} onMouseUp={event=>freezeSourceSelection(event.currentTarget)} onKeyUp={event=>freezeSourceSelection(event.currentTarget)} onKeyDown={sourceSelectionKey}/>}
                  {selected?.kind==='text'&&(selected.content?.richText?.source??selected.content?.rawText??selected.content?.text??'').split('\n').filter(Boolean).length>1&&<div className="flex flex-wrap gap-1">{(selected.content?.richText?.source??selected.content?.rawText??selected.content?.text??'').split('\n').map((paragraph,index)=>paragraph.trim()?<button key={index} className={`${button} text-xs`} disabled={aiBusy||Boolean(aiProposal)} onClick={()=>selected.nodeId&&setTextTarget({nodeId:selected.nodeId,kind:'paragraph',paragraphIndex:index,expectedText:paragraph})}>{index+1}. {paragraph.slice(0,35)}</button>:null)}</div>}
                  {selected?.content?.items?.map(item=><button key={item.id} className={`${button} mr-1 text-xs`} disabled={aiBusy||Boolean(aiProposal)} onClick={()=>selected.nodeId&&setTextTarget({nodeId:selected.nodeId,kind:selected.content?.pointLayout?'graph-node':'item',itemId:item.id,expectedText:item.richText?.source??item.text})}>{item.heading||item.text.slice(0,40)}</button>)}
                  {textTarget&&<div data-testid="ppt-ai-target" className="rounded border border-primary p-2 text-xs"><b>{t('ppt.target.selected')} · {textTarget.kind}</b><p className="max-h-24 overflow-auto whitespace-pre-wrap">{textTarget.expectedText}</p><button onClick={()=>setTextTarget(null)}>{t('ppt.cancel')}</button></div>}
                  {preserveNative && <p className="text-xs text-muted-foreground">{t("ppt.edit.nativeReason")}</p>}
                  {lastAiOperation && <button className={button} disabled={aiBusy} onClick={() => void undoAi()}>{t("ppt.edit.undoEdit")}</button>}
                  <label className="block space-y-2 text-sm">
                    {t("ppt.editor.instruction")}
                    <textarea
                      className={`${field} min-h-28`}
                      value={instruction}
                      maxLength={1000}
                      disabled={aiBusy || Boolean(aiProposal)}
                      onChange={(event) => setInstruction(event.target.value)}
                      placeholder={t("ppt.structured.aiPlaceholder")}
                    />
                  </label>
                  <div className="grid gap-2">
                    <button
                      className={primary}
                      disabled={
                        !instruction.trim() ||
                        !selected || !localAiReady ||
                        selected.kind === "image" ||
                        aiBusy || Boolean(aiProposal)
                      }
                      onClick={() => void proposeAi("object")}
                    >
                      {t("ppt.editor.previewObjectAi")}
                    </button>
                    <button
                      className={button}
                      disabled={!instruction.trim() || aiBusy || Boolean(aiProposal) || !localAiReady || liveEditing && !["auto","content","title"].includes(aiMode)}
                      onClick={() => void proposeAi("slide", aiMode)}
                    >
                      {t("ppt.structured.aiEditSlide")}
                    </button>
                    <button
                      className={button}
                      disabled={!instruction.trim() || aiBusy || preserveNative || Boolean(aiProposal) || liveEditing}
                      onClick={() => void proposeAi("slide", "layout")}
                    >
                      {t("ppt.editor.aiRelayout")}
                    </button>
                    {aiMode === 'style' && !preserveNative && <button className={button} disabled={!instruction.trim() || aiBusy || Boolean(aiProposal)} onClick={() => void proposeAi('deck', 'style')}>{t('ppt.mutation.deckStyle')}</button>}
                    {selected?.kind === "image" && (
                      <button
                        className={button}
                        disabled={!instruction.trim() || aiBusy || Boolean(aiProposal) || preserveNative}
                        onClick={() => void generateImage()}
                      >
                        {t("ppt.editor.aiImage")}
                      </button>
                    )}
                  </div>
                  {aiProposal && (
                    <div className="rounded-xl border border-primary/40 bg-primary/5 p-3">
                      <b className="text-sm">{t("ppt.editor.aiPreview")}</b>
                      <AiBeforeAfterPreview proposal={aiProposal}/>
                      <AiCandidateControls key={aiProposal.id} proposal={aiProposal} busy={aiBusy} onSelect={async id=>{setAiBusy(true);try{setAiProposal((await request(project.id,`/proposals/${id}`)).proposal);}finally{setAiBusy(false);}}} onRevise={async data=>{setAiBusy(true);try{setAiProposal((await request(project.id,`/proposals/${aiProposal.id}/revise`,'POST',data)).proposal);}finally{setAiBusy(false);}}}/>
                      <div className="mt-3 grid grid-cols-2 gap-2"><button className={button} disabled={aiBusy} onClick={() => { void discardAi(); }}>{t("ppt.cancel")}</button>
                        <button
                          className={button}
                          disabled={aiBusy}
                          onClick={() => void discardAi()}
                        >
                          {t("ppt.edit.adjust")}
                        </button>
                        <button
                          className={primary}
                          disabled={aiBusy}
                          onClick={() => void applyAi()}
                        >
                          {t("ppt.editor.applyAi")}
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
              {selected && !["format", "ai"].includes(tool) && (
                <div className="border-t border-border pt-4">
                  <PptInspector
                    key={`${selected.id}-${project.revision}`}
                    element={selected}
                    slideId={slide.slideId}
                    onCommand={commandVoid}
                    onAi={() => openInline(slide,selected?.nodeId||undefined,undefined,true)}
                    allowStructure={!generating}
                  />
                </div>
              )}
              <details className="border-t border-border pt-4">
                <summary className="cursor-pointer text-xs text-muted-foreground">
                  {t("ppt.editor.undoHistory")}
                </summary>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    className={button}
                    onClick={() => void direct("/undo")}
                  >
                    {t("ppt.m4.undo")}
                  </button>
                  <button
                    className={button}
                    onClick={() => void direct("/redo")}
                  >
                    {t("ppt.m4.redo")}
                  </button>
                </div>
                <PptHistory
                  projectId={project.id}
                  revision={project.revision}
                />
              </details>
            </div>
          </aside>
        </>
      )}
      {/* The composer is portaled above the editor; the modal exit dialog must not sit under it. */}
      {inlineAi&&!exitOpen&&!presenting&&tool!=='ai'&&<SelectionAiComposer targetLabel={`${inlineAi.nodeIds?.length?inlineAi.nodeIds.length+' × ':''}${t(inlineAi.advisory?'ppt.advisory.composerTarget':inlineAi.target?.kind==='item'||inlineAi.target?.kind==='graph-node'?'ppt.inline.member':inlineAi.target?'ppt.inline.range':inlineAi.nodeId?'ppt.inline.component':'ppt.inline.page')} · ${slides.findIndex(s=>s.slideId===inlineAi.slideId)+1}`} quote={inlineAi.advisory?.suggestedFix||inlineAi.target?.expectedText||slides.find(s=>s.slideId===inlineAi.slideId)?.elements.find(n=>n.nodeId===inlineAi.nodeId)?.content?.text} anchor={inlineAnchor} instruction={instruction} onInstruction={setInstruction} busy={aiBusy} proposal={aiProposal} error={error?pptFailureMessage(error,locale):''} disabled={!localAiReady||Boolean(inlineAi.nodeId&&slides.find(s=>s.slideId===inlineAi.slideId)?.elements.find(n=>n.nodeId===inlineAi.nodeId)?.locked)||inlineAi.revision!==project.revision} onSend={()=>void proposeAi(inlineAi.nodeId?'object':'slide')} onClose={()=>{void discardAi();setInlineAi(null);}} onApply={()=>void applyAi()} onDiscard={()=>void discardAi()} onAdvanced={()=>setTool('ai')} onUndo={lastAiOperation?()=>void undoAi():undefined} onNativeLayout={preserveNative?()=>{if(!instruction.trim())setInstruction(t('ppt.inline.nativeLayout'));void proposeAi(inlineAi.nodeId?'object':'slide','layout',true);}:undefined} onRevise={async data=>{setAiBusy(true);try{setAiProposal((await request(project.id,`/proposals/${aiProposal!.id}/revise`,'POST',data)).proposal);}finally{setAiBusy(false);}}} onSelectCandidate={async id=>{setAiBusy(true);try{setAiProposal((await request(project.id,`/proposals/${id}`)).proposal);}finally{setAiBusy(false);}}} onPreset={action=>{setAiAction(action);setAiMode('content');setInstruction(t(`ppt.ai.${action}`));}}
        advisories={inlineAi.advisory||!inlineAi.nodeId||inlineAi.target?undefined:openAdvisories(inlineAi.slideId).filter(entry=>entry.issue.id&&entry.nodeId===inlineAi.nodeId).map(({issue})=>({id:issue.id!,label:advisoryLabel(issue.code),detail:issue.detail||'',suggestedFix:issue.suggestedFix}))}
        onApplyAdvisory={id=>{const entry=openAdvisories(inlineAi.slideId).find(item=>item.issue.id===id),owner=slides.find(item=>item.slideId===inlineAi.slideId);if(entry&&owner)void applyAdvisory(owner,entry.issue,entry.nodeId);}}
        onDismissAdvisory={id=>void decideAdvisory(id,'dismissed')}/>}
      {presenting && (
        <div className="fixed inset-0 z-[90] flex flex-col bg-black p-4">
          <div className="mb-3 flex justify-between text-sm text-white">
            <span>▶ {project.title}</span>
            <span>
              {(slide?.index ?? page) + 1} / {project.outline.length || slides.length}
            </span>
            <button
              className="rounded border border-white/40 px-3 py-1"
              onClick={() => setPresenting(false)}
            >
              {t("ppt.structured.exit")}
            </button>
          </div>
          <div className="m-auto w-full max-w-6xl">
            <PptCanvas
              {...canvasProps}
              selectedIds={[]}
              onSelect={() => {}}
              onSelectMany={() => {}}
              onGeometry={() => {}}
              onRotation={() => {}}
              onContent={() => {}}
              onAction={() => {}}
              readOnly
            />
          </div>
          <div className="flex justify-center gap-3">
            <button
              className="rounded border border-white/40 px-4 py-2 text-white"
              disabled={page === 0}
              onClick={() => setPage((value) => value - 1)}
            >
              ←
            </button>
            <button
              className="rounded border border-white/40 px-4 py-2 text-white"
              disabled={page === slides.length - 1}
              onClick={() => setPage((value) => value + 1)}
            >
              →
            </button>
          </div>
        </div>
      )}
      {exportOpen && (
        <div
          className="fixed inset-0 z-[90] grid place-items-center bg-black/55 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-xl bg-background p-6">
            <h3 className="font-semibold">{t("ppt.structured.exportTitle")}</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {t("ppt.structured.exportHelp")}
            </p>
            {project.quality?.report?.status === "needs_review" && (
              <p className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-sm text-foreground" role="status">
                {t("ppt.quality.editorialReviewNeeded")}
              </p>
            )}
            {(project.quality?.reviewAdvisories ?? 0) > 0 && (
              <p className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-sm text-foreground" role="status" data-testid="ppt-export-review-advisories">
                {t("ppt.quality.reviewAdvisories").replace("{count}", String(project.quality?.reviewAdvisories))}
              </p>
            )}
            {project.quality?.acceptanceAxes?.nativeExport?.renderedVisibility === "unavailable" && (
              <p className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-sm text-foreground" role="status" data-testid="ppt-export-visibility-unverified">
                {t("ppt.quality.renderedVisibilityUnavailable")}
              </p>
            )}
            {!saved && (
              <p className="mt-2 text-xs text-destructive">
                {t("ppt.editor.publishBeforeExport")}
              </p>
            )}
            {!saved && blocked && <div className="mt-3"><PublishBlockedList blockers={blocked} onPage={page => { setExportOpen(false); go(page - 1); }} /></div>}
            <div className="mt-5 grid gap-2">
              {!saved && <button type="button" data-testid="ppt-publish-then-export" className={primary} disabled={generating || publishing} aria-busy={publishing} onClick={() => void publishNow()}>{t("ppt.editor.publishThenExport")}</button>}
              {saved ? <a
                className={primary}
                href={`/api/ppt/projects/${project.id}/export`}
                download
              >
                {t("ppt.structured.editablePptx")}
              </a> : <button type="button" className={`${primary} opacity-50`} disabled>{t("ppt.structured.editablePptx")}</button>}
              {saved ? <a
                className={button}
                href={`/api/ppt/projects/${project.id}/pdf`}
                download
              >
                PDF
              </a> : <button type="button" className={`${button} opacity-50`} disabled>PDF</button>}
            </div>
            <button
              className={`${button} mt-4 w-full`}
              onClick={() => setExportOpen(false)}
            >
              {t("ppt.editor.close")}
            </button>
          </div>
        </div>
      )}
      {exitOpen && <div className="fixed inset-0 z-[95] grid place-items-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label={t("ppt.editor.unsavedExitTitle")}>
        <div className="w-full max-w-md rounded-xl border border-border bg-background p-6 shadow-xl">
          <h3 className="font-semibold">{t("ppt.editor.unsavedExitTitle")}</h3>
          <p className="mt-2 text-sm text-muted-foreground">{t("ppt.editor.unsavedExitHelp")}</p>
          <div className="mt-6 flex flex-wrap justify-end gap-2">
            <button className={button} disabled={exitBusy} onClick={() => setExitOpen(false)}>{t("ppt.editor.exitCancel")}</button>
            <button className={button} disabled={exitBusy || publishing} onClick={() => void finishExit(false)}>{t("ppt.editor.exitDiscard")}</button>
            <button className={primary} disabled={exitBusy || publishing} onClick={() => void finishExit(true)}>{t("ppt.editor.exitKeep")}</button>
          </div>
        </div>
      </div>}
      {versionsOpen && (
        <div
          className="fixed inset-0 z-[90] grid place-items-center bg-black/55 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-lg rounded-xl bg-background p-6">
            <div className="flex justify-between">
              <h3 className="font-semibold">
                {t("ppt.structured.versionHistory")}
              </h3>
              <button className={button} onClick={() => setVersionsOpen(false)}>
                {t("ppt.editor.close")}
              </button>
            </div>
            <div className="mt-4 max-h-96 space-y-2 overflow-y-auto">
              <AiVersionHistory projectId={project.id} revision={project.revision} onRestore={async()=>accept((await request(project.id,'')).project)}/>
              {revisions.length ? (
                revisions.map((item) => (
                  <div
                    key={item.revision}
                    className="flex items-center justify-between rounded-lg border border-border p-3"
                  >
                    <div>
                      <b>r{item.revision}</b>
                      <p className="text-xs text-muted-foreground">
                        {item.reason} ·{" "}
                        {new Date(item.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <button
                      className={button}
                      disabled={item.revision === project.revision}
                      onClick={() => void restore(item.revision)}
                    >
                      {t("ppt.structured.restore")}
                    </button>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t("ppt.structured.noVersions")}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function geometryPatches(changes: { nodeId: string | null | undefined; geometry: PptBounds }[]): OptimisticPatch[] {
  return changes.flatMap(change => change.nodeId ? [{ nodeId: change.nodeId, bounds: change.geometry }] : []);
}

/** Shows unanswered geometry/rotation edits on the node's own element. */
function withOptimistic(slide: PptRenderSlide, overlay: Map<string, OptimisticPatch>): PptRenderSlide {
  if (!overlay.size || !slide.elements.some(element => element.nodeId && overlay.has(element.nodeId))) return slide;
  const count = new Map<string, number>();
  for (const element of slide.elements) if (element.nodeId) count.set(element.nodeId, (count.get(element.nodeId) || 0) + 1);
  return { ...slide, elements: slide.elements.map(element => {
    const patch = element.nodeId ? overlay.get(element.nodeId) : undefined;
    if (!patch || (element.id !== element.nodeId && count.get(element.nodeId!) !== 1)) return element;
    return { ...element, ...(patch.bounds ? { bounds: patch.bounds } : {}), ...(patch.rotation !== undefined ? { rotation: patch.rotation } : {}) };
  }) };
}
