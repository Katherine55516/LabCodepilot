/**
 * Tests for the pipeline "re-run resets downstream" rule (src/lib/test/step-status.ts).
 *
 * Steps run in order 需求分析 → 用例设计 → 测试执行 → 测试报告. Re-running a step
 * invalidates every DOWNSTREAM step's artifact, so they reset to 未开始 (idle) — this is
 * what stops a finished task from showing a stale 已完成 on, e.g., the 测试报告 node while
 * 测试执行 is being re-run. Upstream steps are left untouched.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { withDownstreamReset, runStartOptions } from '@/lib/test/step-status';
import type { TestStep } from '@/lib/test/prompts';

type Status = 'idle' | 'running' | 'review' | 'done' | 'error';
// Same order as the component's STEPS / backend TEST_STEPS, passed explicitly so the
// helper stays free of any server-only (fs) import.
const ORDER: TestStep[] = ['requirement', 'cases', 'execution', 'report'];
const allDone: Record<TestStep, Status> = {
  requirement: 'done',
  cases: 'done',
  execution: 'done',
  report: 'done',
};

describe('withDownstreamReset', () => {
  it('re-running 测试执行 on a finished task resets only 测试报告 (the screenshot bug)', () => {
    const next = withDownstreamReset(allDone, 'execution', ORDER, 'running', 'idle');
    assert.deepEqual(next, {
      requirement: 'done',
      cases: 'done',
      execution: 'running',
      report: 'idle',
    });
  });

  it('re-running 需求分析 resets all three downstream steps', () => {
    const next = withDownstreamReset(allDone, 'requirement', ORDER, 'running', 'idle');
    assert.deepEqual(next, {
      requirement: 'running',
      cases: 'idle',
      execution: 'idle',
      report: 'idle',
    });
  });

  it('re-running 用例设计 resets 测试执行 + 测试报告, leaves 需求分析 done', () => {
    const next = withDownstreamReset(allDone, 'cases', ORDER, 'running', 'idle');
    assert.deepEqual(next, {
      requirement: 'done',
      cases: 'running',
      execution: 'idle',
      report: 'idle',
    });
  });

  it('re-running 测试报告 (last step) resets nothing downstream', () => {
    const next = withDownstreamReset(allDone, 'report', ORDER, 'running', 'idle');
    assert.deepEqual(next, {
      requirement: 'done',
      cases: 'done',
      execution: 'done',
      report: 'running',
    });
  });

  it('leaves upstream non-done statuses untouched (review / error stay put)', () => {
    const mixed: Record<TestStep, Status> = {
      requirement: 'done',
      cases: 'review',
      execution: 'idle',
      report: 'idle',
    };
    const next = withDownstreamReset(mixed, 'execution', ORDER, 'running', 'idle');
    assert.equal(next.requirement, 'done');
    assert.equal(next.cases, 'review'); // upstream gate state preserved
    assert.equal(next.execution, 'running');
    assert.equal(next.report, 'idle');
  });

  it('is a no-op on downstream that is already idle (normal forward run)', () => {
    const midRun: Record<TestStep, Status> = {
      requirement: 'done',
      cases: 'done',
      execution: 'idle',
      report: 'idle',
    };
    const next = withDownstreamReset(midRun, 'execution', ORDER, 'running', 'idle');
    assert.deepEqual(next, {
      requirement: 'done',
      cases: 'done',
      execution: 'running',
      report: 'idle',
    });
  });

  it('does not mutate the input object', () => {
    const snapshot = { ...allDone };
    withDownstreamReset(allDone, 'execution', ORDER, 'running', 'idle');
    assert.deepEqual(allDone, snapshot);
  });

  it('works with arbitrary status sentinels (generic over status type)', () => {
    const next = withDownstreamReset(
      { requirement: 1, cases: 1, execution: 1, report: 1 } as Record<TestStep, number>,
      'cases',
      ORDER,
      9,
      0,
    );
    assert.deepEqual(next, { requirement: 1, cases: 9, execution: 0, report: 0 });
  });
});

// 「运行任务 · 选择起点」可选起点计算。起点排除「测试报告」(仅前 3 步)。
const STARTS: TestStep[] = ['requirement', 'cases', 'execution'];
const opt = (s: Record<TestStep, Status>) =>
  Object.fromEntries(runStartOptions(s, ORDER, STARTS).map((o) => [o.step, o]));

describe('runStartOptions', () => {
  it('已完成任务：三个起点都可选、都会覆盖、无 next（默认落到测试执行由组件定）', () => {
    const o = opt(allDone);
    for (const s of STARTS) {
      assert.equal(o[s].unlocked, true, `${s} unlocked`);
      assert.equal(o[s].willOverwrite, true, `${s} willOverwrite`);
      assert.equal(o[s].isNext, false, `${s} isNext`);
    }
  });

  it('部分完成（需求✓/用例✓/执行待办）：执行=下一步且不覆盖；需求/用例可选但会覆盖', () => {
    const o = opt({ requirement: 'done', cases: 'done', execution: 'idle', report: 'idle' });
    assert.deepEqual(o.execution, { step: 'execution', unlocked: true, willOverwrite: false, isNext: true });
    assert.equal(o.requirement.unlocked, true);
    assert.equal(o.requirement.willOverwrite, true);
    assert.equal(o.cases.willOverwrite, true);
    assert.equal(o.requirement.isNext, false);
  });

  it('全新任务：仅需求可选(=下一步、不覆盖)，用例/执行锁定', () => {
    const o = opt({ requirement: 'idle', cases: 'idle', execution: 'idle', report: 'idle' });
    assert.deepEqual(o.requirement, { step: 'requirement', unlocked: true, willOverwrite: false, isNext: true });
    assert.equal(o.cases.unlocked, false);
    assert.equal(o.execution.unlocked, false);
  });

  it('需求待批准(review)：算「有产物」(重跑覆盖)，但不解锁下游(用例锁定)', () => {
    const o = opt({ requirement: 'review', cases: 'idle', execution: 'idle', report: 'idle' });
    assert.equal(o.requirement.unlocked, true); // 首步恒可
    assert.equal(o.requirement.willOverwrite, true); // review 有产物
    assert.equal(o.requirement.isNext, true); // 第一个未 done
    assert.equal(o.cases.unlocked, false); // 上一步是 review 非 done → 不解锁
  });

  it('用例待批准、执行待办：执行因上一步未 done 而锁定', () => {
    const o = opt({ requirement: 'done', cases: 'review', execution: 'idle', report: 'idle' });
    assert.equal(o.cases.unlocked, true);
    assert.equal(o.cases.isNext, true); // cases 是第一个未 done
    assert.equal(o.execution.unlocked, false); // cases 是 review 非 done
  });
});
