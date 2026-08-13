/**
 * 压缩权威二选一 + 预算边界单测（context-usage-accuracy-overhaul Phase 3）。
 *
 * 3A（源码扫描）：resume 路径必须跳过应用侧预压缩 —— resume 时真实上下文是
 * CLI transcript，而 needsCompression 估的是 DB 归一化历史，用一份内容不同的
 * 粗估去清 sdk_session_id、抛弃真实 transcript 是净损失。没有 route 级集成
 * 测试环境，用源码扫描锁住这个门（与本仓已有的 /compact 源码扫描测试同法）。
 *
 * 3B（行为）：预算耗尽时下限是 0 而非 10K —— 旧代码把任何预算强抬 10K，在
 * system+summary+prompt 已吃满窗口时硬塞 10K 历史，直接推向 prompt-too-long。
 * 关键陷阱：0 是合法预算，if (budget) 会让 0 落进"发送全部历史"分支。
 * buildFallbackContext 未导出，这里用同构实现锁住语义并扫描源码防回退。
 *
 * Run with: npx tsx --test src/__tests__/unit/context-budget-and-gating.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const CLIENT_SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'lib', 'claude-client.ts'),
  'utf-8',
);
const ROUTE_SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'app', 'api', 'chat', 'route.ts'),
  'utf-8',
);

// ── 3A: resume 路径的预压缩门 ────────────────────────────────────────

describe('Phase 3A · resume 路径跳过应用侧预压缩', () => {
  it('needsCompression 调用必须被 preCompressionApplies 守住', () => {
    const call = ROUTE_SRC.match(/if \([^)]*needsCompression\(/);
    assert.ok(call, '未找到 needsCompression 调用');
    assert.ok(
      /preCompressionApplies && needsCompression\(/.test(ROUTE_SRC),
      `needsCompression 必须与 preCompressionApplies 合取，实际: ${call[0]}`,
    );
  });

  it('preCompressionApplies 由 streamSdkSessionId 缺失定义（fresh/fallback 路径才成立）', () => {
    assert.ok(
      /const preCompressionApplies = !streamSdkSessionId;/.test(ROUTE_SRC),
      'preCompressionApplies 必须定义为 !streamSdkSessionId',
    );
  });

  it('fallbackTokenBudget 仍在门外计算（resume 失败会回落 buildFinalPrompt(true)）', () => {
    const budgetIdx = ROUTE_SRC.indexOf('fallbackTokenBudget = Math.floor(');
    const gateIdx = ROUTE_SRC.indexOf('const preCompressionApplies');
    assert.ok(budgetIdx > 0 && gateIdx > 0, '未找到预算计算或门定义');
    assert.ok(
      budgetIdx < gateIdx,
      'fallbackTokenBudget 必须在预压缩门之前无条件计算',
    );
  });
});

// ── 3B: 预算下限 0（同构实现锁语义 + 源码扫描防回退） ─────────────────

/** buildFallbackContext 的选择逻辑同构实现（该函数未导出）。 */
function selectWithinBudget(
  history: Array<{ content: string }>,
  tokenBudget: number | undefined,
  estimate: (s: string) => number,
): Array<{ content: string }> {
  const effectiveBudget = tokenBudget != null ? Math.max(tokenBudget, 0) : undefined;
  if (effectiveBudget === undefined) return history;
  const selected: Array<{ content: string }> = [];
  let accumulated = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const msgTokens = estimate(history[i].content) + 10;
    if (accumulated + msgTokens > effectiveBudget) break;
    selected.unshift(history[i]);
    accumulated += msgTokens;
  }
  return selected;
}

describe('Phase 3B · 历史预算下限 0', () => {
  const est = (s: string) => Math.ceil(s.length / 4);
  const history = [
    { content: 'a'.repeat(4000) }, // ~1000 tokens
    { content: 'b'.repeat(4000) },
    { content: 'c'.repeat(4000) },
  ];

  it('预算 0 → 一条都不带（不是"发送全部历史"）', () => {
    assert.deepEqual(selectWithinBudget(history, 0, est), []);
  });

  it('预算负数 → 同样归零，不再被抬到 10K', () => {
    assert.deepEqual(selectWithinBudget(history, -5000, est), []);
  });

  it('预算够放一条就放一条（从最新往回走）', () => {
    const picked = selectWithinBudget(history, 1100, est);
    assert.equal(picked.length, 1);
    assert.equal(picked[0], history[2]); // 最新那条
  });

  it('预算 undefined（未传）→ 全量历史，保持旧行为', () => {
    assert.equal(selectWithinBudget(history, undefined, est), history);
  });

  it('源码：buildFallbackContext 不得再出现 Math.max(tokenBudget, 10000)', () => {
    assert.ok(
      /Math\.max\(tokenBudget, 0\)/.test(CLIENT_SRC),
      'buildFallbackContext 的预算下限必须是 0',
    );
    assert.ok(
      !/Math\.max\(tokenBudget, 10000\)/.test(CLIENT_SRC),
      '10K floor 已回退到 buildFallbackContext',
    );
  });

  it('源码：预算判断用 !== undefined，0 不得落进 else 分支', () => {
    assert.ok(
      /if \(effectiveBudget !== undefined\) \{/.test(CLIENT_SRC),
      'effectiveBudget 必须用 !== undefined 判断（写成 if (effectiveBudget) 会让 0 发送全部历史）',
    );
  });

  it('源码：PTL 重试预算下限同样是 0（刚 prompt-too-long 失败，不能再塞 10K）', () => {
    assert.ok(
      /const retryBudget = Math\.max\(0, /.test(CLIENT_SRC),
      'PTL 重试预算下限必须是 0',
    );
    assert.ok(
      !/Math\.max\(10000, Math\.floor\(ctxWindow/.test(CLIENT_SRC),
      'PTL 重试的 10K floor 已回退',
    );
  });

  it('源码：PTL 重试窗口走统一 resolver，不再直接 getContextWindow', () => {
    const retryBlock = CLIENT_SRC.match(/const ctxWindow = [\s\S]{0,300}?\|\| 200000;/);
    assert.ok(retryBlock, '未找到 PTL 重试的窗口解析');
    assert.ok(
      /resolveContextWindow\(/.test(retryBlock[0]),
      `PTL 重试必须用 resolveContextWindow。实际: ${retryBlock[0]}`,
    );
  });
});
