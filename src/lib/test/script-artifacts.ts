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
