"use client";

import { useState, useRef, useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useTranslation } from "@/hooks/useTranslation";
import { ListChecks, ChartBar, Gear, ArrowLeft, FolderPlus, Play, Stop, ArrowUp, SpinnerGap, Sparkle, Terminal, WarningCircle, Wrench, Trash, type Icon } from "@/components/ui/icon";
import type { TranslationKey } from "@/i18n";
import { useNativeFolderPicker } from "@/hooks/useNativeFolderPicker";
import { FolderPicker } from "@/components/chat/FolderPicker";
import { ModelSelectorDropdown } from "@/components/chat/ModelSelectorDropdown";
import { useProviderModels } from "@/hooks/useProviderModels";
import { diffRuns, funcPassRateStr } from "@/lib/test/compare";
import type { RunHistoryEntry } from "@/lib/test/history";

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
type ModalKind = "none" | "newTask" | "runChoice";
type T = (key: TranslationKey, params?: Record<string, string | number>) => string;
// Backend test-step keys (match /api/test/run + src/lib/test/prompts.ts).
type TestStep = "requirement" | "cases" | "execution" | "report";
// "review" = 待批准 (human gate): step ran, awaiting user approval before the next.
type StepStatus = "idle" | "running" | "review" | "done" | "error";
// 测试对话 bubble roles (mirrors the prototype's ai/user/tool bubbles).
type ConvoRole = "ai" | "tool" | "user" | "error";
interface ConvoMsg { role: ConvoRole; text: string }
interface FourState { total: number; pass: number; fail: number; partial: number; blocked: number }
// One executed case parsed from an execution @@RESULT frame (drives 报告 table).
interface CaseResult { id: string; status: string; actual?: string; error?: string; evidence?: string[] }
// 用例设计阶段生成的一条测试用例(读 cases.json,镜像 ai-lab-test-framework)。在用例
// 阶段详情卡展示。字段全可选 —— AI 产出可能有出入,渲染时按需兜底。
interface GeneratedCase {
  id?: string;
  priority?: string;
  caseType?: string;
  module?: string;
  requirement?: string;    // 关联故事 / 需求引用(REQ-ID)——表格「关联故事」列复用此字段
  purpose?: string;        // 用例标题
  precondition?: string;
  steps?: { content?: string; expected?: string }[];
  assertion?: string;
  oracle?: string;         // 预期结果来源:PRD/设计稿/API契约/产品确认/现状锁定
  verification?: string;   // 验证性质:功能验证 / 回归基线（oracle 双轴,决定通过率口径）
  cleanup?: string;
  tags?: string[];         // 用例标签(冒烟测试/回归测试,多选)——前端新增,后端 PUT 整份透传保存
}

// 用例设计 Excel 表格的下拉枚举(存储用中文值,与 AI 产物 / 导出列保持一致)。用例类型
// 仅作建议项:AI 仍按八类维度生成,落到这 5 类之外的旧值在 select 里原样保留、可见可改。
const CASE_TYPES = ["正向", "反向", "边界", "用户体验", "其他"] as const;
const CASE_TAGS = ["冒烟测试", "回归测试"] as const;

// A persisted report (one run.json on disk) — listed in the 报告 browser. A task can
// have several (one per env). Shape mirrors GET /api/test/reports.
interface ReportEntry {
  task: string;
  env: string;
  time: string;
  status: string;
  passStr: string;
  circuitBroken: boolean;
  counts: FourState;
  /** 功能验证四态（oracle 双轴，排除回归基线）— 功能验证通过率的权威口径。 */
  funcCounts?: FourState;
  /** 功能验证通过率 "pass/total"，全回归基线为 "N/A"（来自 run.json，见 reduce.ts）。 */
  funcPassStr?: string;
  regressionTotal?: number;
  tests: CaseResult[];
  /** The full markdown report doc ({task}-{env}.md), if the report step wrote one. */
  markdown: string;
  /** The defect report ({task}-{env}-缺陷报告.md), if generated (第三交付物). */
  defectMarkdown: string;
}

interface Project {
  name: string;
  path: string;
  tasks: { id: string; name: string }[];
}

// Per-task run state — each task keeps its own progress (powers the 看板 step
// dots + lets the user switch tasks without losing progress).
interface TaskState {
  stepStatus: Record<TestStep, StepStatus>;
  convo: ConvoMsg[];
  fourState: FourState;
  currentCase: string;
  caseResults: CaseResult[];
  circuitBroken: boolean;
  /** Free-text 追加指令 the user typed — fed into subsequent step runs' prompts. */
  notes: string[];
  /** Steps whose artifact was user-imported (新建任务) — a run reuses it, not regenerate. */
  imported?: { requirement?: boolean; cases?: boolean };
}
const DEFAULT_TASK_STATE: TaskState = {
  stepStatus: { requirement: "idle", cases: "idle", execution: "idle", report: "idle" },
  convo: [],
  fourState: { total: 0, pass: 0, fail: 0, partial: 0, blocked: 0 },
  currentCase: "",
  caseResults: [],
  circuitBroken: false,
  notes: [],
};
function makeTaskId(): string {
  try {
    return globalThis.crypto?.randomUUID?.() ?? `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  } catch {
    return `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

const INPUT =
  "w-full h-9 rounded-md border border-border bg-background px-2.5 text-xs text-foreground outline-none focus:border-primary";

// Per-task workflow (no code analysis), ported from ai-lab-test-framework V0.3:
// 需求分析 → 用例设计 → 测试执行 → 测试报告. Steps run in order; each reads the
// prior step's AI_LabTest/ artifact, so the UI gates step N on step N-1 being done.
const STEPS: { step: TestStep; name: TranslationKey; desc: TranslationKey }[] = [
  { step: "requirement", name: "test.step.requirements.name", desc: "test.step.requirements.desc" },
  { step: "cases", name: "test.step.cases.name", desc: "test.step.cases.desc" },
  { step: "execution", name: "test.step.execution.name", desc: "test.step.execution.desc" },
  { step: "report", name: "test.step.report.name", desc: "test.step.report.desc" },
];

// Gating model (ai-lab-test-framework / prototype): 需求分析 + 用例设计 are
// human-gated — they run, then wait for the user to 批准 the output before the
// next step unlocks. 测试执行 + 测试报告 are an auto-chain (run automatically once
// 用例 is approved).
const HUMAN_GATED: TestStep[] = ["requirement", "cases"];

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
    case "running": return "bg-primary";
    case "review": return "bg-status-warning";
    case "error": return "bg-status-error";
    default: return "bg-muted-foreground/30";
  }
}
// Step status → pill tint (pipeline strip). 方案A: color by STATE so progress reads
// at a glance — done=green, running=accent (active pop), review=amber, error=red,
// idle=neutral. Background + border only; the dot + text stay neutral for contrast.
function stepPillClass(status: StepStatus): string {
  switch (status) {
    case "done": return "bg-status-success-muted border-status-success-border";
    case "running": return "bg-primary/15 border-primary/40";
    case "review": return "bg-status-warning-muted border-status-warning-border";
    case "error": return "bg-status-error-muted border-status-error-border";
    default: return "bg-muted border-border"; // 未开始：浅灰填充（card=纯白，会和背景糊在一起）
  }
}
function stepStatusText(status: StepStatus, t: T): string {
  switch (status) {
    case "running": return t("test.stepStatus.running");
    case "review": return t("test.stepStatus.review");
    case "done": return t("test.stepStatus.done");
    case "error": return t("test.stepStatus.error");
    default: return t("test.step.pending");
  }
}

// 看板 task-card status chip from a task's per-step state + four-state tally.
function taskChip(st: TaskState, t: T): { text: string; cls: string } {
  const ss = STEPS.map((s) => st.stepStatus[s.step]);
  const WARN = "bg-status-warning-muted text-status-warning-foreground";
  const INFO = "bg-status-info-muted text-status-info-foreground";
  const SUCCESS = "bg-status-success-muted text-status-success-foreground";
  const ERROR = "bg-status-error-muted text-status-error-foreground";
  const MUTED = "bg-muted text-muted-foreground";
  if (ss.some((s) => s === "running")) return { text: t("test.stepStatus.running"), cls: INFO };
  if (ss.some((s) => s === "review")) return { text: t("test.stepStatus.review"), cls: WARN };
  if (ss.some((s) => s === "error")) return { text: t("test.stepStatus.error"), cls: ERROR };
  if (ss.every((s) => s === "done")) {
    return st.fourState.total > 0
      ? { text: `✓ ${st.fourState.pass}/${st.fourState.total}`, cls: SUCCESS }
      : { text: t("test.stepStatus.done"), cls: SUCCESS };
  }
  const done = ss.filter((s) => s === "done").length;
  return done > 0 ? { text: `${done}/${STEPS.length}`, cls: MUTED } : { text: t("test.step.pending"), cls: MUTED };
}

// The task's current stage name (which step the chip's status refers to) — running
// / review / error step, else the next pending step, else the last (all done → 报告).
function taskStageName(st: TaskState, t: T): string {
  const find = (status: StepStatus) => STEPS.find((s) => st.stepStatus[s.step] === status);
  const cur =
    find("running") ?? find("review") ?? find("error") ??
    STEPS.find((s) => st.stepStatus[s.step] !== "done") ?? STEPS[STEPS.length - 1];
  return t(cur.name);
}

