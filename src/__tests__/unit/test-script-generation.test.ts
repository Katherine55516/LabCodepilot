import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { manifestCounts, scriptFileName } from '../../lib/test/script-artifacts';
import { retargetLibraryCandidates, selectEligibleCases } from '../../lib/test/script-generator';
import { ScriptTraceCollector, extractPlaywrightCode, redactTraceText } from '../../lib/test/script-trace';
import { artifactPaths } from '../../lib/test/prompts';
import { validateScriptSource } from '../../lib/test/script-validator';
import { resolveScriptPlaywrightRuntime, runGeneratedScript } from '../../lib/test/script-runner';
import { safeRmRecursive } from '../../lib/claude-home-shadow';
import type { RunJson } from '../../lib/test/reduce';

function run(tests: RunJson['tests'], circuitBroken = false): RunJson {
  const counts = {
    total: tests.length,
    pass: tests.filter((item) => item.status === 'pass').length,
    fail: tests.filter((item) => item.status === 'fail').length,
    partial: tests.filter((item) => item.status === 'partial').length,
    blocked: tests.filter((item) => item.status === 'blocked').length,
  };
  return {
    module: 'task', env: 'local', time: '2026-01-01T00:00:00.000Z', status: 'done',
    counts, passStr: `${counts.pass}/${counts.total}`, funcCounts: counts,
    funcPassStr: `${counts.pass}/${counts.total}`, regressionTotal: 0, circuitBroken, tests,
  };
}

const result = (id: string, status: 'pass' | 'fail' | 'partial' | 'blocked') => ({
  id, status, actual: '', error: '', evidence: [],
});

describe('ScriptTraceCollector', () => {
  it('pairs browser tool results with the active case and handles split markers', () => {
    const collector = new ScriptTraceCollector(Date.now() - 10);
    collector.feedText('@@CASE_STA');
    collector.feedText('RT {"id":"TC-001","index":1}\n');
    collector.feedToolUse({ id: 'tool-1', name: 'browser_click' });
    collector.feedToolResult({
      tool_use_id: 'tool-1',
      content: '### Ran Playwright code\n```js\nawait page.getByRole("button", { name: "Save" }).click();\n```',
    });
    collector.feedText('@@RESULT {"id":"TC-001","status":"pass"}\n@@CASE_START {"id":"TC-002","index":2}\n');
    collector.feedToolUse({ id: 'tool-2', name: 'browser_snapshot' });
    collector.feedToolResult({ tool_use_id: 'tool-2', content: 'snapshot' });
    assert.deepEqual(collector.finish().map((item) => [item.caseId, item.sequence, item.toolName]), [
      ['TC-001', 1, 'browser_click'],
      ['TC-002', 1, 'browser_snapshot'],
    ]);
  });

  it('does not reprocess an old result after a later case starts', () => {
    const collector = new ScriptTraceCollector(Date.now());
    collector.feedText('@@CASE_START {"id":"A"}\n@@RESULT {"id":"A"}\n');
    collector.feedText('@@CASE_START {"id":"B"}\n');
    collector.feedToolUse({ id: 'b', name: 'browser_click' });
    collector.feedToolResult({ tool_use_id: 'b', content: 'ok' });
    assert.equal(collector.finish()[0]?.caseId, 'B');
  });

  it('extracts Playwright code and redacts explicit and patterned secrets', () => {
    assert.equal(extractPlaywrightCode('### Ran Playwright code\n```ts\nawait page.goto("/");\n```'), 'await page.goto("/");');
    const clean = redactTraceText('password="hunter2" token=abc&api_key=xyz', [
      { value: 'hunter2', replacement: '${TEST_PASSWORD}' },
    ]);
    assert.equal(clean.includes('hunter2'), false);
    assert.equal(clean.includes('api_key=xyz'), false);
  });
});

