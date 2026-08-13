#!/usr/bin/env node
/**
 * 上下文占用探针 · 对照转储工具（SDK 升级回归必跑）。
 *
 * 与 src/lib/context-usage-probe.ts 同构：临时 HOME + transcript 副本 +
 * 剥凭据 resume，取 getContextUsage() 的完整响应并打印。生产探针只保存
 * totalTokens，这个脚本把整份响应摊开，用于：
 *
 *   1. **SDK/CLI 升级回归** —— 确认 totalTokens 仍在、字段名未变、时延没
 *      退化（无凭据下应为百毫秒级；若突然变成几十秒，说明 CLI 又开始打
 *      count_tokens 了，那是网关请求风暴的信号，必须停下来查）；
 *   2. 复核「探针分类不可用」这条结论是否还成立（见下）。
 *
 * 用法（必须在项目根目录跑，脚本依赖工程内的 @anthropic-ai/claude-agent-sdk）：
 *
 *   node scripts/dev/context-usage-probe-dump.mjs <cwd> <sdkSessionId>
 *
 * 例：
 *   node scripts/dev/context-usage-probe-dump.mjs \
 *     /Users/me/project/demo 421b4527-5a48-4c2b-b70a-fa0784047d09
 *
 * transcript 位置：~/.claude/projects/<cwd 的 slug>/<sdkSessionId>.jsonl
 * （slug = 路径分隔符换成 '-'，前导 '-' 归一；仅 POSIX 实测过）。
 *
 * ⚠️ 2026-08-13 实测结论（n=2，改动请复核后再推翻）：
 * 探针环境的临时 HOME 里没有 ~/.claude.json 等配置，所以
 *   - categories 恒为 {Skills, Messages, Free space}，且 Free space 是
 *     补满 maxTokens 的余量项 —— 求和 ≠ 占用；
 *   - mcpTools / memoryFiles 恒 0，systemTools / systemPromptSections 字段缺席；
 *   - model / maxTokens / autoCompactThreshold 属于 **CLI 默认模型**，与会话
 *     模型无关（两次样本分别是 claude-fable-5 与 claude-opus-5）。
 * 因此只有 totalTokens 可用；分类明细不可当作会话真实构成展示。
 *
 * 只读：真实 ~/.claude 零写入，临时 HOME 结束即整目录删除。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { query } from '@anthropic-ai/claude-agent-sdk';

const [, , cwdArg, sdkSessionId] = process.argv;
if (!cwdArg || !sdkSessionId) {
  console.error('usage: node scripts/dev/context-usage-probe-dump.mjs <cwd> <sdkSessionId>');
  process.exit(2);
}

const slug = '-' + cwdArg.replace(/\//g, '-').replace(/^-+/, '');
const realTranscript = path.join(os.homedir(), '.claude', 'projects', slug, `${sdkSessionId}.jsonl`);
if (!fs.existsSync(realTranscript)) {
  console.error(`transcript not found: ${realTranscript}`);
  console.error('（办公沙箱会话的 transcript 在远程容器卷里，本机必然找不到 —— 那是已知盲区）');
  process.exit(1);
}

const probeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-probe-dump-'));
const env = {};
for (const [k, v] of Object.entries(process.env)) {
  if (v === undefined) continue;
  if (k.startsWith('ANTHROPIC_')) continue;
  if (['CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'AWS_BEARER_TOKEN_BEDROCK',
       'CLAUDE_CONFIG_DIR', 'NODE_ENV'].includes(k)) continue;
  env[k] = v;
}
env.HOME = probeHome;
env.USERPROFILE = probeHome;

const ac = new AbortController();
const timer = setTimeout(() => ac.abort(), 60_000);
try {
  const probeProjDir = path.join(probeHome, '.claude', 'projects', slug);
  fs.mkdirSync(probeProjDir, { recursive: true });
  fs.copyFileSync(realTranscript, path.join(probeProjDir, `${sdkSessionId}.jsonl`));

  // 挂起式输入：不发消息，保持 Query 存活到 abort。
  const input = (async function* () {
    await new Promise((res) => ac.signal.addEventListener('abort', () => res()));
  })();
  const q = query({
    prompt: input,
    options: { cwd: cwdArg, resume: sdkSessionId, abortController: ac, env },
  });
  const pump = (async () => {
    try { for await (const _m of q) { /* drain */ } } catch { /* abort 收尾 */ }
  })();

  const t0 = Date.now();
  const cu = await q.getContextUsage();
  const elapsedMs = Date.now() - t0;

  const sum = (arr) => (arr || []).reduce((a, x) => a + (x.tokens || 0), 0);
  console.log(JSON.stringify({
    elapsedMs,
    // ── 生产探针唯一采用的字段 ──
    totalTokens: cu.totalTokens,
    // ── 以下仅供对照，勿接入 UI（见文件头实测结论）──
    probeDefaultModel: cu.model,
    maxTokens: cu.maxTokens,
    rawMaxTokens: cu.rawMaxTokens,
    percentage: cu.percentage,
    isAutoCompactEnabled: cu.isAutoCompactEnabled,
    autoCompactThreshold: cu.autoCompactThreshold,
    categories: cu.categories,
    categoriesSum: sum(cu.categories),
    memoryFiles: { count: cu.memoryFiles?.length ?? 0, tokens: sum(cu.memoryFiles) },
    mcpTools: { count: cu.mcpTools?.length ?? 0, tokens: sum(cu.mcpTools) },
    systemTools: { count: cu.systemTools?.length ?? 0, tokens: sum(cu.systemTools) },
    skills: cu.skills,
    agents: cu.agents,
    topLevelKeys: Object.keys(cu),
  }, null, 2));

  ac.abort();
  await pump;
} finally {
  clearTimeout(timer);
  ac.abort();
  try { fs.rmSync(probeHome, { recursive: true, force: true }); } catch { /* 尽力而为 */ }
}
