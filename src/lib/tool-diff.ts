/**
 * tool-diff.ts — line-level diff for file-editing tool calls, rendered inline in
 * the tool row (Claude-desktop style: `+N −M` in the header, green/red line
 * diff on expand).
 *
 * No external dependency: a compact LCS line diff (pure JS, unit-testable, no
 * React). Edit tools carry `old_string`/`new_string`; Write carries the whole
 * `content` (treated as all-additions); MultiEdit carries a list of edits.
 */

export interface DiffLine {
  type: 'add' | 'remove' | 'context';
  text: string;
}

export interface LineDiff {
  lines: DiffLine[];
  added: number;
  removed: number;
}

// Guard against pathological LCS sizes (O(m·n) table). Edit fragments are small;
// this only trips on huge inputs, where we fall back to remove-all + add-all.
const MAX_DIFF_CELLS = 4_000_000;

/**
 * Line-level diff of two texts via Longest Common Subsequence. Unchanged lines
 * are `context`, lines only in `oldText` are `remove`, lines only in `newText`
 * are `add`. Pure insertions/deletions (one side empty) skip the LCS table.
 */
export function computeLineDiff(oldText: string, newText: string): LineDiff {
  const oldLines = oldText.length === 0 ? [] : oldText.split('\n');
  const newLines = newText.length === 0 ? [] : newText.split('\n');

  if (oldLines.length === 0) {
    return { lines: newLines.map((text) => ({ type: 'add', text })), added: newLines.length, removed: 0 };
  }
  if (newLines.length === 0) {
    return { lines: oldLines.map((text) => ({ type: 'remove', text })), added: 0, removed: oldLines.length };
  }

  const m = oldLines.length;
  const n = newLines.length;

  if (m * n > MAX_DIFF_CELLS) {
    const lines: DiffLine[] = [
      ...oldLines.map((text) => ({ type: 'remove' as const, text })),
      ...newLines.map((text) => ({ type: 'add' as const, text })),
    ];
    return { lines, added: n, removed: m };
  }

  // lcs[i][j] = length of LCS of oldLines[i:] and newLines[j:]
  const lcs: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      lcs[i][j] = oldLines[i] === newLines[j]
        ? lcs[i + 1][j + 1] + 1
        : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const lines: DiffLine[] = [];
  let added = 0;
  let removed = 0;
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (oldLines[i] === newLines[j]) {
      lines.push({ type: 'context', text: oldLines[i] });
      i++; j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      lines.push({ type: 'remove', text: oldLines[i] });
      i++; removed++;
    } else {
      lines.push({ type: 'add', text: newLines[j] });
      j++; added++;
    }
  }
  while (i < m) { lines.push({ type: 'remove', text: oldLines[i] }); i++; removed++; }
  while (j < n) { lines.push({ type: 'add', text: newLines[j] }); j++; added++; }

  return { lines, added, removed };
}

const EDIT_TOOLS = new Set(['edit', 'edit_file', 'editfile', 'str_replace', 'str_replace_editor', 'str_replace_based_edit_tool']);
const WRITE_TOOLS = new Set(['write', 'write_file', 'writefile', 'create_file', 'createfile']);
const MULTI_EDIT_TOOLS = new Set(['multiedit', 'multi_edit']);

/**
 * Derive a line diff from a file-editing tool call's input, or null if the tool
 * is not a recognized file edit (caller falls back to the generic detail panel).
 */
export function toolDiff(name: string, input: unknown): LineDiff | null {
  if (!input || typeof input !== 'object') return null;
  const inp = input as Record<string, unknown>;
  const n = name.toLowerCase();

  if (EDIT_TOOLS.has(n) && typeof inp.old_string === 'string' && typeof inp.new_string === 'string') {
    return computeLineDiff(inp.old_string, inp.new_string);
  }

  if (WRITE_TOOLS.has(n) && typeof inp.content === 'string') {
    return computeLineDiff('', inp.content);
  }

  if (MULTI_EDIT_TOOLS.has(n) && Array.isArray(inp.edits)) {
    const merged: DiffLine[] = [];
    let added = 0;
    let removed = 0;
    for (const e of inp.edits as Array<Record<string, unknown>>) {
      if (e && typeof e.old_string === 'string' && typeof e.new_string === 'string') {
        const d = computeLineDiff(e.old_string, e.new_string);
        merged.push(...d.lines);
        added += d.added;
        removed += d.removed;
      }
    }
    return merged.length > 0 ? { lines: merged, added, removed } : null;
  }

  return null;
}
