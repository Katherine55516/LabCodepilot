/**
 * 沙箱会话「使用的技能」信号提取与聚合(纯函数,server/client 共用)。
 *
 * 信号形态(2026-07-30 生产会话 DB 实测,ef61d4f5…):skill 调用 = assistant 消息
 * content 里的 tool_use 块 `{name:"Skill", input:{skill:"office-cn"}}`,自带唯一
 * tool_use id。id 是三个数据源(回合末持久化 / 流式实时 / 历史消息解析)去重合并
 * 的键 —— 没有它,同一次调用会在多源合并时被重复计数。
 *
 * 只认 `name === 'Skill'` 这一种形态:实测唯一信号;若未来 SDK 出现其他调用形态,
 * 在 extractSkillUses 加分支即可(本模块无 IO,单测覆盖)。
 */

/** 一次 skill 调用。id = tool_use id(跨源去重键);ts=0 表示时间未知(实时/解析源)。 */
export interface SessionSkillUse {
  id: string;
  skill: string;
  ts: number;
}

/** 宽松的内容块形状:兼容 MessageContentBlock 与流式 ToolUseInfo 两种来源。 */
interface ToolUseLike {
  type?: string;
  id?: string;
  name?: string;
  input?: unknown;
}

/**
 * 从内容块数组提取 Skill 调用。容忍任意脏数据(历史消息 JSON 解析自用户 DB,
 * 形状不可信):缺 id / 缺 skill / input 非对象的一律跳过。
 * `type` 缺省视为 tool_use —— 流式源(ToolUseInfo)没有 type 字段。
 */
export function extractSkillUses(blocks: unknown[], ts = 0): SessionSkillUse[] {
  const out: SessionSkillUse[] = [];
  if (!Array.isArray(blocks)) return out;
  for (const raw of blocks) {
    if (!raw || typeof raw !== 'object') continue;
    const b = raw as ToolUseLike;
    if (b.type !== undefined && b.type !== 'tool_use') continue;
    if (b.name !== 'Skill') continue;
    if (typeof b.id !== 'string' || !b.id) continue;
    const input = b.input;
    if (!input || typeof input !== 'object') continue;
    const skill = (input as { skill?: unknown }).skill;
    if (typeof skill !== 'string' || !skill.trim()) continue;
    out.push({ id: b.id, skill: skill.trim(), ts });
  }
  return out;
}

/**
 * 按 id 去重合并(先到先得:已持久化条目的 ts 优先于后来源的 0)。
 * 返回稳定顺序:入参先后即调用先后 —— 持久化源在前、实时源在后,天然按时间。
 */
export function mergeSkillUses(
  ...sources: SessionSkillUse[][]
): SessionSkillUse[] {
  const seen = new Set<string>();
  const out: SessionSkillUse[] = [];
  for (const src of sources) {
    for (const u of src) {
      if (!u?.id || seen.has(u.id)) continue;
      seen.add(u.id);
      out.push(u);
    }
  }
  return out;
}

/** 面板展示用:按技能名聚合计数,保持首次调用的先后顺序。 */
export function groupSkillUses(
  uses: SessionSkillUse[],
): Array<{ skill: string; count: number }> {
  const order: string[] = [];
  const counts = new Map<string, number>();
  for (const u of uses) {
    if (!counts.has(u.skill)) order.push(u.skill);
    counts.set(u.skill, (counts.get(u.skill) || 0) + 1);
  }
  return order.map((skill) => ({ skill, count: counts.get(skill)! }));
}

/** 序列化/反序列化(chat_sessions.skills_used_json,'' = 无记录)。 */
export function parseSkillUsesJson(json: string | null | undefined): SessionSkillUse[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (u): u is SessionSkillUse =>
        !!u && typeof u === 'object' && typeof u.id === 'string' && typeof u.skill === 'string',
    ).map((u) => ({ id: u.id, skill: u.skill, ts: typeof u.ts === 'number' ? u.ts : 0 }));
  } catch {
    return [];
  }
}
