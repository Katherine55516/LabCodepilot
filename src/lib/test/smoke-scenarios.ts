/**
 * 冒烟测试 · 场景解析与用例互转（纯函数，无 fs / 无 DOM）。
 *
 * 冒烟任务的"用例"是**轻场景**：只有「验证目标 + 预期结果」两栏，不含点击步骤
 * （执行时由 AI 自主探索完成，见 prompts.ts 的冒烟执行 prompt）。为了让冒烟**完全复用**
 * 既有执行/归约/报告机器（@@RESULT 四态、run.json、报告矩阵、历史对比），场景在磁盘上
 * 仍存成标准 cases.json 结构 —— 只是字段被裁到最小：
 *
 *   { id: "SM-001", caseType: "冒烟", purpose: <验证目标>,
 *     steps: [{ content: "场景：<验证目标>（自主探索完成）", expected: <预期结果> }],
 *     tags: [] }
 *
 * 两条口径铁律（改动前务必读）：
 * 1. **`tags` 恒为空数组**。回归用例库只收 `tags` 含「回归测试」的用例（library.ts
 *    depositTask），reduce 的回归集红线（suiteCounts）也认这个标签。冒烟场景是"主流程
 *    通不通"的一次性验证，不是发版必跑的回归集，绝不能污染回归库与红线口径。
 *    ⚠️ 注意 CASE_TAGS 里那个既有的「冒烟测试」标签是**功能用例上的人工标注**（无程序
 *    消费），与本模块的冒烟任务形态是两回事，这里同样不打。
 * 2. **`verification` 恒为「功能验证」**。场景的预期来自用户录入（等同产品确认），不是
 *    代码反推的现状锁定，故不属回归基线 —— 否则 funcCounts 会把冒烟场景排除出通过率，
 *    报告将出现 "N/A（仅锁现状）"，与"主流程通不通"的结论口径直接矛盾。
 *
 * 纯函数 + 无 Node 依赖是刻意的：本仓库单测在 node 下跑（better-sqlite3 ABI 绑定 Electron，
 * 见 docs 记录），把解析逻辑留在纯函数层才能被直接单测。
 */

/** 一条冒烟场景 = 验证目标 + 预期结果。 */
export interface SmokeScenario {
  /** 验证目标（做什么），落 cases.json 的 purpose。 */
  goal: string;
  /** 预期结果（应该看到什么），落 steps[0].expected。 */
  expected: string;
  /**
   * 该行未显式给出预期结果（用户只写了验证目标）。平台不臆造预期，原样保留并标记，
   * 供 UI 提示用户补全；执行时 AI 按"验证目标本身是否达成"判定。
   */
  missingExpected?: boolean;
}

/** 冒烟场景在 cases.json 里的最小用例形态（字段名与既有 GeneratedCase 对齐）。 */
export interface SmokeCase {
  id: string;
  caseType: string;
  priority: string;
  purpose: string;
  steps: { content: string; expected: string }[];
  assertion: string;
  oracle: string;
  verification: string;
  tags: string[];
}

/** 冒烟用例 id 前缀（与功能测试的 `TC-` 区分，报告/证据文件名沿用）。 */
export const SMOKE_CASE_PREFIX = "SM";
/** 冒烟用例的 caseType 取值（既有用例类型枚举之外的专用值，只读展示不参与八维矩阵）。 */
export const SMOKE_CASE_TYPE = "冒烟";

/**
 * 「验证目标 → 预期结果」的分隔符候选，按优先级排列。
 *
 * 用户从提示词习惯迁移过来，手写分隔符五花八门：全角箭头、ASCII 箭头、破折号、竖线、
 * 中英文冒号。全部接受 —— 录入门槛越低越好，解析失败让用户回来改格式是最差体验。
 * ⚠️ 顺序敏感：长串必须排在其子串之前（`->` 先于 `-`；`：` 先于 `:` 无所谓但保持一致），
 * 否则 `A -> B` 会被 `-` 先切成 `A ` / `> B`。
 */
const SEPARATORS = ["→", "=>", "->", "｜", "|", "：", ":", "—", "–", "-"];

/** 行首的列表符号 / 序号（`1.` `1、` `- ` `* ` `（1）` 等），录入时常见，一律剥掉。 */
const LEADING_MARKER = /^\s*(?:[-*•·]|\(?\d+[).、]|（\d+）|\d+\s*[.、])\s*/;

