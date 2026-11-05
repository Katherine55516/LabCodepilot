import { cardPrompt, editPrompt, outlinePrompt, type ComponentHint, type WriterContext } from './prompts';
import { plannerDigest } from './chunking';
import type { SourceChunk, SourceFigure } from './source';
import { newId, sanitizeBlocks } from './blocks';
import { splitByBreaks } from './settings';
import type { AccentPosition, Block, Card, EditScope, GenerationSettings, OutlineCard } from './types';

/**
 * The model behind Decks. `provider` uses the account's configured text and
 * image providers (the same resolver chat uses); `mock` is deterministic and
 * offline, for tests, local development, and as a clearly-labelled demo
 * fallback when no provider is configured (the deck then carries a
 * `demo_model` warning so the UI can say so).
 */
export interface PlannedCard { title: string; points: string[]; sources?: string[]; figures?: string[] }
export interface PlannedOutline { title: string; cards: PlannedCard[] }
/** A chunked source handed to the planner (see chunking.ts). */
export interface OutlineSource { chunks: SourceChunk[]; figures: SourceFigure[] }
export interface WrittenCard { blocks: Block[]; accent: AccentPosition; imagePrompt: string }
export interface EditedCards { cards: { id: string; blocks: Block[]; accent?: AccentPosition }[]; summary: string }

export interface DeckModel {
  kind: 'provider' | 'mock';
  planOutline(s: GenerationSettings, inputText: string, opts?: { instruction?: string; previous?: OutlineCard[]; source?: OutlineSource; components?: ComponentHint[] }): Promise<PlannedOutline>;
  writeCard(s: GenerationSettings, card: OutlineCard, index: number, total: number, deckTitle: string, ctx?: WriterContext): Promise<WrittenCard>;
  /** Which provider/model wrote the deck, for diagnostics ("provider:qwen-3.8-max"). */
  label?: string;
  editCards(s: GenerationSettings, scope: EditScope, instruction: string, cards: Card[]): Promise<EditedCards>;
  image(prompt: string, aspectRatio: string): Promise<{ data: Buffer; mime: string } | null>;
}

const ACCENTS: AccentPosition[] = ['none', 'left', 'right', 'top', 'background'];
const accentOf = (v: unknown, fallback: AccentPosition): AccentPosition => (ACCENTS.includes(v as AccentPosition) ? v as AccentPosition : fallback);

/** Extracts the first JSON object from a model reply (tolerates code fences and prose). */
export function parseJsonReply(reply: string): unknown {
  const fenced = reply.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : reply;
  const start = body.indexOf('{');
  if (start < 0) throw new Error('The model did not return JSON.');
  let depth = 0, inString = false, escaped = false;
  for (let i = start; i < body.length; i++) {
    const ch = body[i];
    if (inString) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === '"') inString = false; continue; }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return JSON.parse(body.slice(start, i + 1));
  }
  throw new Error('The model reply was cut off before the JSON ended.');
}

const ids = (v: unknown, pattern: RegExp, max: number) =>
  Array.isArray(v) ? [...new Set(v.map(x => String(x).trim().replace(/^\[|\]$/g, '')).filter(x => pattern.test(x)))].slice(0, max) : [];

export function normalizeOutline(raw: unknown): PlannedOutline {
  const o = (raw || {}) as Record<string, unknown>;
  const cards = Array.isArray(o.cards) ? o.cards.map(c => {
    const x = (c || {}) as Record<string, unknown>;
    const sources = ids(x.sources, /^C\d{1,4}$/, 4);
    const figures = ids(x.figures, /^F\d{1,4}$/, 3);
    return {
      title: String(x.title || '').slice(0, 200),
      points: Array.isArray(x.points) ? x.points.map(p => String(p).slice(0, 800)).filter(Boolean).slice(0, 12) : [],
      ...(sources.length ? { sources } : {}), ...(figures.length ? { figures } : {}),
    };
  }).filter(c => c.title) : [];
  if (!cards.length) throw new Error('The model returned an empty outline.');
  return { title: String(o.title || cards[0].title).slice(0, 200), cards: cards.slice(0, 60) };
}

