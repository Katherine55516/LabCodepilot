'use client';

/**
 * 脱敏发送门(deid-gateway)— MessageInput 在 onSend 之前 await gate():
 *
 *   非激活态       → 直通 {ok:true, outbound:text, files:原样}
 *   激活态         → 先文本后图片**串行**跑完(契约 §8:共用同一本 mapping,
 *                    并发会产生占位符编号冲突),再打开预览弹窗;用户确认后
 *                    按 normalizedText 偏移重建外发文本(契约 §5.4)+ 用
 *                    canvas 从原图重绘外发图(契约 §7.2);
 *                    取消/失败 → {ok:false},调用方不发送、不清输入(fail-closed,D8)
 *
 * 串行守卫:弹窗一次只处理一条(契约「同会话请求串行」);弹窗打开期间
 * 的重复 gate() 直接返回 {ok:false}。
 * mapping 由服务端在每次脱敏成功后原子覆盖保存(D4);本 hook 每次成功
 * 通过 onMappingUpdate 同步给 ChatView 的渲染层还原字典。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { buildOutbound, imageExcludeKey, imageExcludedIds } from '@/lib/deid-utils';
import { redrawRedactedImage } from '@/lib/deid-image';
import type { FileAttachment } from '@/types';
import type {
  DeidDenyValue,
  DeidImagePreview,
  DeidImageResponse,
  DeidTextResponse,
} from '@/types/deid';

export type DeidGateResult =
  | { ok: true; outbound: string; files?: FileAttachment[] }
  | { ok: false };

/** 图片脱敏遮罩模式:placeholder=浅色块+占位符(便于视觉模型理解语义),fill=纯色块 */
export type DeidImageMode = 'placeholder' | 'fill';

interface PendingGate {
  text: string;
  files: FileAttachment[];
  /** files 中非图片的附件数(这些完全不脱敏,弹窗需如实提示) */
  nonImageCount: number;
  resolve: (r: DeidGateResult) => void;
}

