import { harvestMarkers, isProgressLine, stripLineDecoration, PROGRESS_PREFIX } from './markers';

/**
 * 测试工作台 · 执行步 SSE 文本流的**实时**逐行解析(客户端安全:纯字符串,无 Node 依赖)。
 *
 * 服务端在流末用 `reduce.ts` 做确定性归约;但前端要在执行过程中就画出进度、四态、用例分段,
 * 只能自己解析 `type:'text'` 帧里的三个信号:
 *
 *   `@@CASE_START {"id","index"}`   → 本条用例开始(用于把工具轨迹归属到用例)
 *   `▶ 用例 N/总数：标题`            → 可读进度行
 *   `@@RESULT {"id","status",…}`   → 本条判定
 *
 * ## 为什么要有这个模块
 *
 * 这三个信号原来在 `InlineTestingPanel` 里就地解析,`@@RESULT` 用的是
 * 「indexOf + slice 到行尾 + JSON.parse」——模型一旦把标记行包成 `**@@RESULT {…}**`,
 * 解析直接抛异常,实时四态与用例列表全空(与 2026-07-10 服务端那次事故同源,见 markers.ts)。
 * 现在统一走 `markers.ts` 的宽容解析,并把结果解析下沉到这里,**服务端与客户端同一口径**。
 *
 * SSE 会把一行文本任意切成多帧,所以调用方必须用 `createExecLineBuffer()` 做行缓冲,
 * 不能对单个 chunk 直接分类。
 */

export type LiveStatus = 'pass' | 'fail' | 'partial' | 'blocked';

const STATUS_ALIAS: Record<string, LiveStatus> = {
  pass: 'pass', passed: 'pass', ok: 'pass', success: 'pass',
  fail: 'fail', failed: 'fail',
  partial: 'partial',
  blocked: 'blocked', block: 'blocked', skipped: 'blocked',
};

/** 实时判定(字段是 `@@RESULT` 的子集;`api` 只在 fail/partial 出现,live 不需要)。 */
export interface LiveResult {
  id: string;
  status: LiveStatus;
  actual?: string;
  error?: string;
  evidence?: string[];
}

/** 一行被分类成什么。`text` 是可以直接进 AI 气泡的普通正文。 */
export type ExecLine =
  | { kind: 'result'; result: LiveResult }
  /** 含 `@@RESULT` 与 `{`,但 JSON 解不出 —— 模型输出严重跑偏,必须可观测,不能静默吞掉。 */
  | { kind: 'resultMalformed'; raw: string }
  | { kind: 'caseStart'; id: string; index?: number }
  /**
   * 进度行。`text` 已剥掉 `▶ ` 前缀与 markdown 装饰;`title` 进一步剥掉「用例 N/总数：」,
   * 只剩标题本身(与 exec-progress.parseExecProgress 同口径)。
   */
  | { kind: 'progress'; text: string; idx: number; total: number; title: string }
  | { kind: 'text'; text: string };

function toResult(o: Record<string, unknown>): LiveResult | null {
  if (typeof o.id !== 'string' || !o.id) return null;
  const status = STATUS_ALIAS[String(o.status ?? '').toLowerCase()];
  if (!status) return null;
  return {
    id: o.id,
    status,
    actual: typeof o.actual === 'string' ? o.actual : undefined,
    error: typeof o.error === 'string' ? o.error : undefined,
    evidence: Array.isArray(o.evidence) ? o.evidence.map(String) : undefined,
  };
}

/**
 * 单行分类。判定行优先于用例开始行(两者不会同时出现在一行);进度行不带 JSON。
 * 解析口径与服务端 `harvestResults` 完全一致(同一个 markers.ts)。
 */
