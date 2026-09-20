export type PptBounds = { x: number; y: number; width: number; height: number };
export type PptRenderElement = {
  id: string; nodeId: string | null; sourceNodeId?: string; kind: string; bounds: PptBounds;
  content?: { text?: string; items?: { id: string; text: string }[]; dataUrl?: string; rows?: string[][]; labels?: string[]; values?: number[] };
  style?: { color?: string; fill?: string; fontFamily?: string; eastAsiaFontFamily?: string; fontSizePt?: number; fontWeight?: number; textAlign?: string };
  zIndex: number; locked?: boolean; semanticRole?: string;
};
export type PptRenderSlide = { id: string; slideId: string; index: number; layoutId: string; size: { width: number; height: number }; background?: string; elements: PptRenderElement[] };
export type PptRenderTree = { schemaVersion: number; units: 'emu'; deckId: string; hash: string; size: { width: number; height: number }; slides: PptRenderSlide[] };
export type PptRunNode = { id: string; dependsOn: string[]; status: string; attempts: number; error?: string | null };
export type PptRun = { id: string; status: string; stage: string; lastSeq: number; nodes: Record<string, PptRunNode> };

export type StructuredProjectView = {
  id: string; revision: number; status: string; stage: string; currentRunId?: string; renderTree?: PptRenderTree;
  deck?: { slides: unknown[] } | null;
};