export interface DeidPreviewDialogState {
  open: boolean;
  loading: boolean;
  /** HTTP 状态码;0 = 网络失败;null = 无错误 */
  errorStatus: number | null;
  data: DeidTextResponse | null;
  /** 本次消息是否带**非图片**附件(这些不参与脱敏) */
  hasNonImageFiles: boolean;
  /** 图片预览列表(空 = 本次无图片) */
  images: DeidImagePreview[];
  /** 有图片拿不到打码产物 → 禁止发送(fail-closed,绝不回落发原图) */
  hasImageFailure: boolean;
  imageMode: DeidImageMode;
  onImageModeChange: (mode: DeidImageMode) => void;
  excluded: Set<number>;
  /** 图片实体的取消集合,复合 key `${imageIndex}:${entityId}` */
  excludedImages: Set<string>;
  onToggleEntity: (id: number) => void;
  onToggleImageEntity: (imageIndex: number, entityId: number) => void;
  onAddEntity: (text: string, entityType: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export interface DeidGateController {
  gate: (text: string, files?: FileAttachment[]) => Promise<DeidGateResult>;
  dialog: DeidPreviewDialogState;
  /** ChatView 载入会话状态(GET /api/deid/state)后注入词表 */
  setDenyValues: (deny: DeidDenyValue[]) => void;
}

function isImage(f: FileAttachment): boolean {
  return (f.type || '').startsWith('image/');
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
  const [images, setImages] = useState<DeidImagePreview[]>([]);
  const [imageMode, setImageMode] = useState<DeidImageMode>('placeholder');
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [excludedImages, setExcludedImages] = useState<Set<string>>(new Set());

  const pendingRef = useRef<PendingGate | null>(null);
  const denyRef = useRef<DeidDenyValue[]>([]);
  const activeRef = useRef(active);
  activeRef.current = active;
  const mappingUpdateRef = useRef(onMappingUpdate);
  mappingUpdateRef.current = onMappingUpdate;
  const imageModeRef = useRef<DeidImageMode>(imageMode);
  imageModeRef.current = imageMode;
  /** 防丢弃后的迟到响应污染下一次预览(取消后 in-flight 请求仍会返回) */
  const runIdRef = useRef(0);

  /**
   * 跑一轮完整识别:文本 → 逐张图片(严格串行,契约 §8)。
   * 每一步都独立调服务端,服务端每次重读会话字典,故后一步天然拿到前一步
   * 落库的新 mapping —— 正文里的「张伟」与图片里的「张伟」因此复用同一占位符。
   */
  const runDeid = useCallback(
    async (text: string, files: FileAttachment[], denyValues?: DeidDenyValue[]) => {
      const runId = ++runIdRef.current;
      const stale = () => runId !== runIdRef.current;

      setLoading(true);
      setErrorStatus(null);
      try {
        let latestMapping: Record<string, string> | null = null;

        // ── 1. 文本(可能为空:纯图片消息) ──
        if (text) {
          const res = await fetch('/api/deid/text', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              session_id: sessionId,
              text,
              ...(denyValues ? { denyValues } : {}),
            }),
          });
          if (stale()) return;
          if (!res.ok) {
            setErrorStatus(res.status);
            return;
          }
          const json = (await res.json()) as DeidTextResponse;
          if (stale()) return;
          setData(json);
          latestMapping = json.mapping || {};
        } else {
          setData(null);
        }

        // ── 2. 图片,逐张串行 ──
        const imageFiles = files.filter(isImage);
        const previews: DeidImagePreview[] = [];
        for (const f of imageFiles) {
          const res = await fetch('/api/deid/image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              session_id: sessionId,
              imageBase64: f.data,
              mode: imageModeRef.current,
              // denyValues 只在文本步已提交过时省略(服务端沿用会话词表);
              // 纯图片消息时必须显式带上,否则新增的词条本轮对图片不生效
              ...(denyValues && !text ? { denyValues } : {}),
            }),
          });
          if (stale()) return;
          if (!res.ok) {
            setErrorStatus(res.status);
            return;
          }
          const json = (await res.json()) as DeidImageResponse;
          if (stale()) return;
          latestMapping = json.mapping || latestMapping;
          const index = files.indexOf(f);
          let redacted = '';
          try {
            redacted = await redrawRedactedImage(
              f.data,
              f.type,
              json.entities || [],
              new Set<number>(),
              imageModeRef.current,
            );
          } catch {
            // canvas 解码失败(损坏图片等)→ 回落服务端渲染结果;两者都没有
            // 时 redactedBase64 为空,确认阶段会拦截(见 onConfirm)
            redacted = json.redactedImageBase64 || '';
          }
          if (stale()) return;
          previews.push({
            index,
            name: f.name,
            originalBase64: f.data,
            mimeType: f.type || 'image/png',
            entities: json.entities || [],
            ...(json.llmError ? { llmError: json.llmError } : {}),
            redactedBase64: redacted,
          });
        }

        if (stale()) return;
        setImages(previews);
        setExcluded(new Set());
        setExcludedImages(new Set());
        if (denyValues) denyRef.current = denyValues;
        // 服务端已原子覆盖会话 mapping;同步给渲染层还原字典
        if (latestMapping) mappingUpdateRef.current(latestMapping);
      } catch {
        if (!stale()) setErrorStatus(0);
      } finally {
        if (!stale()) setLoading(false);
      }
    },
    [sessionId],
  );

  const cleanup = useCallback(() => {
    runIdRef.current += 1; // 作废在飞请求
    pendingRef.current = null;
    setPending(null);
    setData(null);
    setImages([]);
    setExcluded(new Set());
    setExcludedImages(new Set());
    setErrorStatus(null);
    setLoading(false);
  }, []);

  const gate = useCallback(
    (text: string, files?: FileAttachment[]): Promise<DeidGateResult> => {
      const list = files || [];
      if (!activeRef.current) return Promise.resolve({ ok: true, outbound: text, files });
      // 串行守卫:预览进行中不受理新请求(弹窗遮罩下正常到不了这里)
      if (pendingRef.current) return Promise.resolve({ ok: false });
      // 无文本且无图片(例如只带了一个 .docx)→ 没有可脱敏内容,直通。
      // 非图片附件不参与脱敏,拦下来也没有能给用户做的决定。
      const hasImage = list.some(isImage);
      if (!text && !hasImage) return Promise.resolve({ ok: true, outbound: text, files });

      return new Promise<DeidGateResult>((resolve) => {
        const p: PendingGate = {
          text,
          files: list,
          nonImageCount: list.filter((f) => !isImage(f)).length,
          resolve,
        };
        pendingRef.current = p;
        setPending(p);
        void runDeid(text, list);
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

  const onToggleImageEntity = useCallback((imageIndex: number, entityId: number) => {
    setExcludedImages((prev) => {
      const next = new Set(prev);
      const key = imageExcludeKey(imageIndex, entityId);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // 取消勾选 / 切换遮罩模式 → 从**原图**重绘(契约 §7.2:绝不在打码图上擦除)
  useEffect(() => {
    if (!pendingRef.current || images.length === 0) return;
    let cancelled = false;
    const runId = runIdRef.current;
    (async () => {
      const redrawn = await Promise.all(
        images.map(async (img) => {
          try {
            const next = await redrawRedactedImage(
              img.originalBase64,
              img.mimeType,
              img.entities,
              imageExcludedIds(excludedImages, img.index),
              imageMode,
            );
            return next === img.redactedBase64 ? img : { ...img, redactedBase64: next };
          } catch {
            return img;
          }
        }),
      );
      if (cancelled || runId !== runIdRef.current) return;
      // 全部未变(引用相等)时不 setState,避免自触发循环
      if (redrawn.every((x, i) => x === images[i])) return;
      setImages(redrawn);
    })();
    return () => { cancelled = true; };
    // images 变更本身也会进来一次,但上面的引用相等判断会立即短路
  }, [excludedImages, imageMode, images]);

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
    void runDeid(p.text, p.files, deny);
  }, [runDeid]);

  const onImageModeChange = useCallback((mode: DeidImageMode) => {
    setImageMode(mode);
  }, []);

  const onConfirm = useCallback(() => {
    const p = pendingRef.current;
    if (!p) return;
    // 文本:按 normalizedText 偏移重建(无文本消息则保持空)
    const outbound = data
      ? buildOutbound(data.normalizedText, data.entities || [], excluded)
      : p.text;

    // fail-closed 双保险:任何一张图没有打码产物就绝不放行 —— 回落成
    // "发原图"等于把未脱敏内容外发,比不发严重得多。正常情况下确认按钮
    // 已被 hasImageFailure 禁用,这里挡的是竞态。
    if (images.some((img) => !img.redactedBase64)) return;

    // 图片:用预览里那张(canvas 从原图重绘的)替换原附件 —— 所见即所发
    let files = p.files;
    if (images.length > 0) {
      const byIndex = new Map(images.map((img) => [img.index, img]));
      files = p.files.map((f, i) => {
        const img = byIndex.get(i);
        if (!img) return f; // 非图片附件原样带过
        return {
          ...f,
          name: f.name.replace(/\.[^.]+$/, '') + '-redacted.png',
          type: 'image/png',
          size: Math.ceil((img.redactedBase64.length * 3) / 4),
          data: img.redactedBase64,
        };
      });
    }
    cleanup();
    p.resolve({ ok: true, outbound, files });
  }, [data, images, excluded, cleanup]);

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
      hasNonImageFiles: (pending?.nonImageCount ?? 0) > 0,
      images,
      hasImageFailure: images.some((img) => !img.redactedBase64),
      imageMode,
      onImageModeChange,
      excluded,
      excludedImages,
      onToggleEntity,
      onToggleImageEntity,
      onAddEntity,
      onConfirm,
      onCancel,
    },
  };
}
