import { appendAudit } from '@/lib/test/audit';
import { readLibrary, REGRESSION_LIBRARY_TASK } from '@/lib/test/library';
import {
  readSuites,
  upsertSuite,
  removeSuite,
  setPinned,
  evalSuite,
  sanitizeSuite,
  isQuarantined,
  REGRESSION_FULL_SUITE,
  type SuiteKey,
} from '@/lib/test/suites';
import { buildLastResultLookup } from '@/lib/test/rounds';

export const runtime = 'nodejs';

/**
 * 回归套件 API(v2 批 C)。
 *
 * GET    ?projectPath → { pinned, fullHits, suites:[{name,type,keys?/filter?,hits}] }
 *        hits = 执行范围口径(查询求值/静态清单 + pinned 并入 + 隔离排除),与发起弹窗一致。
 * POST   { projectPath, suite }  → 新建/更新套件(内置「全量」名 → 400);
 *        { projectPath, pinned } → 覆盖核心必跑白名单。
 * DELETE { projectPath, name }   → 删除套件(内置 → 400;不存在 no-op)。
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const projectPath = url.searchParams.get('projectPath');
  if (!projectPath) {
    return Response.json({ error: 'projectPath is required' }, { status: 400 });
  }
  try {
    const lib = readLibrary(projectPath);
    const data = readSuites(projectPath);
    const lastResultOf = buildLastResultLookup(projectPath);
    const opts = { pinned: data.pinned, lastResultOf };
    const tasksOf = (hits: ReturnType<typeof evalSuite>) => new Set(hits.map((e) => e._source.task)).size;
    const suites = data.suites.map((s) => {
      const hit = evalSuite(lib, s, opts);
      return { ...s, hits: hit.length, hitTasks: tasksOf(hit) };
    });
    const full = evalSuite(lib, null, opts);
    return Response.json({
      pinned: data.pinned,
      fullHits: full.length,
      fullTasks: tasksOf(full),
      // 发起弹窗预检卡与健康度页要曝光「隔离排除 N 条」——隔离不计红线,但必须可见(护栏)。
      quarantinedCount: lib.entries.filter(isQuarantined).length,
      suites,
    });
  } catch {
    return Response.json({ pinned: [], fullHits: 0, fullTasks: 0, quarantinedCount: 0, suites: [] });
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const body = await req.json().catch(() => ({}));
    const projectPath: string | undefined = body.projectPath;
    if (!projectPath || typeof projectPath !== 'string') {
      return Response.json({ error: 'projectPath is required' }, { status: 400 });
    }
    // 分支一:覆盖 pinned 白名单。
    if (Array.isArray(body.pinned)) {
      const keys = (body.pinned as unknown[]).filter(
        (k): k is SuiteKey =>
          !!k && typeof k === 'object'
          && typeof (k as SuiteKey).task === 'string' && !!(k as SuiteKey).task
          && typeof (k as SuiteKey).originalId === 'string',
      );
      setPinned(projectPath, keys);
      void appendAudit(projectPath, REGRESSION_LIBRARY_TASK, {
        action: 'suite-save',
        mode: 'manual',
        step: 'cases',
        detail: `更新核心必跑白名单:${keys.length} 条`,
      });
      return Response.json({ ok: true, pinned: keys.length });
    }
    // 分支二:新建/更新套件。
    const suite = sanitizeSuite(body.suite);
    if (!suite) {
      const rawName = (body.suite as { name?: unknown } | undefined)?.name;
      const reserved = typeof rawName === 'string' && rawName.trim() === REGRESSION_FULL_SUITE;
      return Response.json(
        { error: reserved ? `套件名不可使用内置保留名「${REGRESSION_FULL_SUITE}」` : 'invalid suite' },
        { status: 400 },
      );
    }
    upsertSuite(projectPath, suite);
    void appendAudit(projectPath, REGRESSION_LIBRARY_TASK, {
      action: 'suite-save',
      mode: 'manual',
      step: 'cases',
      detail: `保存套件「${suite.name}」(${suite.type === 'query' ? '查询' : '静态'})`,
    });
    return Response.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Internal server error';
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: Request): Promise<Response> {
  try {
    const body = await req.json().catch(() => ({}));
    const projectPath: string | undefined = body.projectPath;
    const name: string | undefined = body.name;
    if (!projectPath || typeof projectPath !== 'string') {
      return Response.json({ error: 'projectPath is required' }, { status: 400 });
    }
    if (!name || typeof name !== 'string') {
      return Response.json({ error: 'name is required' }, { status: 400 });
    }
    if (name === REGRESSION_FULL_SUITE) {
      return Response.json({ error: `内置套件「${REGRESSION_FULL_SUITE}」不可删除` }, { status: 400 });
    }
    removeSuite(projectPath, name);
    void appendAudit(projectPath, REGRESSION_LIBRARY_TASK, {
      action: 'suite-delete',
      mode: 'manual',
      step: 'cases',
      detail: `删除套件「${name}」`,
    });
    return Response.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Internal server error';
    return Response.json({ error: message }, { status: 500 });
  }
}
