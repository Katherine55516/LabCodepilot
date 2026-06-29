"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import dynamic from "next/dynamic";
import { X, Copy, Check, SpinnerGap, Image as ImageIcon } from "@/components/ui/icon";
import { exportHtmlAsLongShot, ArtifactExportError } from "@/lib/artifact-export";
import { Button } from "@/components/ui/button";
import { usePanel } from "@/hooks/usePanel";
import { useTranslation } from "@/hooks/useTranslation";
import { ResizeHandle } from "@/components/layout/ResizeHandle";
import type { FilePreview as FilePreviewType } from "@/types";

// Sandpack is pulled in lazily via next/dynamic so its ~MB runtime (React
// bundler + iframe bootstrap) doesn't ship with the first-paint chunk. Only
// loaded when a .jsx/.tsx file is previewed (or inline-jsx source is set).
const SandpackPreview = dynamic(
  () => import("@/components/editor/SandpackPreview").then((m) => m.SandpackPreview),
  { ssr: false, loading: () => <div className="flex h-full items-center justify-center py-12"><SpinnerGap size={20} className="animate-spin text-muted-foreground" /></div> },
);

// CodeMirror Markdown editor (Phase 4.3 surface). Only reached when the
// user flips viewMode to "edit" on an EDITABLE_EXTENSIONS file, so the
// ~135 KB chunk stays out of first paint just like Sandpack does.
const MarkdownEditor = dynamic(
  () => import("@/components/editor/MarkdownEditor").then((m) => m.MarkdownEditor),
  { ssr: false, loading: () => <div className="flex h-full items-center justify-center py-12"><SpinnerGap size={20} className="animate-spin text-muted-foreground" /></div> },
);

// DataTable viewer (Phase 5.4). Papaparse (~15 KB gzipped) gets its own
// dynamic boundary so users who never open a .csv don't pay for it.
const DataTableViewer = dynamic(
  () => import("@/components/editor/DataTableViewer").then((m) => m.DataTableViewer),
  { ssr: false, loading: () => <div className="flex h-full items-center justify-center py-12"><SpinnerGap size={20} className="animate-spin text-muted-foreground" /></div> },
);

// 文档预览渲染器（Phase 1）。react-pdf / SheetJS 各自体积较大，独立懒加载
// chunk，只有点开对应文档才拉取，首屏零成本。worker/资产离线化见
// scripts/copy-doc-assets.js + PdfViewer 注释。
const PdfViewer = dynamic(
  () => import("@/components/editor/PdfViewer").then((m) => m.PdfViewer),
  { ssr: false, loading: () => <div className="flex h-full items-center justify-center py-12"><SpinnerGap size={20} className="animate-spin text-muted-foreground" /></div> },
);

const XlsxViewer = dynamic(
  () => import("@/components/editor/XlsxViewer").then((m) => m.XlsxViewer),
  { ssr: false, loading: () => <div className="flex h-full items-center justify-center py-12"><SpinnerGap size={20} className="animate-spin text-muted-foreground" /></div> },
);

// Lazy-load Streamdown and plugins — only loaded when rendered markdown is needed
let _StreamdownComponent: typeof import("streamdown").Streamdown | null = null;
let _streamdownPlugins: Record<string, unknown> | null = null;
let _streamdownPromise: Promise<void> | null = null;

function loadStreamdown(): Promise<void> {
  if (_streamdownPromise) return _streamdownPromise;
  _streamdownPromise = Promise.all([
    import("streamdown"),
    import("@streamdown/cjk"),
    import("@streamdown/math"),
    import("@streamdown/mermaid"),
    import("@/components/ai-elements/code-block"),
  ]).then(([sd, cjkMod, mathMod, mermaidMod, codeBlockMod]) => {
    _StreamdownComponent = sd.Streamdown;
    // Phase 5.5 — rendered-markdown preview uses the same shared code
    // plugin the chat path uses (createSharedCodePlugin from
    // code-block.tsx). Previous implementation imported @streamdown/code
    // and used its default plugin, which maintains its own unbounded
    // module-level LRU; opening a preview after a long chat session
    // effectively doubled the Shiki highlighter footprint. Now both
    // consumers share the bounded LRUMap in code-block.tsx.
    _streamdownPlugins = {
      cjk: cjkMod.cjk,
      code: codeBlockMod.createSharedCodePlugin(),
      math: mathMod.math,
      mermaid: mermaidMod.mermaid,
    };
  }).catch((err) => {
    // Reset so next call retries instead of caching the rejected promise
    _streamdownPromise = null;
    throw err;
  });
  return _streamdownPromise;
}

type ViewMode = "source" | "rendered" | "edit";

/** Extensions that support a rendered preview */
const RENDERABLE_EXTENSIONS = new Set([".md", ".mdx", ".html", ".htm", ".jsx", ".tsx", ".csv", ".tsv"]);

