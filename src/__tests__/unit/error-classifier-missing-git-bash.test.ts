/**
 * Unit tests for the Windows missing-shell (MISSING_GIT_BASH) classification.
 *
 * Regression背景: Windows 打包版用户未装 Git for Windows 时，SDK 内嵌 CLI 启动即
 * 退出（exit 1），致命原因只打在 stderr 上；SDK 抛出的 Error 不带 stderr 属性，
 * 分类器只看到 "exited with code 1"，落入 PROCESS_CRASH——弹窗指向 API Key，
 * 真实案例中误导排查两周。修复后：spawn 点缓冲 stderr 兜底传入 classifyError，
 * 且 MISSING_GIT_BASH 规则置于最前（"Git Bash was not found" 含 'not found'
 * 子串，否则会被 CLI_NOT_FOUND 抢先吞掉）。
 *
 * Run with: npx tsx --test src/__tests__/unit/error-classifier-missing-git-bash.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyError } from '../../lib/error-classifier';

// 与内置 SDK 二进制中的实际文案一致（grep 自 @anthropic-ai/claude-agent-sdk）
const FATAL_EITHER =
  'Claude Code on Windows requires either Git for Windows (for bash) or PowerShell. Install one of:\n' +
  ' - Git for Windows: https://git-scm.com/downloads/win\n' +
  ' - PowerShell: https://aka.ms/powershell';
const FATAL_SHELL_TOOL =
  'Claude Code on Windows requires a shell tool. Git Bash was not found and the PowerShell tool is disabled (CLAUDE_CODE_USE_POWERSHELL_TOOL=0).';
const NONFATAL_WARNING = 'Git Bash not found; BashTool will be unavailable';

const exitCode1 = () => new Error('Claude Code process exited with code 1');

describe('MISSING_GIT_BASH — fatal Windows shell errors from buffered stderr', () => {
  it('classifies "requires either Git for Windows" stderr (the real-world case)', () => {
    const result = classifyError({ error: exitCode1(), stderr: FATAL_EITHER });
    assert.equal(result.category, 'MISSING_GIT_BASH');
    // 文案必须直说与 API Key 无关，杜绝 PROCESS_CRASH 式误导
    assert.ok(result.userMessage.includes('Git for Windows'));
    assert.ok(result.userMessage.includes('无关'));
    assert.ok(result.userMessage.includes('API Key'));
    assert.ok(result.actionHint.includes('git-scm.com'));
    assert.ok(result.actionHint.includes('设置'), 'actionHint 应指向应用内安装向导');
    assert.equal(result.retryable, false);
  });

  it('classifies the "requires a shell tool. Git Bash was not found …" variant', () => {
    const result = classifyError({ error: exitCode1(), stderr: FATAL_SHELL_TOOL });
    assert.equal(result.category, 'MISSING_GIT_BASH');
  });

  it('is NOT swallowed by CLI_NOT_FOUND despite the "not found" substring', () => {
    // "Git Bash was not found" 含 'not found'——若规则不在 CLI_NOT_FOUND 之前，
    // 会被误判成 "Claude Code CLI not found"（提示 npm install -g，同样误导）。
    const result = classifyError({
      error: exitCode1(),
      stderr: 'Git Bash was not found. Install Git for Windows (https://git-scm.com/downloads/win), or add bash to PATH.',
    });
    assert.equal(result.category, 'MISSING_GIT_BASH');
  });

  it('also matches when the message (not stderr) carries the fatal text', () => {
    const result = classifyError({
      error: new Error(`Claude Code process exited with code 1: ${FATAL_EITHER}`),
    });
    assert.equal(result.category, 'MISSING_GIT_BASH');
  });

  it('provides recovery actions: git-scm download link + in-app CLI settings', () => {
    const result = classifyError({ error: exitCode1(), stderr: FATAL_EITHER });
    const urls = (result.recoveryActions ?? []).map(a => a.url);
    assert.ok(urls.some(u => u && u.includes('git-scm.com')), '应有 Git for Windows 下载链接');
    assert.ok(urls.includes('/settings#cli'), '应深链到设置 → Claude CLI（安装向导入口）');
  });
});

describe('MISSING_GIT_BASH — must not misfire', () => {
  it('exit code 1 with NO stderr still falls back to PROCESS_CRASH', () => {
    const result = classifyError({ error: exitCode1() });
    assert.equal(result.category, 'PROCESS_CRASH');
  });

  it('real spawn-ENOENT errors still classify as CLI_NOT_FOUND', () => {
    const err = new Error('spawn claude ENOENT') as NodeJS.ErrnoException;
    err.code = 'ENOENT';
    const result = classifyError({ error: err });
    assert.equal(result.category, 'CLI_NOT_FOUND');
  });

  it('non-fatal "Git Bash not found; BashTool will be unavailable" warning does not hijack a 401', () => {
    // 无 Git 但 PowerShell 可用时会话正常运行，stderr 里只有这条降级警告；
    // 之后真实的 401 错误必须仍分类为 AUTH_REJECTED。
    const result = classifyError({
      error: new Error('API Error: 401 authentication_error'),
      stderr: NONFATAL_WARNING,
    });
    assert.equal(result.category, 'AUTH_REJECTED');
  });

  it('session-related process crashes keep the SESSION_STATE_ERROR refinement', () => {
    const result = classifyError({
      error: exitCode1(),
      stderr: 'Error: stale sdk_session detected, cannot resume conversation',
    });
    assert.equal(result.category, 'SESSION_STATE_ERROR');
  });
});
