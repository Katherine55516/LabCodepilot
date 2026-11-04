"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { ArrowsClockwise, MagnifyingGlass, FileCode, Code, File, FolderOpen, Trash } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { FileTreeNode } from "@/types";
import {
  FileTree as AIFileTree,
  FileTreeFolder,
  FileTreeFile,
} from "@/components/ai-elements/file-tree";
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { showToast } from "@/hooks/useToast";
import { useTranslation } from "@/hooks/useTranslation";
import type { ReactNode } from "react";

/** Node identity passed to the context-menu actions. */
interface MenuNode {
  path: string;
  name: string;
  type: "file" | "directory";
}

/**
 * Reveal a file/folder in the OS file manager (Finder / Explorer), selecting
 * it in its parent folder. Prefers Electron's shell.showItemInFolder; falls
 * back to the /api/files/reveal exec route in the browser/dev.
 */
async function revealInFileManager(path: string): Promise<void> {
  const api = typeof window !== "undefined" ? window.electronAPI : undefined;
  if (api?.shell?.showItemInFolder) {
    await api.shell.showItemInFolder(path);
    return;
  }
  const res = await fetch("/api/files/reveal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `reveal failed (${res.status})`);
  }
}

interface FileTreeProps {
  workingDirectory: string;
  onFileSelect: (path: string) => void;
  onFileAdd?: (path: string) => void;
  /** Path of the currently-selected folder (for highlight + create target). */
  selectedFolderPath?: string;
  /** Called when the user clicks a folder row — selects the folder + toggles. */
  onSelectFolder?: (folderPath: string) => void;
  /** Path of the currently-selected file (for highlight). */
  selectedFilePath?: string;
  highlightPath?: string;
  highlightSeek?: string;
}

function getFileIcon(extension?: string): ReactNode {
  switch (extension) {
    case "ts":
    case "tsx":
    case "js":
    case "jsx":
    case "py":
    case "rb":
    case "rs":
    case "go":
    case "java":
    case "c":
    case "cpp":
    case "h":
    case "hpp":
    case "cs":
    case "swift":
    case "kt":
    case "dart":
    case "lua":
    case "php":
    case "zig":
      return <FileCode size={16} className="text-muted-foreground" />;
    case "json":
    case "yaml":
    case "yml":
    case "toml":
      return <Code size={16} className="text-muted-foreground" />;
    case "md":
    case "mdx":
    case "txt":
    case "csv":
      return <File size={16} className="text-muted-foreground" />;
    default:
      return <File size={16} className="text-muted-foreground" />;
  }
}

function containsMatch(node: FileTreeNode, query: string): boolean {
  const q = query.toLowerCase();
  if (node.name.toLowerCase().includes(q)) return true;
  if (node.children) {
    return node.children.some((child) => containsMatch(child, q));
  }
  return false;
}

function filterTree(nodes: FileTreeNode[], query: string): FileTreeNode[] {
  if (!query) return nodes;
  return nodes
    .filter((node) => containsMatch(node, query))
    .map((node) => ({
      ...node,
      children: node.children ? filterTree(node.children, query) : undefined,
    }));
}

function RenderTreeNodes({
  nodes,
  searchQuery,
  highlightPath,
  renderContextMenu,
}: {
  nodes: FileTreeNode[];
  searchQuery: string;
  highlightPath?: string;
  /** Builds the right-click menu for a node (a <ContextMenuContent>). */
  renderContextMenu?: (node: MenuNode) => ReactNode;
}) {
  const filtered = searchQuery ? filterTree(nodes, searchQuery) : nodes;

  return (
    <>
      {filtered.map((node) => {
        if (node.type === "directory") {
          const isHighlighted = node.path === highlightPath;
          return (
            <FileTreeFolder
              key={node.path}
              path={node.path}
              name={node.name}
              className={cn(isHighlighted && "file-tree-flash")}
              id={isHighlighted ? `file-tree-highlight` : undefined}
              contextMenuContent={renderContextMenu?.({ path: node.path, name: node.name, type: "directory" })}
            >
              {node.children && (
                <RenderTreeNodes nodes={node.children} searchQuery={searchQuery} highlightPath={highlightPath} renderContextMenu={renderContextMenu} />
              )}
            </FileTreeFolder>
          );
        }
        const isHighlighted = node.path === highlightPath;
        return (
          <FileTreeFile
            key={node.path}
            path={node.path}
            name={node.name}
            icon={getFileIcon(node.extension)}
            className={cn(isHighlighted && "file-tree-flash")}
            id={isHighlighted ? `file-tree-highlight` : undefined}
            contextMenuContent={renderContextMenu?.({ path: node.path, name: node.name, type: "file" })}
          />
        );
      })}
    </>
  );
}

