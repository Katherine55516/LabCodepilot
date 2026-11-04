"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { Badge } from "@/components/ui/badge";
import {
  MagnifyingGlass,
  SpinnerGap,
  FolderOpen,
  GitBranch,
  Clock,
  FileArrowDown,
  ChatCircleText,
  Check,
  Minus,
} from "@/components/ui/icon";
import { useTranslation } from "@/hooks/useTranslation";
import { showToast, showLoadingToast, updateToast } from "@/hooks/useToast";
import { cn, parseDBDate } from "@/lib/utils";

interface ClaudeSessionInfo {
  sessionId: string;
  projectPath: string;
  projectName: string;
  cwd: string;
  gitBranch: string;
  version: string;
  preview: string;
  userMessageCount: number;
  assistantMessageCount: number;
  createdAt: string;
  updatedAt: string;
  fileSize: number;
}

interface ImportSessionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type CheckState = "unchecked" | "checked" | "indeterminate";

/**
 * Lightweight tri-state checkbox (no ui/checkbox component exists).
 * `Check` for selected, `Minus` for indeterminate (partial select-all).
 */
function SelectCheckbox({
  state,
  onToggle,
  disabled,
  className,
}: {
  state: CheckState;
  onToggle: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={state === "indeterminate" ? "mixed" : state === "checked"}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onToggle();
      }}
      className={cn(
        "flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors",
        state === "unchecked" && "border-input bg-background hover:border-primary/60",
        state === "checked" && "border-primary bg-primary text-primary-foreground",
        state === "indeterminate" && "border-primary bg-primary/15 text-primary",
        disabled && "opacity-40 cursor-not-allowed",
        className,
      )}
    >
      {state === "checked" && <Check size={12} />}
      {state === "indeterminate" && <Minus size={12} />}
    </button>
  );
}

