/**
 * 冒烟测试 · Bug 清单派生与人工复核覆盖层（纯函数，无 fs）。
 *
 * 口径（读代码前必知）：
 * - **Bug ↔ 失败场景 1:1**：run.json 里 `status==='fail'` 的场景各派生一条 Bug；
 *   blocked/partial 不是应用缺陷，不进清单（与冒烟报告 prompt 的口径一致）。
 * - **run.json 只读**：Bug 的事实字段（actual/error/api/evidence）全部从 run.json 派生，
 *   人工可写的只有 严重级别 与 备注，落在旁路文件 `{任务}-{env}.bugs.json` ——
 *   run.json 是确定性归约产物（四态由代码算、不由人改），不能被人工写入污染。
 * - **AI 初判严重级别来自报告 md**：新报告用固定 GFM 表格输出 Bug 清单，旧报告仍可能
 *   是逐字段列表。解析器先读表格、再兼容旧列表；报告缺失/格式漂移时回退默认「严重」
 *   （冒烟里 fail = 主流程断点，默认从重不从轻）。解析失败绝不抛错——md 是 AI 产物，
 *   防御性读取。
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

export type SmokeReportStatus = 'passed' | 'failed' | 'incomplete' | 'partial';

/** 冒烟报告状态的唯一归约口径，供流程页、报告列表和任务最新状态共同复用。 */
export function smokeReportStatus(counts: {
  total: number;
  fail: number;
  blocked: number;
  partial: number;
}): SmokeReportStatus {
  if (counts.fail > 0) return 'failed';
  if (counts.blocked > 0 || counts.total <= 0) return 'incomplete';
  if (counts.partial > 0) return 'partial';
  return 'passed';
}

/** 报告 md 里逐 Bug 捞出的 AI 初判（标题 + 严重级别），按关联场景 id 归位。 */
export interface MdBugInfo {
  title?: string;
  severity?: string;
}

const BUG_SECTION_HEADING = /Bug\s*(?:清单|清單|list)/i;
const CONCLUSION_SECTION_HEADING = /(?:整体结论|整體結論|overall\s+(?:conclusion|verdict))/i;
const BUG_TABLE_HEADERS = ['编号', '标题', '严重级别', '关联场景', '实际', '预期', '接口', '证据'] as const;