function getParentPaths(filePath: string): string[] {
  const parents: string[] = [];
  let current = filePath;
  while (true) {
    const parent = current.substring(0, current.lastIndexOf('/'));
    if (!parent || parent === current) break;
    parents.push(parent);
    current = parent;
  }
  return parents;
}

export function FileTree({ workingDirectory, onFileSelect, onFileAdd, selectedFolderPath, onSelectFolder, selectedFilePath, highlightPath, highlightSeek }: FileTreeProps) {
  const [tree, setTree] = useState<FileTreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const { t } = useTranslation();
  const seekKeyRef = useRef<string | null>(null);

  // Right-click menu: pending delete target drives the confirm dialog; null =
  // dialog closed. `deleting` disables the confirm button while the request is
  // in flight so a double-click can't fire two deletes.
  const [pendingDelete, setPendingDelete] = useState<MenuNode | null>(null);
  const [deleting, setDeleting] = useState(false);

  // OS-appropriate "reveal" label — 访达 on macOS, 资源管理器 elsewhere. Uses
  // the deprecated-but-universally-supported navigator.platform (Electron on
  // mac reports "MacIntel"); userAgent is the fallback.
  const isMac = useMemo(() => {
    if (typeof navigator === "undefined") return false;
    const p = navigator.platform || navigator.userAgent || "";
    return /mac/i.test(p);
  }, []);
  const revealLabel = isMac ? t("fileTree.revealInFinder") : t("fileTree.revealInExplorer");

  // Clear stale tree data when switching projects to avoid cross-session seek races.
  useEffect(() => {
    setTree([]);
    setError(null);
    seekKeyRef.current = null;
  }, [workingDirectory]);

  const fetchTree = useCallback(async () => {
    // Always cancel in-flight request first — even when clearing directory,
    // otherwise a stale response from the old project can arrive and repopulate the tree.
    if (abortRef.current) {
      abortRef.current.abort();
    }

    if (!workingDirectory) {
      abortRef.current = null;
      setTree([]);
      setError(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);
    try {
      // depth=20 covers any realistic project structure. Bumping past the
      // previous depth=4 default — at depth 4 anything below the 4th level
      // simply didn't render even though the chevron showed it as expandable.
      // scanDirectory already skips IGNORED_DIRS (node_modules / .git / dist
      // / .next / build / etc.) so this won't pull a giant tree.
      const res = await fetch(
        `/api/files?dir=${encodeURIComponent(workingDirectory)}&baseDir=${encodeURIComponent(workingDirectory)}&depth=20&_t=${Date.now()}`,
        { signal: controller.signal }
      );
      if (controller.signal.aborted) return;
      if (res.ok) {
        const data = await res.json();
        if (controller.signal.aborted) return;
        setTree(data.tree || []);
      } else {
        const errData = await res.json().catch(() => ({ error: res.statusText }));
        setTree([]);
        setError(errData.error || `Failed to load (${res.status})`);
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      setTree([]);
      setError('Failed to load file tree');
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, [workingDirectory]);

  useEffect(() => {
    fetchTree();
  }, [fetchTree]);

  // Cleanup abort controller on unmount
  useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
      }
    };
  }, []);

  // Auto-refresh when AI finishes streaming. The 'refresh-file-tree' event is
  // dispatched once per tool completion AND once per stream completion, i.e.
  // many times per AI turn. Debounce so a burst coalesces into a SINGLE reload
  // instead of re-fetching + rebuilding the whole tree N+1 times every turn —
  // over a long session that repeated full-tree thrash is the dominant
  // file-tree cost (and a needless source of GC churn / UI flicker).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const handler = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = null; fetchTree(); }, 500);
    };
    window.addEventListener('refresh-file-tree', handler);
    return () => {
      window.removeEventListener('refresh-file-tree', handler);
      if (timer) clearTimeout(timer);
    };
  }, [fetchTree]);

  // Controlled expansion state for search-driven highlighting
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());

  // Sync expanded paths when highlightPath changes
  useEffect(() => {
    if (highlightPath) {
      const next = new Set<string>();
      for (const parent of getParentPaths(highlightPath)) {
        next.add(parent);
      }
      next.add(highlightPath);
      setExpandedPaths(next);
    } else {
      setExpandedPaths(new Set());
    }
  }, [highlightPath, highlightSeek]);

  // Scroll to and flash highlighted file from search results.
  // Guarded by seekKeyRef so tree auto-refreshes don't re-trigger the scroll.
  useEffect(() => {
    if (!workingDirectory || !highlightPath || tree.length === 0) return;
    const seekTargetKey = `${workingDirectory}::${highlightPath}::${highlightSeek || ''}`;
    if (seekKeyRef.current === seekTargetKey) return;

    let attempts = 0;
    const maxAttempts = 15;
    const interval = setInterval(() => {
      attempts++;
      const el = document.getElementById('file-tree-highlight');
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        seekKeyRef.current = seekTargetKey;
        clearInterval(interval);
      } else if (attempts >= maxAttempts) {
        clearInterval(interval);
      }
    }, 100);
    return () => clearInterval(interval);
  }, [workingDirectory, highlightPath, highlightSeek, tree]);

  // --- Right-click menu actions ---
  const handleReveal = useCallback(async (node: MenuNode) => {
    try {
      await revealInFileManager(node.path);
    } catch {
      showToast({ type: 'error', message: t('fileTree.revealFailed') });
    }
  }, [t]);

  const handleConfirmDelete = useCallback(async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      const res = await fetch('/api/files/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: pendingDelete.path,
          baseDir: workingDirectory || undefined,
          // Directories may be non-empty; the API requires explicit recursive
          // acknowledgement (mirrors `rm -r`). The confirm dialog IS that ack.
          recursive: pendingDelete.type === 'directory',
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `delete failed (${res.status})`);
      }
      showToast({ type: 'success', message: t('fileTree.deleteSuccess', { name: pendingDelete.name }) });
      setPendingDelete(null);
      fetchTree();
    } catch {
      showToast({ type: 'error', message: t('fileTree.deleteFailed') });
    } finally {
      setDeleting(false);
    }
  }, [pendingDelete, workingDirectory, t, fetchTree]);

  // Builds the right-click menu for a single node. Passed down through
  // RenderTreeNodes and attached to every file/folder row.
  const renderContextMenu = useCallback((node: MenuNode): ReactNode => (
    <ContextMenuContent>
      <ContextMenuItem onSelect={() => void handleReveal(node)}>
        <FolderOpen size={16} />
        {revealLabel}
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem
        variant="destructive"
        onSelect={() => setPendingDelete(node)}
      >
        <Trash size={16} />
        {t('fileTree.delete')}
      </ContextMenuItem>
    </ContextMenuContent>
  ), [handleReveal, revealLabel, t]);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Search + Refresh */}
      <div className="flex items-center gap-1.5 px-4 py-2 shrink-0">
        <div className="relative flex-1 min-w-0">
          <MagnifyingGlass size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            placeholder={t('fileTree.filterFiles')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-7 pl-7 text-xs"
          />
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={fetchTree}
          disabled={loading}
          className="h-7 w-7 shrink-0"
        >
          <ArrowsClockwise size={12} className={cn(loading && "animate-spin")} />
          <span className="sr-only">{t('fileTree.refresh')}</span>
        </Button>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-auto">
        {loading && tree.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <ArrowsClockwise size={16} className="animate-spin text-muted-foreground" />
          </div>
        ) : tree.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">
            {error ? error : workingDirectory ? t('fileTree.noFiles') : t('fileTree.selectFolder')}
          </p>
        ) : (
          <AIFileTree
            expanded={expandedPaths}
            onExpandedChange={setExpandedPaths}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AI Elements FileTree onSelect type conflicts with HTMLAttributes.onSelect
            onSelect={onFileSelect as any}
            onAdd={onFileAdd}
            selectedPath={selectedFilePath}
            selectedFolderPath={selectedFolderPath}
            onSelectFolder={onSelectFolder}
            className="border-0 rounded-none"
          >
            <RenderTreeNodes nodes={tree} searchQuery={searchQuery} highlightPath={highlightPath} renderContextMenu={renderContextMenu} />
          </AIFileTree>
        )}
      </div>

      {/* Delete confirmation — trashing (system recycle bin) is recoverable,
          but a whole folder can go at once, so we make the user acknowledge. */}
      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => { if (!open && !deleting) setPendingDelete(null); }}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('fileTree.deleteConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('fileTree.deleteConfirmDesc', { name: pendingDelete?.name ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={(e) => { e.preventDefault(); void handleConfirmDelete(); }}
              disabled={deleting}
            >
              {deleting ? '…' : t('fileTree.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
