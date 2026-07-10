import { readLibrary } from '@/lib/test/library';
import { readSuites, evalSuite, sanitizeSuite } from '@/lib/test/suites';
import { buildLastResultLookup } from '@/lib/test/rounds';

export const runtime = 'nodejs';

/**
 * 套件求值预览(v2 批 C):构建器编辑中的【未保存】套件实时命中数/样例。
 * POST { projectPath, suite } → { hits, sample:[{task,originalId,purpose,priority,module}] }
 * 求值口径与发起执行完全一致(pinned 并入、隔离排除、上次结果反查)——预览即所见即所跑。
 */
export async function POST(req: Request): Promise<Response> {
  try {
    const body = await req.json().catch(() => ({}));
    const projectPath: string | undefined = body.projectPath;
    if (!projectPath || typeof projectPath !== 'string') {
      return Response.json({ error: 'projectPath is required' }, { status: 400 });
    }
    const suite = sanitizeSuite(body.suite);
    if (!suite) {
      return Response.json({ error: 'invalid suite' }, { status: 400 });
    }
    const lib = readLibrary(projectPath);
    const data = readSuites(projectPath);
    const hits = evalSuite(lib, suite, {
      pinned: data.pinned,
      lastResultOf: buildLastResultLookup(projectPath),
    });
    return Response.json({
      hits: hits.length,
      sample: hits.slice(0, 8).map((e) => ({
        task: e._source.task,
        originalId: e._source.originalId,
        purpose: typeof e.purpose === 'string' ? e.purpose : '',
        priority: typeof e.priority === 'string' ? e.priority : '',
        module: typeof e.module === 'string' ? e.module : '',
      })),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Internal server error';
    return Response.json({ error: message }, { status: 500 });
  }
}
