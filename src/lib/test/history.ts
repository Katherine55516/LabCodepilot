/**
 * run.json 历史快照（报告多版本对比的数据基础）。
 *
 * 执行步归约后，除写覆盖式的 latest `report/{task}/{task}-{env}.run.json` 外，
 * 再存一份带时间戳的快照到 `report/{task}/.history/`，SHA-1 去重（内容与最新
 * 快照相同则跳过）。移植自 ai-lab-test-framework app/src/main/engine/history.js
 * （适配 LabCodepilot 的 report/{task} 布局，按 {task}-{env} 分系列）。
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { RunCounts } from './reduce';

const sha1 = (s: string) => crypto.createHash('sha1').update(s, 'utf-8').digest('hex');

/** 本地时间 YYYYMMDD-HHmmss-SSS（字典序 = 时间序；毫秒避免同秒不同内容同名）。 */
export function stampNow(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${ms}`;
}

function historyDir(reportTaskDir: string) {
  return path.join(reportTaskDir, '.history');
}
function seriesPrefix(taskName: string, env: string) {
  return `${taskName}-${env}-`;
}

export interface RunHistoryEntry {
  file: string;
  stamp: string;
  time: string;
  status: string;
  passStr: string;
  funcPassStr: string;
  counts: RunCounts;
  funcCounts: RunCounts;
  tests: Array<{ id: string; status: string }>;
}

const EMPTY_COUNTS: RunCounts = { total: 0, pass: 0, fail: 0, partial: 0, blocked: 0 };

/**
 * 存一份 run.json 历史快照（SHA-1 去重）。
 * @param reportTaskDir `{projectPath}/AI_LabTest/report/{task}`
 * @returns snapshot=新快照文件名（null=未写）；skipped=与最新快照相同被跳过
 */
export function snapshotRunJson(opts: {
  reportTaskDir: string;
  taskName: string;
  env: string;
  content: string;
  stamp?: string;
}): { snapshot: string | null; skipped: boolean } {
  try {
    if (!opts.content.trim()) return { snapshot: null, skipped: false };
    const dir = historyDir(opts.reportTaskDir);
    fs.mkdirSync(dir, { recursive: true });
    const prefix = seriesPrefix(opts.taskName, opts.env);
    const existing = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith(prefix) && f.endsWith('.run.json'))
      .sort();
    const prev = existing.length ? path.join(dir, existing[existing.length - 1]) : null;
    if (prev) {
      try {
        if (sha1(fs.readFileSync(prev, 'utf-8')) === sha1(opts.content)) {
          return { snapshot: null, skipped: true };
        }
      } catch {
        /* unreadable prev → fall through and write a fresh snapshot */
      }
    }
    const fileName = `${prefix}${opts.stamp || stampNow()}.run.json`;
    fs.writeFileSync(path.join(dir, fileName), opts.content, 'utf-8');
    return { snapshot: fileName, skipped: false };
  } catch {
    return { snapshot: null, skipped: false };
  }
}

/** 列某任务某环境的历史快照（最新在前），含 diff 所需摘要。 */
export function listRunHistory(reportTaskDir: string, taskName: string, env: string): RunHistoryEntry[] {
  const dir = historyDir(reportTaskDir);
  const prefix = seriesPrefix(taskName, env);
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith('.run.json'));
  } catch {
    return [];
  }
  const out: RunHistoryEntry[] = [];
  for (const f of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')) as Record<string, unknown>;
      const counts = (raw.counts as RunCounts) ?? EMPTY_COUNTS;
      out.push({
        file: f,
        stamp: f.slice(prefix.length, -'.run.json'.length),
        time: typeof raw.time === 'string' ? raw.time : '',
        status: typeof raw.status === 'string' ? raw.status : '',
        passStr: typeof raw.passStr === 'string' ? raw.passStr : '',
        funcPassStr: typeof raw.funcPassStr === 'string' ? raw.funcPassStr : '',
        counts,
        funcCounts: (raw.funcCounts as RunCounts) ?? counts,
        tests: Array.isArray(raw.tests)
          ? (raw.tests as Array<Record<string, unknown>>).map((t) => ({ id: String(t.id ?? ''), status: String(t.status ?? '') }))
          : [],
      });
    } catch {
      /* skip malformed snapshot */
    }
  }
  return out.sort((a, b) => b.stamp.localeCompare(a.stamp)); // newest first
}
