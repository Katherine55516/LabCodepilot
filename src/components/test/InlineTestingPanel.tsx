"use client";

import { useState, type ReactNode } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { ListChecks, ChartBar, Gear, ArrowLeft, FolderPlus, CaretRight, Play, type Icon } from "@/components/ui/icon";
import type { TranslationKey } from "@/i18n";
import { useNativeFolderPicker } from "@/hooks/useNativeFolderPicker";
import { FolderPicker } from "@/components/chat/FolderPicker";
import { ModelSelectorDropdown } from "@/components/chat/ModelSelectorDropdown";
import { useProviderModels } from "@/hooks/useProviderModels";

/**
 * Inline testing workbench (Phase 1 · 对话内嵌测试).
 *
 * Opened from the sidebar "测试" entry (toggle); fills the whole content area
 * (covers the chat). Exit by toggling the sidebar "测试" entry again, or by
 * opening any chat (ChatView closes the panel on session change). No in-panel
 * 收起 button. Phase 1 is a UI skeleton — no engine. The 看板 is a two-level
 * project manager: projects list (+ 添加项目) → click a project → its test tasks
 * (+ 新建任务). Data lives in local component state (real, user-entered, NOT mock
 * — just not persisted yet); the engine + persistence land in Phase 2+.
 * Workflow (per design): 需求→用例→执行→报告 (no code analysis).
 */

type View = "dash" | "flow" | "report";
type ModalKind = "none" | "newTask" | "env";
type T = (key: TranslationKey, params?: Record<string, string | number>) => string;
// Backend test-step keys (match /api/test/run + src/lib/test/prompts.ts).
type TestStep = "requirement" | "cases" | "execution" | "report";
type StepStatus = "idle" | "running" | "done" | "error";

interface Project {
  name: string;
  path: string;
  tasks: { name: string }[];
}

const INPUT =
  "w-full h-9 rounded-md border border-border bg-background px-2.5 text-xs text-foreground outline-none focus:border-accent";

// Per-task workflow (no code analysis), ported from ai-lab-test-framework V0.3:
// 需求分析 → 用例设计 → 测试执行 → 测试报告. Steps run in order; each reads the
// prior step's AI_LabTest/ artifact, so the UI gates step N on step N-1 being done.
const STEPS: { step: TestStep; name: TranslationKey; desc: TranslationKey }[] = [
  { step: "requirement", name: "test.step.requirements.name", desc: "test.step.requirements.desc" },
  { step: "cases", name: "test.step.cases.name", desc: "test.step.cases.desc" },
  { step: "execution", name: "test.step.execution.name", desc: "test.step.execution.desc" },
  { step: "report", name: "test.step.report.name", desc: "test.step.report.desc" },
];

// Turn an agent tool_use ({name, input}) into a readable Chinese run-log line.
// The run log streams what the agent is actually doing while it works (the bare
// tool name alone — "Bash"/"Read" — is opaque to a user watching a test run).
function toolUseLabel(name: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const clip = (v: string, n = 90) => (v.length > n ? v.slice(0, n) + "…" : v);
  switch (name) {
    case "Bash": return `执行命令  ${clip(str(i.command))}`;
    case "Read": return `读取文件  ${clip(str(i.file_path))}`;
    case "Write": return `写入文件  ${clip(str(i.file_path))}`;
    case "Edit":
    case "MultiEdit": return `编辑文件  ${clip(str(i.file_path))}`;
    case "Grep": return `搜索  ${clip(str(i.pattern))}`;
    case "Glob": return `查找文件  ${clip(str(i.pattern))}`;
    case "LS": return `列目录  ${clip(str(i.path))}`;
    case "WebFetch": return `抓取网页  ${clip(str(i.url))}`;
    case "TodoWrite": return "更新任务清单";
    default: {
      // Playwright MCP browser tools (execution step): playwright__browser_*.
      const m = name.match(/browser_(\w+)/);
      if (m) return `浏览器·${m[1]}${i.url ? `  ${clip(str(i.url))}` : ""}`;
      return name;
    }
  }
}