function formatRelativeTime(dateStr: string): { key: 'import.justNow' | 'import.minutesAgo' | 'import.hoursAgo' | 'import.daysAgo'; params?: Record<string, number> } | string {
  const date = parseDBDate(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffMin < 1) return { key: 'import.justNow' };
  if (diffMin < 60) return { key: 'import.minutesAgo', params: { n: diffMin } };
  if (diffHr < 24) return { key: 'import.hoursAgo', params: { n: diffHr } };
  if (diffDay < 7) return { key: 'import.daysAgo', params: { n: diffDay } };
  return date.toLocaleDateString();
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ImportSessionDialog({
  open,
  onOpenChange,
}: ImportSessionDialogProps) {
  const router = useRouter();
  const { t } = useTranslation();
  const [sessions, setSessions] = useState<ClaudeSessionInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  // Multi-select state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchImporting, setBatchImporting] = useState(false);
  // Sessions already imported (or pre-existing) via batch — locked from re-select.
  const [importedIds, setImportedIds] = useState<Set<string>>(new Set());

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/claude-sessions");
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to fetch sessions");
      }
      const data = await res.json();
      setSessions(data.sessions || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sessions");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      fetchSessions();
      // Reset selection each time the dialog opens.
      setSelectedIds(new Set());
      setImportedIds(new Set());
      setSearchQuery("");
    }
  }, [open, fetchSessions]);

  const handleImport = async (sessionId: string) => {
    setImporting(sessionId);
    setError(null);
    try {
      const res = await fetch("/api/claude-sessions/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });

      const data = await res.json();

      if (res.status === 409 && data.existingSessionId) {
        // Already imported — navigate to the existing session
        onOpenChange(false);
        router.push(`/chat/${data.existingSessionId}`);
        return;
      }

      if (!res.ok) {
        throw new Error(data.error || "Failed to import session");
      }

      // Navigate to the newly imported session
      onOpenChange(false);
      window.dispatchEvent(new CustomEvent("session-created"));
      router.push(`/chat/${data.session.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to import session");
    } finally {
      setImporting(null);
    }
  };

  const filteredSessions = searchQuery
    ? sessions.filter(
        (s) =>
          s.projectName.toLowerCase().includes(searchQuery.toLowerCase()) ||
          s.preview.toLowerCase().includes(searchQuery.toLowerCase()) ||
          s.cwd.toLowerCase().includes(searchQuery.toLowerCase()) ||
          s.gitBranch.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : sessions;

  // ── Selection derivations ──────────────────────────────────────────
  // Select-all operates on the CURRENT filtered view, excluding rows already
  // imported in this session.
  const selectableInView = filteredSessions.filter((s) => !importedIds.has(s.sessionId));
  const selectedInViewCount = selectableInView.filter((s) => selectedIds.has(s.sessionId)).length;
  const allInViewSelected = selectableInView.length > 0 && selectedInViewCount === selectableInView.length;
  const someInViewSelected = selectedInViewCount > 0 && !allInViewSelected;
  const masterState: CheckState = allInViewSelected ? "checked" : someInViewSelected ? "indeterminate" : "unchecked";
  // Selected ids that aren't visible under the current filter (kept across searches).
  const hiddenSelectedCount = Array.from(selectedIds).filter(
    (id) => !filteredSessions.some((s) => s.sessionId === id),
  ).length;

  const toggleSelect = (sessionId: string) => {
    if (importedIds.has(sessionId)) return; // locked after import
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allInViewSelected) {
        for (const s of selectableInView) next.delete(s.sessionId);
      } else {
        for (const s of selectableInView) next.add(s.sessionId);
      }
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  const handleBatchImport = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) {
      showToast({ type: "warning", message: t("import.batchEmptyError") });
      return;
    }
    setBatchImporting(true);
    setError(null);
    const toastId = showLoadingToast(t("import.importingCount", { n: ids.length }));
    try {
      const res = await fetch("/api/claude-sessions/import-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionIds: ids }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Batch import failed");
      }

      const { imported, skipped, failed } = data.summary as {
        imported: number;
        skipped: number;
        failed: number;
      };

      // Lock imported + skipped rows; drop them from the selection.
      const processed = new Set<string>();
      for (const r of data.results as Array<{ sessionId: string; status: string }>) {
        if (r.status === "imported" || r.status === "skipped") processed.add(r.sessionId);
      }
      setImportedIds((prev) => new Set([...prev, ...processed]));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of processed) next.delete(id);
        return next;
      });

      if (failed === 0 && skipped === 0) {
        updateToast(toastId, { type: "success", message: t("import.batchSuccess", { n: imported }) });
      } else {
        updateToast(toastId, {
          type: imported > 0 ? "warning" : "error",
          message: t("import.batchSummary", { imported, skipped, failed }),
        });
      }

      if (imported > 0) {
        window.dispatchEvent(new CustomEvent("session-created"));
      }
    } catch (err) {
      updateToast(toastId, {
        type: "error",
        message: err instanceof Error ? err.message : "Batch import failed",
      });
    } finally {
      setBatchImporting(false);
    }
  };

  const hasList = !loading && filteredSessions.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] !flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileArrowDown size={20} className="text-primary" />
            {t('import.title')}
          </DialogTitle>
          <DialogDescription>
            选择需要导入的会话
          </DialogDescription>
        </DialogHeader>

        {/* Search */}
        <div className="relative">
          <MagnifyingGlass
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            placeholder={t('import.searchSessions')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 text-sm"
          />
        </div>

        {/* Select-all bar */}
        {hasList && (
          <div className="flex items-center justify-between gap-2 px-0.5">
            <div
              onClick={toggleSelectAll}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer select-none"
            >
              <SelectCheckbox state={masterState} onToggle={toggleSelectAll} />
              {t('import.selectAll')}
            </div>
            {hiddenSelectedCount > 0 && (
              <span className="text-[11px] text-muted-foreground/70">
                {t('import.hiddenSelectedHint', { n: hiddenSelectedCount })}
              </span>
            )}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Session List */}
        <div className="flex-1 min-h-0 overflow-y-auto -mx-6 px-6">
          <div className="flex flex-col gap-2 pb-2">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <SpinnerGap size={20} className="animate-spin text-muted-foreground" />
                <span className="ml-2 text-sm text-muted-foreground">
                  Scanning CLI sessions...
                </span>
              </div>
            ) : filteredSessions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <FolderOpen size={32} className="mb-2 opacity-40" />
                <p className="text-sm">
                  {searchQuery
                    ? t('import.noSessions')
                    : t('import.noSessions')}
                </p>
                <p className="text-xs mt-1 opacity-60">
                  {searchQuery
                    ? "Try a different search term"
                    : "Sessions are stored in ~/.claude/projects/"}
                </p>
              </div>
            ) : (
              filteredSessions.map((session) => {
                const isImporting = importing === session.sessionId;
                const isImported = importedIds.has(session.sessionId);
                const isSelected = selectedIds.has(session.sessionId);
                const totalMessages =
                  session.userMessageCount + session.assistantMessageCount;
                return (
                  <div
                    key={session.sessionId}
                    onClick={() => toggleSelect(session.sessionId)}
                    className={cn(
                      "group flex gap-2.5 rounded-lg border p-3 transition-colors",
                      isImported
                        ? "opacity-60"
                        : isSelected
                          ? "bg-accent/60 border-primary/40 ring-1 ring-primary/20 cursor-pointer"
                          : "hover:bg-accent/50 cursor-pointer",
                      isImporting && "opacity-60 pointer-events-none"
                    )}
                  >
                    {/* Row checkbox */}
                    <div className="pt-0.5">
                      <SelectCheckbox
                        state={isSelected ? "checked" : "unchecked"}
                        onToggle={() => toggleSelect(session.sessionId)}
                        disabled={isImported}
                      />
                    </div>

                    <div className="flex flex-1 min-w-0 flex-col gap-1.5">
                      {/* Top row: project name + import button */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium text-sm truncate">
                              {session.projectName}
                            </span>
                            {session.gitBranch && (
                              <Badge
                                variant="secondary"
                                className="text-[10px] px-1.5 py-0 h-4 shrink-0"
                              >
                                <GitBranch size={10} className="mr-0.5" />
                                {session.gitBranch}
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground line-clamp-2 break-all">
                            {session.preview}
                          </p>
                        </div>
                        {isImported ? (
                          <Badge
                            variant="secondary"
                            className="shrink-0 h-7 gap-1 px-2 text-xs"
                          >
                            <Check size={12} />
                            {t('import.alreadyImported')}
                          </Badge>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            className="shrink-0 h-7 text-xs"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleImport(session.sessionId);
                            }}
                            disabled={isImporting || batchImporting}
                          >
                            {isImporting ? (
                              <>
                                <SpinnerGap size={12} className="mr-1 animate-spin" />
                                {t('import.importing')}
                              </>
                            ) : (
                              <>
                                <FileArrowDown size={12} className="mr-1" />
                                {t('import.import')}
                              </>
                            )}
                          </Button>
                        )}
                      </div>

                      {/* Bottom row: metadata */}
                      <div className="flex items-center gap-3 text-[10px] text-muted-foreground/60">
                        <span
                          className="flex items-center gap-0.5 truncate"
                          title={session.cwd}
                        >
                          <FolderOpen size={10} className="shrink-0" />
                          {session.cwd}
                        </span>
                        <span className="flex items-center gap-0.5 shrink-0">
                          <ChatCircleText size={10} />
                          {t(totalMessages !== 1 ? 'import.messagesPlural' : 'import.messages', { n: totalMessages })}
                        </span>
                        <span className="flex items-center gap-0.5 shrink-0">
                          <Clock size={10} />
                          {(() => {
                            const rel = formatRelativeTime(session.updatedAt);
                            return typeof rel === 'string' ? rel : t(rel.key, rel.params);
                          })()}
                        </span>
                        <span className="shrink-0">
                          {formatFileSize(session.fileSize)}
                        </span>
                        {session.version && (
                          <span className="shrink-0">v{session.version}</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Batch action bar */}
        {hasList && (
          <div className="flex flex-none items-center justify-between gap-3 border-t pt-3">
            <span className={cn("text-sm", selectedIds.size > 0 ? "text-muted-foreground" : "text-muted-foreground/50")}>
              {t('import.selectedCount', { n: selectedIds.size })}
            </span>
            <div className="flex items-center gap-2">
              {selectedIds.size > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 text-xs"
                  onClick={clearSelection}
                  disabled={batchImporting}
                >
                  {t('import.clearSelection')}
                </Button>
              )}
              <Button
                size="sm"
                className="h-8 text-xs"
                onClick={handleBatchImport}
                disabled={selectedIds.size === 0 || batchImporting || loading}
              >
                {batchImporting ? (
                  <>
                    <SpinnerGap size={12} className="mr-1 animate-spin" />
                    {t('import.importingCount', { n: selectedIds.size })}
                  </>
                ) : (
                  <>
                    <FileArrowDown size={12} className="mr-1" />
                    {t('import.importSelected', { n: selectedIds.size })}
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
