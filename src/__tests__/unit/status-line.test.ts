import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { toStatusLine, STATUS_LINE_MAX_CHARS } from '../../lib/status-line';

/**
 * 回归锁：执行状态行被长文案铺满整个聊天区。
 *
 * 触发链（用户实拍）：子代理完成 → claude-client 的 task_notification 把整份
 * summary 当 `message` 发出 → onStatus → snapshot.statusText → StreamingStatusBar
 * 无约束渲染 → 几千字换行铺开，把真正的输出顶出视口；且 Shimmer 的高光宽度
 * 按字符数算，几千 px 的 spread 让整段文字淡到几乎不可见。
 *
 * toStatusLine 是这条链上的收口：源头（claude-client）和渲染兜底
 * （StreamingStatusBar）都过它，任一处漏了另一处仍能挡住。
 */
describe('toStatusLine — 状态行单行化', () => {
  it('短文案原样返回', () => {
    assert.equal(toStatusLine('Connected (claude-opus-4-5)'), 'Connected (claude-opus-4-5)');
  });

  it('空/undefined/null 返回空串，调用方据此回退默认文案', () => {
    assert.equal(toStatusLine(undefined), '');
    assert.equal(toStatusLine(null), '');
    assert.equal(toStatusLine(''), '');
    assert.equal(toStatusLine('   \n\t  '), '');
  });

  it('换行压成单空格 —— 状态行没有第二行可用', () => {
    assert.equal(toStatusLine('Task completed\n\nFound 3 issues:\n- a\n- b'), 'Task completed Found 3 issues: - a - b');
  });

  it('制表符与连续空格同样压成单空格', () => {
    assert.equal(toStatusLine('a\t\tb    c'), 'a b c');
  });

  it('超长文案截断到上限并加省略号', () => {
    const long = 'x'.repeat(500);
    const out = toStatusLine(long);
    assert.equal(out.length, STATUS_LINE_MAX_CHARS + 1, '截断后应为上限长度 + 1 个省略号');
    assert.ok(out.endsWith('…'));
  });

  it('恰好等于上限时不截断、不加省略号', () => {
    const exact = 'y'.repeat(STATUS_LINE_MAX_CHARS);
    assert.equal(toStatusLine(exact), exact);
  });

  it('真实回归载荷：多行子代理报告被压成单行短文案', () => {
    // 形似用户实拍的那份子代理报告
    const summary = [
      '## 8. Scoring pages (3/3)',
      '',
      'There is already a working quantitative-score table editor for 评分 (both self-fill',
      'and 领导评分), reusing the same renderRatingGoalList(), but it is a single homogeneous',
      'set of 维度 rows — there is no existing nested 分组 UI.',
      '',
      '## 9. HR 设置 (settings) page',
      '',
      'There is not one unified HR settings renderer.',
    ].join('\n');

    const out = toStatusLine(summary);
    assert.ok(!out.includes('\n'), '不得残留换行 —— 换行会让状态行铺开成多行');
    assert.ok(out.length <= STATUS_LINE_MAX_CHARS + 1, `实际长度 ${out.length}`);
    assert.ok(out.startsWith('## 8. Scoring pages (3/3)'));
    assert.ok(out.endsWith('…'));
  });

  it('尊重自定义上限', () => {
    assert.equal(toStatusLine('abcdefghij', 4), 'abcd…');
  });

  it('截断处的尾随空格被清掉，不出现「词 …」', () => {
    // 第 5 个字符是空格，slice 后应 trimEnd 再接省略号
    assert.equal(toStatusLine('abcd efgh', 5), 'abcd…');
  });
});
