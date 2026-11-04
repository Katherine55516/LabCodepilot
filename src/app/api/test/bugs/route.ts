import fs from 'fs';
import path from 'path';
import { artifactPaths } from '@/lib/test/prompts';
import { isUnsafeSegment } from '@/lib/test/path-safety';
import { sha1Hex } from '@/lib/test/history';
import {
  parseMdBugInfo,
  deriveBugs,
  mergeBugOverrides,
  upsertBugOverride,
  SMOKE_SEVERITIES,
} from '@/lib/test/smoke-bugs';
import type { RunJson } from '@/lib/test/reduce';
import type { SmokeBugsFile } from '@/types';

export const runtime = 'nodejs';

/**
 * 冒烟测试 · Bug 清单（可复核列表）的读 / 写。
 *
 * 数据模型（详见 lib/test/smoke-bugs.ts 模块头）：
 *  - 事实层：run.json 的 fail 场景（只读，代码归约产物）+ 报告 md 的 AI 初判（只读，
 *    best-effort 解析）→ **每次 GET 现场派生**，不落盘；
 *  - 覆盖层：人工改的 严重级别/备注 落 `report/{任务}/{任务}-{env}.bugs.json`
 *    （原子写），按 runHash 绑定执行轮 —— 重跑后旧覆盖层自动失效。
 *  - 复核动作（确认缺陷/误报/程度不符）**不在本路由**：走既有 /api/test/stats 的
 *    report_reviewed 事件（同样按 runHash 隔离），前端两路并行发。
 *
 * GET  ?projectPath&taskName&env → { ok, runHash, bugs: SmokeBug[] }
 * PUT  { projectPath, taskName, env, runHash, patch:{sceneId, severity?, note?, severityOverriddenFrom?} }
 *      → { ok, bugs }（runHash 与当前 run.json 不符 → 409，防复核态错挂轮次）
 */

function bugsFile(projectPath: string, taskName: string, env: string): string {
  const p = artifactPaths(taskName, env);
  // 与 run.json 同目录：report/{任务}/{任务}-{env}.bugs.json
  return path.join(projectPath, p.runJson.replace(/\.run\.json$/, '.bugs.json'));
}

/** 读当前执行轮的事实层：run.json 文本（算 runHash 用）+ 解析对象。缺失 → null。 */
function readRun(projectPath: string, taskName: string, env: string): { run: RunJson; runHash: string } | null {
  try {
    const raw = fs.readFileSync(path.join(projectPath, artifactPaths(taskName, env).runJson), 'utf-8');
    return { run: JSON.parse(raw) as RunJson, runHash: sha1Hex(raw) };
  } catch {
    return null;
  }
}

/** 读报告 md（AI 初判来源）；缺失 → ''（初判回退默认值）。 */
function readReportMd(projectPath: string, taskName: string, env: string): string {
  try {
    return fs.readFileSync(path.join(projectPath, artifactPaths(taskName, env).report), 'utf-8');
  } catch {
    return '';
  }
}

/** 读 cases.json 的 sceneId → 验证目标（标题兜底）；任何失败 → 空映射。 */
function readGoals(projectPath: string, taskName: string): Record<string, string> {
  try {
    const raw = fs.readFileSync(path.join(projectPath, artifactPaths(taskName).cases), 'utf-8');
    const parsed = JSON.parse(raw) as { cases?: Array<{ id?: string; purpose?: string }> };
    const out: Record<string, string> = {};
    for (const c of parsed.cases ?? []) {
      if (typeof c?.id === 'string' && typeof c?.purpose === 'string') out[c.id] = c.purpose;
    }
    return out;
  } catch {
    return {};
  }
}

/** 读覆盖层文件；缺失/损坏 → null（覆盖层是增强，不抛）。 */
function readStored(file: string): SmokeBugsFile | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as SmokeBugsFile;
  } catch {
    return null;
  }
}

function assemble(projectPath: string, taskName: string, env: string): { runHash: string; bugs: ReturnType<typeof mergeBugOverrides> } | null {
  const cur = readRun(projectPath, taskName, env);
  if (!cur) return null;
  const mdInfo = parseMdBugInfo(readReportMd(projectPath, taskName, env));
  const derived = deriveBugs(cur.run, mdInfo, readGoals(projectPath, taskName));
  const merged = mergeBugOverrides(derived, readStored(bugsFile(projectPath, taskName, env)), cur.runHash);
  return { runHash: cur.runHash, bugs: merged };
}

export async function GET(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const projectPath = url.searchParams.get('projectPath');
    const taskName = url.searchParams.get('taskName');
    const env = url.searchParams.get('env') || 'local';
    if (!projectPath || !taskName || isUnsafeSegment(taskName) || isUnsafeSegment(env)) {
      return Response.json({ error: 'projectPath, taskName required (safe segments)' }, { status: 400 });
    }
    const res = assemble(projectPath, taskName, env);
    if (!res) return Response.json({ ok: true, runHash: null, bugs: [] });
    return Response.json({ ok: true, ...res });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'bugs read failed' }, { status: 500 });
  }
}

export async function PUT(req: Request): Promise<Response> {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      projectPath?: string;
      taskName?: string;
      env?: string;
      runHash?: string;
      patch?: { sceneId?: string; severity?: string; note?: string; severityOverriddenFrom?: string };
    };
    const { projectPath, taskName } = body;
    const env = body.env || 'local';
    const sceneId = typeof body.patch?.sceneId === 'string' ? body.patch.sceneId.trim() : '';
    if (!projectPath || !taskName || isUnsafeSegment(taskName) || isUnsafeSegment(env) || !sceneId) {
      return Response.json({ error: 'projectPath, taskName, patch.sceneId required' }, { status: 400 });
    }
    if (body.patch?.severity !== undefined && !(SMOKE_SEVERITIES as readonly string[]).includes(body.patch.severity)) {
      return Response.json({ error: `severity must be one of ${SMOKE_SEVERITIES.join('/')}` }, { status: 400 });
    }
    const cur = readRun(projectPath, taskName, env);
    if (!cur) return Response.json({ error: 'run.json not found — 请先完成一次执行' }, { status: 404 });
    // 客户端持有的 runHash 必须匹配当前执行轮 —— 报告打开后又重跑了执行时，旧页面的
    // 复核操作会打到新一轮上，409 让前端重拉。
    if (body.runHash && body.runHash !== cur.runHash) {
      return Response.json({ error: 'runHash mismatch — 执行已更新，请刷新报告后重试', runHash: cur.runHash }, { status: 409 });
    }
    const file = bugsFile(projectPath, taskName, env);
    const nextFile = upsertBugOverride(readStored(file), cur.runHash, {
      sceneId,
      severity: body.patch?.severity,
      note: body.patch?.note,
      severityOverriddenFrom: body.patch?.severityOverriddenFrom,
    });
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(nextFile, null, 2), 'utf-8');
    await fs.promises.rename(tmp, file);
    // 返回合并后的最新清单（前端直接替换本地态，免二次 GET）。
    const res = assemble(projectPath, taskName, env);
    return Response.json({ ok: true, runHash: cur.runHash, bugs: res?.bugs ?? [] });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'bugs write failed' }, { status: 500 });
  }
}
