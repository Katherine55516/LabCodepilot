"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
// react-pdf 的文本层 / 批注层样式 —— 不引入则文本不可选中、链接错位。
import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";
import { Plus, Minus, SpinnerGap } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/hooks/useTranslation";

/**
 * PdfViewer — Phase 1。react-pdf（内核 pdfjs-dist 5.4.296）应用内 PDF 预览。
 *
 * 离线关键：worker 与四类按 URL 取的资产全部指向 public/pdf/（由
 * scripts/copy-doc-assets.js 从 node_modules/pdfjs-dist 拷出），绝对路径字符串
 * 加载，绕开 Turbopack 的 worker/wasm 资产发射不确定性（与 public/asr-worklet.js
 * 同模式）。本组件经 next/dynamic(ssr:false) 懒加载，所以模块顶层设 workerSrc 是
 * 安全的（只在客户端执行）。
 */

// worker：版本与 pdfjs.version 同源（同一个 node_modules/pdfjs-dist），不会出现
// "API version does not match Worker version"。
pdfjs.GlobalWorkerOptions.workerSrc = "/pdf/pdf.worker.min.mjs";

// getDocument 透传选项 —— 5 类离线资产：
//   cMap     中文/日文 CID 字体（缺则整页空白）
//   fonts    14 个 PDF 标准字体回退
//   wasm     OpenJPEG/JPEG2000 解码器（含此类图的 PDF 缺则 JpxError）
//   icc      ICC color profile（pdfjs 5.x，缺则部分 PDF 颜色异常）
// 必须是模块级稳定引用，否则 <Document> 每次 render 重新加载 PDF。
const PDF_OPTIONS = {
  cMapUrl: "/pdf/cmaps/",
  cMapPacked: true,
  standardFontDataUrl: "/pdf/standard_fonts/",
  wasmUrl: "/pdf/wasm/",
  iccUrl: "/pdf/iccs/",
};

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.25;
const PAGE_GUTTER = 16; // 容器左右内边距，给页面留白

export function PdfViewer({ fileServeUrl }: { fileServeUrl: string }) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [data, setData] = useState<Uint8Array | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [containerWidth, setContainerWidth] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // 取二进制字节。文档走 /api/files/serve（serve 取字节），不走文本 preview 通道。
  useEffect(() => {
    let cancelled = false;
    setData(null);
    setNumPages(0);
    setError(null);
    (async () => {
      try {
        const res = await fetch(fileServeUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = await res.arrayBuffer();
        if (!cancelled) setData(new Uint8Array(buf));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fileServeUrl]);

  // 测容器宽度，让页面默认 fit 面板宽（面板可在 320~800 间拖动）。
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setContainerWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // file 对象也必须稳定引用（pdfjs 会消费 data buffer；scale/zoom 变化不应触发
  // Document 重载）。data 在每次切换文件时是全新 buffer，避免 transfer 后复用。
  const file = useMemo(() => (data ? { data } : null), [data]);

  const pageWidth =
    containerWidth > 0
      ? Math.max(120, (containerWidth - PAGE_GUTTER) * zoom)
      : undefined;

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-sm text-destructive">
        {t("docPreview.error")}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* 工具条：页数 + 缩放 */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/40 px-3 py-1.5">
        <span className="text-[11px] text-muted-foreground">
          {numPages > 0 ? t("docPreview.pages", { count: numPages }) : ""}
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z - ZOOM_STEP))}
            disabled={zoom <= MIN_ZOOM}
            title={t("docPreview.zoomOut")}
          >
            <Minus size={13} />
          </Button>
          <span className="w-10 text-center text-[11px] tabular-nums text-muted-foreground">
            {Math.round(zoom * 100)}%
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z + ZOOM_STEP))}
            disabled={zoom >= MAX_ZOOM}
            title={t("docPreview.zoomIn")}
          >
            <Plus size={13} />
          </Button>
        </div>
      </div>

      {/* 多页滚动区 */}
      <div
        ref={containerRef}
        className="min-h-0 flex-1 overflow-auto bg-muted/30 px-2 py-2"
      >
        {!file ? (
          <div className="flex items-center justify-center py-12">
            <SpinnerGap size={20} className="animate-spin text-muted-foreground" />
          </div>
        ) : (
          <Document
            file={file}
            options={PDF_OPTIONS}
            onLoadSuccess={({ numPages }) => setNumPages(numPages)}
            onLoadError={(e) => setError(e?.message || "load error")}
            loading={
              <div className="flex items-center justify-center py-12">
                <SpinnerGap size={20} className="animate-spin text-muted-foreground" />
              </div>
            }
          >
            {Array.from({ length: numPages }, (_, i) => (
              <div key={i} className="mx-auto mb-2 w-fit bg-white shadow-sm">
                <Page
                  pageNumber={i + 1}
                  width={pageWidth}
                  renderTextLayer
                  renderAnnotationLayer
                />
              </div>
            ))}
          </Document>
        )}
      </div>
    </div>
  );
}
