import ts from 'typescript';

export interface StaticScriptValidation {
  ok: boolean;
  needsReview: boolean;
  warnings: string[];
  errors: string[];
}

const FORBIDDEN_IMPORT = /(?:^|["'])(?:node:)?(?:child_process|fs|fs\/promises|net|dgram|worker_threads|cluster|vm)(?:["']|\/)/i;
const SECRET_PATTERN = /(?:sk-ant-|sk-[A-Za-z0-9_-]{16,}|bearer\s+[A-Za-z0-9._-]{16,}|-----BEGIN (?:RSA |EC )?PRIVATE KEY-----)/i;
const ABSOLUTE_PATH = /(?:["'`](?:\/[Uu]sers\/|\/[Hh]ome\/|[A-Za-z]:\\Users\\))/;
const MODULE_REFERENCE = /(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*)["']([^"']+)["']/g;
const ALLOWED_ENV = new Set(['BASE_URL', 'TEST_USERNAME', 'TEST_PASSWORD']);

export function validateScriptSource(source: string, expectedCaseId: string): StaticScriptValidation {
  const warnings: string[] = [];
  const errors: string[] = [];
  if (!source.trim()) errors.push('脚本内容为空');
  if (Buffer.byteLength(source, 'utf-8') > 64 * 1024) errors.push('脚本超过 64KB 大小上限');
  if (!/from\s+["']playwright\/test["']/.test(source)) errors.push('脚本必须 import { test, expect } from "playwright/test"');
  if (FORBIDDEN_IMPORT.test(source)) errors.push('禁止 import Node.js 系统模块（fs/child_process 等）');
  for (const match of source.matchAll(MODULE_REFERENCE)) {
    if (match[1] !== 'playwright/test') errors.push(`不允许 import 该模块: ${match[1]}`);
  }
  if (/\b(?:eval|Function|fetch)\s*\(/.test(source)) errors.push('禁止动态代码执行或直连网络（eval/Function/fetch）');
  if (/(?:["'`])https?:\/\//i.test(source)) errors.push('禁止硬编码绝对网络地址，应使用相对 URL 或 BASE_URL');
  for (const match of source.matchAll(/\bprocess\.env\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
    if (!ALLOWED_ENV.has(match[1])) errors.push(`不允许读取该环境变量: ${match[1]}`);
  }
  if (SECRET_PATTERN.test(source)) errors.push('脚本疑似包含密钥/凭证，禁止写入真实秘密');
  if (ABSOLUTE_PATH.test(source)) errors.push('脚本包含本机绝对路径');
  if (/\btest\s*\.\s*(?:only|skip|fixme)\s*\(/.test(source)) errors.push('禁止使用 test.only/skip/fixme');
  if (!/\btest\s*\(/.test(source)) errors.push('脚本必须包含 test()');
  if ((source.match(/\btest\s*\(/g) ?? []).length !== 1) errors.push('每个脚本必须恰好一个 test()');
  if (!/\bexpect\s*\(/.test(source)) errors.push('脚本至少要有一个 expect() 断言');
  const testTitle = /\btest\s*\(\s*(["'`])([^\r\n]*?)\1/.exec(source)?.[2] ?? '';
  if (!testTitle.includes(expectedCaseId)) errors.push('test 标题必须包含用例 ID');
  if (/\bref\s*[:=]\s*["']e\d+/i.test(source)) errors.push('禁止使用临时 MCP ref 定位（e12 之类不可重放）');

  if (/\.locator\(\s*["']\s*(?:\/\/|xpath=|\/html|html\s*>)/i.test(source)) warnings.push('使用了 xpath/绝对选择器，需人工复核');
  if (/\.nth\s*\(/.test(source)) warnings.push('使用了 nth 序号定位，需人工复核');
  if (/\.waitForTimeout\s*\(/.test(source)) warnings.push('使用了固定等待 waitForTimeout，需人工复核');
  if (!/getBy(?:TestId|Role|Label|Text|Placeholder)\s*\(/.test(source)) warnings.push('未使用语义化定位器（getByTestId/Role/Label 等）');

  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
    },
    fileName: `${expectedCaseId}.spec.ts`,
    reportDiagnostics: true,
  });
  for (const diagnostic of transpiled.diagnostics ?? []) {
    if (diagnostic.category !== ts.DiagnosticCategory.Error) continue;
    errors.push(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
  }

  return { ok: errors.length === 0, needsReview: warnings.length > 0, warnings, errors };
}

const MUTATION_VERB = /(新建|创建|删除|提交|保存|发布|支付|下单|修改|更新|上传|导入|绑定|解绑|create|delete|submit|save|publish|payment|upload|update)/i;

/**
 * The text of what the case *does*, i.e. its action steps — not what it expects
 * to see. Returns null when the case has no structured steps, so the caller can
 * fall back to scanning everything.
 */
function actionText(testCase: Record<string, unknown>): string | null {
  const steps = testCase.steps;
  if (!Array.isArray(steps)) return null;
  const parts = steps.map((step) => {
    if (typeof step === 'string') return step;
    if (step && typeof step === 'object') {
      const content = (step as { content?: unknown }).content;
      if (typeof content === 'string') return content;
    }
    return '';
  });
  return parts.join('\n');
}

/**
 * Whether the generated script may be replayed unattended right after generation.
 *
 * Only the case's ACTIONS are scanned for mutation verbs. Scanning the whole
 * JSON (the original behaviour) misread UI element names quoted in `expected` /
 * `purpose` as writes: a read-only case that merely asserts a button labelled
 * 「+ 新建学科」 is visible was permanently barred from automatic verification.
 * A case that declares `cleanup` is replayable regardless — it says how to undo
 * itself. Cases without structured steps stay conservative and scan everything.
 */
export function isSafeForAutomaticReplay(testCase: Record<string, unknown>): boolean {
  const cleanup = typeof testCase.cleanup === 'string' ? testCase.cleanup.trim() : '';
  if (cleanup) return true;
  const actions = actionText(testCase);
  return !MUTATION_VERB.test(actions ?? JSON.stringify(testCase));
}
