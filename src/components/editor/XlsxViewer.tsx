"use client";

import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { SpinnerGap } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/hooks/useTranslation";
import { DataTableViewer } from "./DataTableViewer";

/**
 * XlsxViewer — Phase 1。SheetJS（xlsx CE 0.18.5）解析 .xlsx/.xls，复用现有
 * DataTableViewer 渲染表格。
 *
 * 解析职责在本组件，展示职责交给 DataTableViewer（它的 rows+header 预解析入口
 * 正是为此设计）。SheetJS 整包 ~300KB，因本组件经 next/dynamic(ssr:false) 懒加载，
 * `import 'xlsx'` 落在独立 chunk，不点 Excel 不加载。
 *
 * 保真档（MVP「够用」）：多 sheet 切换 + 计算值 + 自动表头。放弃单元格样式
 * （CE 不解析）、合并单元格还原、公式文本。详见执行计划 §10。
 */

/** Excel 列字母（A..Z, AA..），给无表头/空表头列兜底命名。 */
function colLetter(index: number): string {
  let s = "";
  let n = index;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

/**
 * 把首行规范成唯一、非空的表头。
 *
 * DataTableViewer 用 header 值同时做 React key 和行对象的属性 key——Excel 首行
 * 常有空单元格或重复列名，直接用会 key 冲突（数据互相覆盖 + React warning）。
 * 这里：空 → 列字母；重复 → 加 (n) 后缀。
 */
function normalizeHeader(firstRow: unknown[], colCount: number): string[] {
  const seen = new Map<string, number>();
  const out: string[] = [];
  for (let i = 0; i < colCount; i++) {
    let name = String(firstRow[i] ?? "").trim();
    if (!name) name = colLetter(i);
    if (seen.has(name)) {
      const next = (seen.get(name) ?? 0) + 1;
      seen.set(name, next);
      name = `${name} (${next})`;
    } else {
      seen.set(name, 0);
    }
    out.push(name);
  }
  return out;
}

export function XlsxViewer({
  fileServeUrl,
  filename,
}: {
  fileServeUrl: string;
  filename?: string;
}) {
  const { t } = useTranslation();
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [activeSheet, setActiveSheet] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setWorkbook(null);
    setActiveSheet("");
    setError(null);
    (async () => {
      try {
        const res = await fetch(fileServeUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = await res.arrayBuffer();
        const wb = XLSX.read(new Uint8Array(buf), { type: "array" });
        if (!cancelled) {
          setWorkbook(wb);
          setActiveSheet(wb.SheetNames[0] ?? "");
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fileServeUrl]);

  const { header, rows } = useMemo<{ header: string[]; rows: unknown[][] }>(() => {
    if (!workbook || !activeSheet) return { header: [], rows: [] };
    const ws = workbook.Sheets[activeSheet];
    if (!ws) return { header: [], rows: [] };
    // header:1 → 二维数组（aoa）；defval 让空单元格落位为空串而非被跳过。
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      defval: "",
      blankrows: false,
    });
    const colCount = aoa.reduce(
      (max, r) => Math.max(max, Array.isArray(r) ? r.length : 0),
      0,
    );
    if (aoa.length === 0 || colCount === 0) return { header: [], rows: [] };
    const header = normalizeHeader(aoa[0] as unknown[], colCount);
    const rows = aoa.slice(1) as unknown[][];
    return { header, rows };
  }, [workbook, activeSheet]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-sm text-destructive">
        {t("docPreview.error")}
      </div>
    );
  }
  if (!workbook) {
    return (
      <div className="flex h-full items-center justify-center py-12">
        <SpinnerGap size={20} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* 多 sheet 切换 tab —— 单 sheet 时不显示。 */}
      {workbook.SheetNames.length > 1 && (
        <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border/40 px-2 py-1.5">
          {workbook.SheetNames.map((name) => (
            <Button
              key={name}
              variant="ghost"
              size="xs"
              onClick={() => setActiveSheet(name)}
              className={cn(
                "shrink-0 rounded px-2 font-medium",
                name === activeSheet
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground",
              )}
            >
              {name}
            </Button>
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1">
        {/* key=activeSheet：切 sheet 时重置 DataTableViewer 的排序状态。 */}
        <DataTableViewer
          key={activeSheet}
          rows={rows}
          header={header}
          filename={filename || activeSheet || "sheet"}
        />
      </div>
    </div>
  );
}
