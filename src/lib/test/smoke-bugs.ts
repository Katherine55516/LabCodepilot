/**
 * 冒烟测试 · Bug 清单派生与人工复核覆盖层（纯函数，无 fs）。
 *
 * 口径（读代码前必知）：
 * - **Bug ↔ 失败场景 1:1**：run.json 里 `status==='fail'` 的场景各派生一条 Bug；
 *   blocked/partial 不是应用缺陷，不进清单（与冒烟报告 prompt 的口径一致）。
 * - **run.json 只读**：Bug 的事实字段（actual/error/api/evidence）全部从 run.json 派生，
 *   人工可写的只有 严重级别 与 备注，落在旁路文件 `{任务}-{env}.bugs.json` ——
 *   run.json 是确定性归约产物（四态由代码算、不由人改），不能被人工写入污染。
 * - **AI 初判严重级别来自报告 md**：冒烟报告 prompt 要求每条 Bug 按固定字段输出
 *   （**严重级别**：… / **关联场景**：SM-xxx / **标题**：…），这里做 best-effort 行扫描
 *   把它们捞出来；报告缺失/格式漂移时回退默认「严重」（冒烟里 fail = 主流程断点，
 *   默认从重不从轻）。解析失败绝不抛错——md 是 AI 产物，防御性读取。
 * - **runHash 绑定**：复核态（severity 覆盖/备注）只对产生它的那轮执行有效；重跑后
 *   runHash 变化，旧 bugs.json 的覆盖层整体失效（GET 侧丢弃，PUT 侧重建文件）——
 *   防止上一轮的「误报」标记错挂到新一轮的同名场景上。复核**动作**本身
 *   （确认缺陷/误报/程度不符）走既有 report_reviewed 事件（也按 runHash 隔离），
 *   本模块不重复存。
 */

import type { SmokeBug, SmokeBugsFile } from '@/types';

export const SMOKE_BUGS_VERSION = 1;
/** 严重级别枚举（与原冒烟提示词一致：致命/严重/一般/建议）。 */
export const SMOKE_SEVERITIES = ['致命', '严重', '一般', '建议'] as const;
/** 报告缺失/解析不到时的默认严重级别：冒烟里 fail = 主流程断点，从重不从轻。 */
export const SMOKE_SEVERITY_DEFAULT = '严重';

/** 报告 md 里逐 Bug 捞出的 AI 初判（标题 + 严重级别），按关联场景 id 归位。 */
export interface MdBugInfo {
  title?: string;
  severity?: string;
}

/**
 * 从冒烟报告 md 里 best-effort 捞每条 Bug 的 AI 初判。
 *
 * 报告模板的字段顺序是 编号 → 标题 → 严重级别 → 关联场景（见 prompts.ts
 * smokeReportPrompt），故行扫描时暂存最近一次出现的 标题/严重级别，遇到「关联场景」行
 * 就把暂存值归到该场景 id 名下并清空暂存。AI 输出格式漂移（缺字段/换顺序/表格化）时
 * 最多丢初判、回退默认值，绝不抛错。
 */
