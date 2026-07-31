'use client';

/**
 * 脱敏发送门(deid-gateway)— MessageInput 在 onSend 之前 await gate():
 *
 *   非激活态       → 直通 {ok:true, outbound:text}
 *   激活态         → 调 /api/deid/text 打开预览弹窗,用户确认后按
 *                    normalizedText 偏移重建外发文本(契约 §5.4);
 *                    取消/失败 → {ok:false},调用方不发送、不清输入(fail-closed,D8)
 *
 * 串行守卫:弹窗一次只处理一条(契约「同会话请求串行」);弹窗打开期间
 * 的重复 gate() 直接返回 {ok:false}。
 * mapping 由服务端在每次脱敏成功后原子覆盖保存(D4);本 hook 每次成功
 * 通过 onMappingUpdate 同步给 ChatView 的渲染层还原字典。
 */

import { useCallback, useRef, useState } from 'react';
import { buildOutbound } from '@/lib/deid-utils';
import type { DeidDenyValue, DeidTextResponse } from '@/types/deid';

export type DeidGateResult = { ok: true; outbound: string } | { ok: false };

interface PendingGate {
  text: string;
  hasFiles: boolean;
  resolve: (r: DeidGateResult) => void;
}

export interface DeidPreviewDialogState {
  open: boolean;
  loading: boolean;
  /** HTTP 状态码;0 = 网络失败;null = 无错误 */
  errorStatus: number | null;
  data: DeidTextResponse | null;
  hasFiles: boolean;
  excluded: Set<number>;
  onToggleEntity: (id: number) => void;
  onAddEntity: (text: string, entityType: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export interface DeidGateController {
  gate: (text: string, hasFiles: boolean) => Promise<DeidGateResult>;
  dialog: DeidPreviewDialogState;
  /** ChatView 载入会话状态(GET /api/deid/state)后注入词表 */
  setDenyValues: (deny: DeidDenyValue[]) => void;
}

export function useDeidGate(opts: {
  sessionId: string;
  /** sandbox_enabled && deid_enabled */
  active: boolean;
  onMappingUpdate: (mapping: Record<string, string>) => void;
}): DeidGateController {
  const { sessionId, active, onMappingUpdate } = opts;

  const [pending, setPending] = useState<PendingGate | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [data, setData] = useState<DeidTextResponse | null>(null);
  const [excluded, setExcluded] = useState<Set<number>>(new Set());

  const pendingRef = useRef<PendingGate | null>(null);
  const denyRef = useRef<DeidDenyValue[]>([]);
  const activeRef = useRef(active);
  activeRef.current = active;
  const mappingUpdateRef = useRef(onMappingUpdate);
  mappingUpdateRef.current = onMappingUpdate;

  const runDeid = useCallback(async (text: string, denyValues?: DeidDenyValue[]) => {
    setLoading(true);
    setErrorStatus(null);
    try {
      const res = await fetch('/api/deid/text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          text,
          ...(denyValues ? { denyValues } : {}),
        }),
      });
      if (!res.ok) {
        setErrorStatus(res.status);
        return;
      }
      const json = (await res.json()) as DeidTextResponse;
      if (denyValues) denyRef.current = denyValues;
      setData(json);
      setExcluded(new Set());
      // 服务端已原子覆盖会话 mapping;同步给渲染层还原字典
      mappingUpdateRef.current(json.mapping || {});
    } catch {
      setErrorStatus(0);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  const cleanup = useCallback(() => {
    pendingRef.current = null;
    setPending(null);
    setData(null);
    setExcluded(new Set());
    setErrorStatus(null);
    setLoading(false);
  }, []);

  const gate = useCallback(
    (text: string, hasFiles: boolean): Promise<DeidGateResult> => {
      if (!activeRef.current) return Promise.resolve({ ok: true, outbound: text });
      // 串行守卫:预览进行中不受理新请求(弹窗遮罩下正常到不了这里)
      if (pendingRef.current) return Promise.resolve({ ok: false });
      return new Promise<DeidGateResult>((resolve) => {
        const p: PendingGate = { text, hasFiles, resolve };
        pendingRef.current = p;
        setPending(p);
        void runDeid(text);
      });
    },
    [runDeid],
  );

  const onToggleEntity = useCallback((id: number) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const onAddEntity = useCallback((text: string, entityType: string) => {
    const p = pendingRef.current;
    if (!p || !text.trim()) return;
    const trimmed = text.trim();
    const type = entityType.trim().toUpperCase();
    // 同词条去重后追加;交互文档 §5.3:用原 mapping + 更新后的词表整体重跑
    const deny: DeidDenyValue[] = [
      ...denyRef.current.filter((d) => d.text !== trimmed),
      { text: trimmed, ...(type && /^[A-Z0-9_]+$/.test(type) ? { entity_type: type } : {}) },
    ];
    void runDeid(p.text, deny);
  }, [runDeid]);

  const onConfirm = useCallback(() => {
    const p = pendingRef.current;
    if (!p || !data) return;
    const outbound = buildOutbound(data.normalizedText, data.entities || [], excluded);
    cleanup();
    p.resolve({ ok: true, outbound });
  }, [data, excluded, cleanup]);

  const onCancel = useCallback(() => {
    const p = pendingRef.current;
    cleanup();
    p?.resolve({ ok: false });
  }, [cleanup]);

  const setDenyValues = useCallback((deny: DeidDenyValue[]) => {
    denyRef.current = deny;
  }, []);

  return {
    gate,
    setDenyValues,
    dialog: {
      open: !!pending,
      loading,
      errorStatus,
      data,
      hasFiles: pending?.hasFiles ?? false,
      excluded,
      onToggleEntity,
      onAddEntity,
      onConfirm,
      onCancel,
    },
  };
}
