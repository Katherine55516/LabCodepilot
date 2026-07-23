import { harvestMarkerObjects } from './markers';
import fs from 'fs';

/**
 * 存量用例 · AI 推荐回归集的纯逻辑（从 src/app/api/test/cases/recommend/route.ts 抽出）。
 *
 * 抽出原因：Next.js 构建期路由类型校验只允许 route.ts 导出 HTTP method handler，
 * helper 导出会导致 `next build` 失败。recommend 路由、recommend/apply 路由与单测
 * 从本模块导入。
 */

/** 提取 @@RECOMMEND 行 → id → suite。解析口径见 markers.ts(容忍模型的 markdown 装饰)。 */
export function harvestRecommend(text: string): Map<string, boolean> {
  const out = new Map<string, boolean>();
  for (const obj of harvestMarkerObjects<{ id?: unknown; suite?: unknown }>(text, 'RECOMMEND')) {
    if (typeof obj.id === 'string' && typeof obj.suite === 'boolean') out.set(obj.id, obj.suite);
  }
  return out;
}

/** 一条推荐判定(可视化审阅用:比 harvestRecommend 多带 reason)。 */
export interface RecommendVerdict {
  id: string;
  suite: boolean;
  reason: string;
}

/**
 * 提取 @@RECOMMEND 行 → [{id, suite, reason}]（审阅模式用；保留理由供可视化表格展示）。
 * 同 id 多行时后者覆盖前者（与 harvestRecommend 的 Map 语义一致）。坏行跳过。
 */
export function harvestRecommendDetailed(text: string): RecommendVerdict[] {
  const byId = new Map<string, RecommendVerdict>();
  for (const obj of harvestMarkerObjects<{ id?: unknown; suite?: unknown; reason?: unknown }>(text, 'RECOMMEND')) {
    if (typeof obj.id === 'string' && typeof obj.suite === 'boolean') {
      byId.set(obj.id, { id: obj.id, suite: obj.suite, reason: typeof obj.reason === 'string' ? obj.reason : '' });
    }
  }
  return [...byId.values()];
}

/**
 * 按推荐结果 merge cases.json：只增删各条 tags 里的「回归测试」，其余字段与文件结构
 * （{cases:[...]} 或顶层数组）原样保留；.tmp+rename 原子写。返回统计供前端提示。
 */
export function applyRecommend(
  casesAbs: string,
  rec: Map<string, boolean>,
): { changed: number; total: number; suiteTotal: number } {
  const raw = JSON.parse(fs.readFileSync(casesAbs, 'utf-8')) as unknown;
  const list: Array<Record<string, unknown>> = Array.isArray((raw as { cases?: unknown })?.cases)
    ? ((raw as { cases: Array<Record<string, unknown>> }).cases)
    : Array.isArray(raw)
      ? (raw as Array<Record<string, unknown>>)
      : [];
  let changed = 0;
  let suiteTotal = 0;
  for (const c of list) {
    const id = typeof c?.id === 'string' ? c.id : '';
    const tags: string[] = Array.isArray(c?.tags) ? (c.tags as unknown[]).filter((t): t is string => typeof t === 'string') : [];
    const has = tags.includes('回归测试');
    if (!id || !rec.has(id)) {
      if (has) suiteTotal++;
      continue;
    }
    const want = rec.get(id)!;
    if (want && !has) {
      c.tags = [...tags, '回归测试'];
      changed++;
    } else if (!want && has) {
      c.tags = tags.filter((t) => t !== '回归测试');
      changed++;
    }
    if (want) suiteTotal++;
  }
  const out = Array.isArray(raw) ? list : { ...(raw as Record<string, unknown>), cases: list };
  const tmp = casesAbs + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(out, null, 2), 'utf-8');
  fs.renameSync(tmp, casesAbs);
  return { changed, total: list.length, suiteTotal };
}
