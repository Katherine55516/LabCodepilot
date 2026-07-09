"use client";

import { useEffect, useMemo, useState } from "react";
import type { TranslationKey } from "@/i18n";
import type {
  TestStatsGlobal,
  TestStatsModelRow,
  TestStatsNodeRound,
  TestStatsTaskDetail,
  TestStatsTaskRow,
  TestStatsCounts,
} from "@/types";

type T = (key: TranslationKey, params?: Record<string, string | number>) => string;

/**
 * 测试模块使用统计 · 看板视图（面板第 4 个 view）。
 *
 * 数据全部来自 /api/test/stats（Phase 1 聚合层）：scope=global（KPI + 周趋势 + 任务明细）、
 * scope=model（模型效果）、scope=task（单任务节点轮次，行展开时按需拉）。图表用内联 SVG
 * 自绘、无新依赖；口径已在服务端冻结（首轮基线采纳率、熔断轮排除、复核覆盖率等）。
 * 独立文件承载，避免继续膨胀 InlineTestingPanel（~4k 行）。产品原型见 exec-plan 链接。
 */

// ---------- 纯展示格式化 ----------
function fmtDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${String(s % 60).padStart(2, "0")}s`;
}
function pct(v: number | null | undefined, digits = 1): string {
  if (v == null) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}
function fmtDate(s: string | null): string {
  if (!s) return "—";
  // 'YYYY-MM-DD HH:MM:SS' → 'MM-DD'
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[2]}-${m[3]}` : s;
}
function fourStateChips(c: TestStatsCounts | null, t: T) {
  if (!c) return <span className="text-muted-foreground">—</span>;
  const chip = (n: number, cls: string, label: TranslationKey) =>
    n > 0 ? <span className={`rounded px-1 py-0.5 text-[10px] font-medium ${cls}`}>{t(label)} {n}</span> : null;
  return (
    <span className="flex flex-wrap gap-1">
      {chip(c.pass, "bg-status-success-muted text-status-success-foreground", "test.state.pass")}
      {chip(c.fail, "bg-status-error-muted text-status-error-foreground", "test.state.fail")}
      {chip(c.partial, "bg-status-warning-muted text-status-warning-foreground", "test.state.partial")}
      {chip(c.blocked, "bg-muted text-muted-foreground", "test.state.blocked")}
    </span>
  );
}

// ---------- SVG 图元 ----------
const AX = "fill-muted-foreground text-[9px]";

/** 柱状图（单系列）。 */
function BarChart({ data, labels, height = 150 }: { data: number[]; labels: string[]; height?: number }) {
  const W = 520, H = height, x0 = 34, x1 = 510, yTop = 16, yBase = H - 22;
  const maxV = Math.max(1, ...data);
  const slot = (x1 - x0) / Math.max(1, data.length), bw = Math.min(34, slot * 0.6);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img">
      {[0, maxV / 2, maxV].map((tk, i) => {
        const y = yBase - (tk / maxV) * (yBase - yTop);
        return <g key={i}>
          <line x1={x0} y1={y} x2={x1} y2={y} stroke="var(--border)" strokeWidth={1} />
          <text x={x0 - 5} y={y + 3} textAnchor="end" className={AX}>{Math.round(tk)}</text>
        </g>;
      })}
      {data.map((v, i) => {
        const h = (v / maxV) * (yBase - yTop);
        return <g key={i}>
          <rect x={x0 + slot * i + (slot - bw) / 2} y={yBase - h} width={bw} height={h} rx={4} fill="var(--primary)" opacity={i === data.length - 1 ? 0.95 : 0.5} />
          {v > 0 && <text x={x0 + slot * i + slot / 2} y={yBase - h - 4} textAnchor="middle" className={AX}>{v}</text>}
          <text x={x0 + slot * i + slot / 2} y={yBase + 14} textAnchor="middle" className={AX}>{labels[i]}</text>
        </g>;
      })}
    </svg>
  );
}

