/**
 * context-usage-probe.ts — 无凭据上下文占用探针（FIX(权威分子) 第三形态）。
 *
 * 回合结束后在"临时 HOME + transcript 副本"里 resume 会话,用 CLI 的本地
 * 估算模式取 totalTokens,后补进该回合 assistant 消息的 token_usage
 * (context_used_tokens)。
 *
 * 为什么是"无凭据":CLI 的 getContextUsage 在有凭据时会对上下文逐组件调
 * POST /v1/messages/count_tokens —— 实测 resume 一个 113K 会话一次快照打了
 * 82 个非流式请求,经公司网关串行 RTT 达几十秒(曾经"生成中卡几十秒"与
 * 网关请求风暴的共同根因)。无凭据时 CLI 回退纯本地估算:零 API 请求、
 * ~200ms。实测两种模式 totalTokens 逐位一致(n=2:116842/46342)——总量
 * 锚定 transcript 真实 usage,count_tokens 只影响卡片用不到的分类明细。
 * 验证记录:docs/research/context-usage-from-claude-code.md。
 *
 * 为什么是"临时 HOME 副本"而非直接 resume 真实 ~/.claude:
 * - 直连 resume 实测会向原会话文件追加内容(+266B);
 * - forkSession 会在真实 projects 目录留下副本,且挂起输入模式下 init
 *   消息不进 iterator,拿不到 forked id 无法精确清理;
 * - 把 transcript 拷进 mkdtemp 的假 HOME,CLI 想写什么都写在临时目录,
 *   探针结束整目录删除 —— 真实 ~/.claude 零写入,并发零风险。
 * - 临时 HOME 缺 skills/memory 不影响 totalTokens(实测不变,分类残差吸收)。
 *
 * 其他防御:
 * - env 剥离凭据(ANTHROPIC_ 前缀、Bedrock/Vertex 开关)+ NODE_ENV(泄漏
 *   纪律,见 sdk-subprocess-env.ts);
 * - per-session 互斥,上一发未结束跳过本轮(下回合自然再补,宁缺毋滥);
 * - 延迟 1.5s 启动,等聊天 CLI 完成 transcript 落盘;
 * - match(input/output)防串扰由 patchLatestAssistantTokenUsage 承担。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { patchLatestAssistantTokenUsage } from './db';

const inflight = new Set<string>();

const PROBE_START_DELAY_MS = 1500;
const PROBE_TIMEOUT_MS = 15_000;

/**
 * CLI 的 transcript 目录 slug:路径分隔符替换为 '-',前导 '-' 归一。
 * 从真实样本反推(/Users/yuanqi/project/demo → -Users-yuanqi-project-demo;
 * 深层含连字符路径同样吻合)。仅在 POSIX 上验证过 —— Windows 的盘符/反斜杠
 * 规则未实测,探针在 win32 直接跳过(卡片回退旧口径)。
 */
function transcriptSlug(cwd: string): string {
  return '-' + cwd.replace(/\//g, '-').replace(/^-+/, '');
}

/** 剥离凭据与 NODE_ENV;其余(PATH 等)原样继承。HOME 由调用方覆盖。 */
function buildProbeEnv(probeHome: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (k.startsWith('ANTHROPIC_')) continue;
    if (k === 'CLAUDE_CODE_USE_BEDROCK' || k === 'CLAUDE_CODE_USE_VERTEX') continue;
    if (k === 'AWS_BEARER_TOKEN_BEDROCK') continue;
    if (k === 'CLAUDE_CONFIG_DIR') continue;
    if (k === 'NODE_ENV') continue;
    env[k] = v;
  }
  env.HOME = probeHome;
  env.USERPROFILE = probeHome;
  return env;
}

export interface ContextUsageProbeArgs {
  /** 应用侧会话 id(messages.session_id)。 */
  appSessionId: string;
  /** CLI 会话 id(resume 目标),取 result 消息的 session_id 最新鲜。 */
  sdkSessionId: string;
  /** 会话工作目录 —— transcript 按 cwd slug 定位,必须与聊天回合一致。 */
  cwd: string;
  /** 防串扰匹配:本回合落库 usage 的 input/output。 */
  match: { input_tokens?: number; output_tokens?: number } | null;
}

/**
 * Fire-and-forget:任何失败都静默(卡片回退旧口径)。绝不 throw。
 */
export function fireContextUsageProbe(args: ContextUsageProbeArgs): void {
  const { appSessionId, sdkSessionId, cwd } = args;
  if (!appSessionId || !sdkSessionId || !cwd) return;
  if (process.platform === 'win32') return; // slug 规则未实测,暂不启用
  if (inflight.has(appSessionId)) return;
  inflight.add(appSessionId);

  setTimeout(() => {
    runProbe(args)
      .catch(() => { /* 静默 */ })
      .finally(() => inflight.delete(appSessionId));
  }, PROBE_START_DELAY_MS);
}

async function runProbe(args: ContextUsageProbeArgs): Promise<void> {
  const slug = transcriptSlug(args.cwd);
  const realTranscript = path.join(
    os.homedir(), '.claude', 'projects', slug, `${args.sdkSessionId}.jsonl`,
  );
  if (!fs.existsSync(realTranscript)) return; // slug 猜错/尚未落盘 → 放弃

  const probeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-probe-'));
  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), PROBE_TIMEOUT_MS);
  if (typeof timeout.unref === 'function') timeout.unref();

  try {
    const probeProjDir = path.join(probeHome, '.claude', 'projects', slug);
    fs.mkdirSync(probeProjDir, { recursive: true });
    fs.copyFileSync(realTranscript, path.join(probeProjDir, `${args.sdkSessionId}.jsonl`));

    // 挂起式输入:不发任何消息,保持 Query 存活到 abort。
    const input = (async function* () {
      await new Promise<void>((res) => ac.signal.addEventListener('abort', () => res()));
    })();

    const q = query({
      prompt: input as AsyncIterable<never>,
      options: {
        cwd: args.cwd,
        resume: args.sdkSessionId,
        abortController: ac,
        env: buildProbeEnv(probeHome),
      },
    });

    // 后台泵消息(控制响应依赖迭代推进)。
    const pump = (async () => {
      try {
        for await (const _m of q) { /* drain */ }
      } catch {
        // abort 收尾的正常路径
      }
    })();

    const cu = await q.getContextUsage();
    if (cu && typeof cu.totalTokens === 'number' && cu.totalTokens > 0) {
      // cli_context_window 刻意不写:探针跑在 CLI 默认模型下,其 maxTokens
      // 不代表会话真实模型的窗口。分母走应用侧解析(用户决策)。
      patchLatestAssistantTokenUsage(args.appSessionId, args.match, {
        context_used_tokens: cu.totalTokens,
      });
    }

    ac.abort();
    await pump; // 等子进程退出,再删临时 HOME
  } finally {
    clearTimeout(timeout);
    ac.abort();
    try {
      fs.rmSync(probeHome, { recursive: true, force: true });
    } catch { /* 尽力而为;残留在 os.tmpdir,系统会回收 */ }
  }
}
