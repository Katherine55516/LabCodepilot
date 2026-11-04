"use client";

import dynamic from "next/dynamic";
import { usePanel } from "@/hooks/usePanel";

const PreviewPanel = dynamic(() => import("./panels/PreviewPanel").then(m => ({ default: m.PreviewPanel })), { ssr: false });
const GitPanelContainer = dynamic(() => import("./panels/GitPanel").then(m => ({ default: m.GitPanelContainer })), { ssr: false });
const FileTreePanel = dynamic(() => import("./panels/FileTreePanel").then(m => ({ default: m.FileTreePanel })), { ssr: false });
const TaskListPanel = dynamic(() => import("./panels/TaskListPanel").then(m => ({ default: m.TaskListPanel })), { ssr: false });
const DashboardPanel = dynamic(() => import("./panels/DashboardPanel").then(m => ({ default: m.DashboardPanel })), { ssr: false });
const AssistantPanel = dynamic(() => import("./panels/AssistantPanel").then(m => ({ default: m.AssistantPanel })), { ssr: false });

export function PanelZone() {
  const { previewOpen, previewSource, gitPanelOpen, fileTreeOpen, taskListOpen, dashboardPanelOpen, assistantPanelOpen } = usePanel();

  // Phase 1.5 migration: gate on previewSource (not previewFile).
  //
  // Previously this gated on `!!previewFile`, which rejects inline-html /
  // inline-jsx / inline-datatable sources because they lack a filesystem
  // path. After migration, any non-null previewSource mounts the panel and
  // PreviewPanel itself branches on source.kind to pick the renderer.
  const anyOpen = (previewOpen && !!previewSource) || gitPanelOpen || fileTreeOpen || taskListOpen || dashboardPanelOpen || assistantPanelOpen;

  if (!anyOpen) return null;

  return (
    <div className="flex h-full shrink-0 border-l border-border/40 overflow-hidden">
      {assistantPanelOpen && <AssistantPanel />}
      {previewOpen && previewSource && <PreviewPanel />}
      {gitPanelOpen && <GitPanelContainer />}
      {/* TaskListPanel renders before FileTreePanel so when both are open,
          tasks appear on the left and files on the right — matches the
          legacy stacked-inside-one-panel layout users were used to. */}
      {taskListOpen && <TaskListPanel />}
      {fileTreeOpen && <FileTreePanel />}
      {dashboardPanelOpen && <DashboardPanel />}
    </div>
  );
}
