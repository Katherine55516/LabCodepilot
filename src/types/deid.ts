// ==========================================
// 脱敏网关(deid-service)类型 — 契约见 docs/exec-plans/active/deid-gateway.md
// 无状态契约:mapping 随请求进出,服务端不保存;本应用按会话持久化
// (chat_sessions.deid_state_json)并在同一会话下一轮带回。
// ==========================================

/** 用户手工新增、需跨轮识别的词条(命中即脱敏) */
export interface DeidDenyValue {
  text: string;
  /** 实体类型,A-Z0-9_,缺省 CUSTOM */
  entity_type?: string;
}

export type DeidEntityAction = 'anonymized' | 'kept' | 'allowlisted' | 'unlocated';

export interface DeidEntity {
  id: number;
  entity_type: string;
  /** 命中的原文 */
  original: string;
  placeholder: string | null;
  score?: number;
  /** 基于 normalizedText 的字符偏移(文本管道) */
  start?: number;
  end?: number;
  layer?: 'deny_list' | 'regex' | 'builtin' | 'ner' | 'llm' | string;
  recognizer?: string;
  /**
   * anonymized=已替换占位符;kept=策略保留;allowlisted=白名单放行;
   * unlocated=LLM 报出但定位失败(如实上报,未处理)。只有 anonymized 允许用户取消。
   */
  action: DeidEntityAction;
}

export interface DeidNormalizationEdit {
  from: string;
  to: string;
  count?: number;
  accepted?: boolean;
  reason?: string;
}

export interface DeidNormalization {
  applied?: boolean;
  edits?: DeidNormalizationEdit[];
}

/** POST /v1/deidentify/text 响应 */
export interface DeidTextResponse {
  level?: string;
  originalText: string;
  /** Layer 0 规范化后文本,entities 的 start/end 基于它(客户端重建必须用它) */
  normalizedText: string;
  normalization?: DeidNormalization;
  /** 全量脱敏文本(未经确认干预) */
  anonymized: string;
  entities: DeidEntity[];
  /** 占位符 → 原文(完整字典,含历史轮次) */
  mapping: Record<string, string>;
  timings?: Record<string, number>;
  /** LLM 层故障时出现(已 fail-open 降级,规则/NER 结果仍可用) */
  llmError?: string;
}

/** POST /v1/reidentify 响应 */
export interface DeidReidentifyResponse {
  restored: string;
  replaced?: string[];
  /** 模型自造/改写的占位符(无法还原,需 UI 告警) */
  unknownPlaceholders?: string[];
}

/** 会话级脱敏状态(GET /api/deid/state 响应) */
export interface DeidSessionState {
  enabled: boolean;
  mapping: Record<string, string>;
  denyValues: DeidDenyValue[];
}

/** 预览渲染分段:text=普通文本,placeholder=将替换为占位符(蓝),original=用户取消脱敏保留原文(黄) */
export interface DeidPreviewSegment {
  kind: 'text' | 'placeholder' | 'original';
  text: string;
  entityId?: number;
}