// ── Provider model ────────────────────────────────────────────────────────

export async function createProviderModel(ref?: GenerationSettings['model']): Promise<DeckModel | null> {
  const { resolveProvider } = await import('../provider-resolver');
  const resolved = ref?.providerId ? resolveProvider({ providerId: ref.providerId, model: ref.model }) : resolveProvider({});
  if (!resolved.hasCredentials) return null;
  const { generateTextFromProvider } = await import('../text-generator');
  const model = ref?.model || resolved.upstreamModel || resolved.model || '';
  const providerId = resolved.provider?.id || ref?.providerId || '';
  const ask = async (system: string, prompt: string, maxTokens: number) => parseJsonReply(await generateTextFromProvider({
    providerId, model, system, prompt, maxTokens,
    abortSignal: AbortSignal.timeout(240_000),
  }));
  return {
    kind: 'provider',
    label: `${resolved.provider?.name || 'provider'} · ${model}`,
    async planOutline(s, inputText, opts) {
      const source = opts?.source ? { digest: plannerDigest(opts.source.chunks, opts.source.figures), chunkIds: opts.source.chunks.map(c => c.id), figureIds: opts.source.figures.map(f => f.id) } : undefined;
      const { system, prompt } = outlinePrompt(s, inputText, { instruction: opts?.instruction, previous: opts?.previous, source, components: opts?.components });
      return normalizeOutline(await ask(system, prompt, 12000));
    },
    async writeCard(s, card, index, total, deckTitle, ctx) {
      const { system, prompt } = cardPrompt(s, card, index, total, deckTitle, ctx);
      const raw = (await ask(system, prompt, 4096)) as Record<string, unknown>;
      const blocks = sanitizeBlocks(raw.blocks);
      if (!blocks.length) throw new Error('The model returned an empty card.');
      return { blocks, accent: accentOf(raw.accent, index === 0 ? 'right' : 'none'), imagePrompt: String(raw.imagePrompt || card.title).slice(0, 600) };
    },
    async editCards(s, scope, instruction, cards) {
      const { system, prompt } = editPrompt(s, scope, instruction, cards);
      const raw = (await ask(system, prompt, 8192)) as Record<string, unknown>;
      const out = Array.isArray(raw.cards) ? raw.cards.map(c => {
        const x = (c || {}) as Record<string, unknown>;
        return { id: String(x.id || newId('card')), blocks: sanitizeBlocks(x.blocks), ...(x.accent ? { accent: accentOf(x.accent, 'none') } : {}) };
      }).filter(c => c.blocks.length) : [];
      if (!out.length) throw new Error('The model returned no cards.');
      return { cards: out, summary: String(raw.summary || 'Edited.').slice(0, 300) };
    },
    async image(prompt, aspectRatio) {
      try {
        const { generateSingleImage } = await import('../image-generator');
        const result = await generateSingleImage({ prompt, aspectRatio, skipSave: true, abortSignal: AbortSignal.timeout(120_000) });
        const first = result.images[0];
        if (!first) return null;
        const data = first.rawData || (first.localPath ? (await import('fs')).readFileSync(first.localPath) : null);
        return data ? { data, mime: first.mimeType || 'image/png' } : null;
      } catch { return null; }
    },
  };
}

// ── Deterministic mock model ──────────────────────────────────────────────