/** 堆叠柱（采纳构成：原样 / 修改后 / 弃用）。 */
function StackChart({ rows, labels, height = 150 }: { rows: { kept: number; modified: number; removed: number }[]; labels: string[]; height?: number }) {
  const W = 520, H = height, x0 = 34, x1 = 510, yTop = 16, yBase = H - 22;
  const totals = rows.map((r) => r.kept + r.modified + r.removed);
  const maxV = Math.max(1, ...totals);
  const slot = (x1 - x0) / Math.max(1, rows.length), bw = Math.min(30, slot * 0.6);
  const unit = (yBase - yTop) / maxV;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img">
      {[0, maxV / 2, maxV].map((tk, i) => {
        const y = yBase - (tk / maxV) * (yBase - yTop);
        return <g key={i}><line x1={x0} y1={y} x2={x1} y2={y} stroke="var(--border)" strokeWidth={1} /><text x={x0 - 5} y={y + 3} textAnchor="end" className={AX}>{Math.round(tk)}</text></g>;
      })}
      {rows.map((r, i) => {
        const x = x0 + slot * i + (slot - bw) / 2;
        let y = yBase;
        const segs: [number, string][] = [[r.kept, "var(--primary)"], [r.modified, "color-mix(in oklab, var(--primary) 45%, transparent)"], [r.removed, "var(--border)"]];
        return <g key={i}>
          {segs.map(([val, fill], k) => { const h = val * unit; y -= h; return h > 0 ? <rect key={k} x={x} y={y} width={bw} height={Math.max(0, h - 1)} rx={2} fill={fill} /> : null; })}
          <text x={x + bw / 2} y={yBase + 14} textAnchor="middle" className={AX}>{labels[i]}</text>
        </g>;
      })}
    </svg>
  );
}

/** 折线（准确度趋势，0-100%，null 点断开）。 */
function LineChart({ data, labels, height = 150 }: { data: (number | null)[]; labels: string[]; height?: number }) {
  const W = 520, H = height, x0 = 40, x1 = 510, yTop = 16, yBase = H - 22;
  const slot = (x1 - x0) / Math.max(1, data.length);
  const yFor = (v: number) => yBase - v * (yBase - yTop);
  const pts = data.map((v, i) => (v == null ? null : [x0 + slot * i + slot / 2, yFor(v)] as [number, number]));
  // 分段（跳过 null）
  const segments: [number, number][][] = [];
  let cur: [number, number][] = [];
  for (const p of pts) { if (p) cur.push(p); else { if (cur.length) segments.push(cur); cur = []; } }
  if (cur.length) segments.push(cur);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img">
      {[0, 0.5, 1].map((tk, i) => { const y = yFor(tk); return <g key={i}><line x1={x0} y1={y} x2={x1} y2={y} stroke="var(--border)" strokeWidth={1} /><text x={x0 - 5} y={y + 3} textAnchor="end" className={AX}>{tk * 100}%</text></g>; })}
      {segments.map((seg, i) => <polyline key={i} points={seg.map((p) => p.join(",")).join(" ")} fill="none" stroke="var(--status-success)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />)}
      {pts.map((p, i) => p ? <circle key={i} cx={p[0]} cy={p[1]} r={2.5} fill="var(--status-success)" /> : null)}
      {labels.map((lb, i) => <text key={i} x={x0 + slot * i + slot / 2} y={yBase + 14} textAnchor="middle" className={AX}>{lb}</text>)}
    </svg>
  );
}

/** 甜甜圈（复核结论分布）。 */
function Donut({ segs, centerLabel, centerSub }: { segs: { v: number; color: string }[]; centerLabel: string; centerSub: string }) {
  const r = 46, cx = 60, cy = 60, circ = 2 * Math.PI * r;
  const total = Math.max(1, segs.reduce((a, s) => a + s.v, 0));
  // 前缀和预计算每段起始偏移（避免在 render 的 map 里跨迭代可变量）
  const arcs: { len: number; offset: number; color: string }[] = [];
  let run = 0;
  for (const s of segs) { const len = (s.v / total) * circ; arcs.push({ len, offset: run, color: s.color }); run += len; }
  return (
    <svg viewBox="0 0 120 120" className="h-[120px] w-[120px] shrink-0" role="img">
      {arcs.map((a, i) => <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={a.color} strokeWidth={15} strokeDasharray={`${Math.max(0, a.len - 1.5)} ${circ - a.len + 1.5}`} strokeDashoffset={-a.offset} transform={`rotate(-90 ${cx} ${cy})`} />)}
      <text x={cx} y={cy - 1} textAnchor="middle" className="fill-foreground text-[17px] font-semibold">{centerLabel}</text>
      <text x={cx} y={cy + 15} textAnchor="middle" className={AX}>{centerSub}</text>
    </svg>
  );
}

/** 水平条（各步骤平均用时）。 */
function HBars({ rows }: { rows: { label: string; ms: number }[] }) {
  const W = 520, rowH = 30, H = rows.length * rowH + 10, x0 = 84, x1 = 430;
  const maxV = Math.max(1, ...rows.map((r) => r.ms));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img">
      {rows.map((r, i) => {
        const y = 8 + i * rowH, len = Math.max(2, (r.ms / maxV) * (x1 - x0));
        return <g key={i}>
          <text x={x0 - 8} y={y + 13} textAnchor="end" className="fill-foreground text-[11px]">{r.label}</text>
          <rect x={x0} y={y} width={len} height={17} rx={4} fill="var(--primary)" opacity={0.55} />
          <text x={x0 + len + 6} y={y + 13} className={AX}>{fmtDuration(r.ms)}</text>
        </g>;
      })}
    </svg>
  );
}

