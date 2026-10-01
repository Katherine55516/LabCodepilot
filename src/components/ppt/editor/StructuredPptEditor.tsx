"use client";
/* eslint-disable @next/next/no-img-element -- SVG previews are authenticated PPT routes and cannot use the Next image optimizer. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { PptCanvas } from "../canvas/PptCanvas";
import { AiBeforeAfterPreview } from "./AiBeforeAfterPreview";
import { PptHistory } from "../history/PptHistory";
import { PptInspector } from "../inspector/PptInspector";
import { prepareImage } from "../PptBlocks";
import type {
  PptAiProposal, PptMutationType,
  PptBounds,
  PptRenderElement,
  PptRenderSlide,
  StructuredProjectView,
} from "../types";

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
  const response = await fetch(`/api/ppt/projects/${projectId}${path}`, {
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
  onProject,
  onClose,
}: {
  project: StructuredProjectView;
  onProject: (project: StructuredProjectView) => void;
  onClose?: () => void;
}) {
  const { t } = useTranslation();
  const [page, setPage] = useState(0);
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
  const clipboard = useRef<string[]>([]);
  const preserveNative = Boolean(project.externalPptx || project.templateFidelity?.mode === "preserve");
  const tree = project.renderTree;
  const slides = useMemo(() => tree?.slides || [], [tree]);
  const slide = slides[page];
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
  const saved = (project.publishedRevision ?? 0) === project.revision;
  function requestExit() { if (saved) onClose?.(); else setExitOpen(true); }
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
    async (path: string) => {
      try {
        accept((await request(project.id, path, "POST")).project);
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
    setPage(index);
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
  async function proposeAi(scope: "object" | "slide" | "deck", mode: PptMutationType = aiMode) {
    if (!instruction.trim() || !slide || (scope === "object" && !selected?.nodeId) || (["layout", "structure"].includes(mode) && preserveNative)) return;
    const attempt = ++aiAttempt.current;
    setAiBusy(true); setError("");
    try {
      const value = await request(project.id, "/ai-edit", "POST", { scope, type: mode, preview: true, slideId: slide.slideId, nodeId: selected?.nodeId, instruction, baseRevision: project.revision });
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
      if (index >= 0) setPage(index);
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
    if (preserveNative && ["delete", "duplicate", "front", "back"].includes(action))
      return;
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
        if (!saved) void direct("/publish");
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
      if (event.key === "Escape") {
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
    allowStructure: !preserveNative,
  };
  return (
    <section
      data-testid="ppt-structured-editor"
      className="ppt-prototype fixed inset-0 z-[70] flex flex-col overflow-hidden bg-background text-foreground"
    >
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
          {saved
            ? t("ppt.structured.published")
            : t("ppt.edit.draftStatus")}
        </span>
        <div className="ml-auto flex items-center gap-1 md:gap-2"><button className={button} onClick={() => setTool("ai")}>{t("ppt.edit.optimize")}</button>
          <button className={button} onClick={() => setTool("theme")}>
            ◐ <span className="hidden lg:inline">{t("ppt.editor.theme")}</span>
          </button>
          <button
            className={button}
            disabled={saved}
            onClick={() => void direct("/publish")}
          >
            ✓ <span className="hidden sm:inline">{t("ppt.save")}</span>
          </button>
          <button className={primary} onClick={() => setPresenting(true)}>
            ▶ <span className="hidden sm:inline">{t("ppt.present")}</span>
          </button>
          <button className={button} onClick={() => setExportOpen(true)}>
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
                    <img
                      alt=""
                      loading="lazy"
                      decoding="async"
                      src={`/api/ppt/projects/${project.id}/slides/${item.slideId}/preview?format=svg`}
                      className="h-full w-full object-contain"
                    />
                  </div>
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
                    disabled={Boolean(preserveNative)}
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
          id="ppt-editor-canvas"
        >
          {slides.map((item, index) => (
            <article
              key={item.id}
              ref={(node) => {
                refs.current[item.id] = node;
              }}
              className="mx-auto scroll-m-6"
              style={{ width: `${zoom}%`, maxWidth: "72rem" }}
              onFocus={() => setPage(index)}
              onClick={() => setPage(index)}
            >
              <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {t("ppt.structured.slide")} {index + 1}
                </span>
                <div className="flex items-center gap-3">
                  {page === index && <span>{t("ppt.structured.editing")}</span>}
                  <button className="rounded border border-border px-2 py-1 hover:bg-accent"
                    onClick={(event) => { event.stopPropagation(); setPage(index); setSelectedIds([]); setTool("ai"); }}>
                    ✎ {t("ppt.editor.ai")}
                  </button>
                </div>
              </div>
              <PptCanvas
                key={`${item.id}-${project.revision}-${error}`}
                {...canvasProps}
                slide={item}
                selectedIds={page === index ? selectedIds : []}
                onSelect={(id, additive) => {
                  setPage(index);
                  select(id, additive);
                }}
                onSelectMany={(ids) => {
                  setPage(index);
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
              />
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
                        disabled={Boolean(preserveNative)}
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
                        <button key={label} className={button} disabled={Boolean(preserveNative)}
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
                    allowStructure={!preserveNative}
                  />
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground">
                      {t("ppt.structured.selectObject")}
                    </p>
                    <button
                      className={`${button} w-full`}
                      disabled={Boolean(preserveNative)}
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
                    disabled={Boolean(preserveNative)}
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
                      disabled={Boolean(preserveNative)}
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
                    disabled={Boolean(preserveNative)}
                    onClick={() =>
                      insertNode("shape", { text: "", shape: "rect" })
                    }
                  >
                    {t("ppt.m4.rectangle")}
                  </button>
                  <button
                    className={button}
                    disabled={Boolean(preserveNative)}
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
                  disabled={Boolean(preserveNative)}
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
                  disabled={Boolean(preserveNative)}
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
                  <label className="block space-y-2 text-sm">{t("ppt.edit.target")}
                    <select className={field} value={slide.slideId} disabled={aiBusy} onChange={event => { setPage(slides.findIndex(item => item.slideId === event.target.value)); setSelectedIds([]); }}>
                      {slides.map((item, index) => <option key={item.slideId} value={item.slideId}>{index + 1}. {item.elements.find(element => element.semanticRole === 'title')?.content?.text || item.slideId}</option>)}
                    </select>
                  </label>
                  <label className="block space-y-2 text-sm">{t('ppt.mutation.type')}<select className={field} disabled={aiBusy || Boolean(aiProposal)} value={aiMode} onChange={event => setAiMode(event.target.value as PptMutationType)}>{(['auto', 'title', 'content', 'layout', 'style', 'data', 'structure'] as const).map(type => <option key={type} value={type} disabled={preserveNative && ['layout','data','structure'].includes(type)}>{t(`ppt.mutation.${type}`)}</option>)}</select></label>
                  <button className={button} disabled={aiBusy} onClick={async () => { try { const value = await request(project.id, `/slides/${slide.slideId}/accept`, 'POST', { accepted: !project.runtime?.slides[slide.slideId]?.accepted, renderHash: project.runtime?.slides[slide.slideId]?.renderHash, baseRevision: project.revision }); accept(value.project); } catch (reason) { setError(String((reason as Error).message)); } }}>{t(project.runtime?.slides[slide.slideId]?.accepted ? 'ppt.runtime.unlock' : 'ppt.runtime.accept')}</button>
                  <div className="flex flex-wrap gap-2">{(['shorten', 'enrich', 'executive', 'conclusion', 'columns'] as const).map(preset => <button key={preset} className={button} disabled={aiBusy || Boolean(aiProposal) || (preset === 'columns' && preserveNative)} onClick={() => { setInstruction(t(`ppt.edit.${preset}Prompt`)); setAiMode(preset === "columns" ? "layout" : "content"); }}>{t(`ppt.edit.${preset}`)}</button>)}</div>
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
                        !selected ||
                        selected.kind === "image" ||
                        aiBusy || Boolean(aiProposal)
                      }
                      onClick={() => void proposeAi("object")}
                    >
                      {t("ppt.editor.previewObjectAi")}
                    </button>
                    <button
                      className={button}
                      disabled={!instruction.trim() || aiBusy || Boolean(aiProposal)}
                      onClick={() => void proposeAi("slide", aiMode)}
                    >
                      {t("ppt.structured.aiEditSlide")}
                    </button>
                    <button
                      className={button}
                      disabled={!instruction.trim() || aiBusy || preserveNative || Boolean(aiProposal)}
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
                    allowStructure={!preserveNative}
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
