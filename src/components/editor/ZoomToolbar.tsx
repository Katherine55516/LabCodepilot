"use client";

import type { ReactNode } from "react";
import { Plus, Minus } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/hooks/useTranslation";

export const ZOOM_MIN = 50;
export const ZOOM_MAX = 300;
export const ZOOM_STEP = 25;

/**
 * 文档预览统一的「- 100% +」缩放工具条，DocxViewer / PptxViewer 共用，
 * 样式与 PdfViewer 的内联工具条一致。percent 为整数百分比（100 = 原始）。
 * 可选 `left` 放在左侧（如 PPTX 的「排版可能有差异」提示）。
 */
export function ZoomToolbar({
  percent,
  onChange,
  left,
}: {
  percent: number;
  onChange: (percent: number) => void;
  left?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/40 px-3 py-1.5">
      <span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground">
        {left}
      </span>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => onChange(Math.max(ZOOM_MIN, percent - ZOOM_STEP))}
          disabled={percent <= ZOOM_MIN}
          title={t("docPreview.zoomOut")}
        >
          <Minus size={13} />
        </Button>
        <span className="w-10 text-center text-[11px] tabular-nums text-muted-foreground">
          {percent}%
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => onChange(Math.min(ZOOM_MAX, percent + ZOOM_STEP))}
          disabled={percent >= ZOOM_MAX}
          title={t("docPreview.zoomIn")}
        >
          <Plus size={13} />
        </Button>
      </div>
    </div>
  );
}
