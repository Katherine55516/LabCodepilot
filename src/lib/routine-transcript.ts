/**
 * routine-transcript.ts —— 把沙箱定时任务的 stream-json 原文重放成本地会话消息(P5)。
 *
 * 定时任务的 agent loop 跑在**服务端**(`claude -p --output-format stream-json`),客户端事后
 * 才把原文拉回来。本模块负责「原文 → 消息」这一步,**全是纯函数**,不碰 fs / 网络 / DB ——
 * I/O 与幂等在 `routine-sync.ts`。
 *
 * ## 与办公模式实时回合的关系
 * 产出的形状与实时回合**完全一致**(一条 user + 一条 assistant,assistant 的 content 是
 * `JSON.stringify(MessageContentBlock[])`),所以渲染 / 产物 / 下载整套零改动复用。
 * 块级归一化与 CLI 会话导入共用 `claude-content-blocks.ts`。
 *
 * ## 三个必须知道的形状事实(都是实读生产样本得来的,别照直觉改)
 *
 * 1. **原文里没有用户指令那一条**。首行是 `system/init`,`user` 类型的行**全是 tool_result**
 *    回喂。所以指令得由调用方从 routine 定义里补进来(`buildRoutineRunMessages` 的 `prompt`)。
 * 2. **一次运行 = 一条 assistant 消息**。流式下同一条 assistant 消息会拆成多行(`message.id`
 *    相同),中间夹着 tool_result 的 user 行 —— 全部合并进一个有序 `MessageContentBlock[]`,
 *    与 `app/api/chat/route.ts` 实时回合按回合累积再落一条的口径一致。
 * 3. **失败的运行不一定有原文**。`credential_error`(容器还没起就失败)和 `skipped` 根本不写
 *    transcript,拉取会 404;被 kill 的(超时 / 输出溢出 / 401 中止)则有**半截**原文。
 *    所以「没有原文」是正常输入,不是异常 —— 见 `buildRoutineRunMessages` 的兜底。
 *
 * ## 🔴 成败判定的红线(G1)
 * **绝不读 `result.subtype`**。生产实测:401 全程失败的回合,末行 subtype 仍是 `"success"`。
 * 真正的信号是 `is_error` / `api_error_status`,而**权威口径在服务端的 run 记录**
 * (`RoutineRun.status`,服务端已按 `exitCode===0 && !is_error && api_error_status==null` 判过)。
 * 客户端**以 run 记录为准**,原文里的 result 只作补充展示 —— 在客户端重算一遍判定
 * 等于给 G1 再开一次口子。
 */
import type { MessageContentBlock, RoutineRun, TokenUsage } from '@/types';
import { parseAssistantContent, analyzeUserContent, type ContentBlock } from './claude-content-blocks';

/** 一条可直接喂给 `addMessage()` 的消息。 */
export interface ReplayedMessage {
  role: 'user' | 'assistant';
  /** user 为纯文本;assistant 为 `JSON.stringify(MessageContentBlock[])` */
  content: string;
  /** assistant 的用量(`JSON.stringify(TokenUsage)`),取不到为 null */
  tokenUsage: string | null;
}

/** 从原文里读到的元信息(展示与诊断用,**不用于成败判定**)。 */
export interface TranscriptMeta {
  /** `system/init` 报的模型,可能是 CLI 别名(如 `qwen3.7-max[1m]`) */
  model: string;
  /** 容器内的工作目录,恒为 /workspace */
  cwd: string;
  /** 容器内 claude 的 session id(排障时对日志用) */
  sdkSessionId: string;
  /** 本次挂上的办公 skill(实测 5 个;缺了说明没走 shim,见 G4) */
  skills: string[];
  /** 上游重试。401 会被服务端立即中止(G2),这里留档是为了让失败原因可解释 */
  retries: Array<{ status: number | null; attempt: number | null }>;
  /** 是否读到末行 result。false = 原文被截断(被 kill)或压根没有 */
  hasResult: boolean;
  /** result.is_error —— 仅作补充展示,判定以 run 记录为准 */
  isError: boolean;
  apiErrorStatus: number | null;
  /** result.result:模型最后那段文字 */
  resultText: string;
  costUsd: number | null;
  numTurns: number | null;
  usage: Record<string, unknown> | null;
  /** 解析不了的行数。>0 说明原文有损,值得在排障时留意 */
  malformedLines: number;
}

/** stream-json 的一行(只声明本模块会读的字段)。 */
interface TranscriptLine {
  type?: string;
  subtype?: string;
  cwd?: string;
  model?: string;
  skills?: string[];
  session_id?: string;
  error_status?: number;
  attempt?: number;
  message?: { content?: string | ContentBlock[] };
  // —— result 行 ——
  is_error?: boolean;
  api_error_status?: number | null;
  result?: string;
  total_cost_usd?: number;
  num_turns?: number;
  usage?: Record<string, unknown>;
}