export function parseMdBugInfo(md: string): Record<string, MdBugInfo> {
  const out: Record<string, MdBugInfo> = {};
  if (!md) return out;
  let pendingTitle: string | undefined;
  let pendingSeverity: string | undefined;
  // 「三、Bug 清单」章节之外的「严重级别」字样（如规则复述）会污染暂存 —— 只扫该章节。
  // 找不到章节标题（AI 改了标题写法）时退回全篇扫描（宁可多解析，别漏）。
  const secStart = md.search(/Bug\s*清单/i);
  const scanBody = secStart >= 0 ? md.slice(secStart) : md;
  // 下一个「### 」/「## 」章节标题处截断（章节内扫描）；找不到就扫到底。
  const secEnd = secStart >= 0 ? scanBody.slice(10).search(/\n#{2,3}\s/) : -1;
  const text = secEnd >= 0 ? scanBody.slice(0, secEnd + 10) : scanBody;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    // **标题**：xxx / 标题：xxx （容忍加粗与全半角冒号）
    const mTitle = line.match(/^[-*\s]*(?:\*\*)?标题(?:\*\*)?\s*[:：]\s*(.+)$/);
    if (mTitle) { pendingTitle = mTitle[1].trim().slice(0, 200) || undefined; continue; }
    const mSev = line.match(/^[-*\s]*(?:\*\*)?严重级别(?:\*\*)?\s*[:：]\s*(致命|严重|一般|建议)/);
    if (mSev) { pendingSeverity = mSev[1]; continue; }
    const mScene = line.match(/^[-*\s]*(?:\*\*)?关联场景(?:\*\*)?\s*[:：]\s*`?([A-Za-z]+-[\w-]+)`?/);
    if (mScene) {
      const sceneId = mScene[1];
      // 同一场景出现多次（AI 把一个场景拆成多条 Bug）→ 先到先得，后到的丢弃：
      // Bug↔场景 1:1 是复核复用 report_reviewed 的前提（见执行计划风险条目）。
      if (!out[sceneId]) out[sceneId] = { title: pendingTitle, severity: pendingSeverity };
      pendingTitle = undefined;
      pendingSeverity = undefined;
    }
  }
  return out;
}

/**
 * Bug 派生只读取的最小场景形状（结构宽于 reduce 的 ReducedTest —— 字段全可选，
 * run.json 来自磁盘、可能被手工编辑过，防御式读取不预设字段齐全）。
 */
export interface BugSourceTest {
  id: string;
  status: string;
  actual?: string;
  error?: string;
  api?: SmokeBug['api'];
  evidence?: string[];
}

/**
 * 从 run.json 派生 Bug 清单（fail 场景 1:1），叠加报告 md 的 AI 初判。
 *
 * `goalOf`：sceneId → 验证目标（cases.json 的 purpose），标题兜底用；缺失不影响派生。
 */
export function deriveBugs(
  run: { tests?: BugSourceTest[] | null },
  mdInfo: Record<string, MdBugInfo>,
  goalOf: Record<string, string> = {},
): SmokeBug[] {
  const fails = (run.tests ?? []).filter((t) => t.status === 'fail');
  return fails.map((t, i) => {
    const info = mdInfo[t.id] ?? {};
    const goal = goalOf[t.id];
    // 标题优先级：报告 md 的 AI 标题 > 「验证目标｜现象截断」> 现象截断。
    const phenomenon = (t.error || t.actual || '').trim().slice(0, 120);
    const title = info.title || (goal ? (phenomenon ? `${goal}｜${phenomenon}` : goal) : phenomenon || t.id);
    return {
      id: `BUG-${String(i + 1).padStart(2, '0')}`,
      sceneId: t.id,
      title,
      severity: info.severity && (SMOKE_SEVERITIES as readonly string[]).includes(info.severity) ? info.severity : SMOKE_SEVERITY_DEFAULT,
      ...(t.actual ? { actual: t.actual } : {}),
      ...(goal ? { expected: goal } : {}),
      ...(t.api ? { api: t.api } : {}),
      ...(t.evidence?.length ? { evidence: t.evidence } : {}),
    };
  });
}

/**
 * 把 bugs.json 里的人工覆盖层（severity 覆盖 / 备注）叠到派生清单上。
 *
 * - `stored.runHash !== runHash` → 整个覆盖层失效（上一轮的复核不能错挂到新一轮）；
 * - 按 sceneId 对齐；stored 里对不上派生清单的条目丢弃（场景改名/删除后遗留）。
 */
