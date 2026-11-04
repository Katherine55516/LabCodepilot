/**
 * 定时任务 transcript 重放(P5)。
 *
 * 输入用的是**生产上取回来的真实原文**(见 fixtures/routine-transcripts/README.md),
 * 因为这一层最容易错的不是逻辑而是**对输入形状的想象**:原文里没有用户指令那条、
 * 同一条 assistant 会拆成多行、中间混着 thinking_tokens 噪声 —— 三件事都只有实读才知道。
 *
 * 另一半重点是**失败必须被看见**。定时任务是"你不在的时候跑的",一次失败要是渲染得不
 * 显眼、或者干脆因为拿不到原文就不物化,这个功能就废了一半。
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import type { MessageContentBlock, RoutineRun } from '../../types';
import {
  parseTranscript,
  buildRoutineRunMessages,
  buildRunSessionTitle,
  runStatusLabel,
} from '../../lib/routine-transcript';

const FIXTURES = path.join(__dirname, '../fixtures/routine-transcripts');
const withTools = fs.readFileSync(path.join(FIXTURES, 'success-with-tools.jsonl'), 'utf-8');
const textOnly = fs.readFileSync(path.join(FIXTURES, 'success-text-only.jsonl'), 'utf-8');

const mkRun = (over: Partial<RoutineRun> = {}): RoutineRun => ({
  runId: 'run_0123456789abcdef01234567',
  startedAt: '2026-08-05T01:34:18.000Z',
  finishedAt: '2026-08-05T01:34:33.000Z',
  status: 'success',
  ok: true,
  ...over,
});

const blocksOf = (content: string) => JSON.parse(content) as MessageContentBlock[];

describe('parseTranscript —— 真实原文', () => {
  it('带工具的运行:块按时间序展开,且 tool_result 归进同一条', () => {
    const { blocks, meta } = parseTranscript(withTools);

    // 原文 8 行:init / thinking / Write / 结果 / Bash / 结果 / 收尾文字 / result。
    // 那条 thinking 的文本是**空的**(只有签名),按设计丢弃 —— 空块渲染出来是个空壳。
    assert.deepEqual(
      blocks.map((b) => b.type),
      ['tool_use', 'tool_result', 'tool_use', 'tool_result', 'text'],
      '块序列与真实原文对不上 —— 顺序错了渲染出来的工具调用会张冠李戴',
    );
    assert.equal(meta.malformedLines, 0);

    const firstTool = blocks[0] as Extract<MessageContentBlock, { type: 'tool_use' }>;
    assert.equal(firstTool.name, 'Write');
    const firstResult = blocks[1] as Extract<MessageContentBlock, { type: 'tool_result' }>;
    assert.equal(firstResult.tool_use_id, firstTool.id, 'tool_result 没配对上 tool_use');
    assert.match(firstResult.content, /e2e\.txt/);
  });

  it('带工具的运行:元信息取自 system/init 与 result', () => {
    const { meta } = parseTranscript(withTools);
    assert.equal(meta.model, 'claude-opus-4-8[1m]');
    assert.equal(meta.cwd, '/workspace');
    assert.equal(meta.sdkSessionId, 'd17e274c-99a9-481f-b237-6285b65b37b6');
    assert.ok(meta.skills.includes('office-cn'), '办公 skill 没挂上 —— 说明没走 shim(G4)');
    assert.equal(meta.hasResult, true);
    assert.equal(meta.isError, false);
    assert.equal(meta.apiErrorStatus, null);
    assert.equal(meta.numTurns, 3);
    assert.ok(meta.costUsd !== null && meta.costUsd > 0);
    assert.match(meta.resultText, /e2e\.txt/);
  });

  it('纯文字的运行:thinking_tokens 进度噪声被丢掉,不当成消息', () => {
    const { blocks, meta } = parseTranscript(textOnly);
    // 原文 13 行里有 9 行 system/thinking_tokens
    assert.deepEqual(blocks.map((b) => b.type), ['thinking', 'text']);
    assert.equal(meta.model, 'qwen3.7-max[1m]');
    assert.equal(meta.retries.length, 0);
  });

  it('空原文不炸,返回空块', () => {
    const { blocks, meta } = parseTranscript('');
    assert.deepEqual(blocks, []);
    assert.equal(meta.hasResult, false);
  });

  it('半截原文照样解析出前面的内容(超时/溢出被 kill 时就是这样)', () => {
    const truncated = withTools.split('\n').slice(0, 4).join('\n') + '\n{"type":"assis';
    const { blocks, meta } = parseTranscript(truncated);
    assert.ok(blocks.length >= 2, '为一行坏数据丢掉整次记录,与"失败最需要被看见"正好相反');
    assert.equal(meta.malformedLines, 1);
    assert.equal(meta.hasResult, false, '被截断就不该报告读到了 result');
  });

  it('🔴 G1:末行 subtype=success 但 is_error=true,必须判成错', () => {
    // 生产实测:401 全程失败的回合,末行 subtype 仍然是 "success"。
    const trap = JSON.stringify({
      type: 'result', subtype: 'success', is_error: true,
      api_error_status: 401, result: '', total_cost_usd: 0,
    });
    const { meta } = parseTranscript(trap);
    assert.equal(meta.isError, true, '读了 subtype —— G1 的口子又开了');
    assert.equal(meta.apiErrorStatus, 401);
  });

  it('api_retry 留档,用于解释失败原因', () => {
    const lines = [
      JSON.stringify({ type: 'system', subtype: 'api_retry', error_status: 429, attempt: 1 }),
      JSON.stringify({ type: 'system', subtype: 'api_retry', error_status: 429, attempt: 2 }),
    ].join('\n');
    const { meta } = parseTranscript(lines);
    assert.equal(meta.retries.length, 2);
    assert.equal(meta.retries[0].status, 429);
  });
});

describe('buildRoutineRunMessages —— 组装成会话消息', () => {
  it('成功的运行:一条 user(指令)+ 一条 assistant(全部块)', () => {
    const msgs = buildRoutineRunMessages({
      prompt: '在当前目录创建 e2e.txt,然后 ls',
      run: mkRun(),
      transcript: withTools,
    });

    assert.equal(msgs.length, 2);
    assert.equal(msgs[0].role, 'user');
    assert.equal(msgs[0].content, '在当前目录创建 e2e.txt,然后 ls',
      '指令必须由调用方补 —— 原文里根本没有这一条');
    assert.equal(msgs[1].role, 'assistant');

    const blocks = blocksOf(msgs[1].content);
    assert.equal(blocks.length, 5, '一次运行应合并成一条 assistant,与实时回合口径一致');
    assert.ok(!blocks.some((b) => b.type === 'text' && b.text.includes('⚠️')),
      '成功的运行不该出现失败横幅');
  });

  it('成功的运行:用量从 result 的聚合 usage 取', () => {
    const msgs = buildRoutineRunMessages({ prompt: 'p', run: mkRun(), transcript: withTools });
    const usage = JSON.parse(msgs[1].tokenUsage!);
    assert.equal(usage.input_tokens, 2913);
    assert.equal(usage.output_tokens, 258);
    assert.equal(usage.model, 'claude-opus-4-8[1m]');
    assert.ok(usage.cost_usd > 0);
  });

  it('🔴 拿不到原文的失败(credential_error)照样物化,错误文本要在', () => {
    // 容器还没起就失败了,服务端压根没写 transcript —— 拉取必然 404。
    const msgs = buildRoutineRunMessages({
      prompt: '每天九点生成日报',
      run: mkRun({
        status: 'credential_error',
        ok: false,
        error: '模型凭证被上游拒绝(401),已立即中止而不等它退避重试',
      }),
      transcript: null,
    });

    assert.equal(msgs.length, 2, '没有原文就不物化的话,用户永远不知道任务失败了');
    const blocks = blocksOf(msgs[1].content);
    assert.equal(blocks.length, 1);
    const text = (blocks[0] as { type: 'text'; text: string }).text;
    assert.match(text, /模型凭证错误/);
    assert.match(text, /401/);
    assert.ok(text.startsWith('>'), '失败横幅要用引用块渲染,一眼能看见');
  });

  it('🔴 失败横幅在最前面,不能垫在几十个工具调用底下', () => {
    const msgs = buildRoutineRunMessages({
      prompt: 'p',
      run: mkRun({ status: 'timeout', ok: false, error: '超过 900 秒未结束,已中止' }),
      transcript: withTools,
    });
    const blocks = blocksOf(msgs[1].content);
    assert.equal(blocks[0].type, 'text');
    assert.match((blocks[0] as { type: 'text'; text: string }).text, /执行超时/);
    assert.equal(blocks.length, 6, '横幅之外的原文内容不能丢');
  });

  it('🔴 run 记录说失败就是失败 —— 不拿原文里的 result 反推', () => {
    // 原文是一次干净的成功,但服务端判定为 error(比如 exit code 非 0)。
    // 客户端在这里重算一遍判定,等于给 G1 再开一次口子。
    const msgs = buildRoutineRunMessages({
      prompt: 'p',
      run: mkRun({ status: 'error', ok: false, exitCode: 1, error: 'exit 1' }),
      transcript: withTools,
    });
    const blocks = blocksOf(msgs[1].content);
    assert.match((blocks[0] as { type: 'text'; text: string }).text, /执行失败/);
    assert.match((blocks[0] as { type: 'text'; text: string }).text, /退出码 1/);
  });

  it('绝不产出空 assistant(空白气泡比没有还糟)', () => {
    const msgs = buildRoutineRunMessages({ prompt: 'p', run: mkRun(), transcript: '' });
    const blocks = blocksOf(msgs[1].content);
    assert.equal(blocks.length, 1);
    assert.ok((blocks[0] as { type: 'text'; text: string }).text.length > 0);
  });
});

describe('文案', () => {
  it('状态说法是中文,未知状态原样回显不吞掉', () => {
    assert.equal(runStatusLabel({ status: 'credential_error' } as RoutineRun), '模型凭证错误');
    assert.equal(runStatusLabel({ status: 'timeout' } as RoutineRun), '执行超时');
    assert.equal(
      runStatusLabel({ status: 'skipped', skipReason: 'daily_quota_exceeded' } as RoutineRun),
      '已跳过(已用完当日运行配额)',
    );
    assert.equal(runStatusLabel({ status: 'brand_new_status' } as RoutineRun), 'brand_new_status');
  });

  it('会话标题带本地时刻,取开始时间', () => {
    const startedAt = '2026-08-05T01:34:18.000Z';
    const d = new Date(startedAt);
    const p = (n: number) => String(n).padStart(2, '0');
    const expected = `每日销售日报 · ${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    assert.equal(buildRunSessionTitle('每日销售日报', startedAt), expected);
  });

  it('时间坏了也要有个能用的标题', () => {
    assert.equal(buildRunSessionTitle('日报', 'not-a-date'), '日报');
    assert.equal(buildRunSessionTitle('', 'not-a-date'), '定时任务');
  });
});
