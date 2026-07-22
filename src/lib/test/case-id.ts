/**
 * 用例 id 的「回贴」解析器——把 AI 回写的 id 认回 cases.json 里那条用例。
 *
 * 事故（真机）：用例 id 是 `1108941+菜单栏-更多-‘码’上合规的子标题更改`（弯引号
 * U+2018/U+2019）。模型执行完这条用例、判定 pass、@@RESULT 也照规矩输出了一行——但把
 * 弯引号**敲成了直引号** `'码'`（U+0027）。reduce 的 caseIds 对齐是精确字符串比对，
 * 一个字符不同 → 认不出 → 真结果被当成「cases 之外的多余条目」丢弃、该用例被兜底补成
 * blocked「未执行」。报告最终写着「回归集未全过（0/1），存在阻塞级失败，不可发版」，
 * 而执行日志里明明白白 `pass=1`。
 *
 * 为什么不靠 prompt 修：prompt 早就写了「id 必须与 cases.json 完全一致」（prompts.ts
 * 第 8 条），模型照样把印刷体标点规整成 ASCII——这是 LLM 抄写文本的固有行为，不是提示
 * 词不够严。**判定的正确性不能押在模型的抄写保真度上**，必须由代码兜住。
 *
 * 兜法：另建一条「规范键」通道做**回退**匹配（精确匹配永远优先，语义不变）：
 * NFKC（全角→半角）→ 印刷体引号/破折号归一 → 去不可见字符与空白 → 小写。
 *
 * 关键的安全阀是**歧义保护**：若 cases.json 里两条不同 id 规范化后撞到同一个键，这个键
 * 就作废、谁都不许走回退——宁可退回「未执行」也不能把 A 的结果记到 B 头上。判定张冠李戴
 * 比漏判危险得多。
 */

/**
 * 印刷体引号 → ASCII。只收西文弯引号与撇号（模型「拉直」的就是这一类）。
 * 刻意**不**收 CJK 的「」『』《》——它们在中文标题里是有意义的结构符号（执行 prompt 还
 * 让模型用「」做内层引号），归一过去反而制造歧义。
 */
const PUNCT_FOLD: Record<string, string> = {
  '‘': "'", '’': "'", '‚': "'", '‛': "'", '′': "'", '´': "'", '`': "'",
  '“': '"', '”': '"', '„': '"', '‟': '"', '″': '"', '«': '"', '»': '"',
  // 各式连字符/破折号/减号 → ASCII 连字符（NFKC 只管全角 U+FF0D，其余得手动收）
  '‐': '-', '‑': '-', '‒': '-', '–': '-', '—': '-', '―': '-', '−': '-',
};

/** 零宽/软连字符/BOM——肉眼不可见，模型抄写时增删无感，一律剔除。 */
const INVISIBLE = /[­​-‍⁠﻿]/g;

/**
 * 用例 id 的规范键（**仅用于匹配**，绝不用作展示或落盘的 id——对外永远以 cases.json
 * 的原字符串为准）。
 */
export function canonicalCaseKey(id: string): string {
  let out = '';
  // NFKC 先行：全角标点/字母数字、兼容字形一次性收敛（与 scriptFileName 同口径）。
  for (const ch of id.normalize('NFKC')) out += PUNCT_FOLD[ch] ?? ch;
  return out
    .replace(INVISIBLE, '')
    .replace(/\s+/g, '') // 空格增删是模型抄写的高频漂移；id 只靠空白区分属病态设计
    .toLowerCase();
}

/**
 * 建一个「AI 回写的 id → cases.json 权威 id」解析器。
 *
 * 认不出时**原样返回**——调用方据此照旧走各自的兜底（reduce 补「未执行」、增量脚本喂料
 * 跳过），本解析器只做加法，不改变任何原本就能精确匹配的行为。
 */
export function createCaseIdResolver(authoritativeIds: Iterable<string>): (emitted: string) => string {
  const exact = new Set<string>();
  // key → 权威 id；null = 该键有多条用例撞车（歧义），禁止回退
  const byKey = new Map<string, string | null>();
  for (const id of authoritativeIds) {
    exact.add(id);
    const key = canonicalCaseKey(id);
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, id);
    else if (byKey.get(key) !== id) byKey.set(key, null); // 同 id 重复出现不算歧义
  }
  return (emitted: string): string => {
    if (exact.has(emitted)) return emitted;
    return byKey.get(canonicalCaseKey(emitted)) ?? emitted;
  };
}

/**
 * 按解析器把一个以用例 id 为键的字典搬到权威 id 上（耗时表、轨迹元素表等）。
 * 同一权威 id 有多个来源键时先到先得——与 reduce 的「同 id 多条取第一条」同口径。
 */
export function remapCaseKeys<T>(record: Record<string, T>, resolve: (id: string) => string): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(record)) {
    const id = resolve(k);
    if (!(id in out)) out[id] = v;
  }
  return out;
}