// Step index-circle color by status (semantic status tokens; no raw colors).
function stepCircleClass(status: StepStatus): string {
  switch (status) {
    case "done": return "bg-status-success-muted text-status-success-foreground";
    case "running": return "bg-status-info-muted text-status-info-foreground";
    case "error": return "bg-status-error-muted text-status-error-foreground";
    default: return "bg-muted text-muted-foreground";
  }
}

// Status badge text + class; null for idle (the step description already reads as pending).
function stepBadge(status: StepStatus, t: T): { text: string; cls: string } | null {
  switch (status) {
    case "running": return { text: t("test.stepStatus.running"), cls: "bg-status-info-muted text-status-info-foreground" };
    case "done": return { text: t("test.stepStatus.done"), cls: "bg-status-success-muted text-status-success-foreground" };
    case "error": return { text: t("test.stepStatus.error"), cls: "bg-status-error-muted text-status-error-foreground" };
    default: return null;
  }
}

export function InlineTestingPanel() {
  const { t } = useTranslation();
  const [view, setView] = useState<View>("dash");
  const [modal, setModal] = useState<ModalKind>("none");
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [selectedTask, setSelectedTask] = useState<number | null>(null);
  // Per-step run state. Each step streams from /api/test/run; status drives the
  // vertical pipeline's badges + sequential gating, log holds the streamed output.
  const [stepStatus, setStepStatus] = useState<Record<TestStep, StepStatus>>({
    requirement: "idle", cases: "idle", execution: "idle", report: "idle",
  });
  const [stepLog, setStepLog] = useState<Record<TestStep, string>>({
    requirement: "", cases: "", execution: "", report: "",
  });
  const [runningStep, setRunningStep] = useState<TestStep | null>(null);
  const [expandedStep, setExpandedStep] = useState<TestStep | null>(null);
  // Model selection for test runs — reuses the chat's managed-provider picker.
  // In dev (no login) the list may be empty; after packaged-app login the
  // account-delivered models populate it. Selection is remembered in localStorage.
  const [model, setModel] = useState<string>(() => {
    try { return localStorage.getItem("codepilot:last-model") || ""; } catch { return ""; }
  });
  const [providerId, setProviderId] = useState<string>(() => {
    try { return localStorage.getItem("codepilot:last-provider-id") || ""; } catch { return ""; }
  });
  const { providerGroups, currentProviderIdValue, modelOptions, globalDefaultModel, globalDefaultProvider } =
    useProviderModels(providerId || undefined, model || undefined);
  const handleModelChange = (pid: string, m: string) => {
    setProviderId(pid);
    setModel(m);
    try {
      localStorage.setItem("codepilot:last-provider-id", pid);
      localStorage.setItem("codepilot:last-model", m);
    } catch {}
  };

  const current = selected !== null ? projects[selected] ?? null : null;
  const activeTask = current && selectedTask !== null ? current.tasks[selectedTask] ?? null : null;

  const addProject = (name: string, path: string) => setProjects((ps) => [...ps, { name, path, tasks: [] }]);
  const addTask = (name: string) =>
    setProjects((ps) => ps.map((p, i) => (i === selected ? { ...p, tasks: [...p.tasks, { name }] } : p)));

  // Projects are picked from a folder — native dialog in Electron, the
  // FolderPicker browse-dialog in the browser. Project name = folder basename.
  const { isElectron, openNativePicker } = useNativeFolderPicker();
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const addProjectFromPath = (path: string) => {
    const name = path.split(/[/\\]+/).filter(Boolean).pop() || path;
    addProject(name, path);
  };
  const handlePickProject = async () => {
    if (isElectron) {
      const path = await openNativePicker({ title: t("test.addProject") });
      if (path) addProjectFromPath(path);
    } else {
      setFolderPickerOpen(true);
    }
  };

  // Reset per-step state — called when entering a task's flow so each task starts
  // fresh (Stage A keeps run state in memory, not persisted/per-task-keyed).
  const resetSteps = () => {
    setStepStatus({ requirement: "idle", cases: "idle", execution: "idle", report: "idle" });
    setStepLog({ requirement: "", cases: "", execution: "", report: "" });
    setExpandedStep(null);
  };

  // A step is unlocked when it's the first step or the previous step is done.
  const stepUnlocked = (step: TestStep): boolean => {
    const idx = STEPS.findIndex((s) => s.step === step);
    if (idx <= 0) return true;
    return stepStatus[STEPS[idx - 1].step] === "done";
  };

  // Run one test step: streams /api/test/run (framework step prompt + rules via
  // streamClaude) into the step's log + status. One step at a time; status drives
  // the vertical pipeline's badges + gating. SSE frame shape matches the chat path.
  const runStep = async (step: TestStep) => {
    const proj = selected !== null ? projects[selected] : null;
    const task = proj && selectedTask !== null ? proj.tasks[selectedTask] : null;
    if (!proj?.path || !task || runningStep) return;
    setRunningStep(step);
    setExpandedStep(step);
    setStepStatus((m) => ({ ...m, [step]: "running" }));
    setStepLog((m) => ({ ...m, [step]: "" }));
    const append = (chunk: string) => setStepLog((m) => ({ ...m, [step]: m[step] + chunk }));
    let sawError = false;
    try {
      const res = await fetch("/api/test/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectPath: proj.path,
          taskName: task.name,
          step,
          model: model || undefined,
          providerId: providerId || undefined,
        }),
      });
      if (!res.body) {
        append("无响应流");
        sawError = true;
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const frames = buf.split("\n\n");
        buf = frames.pop() || "";
        for (const frame of frames) {
          const line = frame.replace(/^data:\s?/, "").trim();
          if (!line) continue;
          let evt: { type?: string; data?: string } | null = null;
          try {
            evt = JSON.parse(line);
          } catch {
            continue;
          }
          if (!evt) continue;
          if (evt.type === "text") {
            append(evt.data || "");
          } else if (evt.type === "tool_use") {
            let label = "";
            try {
              const tu = JSON.parse(evt.data || "{}");
              label = toolUseLabel(tu.name || "", tu.input);
            } catch {}
            if (label) append(`\n  → ${label}\n`);
          } else if (evt.type === "error") {
            let msg = evt.data || "";
            try {
              const d = JSON.parse(evt.data || "{}");
              msg = d.userMessage || d.rawMessage || msg;
            } catch {}
            append(`\n[错误] ${msg}\n`);
            sawError = true;
          }
        }
      }
    } catch (e) {
      append(`\n[请求失败] ${e instanceof Error ? e.message : String(e)}`);
      sawError = true;
    } finally {
      setStepStatus((m) => ({ ...m, [step]: sawError ? "error" : "done" }));
      setRunningStep(null);
    }
  };

  const segBtn = (v: View, label: string) => (
    <button
      onClick={() => setView(v)}
      className={`px-2.5 py-1 text-xs border-r border-border last:border-r-0 transition-colors ${
        view === v ? "bg-accent text-accent-foreground font-medium" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-background">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-card px-3 py-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
          <ListChecks size={14} className="text-accent" />
          {t("test.title")}
        </span>
        <span className="flex-1" />
        {/* Top tabs: 项目 (the board/projects view) + 报告. The per-task 流程
            (pipeline) is a drill-down reached by clicking a task, not a top tab. */}
        <div className="flex overflow-hidden rounded-md border border-border">
          {segBtn("dash", t("test.projects"))}
          {segBtn("report", t("test.view.report"))}
        </div>
        <ModelSelectorDropdown
          currentModelValue={model || globalDefaultModel || ""}
          currentProviderIdValue={providerId || currentProviderIdValue}
          providerGroups={providerGroups}
          modelOptions={modelOptions}
          onProviderModelChange={handleModelChange}
          globalDefaultModel={globalDefaultModel}
          globalDefaultProvider={globalDefaultProvider}
          menuSide="bottom"
          menuAlign="right"
        />
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="mx-auto w-full max-w-4xl">
          {view === "dash" && current === null && (
            <div>
              <div className="mb-3 flex items-center gap-2">
                <h3 className="text-sm font-semibold text-foreground">
                  {t("test.projects")} ({projects.length})
                </h3>
                <span className="flex-1" />
                <button
                  onClick={handlePickProject}
                  className="flex h-7 items-center gap-1 rounded-md bg-accent px-2.5 text-xs font-medium text-accent-foreground"
                >
                  <FolderPlus size={13} /> {t("test.addProject")}
                </button>
              </div>
              {projects.length === 0 ? (
                <EmptyState icon={FolderPlus} text={t("test.projectsEmpty")} />
              ) : (
                <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
                  {projects.map((p, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        setSelected(i);
                        setSelectedTask(null);
                      }}
                      className="flex flex-col gap-1 rounded-xl border border-border bg-card p-3 text-left hover:border-accent/60"
                    >
                      <div className="flex items-center gap-2">
                        <FolderPlus size={16} className="text-accent" />
                        <span className="truncate text-sm font-medium text-foreground">{p.name}</span>
                      </div>
                      {p.path && <div className="truncate font-mono text-[11px] text-muted-foreground">{p.path}</div>}
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        {t("test.tasks")} · {p.tasks.length}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {view === "dash" && current !== null && (
            <div>
              <div className="mb-3 flex items-center gap-2">
                <button
                  onClick={() => {
                    setSelected(null);
                    setSelectedTask(null);
                  }}
                  className="flex h-7 items-center gap-1 rounded-md border border-border px-2 text-[11px] text-muted-foreground hover:text-foreground"
                >
                  <ArrowLeft size={12} /> {t("test.projects")}
                </button>
                <h3 className="text-sm font-semibold text-foreground">{current.name}</h3>
                <span className="flex-1" />
                <button
                  onClick={() => setModal("env")}
                  className="flex h-7 items-center gap-1 rounded-md border border-border px-2 text-[11px] text-muted-foreground hover:text-foreground"
                >
                  <Gear size={12} /> {t("test.envModal.title")}
                </button>
                <button
                  onClick={() => setModal("newTask")}
                  className="flex h-7 items-center gap-1 rounded-md bg-accent px-2.5 text-[11px] font-medium text-accent-foreground"
                >
                  ＋ {t("test.newTask")}
                </button>
              </div>
              {current.tasks.length === 0 ? (
                <EmptyState icon={ListChecks} text={t("test.tasksEmpty")} />
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {current.tasks.map((tk, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        setSelectedTask(i);
                        resetSteps();
                        setView("flow");
                      }}
                      className="rounded-xl border border-border bg-card p-3 text-left hover:border-accent/60"
                    >
                      <span className="text-sm font-medium text-foreground">{tk.name}</span>
                      <div className="mt-1 text-[11px] text-muted-foreground">{t("test.step.pending")}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {view === "flow" &&
            (activeTask ? (
              <div>
                <div className="mb-4 flex items-center gap-2">
                  <button
                    onClick={() => setView("dash")}
                    className="flex h-7 items-center gap-1 rounded-md border border-border px-2 text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    <ArrowLeft size={12} /> {t("test.tasks")}
                  </button>
                  <h3 className="text-sm font-semibold text-foreground">{activeTask.name}</h3>
                  {current && <span className="font-mono text-[11px] text-muted-foreground">{current.name}</span>}
                </div>
                {!current?.path && (
                  <div className="mb-3 rounded-md border border-border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
                    {t("test.flow.noPath")}
                  </div>
                )}
                {/* Vertical step pipeline: 需求 → 用例 → 执行 → 报告, top to bottom.
                    Each step gates on the previous being done; click 运行 to stream. */}
                <div className="flex flex-col gap-3">
                  {STEPS.map((s, i) => {
                    const status = stepStatus[s.step];
                    const unlocked = stepUnlocked(s.step);
                    const isRunning = runningStep === s.step;
                    const isExpanded = expandedStep === s.step;
                    const log = stepLog[s.step];
                    const badge = stepBadge(status, t);
                    return (
                      <div key={s.step} className="relative">
                        {i < STEPS.length - 1 && (
                          <span className="absolute left-[27px] top-[44px] h-[calc(100%-20px)] w-px bg-border" aria-hidden />
                        )}
                        <div className="rounded-xl border border-border bg-card">
                          <div className="flex items-center gap-3 p-3">
                            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${stepCircleClass(status)}`}>
                              {status === "done" ? "✓" : i + 1}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-foreground">{t(s.name)}</span>
                                {badge && (
                                  <span className={`rounded px-1.5 py-0 text-[10px] font-medium ${badge.cls}`}>
                                    {badge.text}
                                  </span>
                                )}
                              </div>
                              <div className="truncate text-[11px] text-muted-foreground">{t(s.desc)}</div>
                            </div>
                            <button
                              onClick={() => runStep(s.step)}
                              disabled={!current?.path || !!runningStep || !unlocked}
                              title={!unlocked ? t("test.flow.locked") : undefined}
                              className="flex h-7 shrink-0 items-center gap-1 rounded-md bg-accent px-2.5 text-[11px] font-medium text-accent-foreground disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              <Play size={12} />
                              {isRunning ? t("test.flow.running") : status === "done" ? t("test.flow.rerun") : t("test.flow.run")}
                            </button>
                            {log && (
                              <button
                                onClick={() => setExpandedStep(isExpanded ? null : s.step)}
                                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
                                title={isExpanded ? t("test.flow.collapseLog") : t("test.flow.expandLog")}
                              >
                                <CaretRight size={14} className={isExpanded ? "rotate-90 transition-transform" : "transition-transform"} />
                              </button>
                            )}
                          </div>
                          {isExpanded && log && (
                            <pre className="mx-3 mb-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-[11px] leading-relaxed text-muted-foreground">
                              {log}
                            </pre>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <EmptyState icon={ListChecks} text={t("test.flowEmpty")} />
            ))}
          {view === "report" && <EmptyState icon={ChartBar} text={t("test.reportEmpty")} />}
        </div>
      </div>

      {/* Modals + folder picker (browser fallback for project selection) */}
      {modal === "newTask" && <NewTaskModal t={t} onClose={() => setModal("none")} onAdd={addTask} />}
      {modal === "env" && <EnvModal t={t} projectName={current?.name ?? ""} onClose={() => setModal("none")} />}
      <FolderPicker
        open={folderPickerOpen}
        onOpenChange={setFolderPickerOpen}
        onSelect={(p) => {
          setFolderPickerOpen(false);
          addProjectFromPath(p);
        }}
      />
    </div>
  );
}