// 把 run.json 的 ISO 时间（UTC）格式化为本地「YYYY年MM月DD日 HH:mm:ss」。
// 空值返回 ""；非法时间原样返回（兜底，不抛错）。
function fmtCnDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}年${p(d.getMonth() + 1)}月${p(d.getDate())}日 ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function InlineTestingPanel() {
  const { t } = useTranslation();
  const router = useRouter();
  const [view, setView] = useState<View>("dash");
  const [modal, setModal] = useState<ModalKind>("none");
  // 持久化迁移：projects/taskStates 改存主进程文件（GET/PUT /api/test/workbench），不再
  // 同步读 localStorage —— 打包版端口漂移会让 localStorage（绑定 origin）丢数据。初值留空，
  // 由下方 mount-time effect 异步从文件加载（含老用户 localStorage 一次性迁移）；loaded
  // 守卫确保加载完成前不会用空初值 PUT 覆盖文件里的真实数据。
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [selectedTask, setSelectedTask] = useState<number | null>(null);
  // Per-task run state (source of truth), keyed by task id. The active task's
  // values are derived below so the render reads the same names as before.
  const [taskStates, setTaskStates] = useState<Record<string, TaskState>>({});
  // 文件加载是否完成。未完成前禁止持久化写（否则空初值会覆盖文件）—— 本次迁移最关键的守卫。
  const [loaded, setLoaded] = useState(false);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [composer, setComposer] = useState("");
  // Simulated progress % for non-execution running steps (no granular progress) — see effect below.
  const [simPct, setSimPct] = useState(0);
  const threadRef = useRef<HTMLDivElement>(null);
  // When set to a task id, that task is in "run all" mode (运行任务): gated steps
  // auto-approve + the chain runs through to 报告 without waiting for 批准.
  const autoRunRef = useRef<string | null>(null);
  // The in-flight run's AbortController (问题②·停止): runStep stores its controller
  // here so the 停止 button can abort the /api/test/run fetch (and the backend agent,
  // which honors request.signal). Cleared when the run settles.
  const abortRef = useRef<AbortController | null>(null);
  // Steps the user 停止'd ("taskId:step"). A stopped step resets to idle, but the
  // auto-chain treats idle+unlocked auto-steps (执行/报告) as runnable — without this
  // guard it would instantly re-run the step the user just stopped. The entry clears
  // when the user manually re-runs that step (runStep start) or restarts the task.
  const stoppedStepRef = useRef<Set<string>>(new Set());
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

  // Test environment (local/SIT) + the config resolved from the project's
  // AI_LabTest/environments.json (exported from 设置·测试账号). Drives the
  // execution target baseUrl + login; null/未configured → prompt to set it up.
  // Persisted to localStorage (like model/providerId) so the choice survives the
  // panel unmounting / app restart — restored value is validated against
  // envCfg.allowedEnvs once the config loads (see effect below).
  const [env, setEnv] = useState(() => {
    try { return localStorage.getItem("codepilot:test-env") || "local"; } catch { return "local"; }
  });
  const [envCfg, setEnvCfg] = useState<{ configured: boolean; env: string; frontendBaseUrl: string | null; allowedEnvs: string[]; source?: string } | null>(null);
  // Change env + persist (mirrors handleModelChange). The select uses this so the
  // user's local/SIT choice is remembered across sessions.
  const handleEnvChange = (next: string) => {
    setEnv(next);
    try { localStorage.setItem("codepilot:test-env", next); } catch {}
  };

  const current = selected !== null ? projects[selected] ?? null : null;
  const activeTask = current && selectedTask !== null ? current.tasks[selectedTask] ?? null : null;

  // Active task's state, derived from the per-task map (render reads these names).
  const aId = activeTask?.id ?? "";
  const aState: TaskState = taskStates[aId] ?? DEFAULT_TASK_STATE;
  const { stepStatus, convo, fourState, currentCase, caseResults, circuitBroken } = aState;
  const runningStep: TestStep | null = STEPS.find((s) => stepStatus[s.step] === "running")?.step ?? null;
  // Per-stage progress % while a step runs (NOT overall task progress). Execution =
  // cases done/total (total parsed from the AI's "▶ 用例 N/总数" line, done = @@RESULT
  // count). Non-execution steps have no granular progress → a simulated trickle (simPct)
  // toward ~90% so the bar still shows a moving percentage.
  const execTotal = Number((currentCase.match(/\/\s*(\d+)/) || [])[1]) || 0;
  const execPct =
    runningStep === "execution" && execTotal > 0
      ? Math.min(100, Math.round((fourState.total / execTotal) * 100))
      : null;
  const barPct = !runningStep ? null : runningStep === "execution" ? execPct ?? 0 : simPct;
  const busy = busyTaskId !== null;
  // Patch a task's state BY ID (runStep captures its id, so switching tasks mid-run is safe).
  const patchTask = (id: string, patch: (s: TaskState) => Partial<TaskState>) =>
    setTaskStates((m) => {
      const cur = m[id] ?? DEFAULT_TASK_STATE;
      return { ...m, [id]: { ...cur, ...patch(cur) } };
    });

  // 追加指令: record a typed instruction on the active task — shows as a user bubble
  // and is fed into subsequent step runs' prompts (see runStep). Additive, test-only.
  const submitNote = () => {
    const text = composer.trim();
    if (!text || !activeTask || busy) return;
    patchTask(activeTask.id, (s) => ({ convo: [...s.convo, { role: "user", text }], notes: [...(s.notes ?? []), text] }));
    setComposer("");
  };

  // 对话式定向修订（区别于 submitNote 追加指令）：调 /api/test/revise 让 AI 读当前
  // 需求/用例产物 + 按指令精准改写并覆盖，流式进 convo；用例改完重新拉取展示。仅
  // 需求/用例步、且产物已存在（done/review）时可用。复用 runStep 的 SSE 帧解析。
  const reviseStep = async (step: TestStep, instruction: string) => {
    const proj = selected !== null ? projects[selected] : null;
    const task = proj && selectedTask !== null ? proj.tasks[selectedTask] : null;
    const text = instruction.trim();
    if (!proj?.path || !task || busyTaskId || !text) return;
    const id = task.id;
    const stepName = t(STEPS.find((s) => s.step === step)!.name);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBusyTaskId(id);
    const push = (msg: ConvoMsg) => patchTask(id, (s) => ({ convo: [...s.convo, msg] }));
    const appendAi = (chunk: string) =>
      patchTask(id, (s) => {
        const last = s.convo[s.convo.length - 1];
        if (last && last.role === "ai") return { convo: [...s.convo.slice(0, -1), { role: "ai", text: last.text + chunk }] };
        return { convo: [...s.convo, { role: "ai", text: chunk }] };
      });
    push({ role: "user", text: `✏️ ${t("test.revise.action")}「${stepName}」：${text}` });
    setComposer("");
    let sawError = false;
    let lineBuf = "";
    try {
      const res = await fetch("/api/test/revise", {
        method: "POST",
        signal: ctrl.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectPath: proj.path, taskName: task.name, step, instruction: text, model: model || undefined, providerId: providerId || undefined }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        push({ role: "error", text: (j.error as string) || "修订失败" });
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
            lineBuf += evt.data || "";
            const ls = lineBuf.split("\n");
            lineBuf = ls.pop() || "";
            for (const l of ls) if (l.trim()) appendAi(l + "\n");
          } else if (evt.type === "tool_use") {
            try { const tu = JSON.parse(evt.data || "{}"); const label = toolUseLabel(tu.name || "", tu.input); if (label) push({ role: "tool", text: `→ ${label}` }); } catch {}
          } else if (evt.type === "error") {
            let msg = evt.data || "";
            try { const d = JSON.parse(evt.data || "{}"); msg = d.userMessage || d.rawMessage || msg; } catch {}
            push({ role: "error", text: msg });
            sawError = true;
          }
        }
      }
      if (lineBuf.trim()) appendAi(lineBuf);
    } catch (e) {
      if (ctrl.signal.aborted || (e instanceof DOMException && e.name === "AbortError")) push({ role: "user", text: `■ ${t("test.flow.stop")}` });
      else { push({ role: "error", text: `请求失败：${e instanceof Error ? e.message : String(e)}` }); sawError = true; }
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null;
      setBusyTaskId(null);
      // 用例改完 → 重新拉取展示（需求步无 inline 展示，跳过）。
      if (!sawError && step === "cases" && proj.path) {
        try {
          const d = await fetch(`/api/test/cases?projectPath=${encodeURIComponent(proj.path)}&taskName=${encodeURIComponent(task.name)}`).then((r) => r.json());
          if (Array.isArray(d?.cases)) setCasesPreview(d.cases as GeneratedCase[]);
        } catch { /* keep current preview */ }
      }
    }
  };

  const addProject = (name: string, path: string) => setProjects((ps) => [...ps, { name, path, tasks: [] }]);
  // Create a task. 新建任务 requires importing 用例 or 需求 (at least one). The file is
  // parsed + written to the project's AI_LabTest artifacts (docx→需求.md / xlsx→cases.json)
  // BEFORE the task is created — a parse failure returns an error and creates nothing.
  // cases imported → 需求 + 用例 both skipped(done) → 直接进入「测试执行」(no 批准 gate,
  // execution unlocked, auto-chains like an approved 用例); only 需求 → 需求 待批准.
  const addTask = async (name: string, files?: NewTaskFiles): Promise<{ ok: boolean; error?: string }> => {
    const proj = selected !== null ? projects[selected] : null;
    const postImport = async (kind: "requirement" | "cases", f: ImportFile): Promise<{ ok: boolean; error?: string; preview?: string }> => {
      const res = await fetch("/api/test/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectPath: proj?.path, taskName: name, kind, filename: f.filename, dataBase64: f.dataBase64 }),
      });
      const j = await res.json().catch(() => ({}));
      return res.ok && j.ok ? { ok: true, preview: j.preview as string } : { ok: false, error: (j.error as string) || t("test.newTaskModal.importFailed") };
    };
    // Seed the 测试对话 with what was imported — otherwise the stage looks empty (it
    // renders the convo stream, not the artifact file) and the upload seems "missing".
    const seeds: ConvoMsg[] = [];
    if (proj?.path && files?.requirement) {
      const r = await postImport("requirement", files.requirement);
      if (!r.ok) return r;
      seeds.push({ role: "ai", text: `📄 已导入需求文档「${files.requirement.filename}」，已作为本任务的需求来源（待批准）。\n\n${r.preview || ""}` });
    }
    if (proj?.path && files?.cases) {
      const r = await postImport("cases", files.cases);
      if (!r.ok) return r;
      seeds.push({ role: "ai", text: `📊 已导入测试用例「${files.cases.filename}」（${r.preview || "已导入"}），需求分析与用例设计已跳过，可直接进入「测试执行」。` });
    }
    const id = makeTaskId();
    setProjects((ps) => ps.map((p, i) => (i === selected ? { ...p, tasks: [...p.tasks, { id, name }] } : p)));
    const hasReq = !!files?.requirement, hasCases = !!files?.cases;
    if (hasReq || hasCases) {
      patchTask(id, () => ({
        stepStatus: {
          // 导入用例 → 需求 + 用例 都直接 done（跳过两阶段，无需批准），execution 解锁可执行；
          // 仅导入需求 → 需求 待批准（保持原行为不变）。
          requirement: hasCases ? "done" : "review",
          cases: hasCases ? "done" : "idle",
          execution: "idle",
          report: "idle",
        },
        convo: seeds,
        // Mark imported steps so a re-run REUSES the upload instead of regenerating over it.
        imported: { requirement: hasReq, cases: hasCases },
      }));
    }
    return { ok: true };
  };

  // Mount 时从主进程文件异步加载 projects/taskStates（GET /api/test/workbench）。
  // 老用户迁移：文件为空壳（projects 空 + taskStates 无键）时，回退读旧的 localStorage
  // 两个 key —— 有就用它们完成一次性迁移（下方写 effect 会把它们 PUT 回文件）。
  // 全程 try/catch；无论成败最后都 setLoaded(true)，否则写 effect 永远被守卫挡住不落盘。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/test/workbench");
        const data = (await res.json().catch(() => ({}))) as {
          projects?: Project[];
          taskStates?: Record<string, TaskState>;
        };
        let nextProjects = Array.isArray(data.projects) ? data.projects : [];
        let nextStates =
          data.taskStates && typeof data.taskStates === "object" && !Array.isArray(data.taskStates)
            ? data.taskStates
            : {};
        // 文件里没有任何数据 → 尝试从旧 localStorage 迁移（老用户首次升级到文件版）。
        if (nextProjects.length === 0 && Object.keys(nextStates).length === 0) {
          try {
            const lp = JSON.parse(localStorage.getItem("codepilot:test-projects") || "[]");
            if (Array.isArray(lp) && lp.length) nextProjects = lp as Project[];
          } catch {}
          try {
            const lt = JSON.parse(localStorage.getItem("codepilot:test-task-states") || "{}");
            if (lt && typeof lt === "object" && !Array.isArray(lt)) nextStates = lt as Record<string, TaskState>;
          } catch {}
        }
        if (cancelled) return;
        // 僵尸 running 规整：重启后没有 in-flight 执行，持久化的 "running" 是上次关闭应用时
        // 被中断的瞬时态 → 恢复成 "error"（中断未完成），避免任务永远卡在「运行中」、且因无
        // AbortController 而停不掉（实际早已无进展）。用 error 而非 idle 是为了**不触发 auto-chain
        // effect 自动重跑**（它只跑 idle 步）——重启后应由用户主动点「运行」重跑，不擅自执行。
        for (const st of Object.values(nextStates)) {
          const ss = st?.stepStatus;
          if (ss) for (const k of Object.keys(ss) as Array<keyof typeof ss>) if (ss[k] === "running") ss[k] = "error";
        }
        setProjects(nextProjects);
        setTaskStates(nextStates);
      } catch {
        // 加载失败：保持空初值，但仍要放行 loaded，否则永远不写（用户后续新建的也存不下）。
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // 持久化：loaded 之后，debounce(~500ms) PUT 整份 { projects, taskStates } 到文件。
  // ⚠️ 必须 if (!loaded) return —— 异步加载完成前若用空初值 PUT，会覆盖文件里的真实数据。
  // 执行步运行中 taskStates 会随 SSE 帧频繁变（convo/four-state），debounce 已合并写入，
  // 故不再用「busy 时不写」语义，避免运行中的最终状态写丢。
  useEffect(() => {
    if (!loaded) return;
    const id = setTimeout(() => {
      fetch("/api/test/workbench", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projects, taskStates }),
      }).catch(() => {});
    }, 500);
    return () => clearTimeout(id);
  }, [projects, taskStates, loaded]);

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

  // Non-execution steps have no granular progress → trickle a % toward ~90% while
  // running so the progress bar still shows a moving percentage (execution uses the
  // real case % instead). Resets per step.
  useEffect(() => {
    if (!runningStep || runningStep === "execution") { setSimPct(0); return; }
    setSimPct(8);
    const id = setInterval(() => setSimPct((p) => (p >= 90 ? p : p + Math.max(1, Math.round((90 - p) / 10)))), 350);
    return () => clearInterval(id);
  }, [runningStep]);

  // Resolve the active project's env config (target baseUrl) for display in the
  // flow view. Refetches when entering a flow or switching env.
  useEffect(() => {
    if (view !== "flow" || !current?.path) { setEnvCfg(null); return; }
    let cancelled = false;
    fetch(`/api/test/env-config?projectPath=${encodeURIComponent(current.path)}&env=${encodeURIComponent(env)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d || d.error) return;
        setEnvCfg(d);
        // The persisted env may be illegal for this project (allowedEnvs comes from
        // the project's environments.json, resolved here async) — fall back to a
        // valid value so the <select> isn't stuck on an out-of-range option.
        const allowed: string[] = Array.isArray(d.allowedEnvs) ? d.allowedEnvs : [];
        if (allowed.length && !allowed.includes(env)) {
          handleEnvChange(allowed.includes("local") ? "local" : allowed[0]);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
    // handleEnvChange is stable enough (only writes localStorage); excluded to avoid re-fetch loops.
     
  }, [view, current?.path, env]);

  const stepUnlocked = (step: TestStep): boolean => {
    const idx = STEPS.findIndex((s) => s.step === step);
    if (idx <= 0) return true;
    return stepStatus[STEPS[idx - 1].step] === "done";
  };
  // viewStep:用户点流水线节点选择"查看"的阶段(只切换查看、不触发执行);null = 跟随运行中/下一个待办。
  const [viewStep, setViewStep] = useState<TestStep | null>(null);
  // 切任务时清掉查看选中,让详情卡回到新任务的运行中/下一个待办阶段。
  useEffect(() => { setViewStep(null); }, [aId]);
  // 用例设计阶段生成的用例(读 AI_LabTest/testCase/.data/{task}.cases.json),在用例阶段
  // 详情卡展示。不进 TaskState/持久化(用例可能很大),按需从文件读 —— 文件是 source of truth。
  const [casesPreview, setCasesPreview] = useState<GeneratedCase[]>([]);
  useEffect(() => {
    const cs = stepStatus.cases;
    if (!current?.path || !activeTask || (cs !== "done" && cs !== "review")) { setCasesPreview([]); return; }
    let cancelled = false;
    fetch(`/api/test/cases?projectPath=${encodeURIComponent(current.path)}&taskName=${encodeURIComponent(activeTask.name)}`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled && Array.isArray(d?.cases)) setCasesPreview(d.cases as GeneratedCase[]); })
      .catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aId, current?.path, stepStatus.cases]);
  // 用例编辑器:casesDraft 非 null = 编辑态(编辑副本);null = 只读态。保存时整份 PUT 回 cases.json。
  const [casesDraft, setCasesDraft] = useState<GeneratedCase[] | null>(null);
  const [casesSaving, setCasesSaving] = useState(false);
  useEffect(() => { setCasesDraft(null); }, [aId]); // 切任务退出编辑态,不带过上个任务的草稿
  const updateCase = (i: number, patch: Partial<GeneratedCase>) =>
    setCasesDraft((d) => (d ? d.map((c, k) => (k === i ? { ...c, ...patch } : c)) : d));
  const updateStep = (i: number, j: number, patch: Partial<{ content: string; expected: string }>) =>
    setCasesDraft((d) => (d ? d.map((c, k) => (k === i ? { ...c, steps: (c.steps ?? []).map((s, m) => (m === j ? { ...s, ...patch } : s)) } : c)) : d));
  // 用例标签多选:点同一标签切换增删(冒烟测试/回归测试可同时存在)。
  const toggleTag = (i: number, tag: string) =>
    setCasesDraft((d) => (d ? d.map((c, k) => (k === i ? { ...c, tags: (c.tags ?? []).includes(tag) ? (c.tags ?? []).filter((x) => x !== tag) : [...(c.tags ?? []), tag] } : c)) : d));
  const exportCases = (template: boolean) => {
    if (template) { window.open("/api/test/cases/export?template=1", "_blank"); return; }
    if (!current?.path || !activeTask) return;
    window.open(`/api/test/cases/export?projectPath=${encodeURIComponent(current.path)}&taskName=${encodeURIComponent(activeTask.name)}`, "_blank");
  };
  const saveCases = async () => {
    if (!current?.path || !activeTask || casesDraft === null) return;
    setCasesSaving(true);
    try {
      const r = await fetch("/api/test/cases", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectPath: current.path, taskName: activeTask.name, cases: casesDraft }),
      }).then((res) => res.json());
      if (r?.ok) { setCasesPreview(casesDraft); setCasesDraft(null); }
    } catch { /* 保存失败保留编辑态,用户可重试 */ }
    setCasesSaving(false);
  };
  // First not-done step = the "current" step the detail card focuses on.
  const nextPendingStep = (): TestStep | null => STEPS.find((s) => stepStatus[s.step] !== "done")?.step ?? null;
  // focusStep = 详情卡当前展示的阶段。执行中(runningStep 存在)强制 focus 运行中的节点,
  // 不让 viewStep 把详情卡切走;空闲时才用 viewStep(用户点节点查看)或下一个待办阶段。
  const focusStep: TestStep = runningStep ?? viewStep ?? nextPendingStep() ?? "report";
  // A human-gated step awaiting approval → drives the conversation's gate bar.
  const reviewStep = STEPS.find((s) => stepStatus[s.step] === "review")?.step ?? null;

  // Run one step: stream /api/test/run into the 测试对话 (bubbles) + tally four-state
  // (execution @@RESULT frames). One step at a time; status drives pipeline + gating.
  const runStep = async (step: TestStep) => {
    const proj = selected !== null ? projects[selected] : null;
    const task = proj && selectedTask !== null ? proj.tasks[selectedTask] : null;
    if (!proj?.path || !task || busyTaskId) return;
    const id = task.id; // capture — all updates patch THIS task even if the user switches away
    // 问题②·停止: a per-run AbortController. stopStep() aborts it → the fetch rejects
    // with AbortError, which the catch/finally below treat as a clean stop (not error).
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    stoppedStepRef.current.delete(`${id}:${step}`); // (re)running this step → clear any prior 停止 mark
    setBusyTaskId(id);
    patchTask(id, (s) => ({ stepStatus: { ...s.stepStatus, [step]: "running" } }));
    if (step === "execution") {
      patchTask(id, () => ({
        fourState: { total: 0, pass: 0, fail: 0, partial: 0, blocked: 0 },
        currentCase: "",
        caseResults: [],
        circuitBroken: false,
      }));
    }
    const stepName = t(STEPS.find((s) => s.step === step)!.name);
    const push = (msg: ConvoMsg) => patchTask(id, (s) => ({ convo: [...s.convo, msg] }));
    const appendAi = (chunk: string) =>
      patchTask(id, (s) => {
        const last = s.convo[s.convo.length - 1];
        if (last && last.role === "ai") return { convo: [...s.convo.slice(0, -1), { role: "ai", text: last.text + chunk }] };
        return { convo: [...s.convo, { role: "ai", text: chunk }] };
      });
    push({ role: "user", text: `▶ ${t("test.flow.run")}「${stepName}」` });
    let sawError = false;
    let stopped = false; // set when the run is aborted via stopStep (停止)
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
            patchTask(id, (s) => ({
              fourState: {
                total: s.fourState.total + 1,
                pass: s.fourState.pass + (st === "pass" ? 1 : 0),
                fail: s.fourState.fail + (st === "fail" ? 1 : 0),
                partial: s.fourState.partial + (st === "partial" ? 1 : 0),
                blocked: s.fourState.blocked + (st === "blocked" ? 1 : 0),
              },
              caseResults: [
                ...s.caseResults,
                {
                  id: String(r.id || "用例"),
                  status: st,
                  actual: typeof r.actual === "string" ? r.actual : undefined,
                  error: typeof r.error === "string" ? r.error : undefined,
                  evidence: Array.isArray(r.evidence) ? r.evidence.map(String) : undefined,
                },
              ],
            }));
            push({ role: "tool", text: `■ ${r.id || "用例"} → ${st}` });
          } catch {
            appendAi(line + "\n");
          }
          continue;
        }
        if (line.startsWith("▶")) patchTask(id, () => ({ currentCase: line.replace(/^▶\s*/, "") }));
        if (line) appendAi(line + "\n");
      }
    };
    try {
      const res = await fetch("/api/test/run", {
        method: "POST",
        signal: ctrl.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectPath: proj.path,
          taskName: task.name,
          step,
          env,
          // 追加指令: user-typed notes for this task, appended to the step prompt server-side.
          extraInstruction: (taskStates[id]?.notes ?? []).join("\n") || undefined,
          // Imported step → tell the AI to Read + reuse the uploaded artifact, not overwrite it.
          reuseImported:
            (step === "requirement" && !!taskStates[id]?.imported?.requirement) ||
            (step === "cases" && !!taskStates[id]?.imported?.cases) ||
            undefined,
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
      // 停止的关键(前几次没解决的根因): 执行阶段 AI 跑一个浏览器工具(可达几十秒)时后端
      // 不吐 SSE,循环卡在 await reader.read();本环境里 abort() 既不让 pending 的 read()
      // reject、reader.cancel() 也不一定能立刻唤醒它。所以改用 Promise.race —— abort 一
      // 触发就立刻赢得 race、把循环掀出去并复位,【完全不等】卡住的 read() 返回。
      const abortedSignal = new Promise<{ aborted: true }>((resolve) => {
        const onAbort = () => { reader.cancel().catch(() => {}); resolve({ aborted: true }); };
        if (ctrl.signal.aborted) onAbort();
        else ctrl.signal.addEventListener("abort", onAbort, { once: true });
      });
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const chunk = await Promise.race([reader.read(), abortedSignal]);
        if ("aborted" in chunk) { stopped = true; break; } // abort 赢得 race → 立即停止,不等 read
        const { done, value } = chunk;
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
          } else if (evt.type === "run_json") {
            // Canonical deterministic reduction from the backend — overwrites the
            // live four-state/caseResults with code-computed values (env-reclass,
            // 401 circuit-breaker) so the 报告 view shows the authoritative result.
            try {
              const rj = JSON.parse(evt.data || "{}");
              patchTask(id, () => {
                const patch: Partial<TaskState> = { circuitBroken: !!rj.circuitBroken };
                if (rj.counts) {
                  patch.fourState = {
                    total: rj.counts.total || 0,
                    pass: rj.counts.pass || 0,
                    fail: rj.counts.fail || 0,
                    partial: rj.counts.partial || 0,
                    blocked: rj.counts.blocked || 0,
                  };
                }
                if (Array.isArray(rj.tests)) {
                  patch.caseResults = rj.tests.map((tt: Record<string, unknown>) => ({
                    id: String(tt.id ?? "用例"),
                    status: String(tt.status ?? ""),
                    actual: typeof tt.actual === "string" ? tt.actual : undefined,
                    error: typeof tt.error === "string" ? tt.error : undefined,
                    evidence: Array.isArray(tt.evidence) ? tt.evidence.map(String) : undefined,
                  }));
                }
                return patch;
              });
            } catch {}
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
      // 停止 (AbortError) is a user action, not a failure — handle it cleanly below.
      if (ctrl.signal.aborted || (e instanceof DOMException && e.name === "AbortError")) {
        stopped = true;
      } else {
        push({ role: "error", text: `请求失败：${e instanceof Error ? e.message : String(e)}` });
        sawError = true;
      }
    } finally {
      // 停止: reset the step to a clean idle so the 运行 button can re-run THIS node,
      // and end run-all mode (don't chain onward). Otherwise: human-gated steps
      // (需求/用例) land in "review" unless this task is in 运行任务 (run-all) mode,
      // where gates auto-approve straight to "done".
      const autoAll = autoRunRef.current === id;
      const finalStatus: StepStatus = stopped ? "idle" : sawError ? "error" : HUMAN_GATED.includes(step) && !autoAll ? "review" : "done";
      patchTask(id, (s) => ({ stepStatus: { ...s.stepStatus, [step]: finalStatus } }));
      if (stopped) {
        // Mark so the auto-chain won't immediately re-run this just-stopped step.
        stoppedStepRef.current.add(`${id}:${step}`);
        push({ role: "user", text: `■ ${t("test.flow.stop")}「${stepName}」` });
      }
      // End run-all mode when stopped, when anything errors, or when the pipeline finishes (报告).
      if (stopped || sawError || step === "report") autoRunRef.current = null;
      // Only clear the shared abortRef if it's still ours (a fast re-run could have replaced it).
      if (abortRef.current === ctrl) abortRef.current = null;
      setBusyTaskId(null);
    }
  };

  // 停止 (问题②): abort the in-flight run. The fetch rejects with AbortError →
  // runStep's catch/finally reset the step to idle, clear run-all, and free busy,
  // so the 运行 button can re-run this node. No-op if nothing is running.
  const stopStep = () => {
    // 正常运行：abort in-flight 请求，runStep 的 catch/finally 会把该步复位为 idle。
    if (abortRef.current) { abortRef.current.abort(); return; }
    // 僵尸 running（无 in-flight：如关闭应用后重启恢复的 running，已无对应请求，abort 无效）
    // → 主动把运行中的步复位为 idle 并清 busy，让停止按钮对这种状态也生效、可重新运行。
    if (activeTask) {
      patchTask(activeTask.id, (s) => {
        const ss = { ...s.stepStatus };
        let changed = false;
        for (const k of Object.keys(ss) as Array<keyof typeof ss>) if (ss[k] === "running") { ss[k] = "idle"; changed = true; }
        return changed ? { stepStatus: ss } : {};
      });
    }
    setBusyTaskId(null);
  };

  // 删除项目/任务:删前检查是否有正在执行的任务(busyTaskId),有则在确认弹窗里做二次强提醒。
  const [deleteTarget, setDeleteTarget] = useState<
    { kind: "project" | "task"; pIdx: number; tIdx?: number; name: string; running: boolean } | null
  >(null);
  const requestDeleteProject = (pIdx: number) => {
    const p = projects[pIdx];
    if (!p) return;
    setDeleteTarget({ kind: "project", pIdx, name: p.name, running: !!busyTaskId && p.tasks.some((tk) => tk.id === busyTaskId) });
  };
  const requestDeleteTask = (tIdx: number) => {
    if (selected === null) return;
    const tk = projects[selected]?.tasks[tIdx];
    if (!tk) return;
    setDeleteTarget({ kind: "task", pIdx: selected, tIdx, name: tk.name, running: busyTaskId === tk.id });
  };
  const confirmDelete = () => {
    if (!deleteTarget) return;
    const { kind, pIdx, tIdx, running } = deleteTarget;
    if (running) { abortRef.current?.abort(); setBusyTaskId(null); } // 删除正在执行的目标 → 先中断当前运行
    if (kind === "project") {
      const ids = new Set((projects[pIdx]?.tasks ?? []).map((tk) => tk.id));
      setTaskStates((m) => { const n = { ...m }; ids.forEach((id) => delete n[id]); return n; });
      setProjects((ps) => ps.filter((_, i) => i !== pIdx));
      if (selected === pIdx) { setSelected(null); setSelectedTask(null); }
      else if (selected !== null && selected > pIdx) setSelected(selected - 1);
    } else {
      const tk = projects[pIdx]?.tasks[tIdx!];
      if (tk) setTaskStates((m) => { const n = { ...m }; delete n[tk.id]; return n; });
      setProjects((ps) => ps.map((p, i) => (i === pIdx ? { ...p, tasks: p.tasks.filter((_, j) => j !== tIdx) } : p)));
      if (selected === pIdx && selectedTask === tIdx) { setSelectedTask(null); setView("dash"); }
      else if (selected === pIdx && selectedTask !== null && selectedTask > tIdx!) setSelectedTask(selectedTask - 1);
    }
    setDeleteTarget(null);
  };

  // Approve a human-gated step (待批准 → 已完成) 并推进:批准后主动运行下一阶段。
  // 下一步若是 gated(用例),下方 auto-chain effect 不会自动跑它(其 !HUMAN_GATED 条件),
  // 故在此主动触发;execution/report 的后续接力仍交给 auto-chain effect。runStep 只看
  // busyTaskId、不依赖 unlocked,批准时无运行中任务,直接驱动安全。
  const approveStep = (step: TestStep) => {
    if (!aId) return;
    patchTask(aId, (s) => ({ stepStatus: { ...s.stepStatus, [step]: "done" } }));
    const idx = STEPS.findIndex((s) => s.step === step);
    const next = STEPS[idx + 1];
    if (next && !stoppedStepRef.current.has(`${aId}:${next.step}`)) runStep(next.step);
  };

  // Manual single-step run (pill / detail 运行 button): cancels any run-all mode so
  // gates apply normally.
  const runStepManual = (step: TestStep) => {
    autoRunRef.current = null;
    runStep(step);
  };

  // 运行任务: run the whole pipeline end-to-end, auto-approving gates (no 批准 clicks).
  // fromStart=true resets the task to a clean slate and runs from 需求 (重新执行);
  // false continues from the current / next-pending step (从当前阶段继续).
  const startRunAll = (fromStart: boolean) => {
    if (!activeTask || busy || !current?.path) return;
    const id = activeTask.id;
    autoRunRef.current = id;
    // 运行任务 drives the whole pipeline → clear this task's 停止 marks so the
    // auto-chain isn't blocked on a step the user stopped in a previous attempt.
    for (const s of STEPS) stoppedStepRef.current.delete(`${id}:${s.step}`);
    if (fromStart) {
      patchTask(id, () => ({
        stepStatus: { requirement: "idle", cases: "idle", execution: "idle", report: "idle" },
        convo: [],
        fourState: { total: 0, pass: 0, fail: 0, partial: 0, blocked: 0 },
        currentCase: "",
        caseResults: [],
        circuitBroken: false,
      }));
      runStep("requirement");
    } else {
      runStep(focusStep);
    }
  };

  // 运行任务 click: fresh task or already-finished workflow → run from the start;
  // a task mid-progress → ask whether to continue from the current stage or restart.
  const handleRunTask = () => {
    if (!activeTask || busy || !current?.path) return;
    const ss = aState.stepStatus;
    const allIdle = STEPS.every((s) => ss[s.step] === "idle");
    const allDone = STEPS.every((s) => ss[s.step] === "done");
    if (allIdle || allDone) startRunAll(true);
    else setModal("runChoice");
  };

  // Auto-chain: run the next unlocked+idle step of the ACTIVE task. Normally only
  // auto steps (执行/报告) chain; in 运行任务 mode, gated steps (需求/用例) chain too.
  // Fires when a step becomes "done". runStep excluded from deps (the idle+unlocked
  // guard + busy check prevent re-fire loops).
  useEffect(() => {
    if (busy || !current?.path || !activeTask) return;
    const autoAll = autoRunRef.current === activeTask.id;
    const tid = activeTask.id;
    const next = STEPS.find(
      (s) =>
        stepStatus[s.step] === "idle" &&
        stepUnlocked(s.step) &&
        (autoAll || !HUMAN_GATED.includes(s.step)) &&
        !stoppedStepRef.current.has(`${tid}:${s.step}`), // don't auto-rerun a 停止'd step
    );
    if (next) runStep(next.step);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskStates, busyTaskId, aId]);

  const segBtn = (v: View, label: string) => (
    <button
      onClick={() => setView(v)}
      className={`px-2.5 py-1 text-xs border-r border-border last:border-r-0 transition-colors ${
        view === v ? "bg-primary text-primary-foreground font-medium" : "text-muted-foreground hover:text-foreground"
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
      <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground">{t("test.state.blocked")} {fourState.blocked}</span>
    </div>
  );

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-background">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-card px-3 py-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
          <ListChecks size={14} className="text-primary" />
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
                {/* env (local/SIT) + resolved target from 设置·测试账号 → environments.json */}
                <select
                  value={env}
                  onChange={(e) => handleEnvChange(e.target.value)}
                  className="h-7 rounded-md border border-border bg-background px-1.5 text-[11px] text-foreground outline-none"
                >
                  {(envCfg?.allowedEnvs ?? ["local", "sit"]).map((x) => (
                    <option key={x} value={x}>{x === "sit" ? "SIT" : x}</option>
                  ))}
                </select>
                {envCfg?.frontendBaseUrl ? (
                  <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <span
                      className="max-w-[180px] truncate font-mono"
                      title={`${t("test.env.targetLabel")}: ${envCfg.frontendBaseUrl}`}
                    >
                      🎯 {envCfg.frontendBaseUrl}
                    </span>
                    {envCfg.source === "db" && (
                      <span
                        className="rounded bg-muted px-1 py-0.5 text-[10px]"
                        title={t("test.env.fromSettingsTitle")}
                      >
                        {t("test.env.fromSettings")}
                      </span>
                    )}
                  </span>
                ) : (
                  <button
                    onClick={() => router.push("/settings#test-accounts")}
                    className="rounded bg-status-warning-muted px-1.5 py-0.5 text-[10px] font-medium text-status-warning-foreground hover:opacity-80"
                  >
                    {t("test.env.unconfigured")}
                  </button>
                )}
                {/* 顶部「运行任务」按钮运行中不再变成停止 —— 停止只保留详情卡那一个,
                    避免两处停止入口造成混淆;运行中此按钮直接禁用。 */}
                <button
                  onClick={handleRunTask}
                  disabled={!current?.path || busy || !stepUnlocked(focusStep)}
                  title={!stepUnlocked(focusStep) ? t("test.flow.locked") : t("test.flow.runAllHint")}
                  className="flex h-7 items-center gap-1 rounded-md bg-primary px-2.5 text-[11px] font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Play size={12} /> {t("test.flow.runTask")}
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
                  const isRunning = status === "running";
                  // 点节点只切换"查看"(详情卡切到该阶段),不触发执行/停止 —— 执行/停止只走详情卡按钮。
                  return (
                    <button
                      key={s.step}
                      onClick={() => setViewStep(s.step)}
                      // 执行中锁定:不能点其他节点(连查看切换也禁用),避免切走详情卡 + 误以为能运行别的节点。
                      disabled={!current?.path || busy}
                      title={t(s.name)}
                      className={`min-w-[120px] flex-1 rounded-lg border p-2.5 text-left transition-colors disabled:cursor-not-allowed ${stepPillClass(status)} ${
                        isFocus ? "ring-1 ring-muted-foreground/40" : ""
                      } ${current?.path && !busy ? "hover:border-muted-foreground/40" : ""}`}
                    >
                      <div className="flex items-center gap-1.5">
                        {isRunning
                          ? <SpinnerGap size={13} className="animate-spin text-primary" />
                          : <span className={`h-2 w-2 rounded-full ${stepDotClass(status)}`} />}
                        <span className={`text-xs font-medium ${isRunning ? "text-primary" : "text-foreground"}`}>
                          {i + 1}. {t(s.name)}
                          {HUMAN_GATED.includes(s.step) && <span title={t("test.gate.auto")}> ✋</span>}
                        </span>
                      </div>
                      <div className={`mt-1 text-[11px] ${isRunning ? "text-primary" : "text-muted-foreground"}`}>
                        {stepStatusText(status, t)}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* current-step detail card */}
              <div className="rounded-xl border border-border bg-card p-3">
                <div className="mb-2 flex items-center gap-2">
                  <h4 className="text-xs font-semibold text-foreground">{t(STEPS.find((s) => s.step === focusStep)!.name)}</h4>
                  {focusStep === "execution" && (
                    <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">{t("test.flow.aiDriven")}</span>
                  )}
                  <span className="flex-1" />
                  {runningStep === focusStep ? (
                    // 运行中 → 停止 (问题②): aborts this step; it resets to idle so 运行 can re-run it.
                    <button
                      onClick={stopStep}
                      title={t("test.flow.stop")}
                      className="flex h-7 items-center gap-1 rounded-md bg-status-error px-2.5 text-[11px] font-medium text-white hover:opacity-90"
                    >
                      <Stop size={12} weight="fill" /> {t("test.flow.stop")}
                    </button>
                  ) : (
                    <button
                      onClick={() => runStepManual(focusStep)}
                      disabled={!current?.path || busy || !stepUnlocked(focusStep)}
                      className="flex h-7 items-center gap-1 rounded-md bg-primary px-2.5 text-[11px] font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Play size={12} /> {stepStatus[focusStep] === "done" ? t("test.flow.rerun") : t("test.flow.run")}
                    </button>
                  )}
                </div>
                {/* current stage's progress (%) — execution = cases done/total; other steps
                    trickle toward ~90%. Height always reserved (no jump). */}
                <div className="mt-2 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    {runningStep && <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${barPct}%` }} />}
                  </div>
                  <span className="w-9 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">{runningStep ? `${barPct}%` : ""}</span>
                </div>
                {focusStep === "execution" && (
                  <>
                    {fourStateChips}
                    {currentCase && <div className="mt-2 text-[11px] text-muted-foreground">▶ {currentCase}</div>}
                  </>
                )}
                {/* 用例设计阶段:展示生成的测试用例(参考 ai-lab-test-framework 的用例字段)。 */}
                {focusStep === "cases" && (
                  <div className="mt-2">
                    <div className="mb-1.5 flex items-center gap-1">
                      <span className="text-[11px] text-muted-foreground">{t("test.cases.total")} · {casesPreview.length}</span>
                      <span className="flex-1" />
                      {casesPreview.length > 0 && <button onClick={() => setCasesDraft(structuredClone(casesPreview))} className="rounded bg-primary px-2 py-0.5 text-[10px] font-medium text-primary-foreground hover:opacity-90">{t("test.cases.viewEdit")}</button>}
                      {casesPreview.length > 0 && <button onClick={() => exportCases(false)} className="rounded border border-border px-1.5 py-0.5 text-[10px] text-foreground hover:bg-muted">{t("test.cases.export")}</button>}
                      <button onClick={() => exportCases(true)} className="rounded border border-border px-1.5 py-0.5 text-[10px] text-foreground hover:bg-muted">{t("test.cases.template")}</button>
                    </div>
                    {/* 详情卡不再内联展示用例 —— 查看与编辑统一进「查看 / 编辑」弹窗(Excel 用例表)。
                        这里只留统计 + 入口;仅在尚无用例时给一句占位提示。 */}
                    {casesPreview.length === 0 && (
                      <p className="text-[11px] text-muted-foreground">{t("test.cases.empty")}</p>
                    )}
                  </div>
                )}
                {focusStep !== "cases" && (
                  <div className="mt-2 text-[11px] text-muted-foreground">{t("test.flow.evidenceNote")}</div>
                )}
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
            {/* gate bar: a human-gated step (需求/用例) awaiting approval */}
            {reviewStep && (
              <div className="mx-3 mb-2 flex shrink-0 items-center gap-2 rounded-md border border-status-warning-border bg-status-warning-muted px-3 py-2 text-[11px] text-status-warning-foreground">
                <span>✋ {t(STEPS.find((s) => s.step === reviewStep)!.name)}{t("test.gate.pending")}</span>
                <span className="flex-1" />
                <button
                  onClick={() => approveStep(reviewStep)}
                  className="rounded bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground"
                >
                  ✓ {t("test.gate.approve")}
                </button>
              </div>
            )}
            <div className="shrink-0 border-t border-border bg-card p-3">
              <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 focus-within:border-primary">
                <input
                  value={composer}
                  onChange={(e) => setComposer(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitNote(); }
                  }}
                  disabled={busy}
                  placeholder={busy ? t("test.convo.running") : t("test.convo.placeholder")}
                  className="flex-1 bg-transparent text-xs text-foreground outline-none disabled:cursor-not-allowed"
                />
                {(focusStep === "requirement" || focusStep === "cases") && (stepStatus[focusStep] === "done" || stepStatus[focusStep] === "review") && (
                  <button
                    onClick={() => reviseStep(focusStep, composer)}
                    disabled={busy || !composer.trim()}
                    title={t("test.revise.action")}
                    className="flex h-6 shrink-0 items-center gap-1 rounded-md border border-border px-2 text-[10px] text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Sparkle size={11} /> {t("test.revise.btn")}
                  </button>
                )}
                <button
                  onClick={submitNote}
                  disabled={busy || !composer.trim()}
                  title={t("test.convo.send")}
                  aria-label={t("test.convo.send")}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ArrowUp size={13} />
                </button>
              </div>
              <div className="mt-1 px-1 text-[10px] text-muted-foreground">
                {(focusStep === "requirement" || focusStep === "cases") && (stepStatus[focusStep] === "done" || stepStatus[focusStep] === "review")
                  ? t("test.revise.hint")
                  : t("test.convo.hint")}
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
                    className="flex h-7 items-center gap-1 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground"
                  >
                    <FolderPlus size={13} /> {t("test.addProject")}
                  </button>
                </div>
                {projects.length === 0 ? (
                  <EmptyState icon={FolderPlus} text={t("test.projectsEmpty")} />
                ) : (
                  <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
                    {projects.map((p, i) => (
                      <div key={i} className="group relative">
                        <button
                          onClick={() => {
                            setSelected(i);
                            setSelectedTask(null);
                          }}
                          className="flex w-full flex-col gap-2.5 rounded-xl border border-border bg-card p-3.5 text-left transition-colors hover:border-primary/50 hover:bg-muted/40"
                        >
                          <div className="flex items-center gap-2.5">
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                              <FolderPlus size={17} />
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-sm font-medium text-foreground">{p.name}</div>
                              {p.path && <div className="truncate font-mono text-[10px] text-muted-foreground">{p.path}</div>}
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 border-t border-border/60 pt-2 text-[11px] text-muted-foreground">
                            <ListChecks size={12} /> {p.tasks.length} {t("test.tasks")}
                          </div>
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); requestDeleteProject(i); }}
                          title={t("test.del.delete")}
                          className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-status-error-muted hover:text-status-error group-hover:opacity-100"
                        >
                          <Trash size={13} />
                        </button>
                      </div>
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
                    onClick={() => router.push("/settings#test-accounts")}
                    title={current?.path ? `${t("test.envModal.title")}（设置·测试账号；project_root = ${current.path}）` : undefined}
                    className="flex h-7 items-center gap-1 rounded-md border border-border px-2 text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    <Gear size={12} /> {t("test.envModal.title")}
                  </button>
                  <button
                    onClick={() => setModal("newTask")}
                    className="flex h-7 items-center gap-1 rounded-md bg-primary px-2.5 text-[11px] font-medium text-primary-foreground"
                  >
                    ＋ {t("test.newTask")}
                  </button>
                </div>
                {current.tasks.length === 0 ? (
                  <EmptyState icon={ListChecks} text={t("test.tasksEmpty")} />
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {current.tasks.map((tk, i) => {
                      const st = taskStates[tk.id] ?? DEFAULT_TASK_STATE;
                      const chip = taskChip(st, t);
                      return (
                        <div key={tk.id} className="group relative">
                          <button
                            onClick={() => {
                              setSelectedTask(i);
                              setView("flow");
                            }}
                            className="flex w-full flex-col gap-3 rounded-xl border border-border bg-card p-3.5 text-left transition-colors hover:border-primary/50 hover:bg-muted/40"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <span className="truncate pt-0.5 text-sm font-medium text-foreground">{tk.name}</span>
                              <div className="flex shrink-0 flex-col items-end gap-0.5">
                                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${chip.cls}`}>{chip.text}</span>
                                <span className="text-[10px] text-muted-foreground">{taskStageName(st, t)}</span>
                              </div>
                            </div>
                            <div className="flex items-start">
                              {STEPS.map((s, idx) => (
                                <div key={s.step} className="flex flex-1 flex-col items-center">
                                  {/* dot with connector lines on both sides (ends are hidden) */}
                                  <div className="flex w-full items-center">
                                    <span className={`h-px flex-1 ${idx === 0 ? "opacity-0" : "bg-border"}`} />
                                    <span className={`mx-1 h-2 w-2 shrink-0 rounded-full ${stepDotClass(st.stepStatus[s.step])}`} />
                                    <span className={`h-px flex-1 ${idx === STEPS.length - 1 ? "opacity-0" : "bg-border"}`} />
                                  </div>
                                  <span className="mt-1 text-center text-[9px] leading-tight text-muted-foreground">{t(s.name)}</span>
                                </div>
                              ))}
                            </div>
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); requestDeleteTask(i); }}
                            title={t("test.del.delete")}
                            className="absolute right-2 bottom-2 flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-status-error-muted hover:text-status-error group-hover:opacity-100"
                          >
                            <Trash size={13} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {view === "flow" && !activeTask && <EmptyState icon={ListChecks} text={t("test.flowEmpty")} />}
            {view === "report" && <ReportBrowser projects={projects} t={t} model={model} providerId={providerId} />}
          </div>
        </div>
      )}

      {/* Modals + folder picker (browser fallback for project selection) */}
      {/* 用例表弹窗（Excel 形式）：从详情卡「查看 / 编辑」打开，查看与编辑合一。9 列——
          ID / 用例标题 / 用例类型(5类下拉,兼容八类旧值) / 用例标签(冒烟·回归,多选) / 关联故事(=requirement) /
          前置条件 / 操作步骤 / 期望结果 / 优先级。oracle 双轴等次要字段不在表内,saveCases 整份透传保留。 */}
      {casesDraft !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setCasesDraft(null)}>
          <div className="flex max-h-[88vh] w-[1240px] max-w-[97vw] flex-col rounded-xl border border-border bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
              <h3 className="text-sm font-semibold text-foreground">{t("test.cases.tableTitle")}</h3>
              <span className="text-[11px] text-muted-foreground">· {casesDraft.length}</span>
              <span className="flex-1" />
              <button onClick={() => exportCases(false)} className="rounded border border-border px-2 py-1 text-[11px] text-foreground hover:bg-muted">{t("test.cases.export")}</button>
              <button onClick={() => setCasesDraft([...(casesDraft ?? []), { id: "", purpose: "", caseType: "", tags: [], steps: [{ content: "", expected: "" }] }])} className="rounded border border-border px-2 py-1 text-[11px] text-foreground hover:bg-muted">+ {t("test.cases.add")}</button>
              <button onClick={saveCases} disabled={casesSaving} className="rounded bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground disabled:opacity-40">{casesSaving ? t("test.cases.saving") : t("test.cases.save")}</button>
              <button onClick={() => setCasesDraft(null)} className="rounded border border-border px-2 py-1 text-[11px] text-foreground hover:bg-muted">{t("test.cases.cancel")}</button>
            </div>
            <div className="flex-1 overflow-auto p-3">
              {casesDraft.length === 0 ? (
                <p className="py-8 text-center text-[11px] text-muted-foreground">{t("test.cases.empty")}</p>
              ) : (
                <table className="w-full border-collapse text-[11px]" style={{ minWidth: 1180 }}>
                  <colgroup>
                    <col style={{ width: 96 }} />
                    <col style={{ width: 176 }} />
                    <col style={{ width: 104 }} />
                    <col style={{ width: 132 }} />
                    <col style={{ width: 110 }} />
                    <col style={{ width: 156 }} />
                    <col style={{ width: 232 }} />
                    <col style={{ width: 232 }} />
                    <col style={{ width: 72 }} />
                    <col style={{ width: 36 }} />
                  </colgroup>
                  <thead className="sticky top-0 z-10">
                    <tr>
                      {["ID", t("test.cases.purpose"), t("test.cases.colType"), t("test.cases.colTags"), t("test.cases.colStory"), t("test.cases.colPre"), t("test.cases.colSteps"), t("test.cases.colExpected"), t("test.cases.priority"), ""].map((h, hi) => (
                        <th key={hi} className="whitespace-nowrap border border-border bg-muted px-2 py-1.5 text-left font-medium text-foreground">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {casesDraft.map((c, i) => (
                      <tr key={i} className="align-top">
                        <td className="border border-border p-1">
                          <input value={c.id ?? ""} onChange={(e) => updateCase(i, { id: e.target.value })} placeholder="ID" className="w-full rounded border border-border bg-background px-1.5 py-0.5 text-[11px] text-foreground outline-none focus:border-primary" />
                        </td>
                        <td className="border border-border p-1">
                          <textarea value={c.purpose ?? ""} onChange={(e) => updateCase(i, { purpose: e.target.value })} rows={2} placeholder={t("test.cases.purpose")} className="w-full resize-y rounded border border-border bg-background px-1.5 py-0.5 text-[11px] text-foreground outline-none focus:border-primary" />
                        </td>
                        <td className="border border-border p-1">
                          <select value={c.caseType ?? ""} onChange={(e) => updateCase(i, { caseType: e.target.value })} className="w-full rounded border border-border bg-background px-1 py-0.5 text-[11px] text-foreground outline-none focus:border-primary">
                            <option value="">{t("test.cases.colType")}</option>
                            {CASE_TYPES.map((tp) => <option key={tp} value={tp}>{tp}</option>)}
                            {c.caseType && !(CASE_TYPES as readonly string[]).includes(c.caseType) && <option value={c.caseType}>{c.caseType}</option>}
                          </select>
                        </td>
                        <td className="border border-border p-1">
                          <div className="flex flex-wrap gap-1">
                            {CASE_TAGS.map((tg) => {
                              const on = (c.tags ?? []).includes(tg);
                              return (
                                <button key={tg} onClick={() => toggleTag(i, tg)} className={`rounded px-1.5 py-0.5 text-[10px] ${on ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground hover:bg-muted"}`}>{tg}</button>
                              );
                            })}
                          </div>
                        </td>
                        <td className="border border-border p-1">
                          <input value={c.requirement ?? ""} onChange={(e) => updateCase(i, { requirement: e.target.value })} placeholder={t("test.cases.colStory")} className="w-full rounded border border-border bg-background px-1.5 py-0.5 text-[11px] text-foreground outline-none focus:border-primary" />
                        </td>
                        <td className="border border-border p-1">
                          <textarea value={c.precondition ?? ""} onChange={(e) => updateCase(i, { precondition: e.target.value })} rows={2} placeholder={t("test.cases.colPre")} className="w-full resize-y rounded border border-border bg-background px-1.5 py-0.5 text-[11px] text-foreground outline-none focus:border-primary" />
                        </td>
                        <td className="border border-border p-1">
                          <div className="space-y-1">
                            {(c.steps ?? []).map((s, j) => (
                              <div key={j} className="flex items-start gap-1">
                                <span className="mt-1 w-4 shrink-0 text-[10px] text-muted-foreground">{j + 1}.</span>
                                <textarea value={s.content ?? ""} onChange={(e) => updateStep(i, j, { content: e.target.value })} rows={2} placeholder={t("test.cases.step")} className="min-w-0 flex-1 resize-y rounded border border-border bg-background px-1.5 py-0.5 text-[11px] text-foreground outline-none focus:border-primary" />
                                <button onClick={() => updateCase(i, { steps: (c.steps ?? []).filter((_, k) => k !== j) })} title={t("test.cases.delCase")} className="mt-1 shrink-0 px-0.5 text-[10px] text-muted-foreground hover:text-status-error">✕</button>
                              </div>
                            ))}
                            <button onClick={() => updateCase(i, { steps: [...(c.steps ?? []), { content: "", expected: "" }] })} className="text-[10px] text-primary hover:opacity-80">+ {t("test.cases.addStep")}</button>
                          </div>
                        </td>
                        <td className="border border-border p-1">
                          <div className="space-y-1">
                            {(c.steps ?? []).map((s, j) => (
                              <div key={j} className="flex items-start gap-1">
                                <span className="mt-1 w-4 shrink-0 text-[10px] text-muted-foreground">{j + 1}.</span>
                                <textarea value={s.expected ?? ""} onChange={(e) => updateStep(i, j, { expected: e.target.value })} rows={2} placeholder={t("test.cases.expected")} className="min-w-0 flex-1 resize-y rounded border border-border bg-background px-1.5 py-0.5 text-[11px] text-foreground outline-none focus:border-primary" />
                              </div>
                            ))}
                          </div>
                        </td>
                        <td className="border border-border p-1">
                          <input value={c.priority ?? ""} onChange={(e) => updateCase(i, { priority: e.target.value })} placeholder="P0" className="w-full rounded border border-border bg-background px-1.5 py-0.5 text-[11px] text-foreground outline-none focus:border-primary" />
                        </td>
                        <td className="border border-border p-1 text-center">
                          <button onClick={() => setCasesDraft((casesDraft ?? []).filter((_, k) => k !== i))} title={t("test.cases.delCase")} className="px-0.5 text-[11px] text-status-error hover:opacity-80">✕</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setDeleteTarget(null)}>
          <div className="w-[400px] max-w-[92vw] rounded-xl border border-border bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-foreground">{t("test.del.title")}</h3>
            <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">
              {t(deleteTarget.kind === "project" ? "test.del.msgProject" : "test.del.msgTask")}
            </p>
            <p className="mt-1 truncate text-sm font-medium text-foreground">「{deleteTarget.name}」</p>
            {deleteTarget.running && (
              <p className="mt-2.5 flex items-start gap-1.5 rounded-md bg-status-error-muted px-2.5 py-2 text-[11px] font-medium text-status-error">
                <WarningCircle size={14} className="mt-px shrink-0" />
                {t("test.del.runningWarn")}
              </p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setDeleteTarget(null)} className="h-8 rounded-md border border-border px-3 text-xs text-foreground hover:bg-muted">
                {t("test.cancel")}
              </button>
              <button onClick={confirmDelete} className="h-8 rounded-md bg-status-error px-3 text-xs font-medium text-white hover:opacity-90">
                {deleteTarget.running ? t("test.del.stopDelete") : t("test.del.confirm")}
              </button>
            </div>
          </div>
        </div>
      )}
      {modal === "newTask" && <NewTaskModal t={t} onClose={() => setModal("none")} onAdd={addTask} />}
      {modal === "runChoice" && activeTask && (
        <RunChoiceModal
          t={t}
          stage={taskStageName(aState, t)}
          onContinue={() => { setModal("none"); startRunAll(false); }}
          onRestart={() => { setModal("none"); startRunAll(true); }}
          onClose={() => setModal("none")}
        />
      )}
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

// 测试对话 bubble: user = right-aligned accent; ai/tool/error = left with an
// avatar icon (Sparkle / Terminal / WarningCircle) + a role-tinted bubble.
function ConvoBubble({ msg }: { msg: ConvoMsg }) {
  const bubble = "max-w-[82%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-[12px] leading-relaxed";
  if (msg.role === "user")
    return (
      <div className="flex justify-end">
        <div className={`${bubble} rounded-br-sm bg-primary text-primary-foreground`}>{msg.text}</div>
      </div>
    );
  const cfg =
    msg.role === "error"
      ? { Icon: WarningCircle, avatar: "bg-status-error-muted text-status-error-foreground", body: "bg-status-error-muted text-status-error-foreground" }
      : msg.role === "tool"
        ? { Icon: Terminal, avatar: "bg-muted text-muted-foreground", body: "bg-muted font-mono text-[11px] text-muted-foreground" }
        : { Icon: Sparkle, avatar: "bg-primary/15 text-primary", body: "border border-border bg-card text-foreground" };
  const Cmp = cfg.Icon;
  return (
    <div className="flex items-start gap-2">
      <div className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${cfg.avatar}`}>
        <Cmp size={13} />
      </div>
      <div className={`${bubble} rounded-tl-sm ${cfg.body}`}>{msg.text}</div>
    </div>
  );
}

// 报告 view (prototype): metrics row + per-case results table, from the execution
// run's @@RESULT frames (caseResults) + four-state tally. Facts only.
function ReportView({ t, results, four, funcCounts, funcPassStr, circuitBroken, taskName, projectPath, env }: { t: T; results: CaseResult[]; four: FourState; funcCounts?: FourState; funcPassStr?: string; circuitBroken?: boolean; taskName: string; projectPath?: string; env?: string }) {
  // 证据媒体（图片灯箱 + 录像内联回放）：经 /api/test/media 白名单流式取证据；
  // lightbox=当前放大查看的文件名。无 projectPath（如流程内调用）时退化为文件名文本。
  const [lightbox, setLightbox] = useState<string | null>(null);
  const mediaUrl = (file: string) => `/api/test/media?projectPath=${encodeURIComponent(projectPath || "")}&taskName=${encodeURIComponent(taskName)}&env=${encodeURIComponent(env || "local")}&file=${encodeURIComponent(file)}`;
  const isVid = (f: string) => /\.(webm|mp4|mov)$/i.test(f);
  const total = four.total || results.length;
  const execRate = total ? Math.round((four.pass / total) * 100) : 0;
  // 功能验证通过率（oracle 双轴，排除回归基线）：用后端权威 funcCounts/funcPassStr，
  // 缺失（legacy 报告）回退「扣除 blocked」执行口径；全回归基线 → "N/A"，不报「100%」。
  const funcRateStr = funcPassRateStr({ total, pass: four.pass, blocked: four.blocked }, funcCounts, funcPassStr);
  const metric = (label: string, value: string, danger?: boolean) => (
    <div className="rounded-lg bg-muted/40 p-3">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={`text-2xl font-semibold ${danger ? "text-status-error-foreground" : "text-foreground"}`}>{value}</div>
    </div>
  );
  const chipCls: Record<string, string> = {
    pass: "bg-status-success-muted text-status-success-foreground",
    fail: "bg-status-error-muted text-status-error-foreground",
    partial: "bg-status-warning-muted text-status-warning-foreground",
    blocked: "bg-muted text-muted-foreground",
  };
  const chipLabel: Record<string, TranslationKey> = {
    pass: "test.state.pass", fail: "test.state.fail", partial: "test.state.partial", blocked: "test.state.blocked",
  };
  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <ChartBar size={15} className="text-primary" />
        <h3 className="text-sm font-semibold text-foreground">{taskName}</h3>
        <span className="text-[11px] text-muted-foreground">· {t("test.view.report")}</span>
      </div>
      {circuitBroken && (
        <div className="mb-3 rounded-md border border-status-error-border bg-status-error-muted px-3 py-2 text-[11px] text-status-error-foreground">
          ⚠ {t("test.report.circuitBroken")}
        </div>
      )}
      <div className="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
        {metric(t("test.report.funcRate"), funcRateStr)}
        {metric(t("test.report.caseCount"), String(total))}
        {metric(t("test.report.execRate"), `${execRate}%`)}
        {metric(t("test.report.defects"), String(four.fail), four.fail > 0)}
      </div>
      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full border-collapse text-[11px]">
          <thead>
            <tr className="bg-muted/50 text-left text-muted-foreground">
              <th className="px-2 py-1.5 font-medium">{t("test.report.colId")}</th>
              <th className="px-2 py-1.5 font-medium">{t("test.report.colActual")}</th>
              <th className="px-2 py-1.5 font-medium">{t("test.report.colStatus")}</th>
              <th className="px-2 py-1.5 font-medium">{t("test.report.colEvidence")}</th>
              <th className="px-2 py-1.5 font-medium">{t("test.report.colReason")}</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r, i) => (
              <tr key={i} className="border-t border-border align-top">
                <td className="px-2 py-1.5 font-mono text-foreground">{r.id}</td>
                <td className="px-2 py-1.5 text-muted-foreground">{r.actual || "—"}</td>
                <td className="whitespace-nowrap px-2 py-1.5">
                  <span className={`inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-medium ${chipCls[r.status] || "bg-muted text-muted-foreground"}`}>
                    {chipLabel[r.status] ? t(chipLabel[r.status]) : r.status}
                  </span>
                </td>
                <td className="px-2 py-1.5">
                  {r.evidence?.length && projectPath ? (
                    <div className="flex flex-wrap gap-1">
                      {r.evidence.map((f, k) => isVid(f) ? (
                        <button key={k} onClick={() => setLightbox(f)} title={f} className="rounded border border-border px-1 py-0.5 text-[10px] text-primary hover:bg-muted">🎬 {t("test.media.video")}</button>
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={k} src={mediaUrl(f)} alt={f} title={f} onClick={() => setLightbox(f)} className="h-10 w-10 cursor-pointer rounded border border-border object-cover transition hover:opacity-80" />
                      ))}
                    </div>
                  ) : (
                    <span className="text-muted-foreground">{r.evidence?.length ? r.evidence.join(", ") : "—"}</span>
                  )}
                </td>
                <td className="px-2 py-1.5 text-muted-foreground">{r.error || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">ℹ️ {t("test.report.factsNote")}</p>
      {lightbox && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6" onClick={() => setLightbox(null)}>
          {isVid(lightbox) ? (
            <video src={mediaUrl(lightbox)} controls autoPlay className="max-h-full max-w-full" onClick={(e) => e.stopPropagation()} />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={mediaUrl(lightbox)} alt={lightbox} className="max-h-full max-w-full object-contain" onClick={(e) => e.stopPropagation()} />
          )}
        </div>
      )}
    </div>
  );
}

// 报告多版本对比（regression analysis）：选两次执行 → 双口径通过率变化 + 逐用例状态
// diff。数据来自 GET /api/test/reports/history（.history 快照）；diff 用纯函数 diffRuns。
// 默认基线=上一版(history[1])、目标=最新(history[0])，可改选。
function CompareView({ t, projectPath, taskName, env }: { t: T; projectPath: string; taskName: string; env: string }) {
  const [history, setHistory] = useState<RunHistoryEntry[] | null>(null);
  const [aIdx, setAIdx] = useState(1); // 基线（旧）
  const [bIdx, setBIdx] = useState(0); // 目标（新）
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/test/reports/history?projectPath=${encodeURIComponent(projectPath)}&taskName=${encodeURIComponent(taskName)}&env=${encodeURIComponent(env)}`)
      .then((r) => (r.ok ? r.json() : { history: [] }))
      .then((d) => { if (!cancelled) setHistory((d.history ?? []) as RunHistoryEntry[]); })
      .catch(() => { if (!cancelled) setHistory([]); });
    return () => { cancelled = true; };
  }, [projectPath, taskName, env]);

  if (history === null) return <p className="text-[11px] text-muted-foreground">{t("test.report.loading")}</p>;
  if (history.length < 2) return <p className="text-[11px] text-muted-foreground">{t("test.compare.needTwo")}</p>;

  const a = history[Math.min(aIdx, history.length - 1)];
  const b = history[Math.min(bIdx, history.length - 1)];
  const diff = diffRuns(a, b); // a=基线(prev)，b=目标(curr)
  const verLabel = (e: RunHistoryEntry) => `${e.time ? fmtCnDateTime(e.time) : e.stamp} · ${e.passStr || "—"}`;
  const stLabel: Record<string, TranslationKey> = { pass: "test.state.pass", fail: "test.state.fail", partial: "test.state.partial", blocked: "test.state.blocked" };
  const st = (s: string | null) => (s ? (stLabel[s] ? t(stLabel[s]) : s) : "—");

  const rateCard = (title: string, rd: { prev: number | null; curr: number | null; delta: number | null }) => {
    const fmt = (v: number | null) => (v === null ? "N/A" : `${v}%`);
    const dColor = rd.delta === null || rd.delta === 0 ? "text-muted-foreground" : rd.delta > 0 ? "text-status-success-foreground" : "text-status-error-foreground";
    const dStr = rd.delta === null ? "" : rd.delta > 0 ? `▲ +${rd.delta}` : rd.delta < 0 ? `▼ ${rd.delta}` : "±0";
    return (
      <div className="rounded-lg bg-muted/40 p-3">
        <div className="text-[11px] text-muted-foreground">{title}</div>
        <div className="text-base font-semibold text-foreground">
          {fmt(rd.prev)} <span className="text-muted-foreground">→</span> {fmt(rd.curr)} <span className={`text-xs ${dColor}`}>{dStr}</span>
        </div>
      </div>
    );
  };

  const changeCls: Record<string, string> = {
    regressed: "bg-status-error-muted text-status-error-foreground",
    improved: "bg-status-success-muted text-status-success-foreground",
    added: "bg-status-info-muted text-status-info-foreground",
    removed: "bg-muted text-muted-foreground",
    unchanged: "bg-muted/50 text-muted-foreground",
  };
  const changeLabel: Record<string, TranslationKey> = {
    regressed: "test.compare.regressed", improved: "test.compare.improved",
    added: "test.compare.added", removed: "test.compare.removed", unchanged: "test.compare.unchanged",
  };
  const changed = diff.cases.filter((c) => c.change !== "unchanged");

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="text-muted-foreground">{t("test.compare.baseline")}</span>
        <select value={aIdx} onChange={(e) => setAIdx(Number(e.target.value))} className="rounded border border-border bg-background px-1.5 py-0.5 text-foreground outline-none focus:border-primary">
          {history.map((h, i) => <option key={h.file} value={i}>{verLabel(h)}</option>)}
        </select>
        <span className="text-muted-foreground">→ {t("test.compare.target")}</span>
        <select value={bIdx} onChange={(e) => setBIdx(Number(e.target.value))} className="rounded border border-border bg-background px-1.5 py-0.5 text-foreground outline-none focus:border-primary">
          {history.map((h, i) => <option key={h.file} value={i}>{verLabel(h)}</option>)}
        </select>
      </div>
      <div className="mb-2 grid grid-cols-2 gap-2">
        {rateCard(t("test.report.funcRate"), diff.funcRate)}
        {rateCard(t("test.report.execRate"), diff.execRate)}
      </div>
      <div className="mb-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
        <span className="text-status-error-foreground">⚠ {t("test.compare.regressed")} {diff.regressed}</span>
        <span className="text-status-success-foreground">{t("test.compare.improved")} {diff.improved}</span>
        {diff.added > 0 && <span className="text-muted-foreground">{t("test.compare.added")} {diff.added}</span>}
        {diff.removed > 0 && <span className="text-muted-foreground">{t("test.compare.removed")} {diff.removed}</span>}
      </div>
      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full border-collapse text-[11px]">
          <thead>
            <tr className="bg-muted/50 text-left text-muted-foreground">
              <th className="px-2 py-1.5 font-medium">{t("test.report.colId")}</th>
              <th className="px-2 py-1.5 font-medium">{t("test.compare.baseline")}</th>
              <th className="px-2 py-1.5 font-medium">{t("test.compare.target")}</th>
              <th className="px-2 py-1.5 font-medium">{t("test.compare.change")}</th>
            </tr>
          </thead>
          <tbody>
            {changed.length === 0 ? (
              <tr><td colSpan={4} className="px-2 py-3 text-center text-muted-foreground">{t("test.compare.noChange")}</td></tr>
            ) : (
              changed.map((c) => (
                <tr key={c.id} className="border-t border-border">
                  <td className="px-2 py-1.5 font-mono text-foreground">{c.id}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-muted-foreground">{st(c.prev)}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-muted-foreground">{st(c.curr)}</td>
                  <td className="whitespace-nowrap px-2 py-1.5"><span className={`inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-medium ${changeCls[c.change]}`}>{t(changeLabel[c.change])}</span></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// 报告 view: browse persisted reports by 项目 → 任务 → 环境. A task can have multiple
// reports (one per env); each row expands to the full ReportView. Reads from disk via
// GET /api/test/reports (per project).
function ReportBrowser({ projects, t, model, providerId }: { projects: Project[]; t: T; model: string; providerId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState<{ project: Project; reports: ReportEntry[] }[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [rowTab, setRowTab] = useState<Record<string, "result" | "compare" | "defect">>({});
  const [defectBusy, setDefectBusy] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [handoffKey, setHandoffKey] = useState<string | null>(null);

  // 交给研发修复: hand a failing report to the 研发平台 (coding chat). Creates a
  // project-scoped session, seeds the bug report as a composer DRAFT (MessageInput
  // reads codepilot:draft:{id} on mount), then navigates — the user reviews before
  // sending, then the coding agent fixes in the same repo.
  const handoff = async (project: Project, r: ReportEntry) => {
    const key = `${project.path}|${r.task}|${r.env}`;
    const failed = r.tests.filter((c) => String(c.status).toLowerCase() === "fail");
    const lines = failed
      .map((c) => `- ${c.id}：${c.actual || c.error || "（详见报告）"}${c.evidence?.length ? `（证据：${c.evidence.join("、")}）` : ""}`)
      .join("\n");
    const mdPath = `AI_LabTest/report/${r.task}/${r.task}-${r.env}.md`;
    const msg = [
      "请修复测试发现的缺陷。",
      "",
      `项目：${project.name}（${project.path}）`,
      `测试任务：${r.task} · 环境：${r.env}`,
      `结果：用例 ${r.counts.total}，通过 ${r.counts.pass}，失败 ${r.counts.fail}${r.counts.blocked ? `，阻塞 ${r.counts.blocked}` : ""}`,
      "",
      "失败用例（疑似应用缺陷）：",
      lines || "（无结构化用例，详见报告）",
      "",
      `完整测试报告：${mdPath}`,
      "",
      "请先 Read 上面的测试报告和相关源码，定位每个失败用例的根因并修复；改完简述每处改动。阻塞类（环境问题）不在本次修复范围。",
    ].join("\n");
    setHandoffKey(key);
    try {
      const res = await fetch("/api/chat/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ working_directory: project.path, model: model || undefined, provider_id: providerId || undefined }),
      });
      const data = await res.json();
      const id = data?.session?.id as string | undefined;
      if (!id) throw new Error("no session");
      try { sessionStorage.setItem(`codepilot:draft:${id}`, msg); } catch { /* quota */ }
      router.push(`/chat/${id}`);
    } catch {
      setHandoffKey(null);
    }
  };

  // 生成缺陷报告（第三交付物）：调 /api/test/defect 流式跑（读到结束即可），完成后触发
  // reload 让 reports 重新拉取拿到新写的 {task}-{env}-缺陷报告.md（r.defectMarkdown）。
  const defectGen = async (project: Project, r: ReportEntry) => {
    const key = `${project.path}|${r.task}|${r.env}`;
    setDefectBusy(key);
    try {
      const res = await fetch("/api/test/defect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectPath: project.path, taskName: r.task, env: r.env, model: model || undefined, providerId: providerId || undefined }),
      });
      if (res.body) {
        const reader = res.body.getReader();
        for (;;) { const { done } = await reader.read(); if (done) break; } // drain to completion
      }
      setReloadTick((n) => n + 1); // re-fetch reports → picks up the new 缺陷报告.md
      setRowTab((m) => ({ ...m, [key]: "defect" }));
    } catch {
      /* leave as-is */
    } finally {
      setDefectBusy(null);
    }
  };

  useEffect(() => {
    // All setState happens inside the async callback (Promise.all([]) resolves
    // immediately for the empty case) — avoids synchronous setState in the effect.
    let cancelled = false;
    Promise.all(
      projects
        .filter((p) => p.path)
        .map((p) =>
          fetch(`/api/test/reports?projectPath=${encodeURIComponent(p.path)}`)
            .then((r) => (r.ok ? r.json() : { reports: [] }))
            .then((d) => ({ project: p, reports: (d.reports ?? []) as ReportEntry[] }))
            .catch(() => ({ project: p, reports: [] as ReportEntry[] })),
        ),
    ).then((res) => {
      if (cancelled) return;
      setGroups(res.filter((g) => g.reports.length > 0));
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [projects, reloadTick]);

  if (loading) return <p className="mt-6 text-center text-[11px] text-muted-foreground">{t("test.report.loading")}</p>;
  if (!groups.length) return <EmptyState icon={ChartBar} text={t("test.reportEmpty")} />;

  return (
    <div className="flex flex-col gap-5">
      {groups.map(({ project, reports }) => {
        const tasks = new Map<string, ReportEntry[]>();
        for (const r of reports) { const a = tasks.get(r.task) ?? []; a.push(r); tasks.set(r.task, a); }
        return (
          <div key={project.path}>
            <div className="mb-2 flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary"><FolderPlus size={14} /></span>
              <h3 className="text-sm font-semibold text-foreground">{project.name}</h3>
              <span className="text-[11px] text-muted-foreground">{reports.length} {t("test.report.reportsSuffix")}</span>
            </div>
            <div className="flex flex-col gap-3">
              {[...tasks.entries()].map(([task, rs]) => (
                <div key={task} className="rounded-xl border border-border bg-card p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="text-[12px] font-medium text-foreground">{task}</span>
                    {rs.length > 1 && <span className="text-[10px] text-muted-foreground">{rs.length} {t("test.report.envsSuffix")}</span>}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {rs.map((r) => {
                      const key = `${project.path}|${task}|${r.env}`;
                      const isOpen = open === key;
                      const bad = r.circuitBroken || r.counts.fail > 0;
                      return (
                        <div key={key} className="overflow-hidden rounded-lg border border-border">
                          <button
                            onClick={() => setOpen(isOpen ? null : key)}
                            className="flex w-full items-center gap-2 bg-muted/40 px-3 py-1.5 text-left hover:bg-muted/70"
                          >
                            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${bad ? "bg-status-error" : "bg-status-success"}`} />
                            <span className="rounded-full bg-background px-2 py-0.5 text-[10px] font-medium text-foreground">{r.env || "—"}</span>
                            <span className="text-[11px] text-muted-foreground">
                              {t("test.state.pass")} {r.passStr || `${r.counts.pass}/${r.counts.total}`}
                              {r.counts.fail > 0 ? ` · ${t("test.state.fail")} ${r.counts.fail}` : ""}
                              {r.counts.blocked > 0 ? ` · ${t("test.state.blocked")} ${r.counts.blocked}` : ""}
                            </span>
                            <span className="flex-1" />
                            {r.time && <span className="text-[10px] text-muted-foreground">{fmtCnDateTime(r.time)}</span>}
                            <span className="w-3 text-center text-[10px] text-muted-foreground">{isOpen ? "▲" : "▼"}</span>
                          </button>
                          {isOpen && (
                            <div className="border-t border-border p-3">
                              <div className="mb-3 flex items-center gap-1.5">
                                {(["result", "compare", "defect"] as const).map((tab) => {
                                  const cur = rowTab[key] || "result";
                                  const label = tab === "result" ? t("test.compare.tabResult") : tab === "compare" ? t("test.compare.tabCompare") : t("test.defect.tab");
                                  return (
                                    <button key={tab} onClick={() => setRowTab((m) => ({ ...m, [key]: tab }))} className={`rounded px-2 py-0.5 text-[11px] ${cur === tab ? "bg-primary text-primary-foreground" : "border border-border text-foreground hover:bg-muted"}`}>{label}</button>
                                  );
                                })}
                                <span className="flex-1" />
                                {(rowTab[key] || "result") === "result" && r.counts.fail > 0 && (
                                  <button
                                    onClick={() => handoff(project, r)}
                                    disabled={handoffKey === key}
                                    className="flex h-7 items-center gap-1 rounded-md bg-primary px-2.5 text-[11px] font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    <Wrench size={12} /> {t("test.report.handoff")}（{r.counts.fail}）
                                  </button>
                                )}
                              </div>
                              {(rowTab[key] || "result") === "compare" ? (
                                <CompareView t={t} projectPath={project.path} taskName={task} env={r.env} />
                              ) : (rowTab[key] || "result") === "defect" ? (
                                <div>
                                  <div className="mb-2 flex items-center gap-2">
                                    <button
                                      onClick={() => defectGen(project, r)}
                                      disabled={defectBusy === key}
                                      className="flex h-7 items-center gap-1 rounded-md bg-primary px-2.5 text-[11px] font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                      <WarningCircle size={12} /> {defectBusy === key ? t("test.defect.generating") : r.defectMarkdown ? t("test.defect.regen") : t("test.defect.gen")}
                                    </button>
                                    <span className="text-[10px] text-muted-foreground">{t("test.defect.hint")}</span>
                                  </div>
                                  {r.defectMarkdown ? (
                                    <div className="prose prose-sm dark:prose-invert max-w-none rounded-lg border border-border bg-card p-3">
                                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{r.defectMarkdown}</ReactMarkdown>
                                    </div>
                                  ) : (
                                    <p className="text-[11px] text-muted-foreground">{defectBusy === key ? t("test.defect.generating") : t("test.defect.empty")}</p>
                                  )}
                                </div>
                              ) : (
                                <>
                                  <ReportView t={t} results={r.tests} four={r.counts} funcCounts={r.funcCounts} funcPassStr={r.funcPassStr} circuitBroken={r.circuitBroken} taskName={task} projectPath={project.path} env={r.env} />
                                  {r.markdown && (
                                    <div className="mt-3 border-t border-border pt-3">
                                      <div className="mb-2 text-[11px] font-medium text-muted-foreground">{t("test.report.docTitle")}</div>
                                      <div className="prose prose-sm dark:prose-invert max-w-none">
                                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{r.markdown}</ReactMarkdown>
                                      </div>
                                    </div>
                                  )}
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
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
  "flex-1 h-9 rounded-md bg-primary text-xs font-medium text-primary-foreground disabled:opacity-50 disabled:cursor-not-allowed";

// 新建任务导入的材料（原始文件，base64；服务端按扩展名解析 docx/xlsx）。
type ImportFile = { filename: string; dataBase64: string };
type NewTaskFiles = { requirement?: ImportFile; cases?: ImportFile };

// 运行任务 on a mid-progress task: continue from the current stage, or restart from scratch.
function RunChoiceModal({ t, stage, onContinue, onRestart, onClose }: { t: T; stage: string; onContinue: () => void; onRestart: () => void; onClose: () => void }) {
  return (
    <ModalShell
      title={t("test.runChoice.title")}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className={CANCEL_BTN}>{t("test.cancel")}</button>
          <button onClick={onRestart} className={CANCEL_BTN}>{t("test.runChoice.restart")}</button>
          <button onClick={onContinue} className={PRIMARY_BTN}>{t("test.runChoice.continue")}</button>
        </>
      }
    >
      <p className="text-xs leading-relaxed text-muted-foreground">{t("test.runChoice.desc")}</p>
      <div className="mt-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-foreground">
        {t("test.runChoice.currentStage")}：<span className="font-medium">{stage}</span>
      </div>
    </ModalShell>
  );
}

function NewTaskModal({ t, onClose, onAdd }: { t: T; onClose: () => void; onAdd: (name: string, files?: NewTaskFiles) => Promise<{ ok: boolean; error?: string }> }) {
  const [name, setName] = useState("");
  const [reqFile, setReqFile] = useState<{ name: string; data: string } | null>(null);
  const [casesFile, setCasesFile] = useState<{ name: string; data: string } | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const reqInputRef = useRef<HTMLInputElement>(null);
  const casesInputRef = useRef<HTMLInputElement>(null);
  // 新建任务必须至少导入 用例 或 需求 之一。
  const ready = !!name.trim() && (!!reqFile || !!casesFile);

  // Read as base64 (docx/xlsx are binary; the server parses by extension).
  const pick = (f: File | undefined, set: (v: { name: string; data: string }) => void) => {
    if (!f) return;
    const r = new FileReader();
    r.onload = () => { set({ name: f.name, data: String(r.result || "").split(",")[1] || "" }); setErr(""); };
    r.readAsDataURL(f);
  };

  const create = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setErr("");
    const res = await onAdd(name.trim(), {
      requirement: reqFile ? { filename: reqFile.name, dataBase64: reqFile.data } : undefined,
      cases: casesFile ? { filename: casesFile.name, dataBase64: casesFile.data } : undefined,
    });
    setBusy(false);
    if (res.ok) onClose();
    else setErr(res.error || t("test.newTaskModal.importFailed"));
  };

  return (
    <ModalShell
      title={t("test.newTaskModal.title")}
      subtitle={t("test.newTaskModal.subtitle")}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className={CANCEL_BTN}>{t("test.cancel")}</button>
          <button
            disabled={!ready || busy}
            onClick={create}
            className={PRIMARY_BTN}
          >
            {busy ? t("test.newTaskModal.importing") : t("test.newTaskModal.create")}
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
          <button onClick={() => casesInputRef.current?.click()} className="h-9 flex-1 rounded-md border border-border text-xs text-foreground hover:bg-muted">📊 {t("test.newTaskModal.importCases")}</button>
          <button onClick={() => reqInputRef.current?.click()} className="h-9 flex-1 rounded-md border border-border text-xs text-foreground hover:bg-muted">📄 {t("test.newTaskModal.importReqs")}</button>
        </div>
        <input ref={casesInputRef} type="file" accept=".json,.xlsx" className="hidden" onChange={(e) => { pick(e.target.files?.[0], setCasesFile); e.target.value = ""; }} />
        <input ref={reqInputRef} type="file" accept=".md,.txt,.markdown,.docx" className="hidden" onChange={(e) => { pick(e.target.files?.[0], setReqFile); e.target.value = ""; }} />
        {(casesFile || reqFile) && (
          <div className="mt-2 flex flex-col gap-1">
            {casesFile && (
              <div className="flex items-center gap-2 rounded-md bg-muted px-2 py-1 text-[11px] text-foreground">
                <span className="truncate">📊 {casesFile.name}</span><span className="flex-1" />
                <button onClick={() => setCasesFile(null)} className="text-muted-foreground hover:text-foreground" aria-label={t("test.cancel")}>✕</button>
              </div>
            )}
            {reqFile && (
              <div className="flex items-center gap-2 rounded-md bg-muted px-2 py-1 text-[11px] text-foreground">
                <span className="truncate">📄 {reqFile.name}</span><span className="flex-1" />
                <button onClick={() => setReqFile(null)} className="text-muted-foreground hover:text-foreground" aria-label={t("test.cancel")}>✕</button>
              </div>
            )}
          </div>
        )}
        {err && <p className="mt-1 text-[11px] text-status-error-foreground">{err}</p>}
        <p className="mt-2 text-[11px] text-muted-foreground">{t("test.newTaskModal.importHint")}</p>
      </Field>
      {!ready && (
        <div className="rounded-md bg-status-warning-muted px-3 py-2 text-[11px] text-status-warning-foreground">
          ⚠ {t("test.newTaskModal.importRequired")}
        </div>
      )}
    </ModalShell>
  );
}