/** 归一空白：全角空格→半角，压缩连续空白，去首尾。 */
function normalizeSpace(s: string): string {
  return s.replace(/　/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * 把一行文本切成「验证目标 / 预期结果」。找不到分隔符 → 整行作验证目标、预期留空并标记。
 *
 * 只在**第一个**命中的分隔符处切一刀（indexOf 而非 split）：预期结果里完全可能再出现
 * 冒号或破折号（如「提示：保存成功」），多切会把预期截断。
 */
function splitScenarioLine(line: string): SmokeScenario | null {
  const text = normalizeSpace(line.replace(LEADING_MARKER, ""));
  if (!text) return null;
  for (const sep of SEPARATORS) {
    const at = text.indexOf(sep);
    // at > 0：分隔符不能在行首（行首命中说明这行只有预期没有目标，按整行作目标处理）。
    if (at > 0) {
      const goal = normalizeSpace(text.slice(0, at));
      const expected = normalizeSpace(text.slice(at + sep.length));
      if (goal && expected) return { goal, expected };
      // 一侧为空（如 "添加机构 →"）→ 落到整行兜底，不产出半截场景。
      break;
    }
  }
  return { goal: text, expected: "", missingExpected: true };
}

/**
 * 解析用户在「测试场景」输入框录入的多行文本 → 场景数组。
 *
 * 容错口径：空行/纯空白行跳过；行首列表符号与序号剥掉；无分隔符的行整行作验证目标并标
 * `missingExpected`（**不臆造预期** —— 平台替用户编预期结果，等于把"锁现状"伪装成"验对错"）。
 */
export function parseScenarioLines(text: string): SmokeScenario[] {
  if (!text) return [];
  const out: SmokeScenario[] = [];
  for (const line of text.split(/\r?\n/)) {
    const parsed = splitScenarioLine(line);
    if (parsed) out.push(parsed);
  }
  return out;
}

/** 场景序号 → 用例 id（`SM-001`，三位补零；超过 999 自然进位为 `SM-1000`）。 */
export function smokeCaseId(index: number): string {
  return `${SMOKE_CASE_PREFIX}-${String(index + 1).padStart(3, "0")}`;
}

/**
 * 场景数组 → cases.json 的 `cases[]`。
 *
 * `steps` 恒为**一条**：content 写"场景：X（自主探索完成）"而非具体点击步骤 —— 既满足
 * 既有结构对 steps 的期待（报告矩阵、用例表都读它），又如实告诉执行智能体"这里没有
 * 预设步骤，你自己探索"。expected 缺失时给出显式说明，不留空字符串让 AI 猜。
 */
export function scenariosToCases(scenarios: SmokeScenario[]): SmokeCase[] {
  return scenarios.map((s, i) => ({
    id: smokeCaseId(i),
    caseType: SMOKE_CASE_TYPE,
    priority: "P0", // 冒烟只测主流程，天然全 P0
    purpose: s.goal,
    steps: [
      {
        content: `场景：${s.goal}（无预设步骤，自主探索页面完成该验证目标）`,
        expected: s.expected || `${s.goal}——该操作可正常完成，无报错、无中断`,
      },
    ],
    assertion: "L2", // 内容级：冒烟看"页面上能不能观察到预期事实"
    oracle: "产品确认", // 预期由用户录入 = 权威来源，非代码反推
    verification: "功能验证", // 铁律 2：绝不可为回归基线
    tags: [], // 铁律 1：绝不打「回归测试」，不入回归库、不进红线
  }));
}

/** 用户录入文本 → cases.json 的 `cases[]`（parse + 转换一步到位）。 */
export function scenarioTextToCases(text: string): SmokeCase[] {
  return scenariosToCases(parseScenarioLines(text));
}

/**
 * cases.json 的 `cases[]` → 场景数组（供「测试场景」两列表回显与编辑）。
 *
 * 宽松读取：cases.json 可能被用户手工编辑过、或来自旧版本，任何字段缺失都不抛异常
 * （测试工作台的既有纪律：产物读取一律 best-effort，读坏不能让整个面板白屏）。
 */
export function casesToScenarios(cases: unknown): SmokeScenario[] {
  const list = Array.isArray(cases)
    ? cases
    : Array.isArray((cases as { cases?: unknown })?.cases)
      ? (cases as { cases: unknown[] }).cases
      : [];
  const out: SmokeScenario[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const c = raw as { purpose?: unknown; steps?: unknown };
    const goal = typeof c.purpose === "string" ? c.purpose.trim() : "";
    const step0 = Array.isArray(c.steps) ? c.steps[0] : undefined;
    const expected =
      step0 && typeof step0 === "object" && typeof (step0 as { expected?: unknown }).expected === "string"
        ? (step0 as { expected: string }).expected.trim()
        : "";
    if (!goal && !expected) continue;
    out.push({ goal, expected });
  }
  return out;
}

/** 场景数组 → 「测试场景」输入框文本（每行 `目标 → 预期`），供编辑态回填。 */
export function scenariosToText(scenarios: SmokeScenario[]): string {
  return scenarios.map((s) => (s.expected ? `${s.goal} → ${s.expected}` : s.goal)).join("\n");
}

/**
 * 冒烟测试数据前缀：`冒烟测试_{YYYYMMDD}_`。
 *
 * 承接原提示词的「测试数据可识别」全局规则 —— 执行时新建的数据一律带此前缀，便于回查与
 * 清理，也是"只操作本次自建数据"这条数据安全铁律的锚点。按**本地日期**生成（用户看到的
 * 日期与报告里的一致；跨时区团队不是本产品的场景）。
 */
export function smokeDataPrefix(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `冒烟测试_${y}${m}${d}_`;
}
