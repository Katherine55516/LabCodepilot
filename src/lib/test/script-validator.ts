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
  if (!source.trim()) errors.push('empty script');
  if (Buffer.byteLength(source, 'utf-8') > 64 * 1024) errors.push('script exceeds 64KB');
  if (!/from\s+["']playwright\/test["']/.test(source)) errors.push('script must import from playwright/test');
  if (FORBIDDEN_IMPORT.test(source)) errors.push('forbidden Node.js module import');
  for (const match of source.matchAll(MODULE_REFERENCE)) {
    if (match[1] !== 'playwright/test') errors.push(`module import is not allowed: ${match[1]}`);
  }
  if (/\b(?:eval|Function|fetch)\s*\(/.test(source)) errors.push('dynamic code or direct network access is forbidden');
  if (/(?:["'`])https?:\/\//i.test(source)) errors.push('absolute network URL is forbidden');
  for (const match of source.matchAll(/\bprocess\.env\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
    if (!ALLOWED_ENV.has(match[1])) errors.push(`environment variable is not allowed: ${match[1]}`);
  }
  if (SECRET_PATTERN.test(source)) errors.push('script appears to contain a secret');
  if (ABSOLUTE_PATH.test(source)) errors.push('script contains an absolute user path');
  if (/\btest\s*\.\s*(?:only|skip|fixme)\s*\(/.test(source)) errors.push('test.only/skip/fixme is forbidden');
  if (!/\btest\s*\(/.test(source)) errors.push('script must contain one test()');
  if ((source.match(/\btest\s*\(/g) ?? []).length !== 1) errors.push('script must contain exactly one test()');
  if (!/\bexpect\s*\(/.test(source)) errors.push('script must contain at least one expect()');
  const testTitle = /\btest\s*\(\s*(["'`])([^\r\n]*?)\1/.exec(source)?.[2] ?? '';
  if (!testTitle.includes(expectedCaseId)) errors.push('script title must contain the case id');
  if (/\bref\s*[:=]\s*["']e\d+/i.test(source)) errors.push('ephemeral MCP ref is forbidden');

  if (/\.locator\(\s*["']\s*(?:\/\/|xpath=|\/html|html\s*>)/i.test(source)) warnings.push('xpath/absolute selector requires review');
  if (/\.nth\s*\(/.test(source)) warnings.push('nth locator requires review');
  if (/\.waitForTimeout\s*\(/.test(source)) warnings.push('fixed timeout requires review');
  if (!/getBy(?:TestId|Role|Label|Text|Placeholder)\s*\(/.test(source)) warnings.push('no semantic locator found');

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

export function isSafeForAutomaticReplay(testCase: Record<string, unknown>): boolean {
  const cleanup = typeof testCase.cleanup === 'string' ? testCase.cleanup.trim() : '';
  if (cleanup) return true;
  const text = JSON.stringify(testCase);
  return !/(新建|创建|删除|提交|保存|发布|支付|下单|修改|更新|上传|导入|绑定|解绑|create|delete|submit|save|publish|payment|upload|update)/i.test(text);
}
