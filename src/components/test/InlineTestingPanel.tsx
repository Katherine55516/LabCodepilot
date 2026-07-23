"use client";

import { useState, useRef, useEffect, useMemo, Fragment, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter, usePathname } from "next/navigation";
import dynamic from "next/dynamic";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useTranslation } from "@/hooks/useTranslation";
import { ListChecks, ChartBar, Gear, ArrowLeft, ArrowRight, FolderPlus, FolderOpen, Play, Stop, ArrowUp, SpinnerGap, Sparkle, Terminal, WarningCircle, Wrench, Trash, Desktop, Lightning, Plug, CheckCircle, File as FileIcon, FileArrowDown, NotePencil, DownloadSimple, Eye, X, CaretDown, CaretUp, Check, Lock, PencilSimple, Plus, PushPin, Clock, MagnifyingGlass, Prohibit, ArrowClockwise, ArrowsClockwise, Bug, Warning, CaretRight, type Icon } from "@/components/ui/icon";
import { MarkdownEditor } from "@/components/editor/MarkdownEditor.lazy";
import type { TranslationKey } from "@/i18n";
import { useNativeFolderPicker } from "@/hooks/useNativeFolderPicker";
import { FolderPicker } from "@/components/chat/FolderPicker";
import { showToast } from "@/hooks/useToast";
import { normalizeProjectPath, dedupeProjectsByPath } from "@/lib/projectDedupe";
import { ModelSelectorDropdown } from "@/components/chat/ModelSelectorDropdown";
import { useProviderModels } from "@/hooks/useProviderModels";
import { diffRuns, funcPassRateStr } from "@/lib/test/compare";
import { parseExecProgress } from "@/lib/test/exec-progress";
import { createExecLineBuffer, shouldAdoptPlaceholder, type ExecLine, type LiveResult, type LiveStatus } from "@/lib/test/exec-live";
import { withDownstreamReset, runStartOptions, taskCategory, occupiedSlots, TASK_CATEGORY_ORDER, type TaskCategory } from "@/lib/test/step-status";
import { REGRESSION_LIBRARY_TASK, REGRESSION_FULL_SUITE as REGRESSION_FULL_SUITE_NAME } from "@/lib/test/library-constants";
import type { LoginStateInfo } from "@/lib/test/env-config";
import type { RunHistoryEntry } from "@/lib/test/history";
import { TestStatsView } from "@/components/test/TestStatsView";
import { PromptDialog } from "@/components/ui/prompt-dialog";

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

type View = "dash" | "flow" | "report" | "stats";
type ModalKind = "none" | "newTask" | "runStart" | "execConfirm" | "envWarn";
// 执行方式:visible=独立窗口可见运行(有头),headless=后台无头运行(默认,更快)。
type ExecMode = "headless" | "visible";
type T = (key: TranslationKey, params?: Record<string, string | number>) => string;
// Backend test-step keys (match /api/test/run + src/lib/test/prompts.ts).
// docx 原文档预览：复用文件树预览体系的 DocxViewer（docx-preview + DOMPurify + sandbox
// iframe 三层 XSS 防护，见 src/components/editor/DocxViewer.tsx）。懒加载——只有真正点开
// docx 原件预览才拉这个 chunk（docx-preview/jszip 体积不小），与 PreviewPanel 同模式。
const DocxViewer = dynamic(() => import("@/components/editor/DocxViewer").then((m) => m.DocxViewer), {
  ssr: false,
  loading: () => (
    <div className="flex flex-1 items-center justify-center">
      <SpinnerGap size={20} className="animate-spin text-muted-foreground" />
    </div>
  ),
});

type TestStep = "requirement" | "cases" | "execution" | "report";
// "review" = 待批准 (human gate): step ran, awaiting user approval before the next.
type StepStatus = "idle" | "running" | "review" | "done" | "error";
// 测试对话 bubble roles (mirrors the prototype's ai/user/tool bubbles).
type ConvoRole = "ai" | "tool" | "user" | "error";
interface ConvoMsg { role: ConvoRole; text: string }
interface FourState { total: number; pass: number; fail: number; partial: number; blocked: number }
// 失败/部分通过用例的关键请求接口信息（执行阶段采集，进缺陷报告；镜像 reduce.ts ApiInfo）。
interface ApiInfo { method?: string; url?: string; status?: number | string; requestBody?: string; responseBody?: string }
// One executed case parsed from an execution @@RESULT frame (drives 报告 table).
interface CaseResult { id: string; status: string; actual?: string; error?: string; evidence?: string[]; api?: ApiInfo; durationMs?: number }
// ── 回归执行进展面板的实时状态(v2 二/三期后续) ────────────────────────────────
// 数据全部来自执行步的 SSE 帧;**只活在内存**,切走/刷新即消失(用户明确要求不保留历史)。
// 收口后的事实去「轮次报告」页看。
//
// ⚠ 对账锚点是 `tools`(tool_use 帧计数),不是 @@CASE_START/@@RESULT 的计数。后两者都是模型
// 自由文本,同一次 markdown 装饰会把它们一起污染、让「背离」被掩盖;tool_use 是 SDK 结构化帧,
// 与模型的格式漂移无关。这是 2026-07-10 事故留下的教训(见 lib/test/markers.ts)。
type LiveEvtKind = "tool" | "ai" | "err" | "sys";
interface LiveEvt { k: LiveEvtKind; text: string; status?: LiveStatus; lost?: boolean }

interface LiveCase {
  /** 执行结果里的 id(= @@CASE_START / @@RESULT 的 id)。缺 @@CASE_START 时按进度行序号兜底。 */
  id: string;
  index: number;
  title: string;
  events: LiveEvt[];
  result?: LiveResult;
  /** 跑完了却没收到可解析的判定 —— 不是「待执行」,这个区分正是事故难查的关键。 */
  lost?: boolean;
  startedAt: number;
  ms?: number;
}

interface LibraryLive {
  step: TestStep;
  /** 本轮 roundId(执行面板「查看轮次报告」下钻到这一轮用)。 */
  roundId?: string;
  suiteName: string;
  env: string;
  /** 发起时确定的圈选条数(agg.total),进度分母。 */
  total: number;
  pre: LiveEvt[];
  cases: LiveCase[];
  curIdx: number;
  /** tool_use 帧计数 —— 对账锚点。 */
  tools: number;
  started: number;
  verdicts: number;
  malformed: number;
  four: FourState;
  /** 执行步流末的权威归约(报告步那条必须忽略,否则会把盘面清零)。 */
  runJson: FourState | null;
  errored: boolean;
  /** 用户点了「停止」——与 errored 的真实失败区分显示(已手动停止 vs 执行中断)。 */
  stopped?: boolean;
  /** 收口后的补充说明(如「报告步被停止,执行结果已保留」),渲染在收口 footer。 */
  note?: string;
  errorText?: string;
  /** 最后一帧的时刻 —— 用于推断「收口中」(服务端做证据归集与归约时不发任何帧)。 */
  lastFrameAt: number;
  finished: boolean;
}

const EMPTY_FOUR: FourState = { total: 0, pass: 0, fail: 0, partial: 0, blocked: 0 };
/** 最后一帧起超过这个时长仍无 run_json → 判定为「收口中」(服务端在归约,无帧)。 */
const LIVE_SETTLE_MS = 1500;
/** 收口态持续超过这个时长 → 提示「疑似卡住」。 */
const LIVE_STUCK_MS = 90_000;

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
  /** 回归集口径（tags 含「回归测试」，与 regressionTotal 的回归基线口径正交）；旧 run.json 缺省。 */
  suiteCounts?: FourState;
  /** 回归集 "pass/total"；pass < total 即未全过（发版红线）。 */
  suitePassStr?: string;
  tests: CaseResult[];
  /** run.json 全文 SHA-1（与执行埋点同源）：把人工复核关联到确切执行轮。 */
  runHash?: string;
  /** The full markdown report doc ({task}-{env}.md), if the report step wrote one. */
  markdown: string;
  /** The defect report ({task}-{env}-缺陷报告.md), if generated (第三交付物). */
  defectMarkdown: string;
}

type ScriptJobStatusView = "queued" | "running" | "done" | "partial" | "error" | "stale";
type ScriptCaseStatusView = "verified" | "needs_review" | "failed" | "stale" | "outdated";
interface ScriptManifestCaseView {
  caseId: string;
  file: string;
  sourceTask?: string;
  sourceCaseId?: string;
  status: ScriptCaseStatusView;
  usesMock: boolean;
  error?: string;
  validation?: { syntax: boolean; collected: boolean; replayed: boolean; warnings: string[]; error?: string };
  /** 最近一次手动运行的失败原因（运行失败不改 status，故卡片只能靠它显示"为什么没变绿"）。 */
  lastRunError?: string;
  lastRunAt?: string;
  /** 最近一次 AI 修复的结论（修了什么 / 为什么不是脚本缺陷），写给不会写代码的测试人员。 */
  repairNote?: string;
  /** 人工确认 mock 脚本通过的时刻（见 script-artifacts.ts 的字段注释）。 */
  manualVerifiedAt?: string;
}
interface ScriptManifestView {
  latestRunHash: string;
  updatedAt?: string;
  jobStatus: ScriptJobStatusView;
  counts: { eligible: number; generated: number; verified: number; needsReview: number; failed: number };
  cases: ScriptManifestCaseView[];
  error?: string;
}

interface Project {
  name: string;
  path: string;
  tasks: { id: string; name: string }[];
  /** R1：该项目记住的测试环境(local/SIT)，随项目切换各自恢复；缺省→迁移旧的全局值。 */
  selectedEnv?: string;
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
  /**
   * 导入需求的处理方式（在需求分析节点二选一）：
   *  - undefined 且 imported.requirement=true → 「待选择」：阻塞自动接力，等用户在节点选卡片；
   *  - 'generate-md'  → AI 读原文归一产 需求.md（原始 + md 两份都保留）；
   *  - 'use-original' → 跳过 AI，用例设计直接读原始文档。
   * 旧任务（有旧 需求.md、无 requirementOriginal）加载时回填 'use-original'，不弹待选择。
   */
  requirementMode?: "generate-md" | "use-original";
  /** 保留的原始需求文档信息（导入需求时写入）：原文件名 + 扩展名，用于预览与定位需求来源文件。 */
  requirementOriginal?: { filename: string; ext: string };
  /** 使用统计：各节点最近一次运行的服务端权威用时（ms）+ 所用模型（step_stats 帧写入，随 workbench 持久化）。 */
  stepDurations?: Partial<Record<TestStep, number>>;
  stepModels?: Partial<Record<TestStep, string>>;
  /**
   * 是否为本任务沉淀回归脚本（新建任务时选定，任务页可随时改）。
   *
   * 缺省（undefined）= 开启 —— 存量任务与旧持久化数据没有这个字段，必须保持原有行为，
   * 不能因为加了开关就让老任务静默停止沉淀。故所有判定一律写 `!== false`。
   */
  depositScripts?: boolean;
  /**
   * 任务级被测入口地址（新建任务「目标」输入框；执行前确认弹窗改地址会按规则回写）。
   *
   * 执行步的地址优先级：弹窗显式确认 > 本字段 > 项目环境配置(environments.json)。
   * 缺省（undefined）= 无任务级覆盖，跟随环境配置 —— 存量任务保持原行为。
   * 回写规则见 runExecutionConfirmed：确认地址 ≠ 环境地址才记为覆盖；相同则清除覆盖。
   */
  targetUrl?: string;
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

/**
 * 使用统计 · 前端埋点上报（fire-and-forget）。任何失败只吞掉，绝不影响测试主流程 /
 * 用户操作。服务端 sanitize 会丢弃不合法条目（见 /api/test/stats POST）。
 */
function recordTestStat(events: Array<{
  eventType: string;
  projectPath: string;
  taskId: string;
  taskName?: string;
  env?: string;
  payload?: Record<string, unknown>;
}>): void {
  if (!events.length) return;
  try {
    // 服务端单请求上限 200（见 /api/test/stats POST）——删除大项目可能一次几十上百条
    // task_deleted，分批发避免整批 400 全丢。
    for (let i = 0; i < events.length; i += 200) {
      void fetch("/api/test/stats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events: events.slice(i, i + 200) }),
        keepalive: true, // 允许在页面卸载/导航时仍把事件发出去
      }).catch(() => {});
    }
  } catch {
    /* 上报失败静默 */
  }
}

const INPUT =
  "w-full h-9 rounded-md border border-border bg-background px-2.5 text-xs text-foreground outline-none focus:border-primary";

/** 毫秒 → 紧凑用时（1m 05s / 47s / 320ms）。使用统计的用时徽标 / 报告矩阵共用。 */
function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${String(rem).padStart(2, "0")}s`;
}

// Per-task workflow (no code analysis), ported from ai-lab-test-framework V0.3:
// 需求分析 → 用例设计 → 测试执行 → 测试报告. Steps run in order; each reads the
// prior step's AI_LabTest/ artifact, so the UI gates step N on step N-1 being done.
const STEPS: { step: TestStep; name: TranslationKey; desc: TranslationKey }[] = [
  { step: "requirement", name: "test.step.requirements.name", desc: "test.step.requirements.desc" },
  { step: "cases", name: "test.step.cases.name", desc: "test.step.cases.desc" },
  { step: "execution", name: "test.step.execution.name", desc: "test.step.execution.desc" },
  { step: "report", name: "test.step.report.name", desc: "test.step.report.desc" },
];
// 步骤顺序（传给 withDownstreamReset 等纯函数，避免它们 import 服务端的 prompts.ts）。
const STEP_ORDER: TestStep[] = STEPS.map((s) => s.step);

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

// 把前端对话气泡转成 streamClaude 的多轮历史：丢 tool/error（噪声、省 token），
// ai→assistant、user→user，只保留最近 20 条（后端 fallbackTokenBudget 再兜底）。
function toConversationHistory(convo: ConvoMsg[]): { role: "user" | "assistant"; content: string }[] {
  return convo
    .filter((m) => m.role === "user" || m.role === "ai")
    .slice(-20)
    .map((m) => ({ role: m.role === "ai" ? ("assistant" as const) : ("user" as const), content: m.text }));
}

// 问题6：删任务/项目时一并删除该任务的磁盘报告产物（best-effort，失败不阻断 UI 删除）。
async function deleteTaskReports(projectPath: string, taskName: string): Promise<void> {
  await fetch("/api/test/reports/delete", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectPath, taskName }),
  }).catch(() => {});
}

export function InlineTestingPanel() {
  const { t } = useTranslation();
  const router = useRouter();
  // 路由路径：从「设置·测试账号」改完配置切回工作台(/chat)时，pathname 变化 → 触发 env-config
  // 重拉(见下方 effect)，避免面板常驻不刷新、仍显示旧的访问地址。
  const pathname = usePathname();
  const [view, setView] = useState<View>("dash");
  const [modal, setModal] = useState<ModalKind>("none");
  // 持久化迁移：projects/taskStates 改存主进程文件（GET/PUT /api/test/workbench），不再
  // 同步读 localStorage —— 打包版端口漂移会让 localStorage（绑定 origin）丢数据。初值留空，
  // 由下方 mount-time effect 异步从文件加载（含老用户 localStorage 一次性迁移）；loaded
  // 守卫确保加载完成前不会用空初值 PUT 覆盖文件里的真实数据。
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [selectedTask, setSelectedTask] = useState<number | null>(null);
  // 看板按状态分组后，被用户手动折叠的分组（默认空 = 全部展开，含已完成）。本版不持久化。
  const [collapsedCats, setCollapsedCats] = useState<Set<TaskCategory>>(new Set());
  const toggleCat = (c: TaskCategory) =>
    setCollapsedCats((prev) => {
      const n = new Set(prev);
      if (n.has(c)) n.delete(c); else n.add(c);
      return n;
    });
  // Per-task run state (source of truth), keyed by task id. The active task's
  // values are derived below so the render reads the same names as before.
  const [taskStates, setTaskStates] = useState<Record<string, TaskState>>({});
  // 文件加载是否完成。未完成前禁止持久化写（否则空初值会覆盖文件）—— 本次迁移最关键的守卫。
  const [loaded, setLoaded] = useState(false);
  // 运行中的任务集合(去单例化)：渲染用 state + 同步读 ref(异步闭包/调度防竞态)，markRunning/
  // markIdle 同步两者。原来是单个 busyTaskId，现支持多任务并行各自有 in-flight 运行。
  const [runningTaskIds, setRunningTaskIds] = useState<Set<string>>(new Set());
  const runningIdsRef = useRef<Set<string>>(new Set());
  const markRunning = (id: string) => { runningIdsRef.current.add(id); setRunningTaskIds(new Set(runningIdsRef.current)); };
  const markIdle = (id: string) => { runningIdsRef.current.delete(id); setRunningTaskIds(new Set(runningIdsRef.current)); };
  // 批量排队(Phase 3): 等待队列(FIFO)。ref 为权威源(同步出入队)，state 仅供渲染「排队中·第 K 位」。
  const waitingQueueRef = useRef<string[]>([]);
  const [waitingTaskIds, setWaitingTaskIds] = useState<Set<string>>(new Set());
  const [composer, setComposer] = useState("");
  // 真对话里 AI 通过 @@ACTION 行建议重跑某步 → 存这里 → composer 上方渲染确认条，
  // 用户点「运行此步」才真正 runStepManual（不自动跑，重跑会覆盖产物且耗时）。
  const [pendingAction, setPendingAction] = useState<{ step: TestStep; reason: string } | null>(null);
  // 报告 tab 刷新信号：删任务的磁盘报告删完后 bump，让 ReportBrowser 二次拉取（避开时序竞争）。
  const [reportsReload, setReportsReload] = useState(0);
  // 回归用例库刷新信号：自动入库 / 编辑 / 推荐 re-sync 后 bump，让库查看弹窗重新拉取。
  const [libraryReload, setLibraryReload] = useState(0);
  // Simulated progress % for non-execution running steps (no granular progress) — see effect below.
  const [simPct, setSimPct] = useState(0);
  const threadRef = useRef<HTMLDivElement>(null);
  // 使用统计 · 流程节点运行中用时实时累计：记录每个 (taskId:step) 的起跑时刻 + 1s ticker
  // 驱动重渲染。完成后展示服务端权威用时（stepDurations），运行中展示这里的本地累计。
  const stepStartRef = useRef<Record<string, number>>({});
  const [nowTick, setNowTick] = useState(0);
  // Tasks in "run all" mode (运行任务/批量): gated steps auto-approve + the chain runs
  // through to 报告 without waiting for 批准. Was a single id; now a set for parallel tasks.
  const autoRunIdsRef = useRef<Set<string>>(new Set());
  // Per-task in-flight AbortControllers (问题②·停止), keyed by task id. stopTask aborts a
  // task's controller → its /api/test/run fetch (and backend agent) stops. Was a single
  // controller; now a map so parallel runs each carry their own abort handle.
  const abortMapRef = useRef<Map<string, AbortController>>(new Map());
  // Steps the user 停止'd ("taskId:step"). A stopped step resets to idle, but the
  // auto-chain treats idle+unlocked auto-steps (执行/报告) as runnable — without this
  // guard it would instantly re-run the step the user just stopped. The entry clears
  // when the user manually re-runs that step (runStep start) or restarts the task.
  const stoppedStepRef = useRef<Set<string>>(new Set());
  // 用例门控(需求:生成完用例必须人审后才进执行):「运行任务」跑到用例设计完成时停「待批准」
  // 并释放 autoRun,任务 id 记入本集合;用户点批准(approveStep)时凭它恢复 autoRun,让
  // 执行→报告继续自动接力(切走任务也后台跑完,保持「运行任务」一键到报告的语义)。
  // stopTask / 新一轮 startRunAllFrom 时清除。
  const gatedRunAllRef = useRef<Set<string>>(new Set());
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
  // R1：选择**按项目独立记忆**（存 project.selectedEnv，随 workbench 文件持久化），
  // 取代旧的单一全局 localStorage['codepilot:test-env']——这样「项目A=local、项目B=SIT」
  // 各记各的，切项目自动恢复。初值仍读旧全局值，仅作首屏 + 老用户迁移种子（见下方同步 effect）。
  const [env, setEnv] = useState(() => {
    try { return localStorage.getItem("codepilot:test-env") || "local"; } catch { return "local"; }
  });
  const [envCfg, setEnvCfg] = useState<{ configured: boolean; env: string; frontendBaseUrl: string | null; allowedEnvs: string[]; source?: string; loginState?: LoginStateInfo } | null>(null);
  // Change env + persist to the ACTIVE project entry（不再写全局 localStorage）。allowedEnvs
  // 越界回落也走这里，于是回落值也会落到该项目，下次切回稳定。
  const handleEnvChange = (next: string) => {
    setEnv(next);
    setProjects((ps) => (selected === null ? ps : ps.map((p, i) => (i === selected ? { ...p, selectedEnv: next } : p))));
  };
  // R1：切换项目时把所选环境恢复为该项目自己记住的值；项目无记录 → 回落旧的全局值
  // （老用户一次性迁移）或 local。projects 入依赖配合 setEnv 的等值守卫：handleEnvChange
  // 改 selectedEnv 触发本 effect 时读到的就是新值，setEnv 同值 no-op，不会成环。
  useEffect(() => {
    if (selected === null) return;
    const proj = projects[selected];
    if (!proj) return;
    const remembered = typeof proj.selectedEnv === "string" && proj.selectedEnv ? proj.selectedEnv : null;
    let legacy = "local";
    try { legacy = localStorage.getItem("codepilot:test-env") || "local"; } catch {}
    const next = remembered ?? legacy;
    setEnv((prev) => (prev === next ? prev : next));
  }, [selected, projects]);

  // 打开测试模块即触发一次后台用量上报。本组件在切到设置页等场景会卸载、切回重挂，
  // 故挂载 effect ≈「每次点开测试模块」。fire-and-forget：仅 Electron 有 electronAPI
  //（dev/web 为 no-op）；主进程去抖 + 未登录静默跳过，绝不阻塞 UI。
  useEffect(() => {
    void window.electronAPI?.auth?.uploadTestUsage?.();
  }, []);

  // 执行方式(独立窗口可见 / 后台无头)。默认无头 —— 与原行为一致、更快。执行前确认弹窗
  // (ExecConfirmModal)记下用户选择并持久化;非弹窗触发(运行任务 / auto-chain 接力执行)
  // 复用上次选择。用 ref 让 runStep / auto-chain effect 读到最新值,避免闭包取到旧值。
  // 问题7：测试执行默认无头。每次都从「无头」起步、不再记忆上次的「有头」选择
  //（用户仍可在执行确认弹窗里当次切为有头；切换只在本次会话内生效，刷新后回落无头）。
  const [execMode, setExecMode] = useState<ExecMode>("headless");
  const execModeRef = useRef(execMode);
  useEffect(() => { execModeRef.current = execMode; }, [execMode]);
  const persistExecMode = (next: ExecMode) => {
    setExecMode(next);
    execModeRef.current = next;
    try { localStorage.setItem("codepilot:test-exec-mode", next); } catch {}
  };

  // 并发数(批量执行的并行上限,1–5)。本机设置 —— 存 localStorage、不随项目共享(每人按自己电脑)。
  // ref 让 pumpQueue / finally 读到最新值,避免闭包陈旧。
  const clampConcurrency = (n: number) => Math.min(5, Math.max(1, Math.round(Number.isFinite(n) ? n : 2)));
  const [concurrency, setConcurrency] = useState<number>(() => {
    try { return clampConcurrency(parseInt(localStorage.getItem("codepilot:test-concurrency") || "2", 10)); } catch { return 2; }
  });
  const concurrencyRef = useRef(concurrency);
  useEffect(() => { concurrencyRef.current = concurrency; }, [concurrency]);
  const persistConcurrency = (next: number) => {
    const v = clampConcurrency(next);
    setConcurrency(v);
    concurrencyRef.current = v;
    try { localStorage.setItem("codepilot:test-concurrency", String(v)); } catch {}
    pumpQueue(); // 调大并发 → 立即尝试放更多排队任务进来
  };

  const current = selected !== null ? projects[selected] ?? null : null;
  const activeTask = current && selectedTask !== null ? current.tasks[selectedTask] ?? null : null;

  // Active task's state, derived from the per-task map (render reads these names).
  const aId = activeTask?.id ?? "";
  const aState: TaskState = taskStates[aId] ?? DEFAULT_TASK_STATE;
  const { stepStatus, convo, fourState, currentCase, caseResults, circuitBroken } = aState;
  const runningStep: TestStep | null = STEPS.find((s) => stepStatus[s.step] === "running")?.step ?? null;
  // 执行进度衍生值（execTotal / execIdx / execCaseTitle / execPct / barPct）下移到 casesPreview
  // 声明之后 —— 「总数」要回落到 cases.json 用例数（首条进度行到达前也能显示总数）。见下方。
  // 活动任务是否在跑(渲染用)：禁用活动任务的输入/按钮。其它任务后台并行跑不影响这里。
  const busy = !!aId && runningTaskIds.has(aId);
  // 活动任务是否在排队(达全局并发上限被「运行任务」排入队列、等空槽起跑)：按钮显示「排队中」并禁用。
  const aQueued = !!aId && waitingTaskIds.has(aId);
  // Patch a task's state BY ID (runStep captures its id, so switching tasks mid-run is safe).
  const patchTask = (id: string, patch: (s: TaskState) => Partial<TaskState>) =>
    setTaskStates((m) => {
      const cur = m[id] ?? DEFAULT_TASK_STATE;
      return { ...m, [id]: { ...cur, ...patch(cur) } };
    });
  // Locate a task by id across all projects → its project path + task. Lets the auto-chain
  // / 批量调度 drive a background task that isn't the active selection.
  const findTaskLoc = (tid: string): { projPath: string; task: { id: string; name: string } } | null => {
    for (const p of projects) {
      const tk = p.tasks.find((t) => t.id === tid);
      if (tk && p.path) return { projPath: p.path, task: tk };
    }
    return null;
  };

  // 操作审计埋点(需求:门控与关键操作留痕):fire-and-forget POST /api/test/audit,落
  // <project>/AI_LabTest/audit/<task>.jsonl(独立于 report/,删任务留痕)。失败静默、
  // 绝不阻塞交互;time 由服务端生成。taskId 缺省取活动任务,路径/任务名自动解析。
  const logAudit = (
    action: string,
    opts: {
      taskId?: string;
      step?: TestStep;
      mode?: "manual" | "batch" | "auto";
      detail?: string;
      projPath?: string;
      taskName?: string;
    } = {},
  ) => {
    const tid = opts.taskId ?? aId;
    const loc = tid ? findTaskLoc(tid) : null;
    const projectPath = opts.projPath ?? loc?.projPath ?? current?.path;
    const taskName = opts.taskName ?? loc?.task.name ?? activeTask?.name;
    if (!projectPath || !taskName) return;
    fetch("/api/test/audit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectPath,
        taskName,
        event: { taskId: tid || undefined, step: opts.step, action, mode: opts.mode ?? "manual", detail: opts.detail },
      }),
    }).catch(() => {});
  };

  // 回归用例库 re-sync(fire-and-forget):用例设计【之后】用户改了用例(编辑保存 / AI 推荐回归集)
  // → 按当前 cases.json 重新 upsert 该任务的回归集入库,保证库不 stale;成功后 bump 库刷新信号。
  // 后端 upsert by 来源任务,幂等、不产生重复。失败静默(库是增强特性,不打断主流程)。
  const resyncLibrary = (projPath?: string, taskName?: string) => {
    const p = projPath ?? current?.path;
    const tn = taskName ?? activeTask?.name;
    if (!p || !tn) return;
    fetch("/api/test/library/deposit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectPath: p, taskName: tn }),
    })
      .then(() => setLibraryReload((n) => n + 1))
      .catch(() => {});
  };

  // 发起回归轮次(v2):①圈选聚合→建轮次+快照(POST /api/test/library/run,返回 roundId);②③复用
  // 现有 /api/test/run 依次跑 execution→report(taskName=保留名,带 roundId → 产物落
  // report/回归用例库/{roundId}/,同环境多轮互不覆盖);④收口轮次(PATCH rounds,done 时后端从
  // run.json 摘录口径,异常/中断按 aborted)。报告自动出现在【报告区】(reports 扫描含轮次子目录)。
  // suiteName/env/mode/approvedOnly 由发起弹窗传入;缺省 = 内置「全量」+ local + 全量模式
  // (等价 v1 行为)。mode='failed-only' 时后端按基准轮的失败集圈选(见 lib/test/run-scope.ts)。
  const runLibrary = async (opts?: { suiteName?: string; env?: string; mode?: "full" | "failed-only"; approvedOnly?: boolean; scriptFirst?: boolean; parentRoundId?: string }) => {
    const p = current?.path;
    if (!p || libraryRunning) return;
    const env = opts?.env || "local";
    // 执行状态面板只在「回归套件」tab 顶部显示 → 发起即切过去,避免在别的 tab 看不到运行动静。
    setRegTab("suites");
    setLibraryRunning(true);
    setLibraryRunStatus(null);
    setLibraryLive(null);   // 上一轮的面板不留存
    // 中断通道(技术债 #23):「停止」abort → 聚合/drive 的 fetch 全部拒绝、服务端 req.signal
    // 联动终止智能体与脚本重放。settle 不挂 signal —— 停止之后还要靠它把轮次收口。
    const ctrl = new AbortController();
    libraryAbortRef.current = ctrl;
    let roundId: string | undefined;
    // 轮次收口(best-effort,fire-and-forget 语义但等待返回以便刷新列表)。
    const settle = async (outcome: "done" | "aborted") => {
      if (!roundId) return;
      try {
        await fetch("/api/test/library/rounds", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectPath: p, roundId, outcome }),
        });
      } catch { /* 收口失败 → 读侧惰性 aborted 兜底 */ }
    };
    try {
      const agg = await fetch("/api/test/library/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ctrl.signal,
        body: JSON.stringify({
          projectPath: p,
          suiteName: opts?.suiteName,
          env,
          mode: opts?.mode,
          approvedOnly: opts?.approvedOnly,
          parentRoundId: opts?.parentRoundId,
        }),
      }).then((r) => r.json()).catch(() => null);
      if (!agg?.ok) { setLibraryRunStatus(ctrl.signal.aborted ? t("test.library.runStopped") : (agg?.error || t("test.library.runFailed"))); return; }
      if (!agg.total) { setLibraryRunStatus(t("test.library.runEmpty")); return; }
      roundId = typeof agg.roundId === "string" ? agg.roundId : undefined;
      setLibraryRunStatus(t("test.library.runStarted", { total: agg.total }));
      setLibraryLive({
        step: "execution",
        roundId,
        suiteName: opts?.suiteName || REGRESSION_FULL_SUITE_NAME,
        env,
        total: agg.total,
        pre: [], cases: [], curIdx: -1,
        tools: 0, started: 0, verdicts: 0, malformed: 0,
        four: { ...EMPTY_FOUR },
        runJson: null, errored: false, lastFrameAt: Date.now(), finished: false,
      });

      /** live 状态的唯一写入口。所有分支都走它,便于一处维护「最后一帧时刻」。 */
      const patchLive = (fn: (s: LibraryLive) => LibraryLive) =>
        setLibraryLive((s) => (s ? { ...fn(s), lastFrameAt: Date.now() } : s));

      /** 事件落到当前用例;还没有用例时落 pre(读用例文件、建证据目录那几步)。 */
      const pushEvt = (evt: LiveEvt) =>
        patchLive((s) => {
          if (s.curIdx < 0) return { ...s, pre: [...s.pre, evt] };
          const cases = s.cases.slice();
          cases[s.curIdx] = { ...cases[s.curIdx], events: [...cases[s.curIdx].events, evt] };
          return { ...s, cases };
        });

      /** 一条用例开始。上一条若还没收到判定 → 标记「无判定」(它跑完了,不是没跑)。 */
      const openCase = (id: string, index?: number) =>
        patchLive((s) => {
          const cases = s.cases.slice();
          // 模型先发进度行再发 @@CASE_START 时,当前 `#N` 占位就是同一条用例 —— 就地认领
          // (补真实 id,保留标题/事件),不另开幻影行(见 shouldAdoptPlaceholder 注释)。
          if (s.curIdx >= 0 && shouldAdoptPlaceholder(cases[s.curIdx], index)) {
            cases[s.curIdx] = { ...cases[s.curIdx], id };
            return { ...s, cases };
          }
          if (s.curIdx >= 0 && !cases[s.curIdx].result) cases[s.curIdx] = { ...cases[s.curIdx], lost: true };
          cases.push({ id, index: index ?? cases.length + 1, title: "", events: [], startedAt: Date.now() });
          return { ...s, cases, curIdx: cases.length - 1, started: s.started + 1 };
        });

      const applyLine = (e: ExecLine) => {
        if (e.kind === "caseStart") { openCase(e.id, e.index); return; }
        if (e.kind === "progress") {
          // 进度行既给标题(已剥掉「用例 N/总数：」前缀)，也在缺 @@CASE_START 时兜底切段
          // ——模型可能漏输出机器标记，此时序号变化就是新用例的唯一信号。
          patchLive((s) => {
            const cases = s.cases.slice();
            if (s.curIdx < 0 || (e.idx > 0 && cases[s.curIdx]?.index !== e.idx)) {
              if (s.curIdx >= 0 && !cases[s.curIdx].result) cases[s.curIdx] = { ...cases[s.curIdx], lost: true };
              cases.push({ id: `#${e.idx || cases.length + 1}`, index: e.idx || cases.length + 1, title: e.title, events: [], startedAt: Date.now() });
              return { ...s, cases, curIdx: cases.length - 1, started: s.started + 1 };
            }
            cases[s.curIdx] = { ...cases[s.curIdx], title: e.title };
            return { ...s, cases };
          });
          return;
        }
        if (e.kind === "result") {
          const r = e.result;
          patchLive((s) => {
            const cases = s.cases.slice();
            let i = cases.findIndex((c) => c.id === r.id);
            if (i < 0) i = s.curIdx;                       // id 对不上 → 挂当前用例
            if (i < 0) return s;
            cases[i] = { ...cases[i], result: r, lost: false, ms: Date.now() - cases[i].startedAt, title: cases[i].title || r.id };
            return {
              ...s, cases, verdicts: s.verdicts + 1,
              four: {
                total: s.four.total + 1,
                pass: s.four.pass + (r.status === "pass" ? 1 : 0),
                fail: s.four.fail + (r.status === "fail" ? 1 : 0),
                partial: s.four.partial + (r.status === "partial" ? 1 : 0),
                blocked: s.four.blocked + (r.status === "blocked" ? 1 : 0),
              },
            };
          });
          pushEvt({ k: "sys", text: `■ ${r.id} → ${r.status}`, status: r.status });
          return;
        }
        if (e.kind === "resultMalformed") {
          patchLive((s) => ({ ...s, malformed: s.malformed + 1 }));
          pushEvt({ k: "sys", text: e.raw, lost: true });
          return;
        }
        pushEvt({ k: "ai", text: e.text });
      };

      // 依次驱动 execution → report。执行步逐帧解析并画进面板;报告步**不流详情**(用户拍板:
      // 执行步收口即冻结),只把面板头切成「生成报告中」。任一步 !res.ok(如 503 被测地址不可达 /
      // NO_CREDENTIALS)则中止并把后端 error 展示在面板与状态行。
      const drive = async (step: TestStep): Promise<boolean> => {
        if (step !== "execution") patchLive((s) => ({ ...s, step }));
        const res = await fetch("/api/test/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: ctrl.signal,
          body: JSON.stringify({ projectPath: p, taskName: REGRESSION_LIBRARY_TASK, step, env, roundId, model: model || undefined, providerId: providerId || undefined, scriptFirst: opts?.scriptFirst !== false }),
        });
        if (!res.ok) {
          let msg = t("test.library.runFailed");
          try { const d = await res.json(); if (d?.error) msg = d.error; } catch {}
          setLibraryRunStatus(msg);
          patchLive((s) => ({ ...s, errored: true, errorText: msg, finished: true }));
          return false;
        }
        const reader = res.body?.getReader();
        if (!reader) return true;
        // 报告步不解析详情,只排空(冻结执行步的快照)。
        if (step !== "execution") {
          for (;;) { const { done } = await reader.read(); if (done) break; }
          return true;
        }
        const dec = new TextDecoder();
        const lineBuf = createExecLineBuffer();
        let frameBuf = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          frameBuf += dec.decode(value, { stream: true });
          const frames = frameBuf.split("\n\n");
          frameBuf = frames.pop() || "";
          for (const f of frames) {
            const line = f.replace(/^data:\s?/, "").trim();
            if (!line) continue;
            let evt: { type?: string; data?: string } | null = null;
            try { evt = JSON.parse(line); } catch { continue; }
            if (!evt) continue;
            if (evt.type === "text") {
              for (const e of lineBuf.feed(evt.data || "")) applyLine(e);
            } else if (evt.type === "tool_use") {
              // tool_use 是【结构化】帧 —— 对账锚点,不受模型 markdown 装饰影响。
              patchLive((s) => ({ ...s, tools: s.tools + 1 }));
              try {
                const tu = JSON.parse(evt.data || "{}");
                const label = toolUseLabel(tu.name || "", tu.input);
                if (label) pushEvt({ k: "tool", text: `→ ${label}` });
              } catch { /* 坏帧忽略 */ }
            } else if (evt.type === "run_json") {
              // 只认【执行步】这条。报告步流末也发一条 run_json,套用它会把盘面清零。
              try {
                const rj = JSON.parse(evt.data || "{}") as { counts?: FourState };
                if (rj.counts) patchLive((s) => ({ ...s, runJson: rj.counts! }));
              } catch { /* 坏帧忽略 */ }
            } else if (evt.type === "error") {
              let msg = "";
              try { const d = JSON.parse(evt.data || "{}"); msg = d.userMessage || d.rawMessage || ""; } catch { msg = evt.data || ""; }
              patchLive((s) => ({ ...s, errored: true, errorText: msg || s.errorText }));
              pushEvt({ k: "err", text: msg || t("test.library.runFailed") });
            } else if (evt.type === "result") {
              // 会话级失败(限流/鉴权)只发 result{is_error:true}、没有 error 帧 —— 不解析它
              // 面板会一路假绿到收口。
              try {
                const r = JSON.parse(evt.data || "{}") as { is_error?: unknown };
                if (r?.is_error === true) patchLive((s) => ({ ...s, errored: true }));
              } catch { /* native result 帧无 is_error → 非错误 */ }
            }
          }
        }
        for (const e of lineBuf.flush()) applyLine(e);
        // 流末:最后一条用例若始终没有判定,标记「无判定」而不是留在「执行中」。
        patchLive((s) => {
          const cases = s.cases.slice();
          if (s.curIdx >= 0 && !cases[s.curIdx].result) cases[s.curIdx] = { ...cases[s.curIdx], lost: true };
          return { ...s, cases, curIdx: -1 };
        });
        return true;
      };
      if (await drive("execution")) {
        // 报告步期间点「停止」→ 只掐报告,轮次仍收 done:执行步已跑完、run.json 已落盘(权威口径),
        // 标 aborted 会把完整的一轮从复测基准/「上次结果」数据源里白白剔除(2026-07-22 需求确认)。
        let reportStopped = false;
        try {
          await drive("report");
        } catch (e) {
          if (!ctrl.signal.aborted) throw e;
          reportStopped = true;
        }
        await settle("done");
        setReportsReload((n) => n + 1);
        setLibraryReload((n) => n + 1);
        setLibraryRunStatus(t(reportStopped ? "test.library.runStoppedReport" : "test.library.runDone"));
        // 报告步被停止的说明进收口 footer(收口后 runStatus 行不再显示,note 是唯一可见落点)。
        setLibraryLive((s) => (s ? { ...s, finished: true, ...(reportStopped ? { note: t("test.library.runStoppedReport") } : {}) } : s));
      } else {
        await settle("aborted");
        setLibraryLive((s) => (s ? { ...s, errored: true, finished: true } : s));
      }
    } catch {
      // 执行中途 abort(用户停止)与真实失败分开表述;轮次一样标 aborted。
      const stopped = ctrl.signal.aborted;
      setLibraryRunStatus(t(stopped ? "test.library.runStopped" : "test.library.runFailed"));
      setLibraryLive((s) => (s ? { ...s, ...(stopped ? { stopped: true } : { errored: true }), finished: true } : s));
      await settle("aborted");
    } finally {
      if (libraryAbortRef.current === ctrl) libraryAbortRef.current = null;
      setLibraryRunning(false);
    }
  };

  // 停止当前回归轮次(技术债 #23):二次确认后 abort in-flight fetch → 服务端 req.signal 联动
  // 终止智能体/脚本重放(与功能测试 stopTask 同一套服务端机制,重放锁释放幂等)。收口由
  // runLibrary 负责:执行中途 → aborted;报告步 → done(执行结果已落盘)。审计落 回归用例库.jsonl。
  const stopLibraryRun = () => {
    const ctrl = libraryAbortRef.current;
    if (!ctrl || ctrl.signal.aborted) return;
    if (!window.confirm(t("test.library.stopConfirm"))) return;
    // confirm 阻塞期间本轮可能已跑完(finally 已清 ref)→ 过期的停止意图直接丢弃。
    if (libraryAbortRef.current !== ctrl || ctrl.signal.aborted) return;
    logAudit("stop", {
      taskId: "", // 轮次不属于任何功能测试任务,不能挂活动任务 id
      projPath: current?.path,
      taskName: REGRESSION_LIBRARY_TASK,
      step: libraryLive?.step,
      detail: libraryLive?.roundId ? `停止回归轮次 ${libraryLive.roundId}` : "停止回归轮次",
    });
    ctrl.abort();
  };

  // 排队调度: 槽位 = 并发数 − 占用数。占用 = 在跑(running) ∪ 已认领(autoRun) 的任务数 —— 用真实
  // 在跑数而非仅 autoRun，避免「运行任务」正在跑(running 但可能不在 autoRun)时漏算导致超并发。
  // 有空槽就把队首任务提升为 autoRun，由 auto-chain effect 读「最新」taskStates 起跑它的下一步
  // —— 用 effect 而非在此直接 runStep，避免从 runStep.finally 回调进来时闭包里的 taskStates 陈旧。
  const pumpQueue = () => {
    let slots = concurrencyRef.current - occupiedSlots(runningIdsRef.current, autoRunIdsRef.current);
    const before = waitingQueueRef.current.length;
    const promoted: string[] = [];
    while (slots > 0 && waitingQueueRef.current.length > 0) {
      const tid = waitingQueueRef.current.shift()!;
      if (!findTaskLoc(tid)) continue; // 任务已删 → 丢弃(已 shift 出队)
      autoRunIdsRef.current.add(tid);
      for (const s of STEPS) stoppedStepRef.current.delete(`${tid}:${s.step}`);
      promoted.push(tid);
      slots--;
    }
    if (waitingQueueRef.current.length !== before) setWaitingTaskIds(new Set(waitingQueueRef.current));
    if (promoted.length) {
      // 审计:排队提升伴随旧「待批准」产物的自动确认(batch)。用渲染闭包的 taskStates 判定
      // 哪些 review 步会被下方 updater 自动批准——从 finally 回调进来时闭包可能略旧,
      // 边缘场景漏记一条(best-effort);人工操作的审计不受影响。
      for (const tid of promoted) {
        const st0 = taskStates[tid];
        if (!st0) continue;
        for (const k of Object.keys(st0.stepStatus) as TestStep[]) {
          if (st0.stepStatus[k] !== "review") continue;
          if (k === "requirement" && st0.imported?.requirement && !st0.requirementMode) continue;
          logAudit("auto-approve", { taskId: tid, step: k, mode: "batch", detail: "排队提升,旧待批准产物自动确认" });
        }
      }
      // 批量=自动批准：把新晋任务里「待批准(review)」的步直接标 done，让 auto-chain 续跑到执行/报告
      // （否则它停在 review、auto-chain 只推进 idle 步，批量任务会卡住）。functional 更新读最新 state，
      // 不受 finally 回调闭包陈旧影响。
      setTaskStates((m) => {
        const n = { ...m };
        let touched = false;
        for (const tid of promoted) {
          const st = n[tid];
          if (!st) continue;
          const ss = { ...st.stepStatus };
          let ch = false;
          for (const k of Object.keys(ss) as TestStep[]) {
            if (ss[k] !== "review") continue;
            // 导入需求且未选处理方式(待选择) → Q3：批量/自动也停下等用户在节点选卡片，不自动批准。
            if (k === "requirement" && st.imported?.requirement && !st.requirementMode) continue;
            ss[k] = "done"; ch = true;
          }
          if (ch) { n[tid] = { ...st, stepStatus: ss }; touched = true; }
        }
        return touched ? n : m;
      });
      // 触发 auto-chain effect 给新晋 autoRun 任务起跑(它读最新 taskStates)。
      setRunningTaskIds(new Set(runningIdsRef.current));
    }
  };


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
    if (!proj?.path || !task || !text || runningIdsRef.current.has(task.id)) return;
    const id = task.id;
    const stepName = t(STEPS.find((s) => s.step === step)!.name);
    const ctrl = new AbortController();
    abortMapRef.current.set(id, ctrl);
    markRunning(id);
    const push = (msg: ConvoMsg) => patchTask(id, (s) => ({ convo: [...s.convo, msg] }));
    const appendAi = (chunk: string) =>
      patchTask(id, (s) => {
        const last = s.convo[s.convo.length - 1];
        if (last && last.role === "ai") return { convo: [...s.convo.slice(0, -1), { role: "ai", text: last.text + chunk }] };
        return { convo: [...s.convo, { role: "ai", text: chunk }] };
      });
    push({ role: "user", text: `✏️ ${t("test.revise.action")}「${stepName}」：${text}` });
    logAudit("revise", { taskId: id, step, detail: text.slice(0, 80), projPath: proj.path, taskName: task.name });
    setComposer("");
    let sawError = false;
    let lineBuf = "";
    try {
      const res = await fetch("/api/test/revise", {
        method: "POST",
        signal: ctrl.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectPath: proj.path, taskName: task.name, taskId: task.id, step, instruction: text, model: model || undefined, providerId: providerId || undefined }),
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
      if (abortMapRef.current.get(id) === ctrl) abortMapRef.current.delete(id);
      markIdle(id);
      // 用例改完 → 重新拉取展示（需求步无 inline 展示，跳过）。
      if (!sawError && step === "cases" && proj.path) {
        try {
          const d = await fetch(`/api/test/cases?projectPath=${encodeURIComponent(proj.path)}&taskName=${encodeURIComponent(task.name)}`).then((r) => r.json());
          if (Array.isArray(d?.cases)) setCasesPreview(d.cases as GeneratedCase[]);
        } catch { /* keep current preview */ }
      }
    }
  };

  // AI 推荐回归集（可视化审阅）：点按钮 → 打开审阅弹窗 RecommendReviewModal（不再流进对话框）。
  // 弹窗内调 /api/test/cases/recommend?review=true（AI 只推荐、不写盘），逐条可视化展示推荐
  // （回归集 ✓/否 + 理由），用户勾选调整后点「应用」→ /recommend/apply 精确 merge 标签 + 同步库。
  const recommendSuite = () => {
    if (casesPreview.length === 0) return;
    setRecommendOpen(true);
  };

  // 真对话：发送即让 AI 在当前任务上下文响应（答疑/改产物/建议触发步骤）。复用 reviseStep
  // 的 SSE 解析骨架；text 行先过 @@ACTION 解析（命中→确认条，不显示该行）；tool_use 若写了
  // cases.json → 结束后刷新 casesPreview。与 runStep/reviseStep 经 abortMap + running 集合按任务串行。
  const chatSend = async () => {
    const proj = selected !== null ? projects[selected] : null;
    const task = proj && selectedTask !== null ? proj.tasks[selectedTask] : null;
    const text = composer.trim();
    if (!proj?.path || !task || !text || runningIdsRef.current.has(task.id)) return;
    const id = task.id;
    const ctrl = new AbortController();
    abortMapRef.current.set(id, ctrl);
    markRunning(id);
    const push = (msg: ConvoMsg) => patchTask(id, (s) => ({ convo: [...s.convo, msg] }));
    const appendAi = (chunk: string) =>
      patchTask(id, (s) => {
        const last = s.convo[s.convo.length - 1];
        if (last && last.role === "ai") return { convo: [...s.convo.slice(0, -1), { role: "ai", text: last.text + chunk }] };
        return { convo: [...s.convo, { role: "ai", text: chunk }] };
      });
    // history 快照必须在 push 用户气泡【之前】取，否则这条 message 会重复进历史。
    const history = toConversationHistory(taskStates[id]?.convo ?? []);
    push({ role: "user", text });
    setComposer("");
    setPendingAction(null); // 新一轮对话 → 清掉上一轮未处理的动作建议
    let sawError = false;
    let casesDirty = false;
    let lineBuf = "";
    // 逐行：先认 @@ACTION（命中则存 pendingAction、不显示该行），否则当普通文本累积。
    const handleLine = (l: string) => {
      const idx = l.indexOf("@@ACTION");
      if (idx >= 0) {
        try {
          const a = JSON.parse(l.slice(idx + 8).trim());
          if (a && a.type === "runStep" && STEPS.some((s) => s.step === a.step)) {
            setPendingAction({ step: a.step as TestStep, reason: typeof a.reason === "string" ? a.reason : "" });
            return;
          }
        } catch { /* 非法 → 落到下面当普通文本 */ }
      }
      if (l.trim()) appendAi(l + "\n");
    };
    try {
      const res = await fetch("/api/test/chat", {
        method: "POST",
        signal: ctrl.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectPath: proj.path,
          taskName: task.name,
          focusStep,
          message: text,
          history,
          env,
          model: model || undefined,
          providerId: providerId || undefined,
        }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        push({ role: "error", text: (j.error as string) || t("test.chat.failed") });
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
            for (const l of ls) handleLine(l);
          } else if (evt.type === "tool_use") {
            try {
              const tu = JSON.parse(evt.data || "{}");
              const label = toolUseLabel(tu.name || "", tu.input);
              if (label) push({ role: "tool", text: `→ ${label}` });
              const fp = String(tu.input?.file_path ?? "");
              if (/^(Write|Edit|MultiEdit)$/.test(tu.name || "") && fp.endsWith(".cases.json")) casesDirty = true;
            } catch {}
          } else if (evt.type === "error") {
            let msg = evt.data || "";
            try { const d = JSON.parse(evt.data || "{}"); msg = d.userMessage || d.rawMessage || msg; } catch {}
            push({ role: "error", text: msg });
            sawError = true;
          }
        }
      }
      if (lineBuf.trim()) handleLine(lineBuf);
    } catch (e) {
      if (ctrl.signal.aborted || (e instanceof DOMException && e.name === "AbortError")) push({ role: "user", text: `■ ${t("test.flow.stop")}` });
      else { push({ role: "error", text: `请求失败：${e instanceof Error ? e.message : String(e)}` }); sawError = true; }
    } finally {
      if (abortMapRef.current.get(id) === ctrl) abortMapRef.current.delete(id);
      markIdle(id);
      // AI 改了用例 → 重新拉取展示（与 reviseStep 同款刷新）。
      if (!sawError && casesDirty && proj.path) {
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
  const addTask = async (name: string, files?: NewTaskFiles, depositScripts?: boolean, targetUrl?: string): Promise<{ ok: boolean; error?: string }> => {
    const proj = selected !== null ? projects[selected] : null;
    // 防重名：同一项目内任务名唯一（trim 后精确比较、区分大小写）。弹窗已实时校验+禁用创建，
    // 此处兜底防绕过；命中则不创建，返回错误供弹窗内联展示。
    const trimmedName = name.trim();
    if (proj && proj.tasks.some((tk) => tk.name.trim() === trimmedName)) {
      return { ok: false, error: t("test.newTaskModal.duplicateName") };
    }
    const postImport = async (kind: "requirement" | "cases", f: ImportFile): Promise<{ ok: boolean; error?: string; preview?: string; ext?: string }> => {
      const res = await fetch("/api/test/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectPath: proj?.path, taskName: name, kind, filename: f.filename, dataBase64: f.dataBase64 }),
      });
      const j = await res.json().catch(() => ({}));
      const ok = res.ok && j.ok;
      if (ok && proj?.path) logAudit("import", { projPath: proj.path, taskName: name, detail: `${kind}:${f.filename}` });
      return ok ? { ok: true, preview: j.preview as string, ext: j.ext as string | undefined } : { ok: false, error: (j.error as string) || t("test.newTaskModal.importFailed") };
    };
    // Seed the 测试对话 with what was imported — otherwise the stage looks empty (it
    // renders the convo stream, not the artifact file) and the upload seems "missing".
    const seeds: ConvoMsg[] = [];
    let reqOriginal: { filename: string; ext: string } | undefined;
    if (proj?.path && files?.requirement) {
      const r = await postImport("requirement", files.requirement);
      if (!r.ok) return r;
      reqOriginal = { filename: files.requirement.filename, ext: r.ext || "" };
      seeds.push({ role: "ai", text: `📄 已导入需求文档「${files.requirement.filename}」，原始文档已保留。请在「需求分析」节点选择：**生成需求分析文档**（AI 归一，保留原始+md），或**直接使用导入文档**生成用例。\n\n${r.preview || ""}` });
    }
    if (proj?.path && files?.cases) {
      const r = await postImport("cases", files.cases);
      if (!r.ok) return r;
      seeds.push({ role: "ai", text: `📊 已导入测试用例「${files.cases.filename}」（${r.preview || "已导入"}），需求分析与用例设计已跳过，可直接进入「测试执行」。` });
    }
    const id = makeTaskId();
    setProjects((ps) => ps.map((p, i) => (i === selected ? { ...p, tasks: [...p.tasks, { id, name }] } : p)));
    // 沉淀回归脚本开关 + 任务目标地址:独立于导入分支落盘 —— 下面的 patchTask 只在有导入时
    // 才走,而这两项任何情况都要记住(开关缺省 true 与既有行为一致,故只在明确关闭时写 false;
    // 地址 trim 非空才落,空串不产生任务级覆盖)。
    const seed: Partial<TaskState> = {};
    if (depositScripts === false) seed.depositScripts = false;
    if (targetUrl?.trim()) seed.targetUrl = targetUrl.trim();
    if (Object.keys(seed).length) patchTask(id, () => seed);
    const hasReq = !!files?.requirement, hasCases = !!files?.cases;
    if (hasReq || hasCases) {
      patchTask(id, () => ({
        stepStatus: {
          // 导入用例 → 需求 + 用例 都直接 done（跳过两阶段，无需批准），execution 解锁可执行；
          // 仅导入需求 → 需求 置 review 但 requirementMode 未定 → 需求分析节点「待选择」二选一。
          requirement: hasCases ? "done" : "review",
          cases: hasCases ? "done" : "idle",
          execution: "idle",
          report: "idle",
        },
        convo: seeds,
        // Mark imported steps so a re-run REUSES the upload instead of regenerating over it.
        imported: { requirement: hasReq, cases: hasCases },
        // 保留的原始需求文档信息（仅导入需求时）。requirementMode 故意留空 → 触发「待选择」。
        requirementOriginal: hasReq ? reqOriginal : undefined,
      }));
    }
    // 使用统计：新建任务。source 标注导入来源（采纳率只统计 imported_requirement 的 AI 生成流）。
    if (proj?.path) {
      const source = hasReq && hasCases ? "both" : hasCases ? "imported_cases" : "imported_requirement";
      recordTestStat([
        { eventType: "task_created", projectPath: proj.path, taskId: id, taskName: name, payload: { source } },
      ]);
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
          // 向后兼容：旧「导入需求」任务把内容直接写进了 需求.md（无 requirementOriginal、无 requirementMode）。
          // 加载时回填 requirementMode='use-original'，避免它们进入新的「待选择」闸门卡住——它们本就用 需求.md。
          if (st?.imported?.requirement && !st.requirementMode && !st.requirementOriginal) {
            st.requirementMode = "use-original";
          }
        }
        // 历史遗留去重：早期无防重逻辑可能产生同路径的重复项目（如两个 mealAllowance）→
        // 按路径合并，保留任务最多的那张卡片。去重结果会被下方持久化 effect 写回文件，一次性清理现状。
        nextProjects = dedupeProjectsByPath(nextProjects);
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
    const normalized = normalizeProjectPath(path);
    // 防重复：同一路径已在列表中 → 弹警告 Toast 并阻止新增，不再生成重复卡片。
    if (projects.some((p) => normalizeProjectPath(p.path) === normalized)) {
      showToast({ type: "warning", message: t("test.duplicateProject") });
      return;
    }
    const name = normalized.split(/[/\\]+/).filter(Boolean).pop() || normalized;
    addProject(name, normalized);
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

  // 运行中节点用时的 1s ticker（仅当前活动任务有步在跑时才计）。
  useEffect(() => {
    if (!runningStep) return;
    const id = setInterval(() => setNowTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [runningStep]);

  // Resolve the active project's env config (target baseUrl) for display in the flow
  // view. Refetches when entering a flow / switching env / 路由切回工作台(pathname)，并在
  // 窗口重新聚焦 / 页面重新可见时也重拉 —— 这样在「设置·测试账号」改完配置(或重新导出
  // environments.json)切回工作台时，访问地址会自动刷新，不再显示缓存的旧地址。
  useEffect(() => {
    if (view !== "flow" || !current?.path) { setEnvCfg(null); return; }
    const projectPath = current.path;
    let cancelled = false;
    const load = () => {
      // no-store：重拉时必须拿最新值（否则浏览器可能回放缓存的旧地址，自动刷新就失效了）。
      fetch(`/api/test/env-config?projectPath=${encodeURIComponent(projectPath)}&env=${encodeURIComponent(env)}`, { cache: "no-store" })
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
    };
    load();
    // 自动重拉：窗口重新聚焦 / 标签页重新可见时（覆盖外部切走再回来、改完配置切回等场景）。
    const onVisible = () => { if (document.visibilityState === "visible") load(); };
    window.addEventListener("focus", load);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", load);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // handleEnvChange is stable enough (only writes localStorage); excluded to avoid re-fetch loops.
    // pathname 入依赖：从 /settings 改完配置切回 /chat 时 pathname 变 → 重拉最新访问地址。

  }, [view, current?.path, env, pathname]);

  // 解锁判定可传显式 stepStatus(后台任务用)；stepUnlocked 是活动任务的便捷包装。
  const stepUnlockedFor = (ss: Record<TestStep, StepStatus>, step: TestStep): boolean => {
    const idx = STEPS.findIndex((s) => s.step === step);
    if (idx <= 0) return true;
    return ss[STEPS[idx - 1].step] === "done";
  };
  const stepUnlocked = (step: TestStep): boolean => stepUnlockedFor(stepStatus, step);
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

  // 执行进度衍生值（放在 casesPreview 之后：总数要回落到 cases.json 用例数）。
  // 进度行「用例 N/总数：标题」→ {第几个, 总数, 标题}（解析逻辑抽成纯函数，已单测）。
  const { idx: execIdx, total: execTotal, title: execCaseTitle } = parseExecProgress(currentCase, casesPreview.length);
  // 进度条 %：已判完（=@@RESULT 计数 fourState.total）/ 总数；非执行步用模拟 simPct。
  const execPct =
    runningStep === "execution" && execTotal > 0
      ? Math.min(100, Math.round((fourState.total / execTotal) * 100))
      : null;
  const barPct = !runningStep ? null : runningStep === "execution" ? execPct ?? 0 : simPct;

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
        body: JSON.stringify({ projectPath: current.path, taskName: activeTask.name, taskId: activeTask.id, cases: casesDraft }),
      }).then((res) => res.json());
      if (r?.ok) {
        setCasesPreview(casesDraft);
        setCasesDraft(null);
        logAudit("edit-cases", { detail: `用例编辑保存(${casesDraft.length} 条)` });
        // 用例改了 → 回归集可能变,重新 upsert 该任务贡献进回归用例库(保持库不 stale)。
        resyncLibrary(current.path, activeTask.name);
      }
    } catch { /* 保存失败保留编辑态,用户可重试 */ }
    setCasesSaving(false);
  };
  // 需求文档预览（问题①）：用户在「需求分析」阶段点「预览需求文档」→ 按需读 {task}-需求.md，
  // 复用报告步的 PreviewModal/MdPreview 弹窗渲染（独立状态，与报告步互不影响）。
  const [reqPreview, setReqPreview] = useState<PreviewState | null>(null);
  const [reqPreviewLoading, setReqPreviewLoading] = useState(false);
  // 操作记录弹窗(需求②审计的查看端):展示当前任务的 AI_LabTest/audit/{task}.jsonl。
  const [auditOpen, setAuditOpen] = useState(false);
  // AI 推荐回归集 · 可视化审阅弹窗(用例设计阶段;取代旧的对话框流式推荐)。
  const [recommendOpen, setRecommendOpen] = useState(false);
  // 回归用例库弹窗(项目级):查看/管理沉淀的回归用例 + 跨任务一键重跑。
  // 测试类型(批 H,用户确认的信息架构):项目下两种平级测试类型——功能测试(现有任务流)/
  // 回归测试(整页工作区:用例库/回归套件/轮次历史 页内子页签,不再用弹窗)。切换项目时重置。
  const [testType, setTestType] = useState<"func" | "regression">("func");
  const [regTab, setRegTab] = useState<RegTab>("library");
  // 发起回归弹窗(v2 批 D):套件/环境/预检确认后才真正 runLibrary(保留为确认对话框)。
  // 发起回归弹窗:null=关闭。带 preset 打开时(轮次历史的「复测 N 条」)预置复测模式与基准轮。
  const [launchOpen, setLaunchOpen] = useState<null | { mode?: "failed-only"; parentRoundId?: string }>(null);
  // 跨任务一键重跑进行中(聚合→执行→报告)。禁用重复触发,按钮显示「重跑中…」。
  const [libraryRunning, setLibraryRunning] = useState(false);
  // 重跑状态提示(库不属于任何任务对话,故用独立状态在弹窗内展示,不走任务对话 push)。
  const [libraryRunStatus, setLibraryRunStatus] = useState<string | null>(null);
  // 回归执行的实时详情（内存态，不保留历史：切走/刷新即消失，收口后的事实见「轮次报告」页）。
  const [libraryLive, setLibraryLive] = useState<LibraryLive | null>(null);
  // 回归轮次的中断通道(技术债 #23):abort → drive 的 fetch 拒绝 → runLibrary 按「用户停止」
  // 收口(轮次标 aborted)。服务端 /api/test/run 已接 req.signal → 智能体/脚本重放真正终止。
  const libraryAbortRef = useRef<AbortController | null>(null);
  // docx 原件预览弹窗(独立于 reqPreview 的文本弹窗):DocxViewer 按原版式渲染二进制原件。
  const [origDocPreview, setOrigDocPreview] = useState<{ abs: string; filename: string } | null>(null);
  useEffect(() => { setReqPreview(null); setOrigDocPreview(null); }, [aId]); // 切任务关掉残留的需求预览弹窗
  const openRequirementPreview = async (which: "md" | "original" = "md") => {
    if (!current?.path || !activeTask) return;
    // rel 相对项目根（与 MdPreview 保存口径一致：baseDir=projectPath + rel）。
    const ext = taskStates[activeTask.id]?.requirementOriginal?.ext || "";
    // docx 原件：二进制不走文本读取 → DocxViewer 按原版式（标题/表格/缩进）渲染保留的
    // 原始文件本身，而不是 mammoth 抽取文本（抽取文本只作 AI 工作输入）。
    if (which === "original" && ext === "docx") {
      const rel = `AI_LabTest/requirements/${activeTask.name}-需求-原始.docx`;
      setOrigDocPreview({
        abs: `${current.path}/${rel}`,
        filename: taskStates[activeTask.id]?.requirementOriginal?.filename || `${activeTask.name}-需求-原始.docx`,
      });
      return;
    }
    const rel =
      which === "original"
        // md/txt 的原件本身就是文本，直接读原文件。
        ? `AI_LabTest/requirements/${activeTask.name}-需求-原始.${ext || "txt"}`
        : `AI_LabTest/requirements/${activeTask.name}-需求.md`;
    setReqPreviewLoading(true);
    try {
      const res = await fetch(`/api/files/raw?path=${encodeURIComponent(`${current.path}/${rel}`)}`);
      if (!res.ok) throw new Error("read failed");
      const content = await res.text();
      setReqPreview({ kind: "md", titleKey: "test.step.requirements.name", rel, content, editable: false });
    } catch {
      showToast({ type: "error", message: t("test.requirement.previewFailed") });
    } finally {
      setReqPreviewLoading(false);
    }
  };
  // 用系统应用（Word/WPS…）打开原件——保真兜底（docx-preview 对复杂表格/图片渲染可能有出入）。
  // 仅 Electron 下可用（window.electronAPI 存在）；shell.openPath 成功返回 ''、失败返回错误串。
  const openOriginalWithSystem = async () => {
    if (!origDocPreview) return;
    try {
      const err = await window.electronAPI?.shell?.openPath?.(origDocPreview.abs);
      if (err) showToast({ type: "error", message: err });
    } catch {
      showToast({ type: "error", message: t("test.requirement.openFailed") });
    }
  };
  // First not-done step = the "current" step the detail card focuses on.
  const nextPendingStep = (): TestStep | null => STEPS.find((s) => stepStatus[s.step] !== "done")?.step ?? null;
  // focusStep = 详情卡当前展示的阶段。执行中(runningStep 存在)强制 focus 运行中的节点,
  // 不让 viewStep 把详情卡切走;空闲时才用 viewStep(用户点节点查看)或下一个待办阶段。
  const focusStep: TestStep = runningStep ?? viewStep ?? nextPendingStep() ?? "report";
  // A human-gated step awaiting approval → drives the conversation's gate bar.
  const reviewStep = STEPS.find((s) => stepStatus[s.step] === "review")?.step ?? null;
  // 导入需求且未选处理方式 → 需求分析节点「待选择」：用二选一卡片替代普通「批准」闸门（Q3）。
  const requirementChoosePending =
    !!aState.imported?.requirement && !aState.requirementMode && stepStatus.requirement === "review";
  // 是否有保留的原始需求文档（新导入任务才有；旧任务无）——决定是否显示「预览原始文档」。
  const hasRequirementOriginal = !!aState.requirementOriginal?.ext;

  // Run one step: stream /api/test/run into the 测试对话 (bubbles) + tally four-state
  // (execution @@RESULT frames). One step at a time; status drives pipeline + gating.
  const runStep = async (
    step: TestStep,
    opts?: {
      headed?: boolean;
      baseUrl?: string;
      target?: { projPath: string; task: { id: string; name: string } };
      // 需求分析节点刚二选一时 taskStates 尚未落地(setState 异步) → 用这个即时值覆盖，避免读到旧 state。
      requirementModeOverride?: "generate-md" | "use-original";
      // 同上:执行前确认弹窗刚改的「沉淀回归脚本」在本次运行就要生效,而 patchTask 是异步的。
      depositScriptsOverride?: boolean;
    },
  ) => {
    // target 缺省 = 活动选择(原行为)；传入 = 跑指定后台任务(批量 / auto-chain 接力其它任务)。
    const projPath = opts?.target ? opts.target.projPath : selected !== null ? projects[selected]?.path : undefined;
    const task = opts?.target
      ? opts.target.task
      : selected !== null && selectedTask !== null
        ? projects[selected]?.tasks[selectedTask] ?? null
        : null;
    if (!projPath || !task || runningIdsRef.current.has(task.id)) return;
    const id = task.id; // capture — all updates patch THIS task even if the user switches away
    // 执行方式仅对「测试执行」步有意义(只有它注入 Playwright)。弹窗触发带 opts.headed,
    // 非弹窗触发(运行任务 / auto-chain / 队列起跑)回落到上次选择(execModeRef)。
    const headed = step === "execution" ? (opts?.headed ?? execModeRef.current === "visible") : false;
    // 被测链接覆盖(仅执行步):弹窗显式确认的地址 > 任务级 targetUrl(新建任务「目标」输入,
    // 让「运行任务」/auto-chain/排队这些不经确认弹窗的路径也直测任务地址)> 不传(服务端回落
    // 项目环境配置 environments.json)。
    const baseUrlOverride =
      step === "execution"
        ? (opts?.baseUrl?.trim() || taskStates[id]?.targetUrl?.trim() || undefined)
        : undefined;
    // 问题②·停止: a per-run AbortController. stopTask() aborts it → the fetch rejects
    // with AbortError, which the catch/finally below treat as a clean stop (not error).
    const ctrl = new AbortController();
    abortMapRef.current.set(id, ctrl);
    // (re)running this step → 清掉该步【及其下游】的停止标记：重跑会重做下游，故下游的「停止」
    // 标记也应失效，否则停过执行后重跑执行，报告会被旧标记挡住不自动接力。
    {
      const sidx = STEP_ORDER.indexOf(step);
      for (let i = sidx; i < STEP_ORDER.length; i++) stoppedStepRef.current.delete(`${id}:${STEP_ORDER[i]}`);
    }
    markRunning(id);
    stepStartRef.current[`${id}:${step}`] = Date.now(); // 使用统计：运行中用时累计起点
    // 清掉该步上一次的用时/模型徽标：运行中显示实时累计，若本轮失败/中断（无 step_stats
    // 补发）则徽标为空而非残留旧值（评审 L6）；成功时 step_stats 会重新写入。
    patchTask(id, (s) => {
      const d = { ...(s.stepDurations ?? {}) }; delete d[step];
      const m = { ...(s.stepModels ?? {}) }; delete m[step];
      return { stepDurations: d, stepModels: m };
    });
    // 重跑某步 → 其下游各步产物失效：当前步置 running，其后所有步骤复位 idle(未开始)，
    // 避免重跑时下游残留上次的「已完成」(如重跑「测试执行」后「测试报告」仍显示已完成)。
    // 规则收敛在 withDownstreamReset；所有重跑入口都经此处，四节点统一生效。
    // 正向跑流水线时下游本就 idle，复位是 no-op，不影响正常流程。
    patchTask(id, (s) => ({ stepStatus: withDownstreamReset(s.stepStatus, step, STEP_ORDER, "running", "idle") }));
    if (step === "execution") {
      patchTask(id, () => ({
        fourState: { total: 0, pass: 0, fail: 0, partial: 0, blocked: 0 },
        currentCase: "",
        caseResults: [],
        circuitBroken: false,
      }));
      // 使用统计：进入执行 = 用例已被批准（手动门控 / 运行任务 / 批量三条路径的汇聚点）。
      // 服务端据此读 cases.json 拍终态快照、对首轮基线做 diff 算采纳率（last-wins，重跑重新快照无害）。
      recordTestStat([{ eventType: "cases_approved", projectPath: projPath, taskId: id, taskName: task.name, env }]);
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
    // 逐行解析执行步的 AI 文本(@@RESULT / @@CASE_START / ▶ 进度行)。
    // 解析下沉到 lib/test/exec-live.ts,与服务端归约共用 markers.ts —— 原来这里用
    // 「indexOf + slice 到行尾 + JSON.parse」,模型一旦把判定行包成 `**@@RESULT {…}**`
    // 就整条解析失败、实时四态与用例列表全空(与 2026-07-10 服务端那次事故同源)。
    const lineBuf = createExecLineBuffer();
    const applyLine = (e: ExecLine) => {
      if (e.kind === "result") {
        const r = e.result;
        patchTask(id, (s) => ({
          fourState: {
            total: s.fourState.total + 1,
            pass: s.fourState.pass + (r.status === "pass" ? 1 : 0),
            fail: s.fourState.fail + (r.status === "fail" ? 1 : 0),
            partial: s.fourState.partial + (r.status === "partial" ? 1 : 0),
            blocked: s.fourState.blocked + (r.status === "blocked" ? 1 : 0),
          },
          caseResults: [...s.caseResults, { id: r.id, status: r.status, actual: r.actual, error: r.error, evidence: r.evidence }],
        }));
        push({ role: "tool", text: `■ ${r.id} → ${r.status}` });
      } else if (e.kind === "resultMalformed") {
        // 含判定标记却解不出 —— 不静默吞掉,原样放进对话流让用户看得见。
        appendAi(e.raw + "\n");
      } else if (e.kind === "progress") {
        // currentCase 保留原始文本（parseExecProgress 会再解一次，向后兼容既有渲染）。
        patchTask(id, () => ({ currentCase: e.text }));
        appendAi(`▶ ${e.text}\n`);
      } else if (e.kind === "text") {
        appendAi(e.text + "\n");
      }
      // caseStart 是纯机器标记,不进对话流(服务端用它给工具轨迹归属用例)。
    };
    const processText = (chunk: string) => { for (const e of lineBuf.feed(chunk)) applyLine(e); };
    try {
      const res = await fetch("/api/test/run", {
        method: "POST",
        signal: ctrl.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectPath: projPath,
          taskName: task.name,
          // 使用统计的任务身份（workbench 任务 UUID）；服务端埋点按它归档事件
          taskId: task.id,
          step,
          env,
          // 追加指令: user-typed notes for this task, appended to the step prompt server-side.
          extraInstruction: (taskStates[id]?.notes ?? []).join("\n") || undefined,
          // Imported step → tell the AI to Read + reuse the uploaded artifact, not overwrite it.
          reuseImported:
            (step === "requirement" && !!taskStates[id]?.imported?.requirement) ||
            (step === "cases" && !!taskStates[id]?.imported?.cases) ||
            undefined,
          // 导入需求的处理模式 + 保留原文扩展名 → 后端据此定位需求来源文件（原文/抽取文本 vs 需求.md）。
          requirementMode: opts?.requirementModeOverride ?? taskStates[id]?.requirementMode ?? undefined,
          requirementOriginalExt: taskStates[id]?.requirementOriginal?.ext || undefined,
          model: model || undefined,
          providerId: providerId || undefined,
          // 执行方式 + 被测链接覆盖(见上)。headed 仅执行步透传;baseUrl 缺省时后端回落 environments.json。
          headed: step === "execution" ? headed : undefined,
          baseUrl: baseUrlOverride,
          // 是否为本任务沉淀回归脚本(任务级开关)。undefined=开启,故只在明确关闭时传 false ——
          // 服务端同样按 `!== false` 判定,存量任务与旧客户端行为不变。
          depositScripts:
            (opts?.depositScriptsOverride ?? taskStates[id]?.depositScripts) === false ? false : undefined,
        }),
      });
      // 非 2xx(如 /api/test/run 抛错走 500 + JSON {error})：之前直接进流式解析，500 的
      // JSON body 没有 SSE 分帧 → 一帧都解析不出 → 既不报错也不计入，最终 finally 把步当成
      // "done"(已完成) —— 用户看到「点了测试并执行却什么都没发生」。这里显式把非 2xx 的
      // 错误正文取出、报成错误气泡并标记失败，让失败可见(而不是静默吞掉)。
      if (!res.ok) {
        let msg = `${t("test.flow.run")} 失败（HTTP ${res.status}）`;
        try {
          const txt = await res.text();
          try {
            const j = JSON.parse(txt);
            msg = (j.userMessage as string) || (j.error as string) || (j.rawMessage as string) || msg;
          } catch {
            if (txt.trim()) msg = txt.trim().slice(0, 800);
          }
        } catch {
          /* body unreadable — keep the HTTP-status message */
        }
        push({ role: "error", text: msg });
        sawError = true;
        return;
      }
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
        // abort 赢得 race，或这一拍解析出来时信号已 abort（停止与流自然 done 同刻竞争时，
        // 即便 read() 的 done 抢先返回，也按「停止」处理）→ 立即停止，绝不让该步落到 done
        // 而触发下游(测试报告)自动接力。
        if ("aborted" in chunk || ctrl.signal.aborted) { stopped = true; break; }
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
                    durationMs: typeof tt.durationMs === "number" ? tt.durationMs : undefined,
                  }));
                }
                return patch;
              });
            } catch {}
          } else if (evt.type === "step_stats") {
            // 使用统计：服务端在步骤干净收尾时补发的节点用时/模型（权威值），写进 TaskState
            // 供流程节点徽标展示 + 随 workbench 持久化。未知帧旧前端静默忽略、零影响。
            try {
              const ss = JSON.parse(evt.data || "{}") as { step?: string; durationMs?: number; model?: string | null };
              const stStep = ss.step as TestStep | undefined;
              if (stStep && STEP_ORDER.includes(stStep)) {
                patchTask(id, (s) => ({
                  stepDurations: { ...(s.stepDurations ?? {}), ...(typeof ss.durationMs === "number" ? { [stStep]: ss.durationMs } : {}) },
                  stepModels: { ...(s.stepModels ?? {}), ...(ss.model ? { [stStep]: ss.model } : {}) },
                }));
              }
            } catch {}
          } else if (evt.type === "exec_notice") {
            // 后端系统提示(非 AI 输出 / 非错误):目前仅「有头自动回落无头」。映射成本地化系统气泡。
            const code = evt.data || "";
            const msg = code === "headed_downgraded_no_chrome" ? t("test.execConfirm.downgradedNoChrome") : "";
            if (msg) push({ role: "tool", text: `⚠️ ${msg}` });
          } else if (evt.type === "library_updated") {
            // 用例设计步完成 → 后端已把该任务回归用例自动 upsert 进回归用例库,提示入库结果并刷新库视图。
            let s = { added: 0, removed: 0, total: 0 };
            try { s = JSON.parse(evt.data || "{}"); } catch { /* keep zeros */ }
            if (s.added > 0 || s.removed > 0) {
              push({ role: "tool", text: `📥 ${t("test.library.deposited", { added: s.added, total: s.total })}` });
              setLibraryReload((n) => n + 1);
            }
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
      // 流末冲刷:最后一行可能没有换行符,漏了它会丢掉一条判定或总结。
      for (const e of lineBuf.flush()) applyLine(e);
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
      const autoAll = autoRunIdsRef.current.has(id);
      // 用例门控:「运行任务」(autoRun)也在用例设计完成后停「待批准」——生成完用例必须
      // 人审(回归集标签/用例内容),点批准才进入执行(见 gatedRunAllRef;批准时恢复 autoRun
      // 续跑 执行→报告)。需求分析在 autoRun 下仍直通;排队提升时对旧 review 的自动批准
      // (pumpQueue)不受影响——那是「入队前已存在的产物」的隐含确认,本门控只拦本次新生成的用例。
      const gateCases = step === "cases" && autoAll && !stopped && !sawError;
      const finalStatus: StepStatus =
        stopped ? "idle" : sawError ? "error" : gateCases || (HUMAN_GATED.includes(step) && !autoAll) ? "review" : "done";
      patchTask(id, (s) => ({ stepStatus: { ...s.stepStatus, [step]: finalStatus } }));
      if (stopped) {
        // 停止 = 在此节点停住，不再向下游接力。标记该步【及其下游】为已停止，auto-chain 便不会
        // 把流水线推进到下一步（如停「测试执行」时不流转到「测试报告」）。标记在该步被(重)跑或
        // 「运行任务」时清除（见 runStep 起跑处 + startRunAllFrom）。
        const sidx = STEP_ORDER.indexOf(step);
        for (let i = sidx; i < STEP_ORDER.length; i++) stoppedStepRef.current.add(`${id}:${STEP_ORDER[i]}`);
        push({ role: "user", text: `■ ${t("test.flow.stop")}「${stepName}」` });
      }
      // End run-all mode when stopped, when anything errors, or when the pipeline
      // finishes (报告) — release the auto-chain claim for this task. 用例门控同样释放
      // (槽位空出、排队任务可提升),但记入 gatedRunAllRef 供批准时恢复接力。
      if (stopped || sawError || step === "report" || gateCases) {
        autoRunIdsRef.current.delete(id);
        if (gateCases) gatedRunAllRef.current.add(id);
      }
      // Only clear this task's abort controller if it's still ours (a fast re-run could have replaced it).
      if (abortMapRef.current.get(id) === ctrl) abortMapRef.current.delete(id);
      markIdle(id);
      // 槽位空出 → 尝试从排队队列启动下一个(见 pumpQueue)。
      pumpQueue();
    }
  };

  // 停止 (问题②): abort the in-flight run. The fetch rejects with AbortError →
  // runStep's catch/finally reset the step to idle, clear run-all, and free busy,
  // so the 运行 button can re-run this node. No-op if nothing is running.
  const stopTask = (tid: string) => {
    if (!tid) return;
    // 停止 = 退出该任务的 run-all / 排队，并中断 in-flight。用例门控的恢复标记一并清除
    // (停止后再批准用例走手动语义,不再自动接力到报告)。
    autoRunIdsRef.current.delete(tid);
    gatedRunAllRef.current.delete(tid);
    logAudit("stop", { taskId: tid });
    if (waitingQueueRef.current.includes(tid)) {
      waitingQueueRef.current = waitingQueueRef.current.filter((x) => x !== tid); // 排队中 → 直接出队
      setWaitingTaskIds(new Set(waitingQueueRef.current));
    }
    // 正常运行：abort in-flight 请求，runStep 的 catch/finally 会把该步复位为 idle。
    const ctrl = abortMapRef.current.get(tid);
    if (ctrl) { ctrl.abort(); return; }
    // 僵尸 running（无 in-flight：如关闭应用后重启恢复的 running，已无对应请求，abort 无效）
    // → 主动把运行中的步复位为 idle 并清 running，让停止按钮对这种状态也生效、可重新运行。
    patchTask(tid, (s) => {
      const ss = { ...s.stepStatus };
      let changed = false;
      for (const k of Object.keys(ss) as Array<keyof typeof ss>) if (ss[k] === "running") { ss[k] = "idle"; changed = true; }
      return changed ? { stepStatus: ss } : {};
    });
    markIdle(tid);
  };
  // 详情卡「停止」= 停活动任务。
  const stopStep = () => { if (aId) stopTask(aId); };

  // 删除项目/任务:删前检查是否有正在执行的任务(runningTaskIds),有则在确认弹窗里做二次强提醒。
  const [deleteTarget, setDeleteTarget] = useState<
    { kind: "project" | "task"; pIdx: number; tIdx?: number; name: string; running: boolean } | null
  >(null);
  const requestDeleteProject = (pIdx: number) => {
    const p = projects[pIdx];
    if (!p) return;
    setDeleteTarget({ kind: "project", pIdx, name: p.name, running: p.tasks.some((tk) => runningTaskIds.has(tk.id)) });
  };
  const requestDeleteTask = (tIdx: number) => {
    if (selected === null) return;
    const tk = projects[selected]?.tasks[tIdx];
    if (!tk) return;
    setDeleteTarget({ kind: "task", pIdx: selected, tIdx, name: tk.name, running: runningTaskIds.has(tk.id) });
  };
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const { kind, pIdx, tIdx, running } = deleteTarget;
    if (running) {
      // 删除正在执行的目标 → 先中断其所有在跑/排队任务
      const victims =
        kind === "project"
          ? (projects[pIdx]?.tasks ?? []).map((tk) => tk.id)
          : ([projects[pIdx]?.tasks[tIdx!]?.id].filter(Boolean) as string[]);
      for (const vid of victims) stopTask(vid);
    }
    // 问题6：先收集要删报告的 (项目路径, 任务名)，UI 删除会改 projects，必须在删之前读。
    const toDelete: { path: string; name: string }[] = [];
    // 删除后的新状态副本：用于本函数结尾「立即同步 PUT」(不等 debounce)。setState 仍走函数式
    // (基于最新 m，避免覆盖删除期间其它在跑任务的 SSE 更新)，副本只用来立刻把已删结果落盘。
    let nextProjects = projects;
    let nextTaskStates = taskStates;
    if (kind === "project") {
      const proj = projects[pIdx];
      if (proj?.path) for (const tk of proj.tasks) toDelete.push({ path: proj.path, name: tk.name });
      // 使用统计：删除项目 → 逐任务记 task_deleted
      if (proj?.path) {
        recordTestStat(proj.tasks.map((tk) => ({ eventType: "task_deleted", projectPath: proj.path, taskId: tk.id, taskName: tk.name })));
      }
      const ids = new Set((proj?.tasks ?? []).map((tk) => tk.id));
      nextTaskStates = (() => { const n = { ...taskStates }; ids.forEach((id) => delete n[id]); return n; })();
      nextProjects = projects.filter((_, i) => i !== pIdx);
      setTaskStates((m) => { const n = { ...m }; ids.forEach((id) => delete n[id]); return n; });
      setProjects((ps) => ps.filter((_, i) => i !== pIdx));
      if (selected === pIdx) { setSelected(null); setSelectedTask(null); }
      else if (selected !== null && selected > pIdx) setSelected(selected - 1);
    } else {
      const proj = projects[pIdx];
      const tk = proj?.tasks[tIdx!];
      if (proj?.path && tk) toDelete.push({ path: proj.path, name: tk.name });
      // 使用统计：删除单个任务
      if (proj?.path && tk) {
        recordTestStat([{ eventType: "task_deleted", projectPath: proj.path, taskId: tk.id, taskName: tk.name }]);
      }
      if (tk) {
        nextTaskStates = (() => { const n = { ...taskStates }; delete n[tk.id]; return n; })();
        setTaskStates((m) => { const n = { ...m }; delete n[tk.id]; return n; });
      }
      nextProjects = projects.map((p, i) => (i === pIdx ? { ...p, tasks: p.tasks.filter((_, j) => j !== tIdx) } : p));
      setProjects((ps) => ps.map((p, i) => (i === pIdx ? { ...p, tasks: p.tasks.filter((_, j) => j !== tIdx) } : p)));
      if (selected === pIdx && selectedTask === tIdx) { setSelectedTask(null); setView("dash"); }
      else if (selected === pIdx && selectedTask !== null && selectedTask > tIdx!) setSelectedTask(selectedTask - 1);
    }
    setDeleteTarget(null);
    // 问题6 时序修复：磁盘报告删【完成后】再刷新报告 tab。否则 setProjects 触发的 ReportBrowser
    // re-fetch 可能早于 DELETE 完成、又扫到没删的报告（用户报「删任务后报告还在」的根因）。
    if (toDelete.length) {
      // 审计(删除动作前写):audit 文件在 AI_LabTest/audit/ 下、不在报告目录,删除后留痕。
      for (const r of toDelete) logAudit("delete-task", { projPath: r.path, taskName: r.name, detail: "删除任务(报告已清理,审计留痕)" });
      await Promise.all(toDelete.map((r) => deleteTaskReports(r.path, r.name)));
      setReportsReload((n) => n + 1);
    }
    // 问题3 修复：删除完成后【立即同步 PUT】最新状态到文件，不依赖上方 ~500ms 的 debounce
    // 持久化。否则用户在 debounce 触发前就关闭应用 → 删除从未落盘 → 重启又把已删项目/任务读回。
    if (loaded) {
      fetch("/api/test/workbench", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projects: nextProjects, taskStates: nextTaskStates }),
      }).catch(() => {});
    }
  };

  // Approve a human-gated step (待批准 → 已完成) 并推进:批准后主动运行下一阶段。
  // 下一步若是 gated(用例),下方 auto-chain effect 不会自动跑它(其 !HUMAN_GATED 条件),
  // 故在此主动触发;execution/report 的后续接力仍交给 auto-chain effect。runStep 只看
  // 运行集合、不依赖 unlocked,批准时该任务无运行中步,直接驱动安全。
  const approveStep = (step: TestStep) => {
    if (!aId) return;
    patchTask(aId, (s) => ({ stepStatus: { ...s.stepStatus, [step]: "done" } }));
    // 「运行任务」在用例门控停下的任务:批准 = 恢复流水线,重新认领 autoRun,执行→报告
    // 自动接力(切走任务也后台跑完,保持「运行任务」语义)。手动流程(不在集合)行为不变。
    const resumedRunAll = step === "cases" && gatedRunAllRef.current.delete(aId);
    if (resumedRunAll) autoRunIdsRef.current.add(aId);
    logAudit("approve", { step, detail: resumedRunAll ? "运行任务·用例门控批准,恢复自动接力" : undefined });
    const idx = STEPS.findIndex((s) => s.step === step);
    const next = STEPS[idx + 1];
    if (next && !stoppedStepRef.current.has(`${aId}:${next.step}`)) {
      // 批准直接起跑的下一步不经 auto-chain,审计补 run 记录(否则执行步在链路里缺一环)。
      logAudit("run", { step: next.step, mode: "auto", detail: "批准后接力" });
      runStep(next.step);
    }
  };

  // Manual single-step run (pill / detail 运行 button): cancels any run-all mode so
  // gates apply normally.
  const runStepManual = (step: TestStep) => {
    if (aId) autoRunIdsRef.current.delete(aId);
    logAudit("run", { step });
    runStep(step);
  };

  // 需求分析节点·二选一（导入需求且 requirementMode 未定 = 「待选择」时展示）。选择即人工接管
  // (退出 autoRun)，之后按正常门控推进。requirementModeOverride 即时透传，避免读到未落地的 state。
  // A) 生成需求分析文档：AI 读原文归一 → 需求.md（原始 + md 两份都保留），完成后进入待批准。
  const chooseGenerateReqMd = () => {
    if (!aId || busy) return;
    autoRunIdsRef.current.delete(aId);
    patchTask(aId, () => ({ requirementMode: "generate-md" }));
    runStep("requirement", { requirementModeOverride: "generate-md" });
  };
  // B) 直接使用导入文档：跳过 AI，需求步直接完成 → 用例设计读原始文档/抽取文本。
  const chooseUseOriginalReq = () => {
    if (!aId || busy) return;
    autoRunIdsRef.current.delete(aId);
    patchTask(aId, (s) => ({ requirementMode: "use-original", stepStatus: { ...s.stepStatus, requirement: "done" } }));
    if (!stoppedStepRef.current.has(`${aId}:cases`)) runStep("cases", { requirementModeOverride: "use-original" });
  };

  // 详情卡「运行 / 重跑」点击:测试执行步先弹「执行前确认被测链接」(确认地址 + 选执行方式
  // + 测试连接),其余步直接跑。运行任务 / auto-chain 不走这里,用上次选择不打断流水线。
  const handleRunFocusStep = () => {
    if (focusStep === "execution") { setModal("execConfirm"); return; }
    runStepManual(focusStep);
  };
  // 弹窗「测试并执行」:记下执行方式(持久化),用确认后的地址 + 模式手动跑测试执行步。
  const runExecutionConfirmed = (baseUrl: string, headed: boolean, depositScripts: boolean) => {
    persistExecMode(headed ? "visible" : "headless");
    // 弹窗里改的「沉淀回归脚本」写回任务状态 —— 它是任务级设置,不是一次性选项;
    // 不写回的话下次打开弹窗又弹回旧值,用户会以为没生效。缺省 true,故只存 false。
    // 任务地址回写规则:确认地址与环境配置地址【不同】→ 记为任务级覆盖(下次运行任务/
    // 流水线也用它);【相同】→ 清除覆盖、回归跟随环境 —— 若无条件回写,存量任务手动执行
    // 一次就会把当时的环境地址钉死成任务地址,之后改环境配置该任务不再跟随(回归风险)。
    if (aId) {
      const envUrl = (envCfg?.frontendBaseUrl || "").trim();
      patchTask(aId, () => ({
        depositScripts: depositScripts ? undefined : false,
        targetUrl: baseUrl && baseUrl !== envUrl ? baseUrl : undefined,
      }));
    }
    setModal("none");
    if (aId) autoRunIdsRef.current.delete(aId);
    runStep("execution", { headed, baseUrl, depositScriptsOverride: depositScripts });
  };

  // 运行任务: 从指定起点把整条流水线自动跑到报告(auto-approve 门控)。受全局并发约束 ——
  // 未达上限则立即从起点起跑(runStep 把起点置 running、下游复位 idle，起点之前产物保留)；
  // 已达上限则把起点及其下游复位 idle 后进排队，空出槽位时由 pumpQueue 提升、auto-chain 从该
  // 起点起跑。对话历史保留(不清空、追加新一轮)。
  const startRunAllFrom = (step: TestStep) => {
    if (!activeTask || busy || !current?.path) return;
    const id = activeTask.id;
    if (waitingQueueRef.current.includes(id)) return; // 已在排队 → 不重复入队
    // 运行任务 drives the whole pipeline → clear this task's 停止 marks so the
    // auto-chain isn't blocked on a step the user stopped in a previous attempt.
    for (const s of STEPS) stoppedStepRef.current.delete(`${id}:${s.step}`);
    gatedRunAllRef.current.delete(id); // 新一轮运行:清上一轮用例门控的恢复标记
    logAudit("run-task", { taskId: id, step, detail: "运行任务(流水线起点)" });

    // 起点(需求/用例/执行)及之后都会重跑到「测试执行」→ 清掉上轮四态/用例结果，避免 stale 残留。
    patchTask(id, () => ({
      fourState: { total: 0, pass: 0, fail: 0, partial: 0, blocked: 0 },
      currentCase: "",
      caseResults: [],
      circuitBroken: false,
    }));
    // 全局并发：占用 = 在跑(running) ∪ 已认领(autoRun)。未达上限立即跑；达上限进排队。
    if (occupiedSlots(runningIdsRef.current, autoRunIdsRef.current) < concurrencyRef.current) {
      autoRunIdsRef.current.add(id);
      runStep(step);
      return;
    }
    // 排队：把起点及其下游复位为 idle，使空槽后 auto-chain 从该起点起跑(起点之前的产物保留)。
    patchTask(id, (s) => ({ stepStatus: withDownstreamReset(s.stepStatus, step, STEP_ORDER, "idle", "idle") }));
    waitingQueueRef.current = [...waitingQueueRef.current, id];
    setWaitingTaskIds(new Set(waitingQueueRef.current));
  };

  // 运行任务 click: 全新任务(全 idle)直接从需求分析开跑；其余(部分完成 / 已完成)弹「选择起点」。
  const doRunTask = () => {
    // 一律走「运行任务」确认弹窗。此前全 idle 的新任务直接起跑、不弹窗 —— 于是新任务
    // 恰恰没机会确认起点与「沉淀回归脚本」(用户反馈:点运行任务没得选)。弹窗对全 idle
    // 任务只有一个可选起点(需求分析),多一次点击换来选项可见,值得。
    setModal("runStart");
  };
  const handleRunTask = () => {
    if (!activeTask || busy || !current?.path) return;
    // R2 软提醒：整条流水线含「测试执行」步、但项目未配置环境地址(无被测目标)→ 先弹提醒，
    // 仍可「仍要运行」。envCfg 为 null(配置加载中)时不打断，避免误报。
    if (envCfg && !envCfg.configured) { setModal("envWarn"); return; }
    doRunTask();
  };

  // Auto-chain: run the next unlocked+idle step of the ACTIVE task. Normally only
  // auto steps (执行/报告) chain; in 运行任务 mode, gated steps (需求/用例) chain too.
  // Fires when a step becomes "done". runStep excluded from deps (the idle+unlocked
  // guard + busy check prevent re-fire loops).
  useEffect(() => {
    // 候选集 = 活动任务(详情卡手动流程：执行/报告自动接力) ∪ autoRun 任务(运行任务：门控也
    // 自动接力)。每个任务独立推进、互不阻塞；runningIdsRef 防止给正在跑的任务重复发起。
    const candidates = new Set<string>(autoRunIdsRef.current);
    if (activeTask) candidates.add(activeTask.id);
    let freed = false; // 有 autoRun 任务跑完释放了槽位 → 末尾再 pumpQueue 放下一个排队任务
    for (const tid of candidates) {
      if (runningIdsRef.current.has(tid)) continue; // 该任务有步在跑 → 等它结束
      if (waitingQueueRef.current.includes(tid)) continue; // 排队中 → 等 pumpQueue 提升，别抢跑
      const st = taskStates[tid];
      const loc = st ? findTaskLoc(tid) : null;
      const autoAll = autoRunIdsRef.current.has(tid);
      if (!st || !loc) {
        // 任务状态/位置丢了(被删等) → 从 autoRun 释放，免得空占槽位。
        if (autoRunIdsRef.current.delete(tid)) { freed = true; }
        continue;
      }
      const next = STEPS.find(
        (s) =>
          st.stepStatus[s.step] === "idle" &&
          stepUnlockedFor(st.stepStatus, s.step) &&
          (autoAll || !HUMAN_GATED.includes(s.step)) &&
          !stoppedStepRef.current.has(`${tid}:${s.step}`), // don't auto-rerun a 停止'd step
      );
      if (next) {
        // 全局并发护栏：autoRun 任务是已认领的流水线(占着槽位)，照常接力；非 autoRun 的活动任务
        // 续跑(如手动批准门控后自动跑执行)算「新起跑」，达并发上限时先按住，空出槽位后本 effect
        // 会因 runningTaskIds 变化重跑并自动放行 —— 不死锁。
        if (!autoAll && occupiedSlots(runningIdsRef.current, autoRunIdsRef.current) >= concurrencyRef.current) continue;
        logAudit("run", { taskId: tid, step: next.step, mode: "auto", projPath: loc.projPath, taskName: loc.task.name });
        runStep(next.step, { target: loc });
        continue;
      }
      // autoRun 任务已无可执行步(整条跑完 / 全 done / 卡在门控外) → 释放槽位(活动手动任务不强释放)。
      if (autoAll && autoRunIdsRef.current.delete(tid)) { freed = true; }
    }
    if (freed) pumpQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskStates, runningTaskIds, aId]);

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
        {process.env.NEXT_PUBLIC_BUILD_ID ? (
          <span
            className="select-text font-mono text-[10px] leading-none text-muted-foreground/60"
            title="当前运行包的构建标记（commit · 构建时间）—— 用于核对界面是否为最新打包版本"
          >
            {process.env.NEXT_PUBLIC_BUILD_ID}
          </span>
        ) : null}
        <span className="flex-1" />
        <div className="flex overflow-hidden rounded-md border border-border">
          {segBtn("dash", t("test.projects"))}
          {segBtn("report", t("test.view.report"))}
          {segBtn("stats", t("test.stats.tab"))}
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
                {(() => {
                  // 任务级目标地址优先展示(执行时它也确实优先生效);无任务地址回落环境地址。
                  const taskUrl = (aId && taskStates[aId]?.targetUrl) || "";
                  const shownUrl = taskUrl || envCfg?.frontendBaseUrl || "";
                  if (!shownUrl) {
                    return (
                      <button
                        onClick={() => router.push("/settings#test-accounts")}
                        className="rounded bg-status-warning-muted px-1.5 py-0.5 text-[10px] font-medium text-status-warning-foreground hover:opacity-80"
                      >
                        {t("test.env.unconfigured")}
                      </button>
                    );
                  }
                  return (
                    <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <span
                        className="max-w-[180px] truncate font-mono"
                        title={`${t(taskUrl ? "test.env.taskTargetTitle" : "test.env.targetLabel")}: ${shownUrl}`}
                      >
                        🎯 {shownUrl}
                      </span>
                      {taskUrl ? (
                        <span
                          className="rounded bg-muted px-1 py-0.5 text-[10px]"
                          title={t("test.env.taskTargetTitle")}
                        >
                          {t("test.env.taskTargetBadge")}
                        </span>
                      ) : envCfg?.source === "db" ? (
                        <span
                          className="rounded bg-muted px-1 py-0.5 text-[10px]"
                          title={t("test.env.fromSettingsTitle")}
                        >
                          {t("test.env.fromSettings")}
                        </span>
                      ) : null}
                    </span>
                  );
                })()}
                {/* 顶部「运行任务」按钮运行中不再变成停止 —— 停止只保留详情卡那一个,
                    避免两处停止入口造成混淆;运行中此按钮直接禁用。 */}
                <button
                  onClick={() => setAuditOpen(true)}
                  title={t("test.audit.title")}
                  className="flex h-7 items-center gap-1 rounded-md border border-border px-2 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <ListChecks size={12} /> {t("test.audit.title")}
                </button>
                <button
                  onClick={handleRunTask}
                  disabled={!current?.path || busy || aQueued || !stepUnlocked(focusStep)}
                  title={aQueued ? t("test.batch.queued") : !stepUnlocked(focusStep) ? t("test.flow.locked") : t("test.flow.runAllHint")}
                  className="flex h-7 items-center gap-1 rounded-md bg-primary px-2.5 text-[11px] font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {aQueued ? <SpinnerGap size={12} /> : <Play size={12} />} {aQueued ? t("test.batch.queued") : t("test.flow.runTask")}
                </button>
              </div>
              {!current?.path && (
                <div className="mb-3 rounded-md border border-border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
                  {t("test.flow.noPath")}
                </div>
              )}

              {/* pipeline strip (horizontal): 需求 → 用例 → 执行 → 报告。
                  问题1：导入用例的任务跳过需求分析，隐藏需求节点。 */}
              <div className="mb-3 flex flex-wrap gap-2">
                {STEPS.filter((s) => !(aState.imported?.cases && s.step === "requirement")).map((s, i) => {
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
                      {/* 使用统计：用时徽标（运行中本地实时累计 / 完成后服务端权威值）+ 所用模型 */}
                      {(() => {
                        void nowTick; // 依赖 1s ticker 触发运行中用时的重渲染
                        const started = aId ? stepStartRef.current[`${aId}:${s.step}`] : undefined;
                        const liveMs = isRunning && started ? Date.now() - started : null;
                        const doneMs = aState.stepDurations?.[s.step];
                        const durText = liveMs !== null ? `${fmtDuration(liveMs)}…` : typeof doneMs === "number" ? fmtDuration(doneMs) : null;
                        const model = aState.stepModels?.[s.step];
                        if (!durText && !model) return null;
                        return (
                          <div className="mt-1 flex flex-col gap-0.5">
                            {durText && (
                              <span className={`font-mono text-[10px] ${isRunning ? "text-primary" : "text-muted-foreground"}`}>⏱ {durText}</span>
                            )}
                            {model && <span className="truncate font-mono text-[9px] text-muted-foreground" title={model}>{model}</span>}
                          </div>
                        );
                      })()}
                    </button>
                  );
                })}
              </div>

              {/* current-step detail card */}
              <div className="rounded-xl border border-border bg-card p-3">
                <div className="mb-2 flex items-center gap-2">
                  <h4 className="text-xs font-semibold text-foreground">{focusStep === "report" ? t("test.report.overviewTitle") : t(STEPS.find((s) => s.step === focusStep)!.name)}</h4>
                  {focusStep === "execution" && (
                    <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">{t("test.flow.aiDriven")}</span>
                  )}
                  {focusStep === "execution" && (
                    <span
                      className="flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                      title={execMode === "visible" ? t("test.execConfirm.hintVisible") : t("test.execConfirm.hintHeadless")}
                    >
                      {execMode === "visible" ? <Desktop size={10} /> : <Lightning size={10} />}
                      {execMode === "visible" ? t("test.execConfirm.modeVisible") : t("test.execConfirm.modeHeadless")}
                    </span>
                  )}
                  {/* 回归脚本沉淀开关:常驻徽标,一眼见状态、一点即切。
                      不能只放在执行前确认弹窗里 —— 「运行任务」的自动接力直接调 runStep、
                      根本不弹那个弹窗,用户在流水线模式下既够不着也看不到当前设置。 */}
                  {focusStep === "execution" && aId && (
                    <button
                      onClick={() => patchTask(aId, (s) => ({ depositScripts: s.depositScripts === false ? undefined : false }))}
                      disabled={runningStep === "execution"}
                      title={t("test.execConfirm.depositHint")}
                      className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition disabled:opacity-40 ${
                        taskStates[aId]?.depositScripts === false
                          ? "bg-muted text-muted-foreground hover:text-foreground"
                          : "bg-primary/10 text-primary hover:bg-primary/20"
                      }`}
                    >
                      <Terminal size={10} />
                      {taskStates[aId]?.depositScripts === false
                        ? t("test.flow.depositScriptsOff")
                        : t("test.flow.depositScriptsOn")}
                    </button>
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
                  ) : aQueued ? (
                    // 排队中 → 取消排队 (出队、不起跑)。也避免手动单步运行抢跑、绕过全局并发。
                    <button
                      onClick={() => { if (aId) stopTask(aId); }}
                      title={t("test.batch.cancelQueue")}
                      className="flex h-7 items-center gap-1 rounded-md border border-border px-2.5 text-[11px] font-medium text-muted-foreground hover:text-foreground"
                    >
                      <X size={12} /> {t("test.batch.cancelQueue")}
                    </button>
                  ) : (
                    <button
                      onClick={handleRunFocusStep}
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
                    {/* 执行进展：「N/总数 用例标题」—— N=当前跑到第几个，总数=用例总数（来自进度行或 cases 数）。
                        运行中实时显示；首条进度行到达前显示「0/总数 准备中…」。 */}
                    {runningStep === "execution" && (
                      <div className="mt-2 flex items-center gap-2 text-xs">
                        <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 font-medium tabular-nums text-primary">
                          {execIdx || 0}/{execTotal || "?"}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-foreground" title={execCaseTitle || undefined}>
                          {execCaseTitle || t("test.flow.preparing")}
                        </span>
                      </div>
                    )}
                  </>
                )}
                {/* 用例设计阶段:展示生成的测试用例(参考 ai-lab-test-framework 的用例字段)。 */}
                {focusStep === "cases" && (
                  <div className="mt-2">
                    <div className="mb-1.5 flex items-center gap-1">
                      <span className="text-[11px] text-muted-foreground">{t("test.cases.total")} · {casesPreview.length}</span>
                      <span className="flex-1" />
                      {casesPreview.length > 0 && <button onClick={() => setCasesDraft(structuredClone(casesPreview))} className="rounded bg-primary px-2 py-0.5 text-[10px] font-medium text-primary-foreground hover:opacity-90">{t("test.cases.viewEdit")}</button>}
                      {/* 「🎯 AI 推荐回归集」入口已按需下线（保留 recommendSuite / RecommendReviewModal / /api/test/cases/recommend[/apply] 代码，恢复时把此按钮加回即可）。 */}
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
                {/* 测试报告步：报告完成后就地展示概览+产出资料+全文（替换占位提示）。 */}
                {focusStep === "report" && (
                  <ReportStepPanel
                    t={t}
                    projectPath={current?.path ?? ""}
                    taskName={activeTask?.name ?? ""}
                    env={env}
                    reportStatus={stepStatus.report}
                    live={{ caseResults, fourState, circuitBroken }}
                    model={model}
                    providerId={providerId}
                  />
                )}
                {focusStep === "requirement" && requirementChoosePending && (
                  // 「待选择」二选一：导入需求后，用户选生成 md 或直接用原文档。原始文档已保留。
                  <div className="mt-2 rounded-lg border border-border bg-muted/30 p-3">
                    <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-foreground">
                      <FileIcon size={13} className="text-primary" />
                      {t("test.requirement.chooseTitle")}
                      <span className="font-normal text-muted-foreground">· {t("test.requirement.chooseHint")}</span>
                      <span className="flex-1" />
                      {hasRequirementOriginal && (
                        <button
                          onClick={() => openRequirementPreview("original")}
                          disabled={reqPreviewLoading || !current?.path || !activeTask}
                          className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] text-foreground hover:bg-muted disabled:opacity-40"
                        >
                          {reqPreviewLoading ? <SpinnerGap size={11} className="animate-spin" /> : <Eye size={11} />} {t("test.requirement.previewOriginal")}
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={chooseGenerateReqMd}
                        disabled={busy}
                        className="flex flex-col items-start gap-1 rounded-md border-2 border-primary/60 p-2 text-left hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <span className="flex items-center gap-1 text-[11px] font-medium text-foreground">
                          <Sparkle size={12} className="text-primary" /> {t("test.requirement.genMd")}
                        </span>
                        <span className="text-[10px] leading-snug text-muted-foreground">{t("test.requirement.genMdDesc")}</span>
                      </button>
                      <button
                        onClick={chooseUseOriginalReq}
                        disabled={busy}
                        className="flex flex-col items-start gap-1 rounded-md border border-border p-2 text-left hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <span className="flex items-center gap-1 text-[11px] font-medium text-foreground">
                          <FileIcon size={12} /> {t("test.requirement.useOriginal")}
                        </span>
                        <span className="text-[10px] leading-snug text-muted-foreground">{t("test.requirement.useOriginalDesc")}</span>
                      </button>
                    </div>
                  </div>
                )}
                {focusStep === "requirement" && !requirementChoosePending && (
                  <div className="mt-2 flex items-center gap-2">
                    {(stepStatus.requirement === "done" || stepStatus.requirement === "review") &&
                      !(hasRequirementOriginal && aState.requirementMode === "use-original") && (
                        <button
                          onClick={() => openRequirementPreview("md")}
                          disabled={reqPreviewLoading || !current?.path || !activeTask}
                          title={t("test.requirement.previewDoc")}
                          className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[10px] text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {reqPreviewLoading ? <SpinnerGap size={12} className="animate-spin" /> : <Eye size={12} />} {t("test.requirement.previewDoc")}
                        </button>
                      )}
                    {hasRequirementOriginal && (
                      <button
                        onClick={() => openRequirementPreview("original")}
                        disabled={reqPreviewLoading || !current?.path || !activeTask}
                        title={t("test.requirement.previewOriginal")}
                        className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[10px] text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {reqPreviewLoading ? <SpinnerGap size={12} className="animate-spin" /> : <Eye size={12} />} {t("test.requirement.previewOriginal")}
                      </button>
                    )}
                    <span className="text-[11px] text-muted-foreground">{t("test.flow.evidenceNote")}</span>
                  </div>
                )}
                {focusStep === "execution" && (
                  <div className="mt-2 text-[11px] text-muted-foreground">{t("test.flow.evidenceNote")}</div>
                )}
                {/* 需求文档预览弹窗（问题①）：复用报告步 PreviewModal/MdPreview，按需读
                    {task}-需求.md 渲染；独立状态，不影响报告步预览。 */}
                {reqPreview && (
                  <PreviewModal
                    t={t}
                    preview={reqPreview}
                    projectPath={current?.path ?? ""}
                    taskName={activeTask?.name ?? ""}
                    env={env}
                    onClose={() => setReqPreview(null)}
                    onSaved={() => setReqPreview(null)}
                    setEditable={(editable) => setReqPreview((p) => (p && p.kind === "md" ? { ...p, editable } : p))}
                  />
                )}
                {/* docx 原件预览弹窗：DocxViewer 原版式渲染 + 「用系统应用打开」保真兜底。
                    Portal 到 body——避免被带 transform/overflow 的祖先困住（历史教训）。 */}
                {origDocPreview &&
                  createPortal(
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setOrigDocPreview(null)}>
                      <div
                        className="flex h-[82vh] w-[760px] max-w-[94vw] flex-col overflow-hidden rounded-lg border border-border bg-card shadow-xl"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5">
                          <FileIcon size={16} className="shrink-0 text-primary" />
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-medium text-foreground">{t("test.requirement.previewOriginal")}</div>
                            <div className="truncate text-[10px] text-muted-foreground">{origDocPreview.filename}</div>
                          </div>
                          {!!(typeof window !== "undefined" && window.electronAPI?.shell?.openPath) && (
                            <button
                              onClick={openOriginalWithSystem}
                              className="flex shrink-0 items-center gap-1 rounded border border-border px-2 py-1 text-[10px] text-foreground hover:bg-muted"
                              title={t("test.requirement.openWithSystem")}
                            >
                              <Desktop size={12} /> {t("test.requirement.openWithSystem")}
                            </button>
                          )}
                          <button
                            onClick={() => setOrigDocPreview(null)}
                            aria-label={t("common.close")}
                            className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                          >
                            <X size={14} />
                          </button>
                        </div>
                        <div className="flex min-h-0 flex-1 flex-col">
                          <DocxViewer fileServeUrl={`/api/files/raw?path=${encodeURIComponent(origDocPreview.abs)}`} />
                        </div>
                      </div>
                    </div>,
                    document.body
                  )}
              </div>
            </div>
          </div>

          {/* lower: 测试对话 (run stream) */}
          <div className="flex min-h-0 flex-1 flex-col bg-background">
            <div ref={threadRef} className="flex flex-1 flex-col gap-2 overflow-auto p-4">
              {convo.length === 0 && !busy ? (
                <p className="mt-6 text-center text-[11px] text-muted-foreground">{t("test.convo.empty")}</p>
              ) : (
                convo.map((m, i) => <ConvoBubble key={i} msg={m} />)
              )}
              {/* 等待动画：任务运行中 / 等待 AI 响应时，对话末尾显示「正在处理」跳动点，
                  让用户知道系统在处理、不是卡死。busy 结束即消失。 */}
              {busy && (
                <div className="flex items-center gap-2 px-1 py-1">
                  <span className="flex gap-1">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary/60" style={{ animationDelay: "-0.3s" }} />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary/60" style={{ animationDelay: "-0.15s" }} />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary/60" />
                  </span>
                  <span className="text-[10px] text-muted-foreground">{t("test.convo.thinking")}</span>
                </div>
              )}
            </div>
            {/* gate bar: a human-gated step (需求/用例) awaiting approval.
                需求「待选择」时不显示普通「批准」——由节点内二选一卡片代替。 */}
            {reviewStep && !requirementChoosePending && (
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
            {/* AI 通过 @@ACTION 建议重跑某步 → 用户确认才跑（不自动触发，重跑会覆盖产物/耗时） */}
            {pendingAction && (
              <div className="mx-3 mb-2 flex shrink-0 items-center gap-2 rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-[11px] text-foreground">
                <span>💡 {t("test.chat.action.title")}「{t(STEPS.find((s) => s.step === pendingAction.step)!.name)}」{pendingAction.reason ? `：${pendingAction.reason}` : ""}</span>
                <span className="flex-1" />
                <button
                  onClick={() => { const st = pendingAction.step; logAudit("chat-action", { step: st, detail: pendingAction.reason || undefined }); setPendingAction(null); runStepManual(st); }}
                  disabled={busy}
                  className="rounded bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {t("test.chat.action.run")}
                </button>
                <button
                  onClick={() => setPendingAction(null)}
                  className="rounded border border-border px-2 py-1 text-[11px] text-foreground hover:bg-muted"
                >
                  {t("test.chat.action.ignore")}
                </button>
              </div>
            )}
            <div className="shrink-0 border-t border-border bg-card p-3">
              <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 focus-within:border-primary">
                <input
                  value={composer}
                  onChange={(e) => setComposer(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); chatSend(); }
                  }}
                  disabled={busy}
                  placeholder={busy ? t("test.convo.running") : t("test.chat.placeholder")}
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
                  onClick={chatSend}
                  disabled={busy || !composer.trim()}
                  title={t("test.convo.send")}
                  aria-label={t("test.convo.send")}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ArrowUp size={13} />
                </button>
              </div>
              <div className="mt-1 px-1 text-[10px] text-muted-foreground">
                {t("test.chat.hint")}
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
                            setTestType("func");
                            setRegTab("library");
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
                  {/* 测试类型切换(批 H):功能测试=现有任务流;回归测试=整页工作区(库/套件/轮次) */}
                  <div className="ml-1 flex items-center gap-0.5 rounded-lg border border-border bg-muted p-0.5">
                    {([["func", t("test.type.func")], ["regression", t("test.type.regression")]] as const).map(([k, label]) => (
                      <button
                        key={k}
                        onClick={() => setTestType(k)}
                        className={`rounded-md px-3 py-1 text-[11px] transition-colors ${testType === k ? "bg-background font-semibold text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <span className="flex-1" />
                  <button
                    onClick={() => router.push("/settings#test-accounts")}
                    title={current?.path ? `${t("test.envModal.title")}（设置·测试账号；project_root = ${current.path}）` : undefined}
                    className="flex h-7 items-center gap-1 rounded-md border border-border px-2 text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    <Gear size={12} /> {t("test.envModal.title")}
                  </button>
                  {testType === "func" && (
                    <button
                      onClick={() => setModal("newTask")}
                      className="flex h-7 items-center gap-1 rounded-md bg-primary px-2.5 text-[11px] font-medium text-primary-foreground"
                    >
                      ＋ {t("test.newTask")}
                    </button>
                  )}
                </div>
                {/* 回归测试整页工作区(批 H):子页签 + 发起回归 + 状态行 + 页内区块 */}
                {testType === "regression" && current?.path && (
                  <RegressionWorkspace
                    t={t}
                    projectPath={current.path}
                    regTab={regTab}
                    live={libraryLive}
                    model={model}
                    providerId={providerId}
                    setRegTab={setRegTab}
                    reloadSignal={libraryReload}
                    onChanged={() => setLibraryReload((n) => n + 1)}
                    onLaunch={(preset) => setLaunchOpen(preset ?? {})}
                    onStop={stopLibraryRun}
                    running={libraryRunning}
                    runStatus={libraryRunStatus}
                  />
                )}
                {testType === "func" && current.tasks.length > 0 && (
                  <div className="mb-3 flex items-center gap-2">
                    <span className="flex-1" />
                    <label className="flex items-center gap-1 text-[11px] text-muted-foreground" title={t("test.batch.concurrencyHint")}>
                      {t("test.batch.concurrency")}
                      <select
                        value={concurrency}
                        onChange={(e) => persistConcurrency(Number(e.target.value))}
                        className="h-7 rounded-md border border-border bg-background px-1 text-[11px] text-foreground outline-none focus:border-primary"
                      >
                        {[1, 2, 3, 4, 5].map((n) => (
                          <option key={n} value={n}>{n}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}
                {testType !== "func" ? null : current.tasks.length === 0 ? (
                  <EmptyState icon={ListChecks} text={t("test.tasksEmpty")} />
                ) : (() => {
                  // 单张任务卡（抽出闭包以便各分组复用）。i = 任务原始下标（点开进详情 / 删除按 index 操作）。
                  const renderTaskCard = (tk: { id: string; name: string }, i: number) => {
                    const st = taskStates[tk.id] ?? DEFAULT_TASK_STATE;
                    const chip = taskChip(st, t);
                    const inWait = waitingTaskIds.has(tk.id);
                    const qpos = inWait ? waitingQueueRef.current.indexOf(tk.id) + 1 : 0;
                    const badge = inWait
                      ? { text: t("test.batch.queuePos", { n: qpos }), cls: "bg-status-warning-muted text-status-warning-foreground" }
                      : chip;
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
                            {/* 标签放标题行（taskName 旁），不占右列额外一行 —— 导入用例卡片才显示，避免撑高同行卡片 */}
                            <div className="flex min-w-0 items-center gap-1.5 pt-0.5">
                              <span className="truncate text-sm font-medium text-foreground">{tk.name}</span>
                              {st.imported?.cases && <span className="shrink-0 rounded-full bg-primary/15 px-1.5 py-0.5 text-[9px] font-medium text-primary">{t("test.task.importedTag")}</span>}
                            </div>
                            <div className="flex shrink-0 flex-col items-end gap-0.5">
                              <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${badge.cls}`}>{badge.text}</span>
                              <span className="text-[10px] text-muted-foreground">{taskStageName(st, t)}</span>
                            </div>
                          </div>
                          <div className="flex items-start">
                            {STEPS.filter((s) => !(st.imported?.cases && s.step === "requirement")).map((s, idx, arr) => (
                              <div key={s.step} className="flex flex-1 flex-col items-center">
                                {/* dot with connector lines on both sides (ends are hidden) */}
                                <div className="flex w-full items-center">
                                  <span className={`h-px flex-1 ${idx === 0 ? "opacity-0" : "bg-border"}`} />
                                  <span className={`mx-1 h-2 w-2 shrink-0 rounded-full ${stepDotClass(st.stepStatus[s.step])}`} />
                                  <span className={`h-px flex-1 ${idx === arr.length - 1 ? "opacity-0" : "bg-border"}`} />
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
                  };
                  // 每个任务落入唯一分类（运行中 > 排队中 > 已完成 > 待处理），保留原始下标。
                  const groups: Record<TaskCategory, { tk: { id: string; name: string }; i: number }[]> =
                    { running: [], queued: [], pending: [], done: [] };
                  current.tasks.forEach((tk, i) => {
                    const st = taskStates[tk.id] ?? DEFAULT_TASK_STATE;
                    const c = taskCategory(st.stepStatus, STEP_ORDER, runningTaskIds.has(tk.id), waitingTaskIds.has(tk.id));
                    groups[c].push({ tk, i });
                  });
                  // 排队中按队列序号升序；其余保持任务原序（状态变化时不跳动）。
                  groups.queued.sort((a, b) => waitingQueueRef.current.indexOf(a.tk.id) - waitingQueueRef.current.indexOf(b.tk.id));
                  const CAT_META: Record<TaskCategory, { dot: string; text: string; label: TranslationKey }> = {
                    running: { dot: "bg-status-info", text: "text-status-info", label: "test.batch.cat.running" },
                    queued: { dot: "bg-status-warning", text: "text-status-warning", label: "test.batch.cat.queued" },
                    pending: { dot: "bg-muted-foreground/50", text: "text-muted-foreground", label: "test.batch.cat.pending" },
                    done: { dot: "bg-status-success", text: "text-status-success", label: "test.batch.cat.done" },
                  };
                  return (
                    <>
                      {/* 顶部概览 chip：始终显示 4 类计数；点击滚动到对应分组并展开 */}
                      <div className="mb-3 flex flex-wrap gap-1.5">
                        {TASK_CATEGORY_ORDER.map((c) => (
                          <button
                            key={c}
                            onClick={() => {
                              if (collapsedCats.has(c)) toggleCat(c);
                              document.getElementById(`taskcat-${c}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
                            }}
                            className={`flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[11px] ${CAT_META[c].text} hover:bg-muted/50`}
                          >
                            <span className={`h-1.5 w-1.5 rounded-full ${CAT_META[c].dot}`} />
                            {t(CAT_META[c].label)} {groups[c].length}
                          </button>
                        ))}
                      </div>
                      {/* 按 运行中 → 排队中 → 待处理 → 已完成 分组堆叠；空组不渲染 */}
                      {TASK_CATEGORY_ORDER.map((c) => {
                        const items = groups[c];
                        if (items.length === 0) return null;
                        const collapsed = collapsedCats.has(c);
                        return (
                          <div key={c} id={`taskcat-${c}`} className="mb-4 scroll-mt-2">
                            <button
                              onClick={() => toggleCat(c)}
                              className="mb-2 flex w-full items-center gap-2 text-left"
                            >
                              <CaretDown size={13} className={`text-muted-foreground transition-transform ${collapsed ? "-rotate-90" : ""}`} />
                              <span className={`h-2 w-2 rounded-full ${CAT_META[c].dot}`} />
                              <span className="text-[13px] font-medium text-foreground">{t(CAT_META[c].label)}</span>
                              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{items.length}</span>
                            </button>
                            {!collapsed && (
                              <div className="grid grid-cols-2 gap-2">
                                {items.map(({ tk, i }) => renderTaskCard(tk, i))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </>
                  );
                })()}
              </div>
            )}

            {view === "flow" && !activeTask && <EmptyState icon={ListChecks} text={t("test.flowEmpty")} />}
            {view === "report" && (
              <ReportBrowser
                projects={projects}
                t={t}
                model={model}
                providerId={providerId}
                onOpenTask={(pIdx, tIdx) => { setSelected(pIdx); setSelectedTask(tIdx); setView("flow"); }}
                reloadSignal={reportsReload}
              />
            )}
            {view === "stats" && <TestStatsView t={t} projectPath={current?.path ?? ""} />}
          </div>
        </div>
      )}

      {/* Modals + folder picker (browser fallback for project selection) */}
      {/* 操作记录弹窗(审计查看端):当前任务的门控批准/运行/修订等全部留痕。 */}
      {auditOpen && current?.path && activeTask && (
        <AuditModal t={t} projectPath={current.path} taskName={activeTask.name} onClose={() => setAuditOpen(false)} />
      )}
      {launchOpen && current?.path && (
        <StartRegressionModal
          t={t}
          projectPath={current.path}
          initialMode={launchOpen.mode}
          initialParentRoundId={launchOpen.parentRoundId}
          onClose={() => setLaunchOpen(null)}
          onStart={(opts) => { setLaunchOpen(null); void runLibrary(opts); }}
        />
      )}
      {recommendOpen && current?.path && activeTask && (
        <RecommendReviewModal
          t={t}
          projectPath={current.path}
          taskName={activeTask.name}
          cases={casesPreview}
          model={model}
          providerId={providerId}
          onClose={() => setRecommendOpen(false)}
          onApplied={() => {
            // 应用后刷新用例展示 + 库同步信号(apply 接口已 deposit,这里只 bump UI)。
            fetch(`/api/test/cases?projectPath=${encodeURIComponent(current.path!)}&taskName=${encodeURIComponent(activeTask.name)}`)
              .then((r) => r.json())
              .then((d) => { if (Array.isArray(d?.cases)) setCasesPreview(d.cases as GeneratedCase[]); })
              .catch(() => {});
            setLibraryReload((n) => n + 1);
            setRecommendOpen(false);
          }}
        />
      )}
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
      {modal === "newTask" && (
        <NewTaskModal
          t={t}
          onClose={() => setModal("none")}
          onAdd={addTask}
          existingNames={(selected !== null ? projects[selected]?.tasks : undefined)?.map((tk) => tk.name) ?? []}
        />
      )}
      {modal === "runStart" && activeTask && (
        <RunStartModal
          t={t}
          stepStatus={aState.stepStatus}
          initialDeposit={(activeTask && taskStates[activeTask.id]?.depositScripts) !== false}
          onRun={(step, depositScripts) => {
            setModal("none");
            // 弹窗里改的开关写回任务状态(缺省 true → 开启存 undefined、关闭存 false),
            // 与徽标/执行前弹窗同一份设置,不做一次性覆盖 —— 否则三处入口会互相打架。
            if (aId) patchTask(aId, () => ({ depositScripts: depositScripts ? undefined : false }));
            startRunAllFrom(step);
          }}
          onClose={() => setModal("none")}
        />
      )}
      {modal === "execConfirm" && activeTask && (
        <ExecConfirmModal
          t={t}
          initialUrl={taskStates[activeTask.id]?.targetUrl || envCfg?.frontendBaseUrl || ""}
          unconfigured={!!envCfg && !envCfg.configured}
          initialMode={execMode}
          initialDeposit={(activeTask && taskStates[activeTask.id]?.depositScripts) !== false}
          onRun={runExecutionConfirmed}
          onClose={() => setModal("none")}
        />
      )}
      {modal === "envWarn" && activeTask && (
        <EnvWarnModal
          t={t}
          source={envCfg?.source}
          env={env}
          onGoConfigure={() => { setModal("none"); router.push("/settings#test-accounts"); }}
          onRunAnyway={() => { setModal("none"); doRunTask(); }}
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
// 回归集（发版红线）横幅：全过→绿；有 fail/partial/blocked（含漏跑补的 blocked）→红
// 「不可发版」。无 suiteCounts（旧报告 / 用例无「回归测试」标签）→ 不渲染。
// suite = tags 口径（§1.7），与回归基线（verification/oracle 口径）无关。
function SuiteBanner({ t, suiteCounts, suitePassStr }: { t: T; suiteCounts?: FourState; suitePassStr?: string }) {
  if (!suiteCounts || !suiteCounts.total) return null;
  const allPass = suiteCounts.pass === suiteCounts.total;
  const s = suitePassStr || `${suiteCounts.pass}/${suiteCounts.total}`;
  return allPass ? (
    <div className="rounded-md border border-status-success-border bg-status-success-muted px-3 py-2 text-[11px] text-status-success-foreground">
      ✓ {t("test.report.suitePass", { s })}
    </div>
  ) : (
    <div className="rounded-md border border-status-error-border bg-status-error-muted px-3 py-2 text-[11px] font-medium text-status-error-foreground">
      ⚠ {t("test.report.suiteFail", { s })}
    </div>
  );
}

// 使用统计（Phase 3）：taskId + runHash 就位时，执行矩阵每行加人工复核（✓准确/✗有误→选
// 实际结果，误报/漏报/程度不符由服务端归类）+ 用时列 + 一键全准；打开时回显已复核状态。
// 合并 V3.1.0_dev：保留回归集 SuiteBanner 的 suiteCounts/suitePassStr 属性。
function ReportView({ t, results, four, funcCounts, funcPassStr, suiteCounts, suitePassStr, circuitBroken, taskName, projectPath, env, taskId, runHash }: { t: T; results: CaseResult[]; four: FourState; funcCounts?: FourState; funcPassStr?: string; suiteCounts?: FourState; suitePassStr?: string; circuitBroken?: boolean; taskName: string; projectPath?: string; env?: string; taskId?: string; runHash?: string }) {
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

  // 人工复核：caseId → verdict（accurate/false_fail/missed_fail/severity_mismatch）。
  // 仅当 taskId + runHash 就位（报告浏览器场景）才开放复核；流程内联预览无这两者时只读。
  const canReview = !!taskId && !!runHash;
  const [reviews, setReviews] = useState<Record<string, string>>({});
  const [badFor, setBadFor] = useState<string | null>(null); // 正在选「实际结果」的 caseId
  useEffect(() => {
    if (!canReview) return;
    let cancelled = false;
    fetch(`/api/test/stats?scope=reviews&taskId=${encodeURIComponent(taskId!)}&runHash=${encodeURIComponent(runHash!)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled && d?.data?.byCaseId) setReviews(d.data.byCaseId as Record<string, string>); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [canReview, taskId, runHash]);

  const postReview = (events: Array<Record<string, unknown>>) => {
    if (!taskId || !projectPath) return;
    recordTestStat(events.map((p) => ({ eventType: p.eventType as string, projectPath, taskId, taskName, env, payload: p.payload as Record<string, unknown> })));
  };
  const markAccurate = (caseId: string) => {
    setReviews((m) => ({ ...m, [caseId]: "accurate" }));
    postReview([{ eventType: "report_reviewed", payload: { caseId, verdict: "accurate", runHash } }]);
  };
  const markBad = (caseId: string, aiStatus: string, actual: "ok" | "broken" | "severity") => {
    // verdict 由服务端按 aiStatus + actual 归类（enrichReviewed）；本地先乐观按同规则显示。
    const verdict = actual === "severity" ? "severity_mismatch" : actual === "ok" ? (aiStatus === "pass" ? "accurate" : "false_fail") : (aiStatus === "fail" || aiStatus === "blocked" ? "accurate" : "missed_fail");
    setReviews((m) => ({ ...m, [caseId]: verdict }));
    setBadFor(null);
    postReview([{ eventType: "report_reviewed", payload: { caseId, aiStatus, actual, runHash } }]);
  };
  const undoReview = (caseId: string) => {
    setReviews((m) => { const n = { ...m }; delete n[caseId]; return n; });
    // 撤销必须落库（否则重开报告会从 DB 回显、且仍计入准确度分母 —— 评审 M2）。
    // 用 verdict:'cleared' 哨兵，聚合层与回显按 last-wins 移除该条。
    postReview([{ eventType: "report_reviewed", payload: { caseId, verdict: "cleared", runHash } }]);
  };
  const bulkAccurate = () => {
    const rest = results.map((r) => r.id).filter((id) => !reviews[id]);
    if (!rest.length) return;
    setReviews((m) => { const n = { ...m }; rest.forEach((id) => { n[id] = "accurate"; }); return n; });
    postReview([{ eventType: "report_review_bulk", payload: { caseIds: rest, count: rest.length, runHash } }]);
  };
  const reviewedCount = results.filter((r) => reviews[r.id]).length;
  const verdictLabel: Record<string, TranslationKey> = {
    accurate: "test.review.accurate", false_fail: "test.review.falseFail", missed_fail: "test.review.missedFail", severity_mismatch: "test.review.severityMismatch",
  };

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
      <div className="mb-3 empty:hidden">
        <SuiteBanner t={t} suiteCounts={suiteCounts} suitePassStr={suitePassStr} />
      </div>
      <div className="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
        {metric(t("test.report.funcRate"), funcRateStr)}
        {metric(t("test.report.caseCount"), String(total))}
        {metric(t("test.report.execRate"), `${execRate}%`)}
        {metric(t("test.report.defects"), String(four.fail), four.fail > 0)}
      </div>
      {/* 使用统计：人工复核工具条（仅报告浏览器场景，taskId+runHash 就位）。circuitBroken
          轮结果不可信，复核无意义 → 不开放。 */}
      {canReview && !circuitBroken && (
        <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <span>{t("test.review.progress")}：<b className="text-foreground">{reviewedCount}</b>/{results.length}</span>
          <span className="flex-1" />
          <button
            onClick={bulkAccurate}
            disabled={reviewedCount >= results.length}
            className="rounded-md border border-border px-2 py-1 text-[11px] text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t("test.review.bulkAccurate")}
          </button>
        </div>
      )}
      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full border-collapse text-[11px]">
          <thead>
            <tr className="bg-muted/50 text-left text-muted-foreground">
              <th className="px-2 py-1.5 font-medium">{t("test.report.colId")}</th>
              <th className="px-2 py-1.5 font-medium">{t("test.report.colActual")}</th>
              <th className="px-2 py-1.5 font-medium">{t("test.report.colStatus")}</th>
              <th className="whitespace-nowrap px-2 py-1.5 font-medium">{t("test.report.colDuration")}</th>
              <th className="px-2 py-1.5 font-medium">{t("test.report.colEvidence")}</th>
              <th className="px-2 py-1.5 font-medium">{t("test.report.colReason")}</th>
              {canReview && !circuitBroken && <th className="whitespace-nowrap px-2 py-1.5 font-medium">{t("test.report.colReview")}</th>}
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
                <td className="whitespace-nowrap px-2 py-1.5 font-mono text-muted-foreground">{typeof r.durationMs === "number" ? fmtDuration(r.durationMs) : "—"}</td>
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
                {canReview && !circuitBroken && (
                  <td className="whitespace-nowrap px-2 py-1.5">
                    {reviews[r.id] ? (
                      <span className="flex items-center gap-1.5">
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${reviews[r.id] === "accurate" ? "bg-status-success-muted text-status-success-foreground" : "bg-status-error-muted text-status-error-foreground"}`}>
                          {reviews[r.id] === "accurate" ? "✓ " : "✗ "}{verdictLabel[reviews[r.id]] ? t(verdictLabel[reviews[r.id]]) : reviews[r.id]}
                        </span>
                        <button onClick={() => undoReview(r.id)} className="text-[10px] text-muted-foreground underline hover:text-foreground">{t("test.review.undo")}</button>
                      </span>
                    ) : badFor === r.id ? (
                      <span className="flex flex-col gap-1">
                        <span className="text-[10px] text-muted-foreground">{t("test.review.actualPrompt")}</span>
                        <span className="flex flex-wrap gap-1">
                          <button onClick={() => markBad(r.id, r.status, "ok")} className="rounded border border-border px-1.5 py-0.5 text-[10px] hover:bg-muted">{t("test.review.actualOk")}</button>
                          <button onClick={() => markBad(r.id, r.status, "broken")} className="rounded border border-border px-1.5 py-0.5 text-[10px] hover:bg-muted">{t("test.review.actualBroken")}</button>
                          <button onClick={() => markBad(r.id, r.status, "severity")} className="rounded border border-border px-1.5 py-0.5 text-[10px] hover:bg-muted">{t("test.review.actualSeverity")}</button>
                          <button onClick={() => setBadFor(null)} className="px-1 text-[10px] text-muted-foreground hover:text-foreground">{t("common.cancel")}</button>
                        </span>
                      </span>
                    ) : (
                      <span className="flex gap-1">
                        <button onClick={() => markAccurate(r.id)} title={t("test.review.accurate")} className="rounded border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:border-status-success-border hover:text-status-success-foreground">✓ {t("test.review.ok")}</button>
                        <button onClick={() => setBadFor(r.id)} title={t("test.review.markBad")} className="rounded border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:border-status-error-border hover:text-status-error-foreground">✗ {t("test.review.bad")}</button>
                      </span>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">ℹ️ {t("test.report.factsNote")}</p>
      {/* lightbox 用 Portal 渲染到 body —— 这个 ReportView 挂在「报告」顶部 tab 的报告行
          手风琴展开区里，其祖先是 overflow-hidden rounded-lg（accordion 行容器）；<video>
          嵌套在 overflow-hidden + 圆角祖先内会硬件合成黑屏（录像已加载、控件/时长都在，
          画面是黑的——与 XlsxPreview 此前同一根因，那边已用 Portal 修过，这里当时漏了、
          没有实测覆盖到）。用户报「报告 tab 中的录像播放不了」命中的正是这条路径。 */}
      {lightbox && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6" onClick={() => setLightbox(null)}>
          {isVid(lightbox) ? (
            <video src={mediaUrl(lightbox)} controls autoPlay muted playsInline preload="metadata" className="max-h-full max-w-full" onClick={(e) => e.stopPropagation()} />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={mediaUrl(lightbox)} alt={lightbox} className="max-h-full max-w-full object-contain" onClick={(e) => e.stopPropagation()} />
          )}
        </div>,
        document.body,
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

// 产物预览的目标：md（测试报告/缺陷报告，预览/编辑切换）或 xlsx（执行矩阵只读表格）。
type PreviewState =
  | { kind: "md"; titleKey: TranslationKey; rel: string; content: string; editable: boolean }
  | { kind: "xlsx" }
  | { kind: "scripts"; manifest: ScriptManifestView };

// 报告步「就地展示」面板（替换报告节点的占位符）。报告步 done 时拉 GET /api/test/reports
// 取当前 task+env 的 ReportEntry，展示：概览条（复用 funcPassRateStr 口径）+ 产出资料列表
// （测试报告.md / Excel / 缺陷报告.md，可「点开修改」或预览）+ 内嵌报告全文（ReactMarkdown）。
// 失败态给提示、不渲染空报告。指标在 entry 到达前回退实时执行 tally，避免空白。
function ReportStepPanel({
  t, projectPath, taskName, env, reportStatus, live, model, providerId,
}: {
  t: T;
  projectPath: string;
  taskName: string;
  env: string;
  reportStatus: StepStatus;
  live: { caseResults: CaseResult[]; fourState: FourState; circuitBroken: boolean };
  model: string;
  providerId: string;
}) {
  const router = useRouter();
  const [entry, setEntry] = useState<ReportEntry | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [defectBusy, setDefectBusy] = useState(false);
  const [handoffBusy, setHandoffBusy] = useState(false);
  const [scriptBusy, setScriptBusy] = useState(false);
  const [scriptManifest, setScriptManifest] = useState<ScriptManifestView | null>(null);
  const [scriptReloadTick, setScriptReloadTick] = useState(0);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  // 缺陷报告随执行更新：自动缺陷生成守卫按【本次执行时间】记忆——同一份 run 只自动生成一次
  // (防 effect 重复触发)，但【重新执行任务 = 新 run.json(新 time)】时允许再生成一次。配合
  // run route 写新 run.json 时删旧缺陷报告，实现「重跑后缺陷报告随之更新：全通过→无缺陷报告、
  // 仍有 fail→重新生成」(修用户反馈:重跑全通过后仍显示上次缺陷报告)。key 用 e.time(reports
  // 返回的 run.json time)。
  const autoDefectForTimeRef = useRef<string>("");

  useEffect(() => {
    if (reportStatus !== "done" || !projectPath) { setEntry(null); return; }
    let cancelled = false;
    fetch(`/api/test/reports?projectPath=${encodeURIComponent(projectPath)}`)
      .then((r) => (r.ok ? r.json() : { reports: [] }))
      .then((d) => {
        if (cancelled) return;
        const list = (d.reports ?? []) as ReportEntry[];
        const e = list.find((x) => x.task === taskName && x.env === env) ?? null;
        setEntry(e);
        // 问题4：执行有缺陷(fail>0)且尚未生成缺陷报告 → 自动生成一次（用户无需手点）。
        if (e && (e.counts?.fail ?? 0) > 0 && !e.defectMarkdown && autoDefectForTimeRef.current !== e.time) {
          autoDefectForTimeRef.current = e.time;
          void defectGen();
        }
      })
      .catch(() => { if (!cancelled) setEntry(null); });
    return () => { cancelled = true; };
    // defectGen 闭包仅用 props/setter、稳定；有意不入 deps 以免重建 effect。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportStatus, projectPath, taskName, env, reloadTick]);

  // 脚本生成是报告成功后的后台任务，不占用流程节点。manifest 为持久化真相；queued/running
  // 时短轮询，终态后停止。旧报告没有 manifest 时显示“尚未生成”，允许用户手动补触发。
  useEffect(() => {
    if (reportStatus !== "done" || !projectPath) { setScriptManifest(null); return; }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const query = new URLSearchParams({ projectPath, taskName, env });
        const res = await fetch(`/api/test/scripts?${query.toString()}`);
        const data = res.ok ? await res.json() : { manifest: null };
        if (cancelled) return;
        const manifest = (data.manifest ?? null) as ScriptManifestView | null;
        setScriptManifest(manifest);
        if (manifest && (manifest.jobStatus === "queued" || manifest.jobStatus === "running")) {
          timer = setTimeout(load, 2_000);
        }
      } catch {
        if (!cancelled) setScriptManifest(null);
      }
    };
    void load();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [reportStatus, projectPath, taskName, env, scriptReloadTick]);

  // 失败态：报告步执行失败 → 提示重跑，不渲染空报告。
  if (reportStatus === "error") {
    return (
      <div className="mt-3 rounded-lg border border-status-error-border bg-status-error-muted/40 p-3 text-[11px] text-status-error-foreground">
        {t("test.report.stepFailed")}
      </div>
    );
  }
  // 非 done（idle/running/review）→ 维持「详细执行过程见下方对话」提示。
  if (reportStatus !== "done") {
    return <div className="mt-2 text-[11px] text-muted-foreground">{t("test.flow.evidenceNote")}</div>;
  }

  // 指标优先持久化 entry，pre-fetch 时回退实时执行 tally。
  const counts = entry?.counts ?? live.fourState;
  const total = counts.total || live.caseResults.length;
  const execRate = total ? Math.round((counts.pass / total) * 100) : 0;
  const funcRateStr = funcPassRateStr({ total, pass: counts.pass, blocked: counts.blocked }, entry?.funcCounts, entry?.funcPassStr);
  const fail = counts.fail ?? 0;

  // 产物相对路径（与 reports/route.ts、artifactPaths 命名一致）。
  const reportMdRel = `AI_LabTest/report/${taskName}/${taskName}-${env}.md`;
  const defectMdRel = `AI_LabTest/report/${taskName}/${taskName}-${env}-缺陷报告.md`;

  // 生成缺陷报告（第三交付物）：调 /api/test/defect 跑完后 reload 拿到新写的 defectMarkdown。
  const defectGen = async () => {
    setDefectBusy(true);
    try {
      const res = await fetch("/api/test/defect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectPath, taskName, env, model: model || undefined, providerId: providerId || undefined }),
      });
      if (res.body) { const reader = res.body.getReader(); for (;;) { const { done } = await reader.read(); if (done) break; } }
      setReloadTick((n) => n + 1);
    } catch { /* leave as-is */ } finally { setDefectBusy(false); }
  };

  // 交给研发修复：建项目内对话会话，把缺陷摘要写入 composer 草稿，跳转让用户审阅后发送。
  const handoff = async () => {
    const failed = (entry?.tests ?? []).filter((c) => String(c.status).toLowerCase() === "fail");
    const lines = failed.map((c) => `- ${c.id}：${c.actual || c.error || "（详见缺陷报告）"}`).join("\n");
    // 修复依据改用「缺陷报告」（不再给测试报告）：已生成 → 内嵌缺陷报告 md 全文 + 路径；
    // 未生成 → 回退失败用例清单（用户可在报告页先生成缺陷报告再交接）。
    const body = entry?.defectMarkdown
      ? [`缺陷报告：${defectMdRel}`, "", "===== 缺陷报告（md 全文）=====", entry.defectMarkdown, "===== 缺陷报告结束 ====="]
      : ["失败用例（疑似应用缺陷）：", lines || "（详见缺陷报告）"];
    const readHint = entry?.defectMarkdown ? "请先 Read 上面的缺陷报告和相关源码" : "请先结合上面的失败用例与相关源码";
    const msg = [
      "请修复测试发现的缺陷。", "",
      `项目路径：${projectPath}`,
      `测试任务：${taskName} · 环境：${env}`,
      `结果：用例 ${counts.total}，通过 ${counts.pass}，失败 ${counts.fail}${counts.blocked ? `，阻塞 ${counts.blocked}` : ""}`,
      "",
      ...body,
      "",
      `${readHint}，定位每个失败用例的根因并修复；改完简述每处改动。阻塞类（环境问题）不在本次修复范围。`,
    ].join("\n");
    setHandoffBusy(true);
    try {
      const res = await fetch("/api/chat/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ working_directory: projectPath, model: model || undefined, provider_id: providerId || undefined }),
      });
      const data = await res.json();
      const id = data?.session?.id as string | undefined;
      if (!id) throw new Error("no session");
      try { sessionStorage.setItem(`codepilot:draft:${id}`, msg); } catch { /* quota */ }
      router.push(`/chat/${id}`);
    } catch { setHandoffBusy(false); }
  };

  // 重试缺口 = 重新生成没有脚本/生成失败的用例。生成完接着自动跑通（runPipeline），
  // 测试人员不必再点一次——单条精修（重试/运行/修复）在脚本弹框里。
  const retryScripts = async (caseIds?: string[]) => {
    setScriptBusy(true);
    try {
      const res = await fetch("/api/test/scripts/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectPath, taskName, env, caseIds, model: model || undefined, providerId: providerId || undefined, runPipeline: true }),
      });
      if (!res.ok) throw new Error("retry failed");
      setScriptReloadTick((n) => n + 1);
    } catch {
      showToast({ type: "error", message: t("test.scripts.error") });
    } finally {
      setScriptBusy(false);
    }
  };

  // 自动跑通：一键触发「运行→失败自动修→再跑」流水线，直至全部可修复脚本通过。
  // 断言如实失败/环境阻塞的用例被诚实标出，不 force-pass。同步接口，分钟级返回。
  const runPipeline = async () => {
    setScriptBusy(true);
    try {
      const res = await fetch("/api/test/scripts/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectPath, taskName, env, model: model || undefined, providerId: providerId || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "pipeline failed");
      if (data.manifest) setScriptManifest(data.manifest as ScriptManifestView);
      const s = data.summary as { passed?: string[]; needsHuman?: string[]; environmentBlocked?: string[]; stillFailing?: string[] } | undefined;
      showToast({
        type: data.ok ? "success" : "warning",
        message: t("test.scripts.pipelineResult", {
          passed: s?.passed?.length ?? 0,
          human: s?.needsHuman?.length ?? 0,
          blocked: s?.environmentBlocked?.length ?? 0,
          failing: s?.stillFailing?.length ?? 0,
        }),
      });
    } catch (error) {
      showToast({ type: "error", message: error instanceof Error ? error.message : t("test.scripts.error") });
    } finally {
      setScriptBusy(false);
      setScriptReloadTick((n) => n + 1);
    }
  };

  const metric = (label: string, value: string, danger?: boolean) => (
    <div className="rounded-lg bg-muted/40 p-2.5">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold ${danger ? "text-status-error-foreground" : "text-foreground"}`}>{value}</div>
    </div>
  );

  // 产出资料卡片（报告、矩阵、缺陷、回归脚本）——主/次按钮样式常量。
  const btnPrimary = "inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50";
  const btnGhost = "inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-[11px] text-foreground hover:bg-muted disabled:opacity-50";

  // 状态徽章：ok=绿(通过/无缺陷) · err=红(未通过/缺陷计数) · mut=灰(用例计数)。
  const chip = (text: string, tone: "ok" | "err" | "mut") => (
    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${
      tone === "ok" ? "border-status-success-border bg-status-success-muted text-status-success-foreground"
        : tone === "err" ? "border-status-error-border bg-status-error-muted text-status-error-foreground"
        : "border-border bg-muted text-muted-foreground"
    }`}>{text}</span>
  );

  // 一张等大产出卡：图标块 + 名称/文件 + 信息区（flex-1 撑满使三卡等高）+ 动作区。
  const deliverableCard = (
    tile: ReactNode, name: ReactNode, file: string, info: ReactNode, actions: ReactNode,
    variant?: "dim" | "alert",
  ) => (
    <div className={`flex min-w-0 flex-col gap-2 rounded-lg border p-3 transition ${
      variant === "alert" ? "border-status-error-border bg-status-error-muted/40"
        : variant === "dim" ? "border-border bg-muted/30"
        : "border-border bg-background hover:border-primary/40"
    }`}>
      <div className="flex min-w-0 items-center gap-2.5">
        {tile}
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-foreground">{name}</div>
          <div className="truncate font-mono text-[10px] text-muted-foreground">{file}</div>
        </div>
      </div>
      <div className={`min-h-0 flex-1 rounded-lg px-3 py-2 text-[11px] leading-relaxed ${
        variant === "dim" ? "border border-dashed border-border text-muted-foreground"
          : "border border-muted bg-muted/40 text-foreground/80"
      }`}>{info}</div>
      {actions && <div className="flex flex-wrap gap-1.5">{actions}</div>}
    </div>
  );

  // 图标色块（区分文件类型：蓝=报告 · 绿=Excel · 红=缺陷）。
  const tileDoc = <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><FileIcon size={18} /></span>;
  const tileXls = <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-status-success-muted text-status-success"><FileArrowDown size={18} /></span>;
  const tileBug = (dim?: boolean) => <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${dim ? "bg-muted text-muted-foreground" : "bg-status-error-muted text-status-error"}`}><WarningCircle size={18} /></span>;
  const tileScript = <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-status-info-muted text-status-info-foreground"><Terminal size={18} /></span>;

  // 缺陷卡「导出」：md 已在内存（entry.defectMarkdown），客户端直接下载 .md 原文件。
  const downloadMd = (filename: string, content: string) => {
    const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // 缺陷卡信息区：取缺陷 md 的首个标题作摘要（报告 md 无固定结论行，故只对缺陷做提取）。
  const firstDefectTitle = (md: string): string => {
    const lines = md.split("\n").map((l) => l.trim());
    const h2 = lines.find((l) => /^##\s+/.test(l));
    const anyH = lines.find((l) => /^#{1,6}\s+/.test(l));
    const line = h2 ?? anyH ?? lines.find((l) => l.length > 0) ?? "";
    return line.replace(/^#{1,6}\s+/, "").trim();
  };

  // 结论徽章 + 摘要（按权威指标派生，稳健：报告 md 概要是四态表格、无固定结论句可提取）。
  const passed = fail === 0;
  const summaryText = passed
    ? t("test.report.summaryPass", { func: funcRateStr, exec: execRate })
    : t("test.report.summaryFail", { func: funcRateStr, fail });
  const scriptJobLabel: Record<ScriptJobStatusView, TranslationKey> = {
    queued: "test.scripts.queued", running: "test.scripts.running", done: "test.scripts.done",
    // job 级 stale = 该生成任务被更新的任务取代(superseded),与用例级 stale(本轮未测)
    // 不同义 —— 两者曾复用同一文案 key,改名后会把「已被新任务取代」显示成「本轮未测」。
    partial: "test.scripts.partial", error: "test.scripts.error", stale: "test.scripts.jobStale",
  };
  // 全卡片一律只看【本轮】用例(排除 status='stale' 的历史用例集残留):它们不在本轮范围内,
  // 既不该被「自动跑通」拉去跑,其陈年 lastRunError 也不该在卡片上报红。
  const scriptCurrentCases = scriptManifest?.cases.filter((item) => item.status !== "stale") ?? [];
  const scriptRunnable = scriptCurrentCases.filter((item) => item.status === "verified" || item.status === "needs_review" || item.status === "outdated");
  // 「重试缺口」只管【生成】缺口：没 manifest（旧报告）、整个 job 挂了/过期、或有用例
  // 生成失败（failed/outdated）。刻意不含 jobStatus==='partial'——流水线后运行失败也会
  // 置 partial，但那不是生成缺口，重试(重新生成)解决不了，会误导用户空点。
  const scriptHasGaps = !scriptManifest
    || scriptManifest.jobStatus === "error"
    || scriptManifest.jobStatus === "stale"
    || scriptCurrentCases.some((item) => item.status === "failed" || item.status === "outdated");
  const scriptWorking = scriptManifest?.jobStatus === "queued" || scriptManifest?.jobStatus === "running";
  // 错误/进行中优先于空态：任务中途失败时 counts 仍是初始零值，
  // 按 eligible===0 渲染会误报「本轮没有符合条件的用例」。
  const scriptInfo = !scriptManifest
    ? t("test.scripts.notGenerated")
    : scriptManifest.jobStatus === "error"
      ? (scriptManifest.error?.slice(0, 200) || t("test.scripts.error"))
      : scriptWorking && scriptManifest.counts.eligible === 0
        ? t("test.scripts.busy")
        : scriptManifest.counts.eligible === 0
          ? t("test.scripts.empty")
          : t("test.scripts.summary", {
            generated: scriptManifest.counts.generated,
            eligible: scriptManifest.counts.eligible,
            verified: scriptManifest.counts.verified,
            review: scriptManifest.counts.needsReview,
          });
  // 运行失败不改 case.status，counts 也不变 —— 不显式渲染出来，点「运行全部」后卡片
  // 与点击前逐字节相同，用户只会看到一个转瞬即逝的 toast（"点了没反应"）。
  // 化石隔离：stale 条目的 lastRunError 是历史（用例已移出本轮回归集合），不算「当前失败」
  // —— 否则本轮全绿仍挂红字（与 script-job-manager 的 isCurrentRoundCase 同口径）。
  const scriptRunFailures = scriptCurrentCases.filter((item) => item.lastRunError);
  const scriptRunFailureText = scriptRunFailures.length > 0
    ? t("test.scripts.runFailed", { n: scriptRunFailures.length, reason: scriptRunFailures[0].lastRunError!.slice(0, 160) })
    : "";

  return (
    <div className="mt-2 space-y-3">
      {entry?.circuitBroken && (
        <div className="rounded-md border border-status-error-border bg-status-error-muted px-2.5 py-1.5 text-[11px] text-status-error-foreground">
          ⚠ {t("test.report.circuitBroken")}
        </div>
      )}
      <SuiteBanner t={t} suiteCounts={entry?.suiteCounts} suitePassStr={entry?.suitePassStr} />

      {/* 概览条 */}
      <div className="flex items-stretch gap-2">
        <div className="grid flex-1 grid-cols-4 gap-2">
          {metric(t("test.report.funcRate"), funcRateStr)}
          {metric(t("test.report.execRate"), `${execRate}%`)}
          {metric(t("test.report.defects"), String(fail), fail > 0)}
          {metric(t("test.report.caseCount"), String(total))}
        </div>
        {fail > 0 && (
          <button
            onClick={handoff}
            disabled={handoffBusy}
            className="flex shrink-0 items-center gap-1 self-center rounded-md bg-primary px-2.5 py-1.5 text-[11px] font-medium text-primary-foreground disabled:opacity-50"
          >
            <Wrench size={12} /> {t("test.report.handoff")}（{fail}）
          </button>
        )}
      </div>

      {/* 产出资料：报告完成后展示四类产物；脚本是后台副产物，不进入流程节点。 */}
      <div>
        <div className="mb-1.5 flex items-center gap-1.5">
          <FolderPlus size={13} className="text-muted-foreground" />
          <span className="text-[11px] font-medium text-foreground">{t("test.report.deliverables")}</span>
          <span className="text-[10px] text-muted-foreground">{t("test.report.deliverablesHint")}</span>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-4">
          {/* 卡1：测试结果总览（报告 md）——预览 / 编辑 */}
          {deliverableCard(
            tileDoc,
            <>{t("test.report.resultOverview")} {chip(passed ? t("test.report.verdictPass") : t("test.report.verdictFail"), passed ? "ok" : "err")}</>,
            `${taskName}-${env}.md`,
            entry?.markdown ? summaryText : t("test.report.docEmpty"),
            entry?.markdown ? (
              <>
                <button onClick={() => setPreview({ kind: "md", titleKey: "test.report.resultOverview", rel: reportMdRel, content: entry.markdown, editable: false })} className={btnPrimary}><Eye size={12} /> {t("test.report.tabPreview")}</button>
                <button onClick={() => setPreview({ kind: "md", titleKey: "test.report.resultOverview", rel: reportMdRel, content: entry.markdown, editable: true })} className={btnGhost}><NotePencil size={12} /> {t("test.report.tabEdit")}</button>
              </>
            ) : null,
          )}
          {/* 卡2：执行矩阵 Excel（从 run.json 派生，始终可预览/导出）——预览 / 导出 */}
          {deliverableCard(
            tileXls,
            <>{t("test.report.fileXlsx")} {chip(t("test.report.casesChip", { n: total }), "mut")}</>,
            `${taskName}-${env}-执行矩阵.xlsx`,
            t("test.report.xlsxInfo", { total, pass: counts.pass, fail }),
            <>
              <button onClick={() => setPreview({ kind: "xlsx" })} className={btnPrimary}><Eye size={12} /> {t("test.report.tabPreview")}</button>
              <a href={`/api/test/report-xlsx?projectPath=${encodeURIComponent(projectPath)}&taskName=${encodeURIComponent(taskName)}&env=${encodeURIComponent(env)}&download=1`} className={btnGhost}><DownloadSimple size={12} /> {t("test.report.exportFile")}</a>
            </>,
          )}
          {/* 卡3：缺陷报告——有缺陷→预览/导出/修复（修复复用 handoff）；否则空态卡（生成中 / 无缺陷） */}
          {entry?.defectMarkdown ? deliverableCard(
            tileBug(),
            <>{t("test.defect.tab")} {chip(String(fail || 1), "err")}</>,
            `${taskName}-${env}-缺陷报告.md`,
            firstDefectTitle(entry.defectMarkdown) || t("test.report.defectSummary", { n: fail || 1 }),
            <>
              <button onClick={() => setPreview({ kind: "md", titleKey: "test.defect.tab", rel: defectMdRel, content: entry.defectMarkdown, editable: false })} className={btnPrimary}><Eye size={12} /> {t("test.report.tabPreview")}</button>
              <button onClick={() => downloadMd(`${taskName}-${env}-缺陷报告.md`, entry.defectMarkdown)} className={btnGhost}><DownloadSimple size={12} /> {t("test.report.exportFile")}</button>
              <button onClick={handoff} disabled={handoffBusy} className={btnGhost}><Wrench size={12} /> {t("test.report.fix")}</button>
            </>,
            "alert",
          ) : deliverableCard(
            tileBug(true),
            <>{t("test.defect.tab")} {fail > 0 ? chip(t("test.defect.generating"), "mut") : chip(t("test.report.noDefect"), "ok")}</>,
            t("test.report.defectNone"),
            fail > 0
              ? <span className="inline-flex items-center gap-1">{defectBusy && <SpinnerGap size={12} className="animate-spin" />}{t("test.report.defectGenerating")}</span>
              : t("test.report.noDefectHint"),
            null,
            "dim",
          )}
          {/* 卡4：成功回归用例的 Playwright 脚本——后台生成、指纹复用、失败项可重试。 */}
          {deliverableCard(
            tileScript,
            <>
              {t("test.scripts.title")}
              {scriptManifest && chip(
                t(scriptJobLabel[scriptManifest.jobStatus]),
                scriptManifest.jobStatus === "done" ? "ok" : scriptManifest.jobStatus === "error" || scriptManifest.jobStatus === "partial" ? "err" : "mut",
              )}
            </>,
            `AI_LabTest/scripts/${taskName}/${env}/`,
            <span className="flex flex-col gap-1">
              <span className="inline-flex items-center gap-1.5">
                {(scriptWorking || scriptBusy) && <SpinnerGap size={12} className="shrink-0 animate-spin" />}
                {scriptInfo}
              </span>
              {scriptRunFailureText && (
                <span className="inline-flex items-start gap-1 text-status-error-foreground">
                  <WarningCircle size={12} className="mt-0.5 shrink-0" />
                  <span className="min-w-0 break-words">{scriptRunFailureText}</span>
                </span>
              )}
            </span>,
            <>
              {/* 按【本轮】脚本数判定:全是 stale(历史用例集残留)时弹框会是空列表,不给入口。 */}
              {scriptCurrentCases.length > 0 && scriptManifest && (
                <button onClick={() => setPreview({ kind: "scripts", manifest: scriptManifest })} className={btnPrimary}>
                  <Eye size={12} /> {t("test.scripts.view")}
                </button>
              )}
              {scriptHasGaps && !scriptWorking && (
                <button onClick={() => void retryScripts()} disabled={scriptBusy} className={btnGhost}>
                  <ArrowUp size={12} /> {t("test.scripts.retry")}
                </button>
              )}
              {/* 卡片只留一个动作主线：自动跑通（运行→失败自动修→再跑）。原「运行全部」
                  「AI 修复」是它的子集，收进弹框做单条精修，避免测试人员面对四个按钮犯选择困难。 */}
              {scriptRunnable.length > 0 && !scriptWorking && (
                <button onClick={() => void runPipeline()} disabled={scriptBusy} className={btnPrimary} title={t("test.scripts.pipelineHint")}>
                  {scriptBusy ? <SpinnerGap size={12} className="animate-spin" /> : <Wrench size={12} />} {t("test.scripts.pipeline")}
                </button>
              )}
            </>,
            scriptManifest?.jobStatus === "error" ? "alert"
              : !scriptManifest || scriptManifest.counts.eligible === 0 ? "dim" : undefined,
          )}
        </div>
      </div>

      {preview && (
        <PreviewModal
          t={t}
          preview={preview}
          projectPath={projectPath}
          taskName={taskName}
          env={env}
          onClose={() => setPreview(null)}
          onSaved={() => { setPreview(null); setReloadTick((n) => n + 1); }}
          onScriptsChanged={(manifest) => { setScriptManifest(manifest); setScriptReloadTick((n) => n + 1); }}
          setEditable={(editable) => setPreview((p) => (p && p.kind === "md" ? { ...p, editable } : p))}
        />
      )}
    </div>
  );
}

// 产物预览弹窗壳（复刻用例编辑器的 fixed inset-0 模态）：md 走 MdPreview（渲染/编辑），
// xlsx 走 XlsxPreview（只读表格 + 证据截图灯箱/录像内联）。
function PreviewModal({ t, preview, projectPath, taskName, env, onClose, onSaved, onScriptsChanged, setEditable }: {
  t: T;
  preview: PreviewState;
  projectPath: string;
  taskName: string;
  env: string;
  onClose: () => void;
  onSaved: () => void;
  onScriptsChanged?: (manifest: ScriptManifestView) => void;
  setEditable: (editable: boolean) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className={`flex max-h-[85vh] w-full flex-col overflow-hidden rounded-xl border border-border bg-card ${preview.kind === "md" ? "max-w-3xl" : "max-w-[1040px]"}`} onClick={(e) => e.stopPropagation()}>
        {preview.kind === "md" ? (
          <MdPreview t={t} preview={preview} projectPath={projectPath} onClose={onClose} onSaved={onSaved} setEditable={setEditable} />
        ) : preview.kind === "xlsx" ? (
          <XlsxPreview t={t} projectPath={projectPath} taskName={taskName} env={env} onClose={onClose} />
        ) : (
          <ScriptPreview
            t={t}
            projectPath={projectPath}
            taskName={taskName}
            env={env}
            initialManifest={preview.manifest}
            onChanged={onScriptsChanged ?? (() => undefined)}
            onClose={onClose}
          />
        )}
      </div>
    </div>
  );
}

// md 产物预览：默认 ReactMarkdown 渲染；切「编辑」用 CodeMirror MarkdownEditor，⌘S / 保存
// 按钮经 POST /api/files/write 写回（overwrite）。draft 本地态，预览模式也渲染 draft 以反映改动。
function MdPreview({ t, preview, projectPath, onClose, onSaved, setEditable }: {
  t: T;
  preview: Extract<PreviewState, { kind: "md" }>;
  projectPath: string;
  onClose: () => void;
  onSaved: () => void;
  setEditable: (editable: boolean) => void;
}) {
  const [draft, setDraft] = useState(preview.content);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(false);
  useEffect(() => { setDraft(preview.content); }, [preview.rel, preview.content]);

  const save = async () => {
    setSaving(true);
    setErr(false);
    try {
      const res = await fetch("/api/files/write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: preview.rel, baseDir: projectPath, content: draft, overwrite: true, createParents: true }),
      });
      if (!res.ok) throw new Error("write failed");
      onSaved();
    } catch {
      setErr(true);
      setSaving(false);
    }
  };

  return (
    <>
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <FileIcon size={14} className="shrink-0 text-muted-foreground" />
        <span className="shrink-0 text-[11px] font-medium text-foreground">{t(preview.titleKey)}</span>
        <span className="truncate font-mono text-[10px] text-muted-foreground">{preview.rel.split("/").pop()}</span>
        <span className="flex-1" />
        <div className="flex shrink-0 overflow-hidden rounded border border-border text-[10px]">
          <button onClick={() => setEditable(false)} className={`px-2 py-0.5 ${!preview.editable ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted"}`}>{t("test.report.tabPreview")}</button>
          <button onClick={() => setEditable(true)} className={`px-2 py-0.5 ${preview.editable ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted"}`}>{t("test.report.tabEdit")}</button>
        </div>
        {preview.editable && (
          <button onClick={save} disabled={saving} className="flex shrink-0 items-center gap-1 rounded bg-primary px-2 py-0.5 text-[10px] font-medium text-primary-foreground disabled:opacity-50">
            {saving ? <SpinnerGap size={11} className="animate-spin" /> : <Check size={11} />} {saving ? t("test.report.saving") : t("test.report.save")}
          </button>
        )}
        <button onClick={onClose} className="shrink-0 text-muted-foreground hover:text-foreground" aria-label={t("test.report.close")}><X size={14} /></button>
      </div>
      {err && <div className="bg-status-error-muted px-3 py-1 text-[10px] text-status-error-foreground">{t("test.report.saveFailed")}</div>}
      <div className="min-h-0 flex-1 overflow-auto">
        {preview.editable ? (
          <div className="h-[60vh]"><MarkdownEditor value={draft} onChange={setDraft} onSave={save} /></div>
        ) : (
          <div className="prose prose-sm dark:prose-invert max-w-none p-4">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{draft}</ReactMarkdown>
          </div>
        )}
      </div>
    </>
  );
}

// 回归脚本预览：manifest 左侧列出每条成功回归用例及验证状态，右侧只读展示脚本；
// 可对失败/旧版本单独重试，也可在隔离的 Playwright runner 中手动运行当前脚本。
function ScriptPreview({ t, projectPath, taskName, env, initialManifest, onChanged, onClose }: {
  t: T;
  projectPath: string;
  taskName: string;
  env: string;
  initialManifest: ScriptManifestView;
  onChanged: (manifest: ScriptManifestView) => void;
  onClose: () => void;
}) {
  const [manifest, setManifest] = useState(initialManifest);
  // 只列【本轮】的脚本:status='stale'(本轮未测)是历次用例集换代后留下的旧条目——脚本文件
  // 仍在盘上、不删,但把它们混在列表里会让人以为本轮有一堆待处理的东西(真机上 15 条里 9 条
  // 是历史残留)。counts 本就不计 stale,过滤后列表与顶部数字口径终于一致。
  const shownCases = manifest.cases.filter((item) => item.status !== "stale");
  const hiddenCount = manifest.cases.length - shownCases.length;
  const [selectedId, setSelectedId] = useState(initialManifest.cases.filter((c) => c.status !== "stale")[0]?.caseId ?? "");
  const [content, setContent] = useState<string | null>(null);
  const [contentError, setContentError] = useState(false);
  const [busy, setBusy] = useState<"retry" | "run" | "repair" | "confirm" | null>(null);
  const [output, setOutput] = useState("");
  const selected = shownCases.find((item) => item.caseId === selectedId) ?? shownCases[0];

  const statusLabel: Record<ScriptCaseStatusView, TranslationKey> = {
    verified: "test.scripts.verified",
    needs_review: "test.scripts.needsReview",
    failed: "test.scripts.failed",
    stale: "test.scripts.stale",
    outdated: "test.scripts.outdated",
  };
  const statusClass: Record<ScriptCaseStatusView, string> = {
    verified: "border-status-success-border bg-status-success-muted text-status-success-foreground",
    needs_review: "border-status-warning-border bg-status-warning-muted text-status-warning-foreground",
    failed: "border-status-error-border bg-status-error-muted text-status-error-foreground",
    stale: "border-border bg-muted text-muted-foreground",
    outdated: "border-status-warning-border bg-status-warning-muted text-status-warning-foreground",
  };

  useEffect(() => {
    if (!selected?.caseId) { setContent(null); return; }
    let cancelled = false;
    setContent(null);
    setContentError(false);
    const query = new URLSearchParams({ projectPath, taskName, env, caseId: selected.caseId });
    fetch(`/api/test/scripts?${query.toString()}`)
      .then(async (res) => {
        if (!res.ok) throw new Error("load failed");
        return res.json();
      })
      .then((data) => { if (!cancelled) setContent(typeof data.content === "string" ? data.content : ""); })
      .catch(() => { if (!cancelled) setContentError(true); });
    return () => { cancelled = true; };
  }, [projectPath, taskName, env, selected?.caseId, manifest.updatedAt]);

  // 在弹窗内也跟随后台任务；这样单项重试后不必关闭弹窗等待产物卡刷新。
  useEffect(() => {
    if (manifest.jobStatus !== "queued" && manifest.jobStatus !== "running") return;
    let cancelled = false;
    const timer = setInterval(() => {
      const query = new URLSearchParams({ projectPath, taskName, env });
      void fetch(`/api/test/scripts?${query.toString()}`)
        .then((res) => res.json())
        .then((data) => {
          if (cancelled || !data.manifest) return;
          const next = data.manifest as ScriptManifestView;
          setManifest(next);
          onChanged(next);
          // 后台重生成收尾（不再 queued/running）→ 清掉「重试」时设的「等待生成」占位。
          // 否则脚本早已生成、状态徽章已更新，运行输出区却一直停在「等待生成」（用户实测）。
          if (next.jobStatus !== "queued" && next.jobStatus !== "running") {
            setOutput((prev) => (prev === t("test.scripts.queued") ? "" : prev));
          }
        })
        .catch(() => undefined);
    }, 2_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [manifest.jobStatus, projectPath, taskName, env, onChanged, t]);

  const retrySelected = async () => {
    if (!selected) return;
    setBusy("retry");
    setOutput("");
    try {
      const res = await fetch("/api/test/scripts/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectPath, taskName, env, caseIds: [selected.caseId] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "retry failed");
      const queued: ScriptManifestView = { ...manifest, jobStatus: "queued" };
      setManifest(queued);
      onChanged(queued);
      setOutput(t("test.scripts.queued"));
    } catch (error) {
      setOutput(error instanceof Error ? error.message : t("test.scripts.error"));
    } finally {
      setBusy(null);
    }
  };

  const runSelected = async () => {
    if (!selected) return;
    setBusy("run");
    setOutput("");
    try {
      const res = await fetch("/api/test/scripts/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectPath, taskName, env, caseIds: [selected.caseId] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "run failed");
      if (data.manifest) {
        const next = data.manifest as ScriptManifestView;
        setManifest(next);
        onChanged(next);
      }
      const result = Array.isArray(data.results) ? data.results[0] as { output?: string } | undefined : undefined;
      setOutput(result?.output || "");
    } catch (error) {
      setOutput(error instanceof Error ? error.message : t("test.scripts.error"));
    } finally {
      setBusy(null);
    }
  };

  // AI 修复：仅对「有失败记录」的脚本开放。同步接口（LLM+校验+重放），完成后 manifest 直达终态。
  const repairSelected = async () => {
    if (!selected) return;
    setBusy("repair");
    setOutput("");
    try {
      const res = await fetch("/api/test/scripts/repair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectPath, taskName, env, caseIds: [selected.caseId] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "repair failed");
      if (data.manifest) {
        const next = data.manifest as ScriptManifestView;
        setManifest(next);
        onChanged(next);
      }
      const result = Array.isArray(data.results) ? data.results[0] as { fixed?: boolean; reason?: string } | undefined : undefined;
      setOutput(result ? `${result.fixed ? "✓" : "✗"} ${result.reason ?? ""}` : "");
    } catch (error) {
      setOutput(error instanceof Error ? error.message : t("test.scripts.error"));
    } finally {
      setBusy(null);
    }
  };

  // 人工确认 mock 脚本通过：「需人工确认真实环境可通过」这句警告此前没有落点，usesMock 的
  // 脚本无论运行成功多少次都不会被提升（runScriptCases 刻意跳过它们），状态永久停在待复核。
  const confirmSelected = async () => {
    if (!selected) return;
    setBusy("confirm");
    setOutput("");
    try {
      const res = await fetch("/api/test/scripts/confirm-mock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectPath, taskName, env, caseIds: [selected.caseId] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "confirm failed");
      if (data.manifest) {
        const next = data.manifest as ScriptManifestView;
        setManifest(next);
        onChanged(next);
      }
      setOutput(`✓ ${t("test.scripts.confirmMockDone")}`);
    } catch (error) {
      setOutput(error instanceof Error ? error.message : t("test.scripts.error"));
    } finally {
      setBusy(null);
    }
  };

  // outdated 也可运行:它的定义是「重新生成失败但盘上仍有可用旧脚本」,排除它等于让好脚本
  // 掉出全部恢复通道(与 isRunnableStatus 保持同一口径)。
  const runnable = selected?.status === "verified" || selected?.status === "needs_review" || selected?.status === "outdated";
  // 只在「确实需要人工拍板」时给按钮：mock + 待复核 + 无失败记录（带失败记录该走运行/AI 修复）。
  const confirmable = !!selected && selected.usesMock && selected.status === "needs_review" && !selected.lastRunError;
  const working = manifest.jobStatus === "queued" || manifest.jobStatus === "running";

  return (
    <>
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Terminal size={14} className="shrink-0 text-primary" />
        <span className="text-[11px] font-medium text-foreground">{t("test.scripts.title")}</span>
        <span className="font-mono text-[10px] text-muted-foreground">{taskName}/{env}</span>
        {working && <SpinnerGap size={12} className="animate-spin text-muted-foreground" />}
        <span className="flex-1" />
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label={t("test.report.close")}><X size={14} /></button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <aside className="max-h-44 shrink-0 overflow-auto border-b border-border bg-muted/20 p-2 md:max-h-none md:w-64 md:border-b-0 md:border-r">
          <div className="space-y-1">
            {shownCases.map((item) => (
              <button
                key={item.caseId}
                onClick={() => { setSelectedId(item.caseId); setOutput(""); }}
                className={`w-full rounded-md border px-2 py-1.5 text-left transition ${selected?.caseId === item.caseId ? "border-primary/50 bg-primary/5" : "border-transparent hover:bg-muted"}`}
              >
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-foreground">
                    {item.sourceTask ? `${item.sourceTask} · ${item.sourceCaseId || item.caseId}` : item.caseId}
                  </span>
                  <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] ${statusClass[item.status]}`}>{t(statusLabel[item.status])}</span>
                </div>
                <div className="mt-0.5 truncate font-mono text-[9px] text-muted-foreground">{item.file}</div>
              </button>
            ))}
          </div>
          {/* 被过滤掉的历史脚本要留个交代:文件仍在盘上、下轮跑到该用例就自动回来,
              静默消失会让人以为脚本被删了。 */}
          {hiddenCount > 0 && (
            <div className="mt-2 px-1 text-[9px] leading-relaxed text-muted-foreground">
              {t("test.scripts.hiddenStale", { count: hiddenCount })}
            </div>
          )}
        </aside>
        <section className="flex min-h-[55vh] min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-2">
            <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground">{selected?.file ?? "—"}</span>
            {selected && (
              <button onClick={retrySelected} disabled={busy !== null || working} className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-[10px] text-foreground hover:bg-muted disabled:opacity-40">
                {busy === "retry" ? <SpinnerGap size={10} className="animate-spin" /> : <ArrowUp size={10} />} {t("test.scripts.retry")}
              </button>
            )}
            {runnable && (
              <button onClick={runSelected} disabled={busy !== null || working} className="inline-flex items-center gap-1 rounded bg-primary px-2 py-0.5 text-[10px] text-primary-foreground disabled:opacity-40">
                {busy === "run" ? <SpinnerGap size={10} className="animate-spin" /> : <Play size={10} />} {t("test.scripts.runOne")}
              </button>
            )}
            {selected?.lastRunError && (
              <button onClick={repairSelected} disabled={busy !== null || working} className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-[10px] text-foreground hover:bg-muted disabled:opacity-40">
                {busy === "repair" ? <SpinnerGap size={10} className="animate-spin" /> : <Wrench size={10} />} {t("test.scripts.repair")}
              </button>
            )}
            {confirmable && (
              <button onClick={confirmSelected} disabled={busy !== null || working} title={t("test.scripts.confirmMockHint")} className="inline-flex items-center gap-1 rounded border border-status-success-border bg-status-success-muted px-2 py-0.5 text-[10px] text-status-success-foreground hover:opacity-90 disabled:opacity-40">
                {busy === "confirm" ? <SpinnerGap size={10} className="animate-spin" /> : <Check size={10} />} {t("test.scripts.confirmMock")}
              </button>
            )}
          </div>
          {/* 运行失败是持久化的（manifest.lastRunError），重开弹框仍可见；上方的 output 只是本次运行的瞬时输出。 */}
          {selected?.lastRunError && (
            <div className="border-b border-border bg-status-error-muted/40 px-3 py-1.5 text-[10px] text-status-error-foreground">
              {selected.lastRunError}
            </div>
          )}
          {/* 人工确认留痕：它是被人放行的、不是自动验证通过的，这个区别必须可见。 */}
          {selected?.manualVerifiedAt && (
            <div className="border-b border-border bg-status-success-muted/40 px-3 py-1.5 text-[10px] text-status-success-foreground">
              ✓ {t("test.scripts.confirmMockDone")} · {fmtCnDateTime(selected.manualVerifiedAt)}
            </div>
          )}
          {/* AI 修复结论：修了什么 / 为什么不是脚本缺陷（如页面行为与用例预期不符 → 需人工确认）。 */}
          {selected?.repairNote && (
            <div className="border-b border-border bg-status-info-muted/40 px-3 py-1.5 text-[10px] text-status-info-foreground">
              🔧 {selected.repairNote}
            </div>
          )}
          {(Boolean(selected?.error) || (selected?.validation?.warnings?.length ?? 0) > 0) && (
            <div className="border-b border-border bg-status-warning-muted/40 px-3 py-1.5 text-[10px] text-status-warning-foreground">
              {selected.error || selected.validation?.warnings.join(" · ")}
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-auto bg-muted/15">
            {contentError ? (
              <div className="p-6 text-center text-[11px] text-status-error-foreground">{t("test.scripts.loadFailed")}</div>
            ) : content === null ? (
              <div className="p-6 text-center"><SpinnerGap size={14} className="mx-auto animate-spin text-muted-foreground" /></div>
            ) : (
              <pre className="min-w-max p-3 font-mono text-[11px] leading-relaxed text-foreground"><code>{content}</code></pre>
            )}
          </div>
          {output && (
            <div className="max-h-36 overflow-auto border-t border-border bg-background px-3 py-2">
              <div className="mb-1 text-[10px] font-medium text-muted-foreground">{t("test.scripts.output")}</div>
              <pre className="whitespace-pre-wrap break-all font-mono text-[10px] leading-relaxed text-foreground">{output}</pre>
            </div>
          )}
        </section>
      </div>
    </>
  );
}

// 操作记录弹窗（需求②审计的查看端）：GET /api/test/audit 拉当前任务事件（最新在前，服务端
// 已倒序），展示 时间(fmtCnDateTime 本地化)/步骤/动作/方式/详情。动作与方式经 i18n 映射；
// 未知动作原样显示（审计文件是数据，向前兼容新动作）。审计文件删任务留痕，故已删任务的
// 记录也能在同名新任务里看到——detail 里的 delete-task 行即分界。
interface AuditEvt { time?: string; step?: string; action?: string; mode?: string; detail?: string }
const AUDIT_ACTION_KEYS: Record<string, TranslationKey> = {
  "approve": "test.audit.action.approve",
  "run": "test.audit.action.run",
  "run-task": "test.audit.action.runTask",
  "chat-action": "test.audit.action.chatAction",
  "revise": "test.audit.action.revise",
  "stop": "test.audit.action.stop",
  "auto-approve": "test.audit.action.autoApprove",
  "import": "test.audit.action.import",
  "edit-cases": "test.audit.action.editCases",
  "delete-task": "test.audit.action.deleteTask",
  "recommend-suite": "test.audit.action.recommend",
  "deposit-library": "test.audit.action.depositLibrary",
  "run-library": "test.audit.action.runLibrary",
  "library-remove": "test.audit.action.libraryRemove",
  "suite-save": "test.audit.action.suiteSave",
  "suite-delete": "test.audit.action.suiteDelete",
  "delete-round": "test.audit.action.deleteRound",
  "confirm-mock-scripts": "test.audit.action.confirmMock",
};
const AUDIT_MODE_KEYS: Record<string, TranslationKey> = {
  manual: "test.audit.mode.manual",
  batch: "test.audit.mode.batch",
  auto: "test.audit.mode.auto",
};
function AuditModal({ t, projectPath, taskName, onClose }: { t: T; projectPath: string; taskName: string; onClose: () => void }) {
  const [events, setEvents] = useState<AuditEvt[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/test/audit?projectPath=${encodeURIComponent(projectPath)}&taskName=${encodeURIComponent(taskName)}`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setEvents(Array.isArray(d?.events) ? (d.events as AuditEvt[]) : []); })
      .catch(() => { if (!cancelled) setEvents([]); });
    return () => { cancelled = true; };
  }, [projectPath, taskName]);
  const stepName = (s?: string) => {
    const def = STEPS.find((x) => x.step === s);
    return def ? t(def.name) : "—";
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-background shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <ListChecks size={14} className="text-primary" />
          <span className="text-xs font-semibold text-foreground">{t("test.audit.title")} · {taskName}</span>
          <span className="flex-1" />
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label={t("test.report.close")}><X size={14} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {events === null ? (
            <div className="p-4 text-center text-[11px] text-muted-foreground"><SpinnerGap size={14} className="mx-auto animate-spin" /></div>
          ) : events.length === 0 ? (
            <div className="p-4 text-center text-[11px] text-muted-foreground">{t("test.audit.empty")}</div>
          ) : (
            <table className="w-full border-collapse text-[11px]">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                <tr className="text-left text-muted-foreground">
                  <th className="whitespace-nowrap px-3 py-1.5 font-medium">{t("test.audit.colTime")}</th>
                  <th className="whitespace-nowrap px-2 py-1.5 font-medium">{t("test.audit.colStep")}</th>
                  <th className="whitespace-nowrap px-2 py-1.5 font-medium">{t("test.audit.colAction")}</th>
                  <th className="whitespace-nowrap px-2 py-1.5 font-medium">{t("test.audit.colMode")}</th>
                  <th className="px-2 py-1.5 font-medium">{t("test.audit.colDetail")}</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e, i) => (
                  <tr key={i} className="border-t border-border align-top">
                    <td className="whitespace-nowrap px-3 py-1.5 font-mono text-[10px] text-muted-foreground">{e.time ? fmtCnDateTime(e.time) : "—"}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-foreground">{stepName(e.step)}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-foreground">{AUDIT_ACTION_KEYS[e.action ?? ""] ? t(AUDIT_ACTION_KEYS[e.action!]) : e.action || "—"}</td>
                    <td className="whitespace-nowrap px-2 py-1.5">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] ${e.mode === "manual" ? "bg-status-info-muted text-status-info-foreground" : "bg-muted text-muted-foreground"}`}>
                        {AUDIT_MODE_KEYS[e.mode ?? ""] ? t(AUDIT_MODE_KEYS[e.mode!]) : e.mode || "—"}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-muted-foreground">{e.detail || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// 回归用例库区块(批 H 页面化,项目级):按来源任务分组展示沉淀的回归用例;检索/过滤;
// 支持移除单条 / 移除某任务全部。发起回归与运行状态行在 RegressionWorkspace 层。
interface LibMetaUI {
  reviewState: "approved" | "pending";
  rev: number;
  history: Array<{ rev: number; at: string; note: string }>;
  quarantined: boolean;
  quarantinedAt?: string;
  quarantineReason?: string;
}
interface LibEntry {
  id?: string; purpose?: string; priority?: string; caseType?: string; module?: string;
  requirement?: string; tags?: string[];
  steps?: Array<{ content?: string; expected?: string }>;
  _source?: { task?: string; originalId?: string; depositedAt?: string };
  _lib?: LibMetaUI;
}
interface LibGroup { task: string; count: number; entries: LibEntry[] }

// 跨轮历史(GET /api/test/library/history):矩阵 + 健康度派生。库总览徽标、详情抽屉的执行
// 历史圆点、对比矩阵、健康度页共用同一份数据。
type CaseRes = "p" | "f" | "-";
type HealthKind = "quar" | "streak" | "flaky" | "never" | "stale" | "ok";
interface HistRound { roundId: string; startedAt: string; env: string; suiteName: string; mode: string; status: string }
interface HistCase {
  task: string; originalId: string; purpose: string; priority: string; module: string;
  meta: LibMetaUI; res: CaseRes[]; pinned: boolean; flips: number; tailFails: number; health: HealthKind;
}
interface HistSummary {
  total: number; flaky: number; streak: number; stale: number; never: number;
  quarantined: number; pending: number; quarantineRatio: number; quarantineAlert: boolean;
}
interface HistoryDTO {
  rounds: HistRound[]; cases: HistCase[];
  passRates: Array<{ roundId: string; pass: number; fail: number; total: number }>;
  summary: HistSummary;
}

/** 条目身份键(任务名可含空格,用 JSON 数组做无歧义键)。 */
const caseKey = (task: string, originalId: string) => JSON.stringify([task, originalId]);
const caseKeyDec = (s: string): { task: string; originalId: string } => {
  const [task, originalId] = JSON.parse(s) as [string, string];
  return { task, originalId };
};

/** 健康度徽标文案与配色(与 case-history.ts 的 health() 一一对应)。 */
function healthBadge(t: T, c: Pick<HistCase, "health" | "tailFails">): { label: string; cls: string } | null {
  switch (c.health) {
    case "quar": return { label: t("test.health.quarantined"), cls: "bg-status-info-muted text-status-info-foreground" };
    case "streak": return { label: t("test.health.streak", { n: c.tailFails }), cls: "bg-status-error-muted text-status-error-foreground" };
    case "flaky": return { label: t("test.health.flaky"), cls: "bg-status-warning-muted text-status-warning-foreground" };
    case "never": return { label: t("test.health.never"), cls: "border border-border text-muted-foreground" };
    case "stale": return { label: t("test.health.stale"), cls: "border border-border text-muted-foreground" };
    default: return null;
  }
}

/** 上次执行结果圆点(p/f/未跑)。 */
function LastResultDot({ t, res }: { t: T; res: CaseRes[] }) {
  let last: CaseRes = "-";
  for (let i = res.length - 1; i >= 0; i--) if (res[i] !== "-") { last = res[i]; break; }
  const cls = last === "p" ? "bg-status-success-foreground" : last === "f" ? "bg-status-error-foreground" : "bg-border";
  const title = last === "p" ? t("test.library.lastResultPass") : last === "f" ? t("test.library.lastResultFail") : t("test.library.lastResultNone");
  return <span className={`inline-block h-2 w-2 flex-shrink-0 rounded-full ${cls}`} title={title} />;
}

// 回归执行进展面板：就地下拉的执行详情（替换原来只有一句话的运行状态行）。
//
// 折叠 = 一行摘要（跑到哪、有没有挂）。展开 = 左侧用例进度 + 右侧按用例分段的执行流：
// 通过的用例自动收起，失败/无判定的保持展开并挂红边，工具轨迹折叠成「N 步」。
//
// **不保留历史**：状态活在内存，跑完定格为本次快照，切走/刷新即消失（用户拍板）。
// 收口后的事实在「轮次报告」页。
//
// 对账条：正常时一行安静的 ✓；背离时展开三源读数。**锚点是 tool_use 计数**——@@CASE_START
// 与 @@RESULT 都是模型自由文本，同一次 markdown 装饰会把两者一起污染、让背离被掩盖；
// tool_use 是 SDK 结构化帧，与格式漂移无关（2026-07-10 事故的教训，见 lib/test/markers.ts）。

const LIVE_DOT: Record<LiveStatus, string> = {
  pass: "bg-status-success-foreground",
  fail: "bg-status-error-foreground",
  partial: "bg-status-warning-foreground",
  blocked: "bg-muted-foreground",
};
const LIVE_TEXT: Record<LiveStatus, string> = {
  pass: "text-status-success-foreground",
  fail: "text-status-error-foreground",
  partial: "text-status-warning-foreground",
  blocked: "text-muted-foreground",
};

function RegressionLivePanel({ t, live, running, runStatus, onOpenReport, onStop }: {
  t: T;
  live: LibraryLive;
  running: boolean;
  runStatus: string | null;
  onOpenReport: () => void;
  /** 停止当前轮次(运行中显示按钮;确认与收口逻辑在上层 stopLibraryRun)。 */
  onStop?: () => void;
}) {
  const [open, setOpen] = useState(true);
  // 「收口中 / 疑似卡住」是【推断态】——服务端在做证据归集与归约时不发任何帧。用一个秒级
  // ticker 让面板能自己判断「多久没收到帧了」。
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running || live.finished) return;
    const h = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(h);
  }, [running, live.finished]);
  const logRef = useRef<HTMLDivElement>(null);
  // 智能吸底:仅当用户本就贴近底部时才自动跟随新帧。原来无条件 scrollTop=scrollHeight,
  // 执行期间每来一帧都把滚动条拽回底部 —— 用户根本无法往上滚动阅读(实测反馈)。
  const followRef = useRef(true);
  const onLogScroll = () => {
    const el = logRef.current;
    if (el) followRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };
  useEffect(() => {
    const el = logRef.current;
    if (running && el && followRef.current) el.scrollTop = el.scrollHeight;
  }, [live.cases.length, live.tools, live.verdicts, running]);

  const fin = !!live.runJson || live.finished;
  const counts = live.runJson ?? live.four;
  const lostCases = live.cases.filter((c) => c.lost).length;
  const lostAll = fin && live.verdicts === 0 && live.tools > 0 && !live.errored;
  // 用户停止与真实失败共用中断视觉(红),仅文案区分——中断的轮天然缺判定,不是判定丢失。
  const stopped = !!live.stopped;
  const aborting = live.errored || stopped;
  const idle = now - live.lastFrameAt;
  const settling = !fin && live.step === "execution" && live.started > 0 && idle > LIVE_SETTLE_MS;
  const stuck = settling && idle > LIVE_STUCK_MS;
  // 背离 = 「浏览器确有活动，却收不到判定」。中断的轮天然缺判定，那是【中断】不是【判定丢失】——
  // 混为一谈会让真事故淹没在噪音里。
  const inflight = live.curIdx >= 0 ? 1 : 0;
  const diverged = !aborting && (live.malformed > 0 || (live.tools > 0 && live.started - inflight > live.verdicts));

  const cur = live.curIdx >= 0 ? live.cases[live.curIdx] : undefined;
  let headline: string;
  let sub: string;
  if (fin) {
    headline = aborting ? t(stopped ? "test.live.doneStopped" : "test.live.doneAborted") : lostAll ? t("test.live.doneLost")
      : counts.fail || counts.blocked ? t("test.live.doneFail") : t("test.live.doneOk");
    sub = t("test.live.passOf", { pass: counts.pass, total: counts.total || live.total });
  } else if (live.step === "report") {
    headline = t("test.live.report"); sub = t("test.live.reportSub");
  } else if (stuck) { headline = t("test.live.settling"); sub = t("test.live.stuck"); }
  else if (settling) { headline = t("test.live.settling"); sub = t("test.live.settlingSub"); }
  else if (cur) { headline = t("test.live.running", { idx: cur.index, total: live.total }); sub = cur.title || cur.id; }
  else { headline = t("test.live.startingUp"); sub = t("test.live.startingUpSub"); }

  const pct = fin ? 100 : live.total ? Math.round((live.verdicts / live.total) * 100) : 0;
  const barCls = fin ? (counts.fail || counts.blocked ? "bg-status-error-foreground" : "bg-status-success-foreground") : "bg-primary";

  const chip = (label: string, n: number, cls: string) =>
    n > 0 ? <span key={label} className={`rounded-full px-1.5 text-[9.5px] tabular-nums ${cls}`}>{label} {n}</span> : null;

  // 完整记录:不再按类型过滤、不再折叠工具轨迹 —— 所有事件按时间顺序原样铺开
  // (用户拍板:工具调用/AI 说明/用例与判定全部合入「全部」,不需要每用例收缩展开)。
  const renderEvents = (events: LiveEvt[]) => {
    if (!events.length) return null;
    const bubble = (e: LiveEvt, i: number) => {
      if (e.k === "tool") return <div key={i} className="truncate rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground" title={e.text}>{e.text}</div>;
      if (e.k === "err") return <div key={i} className="rounded bg-status-error-muted px-2 py-1 text-[10.5px] text-status-error-foreground">{e.text}</div>;
      if (e.k === "sys") return <div key={i} className={`font-mono text-[10.5px] font-semibold ${e.lost ? "font-sans font-medium text-status-error-foreground" : e.status ? LIVE_TEXT[e.status] : "text-muted-foreground"}`}>{e.text}</div>;
      return <div key={i} className="whitespace-pre-wrap rounded-md bg-muted px-2 py-1 text-[11px] text-foreground">{e.text}</div>;
    };
    return <div className="flex flex-col gap-1 py-1.5">{events.map(bubble)}</div>;
  };

  return (
    <div className={`mb-3 overflow-hidden rounded-lg border bg-card ${diverged || lostAll ? "border-status-error-foreground/50" : "border-border"}`}>
      {/* 折叠头(展开开关 + 运行中的「停止」并排 —— button 不能嵌套,停止不放开关内部) */}
      <div className="flex w-full items-center">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 px-3 py-1.5 text-left hover:bg-muted"
        >
          {open ? <CaretDown size={9} className="flex-shrink-0 text-muted-foreground" /> : <CaretRight size={9} className="flex-shrink-0 text-muted-foreground" />}
          {fin ? <span className={`h-2 w-2 flex-shrink-0 rounded-full ${counts.fail || counts.blocked || aborting ? "bg-status-error-foreground" : "bg-status-success-foreground"}`} />
               : <SpinnerGap size={11} className="flex-shrink-0 animate-spin text-primary" />}
          <span className="whitespace-nowrap text-[11.5px] font-semibold text-foreground">{headline}</span>
          <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">{sub}</span>
          <span className="h-1 w-24 flex-shrink-0 overflow-hidden rounded-full bg-border">
            <span className={`block h-full transition-all ${barCls}`} style={{ width: `${pct}%` }} />
          </span>
          <span className="flex flex-shrink-0 gap-1">
            {chip(t("test.state.pass"), counts.pass, "bg-status-success-muted text-status-success-foreground")}
            {chip(t("test.state.fail"), counts.fail, "bg-status-error-muted text-status-error-foreground")}
            {chip(t("test.state.partial"), counts.partial, "bg-status-warning-muted text-status-warning-foreground")}
            {chip(t("test.state.blocked"), counts.blocked, "bg-muted text-muted-foreground")}
          </span>
        </button>
        {onStop && running && !live.finished && (
          <button
            onClick={onStop}
            title={t("test.library.stopHint")}
            className="mr-2 flex h-6 flex-shrink-0 items-center gap-1 rounded-md border border-status-error-foreground/40 px-2 text-[11px] font-medium text-status-error-foreground hover:bg-status-error-muted"
          >
            <Stop size={11} weight="fill" /> {t("test.library.stop")}
          </button>
        )}
      </div>

      {/* 对账条：正常安静，背离/中断时响 */}
      {live.started > 0 && (
        aborting ? (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-border bg-status-error-muted px-3 py-1.5 text-[11px] font-medium text-status-error-foreground">
            <Warning size={11} /> <span>{t(stopped ? "test.live.reconStopped" : "test.live.reconAborted")}</span>
            <span className="ml-auto font-normal">{stopped ? t("test.live.reconStoppedWhy") : (live.errorText || t("test.live.reconAbortedWhy"))}</span>
          </div>
        ) : diverged ? (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-border bg-status-error-muted px-3 py-1.5 text-[11px] font-medium text-status-error-foreground">
            <Warning size={11} />
            <span>{t("test.live.reconToolActivity", { n: live.tools })}</span>·
            <span>{t("test.live.reconStarted", { n: live.started })}</span>·
            <span>{t("test.live.reconVerdicts", { n: live.verdicts })}</span>
            {live.malformed > 0 && <>·<span>{t("test.live.reconMalformed", { n: live.malformed })}</span></>}
            <span className="ml-auto font-normal">{t("test.live.reconBad")}</span>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-border bg-muted px-3 py-1 text-[10.5px] text-muted-foreground">
            <Check size={10} /> <span>{t("test.live.reconOk", { verdicts: live.verdicts, started: live.started })}</span>
            <span className="ml-auto">{t("test.live.reconAnchor")}</span>
          </div>
        )
      )}

      {open && (
        <div className="grid grid-cols-1 border-t border-border md:grid-cols-[280px_1fr]">
          {/* 左：用例进度 */}
          <div className="min-w-0 border-b border-border md:border-b-0 md:border-r">
            <div className="flex items-center gap-1.5 bg-muted px-3 py-1 text-[9.5px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("test.live.caseSect")}
              <span className="flex-1" />
              <span className={`text-[10px] font-normal normal-case tracking-normal ${lostCases ? "text-status-error-foreground" : ""}`}>
                {t("test.live.caseDone", { done: live.verdicts, total: live.total })}
                {lostCases > 0 && t("test.live.caseLost", { n: lostCases })}
              </span>
            </div>
            <div className="max-h-[420px] divide-y divide-border overflow-auto">
              {live.cases.length === 0 && <div className="p-4 text-center text-[11px] text-muted-foreground">{t("test.live.waiting")}</div>}
              {live.cases.map((c, i) => (
                <button
                  key={`${c.id}-${i}`}
                  onClick={() => document.getElementById(`live-seg-${i}`)?.scrollIntoView({ block: "center", behavior: "smooth" })}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] hover:bg-muted ${c.lost ? "bg-status-error-muted" : live.curIdx === i ? "bg-primary/[0.07] shadow-[inset_2px_0_0_var(--primary)]" : ""}`}
                >
                  {c.result ? <span className={`h-2 w-2 flex-shrink-0 rounded-full ${LIVE_DOT[c.result.status]}`} />
                    : c.lost ? <span className="h-2 w-2 flex-shrink-0 rounded-full bg-status-error-foreground" />
                    : live.curIdx === i ? <SpinnerGap size={9} className="flex-shrink-0 animate-spin text-primary" />
                    : <span className="h-2 w-2 flex-shrink-0 rounded-full bg-border" />}
                  <span className="flex-shrink-0 font-mono text-[10px] text-muted-foreground">{c.id}</span>
                  <span className="min-w-0 flex-1 truncate text-foreground" title={c.title}>{c.title || "—"}</span>
                  {c.result ? (
                    <span className="font-mono text-[9.5px] tabular-nums text-muted-foreground" title={live.runJson ? t("test.live.durFinal") : t("test.live.durLive")}>
                      {live.runJson ? "" : "~"}{((c.ms ?? 0) / 1000).toFixed(1)}s
                    </span>
                  ) : c.lost ? (
                    <span className="text-[9.5px] font-semibold text-status-error-foreground" title={t("test.live.noVerdictHint")}>⚠ {t("test.live.noVerdict")}</span>
                  ) : (
                    <span className="text-[9.5px] text-muted-foreground">{live.curIdx === i ? t("test.live.executing") : t("test.live.pending")}</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* 右：完整执行记录(单一时间线,用例边界只是分隔行,不可折叠) */}
          <div className="flex min-w-0 flex-col">
            <div className="flex items-center justify-between border-b border-border bg-muted px-2.5 py-1">
              <span className="text-[9.5px] font-semibold uppercase tracking-wide text-muted-foreground">{t("test.live.execRecord")}</span>
              <span className="text-[10px] text-muted-foreground">{t("test.live.toolActivity", { n: live.tools })}</span>
            </div>
            <div ref={logRef} onScroll={onLogScroll} className="flex h-[420px] flex-col overflow-auto p-2">
              {renderEvents(live.pre)}
              {live.cases.map((c, i) => {
                const toolCount = c.events.filter((e) => e.k === "tool").length;
                const sepCls = c.lost || c.result?.status === "fail" ? "border-status-error-foreground/45" : live.curIdx === i ? "border-primary/40" : "border-border";
                return (
                  <Fragment key={`${c.id}-${i}`}>
                    <div id={`live-seg-${i}`} className={`mt-2 flex items-center gap-2 border-t-2 px-0.5 pt-1.5 text-[11px] ${sepCls}`}>
                      <span className="flex-shrink-0 font-mono text-[9.5px] text-muted-foreground">{c.index}/{live.total}</span>
                      <span className="min-w-0 flex-1 truncate font-medium text-foreground" title={c.title}>{c.title || c.id}</span>
                      <span className="flex-shrink-0 text-[9.5px] tabular-nums text-muted-foreground">
                        {t("test.live.steps", { n: toolCount })}{c.ms ? ` · ${(c.ms / 1000).toFixed(1)}s` : ""}
                      </span>
                      {c.result ? <span className={`flex-shrink-0 font-mono text-[9.5px] font-bold ${LIVE_TEXT[c.result.status]}`}>{c.result.status}</span>
                        : c.lost ? <span className="flex-shrink-0 font-mono text-[9.5px] font-bold text-status-error-foreground">{t("test.live.noVerdict")}</span>
                        : <SpinnerGap size={10} className="flex-shrink-0 animate-spin text-primary" />}
                    </div>
                    {renderEvents(c.events)}
                    {c.result?.error && <div className="rounded bg-status-error-muted px-2.5 py-1 text-[10.5px] text-status-error-foreground">{c.result.error}</div>}
                  </Fragment>
                );
              })}
              {live.cases.length === 0 && live.pre.length === 0 && <div className="py-8 text-center text-[11px] text-muted-foreground">{t("test.live.waiting")}</div>}
            </div>
          </div>
        </div>
      )}

      {/* 收口 */}
      {fin && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
          {aborting ? <span className="font-medium text-status-error-foreground">{t(stopped ? "test.live.footStopped" : "test.live.footAborted")}</span>
            : lostAll ? <><span className="font-medium text-status-error-foreground">{t("test.live.footLost", { n: counts.blocked || live.total })}</span><span>{t("test.live.footLostWhy")}</span></>
            : counts.fail ? <span className="font-medium text-status-warning-foreground">{t("test.live.footFail", { n: counts.fail })}</span>
            : <span className="font-medium text-status-success-foreground">{t("test.live.footOk", { pass: counts.pass, total: counts.total })}</span>}
          {live.note && <span>{live.note}</span>}
          <span className="flex-1" />
          <button onClick={onOpenReport} className="flex h-6 items-center rounded border border-border bg-primary px-2 text-[11px] font-medium text-primary-foreground">{t("test.live.viewReport")}</button>
          <span className="w-full text-[10px] leading-relaxed">{t("test.live.corrected")}</span>
        </div>
      )}
      {!fin && runStatus && <div className="border-t border-border px-3 py-1 text-[10px] text-muted-foreground">{runStatus}</div>}
    </div>
  );
}

/** 回归测试整页工作区的子页签。 */
type RegTab = "library" | "suites" | "rounds" | "matrix" | "health";

// 回归测试整页工作区(批 H):子页签(用例库/回归套件/轮次历史/轮次报告)+「发起回归」+ 运行状态行。
// 三个区块由原弹窗内容页面化而来,数据链路(reloadSignal/deposit/rounds API)不变。
function RegressionWorkspace({ t, projectPath, regTab, setRegTab, reloadSignal, onChanged, onLaunch, onStop, running, runStatus, live, model, providerId }: {
  t: T;
  projectPath: string;
  regTab: RegTab;
  setRegTab: (v: RegTab) => void;
  reloadSignal: number;
  onChanged: () => void;
  onLaunch: (preset?: { mode?: "failed-only"; parentRoundId?: string }) => void;
  /** 停止当前轮次(执行面板头的「停止」按钮;确认与收口在上层 stopLibraryRun)。 */
  onStop: () => void;
  running: boolean;
  runStatus: string | null;
  /** 执行中的实时详情；null = 没有正在跑的轮次（面板不显示）。 */
  live: LibraryLive | null;
  model: string;
  providerId: string;
}) {
  // 下钻查看某一轮的完整报告(null = 显示轮次列表)。矩阵单元格 / 执行面板「查看报告」也走这个态。
  const [reportRoundId, setReportRoundId] = useState<string | null>(null);
  const TABS: Array<{ id: RegTab; label: string }> = [
    { id: "library", label: t("test.regression.tabLibrary") },
    { id: "suites", label: t("test.suites.open") },
    { id: "rounds", label: t("test.rounds.open") },
    { id: "matrix", label: t("test.matrix.tab") },
    { id: "health", label: t("test.health.tab") },
  ];
  return (
    <div>
      <div className="mb-3 flex items-center gap-1 border-b border-border">
        {TABS.map((tb) => (
          <button
            key={tb.id}
            onClick={() => { setRegTab(tb.id); setReportRoundId(null); }}
            className={`-mb-px border-b-2 px-3 py-1.5 text-[12px] transition-colors ${regTab === tb.id ? "border-primary font-semibold text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            {tb.label}
          </button>
        ))}
        <span className="flex-1" />
        <button
          onClick={() => onLaunch()}
          disabled={running}
          title={t("test.library.runHint")}
          className="mb-1 flex h-7 items-center gap-1 rounded-md bg-primary px-2.5 text-[11px] font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          {running ? <SpinnerGap size={11} className="animate-spin" /> : <Play size={11} />} {running ? t("test.library.running") : t("test.launch.open")}
        </button>
      </div>
      {/* 执行状态面板只在「回归套件」tab 顶部显示(运行中实时进度 + 完成后结果盘面);其余 tab 不显示,
          避免完成后的盘面一直霸占所有 tab 顶部。全局「有轮次在跑」提示保留在顶部「运行中」按钮上。 */}
      {regTab === "suites" && (live ? (
        <RegressionLivePanel t={t} live={live} running={running} runStatus={runStatus} onStop={onStop} onOpenReport={() => { if (live.roundId) setReportRoundId(live.roundId); setRegTab("rounds"); }} />
      ) : runStatus ? (
        <div className="mb-3 flex items-center gap-1.5 rounded-md border border-border bg-muted/30 px-3 py-1.5 text-[11px] text-muted-foreground">
          {running && <SpinnerGap size={11} className="animate-spin" />}
          {runStatus}
        </div>
      ) : null)}
      {regTab === "library" && <RegressionLibrarySection t={t} projectPath={projectPath} reloadSignal={reloadSignal} onChanged={onChanged} />}
      {regTab === "suites" && <RegressionSuitesSection t={t} projectPath={projectPath} />}
      {regTab === "rounds" && (
        <RegressionRoundsSection
          t={t}
          projectPath={projectPath}
          reloadSignal={reloadSignal}
          model={model}
          providerId={providerId}
          reportRoundId={reportRoundId}
          onOpenReport={(rid) => setReportRoundId(rid)}
          onBack={() => setReportRoundId(null)}
          onRetest={(parentRoundId) => onLaunch({ mode: "failed-only", parentRoundId })}
        />
      )}
      {regTab === "matrix" && (
        <RegressionMatrixSection
          t={t}
          projectPath={projectPath}
          reloadSignal={reloadSignal}
          onOpenRound={(rid) => { setReportRoundId(rid); setRegTab("rounds"); }}
        />
      )}
      {regTab === "health" && (
        <RegressionHealthSection t={t} projectPath={projectPath} reloadSignal={reloadSignal} onChanged={onChanged} />
      )}
    </div>
  );
}

// 库总览(屏 1,v2 二/三期):在 v1 的「按来源任务分组 + 检索」之上，叠加治理视图——
// 评审态 / 健康度徽标 / 上次结果 / rev / 📌必跑，多选批量条(确认·加入套件·隔离·移除)，
// 以及行点击打开的详情抽屉。数据来自两个只读 API 的合并:
//   /api/test/library         → 用例全字段(步骤、需求、_lib 治理元数据)
//   /api/test/library/history → 跨轮结果矩阵 + 健康度派生 + pinned
function RegressionLibrarySection({ t, projectPath, reloadSignal, onChanged }: {
  t: T;
  projectPath: string;
  reloadSignal: number;
  onChanged: () => void;
}) {
  // null = 加载中(初次挂载即 null → 显示 spinner;reloadSignal 变化时保留旧数据直到新数据到达,
  // 不在 effect 体里同步 setData(null)——避免 react-hooks/set-state-in-effect 级联渲染告警)。
  const [data, setData] = useState<{ total: number; updatedAt: string; tasks: LibGroup[] } | null>(null);
  const [hist, setHist] = useState<HistoryDTO | null>(null);
  // 库检索:搜索(ID/标题)+ 来源任务/模块/优先级/评审态/健康度 过滤,纯前端内存过滤。
  const [libQ, setLibQ] = useState("");
  const [libTask, setLibTask] = useState("");
  const [libModule, setLibModule] = useState("");
  const [libPri, setLibPri] = useState("");
  const [libReview, setLibReview] = useState("");
  const [libHealth, setLibHealth] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [drawerKey, setDrawerKey] = useState<string | null>(null);
  const [addToSuite, setAddToSuite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [localReload, setLocalReload] = useState(0);
  // 隔离理由弹窗的目标条目(null = 关闭)。批量隔离与抽屉「隔离」共用这一个受控弹窗——
  // window.prompt 在 Electron 渲染进程会抛 TypeError,后续 fetch 根本不会执行(见 PromptDialog)。
  const [quarantineKeys, setQuarantineKeys] = useState<Array<{ task: string; originalId: string }> | null>(null);
  // 按来源任务折叠用例列表（默认空 = 全部展开）。本版不持久化，与看板 collapsedCats 一致；
  // 筛选/检索活跃时忽略折叠、强制展开（见渲染处），避免命中项藏在折叠分组里。
  const [collapsedTasks, setCollapsedTasks] = useState<Set<string>>(new Set());
  const toggleTask = (task: string) => setCollapsedTasks((s) => { const n = new Set(s); if (n.has(task)) n.delete(task); else n.add(task); return n; });

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/test/library?projectPath=${encodeURIComponent(projectPath)}`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setData({ total: d?.total ?? 0, updatedAt: d?.updatedAt ?? "", tasks: Array.isArray(d?.tasks) ? d.tasks : [] }); })
      .catch(() => { if (!cancelled) setData({ total: 0, updatedAt: "", tasks: [] }); });
    fetch(`/api/test/library/history?projectPath=${encodeURIComponent(projectPath)}`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setHist(d?.cases ? (d as HistoryDTO) : null); })
      .catch(() => { if (!cancelled) setHist(null); });
    return () => { cancelled = true; };
  }, [projectPath, reloadSignal, localReload]);

  const refresh = () => { setSel(new Set()); setLocalReload((n) => n + 1); onChanged(); };

  // 历史侧按身份索引;库侧条目 join 上去。history 未就绪时以安全默认渲染(不闪徽标)。
  const histByKey = useMemo(() => {
    const m = new Map<string, HistCase>();
    for (const c of hist?.cases ?? []) m.set(caseKey(c.task, c.originalId), c);
    return m;
  }, [hist]);

  const del = async (task: string, originalId?: string, count?: number) => {
    const ok = originalId
      ? window.confirm(t("test.library.confirmRemove"))
      : window.confirm(t("test.library.confirmRemoveTask", { task, count: count ?? 0 }));
    if (!ok) return;
    try {
      await fetch("/api/test/library", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectPath, task, originalId }),
      });
      refresh();
    } catch { /* keep current view; user can retry */ }
  };

  const selKeys = () => [...sel].map(caseKeyDec);

  const batchReview = async () => {
    setBusy(true);
    try {
      await fetch("/api/test/library/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectPath, keys: selKeys(), reviewState: "approved" }),
      });
      refresh();
    } catch { /* keep view */ } finally { setBusy(false); }
  };

  // 隔离写入(批量 / 单条共用)。理由由 PromptDialog 收集后传入,可为空(服务端兜底「手动隔离」)。
  const doQuarantine = async (keys: Array<{ task: string; originalId: string }>, reason: string) => {
    setBusy(true);
    try {
      await fetch("/api/test/library/quarantine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectPath, keys, quarantined: true, reason }),
      });
      refresh();
    } catch { /* keep view */ } finally { setBusy(false); }
  };

  const batchRemove = async () => {
    if (!window.confirm(t("test.library.confirmBatchRemove", { n: sel.size }))) return;
    setBusy(true);
    try {
      // 库 DELETE 是单条/单任务口径,批量按条目逐个删(条数量级为个位数~百,可接受)。
      for (const k of selKeys()) {
        await fetch("/api/test/library", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectPath, task: k.task, originalId: k.originalId }),
        });
      }
      refresh();
    } catch { /* keep view */ } finally { setBusy(false); }
  };

  const taskCount = data?.tasks.length ?? 0;
  // 过滤下拉的候选值(来自库现存条目)。
  const { priOptions, moduleOptions } = useMemo(() => {
    const pri = new Set<string>();
    const mod = new Set<string>();
    for (const g of data?.tasks ?? []) for (const e of g.entries) {
      if (e.priority) pri.add(e.priority);
      if (e.module) mod.add(e.module);
    }
    return { priOptions: [...pri].sort(), moduleOptions: [...mod].sort() };
  }, [data]);

  // 过滤视图:组内条目过滤,空组隐藏;命中数用于工具条反馈。
  const filteredTasks = useMemo(() => {
    if (!data) return [];
    const q = libQ.trim().toLowerCase();
    return data.tasks
      .filter((g) => !libTask || g.task === libTask)
      .map((g) => ({
        ...g,
        entries: g.entries.filter((e) => {
          const oid = e._source?.originalId || e.id || "";
          const h = histByKey.get(caseKey(g.task, oid));
          if (libPri && e.priority !== libPri) return false;
          if (libModule && e.module !== libModule) return false;
          if (libReview && (e._lib?.reviewState ?? "approved") !== libReview) return false;
          if (libHealth && (h?.health ?? "ok") !== libHealth) return false;
          if (!q) return true;
          return oid.toLowerCase().includes(q) || (e.purpose ?? "").toLowerCase().includes(q);
        }),
      }))
      .filter((g) => g.entries.length > 0);
  }, [data, histByKey, libQ, libTask, libModule, libPri, libReview, libHealth]);
  const filteredCount = filteredTasks.reduce((n, g) => n + g.entries.length, 0);
  const filterActive = !!(libQ.trim() || libTask || libModule || libPri || libReview || libHealth);

  const summary = hist?.summary;
  const drawerCase = useMemo(() => {
    if (!drawerKey) return null;
    const { task, originalId } = caseKeyDec(drawerKey);
    const g = data?.tasks.find((x) => x.task === task);
    const entry = g?.entries.find((e) => (e._source?.originalId || e.id) === originalId);
    return entry ? { task, originalId, entry, hist: histByKey.get(drawerKey) ?? null } : null;
  }, [drawerKey, data, histByKey]);

  const selectClass = "h-6 rounded border border-border bg-background px-1 text-[10px] text-muted-foreground outline-none";
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-card">
      {data && data.total > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-1.5 text-[11px] text-muted-foreground">
          <FolderOpen size={13} className="text-primary" />
          <span>{t("test.library.summary", { total: data.total, tasks: taskCount })}</span>
          {summary && (
            <>
              {summary.flaky > 0 && <span className="text-status-warning-foreground">flaky {summary.flaky}</span>}
              {summary.streak > 0 && <span className="text-status-error-foreground">{t("test.health.streak", { n: summary.streak })}</span>}
              {summary.quarantined > 0 && <span className="text-status-info-foreground">{t("test.health.quarantined")} {summary.quarantined}</span>}
              {summary.pending > 0 && <span>{t("test.library.reviewPending")} {summary.pending}</span>}
            </>
          )}
        </div>
      )}
      {data && data.total > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-1.5">
          <div className="flex h-6 min-w-[150px] flex-1 items-center gap-1 rounded border border-border bg-background px-1.5">
            <MagnifyingGlass size={11} className="flex-shrink-0 text-muted-foreground" />
            <input
              value={libQ}
              onChange={(e) => setLibQ(e.target.value)}
              placeholder={t("test.library.searchPh")}
              className="w-full bg-transparent text-[11px] outline-none placeholder:text-muted-foreground"
            />
          </div>
          <select value={libTask} onChange={(e) => setLibTask(e.target.value)} className={selectClass} aria-label={t("test.library.filterTask")}>
            <option value="">{t("test.library.filterTask")}：{t("test.library.filterAll")}</option>
            {(data?.tasks ?? []).map((g) => <option key={g.task} value={g.task}>{g.task}</option>)}
          </select>
          <select value={libModule} onChange={(e) => setLibModule(e.target.value)} className={selectClass} aria-label={t("test.library.filterModule")}>
            <option value="">{t("test.library.filterModule")}：{t("test.library.filterAll")}</option>
            {moduleOptions.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          <select value={libPri} onChange={(e) => setLibPri(e.target.value)} className={selectClass} aria-label={t("test.library.filterPri")}>
            <option value="">{t("test.library.filterPri")}：{t("test.library.filterAll")}</option>
            {priOptions.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          <select value={libReview} onChange={(e) => setLibReview(e.target.value)} className={selectClass} aria-label={t("test.library.filterReview")}>
            <option value="">{t("test.library.filterReview")}：{t("test.library.filterAll")}</option>
            <option value="approved">{t("test.library.reviewApproved")}</option>
            <option value="pending">{t("test.library.reviewPending")}</option>
          </select>
          <select value={libHealth} onChange={(e) => setLibHealth(e.target.value)} className={selectClass} aria-label={t("test.library.filterHealth")}>
            <option value="">{t("test.library.filterHealth")}：{t("test.library.filterAll")}</option>
            <option value="flaky">{t("test.health.flaky")}</option>
            <option value="streak">{t("test.health.streakFilter")}</option>
            <option value="stale">{t("test.health.stale")}</option>
            <option value="never">{t("test.health.never")}</option>
            <option value="quar">{t("test.health.quarantined")}</option>
          </select>
          {filterActive && <span className="text-[10px] text-primary">{t("test.library.filterHit", { n: filteredCount })}</span>}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        {data === null ? (
          <div className="p-4 text-center text-[11px] text-muted-foreground"><SpinnerGap size={14} className="mx-auto animate-spin" /></div>
        ) : data.total === 0 ? (
          <div className="p-6 text-center text-[11px] leading-relaxed text-muted-foreground">{t("test.library.empty")}</div>
        ) : (
          <div className="divide-y divide-border">
            {filteredTasks.map((g) => {
              // 筛选/检索活跃时强制展开，避免命中项藏在折叠分组里（看起来像"搜不到"）。
              const collapsed = !filterActive && collapsedTasks.has(g.task);
              return (
              <div key={g.task} className="px-3 py-2">
                <div
                  role="button"
                  tabIndex={0}
                  aria-expanded={!collapsed}
                  onClick={() => toggleTask(g.task)}
                  onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); toggleTask(g.task); } }}
                  className="mb-1.5 flex cursor-pointer select-none items-center gap-2 rounded hover:bg-muted/40"
                >
                  <CaretDown size={12} className={`flex-shrink-0 text-muted-foreground transition-transform ${collapsed ? "-rotate-90" : ""}`} />
                  <span className="text-[11px] font-semibold text-foreground">{g.task}</span>
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{g.count}</span>
                  <span className="flex-1" />
                  <button
                    onClick={(ev) => { ev.stopPropagation(); del(g.task, undefined, g.count); }}
                    className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-status-error-muted hover:text-status-error-foreground"
                  >
                    <Trash size={10} /> {t("test.library.removeTask")}
                  </button>
                </div>
                {!collapsed && (
                <div className="space-y-1">
                  {g.entries.map((e, i) => {
                    const oid = e._source?.originalId || e.id || "";
                    const k = caseKey(g.task, oid);
                    const h = histByKey.get(k);
                    const badge = h ? healthBadge(t, h) : null;
                    const review = e._lib?.reviewState ?? "approved";
                    const rev = e._lib?.rev ?? 1;
                    return (
                      <div
                        key={i}
                        onClick={() => setDrawerKey(k)}
                        className="flex cursor-pointer items-center gap-2 rounded border border-border/60 bg-muted/20 px-2 py-1 hover:bg-muted/50"
                      >
                        <input
                          type="checkbox"
                          checked={sel.has(k)}
                          onClick={(ev) => ev.stopPropagation()}
                          onChange={() => setSel((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; })}
                          className="accent-primary"
                          aria-label={oid}
                        />
                        {h?.pinned && <PushPin size={10} weight="fill" className="flex-shrink-0 text-primary" aria-label={t("test.library.pinned")} />}
                        <span className="font-mono text-[10px] text-muted-foreground">{oid}</span>
                        {e.priority && <span className="rounded bg-muted px-1 text-[9px] text-muted-foreground">{e.priority}</span>}
                        <span className="min-w-0 flex-1 truncate text-[11px] text-foreground" title={e.purpose}>{e.purpose || "—"}</span>
                        {e.module && <span className="hidden rounded bg-muted px-1 text-[9px] text-muted-foreground sm:inline">{e.module}</span>}
                        <span className={`rounded px-1 text-[9px] ${review === "approved" ? "bg-status-success-muted text-status-success-foreground" : "bg-status-warning-muted text-status-warning-foreground"}`}>
                          {review === "approved" ? t("test.library.reviewApproved") : t("test.library.reviewPending")}
                        </span>
                        {badge && <span className={`rounded px-1 text-[9px] ${badge.cls}`}>{badge.label}</span>}
                        {h && <LastResultDot t={t} res={h.res} />}
                        <span className="font-mono text-[9px] text-muted-foreground" title={t("test.library.rev", { n: rev })}>r{rev}</span>
                        <button
                          onClick={(ev) => { ev.stopPropagation(); del(g.task, oid); }}
                          className="text-muted-foreground hover:text-status-error-foreground"
                          title={t("test.library.remove")}
                          aria-label={t("test.library.remove")}
                        >
                          <Trash size={11} />
                        </button>
                      </div>
                    );
                  })}
                </div>
                )}
              </div>
              );
            })}
          </div>
        )}
      </div>
      {sel.size > 0 && (
        <div className="sticky bottom-0 flex flex-wrap items-center gap-2 border-t border-border bg-card px-3 py-2 shadow-lg">
          <span className="text-[11px] text-foreground">{t("test.library.selected", { n: sel.size })}</span>
          <span className="flex-1" />
          <button disabled={busy} onClick={batchReview} className="flex h-6 items-center gap-1 rounded border border-border px-2 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40">
            <Check size={10} /> {t("test.library.batchApprove")}
          </button>
          <button disabled={busy} onClick={() => setAddToSuite(true)} className="flex h-6 items-center gap-1 rounded border border-border px-2 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40">
            <Plus size={10} /> {t("test.library.batchAddSuite")}
          </button>
          <button disabled={busy} onClick={() => setQuarantineKeys(selKeys())} className="flex h-6 items-center gap-1 rounded border border-border px-2 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40">
            <Prohibit size={10} /> {t("test.library.batchQuarantine")}
          </button>
          <button disabled={busy} onClick={batchRemove} className="flex h-6 items-center gap-1 rounded border border-border px-2 text-[11px] text-muted-foreground hover:bg-status-error-muted hover:text-status-error-foreground disabled:opacity-40">
            <Trash size={10} /> {t("test.library.batchRemove")}
          </button>
          <button onClick={() => setSel(new Set())} className="text-muted-foreground hover:text-foreground" title={t("test.library.clearSelection")} aria-label={t("test.library.clearSelection")}>
            <X size={12} />
          </button>
        </div>
      )}
      {drawerCase && (
        <CaseDrawer
          t={t}
          projectPath={projectPath}
          task={drawerCase.task}
          originalId={drawerCase.originalId}
          entry={drawerCase.entry}
          hist={drawerCase.hist}
          rounds={hist?.rounds ?? []}
          onClose={() => setDrawerKey(null)}
          onChanged={() => { setDrawerKey(null); refresh(); }}
          onQuarantine={() => { setDrawerKey(null); setQuarantineKeys([{ task: drawerCase.task, originalId: drawerCase.originalId }]); }}
        />
      )}
      <PromptDialog
        open={quarantineKeys !== null}
        onOpenChange={(o) => { if (!o) setQuarantineKeys(null); }}
        title={t("test.library.quarantinePrompt", { n: quarantineKeys?.length ?? 0 })}
        confirmLabel={t("common.confirm")}
        cancelLabel={t("common.cancel")}
        requireValue={false}
        onConfirm={async (reason) => { if (quarantineKeys) await doQuarantine(quarantineKeys, reason); }}
      />
      {addToSuite && (
        <AddToSuiteModal
          t={t}
          projectPath={projectPath}
          keys={selKeys()}
          onClose={() => setAddToSuite(false)}
          onDone={() => { setAddToSuite(false); refresh(); }}
        />
      )}
    </div>
  );
}

// 用例详情抽屉(屏 1 行点击):步骤表、跨轮执行历史圆点(含翻转/连败)、rev 变更时间线、
// 隔离说明与恢复、操作区。数据全部来自父级已取的两个 API,抽屉本身不再发请求(除写操作)。
function CaseDrawer({ t, projectPath, task, originalId, entry, hist, rounds, onClose, onChanged, onQuarantine }: {
  t: T;
  projectPath: string;
  task: string;
  originalId: string;
  entry: LibEntry;
  hist: HistCase | null;
  rounds: HistRound[];
  onClose: () => void;
  onChanged: () => void;
  onQuarantine: () => void;
}) {
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const meta = entry._lib;
  const review = meta?.reviewState ?? "approved";
  const rev = meta?.rev ?? 1;
  const quarantined = meta?.quarantined ?? false;
  const steps = entry.steps ?? [];
  // 存量条目没有 rev 时间线 → 用入库时间兜一条「首次入库」，与原型一致。
  const history = meta?.history?.length
    ? meta.history
    : [{ rev, at: entry._source?.depositedAt ?? "", note: t("test.library.fromTask") + "：" + task }];
  const badge = hist ? healthBadge(t, hist) : null;

  const post = async (url: string, body: Record<string, unknown>) => {
    setBusy(true);
    try {
      await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectPath, ...body }) });
      onChanged();
    } catch { setBusy(false); }
  };
  const keys = [{ task, originalId }];
  const fmtAt = (iso: string) => (iso ? iso.slice(0, 10) : "—");

  return (
    <div className="fixed inset-0 z-[60] flex justify-end bg-black/50" onClick={onClose}>
      <div
        role="dialog"
        aria-label={t("test.case.title")}
        className="flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-border bg-background p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] text-muted-foreground">{originalId}</span>
          {entry.priority && <span className="rounded bg-muted px-1 text-[9px] text-muted-foreground">{entry.priority}</span>}
          {badge && <span className={`rounded px-1 text-[9px] ${badge.cls}`}>{badge.label}</span>}
          <span className="flex-1" />
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label={t("test.case.close")}><X size={14} /></button>
        </div>
        <h3 className="mt-1 flex items-start gap-1.5 text-[13px] font-semibold text-foreground">
          {hist?.pinned && <PushPin size={12} weight="fill" className="mt-0.5 flex-shrink-0 text-primary" />}
          {entry.purpose || originalId}
        </h3>
        <div className="mt-1 text-[10px] text-muted-foreground">
          {t("test.case.source", { task, id: originalId, at: fmtAt(entry._source?.depositedAt ?? "") })}
          {" · r"}{rev}
          {" · "}{review === "approved" ? t("test.library.reviewApproved") : t("test.library.reviewPending")}
        </div>

        <dl className="mt-3 grid grid-cols-[80px_1fr] gap-x-2 gap-y-1 text-[11px]">
          {entry.module && (<><dt className="text-muted-foreground">{t("test.case.module")}</dt><dd className="text-foreground">{entry.module}</dd></>)}
          {entry.caseType && (<><dt className="text-muted-foreground">{t("test.case.caseType")}</dt><dd className="text-foreground">{entry.caseType}</dd></>)}
          {entry.requirement && (<><dt className="text-muted-foreground">{t("test.case.requirement")}</dt><dd className="font-mono text-foreground">{entry.requirement}</dd></>)}
          {entry.tags?.length ? (<><dt className="text-muted-foreground">{t("test.case.tags")}</dt><dd className="flex flex-wrap gap-1">{entry.tags.map((tg) => <span key={tg} className="rounded bg-status-info-muted px-1 text-[9px] text-status-info-foreground">{tg}</span>)}</dd></>) : null}
        </dl>

        <div className="mt-4 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{t("test.case.steps")}</div>
        {steps.length === 0 ? (
          <div className="mt-1 text-[11px] text-muted-foreground">{t("test.case.noSteps")}</div>
        ) : (
          <div className="mt-1 overflow-hidden rounded border border-border text-[11px]">
            <div className="grid grid-cols-[24px_1fr_1fr] bg-muted text-[9px] font-semibold text-muted-foreground">
              <div className="px-2 py-1">{t("test.case.stepNo")}</div>
              <div className="border-l border-border px-2 py-1">{t("test.case.stepAction")}</div>
              <div className="border-l border-border px-2 py-1">{t("test.case.stepExpected")}</div>
            </div>
            {steps.map((s, i) => (
              <div key={i} className="grid grid-cols-[24px_1fr_1fr] border-t border-border">
                <div className="px-2 py-1 font-mono text-muted-foreground">{i + 1}</div>
                <div className="border-l border-border px-2 py-1 text-foreground">{s.content || "—"}</div>
                <div className="border-l border-border px-2 py-1 text-foreground">{s.expected || "—"}</div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-4 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t("test.case.execHistory", { n: rounds.length })}
        </div>
        {!hist || rounds.length === 0 ? (
          <div className="mt-1 text-[11px] text-muted-foreground">{t("test.case.execHistoryEmpty")}</div>
        ) : (
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {hist.res.map((r, i) => (
              <span
                key={rounds[i]?.roundId ?? i}
                title={`${rounds[i]?.roundId ?? ""} · ${r === "p" ? t("test.library.lastResultPass") : r === "f" ? t("test.library.lastResultFail") : t("test.library.lastResultNone")}`}
                className={`inline-block h-2 w-2 rounded-full ${r === "p" ? "bg-status-success-foreground" : r === "f" ? "bg-status-error-foreground" : "bg-border"}`}
              />
            ))}
            <span className="ml-1 text-[10px] text-muted-foreground">
              {t("test.case.flips", { n: hist.flips })} · {t("test.case.tailFails", { n: hist.tailFails })}
            </span>
          </div>
        )}

        {quarantined && (
          <div className="mt-3 rounded border border-border bg-muted/40 px-2.5 py-2 text-[11px]">
            <div className="font-medium text-status-info-foreground">{t("test.case.quarantinedAt", { at: fmtAt(meta?.quarantinedAt ?? "") })}</div>
            {meta?.quarantineReason && <div className="mt-0.5 text-muted-foreground">{meta.quarantineReason}</div>}
            <div className="mt-1 text-[10px] leading-relaxed text-muted-foreground">{t("test.case.quarantineNote")}</div>
            <button
              disabled={busy}
              onClick={() => post("/api/test/library/quarantine", { keys, quarantined: false })}
              className="mt-1.5 flex h-6 items-center gap-1 rounded border border-border px-2 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40"
            >
              <ArrowClockwise size={10} /> {t("test.case.unquarantine")}
            </button>
          </div>
        )}

        <div className="mt-4 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{t("test.case.revTimeline")}</div>
        <div className="mt-1 flex flex-col gap-1.5 border-l-2 border-border pl-3 text-[11px]">
          {history.map((h, i) => (
            <div key={i} className="relative">
              <span className={`absolute -left-[17px] top-1.5 h-1.5 w-1.5 rounded-full ${i === 0 ? "bg-primary" : "bg-border"}`} />
              <span className="font-mono font-semibold text-foreground">r{h.rev}</span>
              <span className="text-muted-foreground"> · {fmtAt(h.at)} — {h.note}</span>
            </div>
          ))}
        </div>

        <div className="mt-4 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{t("test.case.actions")}</div>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {review === "pending" && (
            <button
              disabled={busy}
              onClick={() => post("/api/test/library/review", { keys, reviewState: "approved" })}
              className="flex h-6 items-center gap-1 rounded bg-primary px-2 text-[11px] font-medium text-primary-foreground disabled:opacity-40"
            >
              <Check size={10} /> {t("test.case.approve")}
            </button>
          )}
          <button
            disabled
            title={t("test.case.recheckSoon")}
            className="flex h-6 cursor-not-allowed items-center gap-1 rounded border border-border px-2 text-[11px] text-muted-foreground opacity-50"
          >
            <ArrowsClockwise size={10} /> {t("test.case.recheck")}
          </button>
          {!quarantined && (
            <button
              disabled={busy}
              onClick={onQuarantine}
              className="flex h-6 items-center gap-1 rounded border border-border px-2 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40"
            >
              <Prohibit size={10} /> {t("test.case.quarantine")}
            </button>
          )}
          <button
            disabled={busy}
            onClick={async () => {
              if (!window.confirm(t("test.library.confirmRemove"))) return;
              setBusy(true);
              try {
                await fetch("/api/test/library", {
                  method: "DELETE",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ projectPath, task, originalId }),
                });
                onChanged();
              } catch { setBusy(false); }
            }}
            className="flex h-6 items-center gap-1 rounded border border-border px-2 text-[11px] text-muted-foreground hover:bg-status-error-muted hover:text-status-error-foreground disabled:opacity-40"
          >
            <Trash size={10} /> {t("test.case.remove")}
          </button>
        </div>
      </div>
    </div>
  );
}

// 「加入套件」弹窗(库总览批量条):只列静态套件——查询套件保存的是【条件】,由条件自动圈选,
// 手工塞入会让「条件即真相」的语义失效(与原型 openAddToSuite 一致)。
function AddToSuiteModal({ t, projectPath, keys, onClose, onDone }: {
  t: T;
  projectPath: string;
  keys: Array<{ task: string; originalId: string }>;
  onClose: () => void;
  onDone: () => void;
}) {
  const [suites, setSuites] = useState<SuiteDTO[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/test/suites?projectPath=${encodeURIComponent(projectPath)}`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setSuites((Array.isArray(d?.suites) ? d.suites : []).filter((s: SuiteDTO) => s.type === "static")); })
      .catch(() => { if (!cancelled) setSuites([]); });
    return () => { cancelled = true; };
  }, [projectPath]);

  const add = async (s: SuiteDTO) => {
    setBusy(true);
    setMsg("");
    // 静态套件是固定清单:并集去重后整体覆盖保存(套件 POST 是 upsert by name)。
    const have = new Set((s.keys ?? []).map((k) => caseKey(k.task, k.originalId)));
    const merged = [...(s.keys ?? [])];
    let added = 0;
    for (const k of keys) if (!have.has(caseKey(k.task, k.originalId))) { merged.push(k); added++; }
    try {
      const r = await fetch("/api/test/suites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectPath, suite: { name: s.name, type: "static", keys: merged } }),
      }).then((x) => x.json());
      if (r?.ok) { setMsg(t("test.library.addToSuiteDone", { suite: s.name, n: added })); setTimeout(onDone, 900); }
      else { setMsg(r?.error || "failed"); setBusy(false); }
    } catch { setMsg("failed"); setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="flex max-h-[80vh] w-full max-w-sm flex-col overflow-hidden rounded-xl border border-border bg-background shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Plus size={13} className="text-primary" />
          <span className="text-xs font-semibold text-foreground">{t("test.library.addToSuiteTitle")}</span>
          <span className="flex-1" />
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label={t("test.case.close")}><X size={14} /></button>
        </div>
        <div className="space-y-2 p-3">
          <div className="text-[10px] leading-relaxed text-muted-foreground">{t("test.library.addToSuiteHint", { n: keys.length })}</div>
          {suites === null ? (
            <div className="p-3 text-center"><SpinnerGap size={14} className="mx-auto animate-spin text-muted-foreground" /></div>
          ) : suites.length === 0 ? (
            <div className="p-3 text-center text-[11px] text-muted-foreground">{t("test.library.addToSuiteNone")}</div>
          ) : (
            <div className="divide-y divide-border overflow-hidden rounded border border-border">
              {suites.map((s) => (
                <button
                  key={s.name}
                  disabled={busy}
                  onClick={() => add(s)}
                  className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-[11px] hover:bg-muted disabled:opacity-40"
                >
                  <span className="flex-1 truncate text-foreground">{s.name}</span>
                  <span className="rounded border border-border px-1 text-[9px] text-muted-foreground">{s.keys?.length ?? 0}</span>
                </button>
              ))}
            </div>
          )}
          {msg && <div className="text-[10px] text-primary">{msg}</div>}
        </div>
      </div>
    </div>
  );
}
// 轮次历史区块(批 H 页面化,原弹窗):轮次 = 一次回归执行实例(TestRail Run 语义)。列表(时间/环境/
// 套件/模式/状态/通过/红线)+ 行内展开详情(按来源任务分组结果 + 与上一全量轮的 delta 三类,
// 交集口径)+ 删单轮(报告/快照/证据一并删)。数据全部来自 rounds / rounds/detail 只读 API。
interface RoundUI {
  roundId: string; startedAt?: string; env?: string; suiteName?: string; mode?: string;
  status?: string; total?: number; counts?: Record<string, number>; suitePassStr?: string;
  /** 复测轮的合并口径(每条用例跨轮的最新结果);全量轮不返回。 */
  mergedPassStr?: string;
  parentRoundId?: string;
}

/** 迷你通过率趋势线(近 N 轮)。纯展示,无交互。 */
function Sparkline({ values, width = 96, height = 22 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return null;
  const min = Math.min(...values) - 3;
  const max = Math.max(...values) + 3;
  const span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * (width - 6) + 3},${height - 3 - ((v - min) / span) * (height - 6)}`);
  const [lx, ly] = pts[pts.length - 1].split(",");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" className="inline-block align-middle">
      <polyline points={pts.join(" ")} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" className="text-primary" />
      <circle cx={lx} cy={ly} r="2.2" className="fill-primary" />
    </svg>
  );
}
interface RoundDetailUI {
  groups: Array<{ task: string; counts: Record<string, number>; tests: Array<{ task: string; originalId: string; purpose: string; status: string }> }>;
  delta: { baseRoundId: string; newFail: unknown[]; fixed: unknown[]; stillFail: unknown[] } | null;
}
function RegressionRoundsSection({ t, projectPath, reloadSignal, model, providerId, reportRoundId, onOpenReport, onBack, onRetest }: {
  t: T; projectPath: string; reloadSignal: number;
  model: string; providerId: string;
  /** 非 null = 下钻查看该轮完整报告(渲染嵌入的 RegressionReportSection);null = 显示轮次列表。 */
  reportRoundId: string | null;
  onOpenReport: (roundId: string) => void;
  onBack: () => void;
  onRetest: (parentRoundId: string) => void;
}) {
  const [rounds, setRounds] = useState<RoundUI[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, RoundDetailUI | null>>({});
  const [reload, setReload] = useState(0);
  const [envFilter, setEnvFilter] = useState("");
  const [passRates, setPassRates] = useState<number[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/test/library/rounds?projectPath=${encodeURIComponent(projectPath)}`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setRounds(Array.isArray(d?.rounds) ? d.rounds : []); })
      .catch(() => { if (!cancelled) setRounds([]); });
    // 通过率趋势(旧→新):与矩阵/健康度同源的 passRates,避免与轮次索引里的摘要口径打架。
    fetch(`/api/test/library/history?projectPath=${encodeURIComponent(projectPath)}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        const pr = (Array.isArray(d?.passRates) ? d.passRates : [])
          .filter((p: { total: number }) => p.total > 0)
          .map((p: { pass: number; total: number }) => Math.round((p.pass / p.total) * 100));
        setPassRates(pr);
      })
      .catch(() => { if (!cancelled) setPassRates([]); });
    return () => { cancelled = true; };
  }, [projectPath, reload, reloadSignal]);

  const toggleDetail = (roundId: string) => {
    if (openId === roundId) { setOpenId(null); return; }
    setOpenId(roundId);
    if (details[roundId] !== undefined) return;
    fetch(`/api/test/library/rounds/detail?projectPath=${encodeURIComponent(projectPath)}&roundId=${encodeURIComponent(roundId)}`)
      .then((r) => r.json())
      .then((d) => setDetails((m) => ({ ...m, [roundId]: d?.groups ? { groups: d.groups, delta: d.delta ?? null } : null })))
      .catch(() => setDetails((m) => ({ ...m, [roundId]: null })));
  };

  const delRound = async (roundId: string) => {
    if (!window.confirm(t("test.rounds.confirmDelete", { round: roundId }))) return;
    try {
      await fetch("/api/test/library/rounds", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectPath, roundId }),
      });
      setReload((n) => n + 1);
    } catch { /* keep view */ }
  };

  const fmtTime = (iso?: string) => {
    if (!iso) return "—";
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };
  const passOf = (r: RoundUI) => {
    if (r.suitePassStr) return r.suitePassStr;
    if (r.counts && typeof r.counts.total === "number") return `${r.counts.pass ?? 0}/${r.counts.total}`;
    return null;
  };
  // 红线徽标。**复测轮必须看合并口径**:它只跑上轮的失败子集,自身 3/3 通过不代表可发版——
  // 剩下那些没被重跑的用例,最新状态仍可能是失败(mergedPassStr 由 rounds API 算好)。
  const redline = (r: RoundUI) => {
    if (r.status === "running") return <span className="flex items-center gap-1 rounded bg-muted px-1.5 text-[9px] text-muted-foreground"><SpinnerGap size={9} className="animate-spin" /> {t("test.rounds.statusRunning")}</span>;
    if (r.status === "aborted") return <span className="rounded bg-muted px-1.5 text-[9px] text-muted-foreground">{t("test.rounds.statusAborted")}</span>;
    const isRetest = r.mode === "failed-only";
    const p = isRetest ? r.mergedPassStr : passOf(r);
    if (!p) return null;
    const [a, b] = p.split("/").map((x) => parseInt(x, 10));
    const ok = Number.isFinite(a) && Number.isFinite(b) && b > 0 && a === b;
    const cls = ok ? "bg-status-success-muted text-status-success-foreground" : "bg-status-error-muted text-status-error-foreground";
    const label = ok ? t("test.rounds.redlineOk") : t("test.rounds.redlineBlocked");
    return (
      <span className={`rounded px-1.5 text-[9px] ${cls}`} title={isRetest ? t("test.rounds.mergedHint") : undefined}>
        {isRetest ? `${t("test.rounds.mergedRedline", { pass: p })} · ${label}` : label}
      </span>
    );
  };
  const failCountOf = (r: RoundUI) => {
    const p = passOf(r);
    if (!p) return 0;
    const [a, b] = p.split("/").map((x) => parseInt(x, 10));
    return Number.isFinite(a) && Number.isFinite(b) ? Math.max(0, b - a) : 0;
  };
  const envOptions = [...new Set((rounds ?? []).map((r) => r.env).filter((e): e is string => !!e))];
  const shown = (rounds ?? []).filter((r) => !envFilter || r.env === envFilter);
  const dot = (status: string) => (
    <span className={`inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full ${status === "pass" ? "bg-status-success-foreground" : "bg-status-error-foreground"}`} />
  );

  // 下钻态:渲染该轮的完整报告(嵌入模式,带「返回列表」+ 上一轮/下一轮切换)。所有 hooks 已在上方调用。
  if (reportRoundId) {
    return (
      <RegressionReportSection
        t={t}
        projectPath={projectPath}
        reloadSignal={reloadSignal}
        model={model}
        providerId={providerId}
        controlledRoundId={reportRoundId}
        onBack={onBack}
        onSelectRound={onOpenReport}
      />
    );
  }

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-1.5">
          <Clock size={13} className="text-primary" />
          <span className="text-[11px] font-semibold text-foreground">{t("test.rounds.title")}</span>
          {rounds && rounds.length > 0 && <span className="text-[10px] text-muted-foreground">{rounds.length}</span>}
          {passRates.length > 1 && (
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
              {t("test.rounds.passTrend", { n: passRates.length })}
              <Sparkline values={passRates} />
              <b className="font-mono text-foreground">{passRates[passRates.length - 1]}%</b>
            </span>
          )}
          <span className="flex-1" />
          {envOptions.length > 1 && (
            <select
              value={envFilter}
              onChange={(e) => setEnvFilter(e.target.value)}
              aria-label={t("test.rounds.filterEnv")}
              className="h-6 rounded border border-border bg-background px-1 text-[10px] text-muted-foreground outline-none"
            >
              <option value="">{t("test.rounds.filterEnv")}</option>
              {envOptions.map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {rounds === null ? (
            <div className="p-4 text-center text-[11px] text-muted-foreground"><SpinnerGap size={14} className="mx-auto animate-spin" /></div>
          ) : shown.length === 0 ? (
            <div className="p-6 text-center text-[11px] leading-relaxed text-muted-foreground">{t("test.rounds.empty")}</div>
          ) : (
            <div className="divide-y divide-border">
              {shown.map((r) => {
                const detail = details[r.roundId];
                const open = openId === r.roundId;
                return (
                  <div key={r.roundId} className="px-3 py-1.5">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[10px] text-muted-foreground">{r.roundId}</span>
                      <span className="text-[10px] text-muted-foreground">{fmtTime(r.startedAt)}</span>
                      <span className="rounded border border-border px-1 text-[9px] text-muted-foreground">{r.env || "—"}</span>
                      <span className="min-w-0 flex-1 truncate text-[11px] text-foreground">{r.suiteName || "—"}</span>
                      {r.mode === "failed-only" && <span className="rounded bg-status-warning-muted px-1.5 text-[9px] text-status-warning-foreground">{t("test.rounds.modeRetest")}</span>}
                      {passOf(r) && <span className="font-mono text-[10px] text-foreground">{passOf(r)}</span>}
                      {redline(r)}
                      {r.status === "done" && r.mode !== "failed-only" && failCountOf(r) > 0 && (
                        <button
                          onClick={() => onRetest(r.roundId)}
                          className="flex items-center gap-0.5 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
                        >
                          <ArrowsClockwise size={9} /> {t("test.rounds.retestFailed", { n: failCountOf(r) })}
                        </button>
                      )}
                      <button onClick={() => toggleDetail(r.roundId)} className="flex items-center gap-0.5 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground">
                        {open ? <CaretUp size={9} /> : <CaretDown size={9} />} {open ? t("test.rounds.collapse") : t("test.rounds.detail")}
                      </button>
                      <button onClick={() => onOpenReport(r.roundId)} className="flex items-center gap-0.5 rounded border border-border px-1.5 py-0.5 text-[10px] text-primary hover:opacity-80">
                        {t("test.rounds.viewReport")} <ArrowRight size={9} />
                      </button>
                      <button onClick={() => delRound(r.roundId)} className="text-muted-foreground hover:text-status-error-foreground" title={t("test.rounds.delete")} aria-label={t("test.rounds.delete")}>
                        <Trash size={11} />
                      </button>
                    </div>
                    {open && (
                      <div className="mt-1.5 rounded border border-border/60 bg-muted/20 p-2">
                        {detail === undefined ? (
                          <div className="p-2 text-center"><SpinnerGap size={12} className="mx-auto animate-spin text-muted-foreground" /></div>
                        ) : detail === null || detail.groups.length === 0 ? (
                          <div className="p-1 text-[10px] text-muted-foreground">{t("test.rounds.detailEmpty")}</div>
                        ) : (
                          <div className="space-y-2">
                            <div className="text-[10px] text-muted-foreground">
                              {t("test.rounds.snapshot", {
                                n: r.total ?? 0,
                                suite: r.suiteName || "—",
                                mode: r.mode === "failed-only" ? t("test.rounds.modeRetest") : t("test.rounds.modeFull"),
                              })}
                              {r.parentRoundId && t("test.rounds.snapshotBase", { round: r.parentRoundId })}
                            </div>
                            {detail.delta ? (
                              <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                                <span className="text-muted-foreground">{t("test.rounds.deltaBase", { round: detail.delta.baseRoundId })}</span>
                                <span className="rounded bg-status-error-muted px-1.5 py-0.5 text-status-error-foreground">{t("test.rounds.deltaNewFail")} {detail.delta.newFail.length}</span>
                                <span className="rounded bg-status-success-muted px-1.5 py-0.5 text-status-success-foreground">{t("test.rounds.deltaFixed")} {detail.delta.fixed.length}</span>
                                <span className="rounded bg-status-warning-muted px-1.5 py-0.5 text-status-warning-foreground">{t("test.rounds.deltaStillFail")} {detail.delta.stillFail.length}</span>
                              </div>
                            ) : (
                              <div className="text-[10px] text-muted-foreground">{t("test.rounds.deltaNone")}</div>
                            )}
                            {detail.groups.map((g) => (
                              <div key={g.task}>
                                <div className="mb-0.5 flex items-center gap-1.5">
                                  <span className="text-[10px] font-semibold text-foreground">{g.task}</span>
                                  <span className={`rounded px-1 text-[9px] ${g.counts.pass === g.counts.total ? "bg-status-success-muted text-status-success-foreground" : "bg-status-error-muted text-status-error-foreground"}`}>
                                    {g.counts.pass ?? 0}/{g.counts.total ?? 0}
                                  </span>
                                </div>
                                <div className="space-y-0.5">
                                  {g.tests.map((c) => (
                                    <div key={`${g.task}-${c.originalId}`} className="flex items-center gap-1.5 pl-1">
                                      {dot(c.status)}
                                      <span className="font-mono text-[9px] text-muted-foreground">{c.originalId}</span>
                                      <span className="min-w-0 flex-1 truncate text-[10px] text-foreground" title={c.purpose}>{c.purpose || "—"}</span>
                                      <span className="text-[9px] text-muted-foreground">{c.status}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
    </div>
  );
}

// 屏 5「对比矩阵」+ 屏 6「健康度」共用的数据钩子:一次 GET /api/test/library/history 拿全。
// 矩阵与健康度是同一份跨轮矩阵的两种读法——徽标、翻转/连败、队列分类必须来自同一处派生,
// 否则「库总览说 flaky、健康度说健康」这类不一致迟早出现。
function useCaseHistory(projectPath: string, reloadSignal: number, localReload: number) {
  const [data, setData] = useState<HistoryDTO | null | undefined>(undefined); // undefined=加载中
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/test/library/history?projectPath=${encodeURIComponent(projectPath)}`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setData(d?.cases ? (d as HistoryDTO) : null); })
      .catch(() => { if (!cancelled) setData(null); });
    return () => { cancelled = true; };
  }, [projectPath, reloadSignal, localReload]);
  return data;
}

/** 按来源任务分组(保持库序)。 */
function groupByTask<X extends { task: string }>(list: X[]): Array<[string, X[]]> {
  const m = new Map<string, X[]>();
  for (const c of list) { if (!m.has(c.task)) m.set(c.task, []); m.get(c.task)!.push(c); }
  return [...m.entries()];
}

const fmtDay = (iso?: string) => (iso ? iso.slice(5, 10) : "—");

// 对比矩阵(屏 5,二期):行 = 用例(按来源任务分组,首列 sticky) × 列 = 轮次。
// 对标 TestRail「Comparison for Cases」。全部由本地轮次索引 + 各轮 run.json 只读拼装。
function RegressionMatrixSection({ t, projectPath, reloadSignal, onOpenRound }: {
  t: T; projectPath: string; reloadSignal: number; onOpenRound: (roundId: string) => void;
}) {
  const hist = useCaseHistory(projectPath, reloadSignal, 0);
  const [failOnly, setFailOnly] = useState(false);

  if (hist === undefined) return <div className="p-4 text-center"><SpinnerGap size={14} className="mx-auto animate-spin text-muted-foreground" /></div>;
  if (!hist || hist.rounds.length === 0) {
    return <div className="rounded-xl border border-border bg-card p-6 text-center text-[11px] leading-relaxed text-muted-foreground">{t("test.matrix.empty")}</div>;
  }

  const rows = failOnly ? hist.cases.filter((c) => c.res.some((r) => r === "f")) : hist.cases;
  const cell = (r: CaseRes) =>
    r === "p" ? "bg-status-success-foreground/75" : r === "f" ? "bg-status-error-foreground/80" : "border border-border bg-muted";
  const resText = (r: CaseRes) => (r === "p" ? t("test.matrix.pass") : r === "f" ? t("test.matrix.fail") : t("test.matrix.none"));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <input type="checkbox" checked={failOnly} onChange={(e) => setFailOnly(e.target.checked)} className="accent-primary" />
          {t("test.matrix.failOnly")}
        </label>
        <span className="flex-1" />
        <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          {t("test.matrix.legend")}
          <span className={`inline-block h-3 w-5 rounded ${cell("p")}`} /> {t("test.matrix.pass")}
          <span className={`inline-block h-3 w-5 rounded ${cell("f")}`} /> {t("test.matrix.fail")}
          <span className={`inline-block h-3 w-5 rounded ${cell("-")}`} /> {t("test.matrix.none")}
        </span>
      </div>
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="min-w-full border-collapse text-[11px]">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 max-w-[280px] border-b border-border bg-card px-2 py-1.5 text-left text-[9.5px] font-semibold text-muted-foreground">
                {t("test.matrix.case")}
              </th>
              {hist.rounds.map((r) => (
                <th key={r.roundId} title={`${r.roundId} · ${r.env}`} className="whitespace-nowrap border-b border-border px-2 py-1.5 text-center text-[9.5px] font-semibold text-muted-foreground">
                  {fmtDay(r.startedAt)}<br />
                  <span className="font-normal">{r.env}</span>
                  {r.mode === "failed-only" && <><br /><span className="font-normal">{t("test.rounds.modeRetest")}</span></>}
                </th>
              ))}
              <th className="border-b border-border px-2 py-1.5 text-center text-[9.5px] font-semibold text-muted-foreground">{t("test.matrix.flips")}</th>
              <th className="border-b border-border px-2 py-1.5 text-center text-[9.5px] font-semibold text-muted-foreground">{t("test.matrix.streak")}</th>
            </tr>
          </thead>
          <tbody>
            {groupByTask(rows).map(([task, cs]) => (
              <Fragment key={task}>
                <tr>
                  <td colSpan={hist.rounds.length + 3} className="sticky left-0 border-b border-border bg-muted px-2 py-1 text-[10.5px] font-semibold text-foreground">
                    {task}
                  </td>
                </tr>
                {cs.map((c) => (
                  <tr key={`${c.task}-${c.originalId}`} className="hover:bg-muted/50">
                    <td className="sticky left-0 z-10 max-w-[280px] truncate border-b border-border bg-card px-2 py-1" title={c.purpose}>
                      <span className="font-mono text-[10px] text-muted-foreground">{c.originalId}</span>{" "}
                      <span className="text-foreground">{c.purpose || "—"}</span>
                    </td>
                    {c.res.map((r, i) => (
                      <td key={hist.rounds[i].roundId} className="border-b border-border px-2 py-1 text-center">
                        <button
                          onClick={() => onOpenRound(hist.rounds[i].roundId)}
                          title={t("test.matrix.cellTitle", { round: hist.rounds[i].roundId, result: resText(r) })}
                          aria-label={t("test.matrix.cellTitle", { round: hist.rounds[i].roundId, result: resText(r) })}
                          className={`inline-block h-3.5 w-5 rounded ${cell(r)}`}
                        />
                      </td>
                    ))}
                    <td className="border-b border-border px-2 py-1 text-center tabular-nums text-muted-foreground">{c.flips || ""}</td>
                    <td className={`border-b border-border px-2 py-1 text-center tabular-nums ${c.tailFails >= 3 ? "font-bold text-status-error-foreground" : "text-muted-foreground"}`}>
                      {c.tailFails || ""}
                    </td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// 健康度(屏 6,三期):统计卡 + 三条治理队列(flaky / 连败 / 久未跑)+ 隔离区 + 护栏。
//
// ⚠️ 跨轮翻转 ≠ 真 flaky(版本一直在变)。这些队列只是**候选**,最终判定依赖「AI 就地复核:
// 同版本连跑 3 次」——尚未实现,入口置灰。判定阈值集中在 lib/test/case-history.ts。
function RegressionHealthSection({ t, projectPath, reloadSignal, onChanged }: {
  t: T; projectPath: string; reloadSignal: number; onChanged: () => void;
}) {
  const [localReload, setLocalReload] = useState(0);
  const hist = useCaseHistory(projectPath, reloadSignal, localReload);
  const [queue, setQueue] = useState<"flaky" | "streak" | "stale">("flaky");
  const [busy, setBusy] = useState(false);
  const [quarantineTarget, setQuarantineTarget] = useState<HistCase | null>(null);

  // 隔离(reason 由 PromptDialog 收集,可空)/ 恢复(reason 传空)。window.prompt 在 Electron
  // 渲染进程抛 TypeError,故隔离改走受控弹窗;恢复无需理由,直接调用。
  const runQuarantine = async (c: HistCase, quarantined: boolean, reason: string) => {
    setBusy(true);
    try {
      await fetch("/api/test/library/quarantine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectPath, keys: [{ task: c.task, originalId: c.originalId }], quarantined, reason }),
      });
      setLocalReload((n) => n + 1);
      onChanged();
    } catch { /* keep view */ } finally { setBusy(false); }
  };

  if (hist === undefined) return <div className="p-4 text-center"><SpinnerGap size={14} className="mx-auto animate-spin text-muted-foreground" /></div>;
  if (!hist || hist.summary.total === 0) {
    return <div className="rounded-xl border border-border bg-card p-6 text-center text-[11px] leading-relaxed text-muted-foreground">{t("test.health.empty")}</div>;
  }

  const s = hist.summary;
  const rates = hist.passRates.filter((p) => p.total > 0).map((p) => Math.round((p.pass / p.total) * 100));
  const byHealth = (k: HealthKind) => hist.cases.filter((c) => c.health === k);
  const queues = { flaky: byHealth("flaky"), streak: byHealth("streak"), stale: [...byHealth("stale"), ...byHealth("never")] };
  const quarantined = byHealth("quar");
  const rows = queues[queue];

  const card = (label: string, value: ReactNode, hint?: ReactNode, color = "text-foreground") => (
    <div className="rounded-xl border border-border bg-card px-3.5 py-3">
      <div className="text-[10.5px] tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-0.5 flex items-baseline gap-1.5 text-xl font-semibold tabular-nums ${color}`}>
        {value}
        {hint && <small className="text-[10.5px] font-normal text-muted-foreground">{hint}</small>}
      </div>
    </div>
  );

  const dots = (c: HistCase) => (
    <span className="flex flex-wrap items-center gap-0.5">
      {c.res.map((r, i) => (
        <span
          key={hist.rounds[i]?.roundId ?? i}
          title={hist.rounds[i]?.roundId}
          className={`inline-block h-2 w-2 rounded-full ${r === "p" ? "bg-status-success-foreground" : r === "f" ? "bg-status-error-foreground" : "bg-border"}`}
        />
      ))}
    </span>
  );

  return (
    <div className="space-y-3">
      {s.quarantineAlert && (
        <div className="flex items-start gap-2 rounded-lg border border-status-warning-foreground/40 bg-status-warning-muted/40 px-3 py-2 text-[11px] text-status-warning-foreground">
          <Warning size={13} className="mt-0.5 flex-shrink-0" />
          <span>{t("test.health.guardrailAlert", { pct: Math.round(s.quarantineRatio * 100) })}</span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {card(t("test.health.cardTotal"), s.total)}
        {card(
          t("test.health.cardPassRate", { n: rates.length }),
          rates.length ? `${rates[rates.length - 1]}%` : "—",
          rates.length > 1 ? <Sparkline values={rates} width={64} height={18} /> : undefined,
        )}
        {card(t("test.health.cardFlaky"), s.flaky, t("test.health.cardFlakyHint"), "text-status-warning-foreground")}
        {card(t("test.health.cardStreak"), s.streak, t("test.health.cardStreakHint"), "text-status-error-foreground")}
        {card(t("test.health.cardQuarantine"), s.quarantined, t("test.health.cardQuarantineHint"), "text-status-info-foreground")}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {([
          ["flaky", t("test.health.queueFlaky", { n: queues.flaky.length })],
          ["streak", t("test.health.queueStreak", { n: queues.streak.length })],
          ["stale", t("test.health.queueStale", { n: queues.stale.length })],
        ] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setQueue(k)}
            className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${queue === k ? "border-foreground bg-foreground font-semibold text-background" : "border-border text-muted-foreground hover:text-foreground"}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {rows.length === 0 ? (
          <div className="p-6 text-center text-[11px] text-muted-foreground">{t("test.health.queueEmpty")}</div>
        ) : (
          <div className="divide-y divide-border">
            {rows.map((c) => (
              <div key={`${c.task}-${c.originalId}`} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <span className="font-mono text-[10px] text-muted-foreground">{c.originalId}</span>
                <span className="min-w-0 flex-1 truncate text-[11px] text-foreground" title={c.purpose}>{c.purpose || "—"}</span>
                <span className="rounded bg-muted px-1 text-[9px] text-muted-foreground">{c.task}</span>
                {dots(c)}
                {queue === "flaky" && (
                  <>
                    <button disabled title={t("test.case.recheckSoon")} className="flex h-6 cursor-not-allowed items-center gap-1 rounded border border-border px-1.5 text-[10px] text-muted-foreground opacity-50">
                      <ArrowsClockwise size={9} /> {t("test.health.recheck")}
                    </button>
                    <button disabled={busy} onClick={() => setQuarantineTarget(c)} className="flex h-6 items-center gap-1 rounded border border-border px-1.5 text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-40">
                      <Prohibit size={9} /> {t("test.case.quarantine")}
                    </button>
                  </>
                )}
                {queue === "streak" && (
                  <>
                    <span className="rounded bg-status-error-muted px-1.5 text-[9px] text-status-error-foreground">{t("test.health.streak", { n: c.tailFails })}</span>
                    {/* 连败的正解是转缺陷跟踪,不是隔离——隔离会把真实回归藏起来。 */}
                    <span className="text-[9.5px] text-muted-foreground">→ {t("test.health.toDefect")}</span>
                  </>
                )}
                {queue === "stale" && (
                  <span className="rounded border border-border px-1.5 text-[9px] text-muted-foreground">
                    {c.health === "never"
                      ? t("test.health.neverRun")
                      : t("test.health.lastRun", { at: fmtDay(hist.rounds[c.res.reduce((last, r, i) => (r !== "-" ? i : last), -1)]?.startedAt) })}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{t("test.health.quarantineSection")}</div>
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {quarantined.length === 0 ? (
          <div className="p-6 text-center text-[11px] text-muted-foreground">{t("test.health.quarantineEmpty")}</div>
        ) : (
          <div className="divide-y divide-border">
            {quarantined.map((c) => (
              <div key={`${c.task}-${c.originalId}`} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <span className="font-mono text-[10px] text-muted-foreground">{c.originalId}</span>
                <span className="min-w-0 truncate text-[11px] text-foreground" title={c.purpose}>{c.purpose || "—"}</span>
                <span className="rounded bg-muted px-1 text-[9px] text-muted-foreground">{c.task}</span>
                <span className="rounded bg-status-info-muted px-1.5 text-[9px] text-status-info-foreground">
                  {t("test.health.quarantineAt", { at: fmtDay(c.meta.quarantinedAt) })}
                </span>
                <span className="min-w-0 flex-1 truncate text-[10.5px] text-muted-foreground">{c.meta.quarantineReason}</span>
                <button disabled={busy} onClick={() => runQuarantine(c, false, "")} className="flex h-6 items-center gap-1 rounded border border-border px-1.5 text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-40">
                  <ArrowClockwise size={9} /> {t("test.health.restore")}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="flex items-start gap-1.5 text-[10px] leading-relaxed text-muted-foreground">
        <WarningCircle size={12} className="mt-0.5 flex-shrink-0" />
        <span>{t("test.health.guardrail")}</span>
      </div>
      <PromptDialog
        open={quarantineTarget !== null}
        onOpenChange={(o) => { if (!o) setQuarantineTarget(null); }}
        title={t("test.library.quarantinePrompt", { n: 1 })}
        confirmLabel={t("common.confirm")}
        cancelLabel={t("common.cancel")}
        requireValue={false}
        onConfirm={async (reason) => { if (quarantineTarget) await runQuarantine(quarantineTarget, true, reason); }}
      />
    </div>
  );
}

// 轮次报告(屏 4,二期):红/绿横幅 + delta 三卡(点击过滤)+ 按来源任务分组 + 失败行展开
// (AI 归因 / 证据缩略图 / 转缺陷)。
//
// 两条不可动摇的口径:
//   1. **复测轮看合并口径**——它只跑上轮失败子集,自身全过不代表可发版(mergedPassStr)。
//   2. **隔离条数强制曝光**——隔离不计红线,但横幅必须写「隔离中 N 条未计入」,否则隔离就成了
//      发版前把挂掉的用例扫到地毯下的工具。
interface VerdictUI { cls: string; act: string; why: string }
interface RoundTestUI {
  task: string; originalId: string; purpose: string; status: string;
  actual?: string; error?: string; evidence?: string[]; verdict?: VerdictUI;
  /** 判定来源:'script' = 脚本重放(行内显示「脚本」徽标);缺省 = AI 执行。 */
  via?: string;
}
interface RoundReportUI {
  round: RoundUI;
  groups: Array<{ task: string; counts: Record<string, number>; tests: RoundTestUI[] }>;
  delta: { baseRoundId: string; newFail: Array<{ task: string; originalId: string }>; fixed: Array<{ task: string; originalId: string }>; stillFail: Array<{ task: string; originalId: string }> } | null;
  quarantined: number;
  hasVerdicts: boolean;
}
type DeltaFilter = "" | "new" | "fixed" | "still";

function RegressionReportSection({ t, projectPath, reloadSignal, model, providerId, initialRoundId, controlledRoundId, onBack, onSelectRound }: {
  t: T; projectPath: string; reloadSignal: number; model: string; providerId: string;
  /** 从对比矩阵单元格跳转过来时预选该轮。 */
  initialRoundId?: string;
  /** 嵌入「轮次」tab 下钻详情时:受控选中轮 + 返回列表 + 切换上下轮。传了 onBack 即嵌入模式(隐藏下拉)。 */
  controlledRoundId?: string;
  onBack?: () => void;
  onSelectRound?: (roundId: string) => void;
}) {
  const [rounds, setRounds] = useState<RoundUI[] | null>(null);
  const [roundId, setRoundId] = useState<string>("");
  const [data, setData] = useState<RoundReportUI | null | undefined>(undefined); // undefined=加载中
  const [deltaFilter, setDeltaFilter] = useState<DeltaFilter>("");
  const [analysing, setAnalysing] = useState(false);
  const [defectMsg, setDefectMsg] = useState("");
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/test/library/rounds?projectPath=${encodeURIComponent(projectPath)}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        const list: RoundUI[] = (Array.isArray(d?.rounds) ? d.rounds : []).filter((r: RoundUI) => r.status !== "running");
        setRounds(list);
        setRoundId((cur) => {
          const want = controlledRoundId || cur || initialRoundId;
          return want && list.some((r) => r.roundId === want) ? want : list[0]?.roundId ?? "";
        });
      })
      .catch(() => { if (!cancelled) setRounds([]); });
    return () => { cancelled = true; };
  }, [projectPath, reloadSignal, initialRoundId, controlledRoundId]);

  // 嵌入模式:受控轮次变化时同步内部选中,并清掉上一轮残留的过滤/缺陷提示。
  useEffect(() => {
    if (controlledRoundId) { setRoundId(controlledRoundId); setDeltaFilter(""); setDefectMsg(""); }
  }, [controlledRoundId]);

  useEffect(() => {
    if (!roundId) return;
    let cancelled = false;
    fetch(`/api/test/library/rounds/detail?projectPath=${encodeURIComponent(projectPath)}&roundId=${encodeURIComponent(roundId)}`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setData(d?.groups ? (d as RoundReportUI) : null); })
      .catch(() => { if (!cancelled) setData(null); });
    return () => { cancelled = true; };
  }, [projectPath, roundId, reload]);

  const round = rounds?.find((r) => r.roundId === roundId);
  const counts = useMemo(() => {
    let pass = 0, total = 0;
    for (const g of data?.groups ?? []) for (const c of g.tests) { total++; if (c.status === "pass") pass++; }
    return { pass, total };
  }, [data]);
  const isRetest = round?.mode === "failed-only";
  // 红线:复测轮看合并口径,全量轮看本轮口径。
  const verdictOk = isRetest
    ? (() => { const m = round?.mergedPassStr?.split("/").map(Number); return !!m && m.length === 2 && m[0] === m[1]; })()
    : counts.total > 0 && counts.pass === counts.total;

  const analyse = async () => {
    setAnalysing(true);
    try {
      const res = await fetch("/api/test/library/verdict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectPath, roundId, model: model || undefined, providerId: providerId || undefined }),
      });
      if (res.body) { const rd = res.body.getReader(); for (;;) { const { done } = await rd.read(); if (done) break; } }
      setReload((n) => n + 1);
    } catch { /* 归因失败不影响报告主体 */ } finally { setAnalysing(false); }
  };

  const toDefect = async () => {
    setDefectMsg(t("test.report.defectRunning"));
    try {
      const res = await fetch("/api/test/defect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectPath, taskName: REGRESSION_LIBRARY_TASK, env: round?.env || "local", roundId, model: model || undefined, providerId: providerId || undefined }),
      });
      if (!res.ok) {
        let msg = String(res.status);
        try { const d = await res.json(); if (d?.error) msg = d.error; } catch {}
        setDefectMsg(t("test.report.defectFailed", { msg }));
        return;
      }
      if (res.body) { const rd = res.body.getReader(); for (;;) { const { done } = await rd.read(); if (done) break; } }
      setDefectMsg(t("test.report.defectDone"));
    } catch (e) {
      setDefectMsg(t("test.report.defectFailed", { msg: e instanceof Error ? e.message : "error" }));
    }
  };

  // delta 过滤:三卡各自的 key 集合;点击同一张卡取消过滤。
  const deltaKeys = useMemo(() => {
    const mk = (arr?: Array<{ task: string; originalId: string }>) => new Set((arr ?? []).map((x) => caseKey(x.task, x.originalId)));
    return { new: mk(data?.delta?.newFail), fixed: mk(data?.delta?.fixed), still: mk(data?.delta?.stillFail) };
  }, [data]);
  const shownGroups = useMemo(() => {
    if (!data) return [];
    if (!deltaFilter) return data.groups;
    const want = deltaKeys[deltaFilter];
    return data.groups
      .map((g) => ({ ...g, tests: g.tests.filter((c) => want.has(caseKey(c.task, c.originalId))) }))
      .filter((g) => g.tests.length > 0);
  }, [data, deltaFilter, deltaKeys]);

  const mediaUrl = (file: string) =>
    `/api/test/media?projectPath=${encodeURIComponent(projectPath)}&taskName=${encodeURIComponent(REGRESSION_LIBRARY_TASK)}&env=${encodeURIComponent(round?.env || "local")}&roundId=${encodeURIComponent(roundId)}&file=${encodeURIComponent(file)}`;
  const isVid = (f: string) => /\.(webm|mp4|mov)$/i.test(f);
  const hasFailures = (data?.groups ?? []).some((g) => g.tests.some((c) => c.status !== "pass"));

  if (rounds !== null && rounds.length === 0) {
    return <div className="rounded-xl border border-border bg-card p-6 text-center text-[11px] leading-relaxed text-muted-foreground">{t("test.report.noRounds")}</div>;
  }

  const deltaCard = (k: Exclude<DeltaFilter, "">, label: string, n: number, color: string) => (
    <button
      onClick={() => setDeltaFilter((cur) => (cur === k ? "" : k))}
      className={`rounded-lg border bg-card px-3 py-2 text-left transition-colors ${deltaFilter === k ? "border-primary ring-1 ring-primary" : "border-border hover:border-primary"}`}
    >
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${color}`}>{n}<span className="ml-1 text-[10px] font-normal text-muted-foreground">条</span></div>
    </button>
  );

  const rIdx = (rounds ?? []).findIndex((r) => r.roundId === roundId);
  const newerId = rIdx > 0 ? rounds![rIdx - 1].roundId : undefined;
  const olderId = rIdx >= 0 && rIdx < (rounds?.length ?? 0) - 1 ? rounds![rIdx + 1].roundId : undefined;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {onBack ? (
          <>
            <button onClick={onBack} className="flex h-7 items-center gap-1 rounded border border-border px-2 text-[11px] text-muted-foreground hover:text-foreground">
              <ArrowLeft size={11} /> {t("test.rounds.backToList")}
            </button>
            <span className="font-mono text-[11px] text-muted-foreground">{round?.roundId}</span>
            {round?.env && <span className="rounded border border-border px-1 text-[9px] text-muted-foreground">{round.env}</span>}
            {round?.suiteName && <span className="min-w-0 truncate text-[11px] text-foreground">{round.suiteName}</span>}
            <span className="flex-1" />
            <button onClick={() => newerId && onSelectRound?.(newerId)} disabled={!newerId} title={t("test.rounds.prevRound")} aria-label={t("test.rounds.prevRound")} className="flex h-7 items-center rounded border border-border px-1.5 text-muted-foreground hover:text-foreground disabled:opacity-30">
              <CaretUp size={11} />
            </button>
            <button onClick={() => olderId && onSelectRound?.(olderId)} disabled={!olderId} title={t("test.rounds.nextRound")} aria-label={t("test.rounds.nextRound")} className="flex h-7 items-center rounded border border-border px-1.5 text-muted-foreground hover:text-foreground disabled:opacity-30">
              <CaretDown size={11} />
            </button>
          </>
        ) : (
          <>
            <span className="text-[10px] text-muted-foreground">{t("test.report.round")}</span>
            <select
              value={roundId}
              onChange={(e) => { setRoundId(e.target.value); setDeltaFilter(""); setDefectMsg(""); }}
              className="h-7 rounded border border-border bg-background px-1.5 text-[11px] outline-none focus:border-primary"
            >
              {(rounds ?? []).map((r) => (
                <option key={r.roundId} value={r.roundId}>
                  {r.roundId} · {r.env}{r.mode === "failed-only" ? ` · ${t("test.rounds.modeRetest")}` : ""}
                </option>
              ))}
            </select>
            <span className="flex-1" />
          </>
        )}
        {hasFailures && (
          <button
            onClick={analyse}
            disabled={analysing}
            className="flex h-7 items-center gap-1 rounded border border-border px-2 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40"
          >
            {analysing ? <SpinnerGap size={11} className="animate-spin" /> : <Sparkle size={11} />}
            {analysing ? t("test.report.analysing") : data?.hasVerdicts ? t("test.report.reanalyse") : t("test.report.analyse")}
          </button>
        )}
      </div>

      {data === undefined ? (
        <div className="p-4 text-center"><SpinnerGap size={14} className="mx-auto animate-spin text-muted-foreground" /></div>
      ) : data === null ? (
        <div className="rounded-xl border border-border bg-card p-6 text-center text-[11px] text-muted-foreground">{t("test.rounds.detailEmpty")}</div>
      ) : (
        <>
          {counts.total === 0 ? (
            // 中断/无产物的轮**不给发版结论**:0/0 既不是「可发版」也不是「不可发版」,
            // 而是「这轮没跑出结果」。把它渲染成红色红线徽标会误导发版决策。
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-muted/40 px-4 py-3 text-[11px] text-muted-foreground">
              <WarningCircle size={14} />
              <span>{t("test.report.noResults", { status: round?.status === "running" ? t("test.rounds.statusRunning") : t("test.rounds.statusAborted") })}</span>
              <span className="flex-1" />
              <span className="text-[10px]">{round?.roundId} · {round?.env} · {round?.suiteName || "—"}</span>
            </div>
          ) : (
            <div className={`flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 ${verdictOk ? "border-status-success-foreground/30 bg-status-success-muted/40" : "border-status-error-foreground/30 bg-status-error-muted/40"}`}>
              <span className="font-mono text-xl font-bold tabular-nums text-foreground">{counts.pass}/{counts.total}</span>
              <span className={`text-sm font-bold ${verdictOk ? "text-status-success-foreground" : "text-status-error-foreground"}`}>
                {verdictOk ? t("test.report.shippable") : t("test.report.blocked")}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {t("test.report.redlineNote")}
                {isRetest && round?.mergedPassStr && ` ${t("test.report.mergedNote", { pass: round.mergedPassStr })}`}
              </span>
              <span className="flex-1" />
              <span className="text-[10px] text-muted-foreground">
                {round?.roundId} · {round?.env} · {round?.suiteName || "—"}
                {data.quarantined > 0 && (
                  <span className="ml-1.5 text-status-info-foreground">⛔ {t("test.report.quarantineNote", { n: data.quarantined })}</span>
                )}
              </span>
            </div>
          )}

          {data.delta && (
            <>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {deltaCard("new", t("test.report.deltaNewFail"), data.delta.newFail.length, "text-status-error-foreground")}
                {deltaCard("fixed", t("test.report.deltaFixed"), data.delta.fixed.length, "text-status-success-foreground")}
                {deltaCard("still", t("test.report.deltaStillFail"), data.delta.stillFail.length, "text-status-warning-foreground")}
              </div>
              <div className="text-[10px] text-muted-foreground">
                {t("test.report.deltaBase", { round: data.delta.baseRoundId })}
                {deltaFilter && (
                  <button onClick={() => setDeltaFilter("")} className="ml-2 text-primary hover:underline">{t("test.report.filterCleared")}</button>
                )}
              </div>
            </>
          )}

          {shownGroups.length === 0 ? (
            <div className="rounded-xl border border-border bg-card p-6 text-center text-[11px] text-muted-foreground">{t("test.report.empty")}</div>
          ) : (
            shownGroups.map((g) => {
              const pass = g.tests.filter((c) => c.status === "pass").length;
              const allPass = pass === g.tests.length;
              return (
                <div key={g.task} className="overflow-hidden rounded-xl border border-border bg-card">
                  <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-3 py-1.5">
                    <span className="text-[11px] font-semibold text-foreground">{g.task}</span>
                    <span className={`rounded px-1.5 text-[9px] ${allPass ? "bg-status-success-muted text-status-success-foreground" : "bg-status-error-muted text-status-error-foreground"}`}>
                      {t("test.report.groupPass", { pass, total: g.tests.length })}
                    </span>
                  </div>
                  <div className="divide-y divide-border">
                    {g.tests.map((c) => (
                      <div key={`${c.task}-${c.originalId}`} className="px-3 py-1.5">
                        <div className="flex items-center gap-2">
                          <span className={`inline-block h-2 w-2 flex-shrink-0 rounded-full ${c.status === "pass" ? "bg-status-success-foreground" : "bg-status-error-foreground"}`} />
                          <span className="font-mono text-[10px] text-muted-foreground">{c.originalId}</span>
                          <span className="min-w-0 flex-1 truncate text-[11px] text-foreground" title={c.purpose}>{c.purpose || "—"}</span>
                          {c.via === "script" && (
                            <span className="flex items-center gap-0.5 rounded bg-muted px-1 text-[9px] text-muted-foreground" title={t("test.report.viaScriptHint")}>
                              <Lightning size={8} /> {t("test.report.viaScript")}
                            </span>
                          )}
                          <span className={`rounded px-1 text-[9px] ${c.status === "pass" ? "bg-status-success-muted text-status-success-foreground" : "bg-status-error-muted text-status-error-foreground"}`}>{c.status}</span>
                        </div>
                        {c.status !== "pass" && (
                          <div className="mt-1 flex flex-col gap-1.5 rounded bg-muted/50 px-2.5 py-2 text-[10px]">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className={`rounded px-1.5 py-0.5 ${c.verdict ? "bg-status-error-muted text-status-error-foreground" : "border border-border text-muted-foreground"}`}>
                                {c.verdict ? t("test.report.verdict", { cls: c.verdict.cls }) : t("test.report.verdictNone")}
                              </span>
                              {c.verdict && <span className="rounded border border-border px-1.5 py-0.5 text-muted-foreground">{t("test.report.suggest", { act: c.verdict.act })}</span>}
                              <span className="flex-1" />
                              <button onClick={toDefect} className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-muted-foreground hover:text-foreground">
                                <Bug size={10} /> {t("test.report.toDefect")}
                              </button>
                            </div>
                            {c.verdict?.why && <div className="leading-relaxed text-muted-foreground">{c.verdict.why}</div>}
                            {c.actual && <div className="text-muted-foreground"><b className="text-foreground">{t("test.report.actual")}：</b>{c.actual}</div>}
                            {c.error && <div className="text-status-error-foreground">{t("test.report.error")}：{c.error}</div>}
                            {!!c.evidence?.length && (
                              <div className="flex flex-wrap items-center gap-2">
                                {c.evidence.map((f) => (
                                  <button key={f} onClick={() => setLightbox(f)} className="overflow-hidden rounded border border-border" title={f}>
                                    {isVid(f)
                                      ? <span className="flex h-[46px] w-[76px] items-center justify-center bg-muted text-[9px] text-muted-foreground">🎬</span>
                                      // eslint-disable-next-line @next/next/no-img-element
                                      : <img src={mediaUrl(f)} alt={f} className="h-[46px] w-[76px] object-cover" />}
                                  </button>
                                ))}
                                <span className="text-[9px] text-muted-foreground">{t("test.report.evidence")}</span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })
          )}
          {defectMsg && <div className="text-[10px] text-primary">{defectMsg}</div>}
        </>
      )}

      {lightbox && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-6" onClick={() => setLightbox(null)}>
          {isVid(lightbox)
            ? <video src={mediaUrl(lightbox)} controls autoPlay className="max-h-full max-w-full" onClick={(e) => e.stopPropagation()} />
            // eslint-disable-next-line @next/next/no-img-element
            : <img src={mediaUrl(lightbox)} alt={lightbox} className="max-h-full max-w-full object-contain" onClick={(e) => e.stopPropagation()} />}
        </div>
      )}
    </div>
  );
}

// 发起回归轮次弹窗(v2 批 D + 二期):套件下拉 + 环境下拉 + **模式**(全量 / 仅复测上轮失败)
// + **仅执行已确认用例** + 预检卡(条数/来源任务数/隔离排除数/时长估算)+ 红线口径说明。
//
// 预检数字全部来自 POST /api/test/suites/eval 的 `scope` 形态——它与真正的发起接口共用
// lib/test/run-scope.ts 的 resolveRunScope,所以「将执行 N 条」永远等于实跑条数。**不要**在
// 这里用前端逻辑重算命中集,那正是预览与实跑漂移的经典来源。
interface LaunchScopeDTO {
  hits: number;
  hitTasks: number;
  quarantined: number;
  pendingInScope: number;
  /** 圈选集内可脚本重放的条数(按当前环境的沉淀脚本资格判定)。 */
  scriptable?: number;
  suiteName?: string;
  parentRoundId?: string;
  /** 复测轮:基准轮失败条数(不含 pinned);hits 是含 pinned 的实跑总数,两者不可混用。 */
  baseFailedCount?: number;
  unavailable?: string;
}
function StartRegressionModal({ t, projectPath, initialMode, initialParentRoundId, onClose, onStart }: {
  t: T;
  projectPath: string;
  /** 从轮次历史「复测 N 条」进入时预置(缺省=全量)。 */
  initialMode?: "failed-only";
  initialParentRoundId?: string;
  onClose: () => void;
  onStart: (opts: { suiteName: string; env: string; mode: "full" | "failed-only"; approvedOnly: boolean; scriptFirst: boolean; parentRoundId?: string }) => void;
}) {
  const [suites, setSuites] = useState<Array<{ name: string; hits: number; hitTasks: number; builtin?: boolean }> | null>(null);
  const [envs, setEnvs] = useState<string[] | null>(null);
  const [envInfo, setEnvInfo] = useState<{ configured?: boolean; frontendBaseUrl?: string | null } | null>(null);
  const [suiteName, setSuiteName] = useState<string>("全量");
  const [env, setEnv] = useState<string>("local");
  const [mode, setMode] = useState<"full" | "failed-only">(initialMode ?? "full");
  const [approvedOnly, setApprovedOnly] = useState(false);
  // 优先脚本重放(默认开):有合格沉淀脚本的用例由平台直接跑脚本,其余走 AI;关闭 = 全 AI(排障/对照)。
  const [scriptFirst, setScriptFirst] = useState(true);
  const [estimate, setEstimate] = useState<{ minutes: number; rounds: number } | null | undefined>(undefined); // undefined=加载中
  // 预检结果连同它对应的入参 key 一起存:key 不匹配即视为「加载中」,免得在 effect 体里同步
  // setState(null) 触发级联渲染(react-hooks 规则)。
  const [scopeState, setScopeState] = useState<{ key: string; data: LaunchScopeDTO } | null>(null);
  // 复测模式是否可用(有无基准全量轮)——进弹窗时先探一次,不可用则禁用该 radio。
  const [retest, setRetest] = useState<LaunchScopeDTO | null>(null);

  // 套件列表(内置全量置顶)+ 环境列表 + 时长估算(近 3 个 done 轮的 (finish-start)/total 均值)。
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/test/suites?projectPath=${encodeURIComponent(projectPath)}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        const list = [{ name: "全量", hits: d?.fullHits ?? 0, hitTasks: d?.fullTasks ?? 0, builtin: true },
          ...(Array.isArray(d?.suites) ? d.suites.map((x: { name: string; hits: number; hitTasks?: number }) => ({ name: x.name, hits: x.hits ?? 0, hitTasks: x.hitTasks ?? 0 })) : [])];
        setSuites(list);
      })
      .catch(() => { if (!cancelled) setSuites([]); });
    fetch(`/api/test/env-config?projectPath=${encodeURIComponent(projectPath)}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        const allowed: string[] = Array.isArray(d?.allowedEnvs) && d.allowedEnvs.length ? d.allowedEnvs.map(String) : ["local"];
        setEnvs(allowed);
        if (typeof d?.env === "string" && allowed.includes(d.env)) setEnv(d.env);
      })
      .catch(() => { if (!cancelled) setEnvs(["local"]); });
    fetch("/api/test/suites/eval", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectPath, scope: { mode: "failed-only", parentRoundId: initialParentRoundId } }),
    })
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setRetest(d as LaunchScopeDTO); })
      .catch(() => { if (!cancelled) setRetest({ hits: 0, hitTasks: 0, quarantined: 0, pendingInScope: 0, unavailable: "x" }); });
    fetch(`/api/test/library/rounds?projectPath=${encodeURIComponent(projectPath)}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        const done = (Array.isArray(d?.rounds) ? d.rounds : []).filter(
          (r: { status?: string; startedAt?: string; finishedAt?: string; total?: number }) =>
            r.status === "done" && r.startedAt && r.finishedAt && typeof r.total === "number" && r.total > 0,
        ).slice(0, 3);
        if (!done.length) { setEstimate(null); return; }
        const perCaseMs = done.reduce((acc: number, r: { startedAt: string; finishedAt: string; total: number }) =>
          acc + (Date.parse(r.finishedAt) - Date.parse(r.startedAt)) / r.total, 0) / done.length;
        setEstimate(perCaseMs > 0 ? { minutes: perCaseMs / 60000, rounds: done.length } : null);
      })
      .catch(() => { if (!cancelled) setEstimate(null); });
    return () => { cancelled = true; };
  }, [projectPath, initialParentRoundId]);

  // 所选环境的被测地址展示(切换环境时刷新;仅展示用,执行时 run 路由自行解析)。
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/test/env-config?projectPath=${encodeURIComponent(projectPath)}&env=${encodeURIComponent(env)}`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setEnvInfo({ configured: d?.configured, frontendBaseUrl: d?.frontendBaseUrl ?? null }); })
      .catch(() => { if (!cancelled) setEnvInfo(null); });
    return () => { cancelled = true; };
  }, [projectPath, env]);

  // 预检卡:套件/模式/仅已确认/环境 任一变化 → 服务端重新求值(与实跑同源)。
  // env 进 key 与请求:脚本按环境沉淀,「可脚本重放 N 条」随环境变化。
  const scopeKey = `${suiteName}\u0000${mode}\u0000${approvedOnly}\u0000${env}\u0000${initialParentRoundId ?? ""}`;
  useEffect(() => {
    let cancelled = false;
    const key = scopeKey;
    fetch("/api/test/suites/eval", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectPath, scope: { suiteName, mode, approvedOnly, env, parentRoundId: initialParentRoundId } }),
    })
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setScopeState({ key, data: d as LaunchScopeDTO }); })
      .catch(() => { if (!cancelled) setScopeState({ key, data: { hits: 0, hitTasks: 0, quarantined: 0, pendingInScope: 0 } }); });
    return () => { cancelled = true; };
  }, [projectPath, suiteName, mode, approvedOnly, env, initialParentRoundId, scopeKey]);
  const scope = scopeState?.key === scopeKey ? scopeState.data : null;

  const retestAvailable = !!retest && !retest.unavailable && retest.hits > 0;
  const hits = scope?.hits ?? 0;
  const loading = suites === null || envs === null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="flex max-h-[84vh] w-full max-w-md flex-col overflow-y-auto rounded-xl border border-border bg-background shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Play size={13} className="text-primary" />
          <span className="text-xs font-semibold text-foreground">{t("test.launch.title")}</span>
          <span className="flex-1" />
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label={t("test.launch.cancel")}><X size={14} /></button>
        </div>
        {loading ? (
          <div className="p-4 text-center text-[11px] text-muted-foreground"><SpinnerGap size={14} className="mx-auto animate-spin" /></div>
        ) : (
          <div className="space-y-3 p-3">
            <div className="flex items-center gap-2">
              <span className="w-12 flex-shrink-0 text-[10px] text-muted-foreground">{t("test.launch.suite")}</span>
              <select
                value={suiteName}
                onChange={(e) => setSuiteName(e.target.value)}
                disabled={mode === "failed-only"}
                className="h-7 flex-1 rounded border border-border bg-background px-1.5 text-[11px] outline-none focus:border-primary disabled:opacity-40"
              >
                {(suites ?? []).map((x) => (
                  <option key={x.name} value={x.name}>{x.builtin ? `${x.name}（内置）` : x.name} — {t("test.suites.hits", { n: x.hits })}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-12 flex-shrink-0 text-[10px] text-muted-foreground">{t("test.launch.env")}</span>
              <select
                value={env}
                onChange={(e) => setEnv(e.target.value)}
                className="h-7 flex-1 rounded border border-border bg-background px-1.5 text-[11px] outline-none focus:border-primary"
              >
                {(envs ?? []).map((e2) => <option key={e2} value={e2}>{e2}</option>)}
              </select>
            </div>
            <div className="flex items-start gap-2">
              <span className="w-12 flex-shrink-0 pt-0.5 text-[10px] text-muted-foreground">{t("test.launch.mode")}</span>
              <div className="flex flex-1 flex-col gap-1">
                <label className="flex items-center gap-1.5 text-[11px] text-foreground">
                  <input type="radio" name="regmode" checked={mode === "full"} onChange={() => setMode("full")} className="accent-primary" />
                  {t("test.launch.modeFull")}
                </label>
                <label className={`flex items-center gap-1.5 text-[11px] ${retestAvailable ? "text-foreground" : "cursor-not-allowed text-muted-foreground"}`}>
                  <input
                    type="radio"
                    name="regmode"
                    checked={mode === "failed-only"}
                    disabled={!retestAvailable}
                    onChange={() => setMode("failed-only")}
                    className="accent-primary"
                  />
                  {t("test.launch.modeRetest")}
                  {retestAvailable
                    ? <span className="text-muted-foreground">（{t("test.launch.modeRetestHint", { n: retest!.baseFailedCount ?? retest!.hits })}）</span>
                    : <span className="text-muted-foreground">（{t("test.launch.modeRetestUnavailable")}）</span>}
                </label>
                {mode === "failed-only" && retest?.parentRoundId && (
                  <span className="font-mono text-[10px] text-muted-foreground">{t("test.launch.basedOn", { round: retest.parentRoundId })}</span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-12 flex-shrink-0" />
              <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <input type="checkbox" checked={approvedOnly} onChange={(e) => setApprovedOnly(e.target.checked)} className="accent-primary" />
                {t("test.launch.approvedOnly")}
              </label>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-12 flex-shrink-0" />
              <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground" title={t("test.launch.scriptFirstHint")}>
                <input type="checkbox" checked={scriptFirst} onChange={(e) => setScriptFirst(e.target.checked)} className="accent-primary" />
                {t("test.launch.scriptFirst")}
                <Lightning size={10} className="text-primary" />
              </label>
            </div>
            <div className="flex items-start gap-2 text-[10px] text-muted-foreground">
              <span className="w-12 flex-shrink-0">{t("test.launch.baseUrl")}</span>
              {envInfo?.frontendBaseUrl ? (
                <span className="min-w-0 flex-1 truncate font-mono" title={envInfo.frontendBaseUrl}>{envInfo.frontendBaseUrl}</span>
              ) : (
                <span className="flex-1 text-status-warning-foreground">{t("test.launch.envUnconfigured")}</span>
              )}
            </div>
            <div className="space-y-1 rounded border border-border bg-muted/30 px-2.5 py-2 text-[11px] text-foreground">
              {scope === null ? (
                <div className="text-muted-foreground">…</div>
              ) : (
                <>
                  <div>
                    {t("test.launch.precheck", { n: scope.hits, m: scope.hitTasks })}
                    {scope.quarantined > 0 && (
                      <span className="ml-1 text-status-info-foreground">· {t("test.launch.quarantineExcluded", { n: scope.quarantined })}</span>
                    )}
                    {scriptFirst && (scope.scriptable ?? 0) > 0 && (
                      <span className="ml-1 text-primary">· {t("test.launch.scriptableCount", { n: scope.scriptable ?? 0 })}</span>
                    )}
                  </div>
                  {approvedOnly
                    ? null
                    : scope.pendingInScope > 0 && (
                      <div className="text-[10px] text-status-warning-foreground">{t("test.launch.pendingWarn", { n: scope.pendingInScope })}</div>
                    )}
                  <div className="text-[10px] text-muted-foreground">
                    {estimate === undefined ? "…" : estimate === null
                      ? t("test.launch.estimateNone")
                      : t("test.launch.estimate", { min: Math.max(1, Math.round(estimate.minutes * scope.hits)), rounds: estimate.rounds })}
                  </div>
                </>
              )}
            </div>
            <div className="rounded bg-muted px-2.5 py-1.5 text-[10px] leading-relaxed text-muted-foreground">
              {mode === "failed-only" ? t("test.launch.retestRedline") : t("test.launch.redline")}
            </div>
            {scope !== null && hits === 0 && <div className="text-[11px] text-status-warning-foreground">{t("test.launch.emptySuite")}</div>}
            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="flex h-6 items-center rounded border border-border px-2 text-[11px] text-muted-foreground hover:text-foreground">{t("test.launch.cancel")}</button>
              <button
                onClick={() => onStart({ suiteName, env, mode, approvedOnly, scriptFirst, parentRoundId: mode === "failed-only" ? initialParentRoundId : undefined })}
                disabled={hits === 0}
                className="flex h-6 items-center gap-1 rounded bg-primary px-2.5 text-[11px] font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Play size={11} /> {t("test.launch.start", { n: hits })}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// 回归套件区块(批 H 页面化,原 v2 批 C 弹窗):套件 = 「本轮跑什么」的圈选器。列表(内置全量 + 用户套件,
// 实时命中数)+ 构建器(查询条件 chips / 静态勾选树,eval API 实时预览,口径与发起执行一致)
// + 核心必跑白名单(pinned,任何套件执行始终并入)。套件是引用不是复制——落 回归套件.json。
interface SuiteKeyUI { task: string; originalId: string }
interface SuiteDTO {
  name: string; type: "static" | "query"; hits: number;
  keys?: SuiteKeyUI[];
  filter?: { pri?: string[]; module?: string[]; task?: string[]; last?: ("pass" | "fail" | "none")[] };
}
interface SuiteEditState {
  orig?: string; // 编辑既有套件时的原名(重命名 = 存新删旧)
  name: string;
  type: "static" | "query";
  pri: string[]; module: string[]; task: string[]; last: string[];
  keys: Set<string>; // JSON.stringify([task, originalId])
}
const suiteKeyEnc = (k: SuiteKeyUI) => JSON.stringify([k.task, k.originalId]);
const suiteKeyDec = (s: string): SuiteKeyUI => { const [task, originalId] = JSON.parse(s) as [string, string]; return { task, originalId }; };
function RegressionSuitesSection({ t, projectPath }: { t: T; projectPath: string }) {
  const [data, setData] = useState<{ pinned: SuiteKeyUI[]; fullHits: number; suites: SuiteDTO[] } | null>(null);
  const [lib, setLib] = useState<LibGroup[] | null>(null);
  const [editing, setEditing] = useState<SuiteEditState | null>(null);
  const [pinnedEdit, setPinnedEdit] = useState<Set<string> | null>(null);
  const [preview, setPreview] = useState<{ hits: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [errMsg, setErrMsg] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/test/suites?projectPath=${encodeURIComponent(projectPath)}`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setData({ pinned: Array.isArray(d?.pinned) ? d.pinned : [], fullHits: d?.fullHits ?? 0, suites: Array.isArray(d?.suites) ? d.suites : [] }); })
      .catch(() => { if (!cancelled) setData({ pinned: [], fullHits: 0, suites: [] }); });
    fetch(`/api/test/library?projectPath=${encodeURIComponent(projectPath)}`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setLib(Array.isArray(d?.tasks) ? d.tasks : []); })
      .catch(() => { if (!cancelled) setLib([]); });
    return () => { cancelled = true; };
  }, [projectPath, reload]);

  // 字段候选值(来自库现存条目;确保已选值即使库里已不存在也仍可见可取消)。
  const fieldValues = useMemo(() => {
    const pri = new Set<string>(); const mod = new Set<string>(); const task = new Set<string>();
    for (const g of lib ?? []) { task.add(g.task); for (const e of g.entries) { if (e.priority) pri.add(e.priority); const m = (e as { module?: unknown }).module; if (typeof m === "string" && m) mod.add(m); } }
    for (const v of editing?.pri ?? []) pri.add(v);
    for (const v of editing?.module ?? []) mod.add(v);
    for (const v of editing?.task ?? []) task.add(v);
    return { pri: [...pri].sort(), module: [...mod].sort(), task: [...task] };
  }, [lib, editing]);

  const editingSuitePayload = (e: SuiteEditState) =>
    e.type === "query"
      ? { name: e.name.trim(), type: "query", filter: { pri: e.pri, module: e.module, task: e.task, last: e.last } }
      : { name: e.name.trim(), type: "static", keys: [...e.keys].map(suiteKeyDec) };

  // 构建器实时命中预览(300ms 防抖;名称不参与求值,用占位名避免空名 400)。
  useEffect(() => {
    if (!editing) { setPreview(null); return; }
    const payload = { ...editingSuitePayload(editing), name: editing.name.trim() || "预览" };
    const timer = setTimeout(() => {
      fetch("/api/test/suites/eval", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectPath, suite: payload }),
      })
        .then((r) => r.json())
        .then((d) => setPreview({ hits: typeof d?.hits === "number" ? d.hits : 0 }))
        .catch(() => setPreview(null));
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectPath, editing]);

  const startNew = () => { setErrMsg(""); setEditing({ name: "", type: "query", pri: [], module: [], task: [], last: [], keys: new Set() }); };
  const startEdit = (s: SuiteDTO) => {
    setErrMsg("");
    setEditing({
      orig: s.name, name: s.name, type: s.type,
      pri: s.filter?.pri ?? [], module: s.filter?.module ?? [], task: s.filter?.task ?? [], last: s.filter?.last ?? [],
      keys: new Set((s.keys ?? []).map(suiteKeyEnc)),
    });
  };
  const toggleArr = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  const saveSuite = async () => {
    if (!editing) return;
    if (!editing.name.trim()) { setErrMsg(t("test.suites.nameRequired")); return; }
    if (editing.type === "static" && editing.keys.size === 0) { setErrMsg(t("test.suites.emptyStatic")); return; }
    setSaving(true); setErrMsg("");
    try {
      const res = await fetch("/api/test/suites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectPath, suite: editingSuitePayload(editing) }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErrMsg((d?.error as string) || t("test.suites.saveFailed")); return; }
      // 重命名 = 存新删旧(name 是主键)。
      if (editing.orig && editing.orig !== editing.name.trim()) {
        await fetch("/api/test/suites", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectPath, name: editing.orig }),
        }).catch(() => {});
      }
      setEditing(null); setReload((n) => n + 1);
    } catch { setErrMsg(t("test.suites.saveFailed")); } finally { setSaving(false); }
  };

  const delSuite = async (name: string) => {
    if (!window.confirm(t("test.suites.confirmDelete", { name }))) return;
    try {
      await fetch("/api/test/suites", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectPath, name }),
      });
      setReload((n) => n + 1);
    } catch { /* keep view */ }
  };

  const savePinned = async () => {
    if (!pinnedEdit) return;
    setSaving(true);
    try {
      await fetch("/api/test/suites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectPath, pinned: [...pinnedEdit].map(suiteKeyDec) }),
      });
      setPinnedEdit(null); setReload((n) => n + 1);
    } catch { /* keep editing state so user can retry */ } finally { setSaving(false); }
  };

  // 静态勾选树(按来源任务分组;pinned 编辑复用同一渲染)。
  const renderTree = (checked: Set<string>, toggle: (k: string) => void, toggleGroup: (ks: string[]) => void) => (
    <div className="space-y-2">
      {(lib ?? []).map((g) => {
        const ks = g.entries.map((e) => suiteKeyEnc({ task: g.task, originalId: e._source?.originalId || e.id || "" }));
        const allOn = ks.length > 0 && ks.every((k) => checked.has(k));
        return (
          <div key={g.task} className="rounded border border-border/60">
            <label className="flex cursor-pointer items-center gap-2 border-b border-border/60 bg-muted/40 px-2 py-1">
              <input type="checkbox" checked={allOn} onChange={() => toggleGroup(ks)} className="accent-primary" />
              <span className="text-[11px] font-semibold text-foreground">{g.task}</span>
              <span className="rounded bg-muted px-1.5 text-[9px] text-muted-foreground">{ks.filter((k) => checked.has(k)).length}/{ks.length}</span>
            </label>
            <div className="space-y-0.5 p-1">
              {g.entries.map((e, i) => {
                const k = ks[i];
                return (
                  <label key={k} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-0.5 hover:bg-muted/40">
                    <input type="checkbox" checked={checked.has(k)} onChange={() => toggle(k)} className="accent-primary" />
                    <span className="font-mono text-[10px] text-muted-foreground">{e._source?.originalId || e.id}</span>
                    <span className="min-w-0 flex-1 truncate text-[11px] text-foreground" title={e.purpose}>{e.purpose || "—"}</span>
                    {e.priority && <span className="rounded bg-muted px-1 text-[9px] text-muted-foreground">{e.priority}</span>}
                  </label>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );

  // 查询条件行:字段标签 + 值 chips(选中高亮;不选 = 不限制)。
  const condRow = (label: string, values: string[], selected: string[], onToggle: (v: string) => void, renderVal?: (v: string) => string) => (
    <div className="flex items-start gap-2">
      <span className="w-14 flex-shrink-0 pt-0.5 text-[10px] text-muted-foreground">{label}</span>
      <div className="flex flex-1 flex-wrap gap-1">
        {values.map((v) => (
          <button
            key={v}
            onClick={() => onToggle(v)}
            className={`rounded-full border px-2 py-0.5 text-[10px] ${selected.includes(v) ? "border-primary bg-primary/10 font-semibold text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
          >
            {renderVal ? renderVal(v) : v}
          </button>
        ))}
        {values.length === 0 && <span className="pt-0.5 text-[10px] text-muted-foreground">—</span>}
      </div>
    </div>
  );

  const lastLabel = (v: string) => (v === "pass" ? t("test.suites.lastPass") : v === "fail" ? t("test.suites.lastFail") : t("test.suites.lastNone"));
  const body = () => {
    if (data === null || lib === null) {
      return <div className="p-4 text-center text-[11px] text-muted-foreground"><SpinnerGap size={14} className="mx-auto animate-spin" /></div>;
    }
    if (pinnedEdit) {
      return (
        <div className="space-y-2 p-3">
          <div className="text-[11px] text-muted-foreground">{t("test.suites.pinnedHint")}</div>
          {lib.length === 0 ? <div className="p-4 text-center text-[11px] text-muted-foreground">{t("test.suites.libEmpty")}</div> :
            renderTree(pinnedEdit, (k) => setPinnedEdit((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; }),
              (ks) => setPinnedEdit((s) => { const n = new Set(s); const all = ks.every((k) => n.has(k)); ks.forEach((k) => (all ? n.delete(k) : n.add(k))); return n; }))}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={() => setPinnedEdit(null)} className="flex h-6 items-center rounded border border-border px-2 text-[11px] text-muted-foreground hover:text-foreground">{t("test.suites.cancel")}</button>
            <button onClick={savePinned} disabled={saving} className="flex h-6 items-center gap-1 rounded bg-primary px-2.5 text-[11px] font-medium text-primary-foreground disabled:opacity-40">
              {saving && <SpinnerGap size={11} className="animate-spin" />} {t("test.suites.save")}
            </button>
          </div>
        </div>
      );
    }
    if (editing) {
      return (
        <div className="space-y-3 p-3">
          <div className="flex items-center gap-2">
            <span className="w-14 flex-shrink-0 text-[10px] text-muted-foreground">{t("test.suites.name")}</span>
            <input
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              placeholder={t("test.suites.namePh")}
              className="h-7 flex-1 rounded border border-border bg-background px-2 text-[11px] outline-none focus:border-primary"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="w-14 flex-shrink-0 text-[10px] text-muted-foreground">{t("test.suites.type")}</span>
            <label className="flex cursor-pointer items-center gap-1 text-[11px]">
              <input type="radio" checked={editing.type === "query"} onChange={() => setEditing({ ...editing, type: "query" })} className="accent-primary" />
              {t("test.suites.queryType")}
            </label>
            <label className="flex cursor-pointer items-center gap-1 text-[11px]">
              <input type="radio" checked={editing.type === "static"} onChange={() => setEditing({ ...editing, type: "static" })} className="accent-primary" />
              {t("test.suites.staticType")}
            </label>
          </div>
          {editing.type === "query" ? (
            <div className="space-y-2 rounded border border-border/60 bg-muted/20 p-2">
              {condRow(t("test.suites.condPri"), fieldValues.pri, editing.pri, (v) => setEditing({ ...editing, pri: toggleArr(editing.pri, v) }))}
              {condRow(t("test.suites.condModule"), fieldValues.module, editing.module, (v) => setEditing({ ...editing, module: toggleArr(editing.module, v) }))}
              {condRow(t("test.suites.condTask"), fieldValues.task, editing.task, (v) => setEditing({ ...editing, task: toggleArr(editing.task, v) }))}
              {condRow(t("test.suites.condLast"), ["pass", "fail", "none"], editing.last, (v) => setEditing({ ...editing, last: toggleArr(editing.last, v) }), lastLabel)}
              <div className="text-[10px] leading-relaxed text-muted-foreground">{t("test.suites.queryHint")}</div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="text-[10px] text-muted-foreground">{t("test.suites.staticHint")}</div>
              {lib.length === 0 ? <div className="p-4 text-center text-[11px] text-muted-foreground">{t("test.suites.libEmpty")}</div> :
                renderTree(editing.keys, (k) => setEditing((s) => { if (!s) return s; const n = new Set(s.keys); if (n.has(k)) n.delete(k); else n.add(k); return { ...s, keys: n }; }),
                  (ks) => setEditing((s) => { if (!s) return s; const n = new Set(s.keys); const all = ks.every((k) => n.has(k)); ks.forEach((k) => (all ? n.delete(k) : n.add(k))); return { ...s, keys: n }; }))}
            </div>
          )}
          <div className="flex items-center gap-2 rounded border border-border bg-muted/30 px-2 py-1.5 text-[11px] text-muted-foreground">
            {preview === null ? <SpinnerGap size={11} className="animate-spin" /> : preview.hits > 0 ? t("test.suites.preview", { n: preview.hits }) : t("test.suites.previewEmpty")}
          </div>
          {errMsg && <div className="text-[11px] text-status-error-foreground">{errMsg}</div>}
          <div className="flex justify-end gap-2">
            <button onClick={() => setEditing(null)} className="flex h-6 items-center rounded border border-border px-2 text-[11px] text-muted-foreground hover:text-foreground">{t("test.suites.cancel")}</button>
            <button onClick={saveSuite} disabled={saving} className="flex h-6 items-center gap-1 rounded bg-primary px-2.5 text-[11px] font-medium text-primary-foreground disabled:opacity-40">
              {saving && <SpinnerGap size={11} className="animate-spin" />} {saving ? t("test.suites.saving") : t("test.suites.save")}
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className="space-y-3 p-3">
        <div className="overflow-hidden rounded border border-border/60">
          <div className="flex items-center gap-2 border-b border-border/60 bg-muted/20 px-2 py-1.5">
            <Lock size={11} className="text-muted-foreground" />
            <span className="text-[11px] font-semibold text-foreground">{t("test.suites.builtinFull")}</span>
            <span className="rounded bg-muted px-1.5 text-[9px] text-muted-foreground">{t("test.suites.hits", { n: data.fullHits })}</span>
            <span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground" title={t("test.suites.builtinHint")}>{t("test.suites.builtinHint")}</span>
          </div>
          {data.suites.map((s) => (
            <div key={s.name} className="flex items-center gap-2 border-b border-border/60 px-2 py-1.5 last:border-b-0">
              <span className="min-w-0 flex-1 truncate text-[11px] text-foreground">{s.name}</span>
              <span className={`rounded px-1.5 text-[9px] ${s.type === "query" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                {s.type === "query" ? t("test.suites.typeQuery") : t("test.suites.typeStatic")}
              </span>
              <span className="rounded bg-muted px-1.5 text-[9px] text-muted-foreground">{t("test.suites.hits", { n: s.hits })}</span>
              <button onClick={() => startEdit(s)} className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground">
                <PencilSimple size={10} /> {t("test.suites.edit")}
              </button>
              <button onClick={() => delSuite(s.name)} className="text-muted-foreground hover:text-status-error-foreground" title={t("test.suites.delete")} aria-label={t("test.suites.delete")}>
                <Trash size={11} />
              </button>
            </div>
          ))}
          <button onClick={startNew} className="flex w-full items-center gap-1.5 px-2 py-1.5 text-[11px] text-muted-foreground hover:bg-muted/40 hover:text-foreground">
            <Plus size={11} /> {t("test.suites.new")}
          </button>
        </div>
        <div className="rounded border border-border/60 p-2">
          <div className="mb-1 flex items-center gap-2">
            <PushPin size={11} className="text-muted-foreground" />
            <span className="text-[11px] font-semibold text-foreground">{t("test.suites.pinned")}</span>
            <span className="flex-1" />
            <button onClick={() => setPinnedEdit(new Set(data.pinned.map(suiteKeyEnc)))} className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground">
              <PencilSimple size={10} /> {t("test.suites.pinnedEdit")}
            </button>
          </div>
          <div className="text-[10px] text-muted-foreground">{t("test.suites.pinnedHint")}</div>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {data.pinned.length === 0 ? (
              <span className="text-[10px] text-muted-foreground">{t("test.suites.pinnedEmpty")}</span>
            ) : (
              data.pinned.map((k) => (
                <span key={suiteKeyEnc(k)} className="rounded border border-border bg-muted/30 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                  📌 {k.task} · {k.originalId}
                </span>
              ))
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
          <ListChecks size={13} className="text-primary" />
          <span className="text-[11px] font-semibold text-foreground">{t("test.suites.title")}</span>
          {data && (
            <span className="text-[10px] text-muted-foreground">{t("test.suites.summary", { count: data.suites.length, full: data.fullHits })}</span>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-auto">{body()}</div>
    </div>
  );
}

// AI 推荐回归集 · 可视化审阅弹窗(用例设计阶段)。取代旧的「流式打进对话框 + 自动应用」:
// 打开即调 /api/test/cases/recommend?review=true(AI 只推荐、不写盘)→ 收 recommend_verdicts 帧 →
// 逐条用表格展示(用例标题 / AI 建议回归集✓或否 / 理由 + 复选框),用户审阅勾选后点「应用」→
// /recommend/apply 精确 merge 标签(只动「回归测试」)+ 同步回归用例库。全程不碰任务对话流。
interface RecommendVerdictUI { id: string; suite: boolean; reason: string }
function RecommendReviewModal({ t, projectPath, taskName, cases, model, providerId, onClose, onApplied }: {
  t: T;
  projectPath: string;
  taskName: string;
  cases: GeneratedCase[];
  model: string;
  providerId: string;
  onClose: () => void;
  onApplied: () => void;
}) {
  const [phase, setPhase] = useState<"running" | "review" | "applying" | "error">("running");
  const [verdicts, setVerdicts] = useState<RecommendVerdictUI[]>([]);
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});
  const [errorMsg, setErrorMsg] = useState("");

  // 标题/当前标签映射(按 id join casesPreview)。
  const caseById = useMemo(() => {
    const m = new Map<string, GeneratedCase>();
    for (const c of cases) if (c?.id) m.set(c.id, c);
    return m;
  }, [cases]);
  const isCurrentlySuite = (id: string) => (caseById.get(id)?.tags ?? []).includes("回归测试");

  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/test/cases/recommend", {
          method: "POST",
          signal: ctrl.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectPath, taskName, review: true, model: model || undefined, providerId: providerId || undefined }),
        });
        if (!res.ok || !res.body) {
          const j = await res.json().catch(() => ({}));
          setErrorMsg((j.error as string) || `HTTP ${res.status}`);
          setPhase("error");
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
            if (evt?.type === "recommend_verdicts") {
              let vs: RecommendVerdictUI[] = [];
              try { vs = JSON.parse(evt.data || "[]"); } catch { vs = []; }
              setVerdicts(vs);
              setAccepted(Object.fromEntries(vs.map((v) => [v.id, v.suite]))); // 默认采纳 AI 建议
              setPhase("review");
            } else if (evt?.type === "error") {
              let msg = evt.data || "";
              try { const d = JSON.parse(evt.data || "{}"); msg = d.userMessage || d.rawMessage || msg; } catch {}
              setErrorMsg(msg); setPhase("error");
            }
          }
        }
      } catch (e) {
        if (!(e instanceof DOMException && e.name === "AbortError")) {
          setErrorMsg(e instanceof Error ? e.message : String(e));
          setPhase("error");
        }
      }
    })();
    return () => ctrl.abort();
  }, [projectPath, taskName, model, providerId]);

  const suiteCount = verdicts.filter((v) => accepted[v.id]).length;
  const apply = async () => {
    setPhase("applying");
    try {
      const res = await fetch("/api/test/cases/recommend/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectPath, taskName, verdicts: verdicts.map((v) => ({ id: v.id, suite: !!accepted[v.id] })) }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) { setErrorMsg((j.error as string) || `HTTP ${res.status}`); setPhase("error"); return; }
      onApplied();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e)); setPhase("error");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="flex max-h-[82vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-background shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <span className="text-sm">🎯</span>
          <span className="text-xs font-semibold text-foreground">{t("test.cases.recommend")}</span>
          {phase === "review" && (
            <span className="text-[10px] text-muted-foreground">{t("test.recommend.summary", { suite: suiteCount, total: verdicts.length })}</span>
          )}
          <span className="flex-1" />
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label={t("test.library.close")}><X size={14} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {phase === "running" && (
            <div className="flex flex-col items-center gap-2 p-8 text-[11px] text-muted-foreground">
              <SpinnerGap size={18} className="animate-spin" /> {t("test.recommend.analyzing")}
            </div>
          )}
          {phase === "error" && (
            <div className="p-6 text-center text-[11px] text-status-error-foreground">{errorMsg || t("test.recommend.failed")}</div>
          )}
          {(phase === "review" || phase === "applying") && verdicts.length === 0 && (
            <div className="p-6 text-center text-[11px] text-muted-foreground">{t("test.recommend.empty")}</div>
          )}
          {(phase === "review" || phase === "applying") && verdicts.length > 0 && (
            <table className="w-full border-collapse text-[11px]">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                <tr className="text-left text-muted-foreground">
                  <th className="w-10 px-3 py-1.5 text-center font-medium">{t("test.recommend.colSuite")}</th>
                  <th className="px-2 py-1.5 font-medium">{t("test.recommend.colCase")}</th>
                  <th className="whitespace-nowrap px-2 py-1.5 font-medium">{t("test.recommend.colAi")}</th>
                  <th className="px-2 py-1.5 font-medium">{t("test.recommend.colReason")}</th>
                </tr>
              </thead>
              <tbody>
                {verdicts.map((v) => {
                  const c = caseById.get(v.id);
                  const changed = !!accepted[v.id] !== isCurrentlySuite(v.id);
                  return (
                    <tr key={v.id} className="border-t border-border align-top">
                      <td className="px-3 py-1.5 text-center">
                        <input
                          type="checkbox"
                          checked={!!accepted[v.id]}
                          disabled={phase === "applying"}
                          onChange={(e) => setAccepted((a) => ({ ...a, [v.id]: e.target.checked }))}
                          className="h-3.5 w-3.5 accent-primary"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <span className="font-mono text-[10px] text-muted-foreground">{v.id}</span>
                        <span className="ml-1 text-foreground">{c?.purpose || ""}</span>
                        {changed && <span className="ml-1 rounded bg-status-warning-muted px-1 text-[9px] text-status-warning-foreground">{t("test.recommend.changed")}</span>}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5">
                        <span className={`rounded px-1.5 py-0.5 text-[10px] ${v.suite ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                          {v.suite ? t("test.recommend.aiYes") : t("test.recommend.aiNo")}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-muted-foreground">{v.reason || ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        {(phase === "review" || phase === "applying") && verdicts.length > 0 && (
          <div className="flex items-center gap-2 border-t border-border px-3 py-2">
            <span className="text-[10px] text-muted-foreground">{t("test.recommend.applyHint", { suite: suiteCount })}</span>
            <span className="flex-1" />
            <button onClick={onClose} disabled={phase === "applying"} className="rounded border border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40">{t("test.recommend.cancel")}</button>
            <button onClick={apply} disabled={phase === "applying"} className="flex items-center gap-1 rounded bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground disabled:opacity-40">
              {phase === "applying" ? <SpinnerGap size={11} className="animate-spin" /> : <Check size={11} />} {t("test.recommend.apply")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// xlsx 产物预览：调 /api/test/report-xlsx 解析为表格；证据单元格（.png/.webm 等）渲染成
// 可点开的 chip → 截图灯箱 / 录像内联播放（经 /api/test/media，与 ReportView 同口径）。
// 执行矩阵预览的列宽/换行规则（列头来自 report-xlsx 的 HEADER）。长文本列换行、短列紧凑。
const XLSX_WRAP_COLS = new Set(["标题", "用例标签", "期望结果", "实际结果"]);
// 列宽按【权重】而非硬编码百分比：实际列宽 = 该列权重 / 当轮所有列权重之和。
// 这样列集变化（不同分支给执行矩阵加过 用例标签 / 用时 两列）时总和永远归一到 100%、
// 不再横向溢出；未知表头拿 DEFAULT 权重、有个合理宽度，而不是回退 auto 被挤成 0 宽、
// 内容 nowrap 溢出叠到邻列（用户实测的「几列重合」根因）。
const XLSX_COL_WEIGHT: Record<string, number> = {
  "序号": 3.5, "用例ID": 6, "标题": 12, "用例标签": 6,
  "期望结果": 27, "实际结果": 27, "状态": 5.5, "用时": 5, "证据": 8,
};
const XLSX_COL_WEIGHT_DEFAULT = 8;

function XlsxPreview({ t, projectPath, taskName, env, onClose }: {
  t: T;
  projectPath: string;
  taskName: string;
  env: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<{ sheets: { name: string; rows: string[][] }[] } | null>(null);
  const [err, setErr] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // cache:"no-store" —— 第一次预览成功后浏览器可能缓存响应，第二次 from cache 在打包
    // standalone 环境偶发取到坏/空缓存 → 解析失败。强制每次走网络，杜绝这条路。
    fetch(`/api/test/report-xlsx?projectPath=${encodeURIComponent(projectPath)}&taskName=${encodeURIComponent(taskName)}&env=${encodeURIComponent(env)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("fetch failed"))))
      .then((d) => { if (!cancelled) { if (d.error) setErr(true); else setData(d); } })
      .catch(() => { if (!cancelled) setErr(true); });
    return () => { cancelled = true; };
  }, [projectPath, taskName, env, reloadTick]);

  const mediaUrl = (file: string) => `/api/test/media?projectPath=${encodeURIComponent(projectPath)}&taskName=${encodeURIComponent(taskName)}&env=${encodeURIComponent(env)}&file=${encodeURIComponent(file)}`;
  const mediaRe = /\.(png|jpe?g|webp|gif|webm|mp4|mov)$/i;
  const isVid = (f: string) => /\.(webm|mp4|mov)$/i.test(f);
  const cellNode = (text: string) => {
    const tok = text.trim();
    // 证据单元格常是多个文件用 ", " 拼接（fail/partial 用例的 截图.png + 录像.webm——
    // report-xlsx 用 evidence.join(', ') 生成）。必须按分隔符拆成【多个独立 chip】，每个只把
    // 【单个文件名】传给 /api/test/media。否则整串「a.png, b.webm」被当成一个文件名（且因整串
    // 以 .webm 结尾被误判为视频）→ media 404 → <video> Format error 黑屏。这是「录像预览黑屏」
    // 反复修不好的真根因（占位单文件数据碰不到，只有真实的「截图+录像」多证据用例才触发）。
    const parts = tok.split(/,\s*/).map((s) => s.trim()).filter(Boolean);
    const mediaParts = parts.filter((p) => mediaRe.test(p));
    if (mediaParts.length > 0) {
      return (
        <span className="flex flex-wrap items-center gap-1">
          {mediaParts.map((p, i) => {
            const base = p.split(/[\\/]/).pop() || p;
            return (
              <button key={i} onClick={() => setLightbox(base)} title={base} className="rounded border border-border px-1 py-0.5 text-[10px] text-primary hover:bg-muted">
                {isVid(base) ? `🎬 ${t("test.media.video")}` : `🖼 ${t("test.media.image")}`}
              </button>
            );
          })}
        </span>
      );
    }
    return <span>{text}</span>;
  };

  const sheet = data?.sheets?.[0];
  const header = sheet?.rows?.[0] ?? [];
  const body = sheet?.rows?.slice(1) ?? [];

  return (
    <>
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <FileArrowDown size={14} className="shrink-0 text-muted-foreground" />
        <span className="shrink-0 text-[11px] font-medium text-foreground">{t("test.report.fileXlsx")}</span>
        <span className="truncate font-mono text-[10px] text-muted-foreground">{`${taskName}-${env}-执行矩阵.xlsx`}</span>
        <span className="flex-1" />
        <a href={`/api/test/report-xlsx?projectPath=${encodeURIComponent(projectPath)}&taskName=${encodeURIComponent(taskName)}&env=${encodeURIComponent(env)}&download=1`} className="flex shrink-0 items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] text-foreground hover:bg-muted"><DownloadSimple size={12} /> {t("test.report.exportFile")}</a>
        <button onClick={onClose} className="shrink-0 text-muted-foreground hover:text-foreground" aria-label={t("test.report.close")}><X size={14} /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-auto p-3">
        {err ? (
          <div className="flex items-center gap-2 text-[11px] text-status-error-foreground">
            {t("test.report.xlsxLoadFailed")}
            <button onClick={() => { setErr(false); setData(null); setReloadTick((n) => n + 1); }} className="rounded border border-border px-1.5 py-0.5 text-foreground hover:bg-muted">{t("test.report.retry")}</button>
          </div>
        ) : !data ? (
          <p className="text-[11px] text-muted-foreground">{t("test.report.loading")}</p>
        ) : !sheet || sheet.rows.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">{t("test.report.xlsxEmpty")}</p>
        ) : (
          <table className="w-full table-fixed border-collapse text-[11px]">
            {/* table-fixed + 归一化权重列宽（XLSX_COL_WEIGHT，总和恒为 100%）：整表贴合弹窗宽度、
                不横向溢出。长文本列（标题/用例标签/期望结果/实际结果）whitespace-normal 换行、纵向堆叠；
                短列 nowrap 保持紧凑。证据单元格内 cellNode 用 flex-wrap，多个截图/录像 chip 自动换行。 */}
            <colgroup>
              {(() => {
                const weights = header.map((h) => XLSX_COL_WEIGHT[h] ?? XLSX_COL_WEIGHT_DEFAULT);
                const total = weights.reduce((a, b) => a + b, 0) || 1;
                return header.map((_, i) => <col key={i} style={{ width: `${(weights[i] / total) * 100}%` }} />);
              })()}
            </colgroup>
            <thead>
              <tr className="bg-muted/50 text-left text-muted-foreground">
                {header.map((h, i) => <th key={i} className="whitespace-nowrap px-2 py-1.5 font-medium">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {body.map((row, ri) => (
                <tr key={ri} className="border-t border-border align-top">
                  {header.map((h, ci) => (
                    <td key={ci} className={`px-2 py-1.5 text-foreground ${XLSX_WRAP_COLS.has(h) ? "whitespace-normal [overflow-wrap:anywhere]" : "whitespace-nowrap"}`}>
                      {cellNode(row[ci] ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {/* lightbox 用 Portal 渲染到 body —— 否则它在 PreviewModal 的 overflow-hidden +
          rounded-xl 容器内，<video> 的硬件合成层会黑屏（录像加载了、控件和 0:00 都在、画面黑的
          根因；报告 tab 的 ReportView 录像不在这层嵌套故正常）。 */}
      {lightbox && createPortal(
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-6" onClick={() => setLightbox(null)}>
          {isVid(lightbox) ? (
            <video src={mediaUrl(lightbox)} controls autoPlay muted playsInline preload="metadata" className="max-h-full max-w-full" onClick={(e) => e.stopPropagation()} />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={mediaUrl(lightbox)} alt={lightbox} className="max-h-full max-w-full object-contain" onClick={(e) => e.stopPropagation()} />
          )}
        </div>,
        document.body,
      )}
    </>
  );
}

// 报告 view: browse persisted reports by 项目 → 任务 → 环境. A task can have multiple
// reports (one per env); each row expands to the full ReportView. Reads from disk via
// GET /api/test/reports (per project).
function ReportBrowser({ projects, t, model, providerId, onOpenTask, reloadSignal }: { projects: Project[]; t: T; model: string; providerId: string; onOpenTask: (projectIndex: number, taskIndex: number) => void; reloadSignal: number }) {
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
      .map((c) => `- ${c.id}：${c.actual || c.error || "（详见缺陷报告）"}${c.evidence?.length ? `（证据：${c.evidence.join("、")}）` : ""}`)
      .join("\n");
    // 修复依据改用「缺陷报告」（不再给测试报告）：已生成 → 内嵌缺陷报告 md 全文 + 路径；
    // 未生成 → 回退失败用例清单，保证仍有可定位信息（用户可在报告页先生成缺陷报告再交接）。
    const defectPath = `AI_LabTest/report/${r.task}/${r.task}-${r.env}-缺陷报告.md`;
    const body = r.defectMarkdown
      ? [`缺陷报告：${defectPath}`, "", "===== 缺陷报告（md 全文）=====", r.defectMarkdown, "===== 缺陷报告结束 ====="]
      : ["失败用例（疑似应用缺陷）：", lines || "（无结构化用例）"];
    const readHint = r.defectMarkdown ? "请先 Read 上面的缺陷报告和相关源码" : "请先结合上面的失败用例与相关源码";
    const msg = [
      "请修复测试发现的缺陷。",
      "",
      `项目：${project.name}（${project.path}）`,
      `测试任务：${r.task} · 环境：${r.env}`,
      `结果：用例 ${r.counts.total}，通过 ${r.counts.pass}，失败 ${r.counts.fail}${r.counts.blocked ? `，阻塞 ${r.counts.blocked}` : ""}`,
      "",
      ...body,
      "",
      `${readHint}，定位每个失败用例的根因并修复；改完简述每处改动。阻塞类（环境问题）不在本次修复范围。`,
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
      // 孤儿报告（任务已从任务列表删除、磁盘报告残留）：【只从列表过滤隐藏，绝不在查看
      // 路径上删除磁盘文件】。此处原先对孤儿逐个 deleteTaskReports（rmSync 递归删除报告+
      // 证据目录）——Windows 企业机上，进程高速批量删文件正中 EDR 反勒索启发式，整个内嵌
      // 服务被 native 终结（面包屑坐实：崩溃精确发生在 delete 序列中、exit -36861、死前
      // crashpad 遗言），服务重启+刷新窗口 = 用户报的「点报告 tab 过几秒跳回新建对话页」；
      // 且删除半途被杀 → 孤儿目录残留 → 下次打开报告 tab 再删再崩，死循环。
      // 查看是只读操作，不该有删除副作用；已删任务的磁盘清理由「删除任务」流程负责
      // （confirmDelete → deleteTaskReports），历史残留留在磁盘无害。
      const cleaned = res.map(({ project, reports }) => {
        const liveNames = new Set(project.tasks.map((tk) => tk.name));
        return { project, reports: reports.filter((r) => liveNames.has(r.task)) };
      });
      setGroups(cleaned.filter((g) => g.reports.length > 0));
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [projects, reloadTick, reloadSignal]);

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
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="flex h-[22px] w-[22px] flex-none items-center justify-center rounded-md bg-primary/10 text-primary"><ListChecks size={12} /></span>
                      <span className="truncate text-[13px] font-medium text-foreground">{task}</span>
                      <span className="flex-none rounded-full border border-border px-1.5 py-px text-[10px] text-muted-foreground">{t("test.report.taskTag")}</span>
                      {(() => {
                        const latest = rs.reduce((a, b) => ((Date.parse(b.time) || 0) > (Date.parse(a.time) || 0) ? b : a), rs[0]);
                        const latestBad = !!latest && (latest.circuitBroken || latest.counts.fail > 0);
                        return (
                          <span className={`flex-none rounded px-1.5 py-px text-[10px] ${latestBad ? "bg-status-error-muted text-status-error-foreground" : "bg-status-success-muted text-status-success-foreground"}`}>
                            {t(latestBad ? "test.report.latestFail" : "test.report.latestPass")}
                          </span>
                        );
                      })()}
                      {rs.length > 1 && <span className="flex-none text-[10px] text-muted-foreground">{rs.length} {t("test.report.envsSuffix")}</span>}
                    </div>
                    {(() => {
                      const taskIdx = project.tasks.findIndex((tk) => tk.name === task);
                      if (taskIdx < 0) return <span className="flex-none text-[10px] text-muted-foreground">{t("test.report.taskDeleted")}</span>;
                      const projIdx = projects.findIndex((p) => p.path === project.path);
                      return (
                        <button onClick={() => onOpenTask(projIdx, taskIdx)} className="flex flex-none items-center gap-1 text-[11px] text-primary hover:underline">
                          {t("test.report.viewTask")} <ArrowRight size={11} />
                        </button>
                      );
                    })()}
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
                                    <button key={tab} onClick={() => { setRowTab((m) => ({ ...m, [key]: tab })); if (tab === "defect" && r.counts.fail > 0 && !r.defectMarkdown && defectBusy !== key) void defectGen(project, r); }} className={`rounded px-2 py-0.5 text-[11px] ${cur === tab ? "bg-primary text-primary-foreground" : "border border-border text-foreground hover:bg-muted"}`}>{label}</button>
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
                                  {/* 问题4：缺陷报告自动生成（切到本 tab 时若有缺陷且未生成则触发），不再手动按钮。 */}
                                  {r.defectMarkdown ? (
                                    <div className="prose prose-sm dark:prose-invert max-w-none rounded-lg border border-border bg-card p-3">
                                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{r.defectMarkdown}</ReactMarkdown>
                                    </div>
                                  ) : (
                                    <p className="flex items-center gap-1 text-[11px] text-muted-foreground">{defectBusy === key ? <><SpinnerGap size={12} className="animate-spin" /> {t("test.defect.generating")}</> : t("test.defect.empty")}</p>
                                  )}
                                </div>
                              ) : (
                                <>
                                  <ReportView t={t} results={r.tests} four={r.counts} funcCounts={r.funcCounts} funcPassStr={r.funcPassStr} suiteCounts={r.suiteCounts} suitePassStr={r.suitePassStr} circuitBroken={r.circuitBroken} taskName={task} projectPath={project.path} env={r.env} taskId={project.tasks.find((tk) => tk.name === task)?.id} runHash={r.runHash} />
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

// 运行任务 · 选择起点：列出 需求分析 / 用例设计 / 测试执行 三个起点（不含测试报告）。
// 上游已完成才可选(否则锁定)；默认高亮「下一个待办步」；选「会覆盖产物」的步则按钮变「确认重跑」
// 并给红字提示。选中即从该步把整条流水线自动跑到报告。
const RUN_START_STEPS: TestStep[] = ["requirement", "cases", "execution"];
const RUN_START_SUBKEY: Record<TestStep, TranslationKey> = {
  requirement: "test.runStart.fromRequirement",
  cases: "test.runStart.fromCases",
  execution: "test.runStart.fromExecution",
  report: "test.runStart.fromExecution", // 不作起点，占位满足类型
};
function RunStartModal({
  t,
  stepStatus,
  initialDeposit,
  onRun,
  onClose,
}: {
  t: T;
  stepStatus: Record<TestStep, StepStatus>;
  /** 任务当前的「沉淀回归脚本」设置(缺省 true)。 */
  initialDeposit: boolean;
  onRun: (step: TestStep, depositScripts: boolean) => void;
  onClose: () => void;
}) {
  const opts = runStartOptions(stepStatus, STEP_ORDER, RUN_START_STEPS);
  const byStep = Object.fromEntries(opts.map((o) => [o.step, o])) as Record<TestStep, (typeof opts)[number]>;
  // 默认：下一个待办且可选 → 否则最后一个可选(已完成任务→测试执行) → 兜底需求。
  const defaultStep =
    opts.find((o) => o.isNext && o.unlocked)?.step ??
    [...opts].reverse().find((o) => o.unlocked)?.step ??
    "requirement";
  const [sel, setSel] = useState<TestStep>(defaultStep);
  const [deposit, setDeposit] = useState(initialDeposit);
  // 流水线含「测试执行」时才谈得上沉淀脚本 —— 从报告起跑不执行用例,给这个开关是噪音。
  const willExecute = STEP_ORDER.indexOf(sel) <= STEP_ORDER.indexOf("execution");
  const selOpt = byStep[sel];
  const stepName = (s: TestStep) => t(STEPS.find((x) => x.step === s)!.name);
  const willOverwrite = !!selOpt?.willOverwrite;
  return (
    <ModalShell
      title={t("test.runStart.title")}
      subtitle={t("test.runStart.subtitle")}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className={CANCEL_BTN}>{t("test.cancel")}</button>
          <button
            onClick={() => selOpt?.unlocked && onRun(sel, deposit)}
            disabled={!selOpt?.unlocked}
            className={PRIMARY_BTN}
          >
            {willOverwrite ? t("test.runStart.rerun") : t("test.runStart.start", { step: stepName(sel) })}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        {opts.map((o) => {
          const selected = o.step === sel;
          const base = "w-full rounded-md border px-3 py-2.5 text-left transition-colors";
          const cls = !o.unlocked
            ? "border-border bg-muted/30 opacity-50 cursor-not-allowed"
            : selected
              ? "border-primary bg-primary/10"
              : "border-border hover:border-primary/50";
          return (
            <button
              key={o.step}
              type="button"
              disabled={!o.unlocked}
              onClick={() => o.unlocked && setSel(o.step)}
              className={`${base} ${cls}`}
            >
              <div className="flex items-center gap-2">
                <span className={`h-3.5 w-3.5 shrink-0 rounded-full border-2 ${selected ? "border-primary" : "border-border"}`} style={selected ? { borderWidth: 4 } : undefined} />
                <span className={`flex-1 text-xs font-medium ${selected ? "text-primary" : "text-foreground"}`}>
                  {stepName(o.step)}
                  <span className="ml-1 font-normal text-muted-foreground">· {t(RUN_START_SUBKEY[o.step])}</span>
                </span>
                {o.isNext ? (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{t("test.runStart.next")}</span>
                ) : (
                  <span className="text-[10px] text-muted-foreground">{stepStatusText(stepStatus[o.step], t)}</span>
                )}
              </div>
              {!o.unlocked && (
                <div className="mt-1.5 pl-[22px] text-[10px] text-muted-foreground">{t("test.runStart.locked")}</div>
              )}
              {selected && o.unlocked && o.willOverwrite && (
                <div className="mt-1.5 flex items-center gap-1 pl-[22px] text-[10px] text-status-warning">
                  <WarningCircle size={12} /> {t("test.runStart.overwrite")}
                </div>
              )}
            </button>
          );
        })}

      {willExecute && (
        <label className="mt-1 flex cursor-pointer items-start gap-2 rounded-md border border-border px-3 py-2.5">
          <input type="checkbox" checked={deposit} onChange={(e) => setDeposit(e.target.checked)} className="mt-0.5 accent-primary" />
          <span className="min-w-0">
            <span className="text-xs font-medium text-foreground">{t("test.newTaskModal.depositScripts")}</span>
            <span className="mt-0.5 block text-[10px] leading-relaxed text-muted-foreground">
              {t("test.execConfirm.depositHint")}
            </span>
          </span>
        </label>
      )}
      </div>
    </ModalShell>
  );
}

// 执行前确认弹窗(对应设计稿截图2):确认/改写被测链接 + 选执行方式(独立窗口可见 / 后台
// 无头) + 测试连接探活,最后「测试并执行」用所选模式手动跑「测试执行」步。被测链接由服务端
// /api/test/probe 探活(避开浏览器端跨源限制)。
function ExecConfirmModal({
  t,
  initialUrl,
  unconfigured,
  initialMode,
  initialDeposit,
  onRun,
  onClose,
}: {
  t: T;
  initialUrl: string;
  /** R2：该项目未在 设置·测试账号 配置可用地址 → 顶部给软提示（运行不禁用，可临时填地址）。 */
  unconfigured?: boolean;
  initialMode: ExecMode;
  /** 该任务当前的「沉淀回归脚本」设置(缺省 true)。 */
  initialDeposit: boolean;
  onRun: (baseUrl: string, headed: boolean, depositScripts: boolean) => void;
  onClose: () => void;
}) {
  const [url, setUrl] = useState(initialUrl);
  const [headed, setHeaded] = useState(initialMode === "visible");
  // 本次执行是否沉淀回归脚本。初值取任务设置,改动会随本次运行写回任务(见 runExecutionConfirmed)。
  const [deposit, setDeposit] = useState(initialDeposit);
  const [probing, setProbing] = useState(false);
  // null = 未测;否则带可达性 + 状态码 / 错误。改地址即清空,避免显示过期结果。
  const [probe, setProbe] = useState<{ reachable: boolean; status?: number; latencyMs?: number; error?: string } | null>(null);
  const trimmed = url.trim();

  const testConn = async () => {
    if (!trimmed || probing) return;
    setProbing(true);
    setProbe(null);
    try {
      const res = await fetch("/api/test/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmed }),
      });
      const j = await res.json().catch(() => ({}));
      setProbe({ reachable: !!j.reachable, status: j.status, latencyMs: j.latencyMs, error: j.error });
    } catch (e) {
      setProbe({ reachable: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setProbing(false);
    }
  };

  // 执行方式分段按钮(选中=主色描边/底色)。
  const modeBtn = (active: boolean, onClick: () => void, Cmp: Icon, label: string) => (
    <button
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-md border px-2 py-2 text-[11px] font-medium transition-colors ${
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-background text-foreground hover:bg-muted"
      }`}
    >
      <Cmp size={13} /> {label}
    </button>
  );

  return (
    <ModalShell
      title={t("test.execConfirm.title")}
      subtitle={t("test.execConfirm.subtitle")}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className={CANCEL_BTN}>{t("test.cancel")}</button>
          <button
            disabled={!trimmed}
            onClick={() => onRun(trimmed, headed, deposit)}
            className={PRIMARY_BTN}
          >
            {t("test.execConfirm.run")}
          </button>
        </>
      }
    >
      {unconfigured && (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-status-warning-border bg-status-warning-muted px-3 py-2 text-[11px] leading-relaxed text-status-warning-foreground">
          <WarningCircle size={13} className="mt-0.5 shrink-0" />
          <span>{t("test.execConfirm.unconfiguredHint")}</span>
        </div>
      )}
      <Field label={t("test.execConfirm.urlLabel")}>
        <input
          value={url}
          onChange={(e) => { setUrl(e.target.value); setProbe(null); }}
          placeholder={t("test.execConfirm.urlPlaceholder")}
          className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs text-foreground outline-none focus:border-primary"
        />
      </Field>

      <Field label={t("test.execConfirm.modeLabel")}>
        <div className="flex gap-2">
          {modeBtn(headed, () => setHeaded(true), Desktop, t("test.execConfirm.modeVisible"))}
          {modeBtn(!headed, () => setHeaded(false), Lightning, t("test.execConfirm.modeHeadless"))}
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
          {headed ? t("test.execConfirm.hintVisible") : t("test.execConfirm.hintHeadless")}
        </p>
      </Field>

      <Field label={t("test.newTaskModal.depositScriptsLabel")}>
        <label className="flex cursor-pointer items-start gap-2">
          <input type="checkbox" checked={deposit} onChange={(e) => setDeposit(e.target.checked)} className="mt-0.5 accent-primary" />
          <span className="min-w-0">
            <span className="text-xs text-foreground">{t("test.newTaskModal.depositScripts")}</span>
            <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">
              {t("test.execConfirm.depositHint")}
            </span>
          </span>
        </label>
      </Field>

      <div className="flex items-center gap-2">
        <button
          onClick={testConn}
          disabled={!trimmed || probing}
          className="flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-[11px] font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
        >
          {probing ? <SpinnerGap size={12} className="animate-spin" /> : <Plug size={12} />}
          {probing ? t("test.execConfirm.testing") : t("test.execConfirm.testConn")}
        </button>
        {probe && (
          probe.reachable ? (
            <span className="flex items-center gap-1 text-[11px] font-medium text-status-success-foreground">
              <CheckCircle size={13} weight="fill" />
              {t("test.execConfirm.reachable")}{typeof probe.status === "number" ? ` · ${probe.status}` : ""}{typeof probe.latencyMs === "number" ? ` · ${probe.latencyMs}ms` : ""}
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[11px] font-medium text-status-error-foreground" title={probe.error || ""}>
              <WarningCircle size={13} weight="fill" />
              {t("test.execConfirm.unreachable")}{probe.error ? ` · ${probe.error}` : ""}
            </span>
          )
        )}
      </div>
    </ModalShell>
  );
}

// R2 软提醒弹窗：运行整条流水线但项目未配置环境地址时弹出。区分两种未配置：
// source==='none'（该项目没有测试账号系统）vs 地址为空（有系统但该环境 frontendBaseUrl 缺失）。
// 「去配置」深链到 设置·测试账号；「仍要运行」遵从用户意图继续（软提醒、不阻断）。
function EnvWarnModal({
  t,
  source,
  env,
  onGoConfigure,
  onRunAnyway,
  onClose,
}: {
  t: T;
  source?: string;
  env: string;
  onGoConfigure: () => void;
  onRunAnyway: () => void;
  onClose: () => void;
}) {
  const envLabel = env === "sit" ? "SIT" : env;
  const body = source === "none" ? t("test.env.runWarn.none") : t("test.env.runWarn.empty", { env: envLabel });
  return (
    <ModalShell
      title={t("test.env.runWarn.title")}
      subtitle={t("test.env.runWarn.subtitle")}
      onClose={onClose}
      footer={
        <>
          <button onClick={onGoConfigure} className={CANCEL_BTN}>{t("test.env.runWarn.goConfigure")}</button>
          <button onClick={onRunAnyway} className={PRIMARY_BTN}>{t("test.env.runWarn.runAnyway")}</button>
        </>
      }
    >
      <div className="flex items-start gap-2 rounded-md border border-status-warning-border bg-status-warning-muted px-3 py-2.5 text-[11px] leading-relaxed text-status-warning-foreground">
        <WarningCircle size={14} className="mt-0.5 shrink-0" />
        <span>{body}</span>
      </div>
    </ModalShell>
  );
}

function NewTaskModal({ t, onClose, onAdd, existingNames }: { t: T; onClose: () => void; onAdd: (name: string, files?: NewTaskFiles, depositScripts?: boolean, targetUrl?: string) => Promise<{ ok: boolean; error?: string }>; existingNames: string[] }) {
  const [name, setName] = useState("");
  // 任务目标地址(可选):填了则执行时直测该 URL(优先于项目环境配置);空 = 跟随环境配置。
  const [targetUrl, setTargetUrl] = useState("");
  // 是否为该任务沉淀回归脚本。默认关(用户反馈:多数新任务并不需要沉淀脚本,而每条用例约两
  // 分钟的生成与真机重放开销不该默认承担);需要的用户在此勾选或到任务页随时开。
  // 语义:depositScripts=false → addTask 落 taskState.depositScripts=false;不勾选=false,
  // 与「任务级缺省 undefined=开」正交——新建这一步的默认独立于既有任务的缺省语义。
  const [depositScripts, setDepositScripts] = useState(false);
  const [reqFile, setReqFile] = useState<{ name: string; data: string } | null>(null);
  const [casesFile, setCasesFile] = useState<{ name: string; data: string } | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const reqInputRef = useRef<HTMLInputElement>(null);
  const casesInputRef = useRef<HTMLInputElement>(null);
  // 重名实时校验：trim 后精确比较、区分大小写（与 addTask 兜底一致）。
  const trimmedName = name.trim();
  const isDuplicateName = !!trimmedName && existingNames.some((n) => n.trim() === trimmedName);
  // 新建任务必须至少导入 用例 或 需求 之一，且任务名不与同项目已有任务重名。
  const ready = !!trimmedName && (!!reqFile || !!casesFile) && !isDuplicateName;

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
    try {
      const res = await onAdd(name.trim(), {
        requirement: reqFile ? { filename: reqFile.name, dataBase64: reqFile.data } : undefined,
        cases: casesFile ? { filename: casesFile.name, dataBase64: casesFile.data } : undefined,
      }, depositScripts, targetUrl.trim() || undefined);
      if (res.ok) onClose();
      else setErr(res.error || t("test.newTaskModal.importFailed"));
    } catch (e) {
      // onAdd(=addTask) 内部任一 await（postImport 的 fetch、网络异常、import 路由 500）
      // 抛错时必须在这里兜住 —— 否则下面的 setBusy(false) 永不执行，按钮一直卡在「导入中」、
      // 整个弹窗禁用死锁。这正是 Windows 包反馈「导需求/用例后点创建一直导入中」的直接原因。
      setErr(e instanceof Error ? e.message : t("test.newTaskModal.importFailed"));
    } finally {
      setBusy(false);
    }
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
        <input
          className={isDuplicateName ? INPUT.replace("border-border", "border-status-error-border") : INPUT}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("test.newTaskModal.namePlaceholder")}
        />
        {isDuplicateName && (
          <p className="mt-1 text-[11px] text-status-error-foreground">⚠ {t("test.newTaskModal.duplicateName")}</p>
        )}
      </Field>
      <Field label={t("test.newTaskModal.targetLabel")}>
        <input
          className={INPUT}
          value={targetUrl}
          onChange={(e) => setTargetUrl(e.target.value)}
          placeholder="http://localhost:3000/..."
        />
        {!!targetUrl.trim() && (
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{t("test.newTaskModal.targetHint")}</p>
        )}
      </Field>
      <Field label={t("test.newTaskModal.importLabel")}>
        <div className="flex gap-2">
          <button onClick={() => casesInputRef.current?.click()} className="h-9 flex-1 rounded-md border border-border text-xs text-foreground hover:bg-muted">📊 {t("test.newTaskModal.importCases")}</button>
          <button onClick={() => reqInputRef.current?.click()} className="h-9 flex-1 rounded-md border border-border text-xs text-foreground hover:bg-muted">📄 {t("test.newTaskModal.importReqs")}</button>
        </div>
        <input ref={casesInputRef} type="file" accept=".json,.xlsx,.xls" className="hidden" onChange={(e) => { pick(e.target.files?.[0], setCasesFile); e.target.value = ""; }} />
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
      <Field label={t("test.newTaskModal.depositScriptsLabel")}>
        <label className="flex cursor-pointer items-start gap-2">
          <input
            type="checkbox"
            checked={depositScripts}
            onChange={(e) => setDepositScripts(e.target.checked)}
            className="mt-0.5 accent-primary"
          />
          <span className="min-w-0">
            <span className="text-xs text-foreground">{t("test.newTaskModal.depositScripts")}</span>
            <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">
              {t("test.newTaskModal.depositScriptsHint")}
            </span>
          </span>
        </label>
      </Field>
      {!ready && (
        <div className="rounded-md bg-status-warning-muted px-3 py-2 text-[11px] text-status-warning-foreground">
          ⚠ {t("test.newTaskModal.importRequired")}
        </div>
      )}
    </ModalShell>
  );
}
