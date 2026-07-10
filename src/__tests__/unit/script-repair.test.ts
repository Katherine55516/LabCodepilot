/**
 * AI 修复载荷校验（validateRepairPayload）。
 *
 * 背景：测试人员不写代码，脚本运行失败后唯一出路是把 lastRunError 喂回模型定向修。
 * 红线：模型可以返回 fixed=false + reason（断言如实失败时必须如此），载荷校验必须
 * 忠实保留这个结论，不得把「拒绝修复」误当「修复失败」丢弃。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateRepairPayload, type RepairScriptInput } from '@/lib/test/script-generator';

const input = (id: string): RepairScriptInput => ({
  candidate: {
    id,
    scriptCaseId: id,
    testCase: { id },
    result: { id, status: 'pass', actual: '', error: '', evidence: [] },
    actions: [],
    fileName: `${id}.spec.ts`,
    fingerprint: 'fp',
    usesMock: false,
  },
  currentContent: 'old script',
  failure: 'Error: strict mode violation',
});

const repair = (extra: Record<string, unknown>) => ({
  caseId: 'TC-1', fileName: 'TC-1.spec.ts', fixed: true, reason: 'r', content: 'new', ...extra,
});

describe('validateRepairPayload', () => {
  it('fixed=true 带内容 → 采纳，并归一化 @playwright/test import', () => {
    const out = validateRepairPayload(
      { repairs: [repair({ content: `import { test, expect } from '@playwright/test';\ntest('TC-1', async()=>{});` })] },
      [input('TC-1')],
    );
    assert.equal(out.length, 1);
    assert.equal(out[0].fixed, true);
    assert.match(out[0].content!, /from 'playwright\/test'/);
  });

  it('fixed=false（断言如实失败/无法修）→ 保留 reason，不带 content', () => {
    const out = validateRepairPayload(
      { repairs: [repair({ fixed: false, content: '', reason: '页面实际未禁用按钮，与用例预期不符，需人工确认' })] },
      [input('TC-1')],
    );
    assert.deepEqual(out, [{ caseId: 'TC-1', fixed: false, reason: '页面实际未禁用按钮，与用例预期不符，需人工确认' }]);
  });

  it('声称 fixed 却没给内容 → 降级为未修复，保留解释', () => {
    const out = validateRepairPayload({ repairs: [repair({ content: '   ' })] }, [input('TC-1')]);
    assert.equal(out[0].fixed, false);
  });

  it('caseId 不在本批 / fileName 不匹配 / 重复 → 丢弃', () => {
    const out = validateRepairPayload({
      repairs: [
        repair({ caseId: 'TC-unknown' }),
        repair({ fileName: 'wrong.spec.ts' }),
        repair({}),
        repair({ reason: 'dup' }),
      ],
    }, [input('TC-1')]);
    assert.equal(out.length, 1);
    assert.equal(out[0].reason, 'r');
  });

  it('非法形态（缺字段/类型错/非对象）→ 全部丢弃且不抛异常', () => {
    assert.deepEqual(validateRepairPayload({ repairs: [null, 42, { caseId: 'TC-1' }] }, [input('TC-1')]), []);
    assert.deepEqual(validateRepairPayload('not an object', [input('TC-1')]), []);
  });
});
