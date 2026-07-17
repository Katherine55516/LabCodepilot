/**
 * 快照元素清单富化（observedElements）。
 *
 * 背景（真机踩坑）：轨迹的 playwrightCode 只覆盖【被操作过】的元素——MCP 已把它们解析成
 * 现成的 `getByRole('button', { name: '+ 新建学科' })`，模型无需猜。但断言常打在【只在页面
 * 快照里出现、从未被点击】的元素上（「验证头像上传框可见」），这类元素轨迹里零记录，模型
 * 只能凭空捏定位器 → `.avatar-uploader` 之类组件库内部 class → 重放 element(s) not found。
 * 本组用例守护「从 MCP 的 ### Snapshot 节抽出元素词汇表」这条链路。
 *
 * fixture 严格照 @playwright/mcp 0.0.76 的真实响应格式（分节文本 + ```yaml 围栏 aria 树，
 * 行形如 `- button "+ 新建学科" [ref=e12] [cursor=pointer]`）。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ScriptTraceCollector,
  extractAriaSnapshot,
  normalizedTraceHash,
  parseSnapshotElements,
  readTraceFile,
  writeTraceFile,
  type ScriptTraceAction,
} from '@/lib/test/script-trace';

/** 一条真实形态的 MCP tool_result：Ran Playwright code 节 + Snapshot 节。 */
const mcpResult = (code: string, snapshotYaml: string) =>
  [
    '### Ran Playwright code',
    '```js',
    code,
    '```',
    '### Snapshot',
    '```yaml',
    snapshotYaml,
    '```',
  ].join('\n');

const SNAPSHOT = [
  '- generic [ref=e1]:',
  '  - button "+ 新建学科" [ref=e12] [cursor=pointer]',
  '  - textbox "名称" [ref=e13]',
  '  - button "上传头像" [ref=e14] [cursor=pointer]',
  '  - text: 一些说明文字',
].join('\n');

describe('extractAriaSnapshot', () => {
  it('取出 ### Snapshot 节的 yaml 围栏内容', () => {
    const content = mcpResult("await page.getByRole('button').click();", SNAPSHOT);
    assert.equal(extractAriaSnapshot(content), SNAPSHOT);
  });

  it('无 Snapshot 节 → undefined', () => {
    const content = ['### Ran Playwright code', '```js', 'await page.goto("/");', '```'].join('\n');
    assert.equal(extractAriaSnapshot(content), undefined);
  });

  it('快照被配置成文件链接形态时不读盘、当作无快照', () => {
    // MCP 配了 snapshot 文件名时该节退化为 `- [Snapshot](page.yml)`（无 yaml 围栏）。
    const content = ['### Snapshot', '- [Snapshot](/tmp/page-1.yml)'].join('\n');
    assert.equal(extractAriaSnapshot(content), undefined);
  });
});

describe('parseSnapshotElements', () => {
  it('解析具名元素的 role/name，跳过无名元素与文本行', () => {
    assert.deepEqual(parseSnapshotElements(SNAPSHOT), [
      { role: 'button', name: '+ 新建学科' },
      { role: 'textbox', name: '名称' },
      { role: 'button', name: '上传头像' },
    ]);
    // `- generic [ref=e1]:` 无 name → 不入清单（对断言无价值且量极大）；`- text:` 不是元素。
    assert.ok(!parseSnapshotElements(SNAPSHOT).some((e) => e.role === 'generic' || e.role === 'text'));
  });

  it('还原 name 里的 YAML 转义引号', () => {
    const yaml = '  - button "点击\\"确定\\"按钮" [ref=e5]';
    assert.deepEqual(parseSnapshotElements(yaml), [{ role: 'button', name: '点击"确定"按钮' }]);
  });

  it('同 role+name 去重、保序', () => {
    const yaml = ['- link "详情" [ref=e1]', '- link "详情" [ref=e2]', '- link "编辑" [ref=e3]'].join('\n');
    assert.deepEqual(parseSnapshotElements(yaml), [
      { role: 'link', name: '详情' },
      { role: 'link', name: '编辑' },
    ]);
  });
});

