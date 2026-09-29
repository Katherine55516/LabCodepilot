import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { estimate } from '../../components/ppt/create/PptCreateWizard';

describe('PPT create page recommendation', () => {
  it('plans a short technical topic into semantic units before suggesting pages', () => {
    const result = estimate('prompt', '介绍公司的 AI Agent 平台', '', null);
    assert.equal(result.recommended, 9);
    assert.match(result.reason, /待论证语义单元/);
  });

  it('uses different page costs for planning and learning intents', () => {
    assert.ok(estimate('prompt', '介绍 Q4 产品计划', '', null).recommended <
      estimate('prompt', '介绍公司的 AI Agent 平台', '', null).recommended);
    assert.ok(estimate('prompt', '设计培训课程', '', null).recommended <=
      estimate('prompt', '介绍 Q4 产品计划', '', null).recommended);
  });

  it('keeps explicitly requested pages and ignores source-page references', () => {
    assert.equal(estimate('prompt', '生成12页关于平台架构的演示', '', null).requested, 12);
    assert.equal(estimate('paste', '总结这份文档', '第12页讲环境配置', null).requested, undefined);
  });
});
