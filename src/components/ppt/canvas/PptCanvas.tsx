"use client";
/* eslint-disable @next/next/no-img-element -- Presentation IR images are bounded local data URLs. */

import { useEffect, useRef, useState } from "react";
import DOMPurify from "dompurify";
import { useTranslation } from "@/hooks/useTranslation";
import type { PptBounds, PptRenderElement, PptRenderSlide, PptRichText } from "../types";
import {imageMask} from '../../../../apps/cowork-server/lib/ppt/image-mask.mjs';
import {cssFontFamily} from '../../../../apps/cowork-server/lib/ppt/font-family.mjs';

export function RichText({value}:{value:PptRichText}){
  return <>{value.runs.map((run,i)=>run.kind==='math'&&run.mathMl?
    <span key={i} aria-label={run.source} style={{display:'inline',fontWeight:run.bold?700:undefined}}
      dangerouslySetInnerHTML={{__html:DOMPurify.sanitize(run.mathMl,{USE_PROFILES:{mathMl:true}})}}/>:
    <span key={i} style={{fontWeight:run.bold?700:undefined,fontStyle:run.italic?'italic':undefined,textDecoration:run.strike?'line-through':undefined,fontFamily:run.code?'Consolas,monospace':undefined,...(run.baseline?{verticalAlign:run.baseline<0?'sub':'super',fontSize:'0.7em'}:{})}}>{run.text}</span>)}</>;
}

type GeometryChange = { element: PptRenderElement; bounds: PptBounds };
type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
type DragState = {
  mode: "move" | "resize" | "rotate" | "marquee";
  startX: number;
  startY: number;
  handle?: ResizeHandle;
  element?: PptRenderElement;
  elements?: { element: PptRenderElement; bounds: PptBounds }[];
  bounds?: PptBounds;
  rotation?: number;
};

const handles: { id: ResizeHandle; className: string }[] = [
  { id: "nw", className: "-left-1.5 -top-1.5 cursor-nwse-resize" },
  { id: "n", className: "left-1/2 -top-1.5 -translate-x-1/2 cursor-ns-resize" },
  { id: "ne", className: "-right-1.5 -top-1.5 cursor-nesw-resize" },
  {
    id: "e",
    className: "-right-1.5 top-1/2 -translate-y-1/2 cursor-ew-resize",
  },
  { id: "se", className: "-bottom-1.5 -right-1.5 cursor-nwse-resize" },
  {
    id: "s",
    className: "-bottom-1.5 left-1/2 -translate-x-1/2 cursor-ns-resize",
  },
  { id: "sw", className: "-bottom-1.5 -left-1.5 cursor-nesw-resize" },
  { id: "w", className: "-left-1.5 top-1/2 -translate-y-1/2 cursor-ew-resize" },
];

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));
const intersects = (a: PptBounds, b: PptBounds) =>
  a.x < b.x + b.width &&
  a.x + a.width > b.x &&
  a.y < b.y + b.height &&
  a.y + a.height > b.y;