/** Extensions rendered through Sandpack (React-in-iframe) */
const SANDPACK_EXTENSIONS = new Set([".jsx", ".tsx"]);

/** Extensions rendered through the DataTable viewer (Phase 5.4). */
const DATATABLE_EXTENSIONS = new Set([".csv", ".tsv"]);

/**
 * Extensions that can be edited via the CodeMirror MarkdownEditor surface.
 *
 * MarkdownEditor accepts a `language` prop and lazy-loads the grammar from
 * @codemirror/language-data, so any text-based file we already preview can
 * be edited with proper syntax highlighting. Markdown is the static initial
 * grammar; other languages swap in via Compartment without view rebuild.
 *
 * Kept aligned with LANGUAGE_MAP in src/lib/files.ts. Save-to-disk is gated
 * by the same path-safety checks as the (already in production) Markdown
 * editor, so widening the allowlist doesn't widen the attack surface — the
 * server-side /api/files/write enforces baseDir, blocked dirs, symlink
 * rejection regardless of what the client sends.
 *
 * Truncation safety: when readFilePreview() returned `truncated: true`
 * (file exceeded EXTENSION_LINE_CAPS), the editor is forcibly disabled even
 * if the extension is editable, to avoid saving a truncated-and-overwritten
 * version to disk. See the `canEdit` derived flag in PreviewPanel below.
 */
const EDITABLE_EXTENSIONS = new Set([
  // Documentation / plain text
  ".md", ".mdx", ".txt", ".log",
  // JS/TS family
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  // Config / data
  ".json", ".yaml", ".yml", ".toml", ".xml", ".ini", ".env", ".properties",
  // Web
  ".html", ".htm", ".css", ".scss", ".sass", ".less", ".vue", ".svelte",
  // Backend / systems
  ".py", ".rb", ".php", ".rs", ".go", ".java", ".kt", ".kts", ".scala",
  ".swift", ".c", ".h", ".cpp", ".hpp", ".cc", ".cs", ".dart",
  // Shell / scripting
  ".sh", ".bash", ".zsh", ".fish", ".ps1", ".lua",
  // Data / queries
  ".sql", ".graphql", ".gql", ".prisma",
  // DevOps
  ".dockerfile",
  // Misc
  ".r", ".zig",
]);

function isSandpack(filePath: string): boolean {
  return SANDPACK_EXTENSIONS.has(getExtension(filePath));
}

function isDataTable(filePath: string): boolean {
  return DATATABLE_EXTENSIONS.has(getExtension(filePath));
}

function isEditable(filePath: string): boolean {
  return EDITABLE_EXTENSIONS.has(getExtension(filePath));
}

/** Media file extensions that get direct preview (no API fetch needed) */
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".svg", ".avif", ".ico"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".webm", ".mkv", ".avi"]);
const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".ogg", ".flac", ".aac"]);

function getExtension(filePath: string): string {
  const dot = filePath.lastIndexOf(".");
  return dot >= 0 ? filePath.slice(dot).toLowerCase() : "";
}

function isRenderable(filePath: string): boolean {
  return RENDERABLE_EXTENSIONS.has(getExtension(filePath));
}

function isImagePreview(filePath: string): boolean {
  return IMAGE_EXTENSIONS.has(getExtension(filePath));
}

function isVideoPreview(filePath: string): boolean {
  return VIDEO_EXTENSIONS.has(getExtension(filePath));
}

function isAudioPreview(filePath: string): boolean {
  return AUDIO_EXTENSIONS.has(getExtension(filePath));
}

function isMediaPreview(filePath: string): boolean {
  return isImagePreview(filePath) || isVideoPreview(filePath) || isAudioPreview(filePath);
}

/**
 * 二进制文档预览扩展集合（Phase 0 骨架，Phase 1-3 接渲染器）。
 *
 * 这四类是 OOXML / PDF 二进制，**不能走 /api/files/preview 文本通道**
 * （二进制检测返回 415 binary_not_previewable）。统一走 fileServeUrl 取
 * arrayBuffer 喂给各自的懒加载渲染器：
 *   .pdf  → PdfViewer   (react-pdf,    Phase 1)
 *   .xlsx → XlsxViewer  (SheetJS → 复用 DataTableViewer, Phase 1)
 *   .docx → DocxViewer  (docx-preview + DOMPurify,        Phase 2)
 *   .pptx → PptxViewer  (@aiden0z/pptx-renderer,          Phase 3)
 *
 * 老二进制 .doc/.ppt/.xls（OLE2/BIFF）纯前端无解，仍由 FileTreePanel 的
 * NON_PREVIEWABLE 拦截，不在此列。
 */
const PDF_EXTENSIONS = new Set([".pdf"]);
const DOCX_EXTENSIONS = new Set([".docx"]);
const XLSX_EXTENSIONS = new Set([".xlsx"]);
const PPTX_EXTENSIONS = new Set([".pptx"]);