describe('eligible regression script selection', () => {
  const cases = { cases: [
    { id: 'REG-PASS', tags: ['回归测试'], purpose: 'regression pass' },
    { id: 'REG-FAIL', tags: ['回归测试'], purpose: 'regression fail' },
    { id: 'SMOKE-PASS', tags: ['冒烟测试'], purpose: 'smoke only' },
  ] };

  it('selects only exact-tag passed regression cases and makes stable fingerprints', () => {
    const execution = run([result('REG-PASS', 'pass'), result('REG-FAIL', 'fail'), result('SMOKE-PASS', 'pass')]);
    const actions = [{ caseId: 'REG-PASS', sequence: 1, toolName: 'browser_click', success: true, usesMock: false, timestampOffsetMs: 5 }];
    const a = selectEligibleCases(cases, execution, actions, '1.61');
    const b = selectEligibleCases(cases, execution, [{ ...actions[0], timestampOffsetMs: 99 }], '1.61');
    assert.deepEqual(a.eligible.map((item) => item.id), ['REG-PASS']);
    assert.equal(a.eligible[0].fingerprint, b.eligible[0].fingerprint, 'timing must not rewrite scripts');
    assert.deepEqual(a.staleIds.sort(), ['REG-FAIL', 'SMOKE-PASS']);
  });

  it('changes the fingerprint when replay semantics or runtime changes', () => {
    const execution = run([result('REG-PASS', 'pass')]);
    const base = [{ caseId: 'REG-PASS', sequence: 1, toolName: 'browser_click', playwrightCode: 'await page.click("a")', success: true, usesMock: false, timestampOffsetMs: 1 }];
    const a = selectEligibleCases(cases, execution, base, '1.61').eligible[0];
    const b = selectEligibleCases(cases, execution, [{ ...base[0], playwrightCode: 'await page.click("b")' }], '1.61').eligible[0];
    const c = selectEligibleCases(cases, execution, base, '1.62').eligible[0];
    assert.notEqual(a.fingerprint, b.fingerprint);
    assert.notEqual(a.fingerprint, c.fingerprint);
  });

  it('blocks the whole selection when the execution circuit breaker fired', () => {
    const selected = selectEligibleCases(cases, run([result('REG-PASS', 'pass')], true), [], '1.61');
    assert.equal(selected.blockedReason, 'circuit_broken');
    assert.equal(selected.eligible.length, 0);
  });

  it('retargets synthetic regression-library IDs to one source-owned script', () => {
    const aggregateCases = { cases: [{ id: '任务乙::TC-001', tags: ['回归测试'], purpose: 'source case' }] };
    const aggregateActions = [{ caseId: '任务乙::TC-001', sequence: 1, toolName: 'browser_click', success: true, usesMock: false, timestampOffsetMs: 1 }];
    const aggregate = selectEligibleCases(
      aggregateCases,
      run([result('任务乙::TC-001', 'pass')]),
      aggregateActions,
      '1.61',
    ).eligible;
    const retargeted = retargetLibraryCandidates(aggregate, {
      '任务乙::TC-001': { task: '任务乙', originalId: 'TC-001' },
    }, '1.61');
    assert.equal(retargeted[0].id, '任务乙::TC-001', 'aggregate run id remains the retry/manifest key');
    assert.equal(retargeted[0].scriptCaseId, 'TC-001');
    assert.equal(retargeted[0].targetTaskName, '任务乙');
    assert.equal(retargeted[0].fileName, 'TC-001.spec.ts');

    const source = selectEligibleCases(
      { cases: [{ id: 'TC-001', tags: ['回归测试'], purpose: 'source case' }] },
      run([result('TC-001', 'pass')]),
      [{ ...aggregateActions[0], caseId: 'TC-001' }],
      '1.61',
    ).eligible[0];
    assert.equal(retargeted[0].fingerprint, source.fingerprint, 'aggregate execution must reuse a semantically identical source script');
  });
});

describe('script artifact and static security contract', () => {
  const valid = `import { test, expect } from 'playwright/test';
test('TC-001 saves', async ({ page }) => {
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved')).toBeVisible();
});`;

  it('accepts one isolated Playwright test and rejects dangerous generated code', () => {
    assert.equal(validateScriptSource(valid, 'TC-001').ok, true);
    assert.equal(validateScriptSource(valid + '\nrequire("fs").readFileSync("/tmp/x")', 'TC-001').ok, false);
    assert.equal(validateScriptSource(valid.replace("page.goto('/settings')", "fetch('https://evil.example')"), 'TC-001').ok, false);
    assert.equal(validateScriptSource(valid.replace("test('TC-001 saves'", "test('unrelated'"), 'TC-001').ok, false);
  });

  it('normalizes unsafe case ids and counts manifest states deterministically', () => {
    const file = scriptFileName('../../ TC/001 ');
    assert.equal(file.includes('/'), false);
    assert.match(file, /\.spec\.ts$/);
    const counts = manifestCounts([
      { caseId: 'A', file: 'A.spec.ts', fingerprint: 'a', status: 'verified', usesMock: false },
      { caseId: 'B', file: 'B.spec.ts', fingerprint: 'b', status: 'needs_review', usesMock: false },
      { caseId: 'C', file: 'C.spec.ts', fingerprint: 'c', status: 'failed', usesMock: false },
    ], 3);
    assert.deepEqual(counts, { eligible: 3, generated: 2, verified: 1, needsReview: 1, failed: 1 });
  });
});