describe('ScriptTraceCollector · observedElements', () => {
  const feedCase = (collector: ScriptTraceCollector, caseId: string, toolId: string, content: string) => {
    collector.feedText(`@@CASE_START {"id":"${caseId}","index":1}\n`);
    collector.feedToolUse({ id: toolId, name: 'mcp__playwright__browser_click', input: {} });
    collector.feedToolResult({ tool_use_id: toolId, content });
  };

  it('把快照元素按用例并集收集（含从未被点击的断言目标）', () => {
    const collector = new ScriptTraceCollector(0);
    feedCase(collector, 'TC-001', 't1', mcpResult("await page.getByRole('button', { name: '+ 新建学科' }).click();", SNAPSHOT));
    const elements = collector.finishElements();
    // 「上传头像」从未被点击，轨迹的 playwrightCode 里没有它——正是它必须进清单的理由。
    assert.deepEqual(elements['TC-001'], [
      { role: 'button', name: '+ 新建学科' },
      { role: 'textbox', name: '名称' },
      { role: 'button', name: '上传头像' },
    ]);
  });

  it('跨快照并集（后续快照的新元素并入，同用例不覆盖）', () => {
    const collector = new ScriptTraceCollector(0);
    collector.feedText('@@CASE_START {"id":"TC-002","index":1}\n');
    collector.feedToolUse({ id: 'a', name: 'mcp__playwright__browser_click', input: {} });
    collector.feedToolResult({ tool_use_id: 'a', content: mcpResult('x', '- button "第一页按钮" [ref=e1]') });
    collector.feedToolUse({ id: 'b', name: 'mcp__playwright__browser_click', input: {} });
    collector.feedToolResult({ tool_use_id: 'b', content: mcpResult('y', '- button "第二页按钮" [ref=e1]') });
    assert.deepEqual(collector.finishElements()['TC-002'], [
      { role: 'button', name: '第一页按钮' },
      { role: 'button', name: '第二页按钮' },
    ]);
  });

  it('元素归属当前用例，不串味', () => {
    const collector = new ScriptTraceCollector(0);
    feedCase(collector, 'TC-001', 't1', mcpResult('x', '- button "甲" [ref=e1]'));
    feedCase(collector, 'TC-002', 't2', mcpResult('y', '- button "乙" [ref=e1]'));
    const elements = collector.finishElements();
    assert.deepEqual(elements['TC-001'], [{ role: 'button', name: '甲' }]);
    assert.deepEqual(elements['TC-002'], [{ role: 'button', name: '乙' }]);
  });

  it('单用例元素数封顶 120（大页面 aria 树不撑爆 trace）', () => {
    const collector = new ScriptTraceCollector(0);
    const huge = Array.from({ length: 300 }, (_, i) => `- button "按钮${i}" [ref=e${i}]`).join('\n');
    feedCase(collector, 'TC-003', 't1', mcpResult('x', huge));
    assert.equal(collector.finishElements()['TC-003'].length, 120);
  });

  it('元素文本经过脱敏', () => {
    const collector = new ScriptTraceCollector(0, [{ value: 'super-secret-pass', replacement: '${TEST_PASSWORD}' }]);
    feedCase(collector, 'TC-004', 't1', mcpResult('x', '- textbox "super-secret-pass" [ref=e1]'));
    assert.deepEqual(collector.finishElements()['TC-004'], [{ role: 'textbox', name: '${TEST_PASSWORD}' }]);
  });

  it('无快照的 result 不产生元素条目', () => {
    const collector = new ScriptTraceCollector(0);
    collector.feedText('@@CASE_START {"id":"TC-005","index":1}\n');
    collector.feedToolUse({ id: 't1', name: 'mcp__playwright__browser_evaluate', input: {} });
    collector.feedToolResult({ tool_use_id: 't1', content: '### Result\n{"status":200}' });
    assert.deepEqual(collector.finishElements(), {});
  });
});

describe('observedElements 与语义指纹的隔离', () => {
  it('元素清单不参与 normalizedTraceHash（否则升级当天存量脚本全量 churn）', () => {
    const actions: ScriptTraceAction[] = [{
      caseId: 'TC-001',
      sequence: 1,
      toolName: 'mcp__playwright__browser_click',
      playwrightCode: "await page.getByRole('button').click();",
      success: true,
      usesMock: false,
      timestampOffsetMs: 10,
    }];
    const before = normalizedTraceHash(actions);

    // 同一批 actions，一个带快照、一个不带 —— 指纹必须一致。
    const withSnapshot = new ScriptTraceCollector(0);
    withSnapshot.feedText('@@CASE_START {"id":"TC-001","index":1}\n');
    withSnapshot.feedToolUse({ id: 't1', name: 'mcp__playwright__browser_click', input: {} });
    withSnapshot.feedToolResult({
      tool_use_id: 't1',
      content: mcpResult("await page.getByRole('button').click();", SNAPSHOT),
    });
    assert.ok(withSnapshot.finishElements()['TC-001'].length > 0, '前提：确实采到了元素');
    assert.equal(normalizedTraceHash(withSnapshot.finish()), before);
  });
});

describe('trace 文件往返', () => {
  const withTempProject = (fn: (dir: string) => void) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-elements-'));
    try { fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  };

  it('elements 行写入后能读回', () => {
    withTempProject((dir) => {
      const actions: ScriptTraceAction[] = [{
        caseId: 'TC-001', sequence: 1, toolName: 'mcp__playwright__browser_click',
        success: true, usesMock: false, timestampOffsetMs: 1,
      }];
      writeTraceFile(dir, '任务', 'local', 'hash1', actions, {
        'TC-001': [{ role: 'button', name: '上传头像' }],
      });
      const read = readTraceFile(dir, '任务', 'local');
      assert.equal(read?.actions.length, 1);
      assert.deepEqual(read?.elementsByCase, { 'TC-001': [{ role: 'button', name: '上传头像' }] });
    });
  });

  it('旧 trace 文件（无 elements 行）读回为空表，向后兼容', () => {
    withTempProject((dir) => {
      const actions: ScriptTraceAction[] = [{
        caseId: 'TC-001', sequence: 1, toolName: 'mcp__playwright__browser_click',
        success: true, usesMock: false, timestampOffsetMs: 1,
      }];
      writeTraceFile(dir, '任务', 'local', 'hash1', actions);
      const read = readTraceFile(dir, '任务', 'local');
      assert.equal(read?.actions.length, 1);
      assert.deepEqual(read?.elementsByCase, {});
    });
  });
});