export function mergeBugOverrides(derived: SmokeBug[], stored: SmokeBugsFile | null, runHash: string): SmokeBug[] {
  if (!stored || stored.runHash !== runHash || !Array.isArray(stored.bugs)) return derived;
  const byScene = new Map(stored.bugs.map((b) => [b.sceneId, b]));
  return derived.map((b) => {
    const o = byScene.get(b.sceneId);
    if (!o) return b;
    return {
      ...b,
      ...(o.severity && (SMOKE_SEVERITIES as readonly string[]).includes(o.severity) && o.severity !== b.severity
        ? { severity: o.severity, severityOverriddenFrom: o.severityOverriddenFrom ?? b.severity }
        : {}),
      ...(o.note?.trim() ? { note: o.note.trim().slice(0, 2000) } : {}),
    };
  });
}

/**
 * PUT 覆盖层的 upsert（纯函数部分）：在现有文件基础上按 sceneId 更新一条。
 * runHash 变化 → 丢弃旧文件从零开始（同 mergeBugOverrides 的失效口径）。
 */
export function upsertBugOverride(
  stored: SmokeBugsFile | null,
  runHash: string,
  patch: { sceneId: string; severity?: string; note?: string; severityOverriddenFrom?: string },
): SmokeBugsFile {
  const base: SmokeBugsFile =
    stored && stored.runHash === runHash && Array.isArray(stored.bugs)
      ? stored
      : { version: SMOKE_BUGS_VERSION, runHash, bugs: [] };
  const idx = base.bugs.findIndex((b) => b.sceneId === patch.sceneId);
  const prev = idx >= 0 ? base.bugs[idx] : null;
  const next: SmokeBug = {
    // 覆盖层文件只承载人工字段；事实字段留空由 GET 侧派生合并（id/title 仅作可读性快照）。
    id: prev?.id ?? patch.sceneId,
    sceneId: patch.sceneId,
    title: prev?.title ?? '',
    severity:
      patch.severity && (SMOKE_SEVERITIES as readonly string[]).includes(patch.severity)
        ? patch.severity
        : prev?.severity ?? '',
    ...(patch.severityOverriddenFrom ? { severityOverriddenFrom: patch.severityOverriddenFrom.slice(0, 16) } : prev?.severityOverriddenFrom ? { severityOverriddenFrom: prev.severityOverriddenFrom } : {}),
    ...((patch.note !== undefined ? patch.note.trim() : prev?.note)
      ? { note: (patch.note !== undefined ? patch.note.trim() : prev!.note!).slice(0, 2000) }
      : {}),
  };
  const bugs = idx >= 0 ? base.bugs.map((b, i) => (i === idx ? next : b)) : [...base.bugs, next];
  return { version: SMOKE_BUGS_VERSION, runHash, bugs };
}

/**
 * 冒烟结论口径（结论横幅用；双记录——AI 原判保留，复核态是叠加层）：
 * - fail>0 且全部 fail 已被复核为「误报」(false_fail) → `passed-after-review`
 *   （通过·经人工复核，横幅注明 N 项误报已排除；AI 原判仍可见）；
 * - fail>0 其余情形 → `failed`（未通过——主流程存在断点）；
 * - fail=0 且 blocked>0 → `incomplete`（未完成——存在阻塞，不得报「通过」）；
 * - 全 pass（total>0）→ `passed`；
 * - total=0 → `empty`（无场景/未执行，不出结论）。
 */
export type SmokeVerdict = 'passed' | 'passed-after-review' | 'failed' | 'incomplete' | 'empty';

export function smokeVerdict(
  counts: { total: number; pass: number; fail: number; blocked: number },
  failSceneIds: string[],
  reviews: Record<string, string>,
): { verdict: SmokeVerdict; clearedFails: number } {
  if (!counts.total) return { verdict: 'empty', clearedFails: 0 };
  const clearedFails = failSceneIds.filter((id) => reviews[id] === 'false_fail').length;
  if (counts.fail > 0) {
    return clearedFails >= failSceneIds.length && failSceneIds.length > 0
      ? { verdict: 'passed-after-review', clearedFails }
      : { verdict: 'failed', clearedFails };
  }
  if (counts.blocked > 0) return { verdict: 'incomplete', clearedFails: 0 };
  return { verdict: 'passed', clearedFails: 0 };
}
