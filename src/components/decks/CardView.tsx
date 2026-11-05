'use client';

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { Block, Card, CardDimensions, DeckTheme, HeaderFooter, HeaderFooterSlot } from '@/lib/decks/types';
import { DIMENSION_RATIO } from '@/lib/decks/types';
import { parseInline } from '@/lib/decks/blocks';
import { accentDataUrl } from '@/lib/decks/accent-art';

/** Logical canvas width; Gamma's editor measured a 1280×720 canvas (report 01 §2.2). */
export const CANVAS_WIDTH = 1280;

export interface CardViewProps {
  card: Card;
  theme: DeckTheme;
  dimensions: CardDimensions;
  /** Resolves a media id to a URL (e.g. /api/decks/media/:id). */
  mediaUrl?: (mediaId: string) => string;
  /** 1-based visible card number, for headers/footers. */
  cardNumber?: number;
  cardCount?: number;
  headerFooter?: HeaderFooter;
  deckTitle?: string;
  editable?: boolean;
  selectedBlockId?: string | null;
  onSelectBlock?: (blockId: string | null) => void;
  onChangeBlock?: (blockId: string, next: Block) => void;
  /** Fixed rendered width in px; omit to fill the container width. */
  width?: number;
  className?: string;
  /** Renders a shimmer for cards still being written. */
  pending?: boolean;
}