const EMPTY_META: TranscriptMeta = {
  model: '', cwd: '', sdkSessionId: '', skills: [], retries: [],
  hasResult: false, isError: false, apiErrorStatus: null, resultText: '',
  costUsd: null, numTurns: null, usage: null, malformedLines: 0,
};

/**
 * 解析 stream-json 原文 → 有序内容块 + 元信息。
 *
 * 坏行**跳过而不抛**:原文可能因超时/溢出被拦腰截断,最后一行往往是半截 JSON。
 * 为一行坏数据丢掉整次运行的记录,与「失败最需要被看见」正好相反。
 */
export function parseTranscript(text: string): { blocks: MessageContentBlock[]; meta: TranscriptMeta } {
  const meta: TranscriptMeta = { ...EMPTY_META, skills: [], retries: [] };
  const blocks: MessageContentBlock[] = [];
  if (!text) return { blocks, meta };

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;

    let entry: TranscriptLine;
    try {
      entry = JSON.parse(line) as TranscriptLine;
    } catch {
      meta.malformedLines++;
      continue;
    }

    switch (entry.type) {
      case 'system': {
        if (entry.subtype === 'init') {
          meta.model = entry.model || '';
          meta.cwd = entry.cwd || '';
          meta.sdkSessionId = entry.session_id || '';
          meta.skills = Array.isArray(entry.skills) ? entry.skills : [];
        } else if (entry.subtype === 'api_retry') {
          meta.retries.push({ status: entry.error_status ?? null, attempt: entry.attempt ?? null });
        }
        // 其余 system 子类型(thinking_tokens 等)是进度噪声,不渲染
        break;
      }
      case 'assistant': {
        blocks.push(...parseAssistantContent(entry.message?.content as ContentBlock[] | undefined));
        break;
      }
      case 'user': {
        // 这里的 user 行是 tool_result 回喂,归进同一条 assistant 消息(见文件头事实 2)。
        // prompt 字段理论上不会有值,但真出现就并进来,总比丢掉强。
        const { prompt, toolResults } = analyzeUserContent(entry.message?.content);
        blocks.push(...toolResults);
        if (prompt) blocks.push({ type: 'text', text: prompt });
        break;
      }
      case 'result': {
        meta.hasResult = true;
        meta.isError = entry.is_error === true;              // 🔴 绝不读 subtype(G1)
        meta.apiErrorStatus = entry.api_error_status ?? null;
        meta.resultText = typeof entry.result === 'string' ? entry.result : '';
        meta.costUsd = typeof entry.total_cost_usd === 'number' ? entry.total_cost_usd : null;
        meta.numTurns = typeof entry.num_turns === 'number' ? entry.num_turns : null;
        meta.usage = entry.usage || null;
        break;
      }
    }
  }

  return { blocks, meta };
}

// ── 失败呈现 ──────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  success: '成功',
  error: '执行失败',
  credential_error: '模型凭证错误',
  timeout: '执行超时',
  output_overflow: '输出超限',
  skipped: '已跳过',
};

const SKIP_REASON_LABEL: Record<string, string> = {
  concurrency_limit: '同时运行的任务已达上限',
  daily_quota_exceeded: '已用完当日运行配额',
  previous_run_in_progress: '上一次运行还没结束',
  missed_too_long: '错过太久,不再补跑',
};

/** 运行状态的中文说法。未知状态原样回显,不吞掉。 */
export function runStatusLabel(run: Pick<RoutineRun, 'status' | 'skipReason'>): string {
  const base = STATUS_LABEL[run.status] || run.status || '未知状态';
  if (run.status === 'skipped' && run.skipReason) {
    return `${base}(${SKIP_REASON_LABEL[run.skipReason] || run.skipReason})`;
  }
  return base;
}

/**
 * 失败横幅。用引用块 + 粗体,在 markdown 渲染下一眼能看见 ——
 * 定时任务是「你不在的时候跑的」,失败要是不显眼,等于没记录。
 *
 * 文案**直接用服务端的 `run.error`**:那句话是服务端按终态写死的(如「模型凭证被上游拒绝
 * (401),已立即中止而不等它退避重试」),比客户端自己编一句「运行失败」有用得多。
 */
