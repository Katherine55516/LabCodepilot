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
import { withDownstreamReset, runStartOptions, taskCategory, occupiedSlots, TASK_CATEGORY_ORDER } from '@/lib/test/step-status';
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

// 看板任务状态分类（顶部概览 chip + 分组堆叠）。运行/排队来自运行时集合，已完成/待处理由步状态派生。
const cat = (s: Record<TestStep, Status>, isRunning = false, isQueued = false) =>
  taskCategory(s, ORDER, isRunning, isQueued);

describe('taskCategory', () => {
  it('运行中优先级最高：在跑就是 running（哪怕步全 idle 或全 done）', () => {
    assert.equal(cat({ requirement: 'idle', cases: 'idle', execution: 'idle', report: 'idle' }, true, false), 'running');
    assert.equal(cat(allDone, true, false), 'running');
  });

  it('排队中：未在跑但在等待队列 → queued', () => {
    assert.equal(cat({ requirement: 'idle', cases: 'idle', execution: 'idle', report: 'idle' }, false, true), 'queued');
  });

  it('瞬时双态（既在跑又在队列）按优先级取 running', () => {
    assert.equal(cat(allDone, true, true), 'running');
  });

  it('四步全 done 且不在跑/不排队 → done', () => {
    assert.equal(cat(allDone, false, false), 'done');
  });

  it('全新任务（全 idle）→ pending', () => {
    assert.equal(cat({ requirement: 'idle', cases: 'idle', execution: 'idle', report: 'idle' }, false, false), 'pending');
  });

  it('部分完成（k/4）→ pending', () => {
    assert.equal(cat({ requirement: 'done', cases: 'done', execution: 'idle', report: 'idle' }, false, false), 'pending');
  });

  it('待批准（review）归入 pending（卡片徽标再区分）', () => {
    assert.equal(cat({ requirement: 'done', cases: 'review', execution: 'idle', report: 'idle' }, false, false), 'pending');
  });

  it('失败（error）归入 pending（卡片徽标再区分）', () => {
    assert.equal(cat({ requirement: 'done', cases: 'done', execution: 'error', report: 'idle' }, false, false), 'pending');
  });

  it('每个任务恰好落入一个分类（互斥且穷尽）', () => {
    const samples: Array<[Record<TestStep, Status>, boolean, boolean]> = [
      [{ requirement: 'idle', cases: 'idle', execution: 'idle', report: 'idle' }, false, false],
      [{ requirement: 'done', cases: 'review', execution: 'idle', report: 'idle' }, false, false],
      [{ requirement: 'done', cases: 'done', execution: 'error', report: 'idle' }, false, false],
      [allDone, false, false],
      [allDone, false, true],
      [allDone, true, false],
    ];
    for (const [s, r, q] of samples) {
      const c = cat(s, r, q);
      assert.ok(TASK_CATEGORY_ORDER.includes(c), `${c} in order`);
    }
  });

  it('空 order 不会误判为 done', () => {
    assert.equal(taskCategory<TestStep>({} as Record<TestStep, Status>, [], false, false), 'pending');
  });
});

// 全局并发占用槽位（运行任务超并发自动排队的判定依据）。
describe('occupiedSlots', () => {
  it('空集合 → 0', () => {
    assert.equal(occupiedSlots(new Set(), new Set()), 0);
  });

  it('仅在跑（无 autoRun）也计入 —— 修复点：手动单跑任务不能漏算', () => {
    assert.equal(occupiedSlots(new Set(['a']), new Set()), 1);
  });

  it('仅 autoRun（已认领、可能瞬间不在跑）也计入', () => {
    assert.equal(occupiedSlots(new Set(), new Set(['a'])), 1);
  });

  it('既在跑又被认领的同一任务只占一个槽位（并集去重，不重复计数）', () => {
    assert.equal(occupiedSlots(new Set(['a']), new Set(['a'])), 1);
  });

  it('运行+认领的并集：{a,b} 在跑、{b,c} 认领 → 3 个不同任务', () => {
    assert.equal(occupiedSlots(new Set(['a', 'b']), new Set(['b', 'c'])), 3);
  });

  it('并发=1 时：占用 1 → 已满（occupied >= concurrency），应排队', () => {
    const concurrency = 1;
    assert.equal(occupiedSlots(new Set(['a']), new Set(['a'])) < concurrency, false); // 满
    assert.equal(occupiedSlots(new Set(), new Set()) < concurrency, true); // 空 → 可跑
  });
});
