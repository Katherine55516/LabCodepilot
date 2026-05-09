"use client";

import { useState, useCallback } from "react";
import { X } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { usePanel } from "@/hooks/usePanel";
import { useTranslation } from "@/hooks/useTranslation";
import { ResizeHandle } from "@/components/layout/ResizeHandle";
import { TaskList } from "@/components/project/TaskList";

const PANEL_MIN_WIDTH = 220;
const PANEL_MAX_WIDTH = 500;
const PANEL_DEFAULT_WIDTH = 280;

/**
 * TaskListPanel — independent panel hosting the SDK TodoWrite task list.
 *
 * Previously the TaskList was rendered inside FileTreePanel above the file
 * tree, so closing the panel (X button) hid both surfaces at once. Splitting
 * it out lets users toggle tasks and files independently from the top bar.
 *
 * Mirrors FileTreePanel's outer shell (left-side ResizeHandle, fixed width,
 * border-r, h-10 header) so the two panels look symmetric when stacked.
 */
export function TaskListPanel() {
  const { sessionId, setTaskListOpen } = usePanel();
  const { t } = useTranslation();
  const [width, setWidth] = useState(PANEL_DEFAULT_WIDTH);

  const handleResize = useCallback((delta: number) => {
    // Left-side handle: dragging left (negative delta) = wider.
    setWidth((w) => Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, w - delta)));
  }, []);

  return (
    <div className="flex h-full shrink-0 overflow-hidden">
      <ResizeHandle side="left" onResize={handleResize} />
      <div
        className="flex h-full flex-1 flex-col overflow-hidden border-r border-border/40 bg-background"
        style={{ width }}
      >
        {/* Header — title + close. Same dimensions / typography as
            FileTreePanel's header so the two panels visually align. */}
        <div className="flex h-10 shrink-0 items-center justify-between px-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t("panel.taskList")}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setTaskListOpen(false)}
          >
            <X size={14} />
            <span className="sr-only">{t("panel.closePanel")}</span>
          </Button>
        </div>

        {/* Body — just the TaskList. Padded to match the file-tree side. */}
        <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
          <div className="flex-1 overflow-y-auto px-3 pb-3">
            <TaskList sessionId={sessionId} />
          </div>
        </div>
      </div>
    </div>
  );
}