function useContainerWidth(fixed?: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fixed ?? 0);
  useLayoutEffect(() => {
    if (fixed !== undefined || !ref.current) return;
    const el = ref.current;
    const update = () => setWidth(el.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [fixed]);
  return { ref, width: fixed ?? width };
}

export function canvasHeight(dimensions: CardDimensions): number | null {
  const ratio = DIMENSION_RATIO[dimensions];
  return ratio ? Math.round(CANVAS_WIDTH / ratio) : null;
}

export function CardView(props: CardViewProps) {
  const { card, theme, dimensions, width: fixedWidth, className, pending } = props;
  const { ref, width } = useContainerWidth(fixedWidth);
  const logicalHeight = canvasHeight(dimensions);
  const scale = width > 0 ? width / CANVAS_WIDTH : 0;
  const innerRef = useRef<HTMLDivElement>(null);
  const [fluidHeight, setFluidHeight] = useState(720);
  useEffect(() => {
    if (logicalHeight || !innerRef.current) return;
    const el = innerRef.current;
    const observer = new ResizeObserver(() => setFluidHeight(el.scrollHeight));
    observer.observe(el);
    setFluidHeight(el.scrollHeight);
    return () => observer.disconnect();
  }, [logicalHeight, card]);
  const height = logicalHeight ?? fluidHeight;
  return (
    <div ref={ref} className={className} data-card-id={card.id} style={{ width: fixedWidth ?? '100%', height: scale ? height * scale : undefined, aspectRatio: scale ? undefined : logicalHeight ? `${CANVAS_WIDTH} / ${logicalHeight}` : undefined, position: 'relative', overflow: 'hidden', borderRadius: Math.max(4, theme.radius * (scale || 1)) }}>
      {scale > 0 && (
        <div ref={innerRef} style={{ width: CANVAS_WIDTH, height: logicalHeight ?? undefined, minHeight: logicalHeight ? undefined : 720, transform: `scale(${scale})`, transformOrigin: 'top left', position: 'absolute', inset: 0 }}>
          <CardCanvas {...props} pending={pending} />
        </div>
      )}
    </div>
  );
}

function CardCanvas(props: CardViewProps) {
  const { card, theme, dimensions, mediaUrl } = props;
  const accent = card.layout.accent;
  const accentSrc = accent === 'none' ? undefined : card.layout.accentMediaId && mediaUrl ? mediaUrl(card.layout.accentMediaId) : accentDataUrl(theme, card.layout.accentSeed || card.id);
  const fixed = canvasHeight(dimensions) !== null;
  const base: CSSProperties = {
    width: '100%', height: fixed ? '100%' : undefined, minHeight: fixed ? undefined : 720,
    background: theme.colors.background, color: theme.colors.text, fontFamily: theme.fonts.body,
    display: 'flex', flexDirection: accent === 'top' ? 'column' : accent === 'right' ? 'row-reverse' : 'row', position: 'relative',
  };
  const content = (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, padding: accent === 'background' ? '72px 96px' : '64px 80px', display: 'flex', flexDirection: 'column', justifyContent: fixed ? 'center' : 'flex-start', gap: 20, textAlign: card.layout.align, position: 'relative', zIndex: 1 }}>
      {props.pending && card.blocks.length === 0 ? <Shimmer theme={theme} /> : card.blocks.map(block => <BlockView key={block.id} block={block} {...props} />)}
    </div>
  );
  return (
    <div style={base}>
      {accentSrc && accent !== 'background' && (
        <div style={{ flex: accent === 'top' ? '0 0 38%' : '0 0 40%', position: 'relative', overflow: 'hidden' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={accentSrc} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        </div>
      )}
      {accentSrc && accent === 'background' && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={accentSrc} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
          <div style={{ position: 'absolute', inset: 0, background: theme.dark ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.72)' }} />
        </>
      )}
      {content}
      <HeaderFooterLayer {...props} />
    </div>
  );
}

function Shimmer({ theme }: { theme: DeckTheme }) {
  const bar = (w: string, h = 22) => <div style={{ width: w, height: h, borderRadius: 8, background: theme.colors.border, opacity: 0.7, animation: 'pulse 1.6s ease-in-out infinite' }} />;
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>{bar('55%', 48)}{bar('90%')}{bar('82%')}{bar('70%')}</div>;
}

/** Logo image height on the 1280 canvas per size (report 05 §6: sm / md / lg / xl, md by default). */
export const LOGO_HEIGHT: Record<NonNullable<HeaderFooterSlot['size']>, number> = { sm: 24, md: 36, lg: 52, xl: 72 };

function HeaderFooterLayer({ headerFooter, cardNumber, cardCount, theme, deckTitle, mediaUrl }: CardViewProps) {
  if (!headerFooter || !cardNumber) return null;
  if ((headerFooter.hideFromFirstCard && cardNumber === 1) || (headerFooter.hideFromLastCard && cardNumber === cardCount)) return null;
  const render = (slot?: HeaderFooterSlot): ReactNode => {
    if (!slot) return null;
    if (slot.type === 'cardNumber') return String(cardNumber);
    if (slot.type !== 'logo') return slot.value || '';
    if (slot.mediaId && mediaUrl) {
      const height = LOGO_HEIGHT[slot.size ?? 'md'] ?? LOGO_HEIGHT.md;
      // eslint-disable-next-line @next/next/no-img-element
      return <img src={mediaUrl(slot.mediaId)} alt={slot.value || deckTitle || ''} style={{ height, width: 'auto', maxWidth: 420, objectFit: 'contain', display: 'block' }} />;
    }
    return slot.value || deckTitle || '';
  };
  const pos = (key: keyof HeaderFooter, style: CSSProperties) => {
    const value = render(headerFooter[key] as HeaderFooterSlot | undefined);
    return value ? <div key={key} style={{ position: 'absolute', fontSize: 16, color: theme.colors.muted, zIndex: 2, ...style }}>{value}</div> : null;
  };
  return <>{[pos('topLeft', { top: 24, left: 32 }), pos('topCenter', { top: 24, left: '50%', transform: 'translateX(-50%)' }), pos('topRight', { top: 24, right: 32 }),
    pos('bottomLeft', { bottom: 24, left: 32 }), pos('bottomCenter', { bottom: 24, left: '50%', transform: 'translateX(-50%)' }), pos('bottomRight', { bottom: 24, right: 32 })]}</>;
}

// ── Inline text and editing ───────────────────────────────────────────────

export function Inline({ text, theme }: { text: string; theme: DeckTheme }) {
  return <>{parseInline(text).map((segment, i) => {
    let node: ReactNode = segment.text;
    if (segment.code) node = <code style={{ fontFamily: 'Menlo, Consolas, monospace', fontSize: '0.9em', background: theme.colors.surface, padding: '0 6px', borderRadius: 4 }}>{node}</code>;
    if (segment.bold) node = <strong style={{ fontWeight: 700 }}>{node}</strong>;
    if (segment.italic) node = <em>{node}</em>;
    if (segment.href) node = <a href={segment.href} target="_blank" rel="noreferrer" style={{ color: theme.colors.accent, textDecoration: 'underline' }}>{node}</a>;
    return <span key={i}>{node}</span>;
  })}</>;
}

/** Shows formatted text; while focused in edit mode it shows the raw Markdown. */
function EditableText({ value, theme, editable, onCommit, style, as = 'div' }: { value: string; theme: DeckTheme; editable?: boolean; onCommit?: (next: string) => void; style?: CSSProperties; as?: 'div' | 'span' }) {
  const [editing, setEditing] = useState(false);
  const Tag = as;
  if (!editable || !onCommit) return <Tag style={style}><Inline text={value} theme={theme} /></Tag>;
  if (!editing) return <Tag style={{ ...style, cursor: 'text' }} onClick={e => { e.stopPropagation(); setEditing(true); }}><Inline text={value || ' '} theme={theme} /></Tag>;
  return (
    <Tag
      style={{ ...style, outline: `2px solid ${theme.colors.accent}`, outlineOffset: 4, borderRadius: 4, whiteSpace: 'pre-wrap' }}
      contentEditable suppressContentEditableWarning autoFocus
      ref={(el: HTMLElement | null) => { if (el && document.activeElement !== el) { el.focus(); const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const s = window.getSelection(); s?.removeAllRanges(); s?.addRange(r); } }}
      onClick={e => e.stopPropagation()}
      onBlur={e => { setEditing(false); const next = (e.currentTarget.textContent || '').replace(/ /g, ' ').trim(); if (next !== value) onCommit(next); }}
      onKeyDown={e => { if (e.key === 'Escape') { (e.currentTarget as HTMLElement).blur(); } }}
    >{value}</Tag>
  );
}

// ── Blocks ────────────────────────────────────────────────────────────────

function BlockView(props: CardViewProps & { block: Block }) {
  const { block, theme, editable, selectedBlockId, onSelectBlock, onChangeBlock, mediaUrl } = props;
  const selected = editable && selectedBlockId === block.id;
  const change = (next: Block) => onChangeBlock?.(block.id, next);
  const wrap = (node: ReactNode) => (
    <div data-block-id={block.id} onClick={editable ? e => { e.stopPropagation(); onSelectBlock?.(block.id); } : undefined}
      style={{ position: 'relative', borderRadius: 6, outline: selected ? `2px dashed ${theme.colors.accent}` : undefined, outlineOffset: 8 }}>{node}</div>
  );
  const text = (value: string, commit: (v: string) => void, style?: CSSProperties) => <EditableText value={value} theme={theme} editable={editable} onCommit={commit} style={style} />;
  const h = { fontFamily: theme.fonts.heading, color: theme.colors.text, margin: 0, lineHeight: 1.15 } as CSSProperties;
  switch (block.type) {
    case 'heading': {
      const size = block.level === 1 ? 68 : block.level === 2 ? 46 : 32;
      return wrap(text(block.text, v => change({ ...block, text: v }), { ...h, fontSize: size, fontWeight: block.level === 3 ? 600 : 700, letterSpacing: block.level === 1 ? -1 : -0.4 }));
    }
    case 'paragraph':
      return wrap(text(block.text, v => change({ ...block, text: v }), { fontSize: 26, lineHeight: 1.5, color: theme.colors.text }));
    case 'bullets': case 'numbered': {
      const Tag = block.type === 'bullets' ? 'ul' : 'ol';
      return wrap(<Tag style={{ margin: 0, paddingLeft: 34, listStyleType: block.type === 'bullets' ? 'disc' : 'decimal', fontSize: 26, lineHeight: 1.45, display: 'flex', flexDirection: 'column', gap: 10, textAlign: 'left' }}>
        {block.items.map((item, i) => <li key={i} style={{ paddingLeft: 6 }}>{text(item, v => change({ ...block, items: block.items.map((x, j) => (j === i ? v : x)).filter(Boolean) }))}</li>)}
      </Tag>);
    }
    case 'quote':
      return wrap(<blockquote style={{ margin: 0, padding: '8px 0 8px 28px', borderLeft: `6px solid ${theme.colors.accent}` }}>
        {text(block.text, v => change({ ...block, text: v }), { ...h, fontSize: 36, fontStyle: 'italic', fontWeight: 500, lineHeight: 1.35 })}
        {block.attribution && <div style={{ marginTop: 14, fontSize: 22, color: theme.colors.muted }}>— {block.attribution}</div>}
      </blockquote>);
    case 'callout': {
      const tone = { info: theme.colors.accent, warning: '#d48a1f', success: '#2f9e5b', note: theme.colors.accent2 }[block.tone];
      return wrap(<div style={{ background: theme.colors.surface, border: `1px solid ${theme.colors.border}`, borderLeft: `6px solid ${tone}`, borderRadius: theme.radius, padding: '20px 26px', textAlign: 'left' }}>
        {block.title && <div style={{ fontWeight: 700, fontSize: 24, marginBottom: 6 }}>{block.title}</div>}
        {text(block.text, v => change({ ...block, text: v }), { fontSize: 23, lineHeight: 1.45 })}
      </div>);
    }
    case 'code':
      return wrap(<pre style={{ margin: 0, background: theme.dark ? '#0a0b14' : '#1c1f26', color: '#e8eaf0', padding: '20px 24px', borderRadius: theme.radius, fontSize: 19, lineHeight: 1.45, fontFamily: 'Menlo, Consolas, monospace', overflow: 'hidden', whiteSpace: 'pre-wrap', textAlign: 'left' }}>{block.code}</pre>);
    case 'table':
      return wrap(<table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 21, textAlign: 'left' }}>
        <thead><tr>{block.header.map((cell, i) => <th key={i} style={{ padding: '12px 14px', background: theme.colors.accent, color: '#fff', fontWeight: 700 }}>{cell}</th>)}</tr></thead>
        <tbody>{block.rows.map((row, r) => <tr key={r} style={{ background: r % 2 ? theme.colors.surface : 'transparent' }}>{row.map((cell, c) => <td key={c} style={{ padding: '10px 14px', borderBottom: `1px solid ${theme.colors.border}` }}><Inline text={cell} theme={theme} /></td>)}</tr>)}</tbody>
      </table>);
    case 'chart':
      return wrap(<ChartView block={block} theme={theme} />);
    case 'timeline':
      return wrap(<div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(block.items.length, 5)}, 1fr)`, gap: 22, position: 'relative', textAlign: 'left' }}>
        <div style={{ position: 'absolute', left: 0, right: 0, top: 13, height: 3, background: theme.colors.border }} />
        {block.items.map((item, i) => <div key={i} style={{ position: 'relative' }}>
          <div style={{ width: 28, height: 28, borderRadius: 14, background: i % 2 ? theme.colors.accent2 : theme.colors.accent, border: `4px solid ${theme.colors.background}` }} />
          <div style={{ marginTop: 14, fontSize: 18, color: theme.colors.accent, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>{item.label}</div>
          <div style={{ fontSize: 23, fontWeight: 700, marginTop: 4 }}>{item.title}</div>
          {item.text && <div style={{ fontSize: 19, color: theme.colors.muted, marginTop: 6, lineHeight: 1.4 }}><Inline text={item.text} theme={theme} /></div>}
        </div>)}
      </div>);
    case 'steps':
      return wrap(<div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(block.items.length, 4)}, 1fr)`, gap: 18, textAlign: 'left' }}>
        {block.items.map((item, i) => <div key={i} style={{ background: theme.colors.surface, border: `1px solid ${theme.colors.border}`, borderRadius: theme.radius, padding: '20px 22px', borderTop: `5px solid ${theme.colors.accent}` }}>
          <div style={{ fontSize: 34, fontWeight: 800, color: theme.colors.accent, fontFamily: theme.fonts.heading }}>{i + 1}</div>
          <div style={{ fontSize: 23, fontWeight: 700, marginTop: 6 }}>{item.title}</div>
          {item.text && <div style={{ fontSize: 19, color: theme.colors.muted, marginTop: 6, lineHeight: 1.4 }}><Inline text={item.text} theme={theme} /></div>}
        </div>)}
      </div>);
    case 'metrics':
      return wrap(<div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(block.items.length, 4)}, 1fr)`, gap: 22, textAlign: 'left' }}>
        {block.items.map((item, i) => <div key={i} style={{ padding: '6px 0', borderTop: `4px solid ${i % 2 ? theme.colors.accent2 : theme.colors.accent}` }}>
          <div style={{ fontSize: 56, fontWeight: 800, fontFamily: theme.fonts.heading, color: theme.colors.text, marginTop: 10, lineHeight: 1.05 }}>{item.value}</div>
          <div style={{ fontSize: 22, fontWeight: 600, marginTop: 6 }}>{item.label}</div>
          {item.detail && <div style={{ fontSize: 18, color: theme.colors.muted, marginTop: 4 }}>{item.detail}</div>}
        </div>)}
      </div>);
    case 'grid':
      return wrap(<div style={{ display: 'grid', gridTemplateColumns: `repeat(${block.items.length === 4 ? 2 : Math.min(block.items.length, 3)}, 1fr)`, gap: 18, textAlign: 'left' }}>
        {block.items.map((item, i) => <div key={i} style={{ background: theme.colors.surface, border: `1px solid ${theme.colors.border}`, borderRadius: theme.radius, padding: '20px 22px' }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, display: 'grid', placeItems: 'center', background: theme.colors.accent, color: '#fff', fontWeight: 800, fontSize: 20 }}>{item.icon || i + 1}</div>
            <div style={{ fontSize: 23, fontWeight: 700 }}>{item.title}</div>
          </div>
          {item.text && <div style={{ fontSize: 19, color: theme.colors.muted, marginTop: 10, lineHeight: 1.4 }}><Inline text={item.text} theme={theme} /></div>}
        </div>)}
      </div>);
    case 'columns':
      return wrap(<div style={{ display: 'grid', gridTemplateColumns: `repeat(${block.columns.length}, 1fr)`, gap: 36 }}>
        {block.columns.map((column, i) => <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {column.map(child => <BlockView key={child.id} {...props} block={child} onChangeBlock={(id, next) => change({ ...block, columns: block.columns.map((col, ci) => ci === i ? col.map(b => b.id === id ? next : b) : col) })} />)}
        </div>)}
      </div>);
    case 'image': {
      const src = block.mediaId && mediaUrl ? mediaUrl(block.mediaId) : undefined;
      return wrap(<figure style={{ margin: 0 }}>
        {src
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={src} alt={block.alt} style={{ width: '100%', maxHeight: 420, objectFit: block.fit, borderRadius: theme.radius, display: 'block' }} />
          : <div style={{ height: 300, borderRadius: theme.radius, border: `2px dashed ${theme.colors.border}`, display: 'grid', placeItems: 'center', color: theme.colors.muted, fontSize: 20 }}>{block.alt || 'Image'}</div>}
        {block.caption && <figcaption style={{ fontSize: 18, color: theme.colors.muted, marginTop: 8 }}>{block.caption}</figcaption>}
      </figure>);
    }
    case 'divider':
      return wrap(<hr style={{ border: 0, height: 2, background: theme.colors.border, margin: '4px 0' }} />);
  }
}

function ChartView({ block, theme }: { block: Extract<Block, { type: 'chart' }>; theme: DeckTheme }) {
  const W = 1000, H = 360, pad = 48;
  const palette = [theme.colors.accent, theme.colors.accent2, theme.colors.muted, theme.colors.text];
  if (block.chartType === 'pie') {
    const values = block.series[0]?.values || [];
    const total = values.reduce((a, b) => a + Math.max(0, b), 0) || 1;
    const cx = 200, cy = H / 2, r = 150;
    // Precompute slice angles so render stays free of reassignment.
    const slices = values.reduce<{ start: number; end: number }[]>((acc, v) => {
      const start = acc.length ? acc[acc.length - 1].end : -Math.PI / 2;
      return [...acc, { start, end: start + (Math.max(0, v) / total) * Math.PI * 2 }];
    }, []);
    return <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }}>
      {slices.map(({ start, end }, i) => {
        const x1 = cx + r * Math.cos(start), y1 = cy + r * Math.sin(start), x2 = cx + r * Math.cos(end), y2 = cy + r * Math.sin(end);
        return <path key={i} d={`M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${end - start > Math.PI ? 1 : 0} 1 ${x2},${y2} Z`} fill={palette[i % palette.length]} opacity={1 - Math.floor(i / palette.length) * 0.35} />;
      })}
      {block.labels.map((label, i) => <g key={i} transform={`translate(420, ${60 + i * 40})`}><rect width="22" height="22" rx="4" fill={palette[i % palette.length]} /><text x="34" y="18" fontSize="22" fill={theme.colors.text}>{label} · {Math.round((values[i] / total) * 100)}%</text></g>)}
    </svg>;
  }
  const all = block.series.flatMap(s => s.values);
  const max = Math.max(...all, 0) || 1, min = Math.min(...all, 0);
  const y = (v: number) => H - pad - ((v - min) / (max - min || 1)) * (H - pad * 2);
  const slot = (W - pad * 2) / block.labels.length;
  return <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }}>
    <line x1={pad} y1={y(0)} x2={W - pad} y2={y(0)} stroke={theme.colors.border} strokeWidth="2" />
    {block.labels.map((label, i) => <text key={i} x={pad + slot * i + slot / 2} y={H - 12} fontSize="20" textAnchor="middle" fill={theme.colors.muted}>{label}</text>)}
    {block.chartType === 'bar'
      ? block.series.map((s, si) => s.values.map((v, i) => {
        const bw = (slot * 0.7) / block.series.length, x = pad + slot * i + slot * 0.15 + bw * si;
        return <g key={`${si}-${i}`}><rect x={x} y={Math.min(y(v), y(0))} width={bw - 4} height={Math.abs(y(v) - y(0))} rx="4" fill={palette[si % palette.length]} />
          <text x={x + bw / 2 - 2} y={Math.min(y(v), y(0)) - 8} fontSize="18" textAnchor="middle" fill={theme.colors.text}>{v}{block.unit || ''}</text></g>;
      }))
      : block.series.map((s, si) => <polyline key={si} fill="none" stroke={palette[si % palette.length]} strokeWidth="5" strokeLinejoin="round" points={s.values.map((v, i) => `${pad + slot * i + slot / 2},${y(v)}`).join(' ')} />)}
    {block.series.length > 1 && block.series.map((s, si) => <g key={si} transform={`translate(${pad + si * 200}, 10)`}><rect width="18" height="18" rx="3" fill={palette[si % palette.length]} /><text x="26" y="16" fontSize="18" fill={theme.colors.text}>{s.name}</text></g>)}
  </svg>;
}