describe('bundled Playwright runner POC', () => {
  it('resolves the MCP-matched runtime and collects a generated script', async () => {
    const runtime = resolveScriptPlaywrightRuntime();
    assert.ok(fs.existsSync(runtime.cli));
    assert.notEqual(runtime.version, 'unknown');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'script-runner-poc-'));
    const file = path.join(dir, 'TC-POC.spec.ts');
    fs.writeFileSync(file, `import { test, expect } from 'playwright/test';\n` +
      `test('TC-POC collection', async ({ page }) => { await expect(page).toHaveURL(/.*/); });\n`);
    try {
      const collected = await runGeneratedScript({ scriptFile: file, collectOnly: true, timeoutMs: 30_000 });
      assert.equal(collected.ok, true, collected.output);
      assert.match(collected.output, /TC-POC collection/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('回归轮次的脚本生成:run.json 路径必须带 roundId', () => {
  // v2 起回归执行的产物落 report/{task}/{roundId}/。script-job-manager 原来读 artifactPaths(task, env)
  // 的平铺路径 → ENOENT,回归轮次的脚本生成从来没成功过(审计里那条 generate-scripts 失败)。
  it('不传 roundId → 平铺路径;传 roundId → 轮次子目录', () => {
    const flat = artifactPaths('回归用例库', 'local').runJson;
    const round = artifactPaths('回归用例库', 'local', 'RND-20260710-2116').runJson;
    assert.equal(flat, 'AI_LabTest/report/回归用例库/回归用例库-local.run.json');
    assert.equal(round, 'AI_LabTest/report/回归用例库/RND-20260710-2116/回归用例库-local.run.json');
    assert.notEqual(flat, round);
  });

  it('cases.json 与轮次无关(聚合输入共享最新一份),不得被 roundId 改写', () => {
    assert.equal(
      artifactPaths('回归用例库', 'local', 'RND-20260710-2116').cases,
      artifactPaths('回归用例库', 'local').cases,
    );
  });

  it('普通任务不传 roundId,路径与 v1 完全相同', () => {
    assert.equal(artifactPaths('员工信息', 'local').runJson, 'AI_LabTest/report/员工信息/员工信息-local.run.json');
  });
});

/**
 * 回归:Windows 上「运行所选 / 运行全部 / 回归脚本自动跑通」曾把安装包内的 Playwright
 * 运行时删掉 —— runGeneratedScript 在临时目录建 node_modules/playwright 指向【包内】真实
 * 的 @playwright/mcp/node_modules/playwright(Windows 用 junction)，跑完 fs.rmSync(dir,
 * {recursive:true}) 清理时，Node 的递归删除在 Windows 上会穿过 junction 删掉目标里的真实
 * 文件。表现:首次运行即自毁，之后永远报「未找到 @playwright/mcp 自带的 Playwright 运行时」;
 * 删到一半被占用中止则残留成 cli.js 还在、lib/ 已空，报「缺失 './lib/program' 模块」。
 * macOS 用 'dir' symlink 只删链接本身，故完全不受影响 —— 单测也复现不出平台差异，
 * 因此这里用源码守卫锁住实现方式。
 */
describe('script-runner 清理不得穿透链接（Windows junction 数据丢失回归）', () => {
  it('source guard: 清理必须走 safeRmRecursive，不得 fs.rmSync(dir, {recursive:true})', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src/lib/test/script-runner.ts'), 'utf-8');
    // 只扫真实代码行 —— 注释里正写着「绝不能用 fs.rmSync(dir, {recursive:true})」，
    // 连注释一起扫会把这句说明当成违规命中（本测试第一版就栽在这里）。
    const code = src
      .split('\n')
      .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*') && !line.trim().startsWith('/*'))
      .join('\n');
    assert.ok(!/fs\.rmSync\(\s*dir\s*,\s*\{[^}]*recursive:\s*true/.test(code),
      'script-runner 不得对 runner 目录用 fs.rmSync(recursive) —— 在 Windows 上会穿过 junction 删掉安装包内的 playwright 运行时');
    assert.match(code, /safeRmRecursive\(dir\)/,
      '清理必须使用 safeRmRecursive()，它 lstat 每个节点、只摘链接不递归进目标');
  });

  it('safeRmRecursive 摘掉链接但保留目标内容（cli.js + lib/ 完好）', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-cleanup-'));
    try {
      // 模拟安装包内的真实 playwright 包
      const pkg = path.join(base, 'packaged-playwright');
      fs.mkdirSync(path.join(pkg, 'lib'), { recursive: true });
      fs.writeFileSync(path.join(pkg, 'cli.js'), "require('./lib/program')");
      fs.writeFileSync(path.join(pkg, 'lib', 'program.js'), 'module.exports={}');

      // 模拟 runner 临时目录:node_modules/playwright 链接到包内运行时
      const runner = path.join(base, 'runner');
      fs.mkdirSync(path.join(runner, 'node_modules'), { recursive: true });
      fs.symlinkSync(pkg, path.join(runner, 'node_modules', 'playwright'),
        process.platform === 'win32' ? 'junction' : 'dir');
      fs.writeFileSync(path.join(runner, 'spec.js'), 'test');

      safeRmRecursive(runner);

      assert.ok(!fs.existsSync(runner), '临时目录必须被清理');
      assert.ok(fs.existsSync(path.join(pkg, 'cli.js')), '链接目标的 cli.js 必须存活');
      assert.ok(fs.existsSync(path.join(pkg, 'lib', 'program.js')), "链接目标的 lib/program.js 必须存活（否则报「缺失 './lib/program'」）");
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});
