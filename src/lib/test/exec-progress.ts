/**
 * 解析「测试执行」进度行 → 进度展示用的 { idx 第几个, total 总数, title 当前用例标题 }。
 *
 * 数据来源：AI 每条用例前打印的进度行「▶ 用例 N/总数：标题」（见 src/lib/test/prompts.ts 执行步），
 * 前端把 `▶ ` 之后的内容存进 currentCase。
 *
 * - idx：当前跑到第几个（进度行里的 N）；解析不到记 0。
 * - total：用例总数；优先用进度行里的「/总数」，缺省回落到 cases.json 用例数（casesTotal）——
 *   这样首条进度行到达前（环境预检 / 读用例阶段）也能显示总数。
 * - title：剥掉「用例 」前缀与「N/总数：」前缀后的标题本身（兼容半角/全角冒号、无标题）。
 */
export function parseExecProgress(
  currentCase: string,
  casesTotal: number,
): { idx: number; total: number; title: string } {
  const raw = (currentCase || '').trim();
  const nums = raw.match(/(\d+)\s*\/\s*(\d+)/);
  const idx = nums ? Number(nums[1]) : 0;
  const parsedTotal = nums ? Number(nums[2]) : 0;
  const total = parsedTotal || (casesTotal > 0 ? casesTotal : 0);
  const title = raw
    .replace(/^用例\s*/, '')
    .replace(/^\d+\s*\/\s*\d+\s*[:：]?\s*/, '')
    .trim();
  return { idx, total, title };
}