export function classifyExecLine(line: string): ExecLine {
  if (line.includes('@@RESULT')) {
    const { items, malformed } = harvestMarkers<Record<string, unknown>>(line, 'RESULT');
    const r = items.length ? toResult(items[0]) : null;
    if (r) return { kind: 'result', result: r };
    // 含标记 + 含 `{` 却解不出 → 显式暴露;只是正文里提到标记名(无 `{`)则当普通文本。
    if (malformed > 0) return { kind: 'resultMalformed', raw: line };
  }
  if (line.includes('@@CASE_START')) {
    const [o] = harvestMarkers<{ id?: unknown; index?: unknown }>(line, 'CASE_START').items;
    if (o && typeof o.id === 'string' && o.id) {
      return { kind: 'caseStart', id: o.id, index: typeof o.index === 'number' ? o.index : undefined };
    }
  }
  if (isProgressLine(line)) {
    const text = stripLineDecoration(line).slice(PROGRESS_PREFIX.length).trim();
    const { idx, total } = progressCounts(text);
    const title = text.replace(/^用例\s*/, '').replace(/^\d+\s*\/\s*\d+\s*[:：]?\s*/, '').trim();
    return { kind: 'progress', text, idx, total, title };
  }
  // 模型爱在段落之间打分隔线(`---` / `***` / `___`),它不是内容,不该变成一条 AI 气泡。
  // 注意在【剥装饰之前】判断:stripLineDecoration 会把 `-` 当列表符剥掉,`---` 会变成空串。
  if (/^\s*([-*_])\1{2,}\s*$/.test(line)) return { kind: 'text', text: '' };
  return { kind: 'text', text: line };
}

export interface ExecLineBuffer {
  /** 喂一个 SSE text chunk,返回本次凑齐的完整行的分类结果(不完整的尾行留在缓冲)。 */
  feed(chunk: string): ExecLine[];
  /** 流结束时冲刷缓冲里的最后一行(若非空)。 */
  flush(): ExecLine[];
}

/** 行缓冲:SSE 会把一行切成多帧,必须先拼回整行再分类。 */
export function createExecLineBuffer(): ExecLineBuffer {
  let buf = '';
  const take = (raw: string[]): ExecLine[] => raw.map((l) => classifyExecLine(l.trimEnd())).filter((e) => e.kind !== 'text' || e.text.length > 0);
  return {
    feed(chunk) {
      buf += chunk;
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      return take(lines);
    },
    flush() {
      if (!buf.trim()) { buf = ''; return []; }
      const out = take([buf]);
      buf = '';
      return out;
    },
  };
}

/** 从进度行 `用例 2/3：标题` 里取出「第几条 / 共几条」。取不到 → 0。 */
export function progressCounts(progress: string): { idx: number; total: number } {
  const m = progress.match(/(\d+)\s*\/\s*(\d+)/);
  return m ? { idx: Number(m[1]), total: Number(m[2]) } : { idx: 0, total: 0 };
}

/**
 * `@@CASE_START` 是否应【认领】当前用例(进度行开的占位),而不是另开一条。
 *
 * 模型的输出顺序不保证:可能先发 `▶ 用例 N/总数：标题` 再发 `@@CASE_START`。进度行的
 * 兜底逻辑(为"模型漏发机器标记"设计)会先开一条 id 为 `#N` 的占位用例;若随后的
 * `@@CASE_START` 无条件另开新条,同一条用例就变成两行 —— 占位那行永远等不到判定,被标
 * 「无判定」,「已开始」计数虚高一倍,对账横幅(浏览器有活动却收不到判定)误响
 * (2026-07-13 真机截图:3 条真用例配了 3 条幻影,面板全红,实际 3/3 全有判定)。
 *
 * 认领条件:占位尚无判定、id 仍是 `#N` 形态(从未被真实 id 认领过),且序号不冲突
 * (@@CASE_START 未带 index、或占位未记 index、或两者相等)。认领 = 就地补上真实 id,
 * 保留占位已归属的标题与事件。序号冲突时不认领 —— 那是真的两条用例,按旧行为另开。
 */
export function shouldAdoptPlaceholder(
  cur: { id: string; index?: number; result?: unknown } | undefined,
  incomingIndex?: number,
): boolean {
  if (!cur || cur.result) return false;
  if (!/^#\d+$/.test(cur.id)) return false;
  return incomingIndex === undefined || cur.index === undefined || cur.index === incomingIndex;
}
