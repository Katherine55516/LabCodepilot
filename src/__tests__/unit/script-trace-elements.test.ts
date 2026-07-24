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
 *
 * ⚠️ 2026-07-17 真机教训：初版【只认内联 ```yaml 形态】，本组用例也只覆盖内联，全绿；打包
 * 真机跑下来 trace 里 elements 行为 0 —— 一个元素都没收到。原因是本 app 的 MCP 配了
 * `--output-dir`（prompts.ts），真实响应根本不是内联：
 *   - `browser_navigate` → `### Snapshot` 后跟【文件链接】`- [Snapshot](AI_LabTest/…/page-*.yml)`；
 *   - `browser_snapshot` → 内联 YAML 有 352KB，被 SDK 截断成 `<persisted-output>` 包装 + 2KB 预览。
 * 教训：解析器的 fixture 必须取自【真实链路的原文】，不能拿自己造的理想数据。下面
 * REAL_* 两个常量就是从真机 SSE 流里原样抠出来的。
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

/** 临时项目目录(文件链接形态需要真实的项目根)。 */
const withTempProject = (fn: (dir: string) => void) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-elements-'));
  try { fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
};

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

  it('文件链接形态在【没有 projectPath】时当作无快照', () => {
    // 注意:这条曾经断言的是「文件链接一律不读盘」——那个设计判断被真机推翻(见文件头)。
    // 现在的口径是:文件链接【要读】,但必须有项目根才能解析与做安全校验;没有根才降级。
    const content = ['### Snapshot', '- [Snapshot](page-1.yml)'].join('\n');
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

// ── 真机响应形态（2026-07-17 从打包版 SSE 流原样抠出）────────────────────────────
// 初版对这两种形态一个都不认，真机 elements 行为 0。回归守护：它们才是主路径。

/** browser_navigate 的真实返回：Snapshot 节退化成【项目相对路径】的文件链接。 */
const REAL_NAVIGATE_RESULT = "### Ran Playwright code\n```js\nawait page.goto('http://localhost:5173');\n```\n### Page\n- Page URL: http://localhost:5173/\n- Page Title: Learning System\n- Console: 0 errors, 2 warnings\n### Snapshot\n- [Snapshot](AI_LabTest/report/_evidence/学科管理回归-local/page-2026-07-17T07-25-21-808Z.yml)\n### Events\n- New console entries: AI_LabTest/report/_evidence/学科管理回归-local/console-2026-07-17T07-25-21-630Z.log#L1-L3";

/** 真实快照 .yml 的内容（MCP --output-dir 落盘的原样格式）。 */
const REAL_SNAPSHOT_YML = [
  '- generic [ref=e3]:',
  '  - banner [ref=e4]:',
  '    - generic [ref=e5]:',
  '      - link "📚 Learning System" [ref=e6] [cursor=pointer]:',
  '        - /url: /',
  '      - navigation [ref=e7]:',
  '        - link "总览" [ref=e8] [cursor=pointer]:',
  '          - /url: /',
  '        - link "学习日志" [ref=e9] [cursor=pointer]:',
  '          - /url: /sessions',
  '        - button "🔔" [ref=e14] [cursor=pointer]',
  '  - main [ref=e15]:',
  '    - heading "我在学的" [level=1] [ref=e21]',
  '    - button "+ 新建学科" [ref=e22] [cursor=pointer]',
].join('\n');

/** browser_snapshot 的真实返回：内联 YAML 太大被 SDK 截断成 persisted 包装 + 2KB 预览。 */
const realPersistedResult = (absPath: string) =>
  `<persisted-output>\nOutput too large (352.1KB). Full output saved to: ${absPath}\n\nPreview (first 2KB):\n[\n  {\n    "type": "text",\n    "text": "### Page\\n- Page URL: http://localhost:5173/\\n### Snapshot\\n\`\`\`yaml\\n- generic [`;

describe('真机响应形态 · 文件链接（browser_navigate 的主路径）', () => {
  it('从 Snapshot 文件链接读出元素', () => {
    withTempProject((dir) => {
      const rel = 'AI_LabTest/report/_evidence/学科管理回归-local/page-2026-07-17T07-25-21-808Z.yml';
      const abs = path.join(dir, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, REAL_SNAPSHOT_YML);

      const yaml = extractAriaSnapshot(REAL_NAVIGATE_RESULT, dir);
      assert.ok(yaml, '真机主路径:必须读得到快照文件');
      const els = parseSnapshotElements(yaml);
      assert.deepEqual(els, [
        { role: 'link', name: '📚 Learning System' },
        { role: 'link', name: '总览' },
        { role: 'link', name: '学习日志' },
        { role: 'button', name: '🔔' },
        { role: 'heading', name: '我在学的' },
        { role: 'button', name: '+ 新建学科' },
      ]);
    });
  });

  it('不给 projectPath 时不解析文件链接（无根则无从做安全校验）', () => {
    assert.equal(extractAriaSnapshot(REAL_NAVIGATE_RESULT), undefined);
  });

  it('文件链接指向项目根之外 → 拒绝（路径来自 MCP 输出，按不可信处理）', () => {
    withTempProject((dir) => {
      const evil = '### Snapshot\n- [Snapshot](../../../../etc/passwd.yml)';
      assert.equal(extractAriaSnapshot(evil, dir), undefined);
    });
  });

  it('快照文件不存在 → 静默当作没有清单，不抛错', () => {
    withTempProject((dir) => {
      assert.equal(extractAriaSnapshot(REAL_NAVIGATE_RESULT, dir), undefined);
    });
  });
});

describe('真机响应形态 · persisted 截断（browser_snapshot 的主路径）', () => {
  it('从 SDK tool-results 缓存 JSON 里读出元素', () => {
    withTempProject((dir) => {
      const cache = path.join(dir, 'cache.json');
      fs.writeFileSync(cache, JSON.stringify([
        { type: 'text', text: `### Page\n- Page URL: http://localhost:5173/\n### Snapshot\n\`\`\`yaml\n${REAL_SNAPSHOT_YML}\n\`\`\`` },
      ]));
      const yaml = extractAriaSnapshot(realPersistedResult(cache), dir);
      assert.ok(yaml, 'persisted 形态必须能还原出内联快照');
      assert.deepEqual(parseSnapshotElements(yaml).slice(0, 2), [
        { role: 'link', name: '📚 Learning System' },
        { role: 'link', name: '总览' },
      ]);
    });
  });

  it('缓存文件已被清理 → 静默降级，不抛错', () => {
    withTempProject((dir) => {
      assert.equal(extractAriaSnapshot(realPersistedResult(path.join(dir, 'gone.json')), dir), undefined);
    });
  });

  it('persisted 输出里没有 Snapshot 节 → 不白读盘', () => {
    withTempProject((dir) => {
      const cache = path.join(dir, 'c.json');
      fs.writeFileSync(cache, JSON.stringify([{ type: 'text', text: '一份很大的文件内容,与快照无关' }]));
      const noSnap = `<persisted-output>\nOutput too large (99KB). Full output saved to: ${cache}\n\nPreview (first 2KB):\n[...]`;
      assert.equal(extractAriaSnapshot(noSnap, dir), undefined);
    });
  });
});

describe('收集器端到端 · 真机文件链接形态', () => {
  it('collector 拿到 projectPath 后，能从 navigate 的文件链接收集元素', () => {
    withTempProject((dir) => {
      const rel = 'AI_LabTest/report/_evidence/学科管理回归-local/page-x.yml';
      const abs = path.join(dir, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, REAL_SNAPSHOT_YML);

      const collector = new ScriptTraceCollector(0, [], dir);
      collector.feedText('@@CASE_START {"id":"TC-001","index":1}\n');
      collector.feedToolUse({ id: 't1', name: 'mcp__playwright__browser_navigate', input: { url: 'http://localhost:5173' } });
      collector.feedToolResult({
        tool_use_id: 't1',
        content: `### Ran Playwright code\n\`\`\`js\nawait page.goto('x');\n\`\`\`\n### Snapshot\n- [Snapshot](${rel})`,
      });

      const els = collector.elementsForCase('TC-001');
      assert.equal(els.length, 6, '真机主路径:收集器必须收到元素(初版这里是 0)');
      assert.ok(els.some((e) => e.role === 'button' && e.name === '+ 新建学科'));
    });
  });

  it('缺 projectPath 的 collector 不因文件链接崩溃（降级为空清单）', () => {
    const collector = new ScriptTraceCollector(0, []);
    collector.feedText('@@CASE_START {"id":"TC-001","index":1}\n');
    collector.feedToolUse({ id: 't1', name: 'mcp__playwright__browser_navigate', input: {} });
    collector.feedToolResult({ tool_use_id: 't1', content: REAL_NAVIGATE_RESULT });
    assert.deepEqual(collector.elementsForCase('TC-001'), []);
  });
});
