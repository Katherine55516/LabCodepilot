"use client";

import { useState, useRef, useEffect, type ReactNode } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { ListChecks, ChartBar, Gear, ArrowLeft, FolderPlus, Play, type Icon } from "@/components/ui/icon";
import type { TranslationKey } from "@/i18n";
import { useNativeFolderPicker } from "@/hooks/useNativeFolderPicker";
import { FolderPicker } from "@/components/chat/FolderPicker";
import { ModelSelectorDropdown } from "@/components/chat/ModelSelectorDropdown";
import { useProviderModels } from "@/hooks/useProviderModels";

/**
 * Inline testing workbench (Phase 2 · 对话内嵌测试).
 *
 * Opened from the sidebar "测试" entry (toggle); covers the content area. Exit by
 * toggling 测试 again, or by opening any chat. No in-panel 收起 button.
 *
 * Layout follows the prototype (testing-inline-prototype.html): when a task's
 * 流程 is open the area SPLITS — 测试面板 (pipeline + current-step detail) on top,
 * 测试对话 (the agent's run stream as bubbles + composer) below. 看板/报告 use the
 * full height. Workflow = ai-lab-test-framework V0.3 minus code-analysis = 需求→
 * 用例→执行→报告; each step streams from /api/test/run into the conversation and
 * reads the prior step's AI_LabTest/ artifact (UI gates step N on N-1 done).
 * Projects/tasks live in local component state (real input, not persisted yet).
 */

type View = "dash" | "flow" | "report";
type ModalKind = "none" | "newTask" | "env";
type T = (key: TranslationKey, params?: Record<string, string | number>) => string;
// Backend test-step keys (match /api/test/run + src/lib/test/prompts.ts).
type TestStep = "requirement" | "cases" | "execution" | "report";
type StepStatus = "idle" | "running" | "done" | "error";
// 测试对话 bubble roles (mirrors the prototype's ai/user/tool bubbles).
type ConvoRole = "ai" | "tool" | "user" | "error";
interface ConvoMsg { role: ConvoRole; text: string }
interface FourState { total: number; pass: number; fail: number; partial: number; blocked: number }

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
      const m = name.match(/browser_(\w+)/);
      if (m) return `浏览器·${m[1]}${i.url ? `  ${clip(str(i.url))}` : ""}`;
      return name;
    }
  }
}

// Step status → dot color (pipeline strip) / badge (semantic status tokens).
function stepDotClass(status: StepStatus): string {
  switch (status) {
    case "done": return "bg-status-success";
    case "running": return "bg-accent";
    case "error": return "bg-status-error";
    default: return "bg-muted-foreground/30";
  }
}
function stepStatusText(status: StepStatus, t: T): string {
  switch (status) {
    case "running": return t("test.stepStatus.running");
    case "done": return t("test.stepStatus.done");
    case "error": return t("test.stepStatus.error");
    default: return t("test.step.pending");
  }
}

