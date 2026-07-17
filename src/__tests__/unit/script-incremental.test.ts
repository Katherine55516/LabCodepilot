/**
 * 逐条增量沉淀（执行流中 pass 即入队生成）+ 未执行守卫。
 *
 * 治的两个真机问题：
 *   ① 断流全丢：脚本生成原本由【报告成功】门控。执行被跨境链路掐断（真机两次断在 82/93、
 *      29/93）→ 报告不跑 → 已通过用例的脚本一条都不沉淀，整轮 token 白烧。
 *   ② 断流轮误伤存量：中断轮的 run.json 会把没跑到的用例按 cases 全集兜底补成
 *      blocked+notExecuted。收口对账若把它们一并标 stale，几十条 verified 脚本会掉出
 *      运行/修复/重放的全部通道（stale 不是 isRunnableStatus）—— 一次断流就废掉脚本库。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createIncrementalScriptFeeder, wrapExecutionStream } from '@/lib/test/exec-stream';
import { ScriptTraceCollector } from '@/lib/test/script-trace';
import { selectEligibleCases } from '@/lib/test/script-generator';
import { reduceResults } from '@/lib/test/reduce';
import { isRunnableStatus } from '@/lib/test/script-job-manager';
import type { IncrementalScriptCaseRequest } from '@/lib/test/script-job-manager';

const REGRESSION_CASE = { id: 'TC-001', purpose: '看列表', tags: ['回归测试'], steps: [{ content: '打开页面' }] };
const PLAIN_CASE = { id: 'TC-002', purpose: '不进回归', tags: ['冒烟'], steps: [{ content: '打开页面' }] };

/** feeder 需要 cases.json 落盘；用临时项目目录 + 真实文件（读文件是它的开跑动作）。 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const withProject = (cases: unknown, fn: (dir: string) => void) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'incr-script-'));
  try {
    fs.mkdirSync(path.join(dir, 'AI_LabTest', 'testCase', '.data'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'AI_LabTest', 'testCase', '.data', '任务.cases.json'), JSON.stringify(cases));
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

const withProjectAsync = async (cases: unknown, fn: (dir: string) => Promise<void>) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'incr-script-'));
  try {
    fs.mkdirSync(path.join(dir, 'AI_LabTest', 'testCase', '.data'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'AI_LabTest', 'testCase', '.data', '任务.cases.json'), JSON.stringify(cases));
    await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

const makeFeeder = (dir: string, sink: IncrementalScriptCaseRequest[], trace = new ScriptTraceCollector(0)) =>
  createIncrementalScriptFeeder({
    projectPath: dir,
    taskName: '任务',
    env: 'local',
    runStartMs: 1000,
    trace,
    enqueue: (r) => sink.push(r),
  });

describe('createIncrementalScriptFeeder · 入队闸门', () => {
  it('pass 的回归用例 → 入队', () => {
    withProject([REGRESSION_CASE], (dir) => {
      const sink: IncrementalScriptCaseRequest[] = [];
      const feeder = makeFeeder(dir, sink);
      feeder.feedText('@@RESULT {"id":"TC-001","status":"pass"}\n');
      assert.equal(sink.length, 1);
      assert.equal(sink[0].result.id, 'TC-001');
      assert.deepEqual(sink[0].caseBody, REGRESSION_CASE);
    });
  });

  it('非 pass 不入队（失败的用例不该沉淀成回归脚本）', () => {
    withProject([REGRESSION_CASE], (dir) => {
      const sink: IncrementalScriptCaseRequest[] = [];
      const feeder = makeFeeder(dir, sink);
      feeder.feedText('@@RESULT {"id":"TC-001","status":"fail"}\n');
      feeder.feedText('@@RESULT {"id":"TC-001","status":"blocked"}\n');
      assert.equal(sink.length, 0);
    });
  });

  it('没打「回归测试」标签的用例不入队', () => {
    withProject([PLAIN_CASE], (dir) => {
      const sink: IncrementalScriptCaseRequest[] = [];
      const feeder = makeFeeder(dir, sink);
      feeder.feedText('@@RESULT {"id":"TC-002","status":"pass"}\n');
      assert.equal(sink.length, 0);
    });
  });

  it('via=script 的判定不入队（脚本重放没有 MCP 轨迹，重生成 = 每轮 churn）', () => {
    withProject([REGRESSION_CASE], (dir) => {
      const sink: IncrementalScriptCaseRequest[] = [];
      const feeder = makeFeeder(dir, sink);
      feeder.feedText('@@RESULT {"id":"TC-001","status":"pass","via":"script"}\n');
      assert.equal(sink.length, 0);
    });
  });

  it('同 id 重复输出只入队一次', () => {
    withProject([REGRESSION_CASE], (dir) => {
      const sink: IncrementalScriptCaseRequest[] = [];
      const feeder = makeFeeder(dir, sink);
      feeder.feedText('@@RESULT {"id":"TC-001","status":"pass"}\n');
      feeder.feedText('@@RESULT {"id":"TC-001","status":"pass"}\n');
      assert.equal(sink.length, 1);
    });
  });

  it('cases.json 缺失 → 静默关闭，不抛错、不入队', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'incr-nocases-'));
    try {
      const sink: IncrementalScriptCaseRequest[] = [];
      const feeder = makeFeeder(dir, sink);
      feeder.feedText('@@RESULT {"id":"TC-001","status":"pass"}\n');
      assert.equal(sink.length, 0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('createIncrementalScriptFeeder · 流式健壮性', () => {
  it('@@RESULT 被 SSE 切成多帧也能采到', () => {
    withProject([REGRESSION_CASE], (dir) => {
      const sink: IncrementalScriptCaseRequest[] = [];
      const feeder = makeFeeder(dir, sink);
      feeder.feedText('@@RESULT {"id":"TC-0');
      feeder.feedText('01","status":"pass"}');
      assert.equal(sink.length, 0, '未见换行 → 尚未成行');
      feeder.feedText('\n');
      assert.equal(sink.length, 1);
    });
  });

  it('最后一条 @@RESULT 没有换行结尾时，finish() 冲刷出来', () => {
    withProject([REGRESSION_CASE], (dir) => {
      const sink: IncrementalScriptCaseRequest[] = [];
      const feeder = makeFeeder(dir, sink);
      feeder.feedText('@@RESULT {"id":"TC-001","status":"pass"}');
      assert.equal(sink.length, 0);
      feeder.finish();
      assert.equal(sink.length, 1, '不冲刷就会永远漏掉最后一条用例');
    });
  });

  it('带 markdown 装饰的标记行照采（与 reduce/计时共用同一解析器）', () => {
    withProject([REGRESSION_CASE], (dir) => {
      const sink: IncrementalScriptCaseRequest[] = [];
      const feeder = makeFeeder(dir, sink);
      feeder.feedText('**@@RESULT {"id":"TC-001","status":"pass"}** ✅ 完成\n');
      assert.equal(sink.length, 1, '解析口径必须与 reduce 一致，否则一边采到一边漏掉');
    });
  });

  it('携带该用例的轨迹与元素清单', () => {
    withProject([REGRESSION_CASE], (dir) => {
      const trace = new ScriptTraceCollector(0);
      const sink: IncrementalScriptCaseRequest[] = [];
      const feeder = makeFeeder(dir, sink, trace);

      trace.feedText('@@CASE_START {"id":"TC-001","index":1}\n');
      trace.feedToolUse({ id: 't1', name: 'mcp__playwright__browser_click', input: {} });
      trace.feedToolResult({
        tool_use_id: 't1',
        content: [
          '### Ran Playwright code',
          '```js',
          "await page.getByRole('button', { name: '打开' }).click();",
          '```',
          '### Snapshot',
          '```yaml',
          '- button "上传头像" [ref=e14]',
          '```',
        ].join('\n'),
      });
      feeder.feedText('@@RESULT {"id":"TC-001","status":"pass"}\n');

      assert.equal(sink.length, 1);
      assert.equal(sink[0].traceActions.length, 1);
      assert.equal(sink[0].traceActions[0].caseId, 'TC-001');
      assert.deepEqual(sink[0].observedElements, [{ role: 'button', name: '上传头像' }]);
    });
  });
});

describe('wrapExecutionStream · depositScripts 开关', () => {
  it('depositScripts:false 时不入队任何生成任务（守住单测不打网络这条线）', async () => {
    // 回归:此前执行流一律沉淀,带「回归测试」标签的 pass 用例会在单测里发真实模型调用,
    // 失败后 4s/10s 退避重试把全局单并发队列堵十几秒,别的用例的任务卡在 queued。
    await withProjectAsync([REGRESSION_CASE], async (dir) => {
      const src = new ReadableStream<string>({
        start(c) {
          c.enqueue(`data: ${JSON.stringify({ type: 'text', data: '@@RESULT {"id":"TC-001","status":"pass"}\n' })}\n\n`);
          c.close();
        },
      });
      const out = wrapExecutionStream(src, {
        projectPath: dir, taskName: '任务', env: 'local', runStartMs: Date.now(), depositScripts: false,
      });
      const reader = out.getReader();
      for (;;) { const { done } = await reader.read(); if (done) break; }
      // 沉淀关闭 → 不该产生 manifest（生成任务从未入队）。
      assert.equal(fs.existsSync(path.join(dir, 'AI_LabTest', 'scripts', '任务', 'local', 'manifest.json')), false);
    });
  });
});

describe('增量候选与整轮任务的指纹一致性', () => {
  it('同一用例：增量的合成输入与整轮 run.json 输入产出【相同】语义指纹', () => {
    // 这是最要命的契约：指纹不一致 → 收口 job 判定漂移 → 把刚生成好的脚本重烧一遍模型。
    const actions = [{
      caseId: 'TC-001', sequence: 1, toolName: 'mcp__playwright__browser_click',
      playwrightCode: "await page.getByRole('button').click();",
      success: true, usesMock: false, timestampOffsetMs: 5,
    }];
    const run = {
      tests: [
        { id: 'TC-001', status: 'pass' as const, actual: '真实执行通过', error: '', evidence: ['a.png'] },
        { id: 'TC-009', status: 'fail' as const, actual: '', error: 'x', evidence: [] },
      ],
    };

    // 整轮口径：完整 cases + 完整 run.json
    const full = selectEligibleCases([REGRESSION_CASE, PLAIN_CASE], run as never, actions, 'rt-1');
    // 增量口径：单条 caseBody + 合成的单条 run
    const incr = selectEligibleCases(
      [REGRESSION_CASE],
      { tests: [{ id: 'TC-001', status: 'pass', actual: '', error: '', evidence: [] }] } as never,
      actions,
      'rt-1',
    );

    assert.equal(full.eligible.length, 1);
    assert.equal(incr.eligible.length, 1);
    assert.equal(
      incr.eligible[0].fingerprint,
      full.eligible[0].fingerprint,
      '指纹只由 用例体 + 轨迹 + 版本 决定，result 内容不得参与',
    );
    assert.equal(incr.eligible[0].caseBodyHash, full.eligible[0].caseBodyHash);
  });
});

describe('未执行守卫 · reduce 侧标记', () => {
  it('兜底补全的未执行条目带 notExecuted，真跑出来的 blocked 不带', () => {
    const reduced = reduceResults(
      [
        { id: 'TC-001', status: 'pass', actual: '', error: '', evidence: [] },
        { id: 'TC-002', status: 'blocked', actual: '', error: '前置条件不满足', evidence: [] },
      ],
      { module: '任务', env: 'local', time: '2026-07-16T00:00:00.000Z', caseIds: ['TC-001', 'TC-002', 'TC-003'] },
    );
    const byId = new Map(reduced.tests.map((t) => [t.id, t]));
    assert.equal(byId.get('TC-001')?.notExecuted, undefined);
    assert.equal(
      byId.get('TC-002')?.notExecuted, undefined,
      '真跑了但被阻塞 ≠ 没跑到，不能混为一谈',
    );
    assert.equal(byId.get('TC-003')?.status, 'blocked');
    assert.equal(byId.get('TC-003')?.notExecuted, true, '执行没轮到 → 必须可机器识别');
  });
});

describe('未执行守卫 · 状态语义', () => {
  it('stale 不是可运行态 —— 这正是误标 stale 会废掉脚本库的原因', () => {
    assert.equal(isRunnableStatus('verified'), true);
    assert.equal(isRunnableStatus('needs_review'), true);
    assert.equal(isRunnableStatus('stale'), false);
  });
});