const sentenceSplit = (text: string) => text.split(/(?<=[.!?。！？])\s+|\n+/).map(s => s.trim()).filter(s => s.length > 1);
const headingOf = (text: string) => text.match(/^#{1,6}\s+(.+)$/m)?.[1]?.trim();
const stripMd = (text: string) => text.replace(/^#{1,6}\s+/gm, '').replace(/^\s*[-*+]\s+/gm, '').replace(/^\s*\d+[.)]\s+/gm, '').trim();
const isZh = (text: string) => /[一-鿿]/.test(text);

function topicOf(input: string) {
  return (headingOf(input) || stripMd(input).split('\n')[0] || 'Untitled').replace(/[.。]$/, '').slice(0, 80);
}

function mockSections(s: GenerationSettings, input: string): { title: string; points: string[] }[] {
  if (s.cardSplit === 'inputTextBreaks') {
    return splitByBreaks(input).map((part, i) => {
      const lines = part.split('\n').map(l => l.trim()).filter(Boolean);
      const title = headingOf(part) || stripMd(lines[0] || `Card ${i + 1}`).slice(0, 120);
      const rest = lines.filter(l => stripMd(l) !== title && !/^#{1,6}\s/.test(l)).map(stripMd).filter(Boolean);
      return { title, points: rest };
    });
  }
  const sections = input.split(/\n(?=#{1,3}\s)/).map(part => part.trim()).filter(Boolean);
  if (sections.length > 1) {
    return sections.map(part => {
      const title = headingOf(part) || topicOf(part);
      const body = stripMd(part.replace(/^#{1,6}\s+.+$/m, ''));
      return { title, points: sentenceSplit(body).slice(0, 6) };
    });
  }
  const sentences = sentenceSplit(stripMd(input));
  if (sentences.length >= 4) {
    const per = Math.max(2, Math.ceil(sentences.length / Math.max(1, s.numCards - 1)));
    const out: { title: string; points: string[] }[] = [];
    for (let i = 0; i < sentences.length; i += per) {
      const chunk = sentences.slice(i, i + per);
      out.push({ title: chunk[0].replace(/[,，:：].*$/, '').slice(0, 70), points: chunk });
    }
    return out;
  }
  // A short brief: expand into a generic but coherent structure.
  const topic = topicOf(input);
  const zh = isZh(input);
  const frames = zh
    ? [['为什么现在要关注{t}', ['{t}正在改变团队的工作方式', '早期采用者已经看到可衡量的收益', '等待的成本在逐步上升']],
       ['{t}的核心概念', ['定义：用一句话说清{t}是什么', '关键组成部分及其关系', '与现有做法的区别']],
       ['落地{t}的四个步骤', ['评估现状与目标', '选择试点场景', '小范围上线并收集反馈', '复盘后逐步推广']],
       ['常见误区与应对', ['只看工具不看流程', '缺少衡量指标', '一次铺开、缺少试点']],
       ['衡量{t}的成效', ['效率：完成同类任务的时间', '质量：错误率与返工率', '采用度：活跃使用的比例']],
       ['下一步行动', ['确定负责人和时间表', '选定第一个试点', '两周后回顾结果']]]
    : [['Why {t} matters now', ['{t} is changing how teams work', 'Early adopters already report measurable gains', 'The cost of waiting keeps rising']],
       ['The core ideas behind {t}', ['What {t} is, in one sentence', 'The key parts and how they fit together', 'How it differs from current practice']],
       ['Four steps to adopt {t}', ['Assess where you are and what you need', 'Pick a pilot use case', 'Launch small and collect feedback', 'Review, then roll out gradually']],
       ['Common pitfalls and how to avoid them', ['Buying tools before fixing the process', 'No way to measure success', 'Rolling out everywhere at once']],
       ['How to measure success with {t}', ['Speed: time to finish the same task', 'Quality: error and rework rates', 'Adoption: share of active users']],
       ['Next steps', ['Name an owner and a timeline', 'Choose the first pilot', 'Review results in two weeks']]];
  const body = Array.from({ length: Math.max(1, s.numCards - 1) }, (_, i) => frames[i % frames.length]);
  return body.map(([title, points]) => ({ title: (title as string).replaceAll('{t}', topic), points: (points as string[]).map(p => p.replaceAll('{t}', topic)) }));
}

function mockCardBlocks(card: OutlineCard, index: number): WrittenCard {
  const h = (level: 1 | 2): Block => ({ id: newId('blk'), type: 'heading', level, text: card.title });
  if (index === 0) {
    return { blocks: [h(1), { id: newId('blk'), type: 'paragraph', text: card.points[0] || card.title }], accent: 'right', imagePrompt: card.title };
  }
  const points = card.points.length ? card.points : [card.title];
  const numeric = points.filter(p => /(\d[\d,.]*\s?(%|x|倍|万|亿|k|m|bn)?)/i.test(p));
  const labelled = points.every(p => /^[^:：]{2,40}[:：]/.test(p));
  let blocks: Block[];
  let accent: AccentPosition = 'right';
  if (numeric.length >= 2 && numeric.length === points.length && points.length <= 4) {
    blocks = [h(2), { id: newId('blk'), type: 'metrics', items: points.map(p => {
      const m = p.match(/(\d[\d,.]*\s?(%|x|倍|万|亿|k|m|bn)?)/i);
      // Keep the whole sentence as the label; the number is shown large above it.
      return { value: m ? m[1].trim() : p.slice(0, 8), label: p.replace(/[.。]$/, '').slice(0, 80) };
    }) }];
    accent = 'none';
  } else if (/step|steps|步|阶段|phase/i.test(card.title) && points.length >= 2 && points.length <= 5) {
    blocks = [h(2), { id: newId('blk'), type: 'steps', items: points.map(p => { const [title, ...rest] = p.split(/[,，:：]/); const text = rest.join('，').trim(); return { title: title.trim().slice(0, 60), ...(text ? { text } : {}) }; }) }];
    accent = 'none';
  } else if (labelled && points.length >= 2 && points.length <= 6) {
    blocks = [h(2), { id: newId('blk'), type: 'grid', items: points.map(p => { const [t, ...rest] = p.split(/[:：]/); return { title: t.trim(), text: rest.join(':').trim() }; }) }];
    accent = index % 2 ? 'left' : 'top';
  } else if (points.length === 1) {
    blocks = [h(2), { id: newId('blk'), type: 'callout', tone: 'info', text: points[0] }];
    accent = 'left';
  } else {
    blocks = [h(2), { id: newId('blk'), type: 'bullets', items: points }];
    accent = (['right', 'left', 'top'] as AccentPosition[])[index % 3];
  }
  return { blocks, accent, imagePrompt: card.title };
}

/** Deterministic outline from chunks: budgeted cards per chunk, the chunk's figures spread over its cards. */
function mockSourcedOutline(s: GenerationSettings, source: OutlineSource, title: string, components: ComponentHint[] = []): PlannedOutline {
  const per = s.amount === 'brief' ? 2 : s.amount === 'medium' ? 3 : 5;
  const used = new Set<string>();
  const cards: PlannedCard[] = [];
  const front = source.chunks.find(c => c.kind === 'front');
  cards.push({ title, points: [sentenceSplit(front?.text || title)[0]?.slice(0, 200) || title] });
  // An overview card from the top-level sections, grouped to an item count a template component holds.
  const tops = [...new Set(source.chunks.filter(c => c.kind === 'body' && c.path[0]).map(c => c.path[0]))].map(t => t.replace(/^(?:\d+|[A-Z])(?:\.\d+)*\.?\s+/, ''));
  const fit = components.map(c => c.units).filter(u => u >= 2 && u <= tops.length).sort((a, b) => b - a)[0];
  if (fit && tops.length >= 2) {
    const groups = Array.from({ length: fit }, (_, g) => tops.slice(Math.floor((g * tops.length) / fit), Math.floor(((g + 1) * tops.length) / fit)));
    cards.push({ title: isZh(title) ? '内容概览' : 'Overview', points: groups.map(g => (g.length > 1 ? `${g[0]}: ${g.slice(1).join(', ')}` : g[0]).slice(0, 120)) });
  }
  for (const chunk of source.chunks) {
    if (chunk.cardBudget < 1) continue;
    const sentences = sentenceSplit(chunk.text).filter(x => x.length > 30 && !x.startsWith('|'));
    const tableRows = chunk.text.split('\n').filter(x => x.startsWith('|')).slice(0, 8);
    const figs = chunk.figureIds.filter(id => !used.has(id));
    for (let k = 0; k < chunk.cardBudget; k++) {
      const slice = sentences.slice(Math.floor((k * sentences.length) / chunk.cardBudget), Math.floor(((k + 1) * sentences.length) / chunk.cardBudget));
      const points = slice.slice(0, per).map(x => x.slice(0, 220));
      if (k === 0 && tableRows.length) points.push(...tableRows.slice(1, 4).map(r => r.replace(/^\|\s*|\s*\|$/g, '').replace(/\s*\|\s*/g, ': ')));
      const figure = figs[k];
      if (figure) used.add(figure);
      const label = chunk.path.at(-1) || chunk.title;
      cards.push({ title: `${label.replace(/^(?:\d+|[A-Z])(?:\.\d+)*\.?\s+/, '')}${chunk.cardBudget > 1 ? ` (${k + 1})` : ''}`.slice(0, 120), points: points.length ? points : [chunk.title], sources: [chunk.id], ...(figure ? { figures: [figure] } : {}) });
    }
  }
  return { title, cards };
}

export function createMockModel(): DeckModel {
  return {
    kind: 'mock',
    label: 'demo model (offline)',
    async planOutline(s, inputText, opts) {
      if (opts?.source) return mockSourcedOutline(s, opts.source, topicOf(inputText), opts.components);
      let body = mockSections(s, inputText);
      if (s.textMode === 'condense') body = body.map(c => ({ ...c, points: c.points.slice(0, s.amount === 'brief' ? 2 : s.amount === 'medium' ? 3 : 5) }));
      if (opts?.instruction && /short|fewer|精简|少/i.test(opts.instruction)) body = body.slice(0, Math.max(2, Math.ceil(body.length / 2)));
      const title = topicOf(inputText);
      // When the input opens with the deck title as a heading, that section is the cover.
      const lead = body[0]?.title === title ? body.shift() : undefined;
      const cover = { title, points: [lead?.points[0] || (isZh(inputText) ? `关于「${title}」的概览` : `An overview of ${title}`)] };
      if (lead && lead.points.length > 1) body.unshift({ title: isZh(inputText) ? '要点概览' : 'At a glance', points: lead.points.slice(1) });
      const cards = s.cardSplit === 'inputTextBreaks' ? (lead ? [lead, ...body] : body) : [cover, ...body].slice(0, Math.max(s.numCards + 1, 2));
      return { title, cards };
    },
    async writeCard(_s, card, index) {
      // DECKS_MOCK_DELAY_MS simulates model latency so the live build view can be checked locally.
      const delay = Number(process.env.DECKS_MOCK_DELAY_MS || 0);
      if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
      return mockCardBlocks(card, index);
    },
    async editCards(_s, scope, instruction, cards) {
      const shorter = /short|concise|简短|精简|缩短/i.test(instruction);
      const edited = cards.map(card => ({
        id: card.id,
        accent: card.layout.accent,
        blocks: card.blocks.map(block => {
          if (scope.kind === 'block' && block.id !== scope.blockId) return block;
          if (block.type === 'paragraph' || block.type === 'callout' || block.type === 'quote') return { ...block, text: shorter ? block.text.split(/(?<=[.!?。！？])\s*/)[0] : `${block.text} (${instruction.slice(0, 40)})` };
          if (block.type === 'bullets' || block.type === 'numbered') return { ...block, items: shorter ? block.items.slice(0, Math.max(1, Math.ceil(block.items.length / 2))) : block.items.map(i => `**${i.split(' ')[0]}** ${i.split(' ').slice(1).join(' ')}`) };
          return block;
        }),
      }));
      return { cards: edited, summary: `Applied "${instruction.slice(0, 80)}" to ${scope.kind === 'deck' ? 'the deck' : scope.kind === 'card' ? 'one card' : 'one block'} (demo model).` };
    },
    async image() { return null; },
  };
}

let override: DeckModel | null = null;
/** Tests inject a model; production resolves provider → mock. */
export function setDeckModelForTests(model: DeckModel | null) { override = model; }

export async function resolveDeckModel(ref?: GenerationSettings['model']): Promise<DeckModel> {
  if (override) return override;
  if (process.env.DECKS_MODEL === 'mock') return createMockModel();
  try { return (await createProviderModel(ref)) || createMockModel(); } catch { return createMockModel(); }
}