/** Arrows between consecutive flow cards (same geometry as the PPTX connectors). */
/** A rail beside stacked steps (Fable M2): a line through a dot at each card's middle. */
function StepRail({ layout }: { layout: NonNullable<NonNullable<PptRenderElement["content"]>["pointLayout"]> }) {
  const color = layout.accent || "#6758c8", x = Number(layout.rail?.x || 0) * 100, mids = layout.boxes.map(box => (box.y + box.h / 2) * 100);
  return <>
    {mids.length > 1 && <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><line x1={x} y1={mids[0]} x2={x} y2={mids[mids.length - 1]} stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" /></svg>}
    {mids.map((mid, index) => <div key={index} aria-hidden="true" className="pointer-events-none absolute rounded-full" style={{ left: `calc(${x}% - 6px)`, top: `calc(${mid}% - 6px)`, width: 12, height: 12, background: color }} />)}
  </>;
}
function FlowConnectors({ layout }: { layout: NonNullable<NonNullable<PptRenderElement["content"]>["pointLayout"]> }) {
  const color = layout.accent || "#6758c8";
  return <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
    <defs><marker id="ppt-flow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill={color}/></marker></defs>
    {(layout.connectors || []).map(({ from, to, points }) => {
      const a = layout.boxes[from], b = layout.boxes[to];
      if (!a || !b) return null;
      const sameRow = Math.abs(a.y - b.y) < 0.005 && b.x > a.x;
      const [x1, y1, x2, y2] = sameRow ? [(a.x + a.w) * 100, (a.y + a.h / 2) * 100, b.x * 100, (b.y + b.h / 2) * 100] : [(a.x + a.w / 2) * 100, (a.y + a.h) * 100, (b.x + b.w / 2) * 100, b.y * 100];
      const route = points?.length ? points : [{x:x1/100,y:y1/100},{x:x2/100,y:y2/100}];
      return <polyline key={`${from}-${to}`} points={route.map(p=>`${p.x*100},${p.y*100}`).join(' ')} fill="none" stroke={color} strokeWidth={1.4} vectorEffect="non-scaling-stroke" markerEnd="url(#ppt-flow-arrow)" />;
    })}
  </svg>;
}

function Chart({ element }: { element: PptRenderElement }) {
  const axis=element.chartLayout;
  if(axis?.svg) return <svg viewBox={`0 0 ${element.bounds.width} ${element.bounds.height}`} className="h-full w-full"
    role="img" aria-label={`${element.content?.unit || ''}: ${(element.content?.values || []).join(', ')}`}
    dangerouslySetInnerHTML={{__html:DOMPurify.sanitize(`<svg xmlns="http://www.w3.org/2000/svg">${axis.svg}</svg>`,{USE_PROFILES:{svg:true},ADD_ATTR:['data-value']}).replace(/^<svg[^>]*>|<\/svg>$/g,'')}} />;
  // Legacy trees are rebuilt on the server. Preserve signed values while that
  // refresh is pending rather than showing an incorrect absolute-value chart.
  return <div className="flex h-full flex-col justify-center text-xs">
    {(element.content?.labels || []).map((label,i)=><div key={i}>{label}: {element.content?.values?.[i]} {element.content?.unit}</div>)}
  </div>;
}

function ElementContent({
  element,
  scale,
  editing,
  onEdit,
  onCommit,
  onCancel,
  onTextSelection,
  onMemberSelection,
}: {
  element: PptRenderElement;
  scale: number;
  editing: boolean;
  onEdit: () => void;
  onCommit: (text: string) => void;
  onCancel: () => void;
  onTextSelection?: (start:number,end:number,text:string)=>void;
  onMemberSelection?: (itemId:string)=>void;
}) {
  // Esc discards the edit: the blur it triggers must not commit.
  const discard=useRef(false);
  const contract=element.textLayout;
  const margins=contract?.margins || [3.6,3.6,3.6,3.6];
  const padding=`${margins[1]*scale}px ${margins[2]*scale}px ${margins[3]*scale}px ${margins[0]*scale}px`;
  const textStyle = {
    color: element.style?.color,
    fontFamily: contract?.code && !element.textStyleOverrides?.includes('fontFamily') ? "'Consolas','Noto Sans Mono CJK SC','Noto Sans Mono CJK TC','DejaVu Sans Mono','Liberation Mono','Menlo',monospace" : cssFontFamily(contract?.fontFamily || element.style?.fontFamily,element.style?.eastAsiaFontFamily,element.style?.previewFontFamily),
    // The canvas is 960 px wide for a 13.333 in slide: 72 px/in, so one
    // PowerPoint point maps to one canvas pixel before responsive scaling.
    fontSize: `${(element.style?.fontSizePt || 18) * scale}px`,
    fontWeight: element.style?.previewFontWeight ?? element.style?.fontWeight,
    fontStyle: element.style?.fontStyle,
    textDecoration: element.style?.textDecoration,
    textAlign: element.style?.textAlign as
      "left" | "center" | "right" | undefined,
    lineHeight: element.style?.lineHeight,
    letterSpacing: element.style?.letterSpacing
      ? `${element.style.letterSpacing}px`
      : undefined,
    opacity: element.style?.opacity ?? 1,
  };
  const text =
    element.kind === "text"
      ? element.content?.richText?.source ?? element.content?.rawText ?? element.content?.text ?? ""
      : (element.content?.items || []).map((item) => item.richText?.source ?? item.text).join("\n");
  if (editing && !element.content?.pointLayout && ["text", "list", "timeline", "metric"].includes(element.kind))
    return (
      <textarea
        autoFocus
        defaultValue={text}
        className="h-full w-full resize-none bg-transparent outline-none"
        style={{...textStyle,padding,whiteSpace:"pre-wrap",overflowWrap:contract?.overflowWrap||"anywhere",tabSize:4}}
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        onSelect={event=>{const el=event.currentTarget;if(el.value===text&&el.selectionEnd>el.selectionStart)onTextSelection?.(el.selectionStart,el.selectionEnd,el.value.slice(el.selectionStart,el.selectionEnd));}}
        onBlur={(event) => { if (discard.current) { discard.current = false; onCancel(); } else onCommit(event.currentTarget.value); }}
        onKeyDown={(event) => {
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); discard.current = true; event.currentTarget.blur(); }
        }}
      />
    );
  if(element.kind==='shape'&&element.shapeLayout?.svg)return <div className="h-full w-full" dangerouslySetInnerHTML={{__html:DOMPurify.sanitize(element.shapeLayout.svg,{USE_PROFILES:{svg:true}})}}/>;
  if (element.kind === "text" && element.content?.mathMl)
    return <div className="flex h-full items-center overflow-hidden" style={textStyle} onDoubleClick={onEdit}
      aria-label={element.content.mathText || element.content.text}
      dangerouslySetInnerHTML={{__html:DOMPurify.sanitize(element.content.mathMl,{USE_PROFILES:{mathMl:true}})}} />;
  if(element.kind==='text'&&element.content?.richText&&!element.nativeRef)
    return <div className="h-full overflow-hidden whitespace-pre-wrap" style={{...textStyle,padding,overflowWrap:'anywhere'}} onDoubleClick={onEdit}><RichText value={element.content.richText}/></div>;
  if (element.kind === "text")
    return (
      <div
        className="h-full overflow-hidden whitespace-pre-wrap"
        style={{...textStyle,padding,overflowWrap:contract?.overflowWrap||"anywhere",tabSize:contract?.tabSize || 4}}
        onDoubleClick={onEdit}
      >
        {contract?.paragraphs ? contract.paragraphs.map((p,i)=><div key={i} style={{fontSize:p.runs?.length?Math.max(...p.runs.map(r=>r.fontSizePt))*scale:undefined,minHeight:`${p.lineHeight}em`,lineHeight:p.lineHeight,marginBottom:i===contract.paragraphs.length-1?0:p.spaceAfterPt*scale}}>
          {p.runs?p.runs.map((run,j)=><span key={j} style={{fontSize:run.fontSizePt*scale,fontFamily:cssFontFamily(run.fontFamily||element.style?.fontFamily,element.style?.eastAsiaFontFamily,element.style?.previewFontFamily),color:run.color||undefined,textDecoration:run.underline?'underline':undefined,fontWeight:run.bold||element.style?.previewFontWeight&&/bold/iu.test(run.fontFamily||'')?700:400,fontStyle:run.italic?'italic':undefined}}><RichText value={{version:2,source:run.text,plainText:run.text,diagnostics:[],runs:[{...run,kind:run.kind==='math'?'math':'text'}]}}/></span>):p.text}</div>) : element.content?.text}
      </div>
    );
  if (["list", "timeline", "metric"].includes(element.kind))
    return (
      <div
        className="relative h-full overflow-hidden"
        style={{...textStyle,padding:element.content?.pointLayout?0:padding,whiteSpace:"pre-wrap",overflowWrap:contract?.overflowWrap||"anywhere"}}
        onDoubleClick={element.content?.pointLayout ? undefined : onEdit}
      >
        {element.kind === "list" && element.content?.pointLayout?.boxes &&
          element.content.items?.map((item, index) => {
            const box = element.content?.pointLayout?.boxes[index];
            if (!box) return null;
            const parts = item.heading || item.body
              ? { heading: item.heading || "", body: item.body || "" }
              : item.text.includes("\n")
                ? { heading: item.text.split("\n")[0], body: item.text.split("\n").slice(1).join("\n") }
                : { heading: "", body: item.text };
            const layout = element.content?.pointLayout, variant = layout?.variant, accent = layout?.accent || "#6758c8";
            const tinted = variant === "layer-stack" || variant === "card-grid" || variant === "kpi";
            // The template's card panel; an uploaded template's dark panel fills every card with light text (Fable M1).
            const panel = layout?.panelFill && (layout.panelText || variant === "card-grid" || variant === "kpi") ? layout.panelFill : undefined;
            // A marker before the heading (Fable M2): a circle in the card's left margin.
            const marker = layout?.markers?.[index];
            const markerPt = marker ? (String(marker).length < 2 ? Math.min(11, (layout?.fontSizePt || 17) * .7) : Math.min(9, (layout?.fontSizePt || 17) * .55)) : 0;
            const tint = variant === "layer-stack" ? 0.16 + Math.min(index, 6) * 0.05 : 0.09;
            // A heading is bold unless the author set the element's weight (as exported).
            const headingWeight = element.textStyleOverrides?.includes('fontWeight') ? element.style?.fontWeight : undefined;
            return <div key={item.id} data-item-id={item.id} onDoubleClick={event=>{if(onMemberSelection){event.stopPropagation();onMemberSelection(item.id);}}} data-diagram-variant={variant || undefined} className={`absolute overflow-hidden rounded-md border ${tinted ? "" : "border-current/20"}`}
              style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%`,
                ...(panel ? { borderColor: panel, background: panel, ...(layout?.panelText ? { color: layout.panelText } : {}) } : tinted ? { borderColor: accent, background: `color-mix(in srgb, ${accent} ${Math.round(tint * 100)}%, transparent)` } : {}),
                padding:`${5.04*scale}px ${7.92*scale}px ${2.88*scale}px ${(7.92+(marker?(layout?.markerInches||.34)*72:0))*scale}px`,lineHeight:layout?.lineHeight || 1.18,overflowWrap:contract?.overflowWrap||"anywhere",whiteSpace:"pre-wrap",fontSize: `${(layout?.fontSizePt || 17) * scale}px` }}>
              {marker ? <div aria-hidden="true" className="absolute flex items-center justify-center rounded-full font-bold" style={{ left: 7.92*scale, top: 5.04*scale, width: .26*72*scale, height: .26*72*scale, fontSize: markerPt*scale, background: layout?.panelText || layout?.markerFill || accent, color: layout?.panelText ? layout?.panelFill : layout?.markerText || "#ffffff" }}>{marker}</div> : null}
              {parts.heading && layout?.inlineHeading ? <div className="whitespace-pre-wrap"><span className="font-semibold" style={{fontWeight:headingWeight}}>{parts.heading}</span>{"\u3000"}{parts.body}</div> : null}
              {parts.heading && !layout?.inlineHeading && <div className="font-semibold" style={{fontWeight:headingWeight,marginBottom:3*scale,fontSize:`${(layout?.headingFontSizePt || layout?.fontSizePt || 17) * scale}px`,color:(variant === "card-grid" || variant === "kpi") && !layout?.panelText ? accent : undefined}}>{item.headingRich?<RichText value={item.headingRich}/>:parts.heading}</div>}
              {!(parts.heading && layout?.inlineHeading) && <div className="whitespace-pre-wrap">{item.bodyRich?<RichText value={item.bodyRich}/>:parts.body}</div>}
            </div>;
          })}
        {element.kind === "list" && element.content?.pointLayout?.connectors?.length ? <FlowConnectors layout={element.content.pointLayout} /> : null}
        {element.kind === "list" && element.content?.pointLayout?.rail ? <StepRail layout={element.content.pointLayout} /> : null}
        {!element.content?.pointLayout && element.content?.items?.map((item, index) => (
          <div key={item.id} data-item-id={item.id} onDoubleClick={event=>{if(onMemberSelection){event.stopPropagation();onMemberSelection(item.id);}}} style={{lineHeight:contract?.paragraphs[index]?.lineHeight,marginBottom:(contract?.paragraphs[index]?.spaceAfterPt || 0)*scale}}>
            {element.kind === "timeline"
              ? /^\s*\d+[.)]\s/u.test(item.text || "") ? "" : `${index + 1}. `
              : element.kind === "list"
                ? "• "
                : ""}
            {item.richText?<RichText value={item.richText}/>:item.text}
          </div>
        ))}
      </div>
    );
  if (element.kind === "image" && element.content?.dataUrl)
    return (() => {
      const crop = element.imageLayout?.valid ? element.imageLayout.crop : element.content?.crop || [0, 0, 0, 0];
      const [left, top, right, bottom] = crop.map((value) => element.imageLayout?.valid ? value : Math.max(0, Math.min(0.95, Number(value) || 0)));
      const width = 100 / Math.max(Number.EPSILON, 1 - left - right);
      const height = 100 / Math.max(Number.EPSILON, 1 - top - bottom);
      const mask=element.imageLayout?.mask || imageMask(element.content?.nativeMaskXml || element.content?.maskXml);
      return <div className="relative h-full w-full overflow-hidden" style={{clipPath:mask.status==='supported'?mask.css:undefined}}><img
        src={element.content!.dataUrl}
        alt={element.content!.text || ""}
        className="absolute max-w-none"
        style={{ width: `${width}%`, height: `${height}%`, left: `${-left * width}%`, top: `${-top * height}%`, objectFit: element.imageLayout?.fit==='cover'?'cover':element.imageLayout?.fit==='stretch'||element.imageLayout?.fit==='crop'?'fill':'contain' }}
        draggable={false}
      /></div>;
    })();
  if (element.kind === "table")
    return (() => {
      const rows = element.content?.rows || [];
      const columns = element.content?.columnWeights || rows[0]?.map(() => 1) || [];
      const rowWeights = element.content?.rowWeights || rows.map(() => 1);
      const columnSum = columns.reduce((sum, value) => sum + value, 0) || 1;
      const rowSum = rowWeights.reduce((sum, value) => sum + value, 0) || 1;
      return <table className="h-full w-full table-fixed border-collapse" style={{...textStyle, lineHeight:1.18}}>
        <colgroup>{columns.map((weight, index) => <col key={index} style={{width:`${weight / columnSum * 100}%`}} />)}</colgroup>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} style={{height:`${rowWeights[rowIndex] / rowSum * 100}%`}}>
              {row.map((cell, columnIndex) => (
                <td
                  key={columnIndex}
                  className={`border border-current/30 whitespace-pre-wrap break-words ${rowIndex === 0 && element.content?.headerRow !== false ? "font-bold" : ""}`}
                  style={{padding:`${3 * scale}px ${7.2 * scale}px`,verticalAlign:'top',overflowWrap:'anywhere',
                    background:rowIndex === 0 && element.content?.headerRow !== false ? element.style?.fill || '#e7e5f4' : '#ffffff',
                    color:rowIndex === 0 && element.content?.headerRow !== false ? element.style?.tableHeaderColor || element.style?.color : element.style?.color}}
                >
                  {element.content?.cellRich?.[rowIndex]?.[columnIndex]?<RichText value={element.content.cellRich[rowIndex][columnIndex]}/>:cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>;
    })();
  if (element.kind === "chart") return <Chart element={element} />;
  return (
    <div className="grid h-full place-items-center overflow-hidden text-xs">
      {element.content?.text || ""}
    </div>
  );
}

function resized(
  start: PptBounds,
  handle: ResizeHandle,
  dx: number,
  dy: number,
  size: PptRenderSlide["size"],
): PptBounds {
  const min = 91440;
  let { x, y, width, height } = start;
  if (handle.includes("e"))
    width = clamp(start.width + dx, min, size.width - x);
  if (handle.includes("s"))
    height = clamp(start.height + dy, min, size.height - y);
  if (handle.includes("w")) {
    const next = clamp(start.x + dx, 0, start.x + start.width - min);
    width += x - next;
    x = next;
  }
  if (handle.includes("n")) {
    const next = clamp(start.y + dy, 0, start.y + start.height - min);
    height += y - next;
    y = next;
  }
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };
}

export function PptCanvas({
  slide,
  selectedIds,
  onSelect,
  onSelectMany,
  onSelectionComplete,
  onGeometry,
  onRotation,
  onContent,
  onTextSelection,
  onMemberSelection,
  onAction,
  allowStructure = true,
  readOnly = false,
  advisories,
}: {
  slide: PptRenderSlide;
  selectedIds: string[];
  onSelect: (id: string | null, additive?: boolean) => void;
  onSelectMany: (ids: string[]) => void;
  onSelectionComplete?: (element:PptRenderElement)=>void;
  onGeometry: (changes: GeometryChange[]) => void;
  onRotation: (element: PptRenderElement, rotation: number) => void;
  /** Returns a message when the edit cannot be saved; the editor then stays open. */
  onContent: (element: PptRenderElement, text: string) => string | void;
  onTextSelection?: (element:PptRenderElement,start:number,end:number,text:string)=>void;
  onMemberSelection?: (element:PptRenderElement,itemId:string)=>void;
  onAction: (
    action: "delete" | "duplicate" | "lock" | "front" | "back" | "ai",
    element: PptRenderElement,
  ) => void;
  allowStructure?: boolean;
  readOnly?: boolean;
  /** Open deck-review findings by node ID (the reviewer's detail). Editor
   * overlay only: drawn here, never part of the slide or its export. */
  advisories?: Record<string, string>;
}) {
  const { t } = useTranslation();
  const root = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [draft, setDraft] = useState<Record<string, PptBounds>>({});
  const [draftRotation, setDraftRotation] = useState<Record<string, number>>(
    {},
  );
  const draftRef = useRef<Record<string, PptBounds>>({});
  const rotationRef = useRef<Record<string, number>>({});
  const [guides, setGuides] = useState<{ x?: number; y?: number }>({});
  const [marquee, setMarquee] = useState<PptBounds | null>(null);
  const marqueeRef = useRef<PptBounds | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editError, setEditError] = useState<{ id: string; message: string } | null>(null);
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    element: PptRenderElement;
  } | null>(null);
  const movedSelection = useRef(false);
  const drag = useRef<DragState | null>(null);
  useEffect(() => {
    if (!root.current) return;
    const observer = new ResizeObserver((entries) =>
      setScale(entries[0]?.contentRect.width / (slide.size.width / 12700) || 1),
    );
    observer.observe(root.current);
    return () => observer.disconnect();
  }, [slide.size.width]);
  const pct = (value: number, total: number) => `${(value / total) * 100}%`;
  const point = (event: React.PointerEvent) => {
    const rect = root.current!.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * slide.size.width,
      y: ((event.clientY - rect.top) / rect.height) * slide.size.height,
      rect,
    };
  };
  function snapMove(bounds: PptBounds, movingIds: Set<string>) {
    const threshold =
      (slide.size.width * 6) / Math.max(1, root.current?.clientWidth || 960);
    let x = clamp(bounds.x, 0, slide.size.width - bounds.width);
    let y = clamp(bounds.y, 0, slide.size.height - bounds.height);
    const xTargets = [0, slide.size.width / 2, slide.size.width];
    const yTargets = [0, slide.size.height / 2, slide.size.height];
    for (const element of slide.elements)
      if (!movingIds.has(element.id)) {
        xTargets.push(
          element.bounds.x,
          element.bounds.x + element.bounds.width / 2,
          element.bounds.x + element.bounds.width,
        );
        yTargets.push(
          element.bounds.y,
          element.bounds.y + element.bounds.height / 2,
          element.bounds.y + element.bounds.height,
        );
      }
    const xPoints = [
      { value: x, offset: 0 },
      { value: x + bounds.width / 2, offset: bounds.width / 2 },
      { value: x + bounds.width, offset: bounds.width },
    ];
    const yPoints = [
      { value: y, offset: 0 },
      { value: y + bounds.height / 2, offset: bounds.height / 2 },
      { value: y + bounds.height, offset: bounds.height },
    ];
    let guideX: number | undefined;
    let guideY: number | undefined;
    outerX: for (const target of xTargets)
      for (const candidate of xPoints)
        if (Math.abs(target - candidate.value) <= threshold) {
          x = target - candidate.offset;
          guideX = target;
          break outerX;
        }
    outerY: for (const target of yTargets)
      for (const candidate of yPoints)
        if (Math.abs(target - candidate.value) <= threshold) {
          y = target - candidate.offset;
          guideY = target;
          break outerY;
        }
    setGuides({ x: guideX, y: guideY });
    return {
      ...bounds,
      x: Math.round(clamp(x, 0, slide.size.width - bounds.width)),
      y: Math.round(clamp(y, 0, slide.size.height - bounds.height)),
    };
  }
  function startMove(event: React.PointerEvent, element: PptRenderElement) {
    // A pinned element (a template layout picture) is selected, never moved.
    if (readOnly || element.locked) return;
    if (element.pinned) { if (!selectedIds.includes(element.nodeId || "")) onSelect(element.nodeId); return; }
    event.currentTarget.setPointerCapture(event.pointerId);
    const selected = selectedIds.includes(element.nodeId || "")
      ? selectedIds
      : [element.nodeId!];
    movedSelection.current=false;
    if (!selectedIds.includes(element.nodeId || "")) onSelect(element.nodeId);
    const group = element.groupId
      ? slide.elements.filter(
          (item) => item.groupId === element.groupId && item.nodeId,
        )
      : [];
    const ids = new Set(
      group.length ? group.map((item) => item.nodeId!) : selected,
    );
    const elements = slide.elements
      .filter((item) => item.nodeId && ids.has(item.nodeId) && !item.locked && !item.pinned)
      .map((item) => ({
        element: item,
        bounds: draft[item.id] || item.bounds,
      }));
    drag.current = {
      mode: "move",
      startX: event.clientX,
      startY: event.clientY,
      element,
      elements,
    };
  }
  function pointerMove(event: React.PointerEvent) {
    if (!drag.current || !root.current) return;
    const rect = root.current.getBoundingClientRect();
    const dx =
      ((event.clientX - drag.current.startX) / rect.width) * slide.size.width;
    const dy =
      ((event.clientY - drag.current.startY) / rect.height) * slide.size.height;
    if (drag.current.mode === "marquee") {
      const origin = {
        x: ((drag.current.startX - rect.left) / rect.width) * slide.size.width,
        y: ((drag.current.startY - rect.top) / rect.height) * slide.size.height,
      };
      const current = point(event);
      const next = {
        x: Math.min(origin.x, current.x),
        y: Math.min(origin.y, current.y),
        width: Math.abs(current.x - origin.x),
        height: Math.abs(current.y - origin.y),
      };
      marqueeRef.current = next;
      setMarquee(next);
      return;
    }
    if (drag.current.mode === "move" && drag.current.elements?.length) {
      const ids = new Set(drag.current.elements.map((item) => item.element.id));
      const primary =
        drag.current.elements.find(
          (item) => item.element.id === drag.current!.element!.id,
        ) || drag.current.elements[0];
      const snapped = snapMove(
        {
          ...primary.bounds,
          x: primary.bounds.x + dx,
          y: primary.bounds.y + dy,
        },
        ids,
      );
      const adjustX = snapped.x - primary.bounds.x;
      const adjustY = snapped.y - primary.bounds.y;
      setDraft((current) => {
        const next = {
          ...current,
          ...Object.fromEntries(
            drag.current!.elements!.map((item) => [
              item.element.id,
              {
                ...item.bounds,
                x: Math.round(
                  clamp(
                    item.bounds.x + adjustX,
                    0,
                    slide.size.width - item.bounds.width,
                  ),
                ),
                y: Math.round(
                  clamp(
                    item.bounds.y + adjustY,
                    0,
                    slide.size.height - item.bounds.height,
                  ),
                ),
              },
            ]),
          ),
        };
        draftRef.current = next;
        return next;
      });
      return;
    }
    if (
      drag.current.mode === "resize" &&
      drag.current.element &&
      drag.current.bounds &&
      drag.current.handle
    )
      setDraft((current) => {
        const next = {
          ...current,
          [drag.current!.element!.id]: resized(
            drag.current!.bounds!,
            drag.current!.handle!,
            dx,
            dy,
            slide.size,
          ),
        };
        draftRef.current = next;
        return next;
      });
    if (
      drag.current.mode === "rotate" &&
      drag.current.element &&
      drag.current.bounds
    ) {
      const p = point(event);
      const cx = drag.current.bounds.x + drag.current.bounds.width / 2;
      const cy = drag.current.bounds.y + drag.current.bounds.height / 2;
      setDraftRotation((current) => {
        const next = {
          ...current,
          [drag.current!.element!.id]: Math.round(
            (Math.atan2(p.y - cy, p.x - cx) * 180) / Math.PI + 90,
          ),
        };
        rotationRef.current = next;
        return next;
      });
    }
  }
  function pointerUp() {
    const active = drag.current;
    if (!active) return;
    if (active.mode === "marquee" && marqueeRef.current)
      onSelectMany(
        slide.elements
          .filter(
            (element) =>
              element.nodeId && intersects(element.bounds, marqueeRef.current!),
          )
          .map((element) => element.nodeId!),
      );
    if (active.mode === "move" && active.elements) {
      const changes = active.elements.map((item) => ({
          element: item.element,
          bounds: draftRef.current[item.element.id] || item.bounds,
        })).filter(item => Object.entries(item.bounds).some(([key,value]) => value !== active.elements!.find(original => original.element.id === item.element.id)!.bounds[key as keyof PptBounds]));
      if (changes.length) onGeometry(changes);
    }
    if (active.mode === "resize" && active.element)
      onGeometry([
        {
          element: active.element,
          bounds: draftRef.current[active.element.id] || active.bounds!,
        },
      ]);
    if (active.mode === "rotate" && active.element)
      onRotation(
        active.element,
        rotationRef.current[active.element.id] ?? active.rotation ?? 0,
      );
    drag.current = null;
    // The editor now shows the committed position optimistically; a kept
    // draft would hide later undo, nudges or a rejected (rolled back) move.
    draftRef.current = {}; rotationRef.current = {};
    setDraft({}); setDraftRotation({});
    setGuides({});
    setMarquee(null);
    marqueeRef.current = null;
  }
  const ObjectTag=readOnly?'div':'button';
  return (
    <div
      ref={root}
      tabIndex={readOnly?undefined:0}
      className="relative isolate aspect-video w-full select-none overflow-hidden rounded-lg border border-border shadow-sm outline-none"
      style={{ background: slide.background || "#fff", aspectRatio: `${slide.size.width} / ${slide.size.height}` }}
      onClick={() => {
        setMenu(null);
        if (!readOnly) onSelect(null);
      }}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => {
        if (readOnly || event.target !== event.currentTarget) return;
        drag.current = {
          mode: "marquee",
          startX: event.clientX,
          startY: event.clientY,
        };
        setMarquee(null);
        marqueeRef.current = null;
      }}
      onPointerMove={event=>{if(drag.current&&Math.hypot(event.clientX-drag.current.startX,event.clientY-drag.current.startY)>4)movedSelection.current=true;pointerMove(event);}}
      onPointerUp={pointerUp}
    >
      {slide.elements.map((element) => {
        const b = draft[element.id] || element.bounds;
        const nodeId = element.nodeId;
        const selected = Boolean(nodeId && selectedIds.includes(nodeId));
        const movable = Boolean(
          nodeId && element.id === nodeId && !element.locked && !element.pinned && !readOnly,
        );
        const rotation = draftRotation[element.id] ?? element.rotation ?? 0;
        // Only the node's own element carries the flag, not its member parts.
        const advisory = nodeId && element.id === nodeId ? advisories?.[nodeId] : undefined;
        return (
          <ObjectTag
            key={element.id}
            {...(readOnly?{}:{type:"button" as const})}
            data-node-id={nodeId || undefined}
            data-review-advisory={advisory ? "open" : undefined}
            title={advisory ? t("ppt.advisory.nodeFlag").replace("{detail}", advisory) : undefined}
            onClick={(event) => {
              event.stopPropagation();
              if(movedSelection.current){movedSelection.current=false;return;}
              if(nodeId&&!readOnly&&!event.shiftKey&&!event.metaKey&&!event.ctrlKey)onSelectionComplete?.(element);
              if (nodeId && !readOnly)
                onSelect(
                  nodeId,
                  event.shiftKey || event.metaKey || event.ctrlKey,
                );
            }}
            onDoubleClick={(event) => {
              event.stopPropagation();
              if (
                nodeId &&
                !readOnly &&
                !element.locked &&
                ["text", "list", "timeline", "metric"].includes(element.kind)
              )
                setEditingId(element.id);
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (nodeId && !readOnly) {
                onSelect(nodeId);
                setMenu({ x: event.clientX, y: event.clientY, element });
              }
            }}
            onPointerDown={(event) => {
              event.stopPropagation();
              if (movable && editingId !== element.id) startMove(event, element);
            }}
            className={`absolute overflow-visible text-left ${selected ? "ring-2 ring-primary" : ""} ${advisory ? "outline-dashed outline-2 outline-offset-2 outline-amber-500" : ""} ${movable ? "cursor-move" : "cursor-default"}`}
            style={{
              left: pct(b.x, slide.size.width),
              top: pct(b.y, slide.size.height),
              width: pct(b.width, slide.size.width),
              height: pct(b.height, slide.size.height),
              zIndex: element.zIndex,
              background:
                element.kind==='shape'&&element.shapeLayout?.svg?undefined:element.surfaceFill?.mode === "solid" ? element.surfaceFill.color : element.surfaceFill?.mode === "none" ? "transparent" : ["shape", "text"].includes(element.kind) ? element.style?.fill : undefined,
              borderRadius:
                element.kind === "shape" &&
                (element.content as { shape?: string })?.shape === "ellipse"
                  ? "9999px"
                  : undefined,
              transform: `rotate(${rotation}deg)`,
              opacity: element.style?.opacity ?? 1,
            }}
          >
            <div className="h-full w-full overflow-hidden">
              <ElementContent
                element={element}
                scale={scale}
                editing={!readOnly && editingId === element.id}
                onEdit={() => {if(!readOnly)setEditingId(element.id);}}
                onTextSelection={(start,end,text)=>onTextSelection?.(element,start,end,text)}
                onMemberSelection={readOnly?undefined:itemId=>onMemberSelection?.(element,itemId)}
                onCommit={(text) => {
                  const original=element.content?.richText?.source??element.content?.rawText??element.content?.text??(element.content?.items||[]).map(i=>i.richText?.source??i.text).join('\n');
                  const problem=text!==original?onContent(element, text):undefined;
                  if(problem){setEditError({id:element.id,message:problem});return;}
                  setEditError(null);setEditingId(null);
                }}
                onCancel={() => { setEditError(null); setEditingId(null); }}
              />
            </div>
            {advisory && <span aria-hidden="true" className="pointer-events-none absolute -left-1.5 -top-1.5 z-10 h-3 w-3 rounded-full bg-amber-500 ring-2 ring-background" />}
            {editError?.id === element.id && editingId === element.id && <p role="alert" data-testid="ppt-inline-edit-error" className="absolute left-0 top-full z-30 mt-1 w-max max-w-[min(28rem,80vw)] rounded bg-destructive px-2 py-1 text-xs text-white">{editError.message}</p>}
            {movable && selected && selectedIds.length === 1 && (
              <>
                {handles.map((handle) => (
                  <span
                    key={handle.id}
                    className={`absolute z-10 h-3 w-3 rounded-full border border-primary bg-background ${handle.className}`}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      event.currentTarget.setPointerCapture(event.pointerId);
                      drag.current = {
                        mode: "resize",
                        handle: handle.id,
                        element,
                        startX: event.clientX,
                        startY: event.clientY,
                        bounds: b,
                      };
                    }}
                  />
                ))}
                {allowStructure && !["chart", "table"].includes(element.kind) && (
                  <span
                    className="absolute -top-7 left-1/2 z-10 h-5 w-5 -translate-x-1/2 cursor-grab rounded-full border border-primary bg-background"
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      event.currentTarget.setPointerCapture(event.pointerId);
                      drag.current = {
                        mode: "rotate",
                        element,
                        startX: event.clientX,
                        startY: event.clientY,
                        bounds: b,
                        rotation,
                      };
                    }}
                  />
                )}
              </>
            )}
          </ObjectTag>
        );
      })}
      {guides.x !== undefined && (
        <span
          className="pointer-events-none absolute bottom-0 top-0 z-[200] w-px bg-primary"
          style={{ left: pct(guides.x, slide.size.width) }}
        />
      )}{" "}
      {guides.y !== undefined && (
        <span
          className="pointer-events-none absolute left-0 right-0 z-[200] h-px bg-primary"
          style={{ top: pct(guides.y, slide.size.height) }}
        />
      )}{" "}
      {marquee && (
        <span
          className="pointer-events-none absolute z-[201] border border-primary bg-primary/10"
          style={{
            left: pct(marquee.x, slide.size.width),
            top: pct(marquee.y, slide.size.height),
            width: pct(marquee.width, slide.size.width),
            height: pct(marquee.height, slide.size.height),
          }}
        />
      )}
      {menu && (
        <div
          className="fixed z-[300] min-w-40 rounded-lg border border-border bg-background p-1 text-xs shadow-xl"
          style={{ left: menu.x, top: menu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          {(["duplicate", "delete", "lock", "front", "back", "ai"] as const)
            .filter(
              (action) =>
                allowStructure || (!["duplicate", "delete"].includes(action)
                  && !(menu.element.kind !== "text" && ["lock", "ai"].includes(action))),
            )
            .map((action) => (
              <button
                key={action}
                className="block w-full rounded px-3 py-2 text-left hover:bg-accent"
                onClick={() => {
                  onAction(action, menu.element);
                  setMenu(null);
                }}
              >
                {t(`ppt.editor.context.${action}` as never)}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
