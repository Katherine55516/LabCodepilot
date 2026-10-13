"use client";
/* eslint-disable @next/next/no-img-element -- SVG previews are authenticated PPT routes and cannot use the Next image optimizer. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import {usePptTemplateFonts} from "../usePptTemplateFonts";
import {PptSelect} from "../PptSelect";
import { PptCanvas } from "../canvas/PptCanvas";
import { AiBeforeAfterPreview } from "./AiBeforeAfterPreview";
import { PptHistory } from "../history/PptHistory";
import { PptInspector } from "../inspector/PptInspector";
import { prepareImage } from "../PptBlocks";
import { GenerationSkeleton, type PptDraft } from "../generation/GenerationSkeleton";
import type { TranslationKey } from "@/i18n";
import type {
  PptAiProposal, PptMutationType,
  PptBounds,
  PptRenderElement,
  PptRenderSlide,
  StructuredProjectView,
} from "../types";

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
async function request(
  projectId: string,
  path: string,
  method = "GET",
  payload?: unknown,
) {
  const response = await fetch(`/api/ppt/projects/${projectId}${path}${path.includes('?')?'&':'?'}view=live`, {
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
}: {
  project: StructuredProjectView;
  chatOpen?: boolean;
  embedded?: boolean;
  activeSlideId?: string;
  drafts?: Record<string, PptDraft>;
  onPageChange?: (id:string)=>void;
  onProject: (project: StructuredProjectView) => void;
  onClose?: () => void;
  onFailureDetails?: () => void;
}) {
  const { t } = useTranslation();
  const [page, setPage] = useState(0);
  const generating=['generating','paused'].includes(project.status);
  const structureLocked=generating||Boolean(project.externalPptx||project.templateFidelity?.mode==='preserve');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [instruction, setInstruction] = useState("");
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [query, setQuery] = useState("");
  const [thumbMode, setThumbMode] = useState<"list" | "grid">("grid");
  const [presenting, setPresenting] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [tool, setTool] = useState<Tool>(null);
  const [docTitle, setDocTitle] = useState(project.title);
  const [exitOpen, setExitOpen] = useState(false);
  const [exitBusy, setExitBusy] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [aiProposal, setAiProposal] = useState<PptAiProposal | null>(null);
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
  const clipboard = useRef<string[]>([]);
  const preserveNative = Boolean(project.externalPptx || project.templateFidelity?.mode === "preserve");
  const templateFontState=usePptTemplateFonts(project.id,project.template);
  const tree = project.renderTree;
  const slides = useMemo(() => tree?.slides || [], [tree]);
  const slide = slides[page];
  const liveEditing = ['generating','failed'].includes(project.status);
  const targetRuntime = slide && project.runtime?.slides[slide.slideId];
  const localAiReady = !liveEditing || Boolean((project.status!=='failed'||project.stage==='generation') && slide && project.nodes?.[slide.slideId]?.status==='done' && targetRuntime?.phase==='render_ready' && targetRuntime.preview && !targetRuntime.quality?.issues?.some(issue=>issue.severity==='error'));

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
  useEffect(() => { aiAttempt.current++; setAiBusy(false); setAiProposal(null); }, [slide?.slideId, tool]);
  const pointElement = slide?.elements.find(
    (element) => element.kind === "list" && element.content?.pointLayout,
  );
  const pointLayout = pointElement?.content?.pointLayout;
  const pointCount = pointElement?.content?.items?.length || 0;
  const selected = useMemo(
    () => slide?.elements.find((element) => element.nodeId === selectedIds[0]),
    [slide, selectedIds],
  );
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
  const saved = project.status === 'completed' && project.publishedRevision !== undefined && project.publishedRevision === project.revision;
  function requestExit() { if (generating || saved || !project.publishedRevision || ['failed','quality_blocked'].includes(project.status)) onClose?.(); else setExitOpen(true); }
  async function finishExit(keep: boolean) {
    setExitBusy(true); setError("");
    try {
      if (keep) {
        const result = await request(project.id, "/publish", "POST");
        if (!result.published) throw new Error(t("ppt.editor.publishBlocked"));
        accept(result.project);
      } else {
        const revision = project.publishedRevision ?? 0;
        if (revision < 1) throw new Error(t("ppt.editor.restoreMissing"));
        const restored = await request(project.id, `/revisions/${revision}/restore`, "POST");
        accept(restored.project);
        const result = await request(project.id, "/publish", "POST");
        if (!result.published) throw new Error(t("ppt.editor.restoreBlocked"));
        accept(result.project);
      }
      setExitOpen(false); onClose?.();
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setExitBusy(false); }
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
  const command = useCallback(
    async (type: string, payload: unknown) => {
      try {
        setError("");
        const result = await request(project.id, "/commands", "POST", {
          id: crypto.randomUUID().replaceAll("-", ""), type, baseRevision: project.revision, payload,
        });
        accept(result.project);
        return result;
      } catch (reason) {
        const fault = reason as Error & { status?: number };
        setConflict(fault.status === 409);
        setError(fault.message);
        return null;
      }
    },
    [accept, project.id, project.revision],
  );
  const direct = useCallback(
    async (path: string, payload?: unknown) => {
      try {
        accept((await request(project.id, path, "POST",payload)).project);
      } catch (reason) {
        const fault = reason as Error & { status?: number };
        setConflict(fault.status === 409);
        setError(fault.message);
      }
    },
    [accept, project.id],
  );
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
      accept((await request(project.id, "", "PATCH", { title })).project);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }
  function select(id: string | null, additive = false) {
    if (!id) {
      setSelectedIds([]);
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
  async function proposeAi(scope: "object" | "slide" | "deck", mode: PptMutationType = aiMode) {
    if (!instruction.trim() || !slide || (scope === "object" && !selected?.nodeId) || (["layout", "structure"].includes(mode) && preserveNative)) return;
    const attempt = ++aiAttempt.current;
    setAiBusy(true); setError("");
    try {
      const value = await request(project.id, "/ai-edit", "POST", { scope, type: mode, preview: true, ...(aiAction !== 'custom' && ['auto','title','content'].includes(mode) ? { action: aiAction, parameters: aiAction === 'translate' ? { targetLanguage: aiLanguage, mode: aiTranslationMode, region: aiRegion, glossary: aiGlossary } : aiAction === 'expand' ? { lengthRatio: aiRatio } : {} } : {}), slideId: slide.slideId, nodeId: selected?.nodeId, instruction, baseRevision: project.revision });
      if (aiAttempt.current !== attempt) { void request(project.id, `/proposals/${value.proposal.id}/discard`, "POST").catch(() => {}); return; }
      setAiProposal(value.proposal);
    } catch (reason) {
      if (aiAttempt.current !== attempt) return;
      const fault = reason as Error & { status?: number }; setConflict(fault.status === 409); setError(fault.message);
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
      setAiProposal(null); setInstruction("");
    } catch (reason) {
      const fault = reason as Error & { status?: number }; setConflict(fault.status === 409); setError(fault.message);
    } finally { setAiBusy(false); }
  }
  async function undoAi() {
    if (!lastAiOperation || aiBusy) return;
    setAiBusy(true);
    try { accept((await request(project.id, "/undo", "POST", { operationId: lastAiOperation })).project); setLastAiOperation(null); }
    catch (reason) { const fault = reason as Error & { status?: number }; setConflict(fault.status === 409); setError(fault.message); }
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
    });
  }
  function inlineContent(
    targetSlideId: string,
    element: PptRenderElement,
    text: string,
  ) {
    if (!element.nodeId) return;
    const content =
      element.kind === "text"
        ? { text }
        : {
            items: text
              .split("\n")
              .filter(Boolean)
              .slice(0, 20)
              .map((line, index) => ({
                id:
                  element.content?.items?.[index]?.id ||
                  crypto.randomUUID().replaceAll("-", ""),
                text: line,
              })),
          };
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
    if (action === "ai") setTool("ai");
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
    void command("nodes.setGeometry", { slideId: slide.slideId, changes });
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
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === "z") {
        event.preventDefault();
        void direct(event.shiftKey ? "/redo" : "/undo");
        return;
      }
      if (meta && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (!saved && !generating) void direct("/publish");
        return;
      }
      if (meta && event.key.toLowerCase() === "c") {
        clipboard.current = [...selectedIds];
        return;
      }
      if (
        meta &&
        event.key.toLowerCase() === "v" &&
        clipboard.current.length &&
        slide &&
        !preserveNative
      ) {
        event.preventDefault();
        void command("nodes.duplicate", {
          slideId: slide.slideId,
          nodeIds: clipboard.current,
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
        !preserveNative &&
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
        void command("nodes.setGeometry", { slideId: slide.slideId, changes });
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [
    command,
    direct,
    presenting,
    saved,
    selectedElements,
    selectedIds,
    slide,
    slides.length,
    preserveNative,
  ]);

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
    onGeometry: (changes: { element: PptRenderElement; bounds: PptBounds }[]) =>
      moveGeometry(slide.slideId, changes),
    onRotation: (element: PptRenderElement, rotation: number) =>
      void command("node.setRotation", {
        slideId: slide.slideId,
        nodeId: element.nodeId,
        rotation,
      }),
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
          className={`rounded-full px-2 py-1 text-xs ${saved ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}
        >
          {generating?t("ppt.task.generating"):saved
            ? t("ppt.structured.published")
            : t("ppt.edit.draftStatus")}
        </span>
        <div className="ml-auto flex items-center gap-1 md:gap-2">{project.status==='failed'&&onFailureDetails&&<button className={button} onClick={onFailureDetails}>{t('ppt.failure.details')}</button>}{['failed','quality_blocked'].includes(project.status)&&<button className={button} onClick={()=>void direct('/retry')}>{t(project.status==='failed'?'ppt.retry':'ppt.media.recheck')}</button>}{['completed','quality_blocked'].includes(project.status)&&project.pageDecision?.mode==='explicit'&&!project.externalPptx&&<button className={button} onClick={()=>void direct('/page-policy',{mode:'auto',baseRevision:project.revision})}>{t('ppt.editor.autoPageBudget')}</button>}<button className={button} onClick={() => setTool("ai")}>{t("ppt.edit.optimize")}</button>
          <button className={button} onClick={() => setTool("theme")}>
            ◐ <span className="hidden lg:inline">{t("ppt.editor.theme")}</span>
          </button>
          <button
            className={button}
            disabled={saved || generating}
            onClick={() => void direct("/publish")}
          >
            ✓ <span className="hidden sm:inline">{t("ppt.save")}</span>
          </button>
          <button className={primary} onClick={() => setPresenting(true)}>
            ▶ <span className="hidden sm:inline">{t("ppt.present")}</span>
          </button>
          <button className={button} disabled={generating} onClick={() => setExportOpen(true)}>
            ⇩ <span className="hidden sm:inline">{t("ppt.editor.export")}</span>
          </button>
        </div>
      </header>
      {error && (
        <div
          role="alert"
          className="flex shrink-0 items-center justify-between gap-3 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive"
        >
          <span>{error}</span>
          {conflict && (
            <button className={button} onClick={() => void reload()}>
              {t("ppt.structured.reloadConflict")}
            </button>
          )}
        </div>
      )}
      <div className="ppt-editor-body relative grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[13rem_minmax(0,1fr)_4rem] xl:grid-cols-[15rem_minmax(0,1fr)_4rem]">
        <aside
          className="hidden min-h-0 overflow-y-auto border-r border-border p-3 md:block"
          aria-label={t("ppt.editor.thumbnails")}
        >
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
                className={`group relative rounded-lg border p-1 ${page === index ? "border-primary bg-primary/5" : "border-border"}`}
              >
                <button className="w-full text-left" onClick={() => go(index)}>
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
                    {index + 1}.{" "}
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
        </aside>
        <main
          className={`min-h-0 space-y-8 overflow-y-auto bg-background p-3 pb-20 md:p-6 md:pb-6 ${tool ? "md:mr-[23rem]" : ""}`}
          ref={canvasRef}
          onScroll={event=>sessionStorage.setItem(`ppt-editor-scroll:${project.id}`,JSON.stringify({slideId:activeSlideId||slide?.slideId,scrollTop:event.currentTarget.scrollTop}))}
          id="ppt-editor-canvas"
        >
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
                  {t("ppt.structured.slide")} {index + 1}
                  {generating && project.generationStages?.pages?.[item.slideId] === "repairing" && <span data-testid="ppt-page-repairing" className="ml-2 rounded bg-primary/10 px-2 py-0.5 text-primary">{t("ppt.stage.repairing")}</span>}
                </span>
                <div className="flex items-center gap-3">
                  {page === index && <span>{t("ppt.structured.editing")}</span>}
                  <button className="rounded border border-border px-2 py-1 hover:bg-accent"
                    onClick={(event) => { event.stopPropagation(); choosePage(index); setSelectedIds([]); setTool("ai"); }}>
                    ✎ {t("ppt.editor.ai")}
                  </button>
                </div>
              </div>
              {generating && !item.elements.length && <GenerationSkeleton project={project} index={index}
                slide={project.outline?.find(outlineSlide => outlineSlide.id === (item.slideId || item.id))}
                stage={project.generationStages?.pages?.[item.slideId || item.id] || (project.nodes?.[item.id]?.status === "running" ? "writing" : "waiting")}
                draft={(drafts || project.drafts)?.[item.slideId || item.id]} />}
              {generating && item.elements.length>0 && project.runtime?.slides?.[item.slideId || item.id]?.phase !== 'render_ready' && <p data-testid="ppt-source-component-committed" className="mb-2 text-xs text-muted-foreground">{t('ppt.skeleton.sourceCommitted')}</p>}
              {!(generating && !item.elements.length) && (nearbySlides.has(item.id)||page===index ? <PptCanvas
                key={`${item.id}-${project.revision}-${error}`}
                {...canvasProps}
                slide={item}
                readOnly={generating && project.runtime?.slides?.[item.slideId || item.id]?.phase !== 'render_ready'}
                selectedIds={page === index ? selectedIds : []}
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
                  })
                }
                onContent={(element, text) =>
                  inlineContent(item.slideId, element, text)
                }
                onAction={(action, element) => act(item, action, element)}
              /> : <div className="aspect-video overflow-hidden rounded bg-muted" data-testid="ppt-deferred-canvas"><img alt="" loading="lazy" decoding="async" className="h-full w-full object-contain" src={`/api/ppt/projects/${project.id}/slides/${item.slideId}/preview?format=svg&v=${project.runtime?.slides[item.slideId]?.renderHash||project.renderTree?.hash||project.revision}`}/></div>)}
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
              width: `${Math.round(((page + 1) / slides.length) * 100)}%`,
            }}
          />
        </div>
        <span>
          {page + 1}/{slides.length}
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
                  {t("ppt.structured.slide")} {page + 1}
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
                        {project.templateSpec.fonts.titleEastAsia ||
                          project.templateSpec.fonts.title}
                        <br />
                        {t("ppt.editor.bodyFont")}:{" "}
                        {project.templateSpec.fonts.bodyEastAsia ||
                          project.templateSpec.fonts.body}
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
                    onCommand={command}
                    onAi={() => setTool("ai")}
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
              {tool === "layout" && (
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
                    <PptSelect className={field} ariaLabel={t("ppt.edit.target")} value={slide.slideId} disabled={aiBusy} onValueChange={value=>{setPage(slides.findIndex(item=>item.slideId===value));setSelectedIds([]);}} options={slides.map((item,index)=>({value:item.slideId,label:`${index+1}. ${item.elements.find(element=>['title','template-title'].includes(element.semanticRole||''))?.content?.text||project.outline?.find(o=>o.id===item.slideId)?.title||t('ppt.slide')+' '+(index+1)}`}))}/>

                  </label>
                  <label className="block space-y-2 text-sm">{t('ppt.mutation.type')}<PptSelect className={field} ariaLabel={t('ppt.mutation.type')} disabled={aiBusy||Boolean(aiProposal)} value={aiMode} onValueChange={value=>{setAiMode(value as PptMutationType);setAiAction('custom');}} options={(['auto','title','content','layout','style','data','structure'] as const).map(type=>({value:type,label:t(`ppt.mutation.${type}`),disabled:Boolean(preserveNative)&&['layout','data','structure'].includes(type)}))}/></label>
                  <button className={button} disabled={aiBusy} onClick={async () => { try { const value = await request(project.id, `/slides/${slide.slideId}/accept`, 'POST', { accepted: !project.runtime?.slides[slide.slideId]?.accepted, renderHash: project.runtime?.slides[slide.slideId]?.renderHash, baseRevision: project.revision }); accept(value.project); } catch (reason) { setError(String((reason as Error).message)); } }}>{t(project.runtime?.slides[slide.slideId]?.accepted ? 'ppt.runtime.unlock' : 'ppt.runtime.accept')}</button>
                  <div className="flex flex-wrap gap-2">{(['shorten', 'enrich', 'executive', 'conclusion', 'columns'] as const).map(preset => <button key={preset} className={button} disabled={aiBusy || Boolean(aiProposal) || (preset === 'columns' && preserveNative)} onClick={() => { setAiAction('custom'); setInstruction(t(`ppt.edit.${preset}Prompt`)); setAiMode(preset === "columns" ? "layout" : "content"); }}>{t(`ppt.edit.${preset}`)}</button>)}</div>
                  <label className="block space-y-2 text-sm">{t('ppt.ai.action')}<PptSelect className={field} ariaLabel={t('ppt.ai.action')} disabled={aiBusy||Boolean(aiProposal)} value={aiAction} onValueChange={action=>{setAiAction(action);if(action!=='custom'){setAiMode('content');setInstruction(t(`ppt.ai.${action}` as never));}}} options={['custom','improve','grammar','translate','expand','shorten','simplify','specific'].map(action=>({value:action,label:t(`ppt.ai.${action}` as never)}))}/></label>
                  {aiAction === 'translate' && <div className="space-y-2"><label className="block text-sm">{t('ppt.ai.language')}<PptSelect className={field} ariaLabel={t('ppt.ai.language')} value={aiLanguage} disabled={aiBusy||Boolean(aiProposal)} onValueChange={setAiLanguage} options={['en','zh','zh-Hant','ja','ko','de','fr','es'].map(value=>({value,label:t(`ppt.ai.lang.${value}` as never)}))}/></label><PptSelect ariaLabel={t('ppt.ai.translationMode')} className={field} value={aiTranslationMode} disabled={aiBusy||Boolean(aiProposal)} onValueChange={setAiTranslationMode} options={[{value:'replace',label:t('ppt.ai.replace')},{value:'bilingual',label:t('ppt.ai.bilingual')}]}/><input className={field} aria-label={t('ppt.ai.region')} placeholder={t('ppt.ai.region')} maxLength={120} value={aiRegion} disabled={aiBusy || Boolean(aiProposal)} onChange={event => setAiRegion(event.target.value)}/><textarea className={field} aria-label={t('ppt.ai.glossary')} placeholder={t('ppt.ai.glossary')} maxLength={1000} value={aiGlossary} disabled={aiBusy || Boolean(aiProposal)} onChange={event => setAiGlossary(event.target.value)}/></div>}
                  {aiAction === 'expand' && <label className="block space-y-2 text-sm">{t('ppt.ai.ratio')}<PptSelect className={field} ariaLabel={t('ppt.ai.ratio')} value={String(aiRatio)} disabled={aiBusy||Boolean(aiProposal)} onValueChange={value=>setAiRatio(Number(value))} options={[1.5,2,3].map(value=>({value:String(value),label:`≈ ${value}×`}))}/></label>}
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
                    onCommand={command}
                    onAi={() => setTool("ai")}
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
      {presenting && (
        <div className="fixed inset-0 z-[90] flex flex-col bg-black p-4">
          <div className="mb-3 flex justify-between text-sm text-white">
            <span>▶ {project.title}</span>
            <span>
              {page + 1} / {slides.length}
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
            {!saved && (
              <p className="mt-2 text-xs text-destructive">
                {t("ppt.editor.publishBeforeExport")}
              </p>
            )}
            <div className="mt-5 grid gap-2">
              <a
                className={`${primary} ${!saved ? "pointer-events-none opacity-50" : ""}`}
                href={`/api/ppt/projects/${project.id}/export`}
                download
              >
                {t("ppt.structured.editablePptx")}
              </a>
              <a
                className={`${button} ${!saved ? "pointer-events-none opacity-50" : ""}`}
                href={`/api/ppt/projects/${project.id}/pdf`}
                download
              >
                PDF
              </a>
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
            <button className={button} disabled={exitBusy} onClick={() => void finishExit(false)}>{t("ppt.editor.exitDiscard")}</button>
            <button className={primary} disabled={exitBusy} onClick={() => void finishExit(true)}>{t("ppt.editor.exitKeep")}</button>
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