// ---------- 卡片外壳 ----------
function Card({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3.5">
      <div className="mb-2 flex items-baseline gap-2">
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</h4>
        {sub && <span className="text-[10px] text-muted-foreground">{sub}</span>}
      </div>
      {children}
    </div>
  );
}
function Legend({ items }: { items: { color: string; label: string }[] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
      {items.map((it, i) => <span key={i} className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm" style={{ background: it.color }} />{it.label}</span>)}
    </div>
  );
}

export function TestStatsView({ t }: { t: T }) {
  const [global, setGlobal] = useState<TestStatsGlobal | null>(null);
  const [models, setModels] = useState<TestStatsModelRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, TestStatsTaskDetail | null>>({});

  useEffect(() => {
    // 空依赖：仅挂载时拉一次；loading 初值已为 true、error 为 false，无需在此同步 setState。
    let cancelled = false;
    Promise.all([
      fetch("/api/test/stats?scope=global").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/test/stats?scope=model").then((r) => (r.ok ? r.json() : null)),
    ]).then(([g, m]) => {
      if (cancelled) return;
      if (g?.data) setGlobal(g.data as TestStatsGlobal); else setError(true);
      if (m?.data) setModels(m.data as TestStatsModelRow[]);
      setLoading(false);
    }).catch(() => { if (!cancelled) { setError(true); setLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  const toggleTask = (taskId: string) => {
    if (expanded === taskId) { setExpanded(null); return; }
    setExpanded(taskId);
    if (!(taskId in detail)) {
      fetch(`/api/test/stats?scope=task&taskId=${encodeURIComponent(taskId)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => setDetail((m) => ({ ...m, [taskId]: (d?.data ?? null) as TestStatsTaskDetail | null })))
        .catch(() => setDetail((m) => ({ ...m, [taskId]: null })));
    }
  };

  const weekLabels = useMemo(() => (global?.weekly ?? []).map((w) => fmtDate(w.weekStart)), [global]);

  if (loading) return <div className="py-16 text-center text-sm text-muted-foreground">{t("test.stats.loading")}</div>;
  if (error || !global) return <div className="py-16 text-center text-sm text-muted-foreground">{t("test.stats.loadError")}</div>;
  // 空态按「聚合出的实际内容」判定，而非 tasks.total —— task_created 是 fire-and-forget，
  // 若它失败但后续服务端事件（执行/复核）落了库，仍应显示看板（评审 L2）。
  if (global.taskRows.length === 0 && (models?.length ?? 0) === 0) return <div className="py-16 text-center text-sm text-muted-foreground">{t("test.stats.empty")}</div>;

  const g = global;
  const rev = g.review;
  const timedCases = g.execution.durationBuckets.reduce((a, b) => a + b.count, 0);
  const donutSegs = [
    { v: rev.accurate, color: "var(--status-success)" },
    { v: rev.falseFail, color: "var(--status-error)" },
    { v: rev.missedFail, color: "var(--status-warning)" },
    { v: rev.severityMismatch, color: "var(--muted-foreground)" },
  ];
  const stepRows = (["requirement", "cases", "execution", "report"] as const)
    .map((s) => ({ label: t(`test.step.${s === "requirement" ? "requirements" : s}.name` as TranslationKey), ms: g.execution.stepAvgDurationsMs[s] ?? 0 }))
    .filter((r) => r.ms > 0);

  return (
    <div className="flex flex-col gap-3">
      {/* 工具条 + 导出 */}
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-foreground">{t("test.stats.title")}</h3>
        <span className="text-[11px] text-muted-foreground">{t("test.stats.rangeAll")}</span>
        <span className="flex-1" />
        <a href="/api/test/stats/export?format=xlsx" className="rounded-md border border-border px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-muted">⬇ {t("test.stats.exportXlsx")}</a>
      </div>

      {/* KPI 四卡 */}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <div className="rounded-xl border border-border bg-card p-3.5">
          <div className="text-[11px] text-muted-foreground">{t("test.stats.kpiTasks")}</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{g.tasks.total}</div>
          <div className="mt-1 text-[11px] text-muted-foreground">{t("test.stats.kpiTasksSub", { ai: g.tasks.aiFlow, imported: g.tasks.importedCases })}</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-3.5">
          <div className="text-[11px] text-muted-foreground">{t("test.stats.kpiAdoption")}</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{pct(g.adoption.adoptionRate)}</div>
          <div className="mt-1 text-[11px] text-muted-foreground">{t("test.stats.kpiAdoptionSub", { gen: g.adoption.generated, kept: pct(g.adoption.keptRate, 0) })}</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-3.5">
          <div className="text-[11px] text-muted-foreground">{t("test.stats.kpiExec")}</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{g.execution.runs}<span className="ml-1 text-sm font-normal text-muted-foreground">{t("test.stats.runsUnit")}</span></div>
          <div className="mt-1 text-[11px] text-muted-foreground">{t("test.stats.kpiExecSub", { rate: pct(g.execution.passRate, 0), avg: fmtDuration(g.execution.avgCaseDurationMs) })}</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-3.5">
          <div className="text-[11px] text-muted-foreground">{t("test.stats.kpiAccuracy")}</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{pct(rev.accuracy)}</div>
          <div className="mt-1 text-[11px] text-muted-foreground">{t("test.stats.kpiAccuracySub", { reviewed: rev.reviewed, total: rev.totalResults, coverage: pct(rev.coverage, 0) })}</div>
        </div>
      </div>

      {/* 图表网格 */}
      <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
        <Card title={t("test.stats.chartTaskTrend")} sub={t("test.stats.perWeek")}>
          <BarChart data={g.weekly.map((w) => w.tasksCreated)} labels={weekLabels} />
        </Card>
        <Card title={t("test.stats.chartAdoption")} sub={t("test.stats.perWeek")}>
          <StackChart rows={g.weekly.map((w) => ({ kept: w.casesKept, modified: w.casesModified, removed: w.casesRemoved }))} labels={weekLabels} />
          <Legend items={[{ color: "var(--primary)", label: t("test.stats.legendKept") }, { color: "color-mix(in oklab, var(--primary) 45%, transparent)", label: t("test.stats.legendModified") }, { color: "var(--border)", label: t("test.stats.legendRemoved") }]} />
        </Card>
        <Card title={t("test.stats.chartVerdicts")}>
          <div className="flex items-center gap-3">
            <Donut segs={donutSegs} centerLabel={pct(rev.accuracy, 0)} centerSub={t("test.stats.reviewedN", { n: rev.reviewed })} />
            <div className="flex flex-col gap-1 text-[11px]">
              <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "var(--status-success)" }} />{t("test.review.accurate")} <b className="tabular-nums">{rev.accurate}</b></span>
              <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "var(--status-error)" }} />{t("test.review.falseFail")} <b className="tabular-nums">{rev.falseFail}</b></span>
              <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "var(--status-warning)" }} />{t("test.review.missedFail")} <b className="tabular-nums">{rev.missedFail}</b></span>
              <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "var(--muted-foreground)" }} />{t("test.review.severityMismatch")} <b className="tabular-nums">{rev.severityMismatch}</b></span>
            </div>
          </div>
        </Card>
        <Card title={t("test.stats.chartAccuracy")} sub={t("test.stats.perWeek")}>
          <LineChart data={g.weekly.map((w) => w.reviewAccuracy)} labels={weekLabels} />
        </Card>
        <Card title={t("test.stats.chartDurations")} sub={t("test.stats.timedCaseN", { n: timedCases })}>
          <BarChart data={g.execution.durationBuckets.map((b) => b.count)} labels={g.execution.durationBuckets.map((b) => b.label)} />
        </Card>
        <Card title={t("test.stats.chartStepDur")}>
          {stepRows.length ? <HBars rows={stepRows} /> : <div className="py-6 text-center text-[11px] text-muted-foreground">—</div>}
        </Card>
      </div>

      {/* 模型使用与效果 */}
      <Card title={t("test.stats.modelTitle")} sub={t("test.stats.modelSub")}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1.5 pr-3 font-medium">{t("test.stats.colModel")}</th>
                <th className="px-2 py-1.5 font-medium">{t("test.stats.colTasksRuns")}</th>
                <th className="px-2 py-1.5 font-medium">{t("test.stats.colAdoption")}</th>
                <th className="px-2 py-1.5 font-medium">{t("test.stats.colAccuracy")}</th>
                <th className="px-2 py-1.5 font-medium">{t("test.stats.colPassRate")}</th>
                <th className="px-2 py-1.5 font-medium">{t("test.stats.colAvgDur")}</th>
              </tr>
            </thead>
            <tbody>
              {(models ?? []).map((m) => (
                <tr key={m.model} className="border-t border-border">
                  <td className="py-1.5 pr-3 font-mono">{m.model}{m.smallSample && <span className="ml-1 rounded bg-primary/10 px-1 py-0.5 text-[9px] text-primary">{t("test.stats.smallSample")}</span>}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 tabular-nums">{m.tasks} / {m.executionRuns}</td>
                  <td className="px-2 py-1.5 tabular-nums">{m.adoptionGenerated > 0 ? pct(m.adoptionRate) : "—"}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 tabular-nums">{m.reviewed > 0 ? <>{pct(m.accuracy)} <span className="text-muted-foreground">· {t("test.stats.coverageN", { n: pct(m.coverage, 0) })}</span></> : "—"}</td>
                  <td className="px-2 py-1.5 tabular-nums">{m.results.total > 0 ? pct(m.passRate) : "—"}</td>
                  <td className="px-2 py-1.5 tabular-nums">{fmtDuration(m.avgCaseDurationMs)}</td>
                </tr>
              ))}
              {(!models || models.length === 0) && <tr><td colSpan={6} className="py-3 text-center text-muted-foreground">—</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[10px] text-muted-foreground">{t("test.stats.modelNote")}</p>
      </Card>

      {/* 任务明细（可展开节点轮次矩阵） */}
      <Card title={t("test.stats.taskTitle")}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1.5 pr-2 font-medium">{t("test.stats.colTask")}</th>
                <th className="px-2 py-1.5 font-medium">{t("test.stats.colCreated")}</th>
                <th className="px-2 py-1.5 font-medium">{t("test.stats.colGenAdopt")}</th>
                <th className="px-2 py-1.5 font-medium">{t("test.stats.colRuns")}</th>
                <th className="px-2 py-1.5 font-medium">{t("test.stats.colLatest")}</th>
                <th className="px-2 py-1.5 font-medium">{t("test.stats.colReview")}</th>
              </tr>
            </thead>
            <tbody>
              {g.taskRows.map((r) => <TaskRow key={r.taskId} row={r} t={t} expanded={expanded === r.taskId} detail={detail[r.taskId]} onToggle={() => toggleTask(r.taskId)} />)}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ---------- 任务明细行 + 展开详情 ----------
function TaskRow({ row, t, expanded, detail, onToggle }: { row: TestStatsTaskRow; t: T; expanded: boolean; detail: TestStatsTaskDetail | null | undefined; onToggle: () => void }) {
  const genAdopt = row.adoptionEligible
    ? (row.generated != null ? `${row.generated} → ${row.adopted ?? "—"}` : "—")
    : t("test.stats.importedCases");
  return (
    <>
      <tr className="cursor-pointer border-t border-border hover:bg-muted/40" onClick={onToggle}>
        <td className="py-1.5 pr-2">
          <span className="mr-1 inline-block w-3 text-muted-foreground">{expanded ? "▾" : "▸"}</span>
          <span className="font-medium text-foreground">{row.taskName || row.taskId}</span>
          {row.deleted && <span className="ml-1 text-[10px] text-muted-foreground">({t("test.stats.deleted")})</span>}
        </td>
        <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-muted-foreground">{fmtDate(row.createdAt)}</td>
        <td className="whitespace-nowrap px-2 py-1.5 tabular-nums">{genAdopt}</td>
        <td className="px-2 py-1.5 tabular-nums">{row.executionRuns}</td>
        <td className="px-2 py-1.5">{row.latestCircuitBroken ? <span className="text-status-error-foreground">{t("test.stats.circuitBroken")}</span> : fourStateChips(row.latestResults, t)}</td>
        <td className="whitespace-nowrap px-2 py-1.5 tabular-nums">{row.reviewTotal > 0 ? <>{row.reviewed}/{row.reviewTotal}{row.reviewed > 0 && row.accuracy != null && <span className="ml-1 text-muted-foreground">· {pct(row.accuracy, 0)}</span>}</> : "—"}</td>
      </tr>
      {expanded && (
        <tr className="border-t border-border bg-muted/20">
          <td colSpan={6} className="p-3">
            {detail === undefined ? <div className="text-center text-[11px] text-muted-foreground">{t("test.stats.loading")}</div>
              : detail === null ? <div className="text-center text-[11px] text-muted-foreground">{t("test.stats.loadError")}</div>
                : <NodeRoundMatrix detail={detail} t={t} />}
          </td>
        </tr>
      )}
    </>
  );
}

/** 节点轮次横向对比：每节点一卡，指标做行、轮次做列。 */
function NodeRoundMatrix({ detail, t }: { detail: TestStatsTaskDetail; t: T }) {
  const byStep = useMemo(() => {
    const m: Record<string, TestStatsNodeRound[]> = { requirement: [], cases: [], execution: [], report: [] };
    for (const r of detail.rounds) (m[r.step] ??= []).push(r);
    return m;
  }, [detail]);
  const stepName: Record<string, TranslationKey> = {
    requirement: "test.step.requirements.name", cases: "test.step.cases.name", execution: "test.step.execution.name", report: "test.step.report.name",
  };
  const delta = (cur: number | null, prev: number | null, unit = "pp") => {
    if (cur == null || prev == null) return null;
    const d = (cur - prev) * 100;
    if (Math.abs(d) < 0.05) return null;
    return <span className={`ml-1 rounded px-1 text-[9px] font-bold ${d > 0 ? "bg-status-success-muted text-status-success-foreground" : "bg-status-error-muted text-status-error-foreground"}`}>{d > 0 ? "+" : ""}{d.toFixed(1)}{unit}</span>;
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{t("test.stats.nodeRoundsTitle")}</div>
      <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
        {(["requirement", "cases", "execution", "report"] as const).map((step) => {
          const rounds = byStep[step] ?? [];
          if (!rounds.length) return null;
          return (
            <div key={step} className="overflow-x-auto rounded-lg border border-border bg-card p-2.5">
              <div className="mb-1.5 flex items-center gap-1.5 text-[11px]">
                <span className="h-2 w-2 rounded-full bg-status-success" />
                <b>{t(stepName[step])}</b>
                <span className="text-[10px] text-muted-foreground">{t("test.stats.roundsN", { n: rounds.length })}</span>
              </div>
              <table className="border-collapse text-[11px]">
                <thead>
                  <tr>
                    <th className="w-16 py-1 pr-2" />
                    {rounds.map((r) => <th key={r.round} className="whitespace-nowrap px-2 py-1 text-left font-semibold">{t("test.stats.roundN", { n: r.round })}<span className="block text-[9px] font-normal text-muted-foreground tabular-nums">{fmtDate(r.at)}</span></th>)}
                  </tr>
                </thead>
                <tbody>
                  <MetricRow label={t("test.stats.rowModel")} rounds={rounds} render={(r) => <span className="font-mono text-[10px]">{r.model || "—"}</span>} />
                  <MetricRow label={t("test.stats.rowDuration")} rounds={rounds} render={(r) => <span className="tabular-nums">{fmtDuration(r.durationMs)}</span>} />
                  {step === "cases" && <>
                    <MetricRow label={t("test.stats.rowGenerated")} rounds={rounds} render={(r) => <span className="tabular-nums">{r.caseCount ?? "—"}</span>} />
                    <MetricRow label={t("test.stats.rowAdoptRate")} rounds={rounds} render={(r, i) => <span className="tabular-nums font-medium">{r.adoption ? pct(r.adoption.rate) : "—"}{r.adoption && delta(r.adoption.rate, rounds[i - 1]?.adoption?.rate ?? null)}</span>} />
                    <MetricRow label={t("test.stats.rowKept")} rounds={rounds} render={(r) => <span className="tabular-nums">{r.adoption?.kept ?? "—"}</span>} />
                    <MetricRow label={t("test.stats.rowModified")} rounds={rounds} render={(r) => <span className="tabular-nums">{r.adoption?.modified ?? "—"}</span>} />
                    <MetricRow label={t("test.stats.rowRemoved")} rounds={rounds} render={(r) => <span className="tabular-nums">{r.adoption?.removed ?? "—"}</span>} />
                  </>}
                  {step === "execution" && <>
                    <MetricRow label={t("test.stats.rowEnv")} rounds={rounds} render={(r) => <span>{r.env || "—"}</span>} />
                    <MetricRow label={t("test.stats.rowPassRate")} rounds={rounds} render={(r, i) => r.circuitBroken ? <span className="text-status-error-foreground">{t("test.stats.circuitBroken")}</span> : <span className="tabular-nums font-medium">{pct(r.passRate)}{delta(r.passRate, rounds[i - 1]?.passRate ?? null)}</span>} />
                    <MetricRow label={t("test.stats.rowFourState")} rounds={rounds} render={(r) => fourStateChips(r.results, t)} />
                  </>}
                  {step === "report" && <>
                    <MetricRow label={t("test.stats.rowReviewed")} rounds={rounds} render={(r) => <span className="tabular-nums">{r.reviewed != null ? r.reviewed : "—"}</span>} />
                    <MetricRow label={t("test.stats.rowAccuracy")} rounds={rounds} render={(r) => <span className="tabular-nums font-medium">{r.accuracy != null ? pct(r.accuracy) : "—"}</span>} />
                  </>}
                  {(step === "requirement") && <MetricRow label={t("test.stats.rowOutput")} rounds={rounds} render={(r) => <span className="text-muted-foreground">{r.status || "—"}</span>} />}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-muted-foreground">{t("test.stats.nodeRoundsNote")}</p>
    </div>
  );
}

function MetricRow({ label, rounds, render }: { label: string; rounds: TestStatsNodeRound[]; render: (r: TestStatsNodeRound, i: number) => React.ReactNode }) {
  return (
    <tr className="border-t border-border/50">
      <td className="py-1 pr-2 text-[10px] text-muted-foreground">{label}</td>
      {rounds.map((r, i) => <td key={i} className="whitespace-nowrap px-2 py-1">{render(r, i)}</td>)}
    </tr>
  );
}
