/**
 * 脱敏网关 — 纯函数工具(无 IO,可单测)。
 *
 * - buildOutbound / buildPreviewSegments:二次确认后的客户端外发重建
 *   (契约 §5.4:必须基于 normalizedText 的字符偏移,不得全局字符串替换)
 * - remaskText:历史回灌重脱敏(原文→占位符,防 SDK resume 失效/上下文
 *   压缩时 DB 里的原文回灌给外部模型 — 决策 D3)
 * - restoreText:渲染层还原(占位符→原文 — 决策 D5)
 */

import type { DeidDenyValue, DeidEntity, DeidPreviewSegment, DeidSessionState } from '@/types/deid';

/** 参与外发替换的实体:已脱敏 + 有定位 + 有占位符 + 未被用户取消 */
function outboundSpans(entities: DeidEntity[], excluded: Set<number>): DeidEntity[] {
  return entities
    .filter(
      (e) =>
        e.action === 'anonymized' &&
        e.start != null &&
        e.end != null &&
        !!e.placeholder &&
        !excluded.has(e.id),
    )
    .sort((a, b) => (a.start! - b.start!) || (a.end! - b.end!));
}

/**
 * 客户端重建最终外发文本(契约 §5.4)。
 * excluded = 用户在预览中取消脱敏的实体 id 集合(这些位置保留原文)。
 * 防御:跳过与前一 span 重叠的实体(服务端不应产生,但不因脏数据错切文本)。
 */
export function buildOutbound(
  normalizedText: string,
  entities: DeidEntity[],
  excluded: Set<number>,
): string {
  let output = '';
  let cursor = 0;
  for (const span of outboundSpans(entities, excluded)) {
    if (span.start! < cursor) continue; // overlap guard
    output += normalizedText.slice(cursor, span.start!) + span.placeholder;
    cursor = span.end!;
  }
  return output + normalizedText.slice(cursor);
}

/**
 * 预览分段:与 buildOutbound 同一游标算法,额外产出「取消脱敏 → 黄色原文」段,
 * 保证预览与真实外发逐字符一致(同源防偏差)。
 */
export function buildPreviewSegments(
  normalizedText: string,
  entities: DeidEntity[],
  excluded: Set<number>,
): DeidPreviewSegment[] {
  const segments: DeidPreviewSegment[] = [];
  const pushText = (text: string) => {
    if (text) segments.push({ kind: 'text', text });
  };
  let cursor = 0;
  for (const span of outboundSpans(entities, new Set<number>())) {
    if (span.start! < cursor) continue;
    pushText(normalizedText.slice(cursor, span.start!));
    if (excluded.has(span.id)) {
      segments.push({ kind: 'original', text: normalizedText.slice(span.start!, span.end!), entityId: span.id });
    } else {
      segments.push({ kind: 'placeholder', text: span.placeholder!, entityId: span.id });
    }
    cursor = span.end!;
  }
  pushText(normalizedText.slice(cursor));
  return segments;
}

/** 长词优先的字面量批量替换(split/join,零正则转义问题) */
function replaceAllLiteral(text: string, pairs: Array<[from: string, to: string]>): string {
  let out = text;
  for (const [from, to] of pairs) {
    if (!from || from === to) continue;
    if (out.includes(from)) out = out.split(from).join(to);
  }
  return out;
}

/**
 * 历史回灌重脱敏:把 mapping 中的原文替换回占位符(决策 D3)。
 * 长原文优先,避免「张伟丽」被「张伟」的占位符截断污染。
 * 注意这是安全方向的过度替换:用户曾取消脱敏的实体在历史回灌中也会被替换。
 */
export function remaskText(text: string, mapping: Record<string, string>): string {
  const pairs = Object.entries(mapping)
    .filter(([, original]) => !!original)
    .map(([placeholder, original]) => [original, placeholder] as [string, string])
    .sort((a, b) => b[0].length - a[0].length);
  return replaceAllLiteral(text, pairs);
}

/** 渲染层还原:占位符→原文(决策 D5)。长占位符优先(防前缀撞车,防御性排序)。 */
export function restoreText(text: string, mapping: Record<string, string>): string {
  const pairs = Object.entries(mapping)
    .filter(([placeholder]) => !!placeholder)
    .sort((a, b) => b[0].length - a[0].length) as Array<[string, string]>;
  return replaceAllLiteral(text, pairs);
}

/** 文本中是否存在占位符形状的记号(<TYPE_n>,契约 /v1/meta placeholder.regex) */
export function containsPlaceholder(text: string): boolean {
  return /<[A-Z0-9_]+_\d+>/.test(text);
}

/** 解析 chat_sessions.deid_state_json('' / 脏数据 → 空状态) */
export function parseDeidStateJson(json: string | null | undefined): Pick<DeidSessionState, 'mapping' | 'denyValues'> {
  const empty = { mapping: {} as Record<string, string>, denyValues: [] as DeidDenyValue[] };
  if (!json) return empty;
  try {
    const parsed = JSON.parse(json) as { mapping?: unknown; denyValues?: unknown };
    const mapping: Record<string, string> = {};
    if (parsed.mapping && typeof parsed.mapping === 'object' && !Array.isArray(parsed.mapping)) {
      for (const [k, v] of Object.entries(parsed.mapping as Record<string, unknown>)) {
        if (typeof v === 'string') mapping[k] = v;
      }
    }
    const denyValues: DeidDenyValue[] = Array.isArray(parsed.denyValues)
      ? (parsed.denyValues as unknown[])
          .filter((d): d is DeidDenyValue => !!d && typeof d === 'object' && typeof (d as DeidDenyValue).text === 'string' && !!(d as DeidDenyValue).text)
          .map((d) => ({ text: d.text, ...(d.entity_type ? { entity_type: d.entity_type } : {}) }))
      : [];
    return { mapping, denyValues };
  } catch {
    return empty;
  }
}