function isPdfPreview(filePath: string): boolean {
  return PDF_EXTENSIONS.has(getExtension(filePath));
}
function isDocxPreview(filePath: string): boolean {
  return DOCX_EXTENSIONS.has(getExtension(filePath));
}
function isXlsxPreview(filePath: string): boolean {
  return XLSX_EXTENSIONS.has(getExtension(filePath));
}
function isPptxPreview(filePath: string): boolean {
  return PPTX_EXTENSIONS.has(getExtension(filePath));
}

/** 任一二进制文档类型 —— useEffect 短路（跳过文本 fetch）+ 渲染分发判定。 */
function isDocumentPreview(filePath: string): boolean {
  return (
    isPdfPreview(filePath) ||
    isDocxPreview(filePath) ||
    isXlsxPreview(filePath) ||
    isPptxPreview(filePath)
  );
}

function isHtml(filePath: string): boolean {
  const ext = getExtension(filePath);
  return ext === ".html" || ext === ".htm";
}

const PREVIEW_MIN_WIDTH = 320;
const PREVIEW_MAX_WIDTH = 800;
const PREVIEW_DEFAULT_WIDTH = 480;

export function PreviewPanel() {
  const { workingDirectory, sessionId, previewSource, previewFile, setPreviewFile, previewViewMode, setPreviewViewMode, setPreviewOpen } = usePanel();
  const [preview, setPreview] = useState<FilePreviewType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [width, setWidth] = useState(PREVIEW_DEFAULT_WIDTH);

  const handleResize = useCallback((delta: number) => {
    // Left-side handle: dragging left (negative delta) = wider
    setWidth((w) => Math.min(PREVIEW_MAX_WIDTH, Math.max(PREVIEW_MIN_WIDTH, w - delta)));
  }, []);

  const filePath = previewFile || "";

  useEffect(() => {
    if (!filePath || isMediaPreview(filePath) || isDocumentPreview(filePath)) {
      setLoading(false);
      return;
    }
    let cancelled = false;

    // Clear the previous file's preview and flip to loading *synchronously*
    // before any fetch. Without this, the first render after filePath
    // changes still carries the old preview.content, and SandpackPreview
    // (whose React key is filePath) gets mounted for the *new* file using
    // the *old* content. Even though we remount seconds later with the
    // correct content, Sandpack's bundler worker / service worker cache
    // can key the compiled result by the new mount path + old content,
    // which is exactly the "Counter.tsx shows Hello One" symptom.
    // Blanking preview forces the <preview ?> branch to fall through to
    // the loading spinner, so SandpackPreview isn't mounted until we
    // have the right content for the new filePath.
    setLoading(true);
    setPreview(null);
    setError(null);
    // Detach every "loaded-path"-dependent consumer from the outgoing
    // file synchronously, before the fetch even starts. editContent
    // still holds the previous file's bytes until loadPreview reseeds
    // it — that's fine as long as loadedPath is null, because editDirty
    // and every other fresh check short-circuits on loadedMatchesActive.
    setLoadedPath(null);

    async function loadPreview() {
      setError(null);
      try {
        // maxLines is omitted so the API picks a per-extension cap
        // (50k lines for Markdown/text/log/csv, 1k for code).
        // See src/lib/files.ts EXTENSION_LINE_CAPS.
        const res = await fetch(
          `/api/files/preview?path=${encodeURIComponent(filePath)}${workingDirectory ? `&baseDir=${encodeURIComponent(workingDirectory)}` : ''}`
        );
        if (!res.ok) {
          const data = await res.json();
          // Map structured error codes from /api/files/preview to friendly
          // i18n strings. Falls back to raw API message when code is unknown.
          const friendly =
            data.code === 'file_too_large' ? t('filePreview.tooLarge') :
            data.code === 'binary_not_previewable' ? t('filePreview.binaryNotPreviewable') :
            data.code === 'not_found' ? t('filePreview.notFound') :
            (data.error || t('filePreview.failedToLoad'));
          throw new Error(friendly);
        }
        const data = await res.json();
        if (!cancelled) {
          setPreview(data.preview);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : t('filePreview.failedToLoad'));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadPreview();
    return () => {
      cancelled = true;
    };
  }, [filePath, workingDirectory]);

  const handleCopyContent = async () => {
    const text = freshPreview?.content || filePath;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const [exporting, setExporting] = useState(false);

  // Editor state for Phase 4.3 edit mode. editContent is the in-memory
  // buffer the CodeMirror surface writes to; saving pushes it to
  // /api/files/write and overwrites the on-disk content. The buffer is
  // reseeded whenever the loaded preview changes (switching files, or
  // the on-disk version updating via another path) so the editor always
  // starts from the latest source of truth.
  const [editContent, setEditContent] = useState<string>("");
  const [savedContent, setSavedContent] = useState<string>("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [editJustSaved, setEditJustSaved] = useState(false);
  // Phase 5.6 — the "loaded path" anchor for every stale-content check in
  // this panel. Populated when loadPreview successfully seats a new
  // preview.content; cleared synchronously on filePath changes before
  // the fetch starts. Every consumer that derives from preview.content
  // (editor buffer, export button, source/render fallbacks) gates on
  // `loadedPath === previewSource.filePath` so a freshly-mounted
  // previewSource can never be paired with the previous file's
  // content — catches autosave cross-file writes, stale Sandpack first
  // frames, and export-button-during-switch races in one place.
  const [loadedPath, setLoadedPath] = useState<string | null>(null);
  const loadedMatchesActive =
    previewSource?.kind === "file" && loadedPath === previewSource.filePath;
  useEffect(() => {
    if (preview?.content !== undefined && preview.path) {
      // Only seed the edit buffers for EDITABLE files. Non-editable / truncated
      // files render read-only from preview.content (SourceView) and never read
      // editContent, so cloning the (possibly multi-MB) content into two more
      // state strings is pure waste — exactly the huge truncated-file case.
      // loadedPath must still be set for ALL files: freshPreview gates on it, so
      // skipping it would spin non-editable files on a permanent loader.
      if (isEditable(preview.path) && !preview.truncated) {
        setEditContent(preview.content);
        setSavedContent(preview.content);
      } else {
        setEditContent("");
        setSavedContent("");
      }
      setLoadedPath(preview.path);
    }
  }, [preview?.content, preview?.path, preview?.truncated]);
  const editDirty = editContent !== savedContent && loadedMatchesActive;

  // Codex P1 follow-up. The render path below used to read `preview`
  // directly, which meant on the first frame after a file switch React
  // saw a fresh filePath paired with the *previous* file's preview.content
  // (setPreview(null) inside the effect hasn't run yet). That stale pair
  // got handed to MarkdownEditor / RenderedView / SourceView / Sandpack
  // and we re-created the same "new TSX key + old content" class of bug
  // the loadedPath anchor was introduced to prevent.
  //
  // `freshPreview` is the only shape the render path should consume:
  // non-null only when the loaded content actually belongs to the
  // currently-active file. Any time freshPreview is null we fall through
  // to the loading branch, so the UI shows a spinner instead of a
  // cross-file frankenstate.
  const freshPreview = loadedMatchesActive ? preview : null;

  // Whether the current preview source is an HTML document we can ship
  // to the Phase 3 long-shot IPC. Lit up when:
  //   • inline-html kind (html lives on the source itself), or
  //   • file kind, extension is HTML, AND the loaded-path anchor
  //     confirms preview.content belongs to the active filePath.
  // The second clause prevents a stale Export click during a mid-switch
  // frame from shipping the outgoing file's content under the incoming
  // file's name.
  const exportableHtml: string | null = useMemo(() => {
    if (previewSource?.kind === 'inline-html') return previewSource.html;
    if (
      previewSource?.kind === 'file' &&
      isHtml(filePath) &&
      freshPreview?.content
    ) {
      return freshPreview.content;
    }
    return null;
  }, [previewSource, filePath, freshPreview]);

  const handleSaveEdit = useCallback(async () => {
    if (!editDirty || savingEdit) return;
    if (previewSource?.kind !== "file") return;
    // Second hard gate — editDirty already bakes this in, but the save
    // path is sensitive enough that duplicating the check against
    // loadedPath is cheap insurance for future refactors.
    if (loadedPath !== previewSource.filePath) return;
    const targetPath = previewSource.filePath;
    setSavingEdit(true);
    try {
      const res = await fetch("/api/files/write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: targetPath,
          baseDir: workingDirectory || undefined,
          content: editContent,
          overwrite: true,
          createParents: false,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(`Save failed: ${data.error || res.statusText}`);
        return;
      }
      // Only mark clean if the current previewSource is still the file
      // we were saving. A mid-save file switch would otherwise leave
      // savedContent pointing at content that belongs to the previous
      // file — benign for persistence (the target file on disk is
      // correct) but would mislabel dirty state on the new file.
      setSavedContent((prev) =>
        previewSource?.kind === "file" && previewSource.filePath === targetPath
          ? editContent
          : prev,
      );
      setEditJustSaved(true);
      setTimeout(() => setEditJustSaved(false), 2000);
    } catch (err) {
      alert(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSavingEdit(false);
    }
  }, [editDirty, savingEdit, previewSource, editContent, loadedPath, workingDirectory]);

  // Debounced autosave. Fires 1 second after the user stops typing, as
  // long as the buffer is dirty, we're not already saving, and the
  // buffer still belongs to the active file. `editDirty` already has
  // the editContentFile === previewSource.filePath gate baked in, so
  // switching files short-circuits autosave immediately — no race
  // where the new filePath + old content could land in /api/files/write.
  useEffect(() => {
    if (!editDirty || savingEdit) return;
    if (previewSource?.kind !== "file") return;
    if (!isEditable(filePath)) return;
    const timer = setTimeout(() => {
      void handleSaveEdit();
    }, 1000);
    return () => clearTimeout(timer);
  }, [editContent, editDirty, savingEdit, previewSource, filePath, handleSaveEdit]);
  const handleExportLongShot = useCallback(async () => {
    if (!exportableHtml) return;
    setExporting(true);
    try {
      // Compute basename locally so this callback doesn't depend on the
      // `fileName` variable declared later in the component — avoids
      // a TDZ (let/const before initialization) error at mount time.
      const virtualName =
        previewSource?.kind === 'inline-html' ? previewSource.virtualName ?? 'preview.html' :
        previewSource?.kind === 'file' ? (filePath.split('/').pop() || filePath) :
        'artifact';
      await exportHtmlAsLongShot({
        html: exportableHtml,
        filename: virtualName.replace(/\.[^.]+$/, '') || 'artifact',
        width: 1024,
      });
    } catch (err) {
      if (err instanceof ArtifactExportError) {
        // Surface the code so users know whether it was a transient busy
        // state or a hard limit. Full toast/i18n wiring is Phase 3
        // polish — for now, alert() is acceptable for this short flow.
        alert(`Export failed: ${err.code} — ${err.message}`);
      } else {
        alert(`Export failed: ${String(err)}`);
      }
    } finally {
      setExporting(false);
    }
  }, [exportableHtml, filePath, previewSource]);

  const handleClose = () => {
    setPreviewFile(null);
    setPreviewOpen(false);
  };

  // Header title: file uses basename; inline-* sources use virtualName or
  // a kind-appropriate default ("preview.html", "preview.jsx", "table").
  const fileName =
    previewSource?.kind === "inline-html" ? (previewSource.virtualName ?? "preview.html") :
    previewSource?.kind === "inline-jsx" ? (previewSource.virtualName ?? "preview.jsx") :
    previewSource?.kind === "inline-datatable" ? (previewSource.virtualName ?? "table") :
    filePath.split("/").pop() || filePath;

  const breadcrumb = useMemo(() => {
    // Inline sources have no filesystem path — show a zero-width breadcrumb
    // so the row layout stays consistent without misleading virtual paths.
    if (previewSource && previewSource.kind !== "file") return "";
    const segments = filePath.split("/").filter(Boolean);
    const display = segments.slice(-3);
    const prefix = display.length < segments.length ? ".../" : "";
    return prefix + display.join("/");
  }, [filePath, previewSource]);

  const canRender = isRenderable(filePath);
  const isMedia = isMediaPreview(filePath);
  // Phase 0 骨架：二进制文档（pdf/docx/xlsx/pptx）走专用渲染分支，不走
  // 文本 preview 通道。Phase 1-3 把 DocumentPlaceholder 换成各自的懒加载
  // 渲染器。当前 FileTreePanel 仍拦截这四类（NON_PREVIEWABLE），所以此
  // 分支在 Phase 1 放开拦截前不会被触发——是预铺的分发骨架。
  const isDocument = isDocumentPreview(filePath);
  // Single derived flag for "this file can enter edit mode". Combines:
  //   1. previewSource is a real file (not inline-html / inline-jsx / table)
  //   2. extension is in EDITABLE_EXTENSIONS
  //   3. content is NOT truncated by EXTENSION_LINE_CAPS — saving a
  //      truncated buffer would silently overwrite the on-disk file's
  //      tail and lose data. Code files cap at 1k lines, so this is a
  //      real concern for large config / generated files.
  const canEdit =
    previewSource?.kind === "file" &&
    isEditable(filePath) &&
    !freshPreview?.truncated;

  // Build direct file serve URL for media files.
  // Prefer /api/files/serve (session-scoped) when sessionId is available;
  // fall back to /api/files/raw (home-scoped) for pre-session state.
  const fileServeUrl = filePath
    ? sessionId
      ? `/api/files/serve?path=${encodeURIComponent(filePath)}&sessionId=${encodeURIComponent(sessionId)}`
      : `/api/files/raw?path=${encodeURIComponent(filePath)}`
    : '';

  return (
    <div className="flex h-full shrink-0 overflow-hidden">
      <ResizeHandle side="left" onResize={handleResize} />
      <div className="flex h-full flex-1 flex-col overflow-hidden border-r border-border/40 bg-background" style={{ width }}>
      {/* Header */}
      <div className="flex h-10 shrink-0 items-center gap-2 px-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{fileName}</p>
        </div>

        {canRender && !isMedia && (
          <ViewModeToggle
            value={previewViewMode}
            onChange={setPreviewViewMode}
            editable={canEdit}
          />
        )}

        {/* Save button — only visible in edit mode. Mirrors the unsaved-
            dot + label affordance from SkillEditor so the two editing
            surfaces feel consistent. Cmd+S inside the editor triggers the
            same handler, so this is an alternate path for mouse users. */}
        {previewViewMode === "edit" && canEdit && (
          <>
            {editDirty && (
              <span
                className="h-2 w-2 rounded-full bg-status-warning shrink-0"
                title={t("filePreview.save.unsaved")}
              />
            )}
            <Button
              size="xs"
              onClick={handleSaveEdit}
              disabled={!editDirty || savingEdit}
              className="gap-1"
            >
              {savingEdit ? (
                <SpinnerGap size={12} className="animate-spin" />
              ) : null}
              {savingEdit
                ? t("filePreview.save.saving")
                : editJustSaved
                ? t("filePreview.save.saved")
                : t("filePreview.save.idle")}
            </Button>
          </>
        )}

        {!isMedia && !isDocument && (
          <Button variant="ghost" size="icon-sm" onClick={handleCopyContent}>
            {copied ? (
              <Check size={14} className="text-status-success-foreground" />
            ) : (
              <Copy size={14} />
            )}
            <span className="sr-only">{t("filePreview.copyContent")}</span>
          </Button>
        )}

        {/* Phase 3 long-shot export — only surfaces when we have concrete
            HTML to ship to the IPC. Markdown and Sandpack/JSX variants
            need a serialization step (Streamdown -> HTML, or
            Sandpack files -> esbuild -> HTML) that's Phase 3 follow-up. */}
        {exportableHtml && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={handleExportLongShot}
            disabled={exporting}
            title={t("filePreview.exportLongScreenshot")}
          >
            {exporting ? (
              <SpinnerGap size={14} className="animate-spin" />
            ) : (
              <ImageIcon size={14} />
            )}
            <span className="sr-only">{t("filePreview.exportLongScreenshot")}</span>
          </Button>
        )}

        <Button variant="ghost" size="icon-sm" onClick={handleClose}>
          <X size={14} />
          <span className="sr-only">{t("filePreview.closePreview")}</span>
        </Button>
      </div>

      {/* Breadcrumb + language */}
      <div className="flex shrink-0 items-center gap-2 px-3 pb-2">
        <p className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground/60">
          {breadcrumb}
        </p>
        {freshPreview && !isMedia && (
          <span className="shrink-0 text-[10px] text-muted-foreground/50">
            {freshPreview.language}
          </span>
        )}
      </div>

      {/* Content — dispatch on previewSource.kind. The file branch preserves
          the pre-Phase-1.5 behavior (fetch via API + render via
          MediaView/RenderedView/SourceView). inline-html delegates to a
          sandboxed iframe. inline-jsx / inline-datatable render placeholders
          that Phase 2.1 / Phase 5.4 will fill in with real renderers. */}
      <div className="flex-1 min-h-0 overflow-auto">
        {previewSource?.kind === "inline-html" ? (
          <InlineHtmlView html={previewSource.html} />
        ) : previewSource?.kind === "inline-jsx" ? (
          // key forces remount when the inline JSX source changes, so
          // Sandpack boots fresh instead of recompiling on top of the
          // previous iframe state.
          <SandpackPreview
            key={`inline-${previewSource.virtualName ?? "jsx"}-${previewSource.jsx.length}`}
            content={previewSource.jsx}
            filePath={previewSource.virtualName}
          />
        ) : previewSource?.kind === "inline-datatable" ? (
          <DataTableViewer
            rows={previewSource.rows}
            header={previewSource.header}
            filename={previewSource.virtualName ?? "table"}
          />
        ) : isPdfPreview(filePath) ? (
          <PdfViewer fileServeUrl={fileServeUrl} />
        ) : isXlsxPreview(filePath) ? (
          <XlsxViewer fileServeUrl={fileServeUrl} filename={fileName} />
        ) : isDocument ? (
          // docx/pptx 仍占位（Phase 2/3 替换为 DocxViewer/PptxViewer）。
          <DocumentPlaceholder filePath={filePath} />
        ) : isMedia ? (
          <MediaView filePath={filePath} fileServeUrl={fileServeUrl} />
        ) : loading ? (
          <div className="flex items-center justify-center py-12">
            <SpinnerGap size={20} className="animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="px-4 py-8 text-center">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        ) : freshPreview ? (
          <>
            {canEdit && (previewViewMode === "edit" || previewViewMode === "source") ? (
              // Editable files: Source and Edit both route to the
              // CodeMirror surface (Edit is Source for Markdown, and for
              // code files the source mode is just "code with syntax
              // highlighting that happens to be editable"). Cmd+S calls
              // handleSaveEdit through the editor keymap; the
              // debounce-driven autosave below is the primary path.
              // `canEdit` already excludes truncated files, so a save
              // here can never overwrite-and-lose-tail.
              <MarkdownEditor
                value={editContent}
                onChange={setEditContent}
                onSave={handleSaveEdit}
                filename={filePath}
                language={freshPreview.language}
              />
            ) : previewViewMode === "rendered" && canRender ? (
              <RenderedView content={freshPreview.content} filePath={filePath} />
            ) : (
              <SourceView preview={freshPreview} />
            )}
            {!(canEdit && (previewViewMode === "edit" || previewViewMode === "source")) &&
              freshPreview.truncated && <TruncationBanner preview={freshPreview} />}
          </>
        ) : (
          // When previewSource is a file but loadedPath hasn't caught up
          // yet (mid-switch frame — loading is already set true by the
          // synchronous effect below, but React may render once more with
          // stale state between the event and the effect). Fall back to
          // the spinner instead of rendering stale content to the
          // editor/renderer/Sandpack.
          <div className="flex items-center justify-center py-12">
            <SpinnerGap size={20} className="animate-spin text-muted-foreground" />
          </div>
        )}
      </div>
      </div>
    </div>
  );
}

/**
 * Banner shown at the bottom of a truncated preview.
 *
 * The API enforces per-extension line caps + a 10MB byte ceiling (see
 * src/lib/files.ts). When a file exceeds either, `preview.truncated` is true
 * and this banner tells the user what they got vs what the file actually
 * contains, so they don't silently act on partial content.
 */
function TruncationBanner({ preview }: { preview: FilePreviewType }) {
  const { t } = useTranslation();
  const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(2);
  return (
    <div className="sticky bottom-0 border-t border-border/40 bg-muted/80 px-3 py-2 text-[11px] text-muted-foreground backdrop-blur">
      {t('filePreview.truncated', {
        lines: preview.line_count,
        bytesReadMb: mb(preview.bytes_read),
        bytesTotalMb: mb(preview.bytes_total),
      })}
    </div>
  );
}

/**
 * Capsule toggle for view modes.
 *
 * Editable files (.md/.mdx/.txt) show [Edit | Preview] — Edit *is*
 * Source for these, so a separate Source pill would just duplicate
 * the CodeMirror surface without adding value. Non-editable files
 * (code, config, etc.) show [Source | Preview] as before.
 *
 * The `value` coming in may be "source" (legacy default) even for
 * editable files — callers don't need to remap, we treat it as "edit"
 * via highlighting so the UI stays consistent.
 */
function ViewModeToggle({
  value,
  onChange,
  editable,
}: {
  value: ViewMode;
  onChange: (v: ViewMode) => void;
  editable: boolean;
}) {
  const { t } = useTranslation();
  const pill = (mode: ViewMode, label: string, highlighted: boolean) => (
    <Button
      variant="ghost"
      size="sm"
      className={`rounded-full px-2 py-0.5 font-medium h-auto ${
        highlighted
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground"
      }`}
      onClick={() => onChange(mode)}
    >
      {label}
    </Button>
  );
  return (
    <div className="flex h-6 items-center rounded-full bg-muted p-0.5 text-[11px]">
      {editable
        ? pill("edit", t("filePreview.viewMode.edit"), value === "edit" || value === "source")
        : // Non-editable files (truncated content or non-editable extension):
          // when defaultViewMode("edit") meets a file we can't actually edit,
          // PreviewPanel falls back to SourceView — so visually we should
          // keep the source pill highlighted to match what's rendered, even
          // though the underlying value is still "edit". Treat edit + source
          // as equivalent here, mirroring the editable=true branch above.
          pill("source", t("filePreview.viewMode.source"), value === "source" || value === "edit")}
      {pill("rendered", t("filePreview.viewMode.preview"), value === "rendered")}
    </div>
  );
}

/**
 * Read-only source view. Renders through the same virtualized CodeMirror surface
 * the edit path uses (O(viewport) DOM), so a large/truncated file no longer emits
 * one DOM node per line (~50k spans at the line cap) — the dominant non-virtualized
 * memory/CPU cost. Syntax highlighting + line numbers are preserved by CodeMirror;
 * only the color palette shifts to match the edit surface.
 */
function SourceView({ preview }: { preview: FilePreviewType }) {
  return (
    <MarkdownEditor
      value={preview.content}
      onChange={() => {}}
      editable={false}
      language={preview.language}
    />
  );
}

/**
 * Inline HTML preview — Phase 1.5.
 *
 * Renders a caller-provided HTML string inside a fully sandboxed iframe.
 * `sandbox=""` (empty) disables scripts, plugins, forms, and same-origin
 * access — the strictest setting. If Phase 2 needs to relax this for
 * interactive HTML artifacts, do it at the caller level by switching to
 * `inline-jsx` (Sandpack) instead, not by loosening the sandbox here.
 */
function InlineHtmlView({ html }: { html: string }) {
  const { t } = useTranslation();
  return (
    <iframe
      srcDoc={html}
      sandbox=""
      className="h-full w-full border-0"
      title={t("docPreview.htmlPreview")}
    />
  );
}

/**
 * Placeholder for preview kinds whose real renderer lands in a later Phase.
 *
 * Showing a visible "coming soon" block (rather than null) makes two things
 * observable in Phase 1.5 smoke tests: (1) PanelZone gate actually mounts
 * the panel for inline-* sources (R1 regression detector), and (2) the
 * caller wired up setPreviewSource correctly.
 */
function InlinePlaceholder({ phase, kind }: { phase: string; kind: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      <p className="text-sm font-medium text-muted-foreground">
        {kind} preview lands in {phase}
      </p>
      <p className="text-xs text-muted-foreground/60">
        The data channel (PreviewSource → PreviewPanel) is wired; renderer is pending.
      </p>
    </div>
  );
}

/**
 * Phase 0 文档预览占位 —— Phase 1-3 替换为真实懒加载渲染器
 * （PdfViewer / XlsxViewer / DocxViewer / PptxViewer）。
 *
 * 当前 FileTreePanel 的 NON_PREVIEWABLE 仍拦截 pdf/docx/xlsx/pptx，所以这个
 * 占位在 Phase 1 放开拦截前不会出现在 UI；它的作用是让 PreviewPanel 的分发
 * 骨架完整、类型自洽，给后续 Phase 一个明确的替换锚点（与 InlinePlaceholder
 * 同样的「数据通道已通、渲染器待补」定位）。
 */
function DocumentPlaceholder({ filePath }: { filePath: string }) {
  const ext = getExtension(filePath).replace(".", "").toUpperCase();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      <p className="text-sm font-medium text-muted-foreground">
        {ext} preview coming soon
      </p>
      <p className="text-xs text-muted-foreground/60">
        Renderer lands in an upcoming phase. (Phase 0 dispatch scaffold)
      </p>
    </div>
  );
}

/** Direct media preview — no API fetch needed */
function MediaView({ filePath, fileServeUrl }: { filePath: string; fileServeUrl: string }) {
  if (isImagePreview(filePath)) {
    return (
      <div className="flex items-center justify-center p-4 h-full">
        <img
          src={fileServeUrl}
          alt={filePath.split('/').pop() || ''}
          className="max-w-full max-h-full object-contain rounded"
        />
      </div>
    );
  }

  if (isVideoPreview(filePath)) {
    return (
      <div className="flex items-center justify-center p-4 h-full">
        <video
          src={fileServeUrl}
          controls
          preload="metadata"
          className="max-w-full max-h-full rounded"
        />
      </div>
    );
  }

  if (isAudioPreview(filePath)) {
    return (
      <div className="flex items-center justify-center p-8">
        <audio src={fileServeUrl} controls preload="metadata" className="w-full" />
      </div>
    );
  }

  return null;
}
function RenderedView({
  content,
  filePath,
}: {
  content: string;
  filePath: string;
}) {
  const { t } = useTranslation();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    loadStreamdown().then(() => setReady(true)).catch(() => {});
  }, []);

  if (isHtml(filePath)) {
    return (
      <iframe
        srcDoc={content}
        sandbox=""
        className="h-full w-full border-0"
        title={t('docPreview.htmlPreview')}
      />
    );
  }

  // .jsx / .tsx → Sandpack (React in iframe). See POC 0.5 for the s4
  // default-sandbox security posture and the upgrade path to s2 if
  // Phase 2.5 demands stricter iframe isolation.
  //
  // key ties the SandpackPreview instance to the concrete file path, so
  // clicking a different .tsx from the same folder rebuilds the preview
  // from scratch instead of serving the previously-compiled one.
  if (isSandpack(filePath)) {
    return <SandpackPreview key={filePath} filePath={filePath} content={content} />;
  }

  // .csv / .tsv → DataTable viewer (Phase 5.4). Delimiter picked from
  // the extension so tab-separated files get the right split behavior;
  // papaparse inside the viewer handles column detection.
  if (isDataTable(filePath)) {
    const delimiter = getExtension(filePath) === ".tsv" ? "\t" : ",";
    const basename = filePath.split("/").pop() || filePath;
    return <DataTableViewer key={filePath} csv={content} delimiter={delimiter} filename={basename} />;
  }

  // Markdown / MDX — wait for Streamdown to load
  if (!ready || !_StreamdownComponent || !_streamdownPlugins) {
    return (
      <div className="flex items-center justify-center py-12">
        <SpinnerGap size={20} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  const Sd = _StreamdownComponent;
  return (
    <div className="px-6 py-4 overflow-x-hidden break-words">
      <Sd
        className="size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_ul]:pl-6 [&_ol]:pl-6"
        plugins={_streamdownPlugins}
      >
        {content}
      </Sd>
    </div>
  );
}
