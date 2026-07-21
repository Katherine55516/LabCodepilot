import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { isUnsafeSegment } from './path-safety';

export const SCRIPT_MANIFEST_VERSION = 1 as const;
export const SCRIPT_GENERATOR_VERSION = '1';
export const SCRIPT_TEMPLATE_VERSION = '1';

export type ScriptJobStatus = 'queued' | 'running' | 'done' | 'partial' | 'error' | 'stale';
export type ScriptCaseStatus = 'verified' | 'needs_review' | 'failed' | 'stale' | 'outdated';

export interface ScriptValidationSummary {
  syntax: boolean;
  collected: boolean;
  replayed: boolean;
  warnings: string[];
  error?: string;
}

export interface ScriptManifestCase {
  caseId: string;
  file: string;
  /** Synthetic regression-library runs store the file under its real source task. */
  sourceTask?: string;
  sourceCaseId?: string;
  fingerprint: string;
  status: ScriptCaseStatus;
  usesMock: boolean;
  generatedAt?: string;
  lastVerifiedAt?: string;
  lastSeenRunHash?: string;
  validation?: ScriptValidationSummary;
  error?: string;
  /**
   * Why the last manual run failed (redacted Playwright output tail), and when.
   * A failed run does NOT demote `status`: the script may be sound and the app
   * under test simply down. Persisting it here is what lets the report card show
   * the reason instead of leaving the user with a card that never changes.
   */
  lastRunError?: string;
  lastRunAt?: string;
  /**
   * Outcome of the last AI repair attempt, phrased for testers who don't code:
   * what was fixed, or why the failure is NOT a script defect (e.g. the page's
   * real behaviour contradicts the case's expected result) and needs a human.
   */
  repairNote?: string;
  /**
   * 人工确认通过的时刻（仅 usesMock 脚本需要）。
   *
   * 存在的理由：执行时用了 `browser_route` 模拟接口的脚本，重放通过也不代表真实环境可通过，
   * 故 `runScriptCases` 刻意不把它提升为 verified。但此前平台只留下一句「需人工确认真实
   * 环境可通过」的警告、**却没有任何地方能记录确认结果** —— 状态被永久钉死在 needs_review，
   * 和真正待修的脚本混在一起，反而稀释了「待复核」这个信号。此字段就是那个出口。
   *
   * 刻意保留 `usesMock: true` 与那条 mock 警告：确认的是「我看过、认可它」，不是「它没用过
   * mock」，事实不该被抹掉。回归重放的资格判定同样继续排除 mock 脚本（见 script-regression
   * 五道闸），人工确认解决的是状态卡死，不顺带放开自动重放。
   */
  manualVerifiedAt?: string;
  /**
   * 用例体语义指纹(library.ts caseFingerprint 同口径:排除 id/tags/_source/_lib)。
   * 回归轮次「脚本重放」用它防错配:库里被编辑过(rev 升)的用例不能拿旧脚本重放出
   * 错误结论。存量条目缺失时宽限放行(下轮生成自然补齐)。
   */
  caseBodyHash?: string;
  /**
   * 回归轮次脚本重放的【连续】失败次数(pass 清零;环境类失败不计)。≥2 时错误信息
   * 附带治理建议(去脚本面板 AI 修复/重试生成,或关闭「优先脚本重放」走 AI 对照)。
   */
  consecutiveRunFailures?: number;
}

export interface ScriptManifest {
  version: typeof SCRIPT_MANIFEST_VERSION;
  taskName: string;
  env: string;
  latestRunHash: string;
  jobKey: string;
  jobStatus: ScriptJobStatus;
  generatorVersion: string;
  templateVersion: string;
  runtimeVersion: string;
  createdAt: string;
  updatedAt: string;
  counts: {
    eligible: number;
    generated: number;
    verified: number;
    needsReview: number;
    failed: number;
  };
  cases: ScriptManifestCase[];
  error?: string;
}

export function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf-8').digest('hex');
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`).join(',')}}`;
}

function assertSegments(taskName: string, env: string): void {
  if (isUnsafeSegment(taskName)) throw new Error('invalid taskName');
  if (isUnsafeSegment(env)) throw new Error('invalid env');
}

export function scriptsDir(projectPath: string, taskName: string, env: string): string {
  assertSegments(taskName, env);
  return path.join(projectPath, 'AI_LabTest', 'scripts', taskName, env);
}

export function manifestFile(projectPath: string, taskName: string, env: string): string {
  return path.join(scriptsDir(projectPath, taskName, env), 'manifest.json');
}

export function traceFile(projectPath: string, taskName: string, env: string): string {
  assertSegments(taskName, env);
  return path.join(projectPath, 'AI_LabTest', 'report', taskName, '.data', `${taskName}-${env}.trace.jsonl`);
}

export function jobKey(projectPath: string, taskName: string, env: string, runHash: string): string {
  let project = path.resolve(projectPath);
  try { project = fs.realpathSync(project); } catch { /* keep resolved path */ }
  return sha256Hex(`${project}\0${taskName}\0${env}\0${runHash}`);
}

/** Safe, deterministic filename. If normalization changed the id, append a short hash. */
export function scriptFileName(caseId: string): string {
  const normalized = caseId.normalize('NFKC').trim();
  const stem = normalized
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 72) || 'case';
  const changed = stem !== normalized || stem.length !== normalized.length;
  return `${stem}${changed ? `-${sha256Hex(normalized).slice(0, 8)}` : ''}.spec.ts`;
}

export function scriptFile(projectPath: string, taskName: string, env: string, caseId: string): string {
  return path.join(scriptsDir(projectPath, taskName, env), scriptFileName(caseId));
}

export function atomicWriteText(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmp, content, 'utf-8');
    fs.renameSync(tmp, file);
  } finally {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch { /* best effort */ }
  }
}

export function readManifest(projectPath: string, taskName: string, env: string): ScriptManifest | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestFile(projectPath, taskName, env), 'utf-8')) as ScriptManifest;
    if (parsed?.version !== SCRIPT_MANIFEST_VERSION || !Array.isArray(parsed.cases)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeManifest(projectPath: string, taskName: string, env: string, manifest: ScriptManifest): void {
  const updated: ScriptManifest = { ...manifest, updatedAt: new Date().toISOString() };
  atomicWriteText(manifestFile(projectPath, taskName, env), JSON.stringify(updated, null, 2));
}

export function manifestCounts(cases: ScriptManifestCase[], eligible: number): ScriptManifest['counts'] {
  return {
    eligible,
    generated: cases.filter((c) => c.status !== 'failed' && c.status !== 'stale').length,
    verified: cases.filter((c) => c.status === 'verified').length,
    needsReview: cases.filter((c) => c.status === 'needs_review' || c.status === 'outdated').length,
    failed: cases.filter((c) => c.status === 'failed').length,
  };
}
