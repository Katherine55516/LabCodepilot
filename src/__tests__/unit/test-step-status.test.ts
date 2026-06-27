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
import { withDownstreamReset } from '@/lib/test/step-status';
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
