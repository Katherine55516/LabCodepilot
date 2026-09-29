"use client";

import { useState } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { prepareImage } from "../PptBlocks";
import type { PptBounds, PptRenderElement } from "../types";

const field =
  "w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm";
const button =
  "w-full rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent disabled:opacity-50";

export function PptInspector({
  element,
  slideId,
  onCommand,
  onAi,
  allowStructure = true,
}: {
  element: PptRenderElement;
  slideId: string;
  onCommand: (type: string, payload: unknown) => Promise<void>;
  onAi?: () => void;
  allowStructure?: boolean;
}) {
  const { t } = useTranslation();
  const text =
    element.kind === "text"
      ? element.content?.text || ""
      : element.content?.items?.map((item) => item.text).join("\n") || "";
  const [value, setValue] = useState(text);
  const [points, setPoints] = useState((element.content?.items || []).map((item) => ({
    id: item.id, heading: item.heading || (item.text.includes("\n") ? item.text.split("\n")[0] : ""),
    body: item.body || (item.text.includes("\n") ? item.text.split("\n").slice(1).join("\n") : item.text),
    pointType: item.pointType || "support",
  })));
  const [style, setStyle] = useState({ ...element.style });
  const [bounds, setBounds] = useState<PptBounds>(element.bounds);
  const [zIndex, setZIndex] = useState(element.zIndex);
  const [rotation, setRotation] = useState(element.rotation || 0);
  const [rows, setRows] = useState(
    (element.content?.rows || []).map((row) => row.join("\t")).join("\n"),
  );
  const [labels, setLabels] = useState(
    (element.content?.labels || []).join(", "),
  );
  const [values, setValues] = useState(
    (element.content?.values || []).join(", "),
  );
  const [chartType, setChartType] = useState(
    (element.content as { chartType?: string })?.chartType || "bar",
  );
  const node = { slideId, nodeId: element.nodeId };
  async function replaceImage(file: File) {
    await onCommand("node.setContent", {
      ...node,
      content: {
        ...element.content,
        dataUrl: await prepareImage(file),
        text: file.name,
      },
    });
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-xs text-muted-foreground">
          {element.kind} · {element.semanticRole || element.nodeId}
        </p>
        <span className="text-[10px] text-muted-foreground">
          {element.locked ? `🔒 ${t("ppt.editor.locked")}` : ""}
        </span>
      </div>
      {element.kind === "list" && element.content?.pointLayout && (
        <section className="space-y-2" aria-label="要点 / Points">
          {points.map((point, index) => <div key={point.id} className="space-y-1 rounded-lg border border-border p-2">
            <div className="flex items-center justify-between text-xs font-medium">
              <span>要点 {index + 1}</span>
              <button type="button" aria-label={`删除要点 ${index + 1}`} disabled={element.locked || !allowStructure}
                onClick={() => setPoints((current) => current.filter((item) => item.id !== point.id))}>×</button>
            </div>
            <input className={field} aria-label={`要点 ${index + 1} 标题`} value={point.heading}
              onChange={(event) => setPoints((current) => current.map((item) => item.id === point.id ? { ...item, heading: event.target.value } : item))} />
            <textarea className={`${field} min-h-20`} aria-label={`要点 ${index + 1} 说明`} value={point.body}
              onChange={(event) => setPoints((current) => current.map((item) => item.id === point.id ? { ...item, body: event.target.value } : item))} />
          </div>)}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className={button} disabled={element.locked || !allowStructure || points.length >= 10}
              onClick={() => setPoints((current) => [...current, { id: crypto.randomUUID().replaceAll("-", ""), heading: "", body: "", pointType: "support" }])}>＋ 要点</button>
            <button type="button" className={button} disabled={element.locked || points.some((point) => !point.body.trim())}
              onClick={() => void onCommand("node.setContent", { ...node, content: { items: points.map((point) => ({ ...point,
                text: point.heading.trim() ? `${point.heading.trim()}\n${point.body.trim()}` : point.body.trim() })) } })}>应用并重排</button>
          </div>
          {element.content.pointLayout.overflow && <p className="text-xs text-amber-600">内容超出当前页面容量；请缩短、改版式或拆页。</p>}
        </section>
      )}
      {["text", "timeline", "metric"].includes(element.kind) && (
        <section className="space-y-2">
          <textarea
            aria-label={t("ppt.structured.properties")}
            className={`${field} min-h-28`}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
          <button
            className={button}
            disabled={element.locked}
            onClick={() =>
              void onCommand("node.setContent", {
                ...node,
                content:
                  element.kind === "text"
                    ? { text: value }
                    : {
                        items: value
                          .split("\n")
                          .filter(Boolean)
                          .slice(0, 20)
                          .map((line, index) => ({
                            id:
                              element.content?.items?.[index]?.id ||
                              crypto.randomUUID().replaceAll("-", ""),
                            text: line,
                          })),
                      },
              })
            }
          >
            {t("ppt.structured.applyContent")}
          </button>
        </section>
      )}
      {element.kind === "chart" && (
        <section className="space-y-2">
          <label className="block text-xs">
            {t("ppt.editor.chartType")}
            <select
              className={field}
              value={chartType}
              onChange={(event) => setChartType(event.target.value)}
            >
              <option value="bar">{t("ppt.m4.bar")}</option>
              <option value="pie">{t("ppt.m4.pie")}</option>
              <option value="line">{t("ppt.editor.lineChart")}</option>
            </select>
          </label>
          <label className="block text-xs">
            {t("ppt.m4.labels")}
            <input
              className={field}
              value={labels}
              onChange={(event) => setLabels(event.target.value)}
            />
          </label>
          <label className="block text-xs">
            {t("ppt.m4.values")}
            <input
              className={field}
              value={values}
              onChange={(event) => setValues(event.target.value)}
            />
          </label>
          <button
            className={button}
            disabled={element.locked}
            onClick={() =>
              void onCommand("node.setContent", {
                ...node,
                content: {
                  ...element.content,
                  chartType,
                  labels: labels
                    .split(",")
                    .map((item) => item.trim())
                    .filter(Boolean),
                  values: values.split(",").map(Number).filter(Number.isFinite),
                },
              })
            }
          >
            {t("ppt.structured.applyContent")}
          </button>
        </section>
      )}
      {element.kind === "table" && (
        <section className="space-y-2">
          <textarea
            aria-label={t("ppt.m4.tableData")}
            className={`${field} min-h-28 font-mono text-xs`}
            value={rows}
            onChange={(event) => setRows(event.target.value)}
          />
          <button
            className={button}
            disabled={element.locked}
            onClick={() =>
              void onCommand("node.setContent", {
                ...node,
                content: {
                  ...element.content,
                  rows: rows
                    .split("\n")
                    .filter(Boolean)
                    .slice(0, 20)
                    .map((row) => row.split("\t").slice(0, 12)),
                },
              })
            }
          >
            {t("ppt.structured.applyContent")}
          </button>
        </section>
      )}
      {element.kind === "image" && (
        <label className={`${button} block cursor-pointer text-center`}>
          {t("ppt.editor.replaceImage")}
          <input
            className="sr-only"
            type="file"
            accept="image/png,image/jpeg"
            disabled={element.locked}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void replaceImage(file);
            }}
          />
        </label>
      )}
      <details open className="border-t border-border pt-3">
        <summary className="cursor-pointer text-xs font-medium">
          {t("ppt.inspector.textStyle")}
        </summary>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <label className="text-xs">
            {t("ppt.inspector.fontSize")}
            <input
              className={field}
              type="number"
              min={10}
              max={96}
              value={style.fontSizePt || 18}
              onChange={(event) =>
                setStyle((current) => ({
                  ...current,
                  fontSizePt: Number(event.target.value),
                }))
              }
            />
          </label>
          <label className="text-xs">
            {t("ppt.inspector.fontWeight")}
            <select
              className={field}
              value={style.fontWeight || 400}
              onChange={(event) =>
                setStyle((current) => ({
                  ...current,
                  fontWeight: Number(event.target.value),
                }))
              }
            >
              <option value="400">{t("ppt.editor.weightRegular")}</option>
              <option value="600">{t("ppt.editor.weightSemibold")}</option>
              <option value="700">{t("ppt.editor.weightBold")}</option>
            </select>
          </label>
          <label className="text-xs">
            {t("ppt.inspector.color")}
            <input
              className={`${field} h-9`}
              type="color"
              value={style.color || "#111111"}
              onChange={(event) =>
                setStyle((current) => ({
                  ...current,
                  color: event.target.value,
                }))
              }
            />
          </label>
          <label className="text-xs">
            {t("ppt.inspector.alignment")}
            <select
              className={field}
              value={style.textAlign || "left"}
              onChange={(event) =>
                setStyle((current) => ({
                  ...current,
                  textAlign: event.target.value,
                }))
              }
            >
              <option value="left">{t("ppt.inspector.left")}</option>
              <option value="center">{t("ppt.inspector.center")}</option>
              <option value="right">{t("ppt.inspector.right")}</option>
            </select>
          </label>
          <label className="text-xs">
            {t("ppt.editor.lineHeight")}
            <input
              className={field}
              type="number"
              min={0.8}
              max={3}
              step={0.1}
              value={style.lineHeight || 1.2}
              onChange={(event) =>
                setStyle((current) => ({
                  ...current,
                  lineHeight: Number(event.target.value),
                }))
              }
            />
          </label>
          <label className="text-xs">
            {t("ppt.editor.opacity")}
            <input
              className={field}
              type="number"
              min={0}
              max={100}
              value={Math.round((style.opacity ?? 1) * 100)}
              onChange={(event) =>
                setStyle((current) => ({
                  ...current,
                  opacity: Number(event.target.value) / 100,
                }))
              }
            />
          </label>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button
            className={button}
            disabled={element.locked}
            onClick={() => void onCommand("node.setStyle", { ...node, style })}
          >
            {t("ppt.inspector.applyStyle")}
          </button>
          <button
            className={button}
            disabled={element.locked}
            onClick={() =>
              void onCommand("node.setStyle", { ...node, style: null })
            }
          >
            {t("ppt.editor.resetTheme")}
          </button>
        </div>
      </details>
      <details className="border-t border-border pt-3">
        <summary className="cursor-pointer text-xs font-medium">
          {t("ppt.inspector.positionLayer")}
        </summary>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {(["x", "y", "width", "height"] as const).map((key) => (
            <label key={key} className="text-xs">
              {key}
              <input
                className={field}
                type="number"
                value={bounds[key]}
                onChange={(event) =>
                  setBounds((current) => ({
                    ...current,
                    [key]: Number(event.target.value),
                  }))
                }
              />
            </label>
          ))}
        </div>
        <button
          className={`${button} mt-2`}
          disabled={element.locked}
          onClick={() =>
            void onCommand("node.setGeometry", { ...node, geometry: bounds })
          }
        >
          {t("ppt.inspector.applyPosition")}
        </button>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <label className="text-xs">
            {t("ppt.inspector.layer")}
            <input
              className={field}
              type="number"
              min={0}
              max={1000}
              value={zIndex}
              onChange={(event) => setZIndex(Number(event.target.value))}
            />
          </label>
          <label className="text-xs">
            {t("ppt.editor.rotation")}
            <input
              className={field}
              type="number"
              min={-360}
              max={360}
              value={rotation}
              onChange={(event) => setRotation(Number(event.target.value))}
            />
          </label>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button
            className={button}
            disabled={element.locked}
            onClick={() =>
              void onCommand("node.setZIndex", { ...node, zIndex })
            }
          >
            {t("ppt.inspector.applyLayer")}
          </button>
          <button
            className={button}
            disabled={element.locked}
            onClick={() =>
              void onCommand("node.setRotation", { ...node, rotation })
            }
          >
            {t("ppt.editor.applyRotation")}
          </button>
        </div>
      </details>
      <div className="grid grid-cols-2 gap-2 border-t border-border pt-3">
        <button
          className={button}
          onClick={() =>
            void onCommand("node.setLocked", {
              ...node,
              locked: !element.locked,
            })
          }
        >
          {element.locked ? t("ppt.editor.unlock") : t("ppt.editor.lock")}
        </button>
        <button className={button} disabled={element.locked} onClick={onAi}>
          {t("ppt.structured.aiEdit")}
        </button>
        <button
          className={button}
          disabled={!allowStructure}
          onClick={() => void onCommand("node.duplicate", node)}
        >
          {t("ppt.editor.duplicate")}
        </button>
        <button
          className={`${button} text-destructive`}
          disabled={element.locked || !allowStructure}
          onClick={() => void onCommand("node.delete", node)}
        >
          {t("ppt.delete")}
        </button>
      </div>
    </div>
  );
}