function EmptyState({ icon: IconCmp, text }: { icon: Icon; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/40 px-6 py-16 text-center">
      <IconCmp size={28} className="text-muted-foreground/40" />
      <p className="mt-3 text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

function ModalShell({
  title,
  subtitle,
  onClose,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="max-h-[86vh] w-[460px] max-w-[92vw] overflow-auto rounded-xl border border-border bg-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {subtitle && <p className="mt-0.5 mb-3 text-[11px] text-muted-foreground">{subtitle}</p>}
        <div className={subtitle ? "" : "mt-3"}>{children}</div>
        <div className="mt-4 flex gap-2">{footer}</div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mb-3">
      <label className="mb-1 block text-[11px] text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

const CANCEL_BTN = "flex-1 h-9 rounded-md border border-border text-xs text-foreground hover:bg-muted";
const PRIMARY_BTN =
  "flex-1 h-9 rounded-md bg-accent text-xs font-medium text-accent-foreground disabled:opacity-50 disabled:cursor-not-allowed";

function NewTaskModal({ t, onClose, onAdd }: { t: T; onClose: () => void; onAdd: (name: string) => void }) {
  const [name, setName] = useState("");
  return (
    <ModalShell
      title={t("test.newTaskModal.title")}
      subtitle={t("test.newTaskModal.subtitle")}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className={CANCEL_BTN}>{t("test.cancel")}</button>
          <button
            disabled={!name.trim()}
            onClick={() => {
              onAdd(name.trim());
              onClose();
            }}
            className={PRIMARY_BTN}
          >
            {t("test.newTaskModal.create")}
          </button>
        </>
      }
    >
      <Field label={t("test.newTaskModal.nameLabel")}>
        <input className={INPUT} value={name} onChange={(e) => setName(e.target.value)} placeholder={t("test.newTaskModal.namePlaceholder")} />
      </Field>
      <Field label={t("test.newTaskModal.targetLabel")}>
        <input className={INPUT} placeholder="http://localhost:3000/..." />
      </Field>
      <Field label={t("test.newTaskModal.importLabel")}>
        <div className="flex gap-2">
          <button className="h-9 flex-1 rounded-md border border-border text-xs text-foreground hover:bg-muted">📊 {t("test.newTaskModal.importCases")}</button>
          <button className="h-9 flex-1 rounded-md border border-border text-xs text-foreground hover:bg-muted">📄 {t("test.newTaskModal.importReqs")}</button>
          <button className="h-9 rounded-md border border-border px-3 text-xs text-muted-foreground hover:bg-muted">⬇ {t("test.newTaskModal.template")}</button>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">{t("test.newTaskModal.importHint")}</p>
      </Field>
      <div className="rounded-md bg-status-warning-muted px-3 py-2 text-[11px] text-status-warning-foreground">
        ⚠ {t("test.newTaskModal.envWarn")}
      </div>
    </ModalShell>
  );
}

function EnvModal({ t, projectName, onClose }: { t: T; projectName: string; onClose: () => void }) {
  const [tab, setTab] = useState<"local" | "sit">("local");
  return (
    <ModalShell
      title={projectName ? `${t("test.envModal.title")} · ${projectName}` : t("test.envModal.title")}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className={CANCEL_BTN}>{t("test.cancel")}</button>
          <button onClick={onClose} className={PRIMARY_BTN}>{t("test.envModal.save")}</button>
        </>
      }
    >
      <div className="mb-3 flex gap-1 border-b border-border">
        {(["local", "sit"] as const).map((e) => (
          <button
            key={e}
            onClick={() => setTab(e)}
            className={`-mb-px border-b-2 px-3 py-1.5 text-xs ${
              tab === e ? "border-accent text-accent" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {e === "local" ? "local" : "SIT"}
          </button>
        ))}
      </div>
      <Field label={t("test.envModal.frontendLabel")}>
        <input className={INPUT} placeholder="http://localhost:3000" />
      </Field>
      <Field label={t("test.envModal.apiLabel")}>
        <input className={INPUT} placeholder="http://localhost:3000/api" />
      </Field>
      <Field label={t("test.envModal.userLabel")}>
        <input className={INPUT} placeholder="test_user" />
      </Field>
      <Field label={t("test.envModal.adminLabel")}>
        <input className={INPUT} placeholder={t("test.envModal.adminPlaceholder")} />
      </Field>
      <p className="text-[11px] leading-relaxed text-muted-foreground">{t("test.envModal.note")}</p>
    </ModalShell>
  );
}
