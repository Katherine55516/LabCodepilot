/**
 * 自动重放安全判定 + 运行失败摘要。
 *
 * 回归背景（打包版实测）：
 *  1. isSafeForAutomaticReplay 扫描整份用例 JSON，把 expected/purpose 里引用的 UI
 *     元素名当成写操作信号 —— 一条只断言按钮「+ 新建学科」可见的只读用例，因为文案
 *     里有「新建」而被永久挡在自动验证之外，只能停留在「待复核」。
 *  2. 手动运行失败时 status/counts 都不变，卡片逐字节不变，用户点了「运行全部」像是
 *     没反应。summarizeRunFailure 从 Playwright 冗长输出里提炼出一行可读原因。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isSafeForAutomaticReplay } from '@/lib/test/script-validator';
import { summarizeRunFailure } from '@/lib/test/script-runner';

describe('isSafeForAutomaticReplay', () => {
  it('只读用例：动作不写数据，按钮名出现在 expected 里 → 可自动重放', () => {
    // 这正是打包版里 TC-subjects-R01 的形状：被「新建学科」按钮名误判。
    const readOnly = {
      id: 'TC-subjects-R01',
      purpose: '验证 Dashboard 首屏正确渲染学科列表区域',
      steps: [
        { content: '打开 Dashboard 页面（/）', expected: '页面加载完成，顶部显示「+ 新建学科」按钮' },
        { content: '观察学科列表区域', expected: '列表容器渲染，无报错占位' },
      ],
      assertion: '页面存在「+ 新建学科」按钮',
    };
    assert.equal(isSafeForAutomaticReplay(readOnly), true);
  });

  it('动作里含写操作动词 → 不可自动重放', () => {
    const mutating = {
      id: 'TC-2',
      purpose: '验证创建学科',
      steps: [
        { content: '点击「+ 新建学科」按钮', expected: '表单展开' },
        { content: '点击「创建」提交表单', expected: '列表出现新卡片' },
      ],
    };
    assert.equal(isSafeForAutomaticReplay(mutating), false);
  });

  it('声明了 cleanup → 无条件可自动重放（用例自述如何还原）', () => {
    const withCleanup = {
      id: 'TC-3',
      cleanup: '删除测试期间创建的学科',
      steps: [{ content: '点击「创建」提交表单', expected: '成功' }],
    };
    assert.equal(isSafeForAutomaticReplay(withCleanup), true);
  });

  it('空白 cleanup 不算声明', () => {
    const blank = { id: 'TC-4', cleanup: '   ', steps: [{ content: '点击「保存」' }] };
    assert.equal(isSafeForAutomaticReplay(blank), false);
  });

  it('无结构化 steps → 保守回退到扫描全文', () => {
    // 拿不到动作时不能假定安全：purpose 里的「删除」足以判定为不安全。
    assert.equal(isSafeForAutomaticReplay({ id: 'TC-5', purpose: '验证删除学科' }), false);
    assert.equal(isSafeForAutomaticReplay({ id: 'TC-6', purpose: '验证列表渲染' }), true);
  });

  it('steps 为字符串数组时同样只看动作', () => {
    assert.equal(isSafeForAutomaticReplay({ id: 'TC-7', steps: ['打开页面', '观察列表'] }), true);
    assert.equal(isSafeForAutomaticReplay({ id: 'TC-8', steps: ['打开页面', '点击保存'] }), false);
  });

  it('英文写操作动词同样识别', () => {
    assert.equal(isSafeForAutomaticReplay({ id: 'TC-9', steps: [{ content: 'click Submit' }] }), false);
  });
});

describe('summarizeRunFailure', () => {
  it('优先提取 net::ERR_* 网络错误（被测应用没起来时最常见）', () => {
    const output = [
      'Running 1 test using 1 worker',
      '  1) TC-subjects-R01.spec.ts:3:5 › TC-subjects-R01 ─────',
      '    Error: page.goto: net::ERR_CONNECTION_REFUSED at ${BASE_URL}/',
      '    Call log:',
      '      - navigating to "${BASE_URL}/", waiting until "load"',
      '  1 failed',
    ].join('\n');
    const reason = summarizeRunFailure(output, false);
    assert.match(reason, /net::ERR_CONNECTION_REFUSED/);
  });

  it('超时优先于输出内容', () => {
    assert.equal(summarizeRunFailure('whatever\nError: boom', true), '脚本运行超时');
  });

  it('无网络错误时取第一条 Error 行', () => {
    const output = 'Running 1 test\n  TimeoutError: locator.click: Timeout 5000ms exceeded\n  1 failed';
    assert.match(summarizeRunFailure(output, false), /TimeoutError: locator\.click/);
  });

  it('没有任何 Error 行时回退到最后一行非空输出', () => {
    assert.equal(summarizeRunFailure('line one\nline two\n\n', false), 'line two');
  });

  it('空输出不抛异常，给出兜底文案', () => {
    assert.equal(summarizeRunFailure('', false), '脚本运行失败');
  });

  it('截断到 300 字符，避免整段报告塞进卡片', () => {
    const long = 'Error: ' + 'x'.repeat(500);
    assert.equal(summarizeRunFailure(long, false).length, 300);
  });
});
