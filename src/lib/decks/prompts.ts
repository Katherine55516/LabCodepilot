import { AMOUNT_WORDS, languageInstruction } from './settings';
import type { Card, EditScope, GenerationSettings, OutlineCard } from './types';

/**
 * Prompts for the three model tasks. They encode the content rules observed
 * in Gamma (report 03 §3, §4, §5):
 * - the outline already holds each card's final points ("outline = content");
 * - split by idea, not by source heading; drop tables of contents;
 * - keep numbers, names and facts exactly as written; never invent data;
 * - titles state the point (assertions), not topics;
 * - choose components by content: numbers → metrics, sequences → steps,
 *   dates → timeline, parallel items → grid, tabular data → table or chart.
 */

const BLOCK_SCHEMA = `Blocks (JSON objects with "type"):
- {"type":"heading","level":1|2|3,"text":"…"}   (level 1 only on the title card)
- {"type":"paragraph","text":"…"}
- {"type":"bullets","items":["…"]} / {"type":"numbered","items":["…"]}
- {"type":"metrics","items":[{"value":"42%","label":"…","detail":"…"}]}   (2–4 items; only for real numbers from the input)
- {"type":"steps","items":[{"title":"…","text":"…"}]}   (ordered process, 2–5 items)
- {"type":"timeline","items":[{"label":"2019","title":"…","text":"…"}]}   (dated events, 2–6 items)
- {"type":"grid","items":[{"title":"…","text":"…"}]}   (parallel ideas, 2–6 items)
- {"type":"table","header":["…"],"rows":[["…"]]}   (≤ 6 columns, ≤ 10 rows)
- {"type":"chart","chartType":"bar"|"line"|"pie","labels":["…"],"series":[{"name":"…","values":[1,2]}],"unit":"%"}   (only with numbers from the input)
- {"type":"callout","tone":"info"|"warning"|"success"|"note","title":"…","text":"…"}
- {"type":"quote","text":"…","attribution":"…"}
- {"type":"code","language":"…","code":"…"}   (only when the input is about code)
- {"type":"columns","columns":[[blocks],[blocks]]}   (2–3 columns for comparisons)
- {"type":"image","alt":"…","caption":"…"}   (a placeholder for an image the author should add)
Inline text may use **bold**, *italic* and \`code\`.`;

function audienceLines(s: GenerationSettings) {
  return [
    s.tone && s.textMode !== 'preserve' ? `Tone: ${s.tone}.` : '',
    s.audience && s.textMode !== 'preserve' ? `Audience: ${s.audience}.` : '',
    s.additionalInstructions ? `Author instructions: ${s.additionalInstructions}` : '',
    languageInstruction(s.language),
  ].filter(Boolean).join('\n');
}

const MODE_RULES: Record<GenerationSettings['textMode'], string> = {
  generate: 'The input is a brief or rough notes. Expand it into substantive content using reliable general knowledge; do not invent specific statistics, quotes or sources.',
  condense: 'The input is source material. Condense it: keep the key claims, every number and name exactly as written, and the reasoning that supports them. Do not add facts that are not in the input.',
  preserve: 'Keep the input text as written. Only organise it into cards and add short headings where the text has none. Do not rewrite, summarise or add content.',
};

export function outlinePrompt(s: GenerationSettings, inputText: string, opts: { instruction?: string; previous?: OutlineCard[] } = {}) {
  const [minW, maxW] = AMOUNT_WORDS[s.amount];
  const system = `You plan presentation decks made of cards. Each card makes one point. ${MODE_RULES[s.textMode]}
Rules:
- Aim for about ${s.numCards} cards (a soft target: one more or fewer is fine when the content needs it). The first card is the title card.
- Split by idea, not by source heading: one dense section may become several cards; several thin sections may merge. Drop tables of contents and boilerplate.
- Card titles state the point as a short assertion ("Retention drops after week two"), not a topic label ("Retention").
- Each card's points are its final content, ${minW}–${maxW} words in total for a body card: full phrases, not keywords.
- Keep numbers, units, names and quoted wording exactly as in the input.
${audienceLines(s)}
Answer with JSON only: {"title":"deck title","cards":[{"title":"…","points":["…"]}]}`;
  const prompt = [
    opts.instruction ? `Rewrite instruction from the author: ${opts.instruction}` : '',
    opts.previous?.length ? `Current outline (revise it):\n${JSON.stringify(opts.previous.map(c => ({ title: c.title, points: c.points })))}` : '',
    `Input:\n"""\n${inputText.slice(0, 120_000)}\n"""`,
  ].filter(Boolean).join('\n\n');
  return { system, prompt };
}

export function cardPrompt(s: GenerationSettings, card: OutlineCard, index: number, total: number, deckTitle: string) {
  const [minW, maxW] = AMOUNT_WORDS[s.amount];
  const system = `You write one presentation card as structured blocks. ${MODE_RULES[s.textMode]}
${BLOCK_SCHEMA}
Rules:
- Start with one heading (level ${index === 0 ? 1 : 2}) carrying the card title.
- ${index === 0 ? 'This is the title card: heading level 1 plus one short paragraph subtitle. Nothing else.' : `Then 1–3 blocks expressing the points, about ${minW}–${maxW} words of body text. Prefer a structured component (metrics, steps, timeline, grid, table, chart, columns) when the points fit one; otherwise bullets or a paragraph.`}
- Keep every number and name from the points exactly. Do not invent data.
- Choose an accent image position that suits the content: "right" or "left" for text-heavy cards, "top" for short cards, "background" only for the title card or a single short statement, "none" for tables, charts and dense grids.
- imagePrompt: a concrete visual description for an illustration of this card's idea (no text in the image).
${audienceLines(s)}
Answer with JSON only: {"blocks":[…],"accent":"none|left|right|top|background","imagePrompt":"…"}`;
  const prompt = `Deck: ${deckTitle}\nCard ${index + 1} of ${total}\nTitle: ${card.title}\nPoints:\n${card.points.map(p => `- ${p}`).join('\n')}${card.instruction ? `\nAuthor instruction for this card: ${card.instruction}` : ''}`;
  return { system, prompt };
}

export function editPrompt(s: GenerationSettings, scope: EditScope, instruction: string, cards: Card[]) {
  const target = scope.kind === 'deck' ? 'the whole deck (you may change any card, add or remove cards)' : scope.kind === 'card' ? 'only the given card' : `only block "${scope.blockId}" of the given card; keep every other block unchanged`;
  const system = `You edit presentation cards. Apply the author's instruction to ${target}. Keep everything the instruction does not ask to change. Keep numbers and facts unless asked.
${BLOCK_SCHEMA}
${languageInstruction(s.language)}
Answer with JSON only: {"cards":[{"id":"existing card id, or new","blocks":[…],"accent":"none|left|right|top|background"}],"summary":"one sentence describing what changed"}
Return every card you were given, in order (changed or not), plus any new cards.`;
  const prompt = `Instruction: ${instruction}\n\nCards:\n${JSON.stringify(cards.map(c => ({ id: c.id, accent: c.layout.accent, blocks: c.blocks })))}`;
  return { system, prompt };
}