function sectionLines(md: string, heading: RegExp, fallbackToAll = true): string[] {
  const lines = md.split(/\r?\n/);
  const start = lines.findIndex((line) => /^#{1,6}\s+/.test(line.trim()) && heading.test(line));
  if (start < 0) return fallbackToAll ? lines : [];
  const endOffset = lines.slice(start + 1).findIndex((line) => /^#{1,6}\s+/.test(line.trim()));
  return lines.slice(start + 1, endOffset < 0 ? lines.length : start + 1 + endOffset);
}

/** GFM 表格拆格：只把未转义的 `|` 当分隔符，保留单元格中的 `\|`。 */
function splitGfmRow(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let escaped = false;
  for (const ch of line.trim().replace(/^\|/, '').replace(/\|$/, '')) {
    if (escaped) {
      cell += ch;
      escaped = false;
    } else if (ch === '\\') {
      escaped = true;
      cell += ch;
    } else if (ch === '|') {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += ch;
    }
  }
  cells.push(cell.trim());
  return cells.map((value) =>
    value
      .replace(/\\\|/g, '|')
      .replace(/<br\s*\/?>/gi, ' / ')
      .replace(/[`*_]/g, '')
      .trim(),
  );
}

function normalizedHeader(value: string): string {
  return value.replace(/[\s：:（）()]/g, '').toLowerCase();
}

/**
 * 从冒烟报告 md 里 best-effort 捞每条 Bug 的 AI 初判。
 *
 * 新模板固定使用 GFM 表格（编号 / 标题 / 严重级别 / 关联场景 / …）；历史报告仍是逐字段
 * 列表。这里先解析表格，再用旧列表补漏，确保改造后不丢 AI 标题/严重级别，也不破坏历史
 * 报告的复核数据。
 */
export function parseMdBugInfo(md: string): Record<string, MdBugInfo> {
  const out: Record<string, MdBugInfo> = {};
  if (!md) return out;
  const lines = sectionLines(md, BUG_SECTION_HEADING);

  // 新格式：定位含「标题 / 严重级别 / 关联场景」的表头，按列名解析，不依赖列顺序。
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line.includes('|')) continue;
    const headers = splitGfmRow(line).map(normalizedHeader);
    const titleIdx = headers.findIndex((h) => h === '标题');
    const severityIdx = headers.findIndex((h) => h === '严重级别');
    const sceneIdx = headers.findIndex((h) => h === '关联场景');
    if (titleIdx < 0 || severityIdx < 0 || sceneIdx < 0) continue;
    for (let j = i + 1; j < lines.length; j += 1) {
      const rowLine = lines[j].trim();
      if (!rowLine) continue;
      if (!rowLine.includes('|')) break;
      const cells = splitGfmRow(rowLine);
      if (cells.every((cell) => /^:?-{3,}:?$/.test(cell))) continue;
      const sceneMatch = (cells[sceneIdx] ?? '').match(/[A-Za-z]+-[\w-]+/);
      if (!sceneMatch) continue;
      const sceneId = sceneMatch[0];
      if (out[sceneId]) continue;
      const title = (cells[titleIdx] ?? '').slice(0, 200) || undefined;
      const severityCell = cells[severityIdx] ?? '';
      const severity = (SMOKE_SEVERITIES as readonly string[]).includes(severityCell)
        ? severityCell
        : undefined;
      out[sceneId] = { title, severity };
    }
    break;
  }

  // 旧格式：标题 → 严重级别 → 关联场景。只补表格没有解析到的场景。
  let pendingTitle: string | undefined;
  let pendingSeverity: string | undefined;
  for (const rawLine of lines) {
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
 * 从完整冒烟 Markdown 中提取「整体结论」章节，供报告总览显示一行摘要。
 * 找不到或章节为空时返回 null，由 UI 按权威四态给本地化兜底；绝不从其它章节猜结论。
 */
export function extractSmokeConclusion(md: string): string | null {
  if (!md) return null;
  const lines = sectionLines(md, CONCLUSION_SECTION_HEADING, false);
  const text = lines
    .map((line) =>
      line
        .trim()
        .replace(/^[-*+]\s+/, '')
        .replace(/^\d+[.)、]\s*/, '')
        .replace(/[`*_>#]/g, ''),
    )
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text ? text.slice(0, 360) : null;
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

function escapeTableCell(value: unknown): string {
  const text = String(value ?? '')
    .trim()
    .replace(/\r?\n+/g, '<br>')
    .replace(/\|/g, '\\|');
  return text || '—';
}

function formatApi(api: BugSourceTest['api']): string {
  if (!api) return '—';
  const methodAndUrl = [api.method, api.url].filter(Boolean).join(' ');
  const status = api.status === undefined || api.status === null || api.status === '' ? '' : ` (${api.status})`;
  return `${methodAndUrl}${status}`.trim() || '—';
}

function hasCompleteBugTable(section: string[], failSceneIds: string[]): boolean {
  const headerIndex = section.findIndex((line) => {
    if (!line.includes('|')) return false;
    const headers = splitGfmRow(line).map(normalizedHeader);
    return BUG_TABLE_HEADERS.every((header) => headers.includes(normalizedHeader(header)));
  });
  if (headerIndex < 0) return false;
  const parsed = parseMdBugInfo(`## Bug 清单\n${section.slice(headerIndex).join('\n')}`);
  const parsedSceneIds = Object.keys(parsed);
  return parsedSceneIds.length === failSceneIds.length
    && failSceneIds.every((sceneId) => !!parsed[sceneId]);
}

/**
 * 确保完整冒烟报告里的 Bug 清单是固定 8 列 GFM 表格。
 *
 * Prompt 是第一道约束，但模型仍可能沿用旧版逐字段列表。这里以 run.json 的 fail 场景为
 * 权威事实做确定性兜底：新报告在服务端落盘收口时执行，历史报告在 UI 打开/导出时再次
 * 执行。已经符合合同且包含全部 fail 场景的表格原样保留，避免重写 AI 提供的详细预期。
 */
export function ensureSmokeReportBugTable(md: string, tests: BugSourceTest[] | null | undefined): string {
  if (!md) return md;
  const lines = md.split(/\r?\n/);
  const trailingNewline = /\r?\n$/.test(md);
  const bugHeadingIndex = lines.findIndex(
    (line) => /^#{1,6}\s+/.test(line.trim()) && BUG_SECTION_HEADING.test(line),
  );
  const failTests = (tests ?? []).filter((test) => String(test.status).toLowerCase() === 'fail');

  if (bugHeadingIndex >= 0) {
    const nextHeadingOffset = lines
      .slice(bugHeadingIndex + 1)
      .findIndex((line) => /^#{1,6}\s+/.test(line.trim()));
    const sectionEnd =
      nextHeadingOffset < 0 ? lines.length : bugHeadingIndex + 1 + nextHeadingOffset;
    if (hasCompleteBugTable(lines.slice(bugHeadingIndex + 1, sectionEnd), failTests.map((test) => test.id))) {
      return md;
    }
  }

  const mdInfo = parseMdBugInfo(md);
  const tableLines = [
    `| ${BUG_TABLE_HEADERS.join(' | ')} |`,
    `| ${BUG_TABLE_HEADERS.map(() => '---').join(' | ')} |`,
    ...(failTests.length
      ? failTests.map((test, index) => {
          const info = mdInfo[test.id] ?? {};
          const actualParts = [test.actual, test.error]
            .map((value) => value?.trim())
            .filter((value, partIndex, values): value is string => !!value && values.indexOf(value) === partIndex);
          return `| ${[
            `BUG-${String(index + 1).padStart(2, '0')}`,
            info.title || test.error || test.actual || test.id,
            info.severity && (SMOKE_SEVERITIES as readonly string[]).includes(info.severity)
              ? info.severity
              : SMOKE_SEVERITY_DEFAULT,
            test.id,
            actualParts.join('<br>'),
            '—',
            formatApi(test.api),
            test.evidence?.join('<br>') || '—',
          ].map(escapeTableCell).join(' | ')} |`;
        })
      : ['| — | 本轮冒烟未发现缺陷 | — | — | — | — | — | — |']),
  ];

  let nextLines: string[];
  if (bugHeadingIndex >= 0) {
    const nextHeadingOffset = lines
      .slice(bugHeadingIndex + 1)
      .findIndex((line) => /^#{1,6}\s+/.test(line.trim()));
    const sectionEnd =
      nextHeadingOffset < 0 ? lines.length : bugHeadingIndex + 1 + nextHeadingOffset;
    nextLines = [
      ...lines.slice(0, bugHeadingIndex + 1),
      '',
      ...tableLines,
      '',
      ...lines.slice(sectionEnd),
    ];
  } else {
    const conclusionIndex = lines.findIndex(
      (line) => /^#{1,6}\s+/.test(line.trim()) && CONCLUSION_SECTION_HEADING.test(line),
    );
    const insertionIndex = conclusionIndex >= 0 ? conclusionIndex : lines.length;
    nextLines = [
      ...lines.slice(0, insertionIndex),
      ...(insertionIndex > 0 && lines[insertionIndex - 1]?.trim() ? [''] : []),
      '## 三、Bug 清单',
      '',
      ...tableLines,
      '',
      ...lines.slice(insertionIndex),
    ];
  }

  const normalized = nextLines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
  return trailingNewline ? `${normalized}\n` : normalized;
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