export function InlineTestingPanel() {
  const { t } = useTranslation();
  const [view, setView] = useState<View>("dash");
  const [modal, setModal] = useState<ModalKind>("none");
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [selectedTask, setSelectedTask] = useState<number | null>(null);
  // Per-step status drives the pipeline strip badges + sequential gating.
  const [stepStatus, setStepStatus] = useState<Record<TestStep, StepStatus>>({
    requirement: "idle", cases: "idle", execution: "idle", report: "idle",
  });
  const [runningStep, setRunningStep] = useState<TestStep | null>(null);
  // 测试对话 (lower half): the active task's run stream as bubbles, + execution
  // four-state tally + current case (for the detail card). Reset on task entry.
  const [convo, setConvo] = useState<ConvoMsg[]>([]);
  const [composer, setComposer] = useState("");
  const [fourState, setFourState] = useState<FourState>({ total: 0, pass: 0, fail: 0, partial: 0, blocked: 0 });
  const [currentCase, setCurrentCase] = useState("");
  const threadRef = useRef<HTMLDivElement>(null);
  // Model selection for test runs — reuses the chat's managed-provider picker.
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

  // Projects are picked from a folder — native dialog in Electron, browse-dialog in browser.
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

  // Auto-scroll the conversation to the latest bubble.
  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [convo]);

  // Reset per-task state — called when entering a task's flow so each task starts fresh.
  const resetSteps = () => {
    setStepStatus({ requirement: "idle", cases: "idle", execution: "idle", report: "idle" });
    setConvo([]);
    setFourState({ total: 0, pass: 0, fail: 0, partial: 0, blocked: 0 });
    setCurrentCase("");
  };

  const stepUnlocked = (step: TestStep): boolean => {
    const idx = STEPS.findIndex((s) => s.step === step);
    if (idx <= 0) return true;
    return stepStatus[STEPS[idx - 1].step] === "done";
  };
  // First not-done step = the "current" step the detail card focuses on.
  const nextPendingStep = (): TestStep | null => STEPS.find((s) => stepStatus[s.step] !== "done")?.step ?? null;
  const focusStep: TestStep = runningStep ?? nextPendingStep() ?? "report";

  // Run one step: stream /api/test/run into the 测试对话 (bubbles) + tally four-state
  // (execution @@RESULT frames). One step at a time; status drives pipeline + gating.
  const runStep = async (step: TestStep) => {
    const proj = selected !== null ? projects[selected] : null;
    const task = proj && selectedTask !== null ? proj.tasks[selectedTask] : null;
    if (!proj?.path || !task || runningStep) return;
    setRunningStep(step);
    setStepStatus((m) => ({ ...m, [step]: "running" }));
    if (step === "execution") {
      setFourState({ total: 0, pass: 0, fail: 0, partial: 0, blocked: 0 });
      setCurrentCase("");
    }
    const stepName = t(STEPS.find((s) => s.step === step)!.name);
    const push = (msg: ConvoMsg) => setConvo((c) => [...c, msg]);
    const appendAi = (chunk: string) =>
      setConvo((c) => {
        const last = c[c.length - 1];
        if (last && last.role === "ai") return [...c.slice(0, -1), { role: "ai", text: last.text + chunk }];
        return [...c, { role: "ai", text: chunk }];
      });
    push({ role: "user", text: `▶ ${t("test.flow.run")}「${stepName}」` });
    let sawError = false;
    let lineBuf = "";
    const processText = (chunk: string) => {
      lineBuf += chunk;
      const lines = lineBuf.split("\n");
      lineBuf = lines.pop() || "";
      for (const raw of lines) {
        const line = raw.trimEnd();
        const rIdx = line.indexOf("@@RESULT");
        if (rIdx >= 0) {
          try {
            const r = JSON.parse(line.slice(rIdx + 8).trim());
            const st = String(r.status || "").toLowerCase();
            setFourState((f) => ({
              total: f.total + 1,
              pass: f.pass + (st === "pass" ? 1 : 0),
              fail: f.fail + (st === "fail" ? 1 : 0),
              partial: f.partial + (st === "partial" ? 1 : 0),
              blocked: f.blocked + (st === "blocked" ? 1 : 0),
            }));
            push({ role: "tool", text: `■ ${r.id || "用例"} → ${st}` });
          } catch {
            appendAi(line + "\n");
          }
          continue;
        }
        if (line.startsWith("▶")) setCurrentCase(line.replace(/^▶\s*/, ""));
        if (line) appendAi(line + "\n");
      }
    };
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
        push({ role: "error", text: "无响应流" });
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
          const fline = frame.replace(/^data:\s?/, "").trim();
          if (!fline) continue;
          let evt: { type?: string; data?: string } | null = null;
          try { evt = JSON.parse(fline); } catch { continue; }
          if (!evt) continue;
          if (evt.type === "text") {
            processText(evt.data || "");
          } else if (evt.type === "tool_use") {
            let label = "";
            try {
              const tu = JSON.parse(evt.data || "{}");
              label = toolUseLabel(tu.name || "", tu.input);
            } catch {}
            if (label) push({ role: "tool", text: `→ ${label}` });
          } else if (evt.type === "error") {
            let msg = evt.data || "";
            try {
              const d = JSON.parse(evt.data || "{}");
              msg = d.userMessage || d.rawMessage || msg;
            } catch {}
            push({ role: "error", text: msg });
            sawError = true;
          }
        }
      }
      if (lineBuf.trim()) appendAi(lineBuf);
    } catch (e) {
      push({ role: "error", text: `请求失败：${e instanceof Error ? e.message : String(e)}` });
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

  const fourStateChips = (
    <div className="flex flex-wrap gap-1.5">
      <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-status-success-muted text-status-success-foreground">{t("test.state.pass")} {fourState.pass}</span>
      <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-status-error-muted text-status-error-foreground">{t("test.state.fail")} {fourState.fail}</span>
      <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-status-warning-muted text-status-warning-foreground">{t("test.state.partial")} {fourState.partial}</span>
      <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-status-info-muted text-status-info-foreground">{t("test.state.blocked")} {fourState.blocked}</span>
    </div>
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

      {view === "flow" && activeTask ? (
        /* ===== 流程: 测试面板(上) + 测试对话(下) split ===== */
        <div className="flex min-h-0 flex-1 flex-col">
          {/* upper: pipeline + current-step detail */}
          <div className="shrink-0 overflow-auto border-b border-border" style={{ maxHeight: "46vh" }}>
            <div className="mx-auto w-full max-w-4xl p-4">
              <div className="mb-3 flex items-center gap-2">
                <button
                  onClick={() => setView("dash")}
                  className="flex h-7 items-center gap-1 rounded-md border border-border px-2 text-[11px] text-muted-foreground hover:text-foreground"
                >
                  <ArrowLeft size={12} /> {t("test.projects")}
                </button>
                <h3 className="text-sm font-semibold text-foreground">{activeTask.name}</h3>
                {current && <span className="font-mono text-[11px] text-muted-foreground">{current.name}</span>}
                <span className="flex-1" />
                <button
                  onClick={() => runStep(focusStep)}
                  disabled={!current?.path || !!runningStep || !stepUnlocked(focusStep)}
                  title={!stepUnlocked(focusStep) ? t("test.flow.locked") : undefined}
                  className="flex h-7 items-center gap-1 rounded-md bg-accent px-2.5 text-[11px] font-medium text-accent-foreground disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Play size={12} /> {runningStep ? t("test.flow.running") : t("test.flow.runTask")}
                </button>
              </div>
              {!current?.path && (
                <div className="mb-3 rounded-md border border-border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
                  {t("test.flow.noPath")}
                </div>
              )}

              {/* pipeline strip (horizontal): 需求 → 用例 → 执行 → 报告 */}
              <div className="mb-3 flex flex-wrap gap-2">
                {STEPS.map((s, i) => {
                  const status = stepStatus[s.step];
                  const isFocus = s.step === focusStep;
                  const unlocked = stepUnlocked(s.step);
                  return (
                    <button
                      key={s.step}
                      onClick={() => unlocked && !runningStep && runStep(s.step)}
                      disabled={!current?.path || !!runningStep || !unlocked}
                      title={!unlocked ? t("test.flow.locked") : t("test.flow.run")}
                      className={`min-w-[120px] flex-1 rounded-lg border bg-card p-2.5 text-left transition-colors disabled:cursor-not-allowed ${
                        isFocus ? "border-accent outline outline-1 outline-accent" : "border-border"
                      } ${unlocked && !runningStep && current?.path ? "hover:border-accent/60" : ""}`}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className={`h-2 w-2 rounded-full ${stepDotClass(status)} ${status === "running" ? "animate-pulse" : ""}`} />
                        <span className="text-xs font-medium text-foreground">{i + 1}. {t(s.name)}</span>
                      </div>
                      <div className="mt-1 text-[11px] text-muted-foreground">{stepStatusText(status, t)}</div>
                    </button>
                  );
                })}
              </div>

              {/* current-step detail card */}
              <div className="rounded-xl border border-border bg-card p-3">
                <div className="mb-2 flex items-center gap-2">
                  <h4 className="text-xs font-semibold text-foreground">{t(STEPS.find((s) => s.step === focusStep)!.name)}</h4>
                  {focusStep === "execution" && (
                    <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">{t("test.flow.aiDriven")}</span>
                  )}
                  <span className="flex-1" />
                  <button
                    onClick={() => runStep(focusStep)}
                    disabled={!current?.path || !!runningStep || !stepUnlocked(focusStep)}
                    className="flex h-7 items-center gap-1 rounded-md bg-accent px-2.5 text-[11px] font-medium text-accent-foreground disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Play size={12} /> {runningStep === focusStep ? t("test.flow.running") : stepStatus[focusStep] === "done" ? t("test.flow.rerun") : t("test.flow.run")}
                  </button>
                </div>
                {focusStep === "execution" && (
                  <>
                    {fourStateChips}
                    {fourState.total > 0 && (
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                        <div className="h-full bg-accent" style={{ width: `${Math.round(((fourState.pass + fourState.fail + fourState.partial + fourState.blocked) / Math.max(fourState.total, 1)) * 100)}%` }} />
                      </div>
                    )}
                    {currentCase && <div className="mt-2 text-[11px] text-muted-foreground">▶ {currentCase}</div>}
                  </>
                )}
                <div className="mt-2 text-[11px] text-muted-foreground">{t("test.flow.evidenceNote")}</div>
              </div>
            </div>
          </div>

          {/* lower: 测试对话 (run stream) */}
          <div className="flex min-h-0 flex-1 flex-col bg-background">
            <div ref={threadRef} className="flex flex-1 flex-col gap-2 overflow-auto p-4">
              {convo.length === 0 ? (
                <p className="mt-6 text-center text-[11px] text-muted-foreground">{t("test.convo.empty")}</p>
              ) : (
                convo.map((m, i) => <ConvoBubble key={i} msg={m} />)
              )}
            </div>
            <div className="shrink-0 border-t border-border bg-card p-3">
              <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2">
                <input
                  value={composer}
                  onChange={(e) => setComposer(e.target.value)}
                  disabled
                  placeholder={t("test.convo.placeholder")}
                  className="flex-1 bg-transparent text-xs text-foreground outline-none disabled:cursor-not-allowed"
                />
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* ===== 看板 / 报告 (full height) ===== */
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

            {view === "flow" && !activeTask && <EmptyState icon={ListChecks} text={t("test.flowEmpty")} />}
            {view === "report" && <EmptyState icon={ChartBar} text={t("test.reportEmpty")} />}
          </div>
        </div>
      )}

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

// 测试对话 bubble (mirrors the prototype's ai/user/tool/error bubbles).
function ConvoBubble({ msg }: { msg: ConvoMsg }) {
  const base = "w-fit max-w-[88%] whitespace-pre-wrap rounded-lg px-3 py-2 text-[12px] leading-relaxed";
  if (msg.role === "user")
    return <div className={`${base} self-end bg-accent/10 text-foreground`}>{msg.text}</div>;
  if (msg.role === "tool")
    return <div className={`${base} self-start bg-muted font-mono text-[11px] text-muted-foreground`}>{msg.text}</div>;
  if (msg.role === "error")
    return <div className={`${base} self-start bg-status-error-muted text-status-error-foreground`}>{msg.text}</div>;
  return <div className={`${base} self-start border border-border bg-card text-foreground`}>{msg.text}</div>;
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
