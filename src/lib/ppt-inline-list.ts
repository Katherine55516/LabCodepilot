/** Server limit for content.items (apps/cowork-server/lib/ppt/command-schema.mjs). */
export const PPT_MAX_LIST_ITEMS = 20;

type ListItem = { id: string; text: string; richText?: { source?: string } };
export type InlineListResult =
  | { items: { id: string; text: string }[] }
  | { error: { max: number; count: number } };

const itemText = (item: ListItem) => item.richText?.source ?? item.text;

/**
 * Maps the lines of an inline list edit back to item ids, so inserting or
 * moving a line does not shift every following item's formatting and source
 * binding:
 * 1. unchanged lines in order keep their id (longest common subsequence);
 * 2. a line moved elsewhere keeps the id of the identical unmatched item;
 * 3. a line edited in place takes the id of the unmatched item between the
 *    same neighbours; anything else is new.
 * Blank lines are dropped; more lines than the server accepts is an error,
 * never a silent truncation.
 */
export function inlineListItems(previous: ListItem[], text: string, newId: () => string): InlineListResult {
  const lines = text.split('\n').filter(line => line.trim());
  if (lines.length > PPT_MAX_LIST_ITEMS) return { error: { max: PPT_MAX_LIST_ITEMS, count: lines.length } };
  const before = previous.map(itemText);
  // lcs[i][j]: longest common subsequence of lines[i..] and before[j..].
  const lcs = Array.from({ length: lines.length + 1 }, () => new Array<number>(before.length + 1).fill(0));
  for (let i = lines.length - 1; i >= 0; i--)
    for (let j = before.length - 1; j >= 0; j--)
      lcs[i][j] = lines[i] === before[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const owner = new Array<number | undefined>(lines.length), used = new Set<number>();
  const gaps: { lines: number[]; items: number[] }[] = [{ lines: [], items: [] }];
  for (let i = 0, j = 0; i < lines.length || j < before.length;) {
    if (i < lines.length && j < before.length && lines[i] === before[j]) { owner[i++] = j; used.add(j++); gaps.push({ lines: [], items: [] }); }
    else if (j < before.length && (i === lines.length || lcs[i][j + 1] >= lcs[i + 1][j])) gaps.at(-1)!.items.push(j++);
    else gaps.at(-1)!.lines.push(i++);
  }
  for (const line of gaps.flatMap(gap => gap.lines)) {
    const moved = before.findIndex((value, index) => !used.has(index) && value === lines[line]);
    if (moved >= 0) { owner[line] = moved; used.add(moved); }
  }
  for (const gap of gaps) {
    const items = gap.items.filter(index => !used.has(index));
    gap.lines.filter(line => owner[line] === undefined).forEach((line, index) => { if (index < items.length) { owner[line] = items[index]; used.add(items[index]); } });
  }
  return { items: lines.map((line, index) => ({ id: owner[index] === undefined ? newId() : previous[owner[index]!].id, text: line })) };
}
