/**
 * 测试工作台 · AI 输出的机器标记行解析(`@@RESULT` / `@@RECOMMEND` / `@@VERDICT` /
 * `@@CASE_START` / 进度行 `▶`)。
 *
 * ## 为什么需要这个模块
 *
 * 平台与模型之间的契约是「一行一个标记 + 单行严格 JSON」。但模型是**概率性输出**:
 * 它可能把标记行包成 markdown 强调、行内代码、代码块,或在 JSON 后面补一句话:
 *
 *   **@@RESULT {"id":"TC-001","status":"pass"}**        ← 加粗
 *   `@@RESULT {"id":"TC-001","status":"pass"}`          ← 行内代码
 *   @@RESULT {"id":"TC-001","status":"pass"}  ✅ 完成    ← 尾随文字
 *
 * 原实现是「找到标记 → 把它之后的整段 trim() → JSON.parse」,上面三种都会抛异常并被
 * catch 静默丢弃。2026-07-10 线上就因此出现:模型把 3 条 @@RESULT 全部加粗,平台一条都
 * 没收割到,`caseIds` 兜底把它们补成 blocked——**报告显示 0/3 全阻塞,而模型判的是
 * 2 通过 1 失败**。同一份文本里 script-trace 用的是宽容正则,所以 trace 里有 caseId,
 * 结果却是空的,极难排查。
 *
 * 教训:**同一份模型输出不能有两套宽严不一的解析器**。本模块是唯一实现。
 *
 * ## 解析口径:宁可多采,不可漏采
 *
 * 逐行扫描;行内出现标记就从标记之后的第一个 `{` 起做**大括号配对**(识别字符串字面量与
 * 转义,故 JSON 值里的 `{`/`}`/`"` 不会打乱配对),取出恰好一个 JSON 对象。标记前后的
 * 装饰与尾随文字一律忽略;行内没有 `{` 则跳过(「| 已输出 @@RESULT 行数 | 3 |」这类
 * 正文行不会被误采)。
 *
 * **为什么不要求标记必须在行首**:两类错误的代价完全不对称。
 *   - 漏采一行 = 该用例的真实判定丢失,被兜底改写成 blocked → **灾难性**(本次事故);
 *   - 多采一行 = 产出一个 id,但下游一律做**白名单过滤**——`reduce` 按 cases.json 的
 *     `caseIds` 对齐、归因路由按当轮快照 `idMap` 反解、`applyRecommend` 只改 cases.json
 *     里已存在的 id——编造的 id 到不了任何地方 → **无害**。
 * 故这里刻意保持位置宽容(既有契约,test-reduce「tolerates @@RESULT not at line start」)。
 *
 * 配对成功但 JSON 非法 → 计入 `malformed`,由调用方决定是否告警(不再静默吞掉)。
 */

/** 从 `line` 的 `from` 位置起，取出第一个大括号配对完整的 JSON 对象源码；找不到 → null。 */
function sliceBalancedObject(line: string, from: number): string | null {
  const start = line.indexOf('{', from);
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let escaped = false;
  for (let i = start; i < line.length; i++) {
    const ch = line[i];
    if (inStr) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return line.slice(start, i + 1);
    }
  }
  return null; // 该行括号未闭合(被截断/跨行) → 交给调用方按缺失处理
}

export interface MarkerHarvest<T> {
  /** 成功解析出的对象(按出现顺序)。 */
  items: T[];
  /** 含标记且含 `{`、但 JSON 非法或括号未闭合的行数——出现即说明模型输出跑偏，值得告警。 */
  malformed: number;
}

/**
 * 从整段模型文本里收割某个标记的 JSON 对象。
 * `marker` 传不含 `@@` 前缀的名字,如 `'RESULT'` / `'RECOMMEND'` / `'VERDICT'` / `'CASE_START'`。
 *
 * 一行最多取一个对象(契约就是一行一条);同一行出现多个标记时只认第一个。
 */
export function harvestMarkers<T = unknown>(text: string, marker: string): MarkerHarvest<T> {
  const tag = `@@${marker}`;
  const items: T[] = [];
  let malformed = 0;
  for (const line of text.split('\n')) {
    const at = line.indexOf(tag);
    if (at < 0) continue;
    // 大括号配对取出恰好一个对象;标记两侧的装饰(`**`/反引号/列表符)与尾随文字一律忽略。
    const src = sliceBalancedObject(line, at + tag.length);
    if (src === null) continue; // 行内没带 JSON(或括号被截断) → 不是判定行
    try {
      const obj = JSON.parse(src) as unknown;
      if (obj && typeof obj === 'object') items.push(obj as T);
      else malformed++;
    } catch {
      malformed++;
    }
  }
  return { items, malformed };
}

/** 便捷形式:只要结果、不关心 malformed。 */
export function harvestMarkerObjects<T = unknown>(text: string, marker: string): T[] {
  return harvestMarkers<T>(text, marker).items;
}

/**
 * 剥掉一行两侧的 markdown 装饰:引用符 / 列表符(有序无序) / 标题号 / 强调符 / 反引号 / 空白。
 * 标记行与进度行(`▶ 用例 N/总数：标题`)共用——模型可能写成 `**▶ 用例 1/3：…**`。
 *
 * 只用于**不带 JSON** 的标记行(进度行);带 JSON 的判定行由 harvestMarkers 的大括号配对
 * 处理,不需要剥装饰。
 */
export function stripLineDecoration(line: string): string {
  return line
    .trim()
    .replace(/^(?:>\s*|[-*+]\s+|\d+[.)]\s+|#{1,6}\s+)+/, '') // 引用 / 列表 / 有序列表 / 标题
    .replace(/^[`*_\s]+/, '')
    .replace(/[`*_\s]+$/, '')
    .trim();
}

/**
 * 冒烟执行的「登录态整体失效」硬停止信号。
 *
 * 这是控制信号，不沿用 @@RESULT 那种“行内任意位置都可采”的宽松口径：正文里讲解
 * `@@AUTH_INVALID` 不能误停一次真实执行。只接受标记位于剥除 markdown 装饰后的行首，
 * JSON 可容忍模型偶发的加粗/反引号包装；`reason` 仅作诊断，不参与 UI 文案。
 */
export interface AuthInvalidSignal {
  reason?: string;
}

export function parseAuthInvalidSignal(line: string): AuthInvalidSignal | null {
  const normalized = stripLineDecoration(line);
  if (!/^@@AUTH_INVALID(?:\s|\{)/.test(normalized)) return null;
  const [raw] = harvestMarkers<{ reason?: unknown }>(normalized, 'AUTH_INVALID').items;
  if (!raw) return null;
  const reason = typeof raw.reason === 'string' ? raw.reason.trim().slice(0, 200) : '';
  return reason ? { reason } : {};
}

/** 从一段可能跨 SSE 帧累计的 AI 文本里找第一条完整的登录失效硬停止信号。 */
export function findAuthInvalidSignal(text: string): AuthInvalidSignal | null {
  for (const line of text.split('\n')) {
    const signal = parseAuthInvalidSignal(line);
    if (signal) return signal;
  }
  return null;
}

/** 进度行前缀(执行步 prompt 约定)。 */
export const PROGRESS_PREFIX = '▶';

/** 该行是否为执行进度行(容忍 markdown 装饰)。 */
export function isProgressLine(line: string): boolean {
  return stripLineDecoration(line).startsWith(PROGRESS_PREFIX);
}
