"use client";

import { useEffect, useRef, useState } from "react";
import { SpinnerGap } from "@/components/ui/icon";
import { useTranslation } from "@/hooks/useTranslation";

/**
 * PptxViewer — Phase 3。@aiden0z/pptx-renderer 应用内 PowerPoint(.pptx）预览。
 *
 * 保真度（诚实预期，见执行计划 §6/§10）：渲染到 DOM/SVG，文本/表格/图片/常规图形
 * 体面，图表用 echarts 重绘；但动画/转场、OMML 公式、阴影/3D、OLE 对象、演讲者备注
 * 不渲染，SmartArt 走 PPT 内嵌的 fallback 位图。重设计/重特效的 PPT 与原文件有
 * 肉眼差距——故 UI 顶部固定一条「排版可能有差异」提示。完全无法处理 .ppt 老二进制。
 *
 * 体积：echarts（库依赖，~MB 级）随本组件的 next/dynamic chunk 二级懒加载，不进
 * 主 bundle、不进首屏，只有首次开 pptx 才拉取。
 *
 * 安全：与 DocxViewer 的三层防护不同——aiden0z 是结构化渲染（解析 OOXML 节点后用
 * DOM API 绘制，无 innerHTML 注入面），且自带外链协议过滤（javascript:/data:），这里
 * 再叠 zipLimits 限制 ZIP 解析资源（DoS 防护面）。不套 DOMPurify/sandbox iframe——
 * 那会破坏 echarts canvas 与 IntersectionObserver 滚动。
 *
 * 兜底：解析失败 / 坏文件 / 误传 .ppt 老格式 → try/catch 落到 error 态显示「无法预览」，
 * 绝不让单个坏文件白屏整个预览面板。
 */

type ViewerInstance = { destroy: () => void };

export function PptxViewer({ fileServeUrl }: { fileServeUrl: string }) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<ViewerInstance | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");

    const destroyViewer = () => {
      try {
        viewerRef.current?.destroy();
      } catch {
        /* ignore teardown errors */
      }
      viewerRef.current = null;
    };

    (async () => {
      try {
        const res = await fetch(fileServeUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = await res.arrayBuffer();
        if (cancelled || !containerRef.current) return;

        // 二级懒加载边界：echarts 随此 import 进同一 chunk。
        const { PptxViewer: Viewer, RECOMMENDED_ZIP_LIMITS } = await import(
          "@aiden0z/pptx-renderer"
        );
        if (cancelled || !containerRef.current) return;

        const viewer = await Viewer.open(new Uint8Array(buf), containerRef.current, {
          fitMode: "contain", // 适配预览面板宽度（面板可在 320~800 拖动）
          zipLimits: RECOMMENDED_ZIP_LIMITS, // ZIP 解析上限，DoS 防护
          pdfjs: false, // 关 EMF/pdfjs fallback；SmartArt 走内嵌位图，省 worker 配置
          renderMode: "list", // 所有 slide 竖排滚动
        });
        if (cancelled) {
          try {
            viewer.destroy();
          } catch {
            /* ignore */
          }
          return;
        }
        viewerRef.current = viewer;
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      destroyViewer();
    };
  }, [fileServeUrl]);

  return (
    <div className="flex h-full flex-col">
      {status === "ready" && (
        <div className="shrink-0 border-b border-border/40 bg-muted/40 px-3 py-1 text-center text-[10px] text-muted-foreground">
          {t("docPreview.pptxNotice")}
        </div>
      )}
      <div className="relative min-h-0 flex-1 overflow-auto bg-muted/30">
        <div ref={containerRef} className="min-h-full p-2" />
        {status === "loading" && (
          <div className="absolute inset-0 flex items-center justify-center">
            <SpinnerGap size={20} className="animate-spin text-muted-foreground" />
          </div>
        )}
        {status === "error" && (
          <div className="absolute inset-0 flex items-center justify-center p-8 text-center text-sm text-destructive">
            {t("docPreview.error")}
          </div>
        )}
      </div>
    </div>
  );
}
