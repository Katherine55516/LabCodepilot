/** Replies are compiled before they are validated (plan ppt-pipeline-unblocked
 * phase 4). Every model reply passes through normalizeReply at the transport
 * boundary, guided only by the stage's own response schema, so a slip that
 * carries no meaning is settled once for every stage instead of costing each
 * stage a repair round:
 * - a repeated identifier in an ID list (items with an enum or const, or
 *   uniqueItems; a real reply: missingSourceUnitIds [b_0020, b_0020]);
 * - an enum value wrapped in whitespace;
 * - a `reason` (planning metadata, never shown to readers) over its schema
 *   maxLength, shortened at a sentence or clause boundary.
 * Visible content text is never rewritten here. Each change is returned as a note. */
const primitive = value => ['string', 'number', 'boolean'].includes(typeof value);
const REASON_PATH = /(?:^|\.)reason$/u;

/** Shortens planning metadata at the last sentence, clause or word boundary in
 * the second half of the limit; a hard cut otherwise. */
export function shortenAtBoundary(value, limit) {
  const text = String(value).replace(/\s+/gu, ' ').trim();
  if (text.length <= limit) return text;
  const head = text.slice(0, limit);
  for (const pattern of [/[。！？.!?](?=[^。！？.!?]*$)/u, /[；;，,：:、](?=[^；;，,：:、]*$)/u, /\s(?=\S*$)/u]) {
    const at = head.search(pattern);
    if (at >= limit * .5) return head.slice(0, at + (/\s/u.test(head[at]) ? 0 : 1)).replace(/[，,；;：:、]$/u, '').trim();
  }
  return head.trim();
}

export function normalizeReply(value, schema) {
  const notes = [];
  const walk = (node, rule, path) => {
    if (!rule || typeof rule !== 'object') return node;
    if (Array.isArray(node)) {
      let changed = false;
      let next = node.map((item, index) => { const settled = walk(item, rule.items, `${path}[${index}]`); if (settled !== item) changed = true; return settled; });
      const idList = rule.uniqueItems || Array.isArray(rule.items?.enum) || rule.items?.const !== undefined;
      if (idList && next.every(primitive)) {
        const unique = [...new Set(next)];
        if (unique.length !== next.length) { notes.push({ code: 'duplicate_ids_removed', path, removed: next.length - unique.length }); next = unique; changed = true; }
      }
      return changed ? next : node;
    }
    if (node && typeof node === 'object') {
      let out = node;
      for (const [key, child] of Object.entries(rule.properties || {})) {
        if (!(key in node)) continue;
        const settled = walk(node[key], child, path ? `${path}.${key}` : key);
        if (settled !== node[key]) { if (out === node) out = { ...node }; out[key] = settled; }
      }
      return out;
    }
    if (typeof node === 'string') {
      if (Array.isArray(rule.enum) && !rule.enum.includes(node) && rule.enum.includes(node.trim())) { notes.push({ code: 'enum_whitespace_trimmed', path }); return node.trim(); }
      if (REASON_PATH.test(path) && Number.isInteger(rule.maxLength) && node.length > rule.maxLength) {
        const shortened = shortenAtBoundary(node, rule.maxLength);
        if (shortened.length <= rule.maxLength && shortened.length >= (rule.minLength || 1)) { notes.push({ code: 'reason_shortened', path, from: node.length, to: shortened.length }); return shortened; }
      }
    }
    return node;
  };
  return { value: walk(value, schema, ''), notes };
}