export function buildFailureBlock(run: RoutineRun, meta?: TranscriptMeta): MessageContentBlock {
  const lines = [`> ⚠️ **本次定时运行${runStatusLabel(run)}**`];

  const detail = (run.error || '').trim();
  if (detail) lines.push('>', `> ${detail.replace(/\n/g, '\n> ')}`);

  const facts: string[] = [];
  if (run.apiErrorStatus) facts.push(`上游状态码 ${run.apiErrorStatus}`);
  if (typeof run.exitCode === 'number' && run.exitCode !== 0) facts.push(`退出码 ${run.exitCode}`);
  if (meta?.retries.length) {
    const codes = [...new Set(meta.retries.map(r => r.status).filter(Boolean))].join('/');
    facts.push(`上游重试 ${meta.retries.length} 次${codes ? `(${codes})` : ''}`);
  }
  if (meta && !meta.hasResult && run.status !== 'credential_error' && run.status !== 'skipped') {
    facts.push('输出被中断,下面是中断前的部分记录');
  }
  if (facts.length) lines.push('>', `> ${facts.join(' · ')}`);

  return { type: 'text', text: lines.join('\n') };
}

// ── 组装 ──────────────────────────────────────────────────────

/** `buildRoutineRunMessages` 的输入。 */
export interface BuildRunMessagesArgs {
  /** routine 定义里的指令 —— 原文里没有它,必须从这里补(见文件头事实 1) */
  prompt: string;
  /** 服务端的运行记录:**成败以它为准**(G1) */
  run: RoutineRun;
  /** stream-json 原文。拉不到(404)传 null —— 这是正常输入,不是异常 */
  transcript: string | null;
}

/**
 * 一次运行 → 可直接落库的消息数组(一条 user + 一条 assistant)。
 *
 * 失败也照样产出消息:失败的定时任务恰恰是最需要被看见的那一类。哪怕原文完全拿不到,
 * 也会用 run 记录里的错误文本建出一条 assistant 消息 —— **绝不返回空 assistant**,
 * 那会在界面上留下一条空白气泡,比没有还糟。
 */
export function buildRoutineRunMessages(args: BuildRunMessagesArgs): ReplayedMessage[] {
  const { prompt, run, transcript } = args;
  const { blocks, meta } = parseTranscript(transcript || '');

  const failed = run.status !== 'success';
  const finalBlocks: MessageContentBlock[] = [];
  // 失败横幅放**最前面**:一次运行可能有几十个工具调用,失败信息垫在底下等于没有。
  if (failed) finalBlocks.push(buildFailureBlock(run, meta));
  finalBlocks.push(...blocks);

  if (finalBlocks.length === 0) {
    // 成功但原文为空 —— 理论上不该发生(成功必有 result 行)。留一句可辨认的话,
    // 而不是落一条空消息:界面上的空白气泡会让人以为是渲染坏了。
    finalBlocks.push({ type: 'text', text: '（本次运行没有留下输出记录）' });
  }

  return [
    { role: 'user', content: prompt, tokenUsage: null },
    {
      role: 'assistant',
      content: JSON.stringify(finalBlocks),
      tokenUsage: buildTokenUsage(run, meta),
    },
  ];
}

/**
 * 用量。优先用原文 result 行的聚合 usage(字段齐),缺失时退回 run 记录里的费用 ——
 * 后者在原文被截断时仍然有值。两个都没有就返回 null,不硬凑一个全 0 的假用量。
 */
function buildTokenUsage(run: RoutineRun, meta: TranscriptMeta): string | null {
  const u = meta.usage;
  const cost = meta.costUsd ?? run.costUsd ?? null;
  const model = meta.model || run.model || '';

  if (!u && cost == null && !model) return null;

  const usage: TokenUsage = {
    input_tokens: num(u?.input_tokens),
    output_tokens: num(u?.output_tokens),
  };
  if (u?.cache_read_input_tokens != null) usage.cache_read_input_tokens = num(u.cache_read_input_tokens);
  if (u?.cache_creation_input_tokens != null) usage.cache_creation_input_tokens = num(u.cache_creation_input_tokens);
  if (cost != null) usage.cost_usd = cost;
  if (model) usage.model = model;

  return JSON.stringify(usage);
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/**
 * 物化会话的标题:`<任务名> · MM-DD HH:mm`(**本地时间**)。
 *
 * 用本地时间而不是 UTC:用户看到的应该是「早上 9 点跑的那次」,而服务端记的是 UTC。
 * 时刻取 `startedAt`(开始时间)而不是结束时间 —— 用户设的是「几点跑」,对得上才不困惑。
 */
export function buildRunSessionTitle(routineName: string, startedAt: string): string {
  const name = (routineName || '定时任务').trim();
  const d = new Date(startedAt);
  if (Number.isNaN(d.getTime())) return name;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${name} · ${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
