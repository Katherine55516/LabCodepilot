/** Structure recognition for fenced, non-program text (P0-1/P0-2,
 * docs/exec-plans/active/ppt-structure-recognition-20261019.md).
 *
 * Plain-text drawings and listings in technical documents are not code and are
 * usually not branching diagrams either. Each recognizer below accepts only an
 * unambiguous shape and returns an editable native representation that keeps
 * every source label; anything else returns null and the caller keeps its
 * previous behaviour. Pure functions, no model calls. */

const han = text => /\p{Script=Han}/u.test(String(text || ''));
const nonBlank = text => String(text || '').split('\n').map(line => line.replace(/\s+$/u, '')).filter(line => line.trim());
const BOX = /[┌┐└┘├┤┬┴┼│─═║╔╗╚╝╦╩╠╣╬]/u;

/** One outer box whose sections are separated by full-width ├───┤ rules, each
 * section starting with a layer label followed by two or more spaces:
 *   ┌────┐ │ L5 输出与闭环    审计方案 / … │ ├────┤ │ L4 …  │ └────┘
 * → rows [layer, components] (continuation lines stay in the same cell). */
export function layerStackRows(text) {
  const lines = nonBlank(text).map(line => line.trim());
  if (lines.length < 5 || !/^[┌╔][─═]+[┐╗]$/u.test(lines[0]) || !/^[└╚][─═]+[┘╝]$/u.test(lines.at(-1))) return null;
  const sections = [[]];
  for (const line of lines.slice(1, -1)) {
    if (/^[├╠][─═]+[┤╣]$/u.test(line)) { sections.push([]); continue; }
    const inner = line.match(/^[│║](.*)[│║]$/u);
    if (!inner || BOX.test(inner[1].replace(/[─]/gu, ''))) return null;
    if (inner[1].trim()) sections.at(-1).push(inner[1]);
  }
  if (sections.length < 2 || sections.some(section => !section.length)) return null;
  const rows = [];
  for (const section of sections) {
    const first = section[0].trim(), split = first.match(/^(\S.*?)\s{2,}(\S.*)$/u);
    if (!split) return null;
    rows.push([split[1].trim(), [split[2].trim(), ...section.slice(1).map(line => line.trim())].join('\n')]);
  }
  const header = han(text) ? ['层级', '组成与职责'] : ['Layer', 'Components and responsibilities'];
  return { rows: [header, ...rows], basis: 'one outer box with ruled sections; each section is one layer row' };
}

/** A directory tree drawn with ├── / └── branches (`name/  # comment`).
 * Rows are the top-level entries: [entry, its comment, its children with their
 * comments]; deeper names are folded in parentheses. Every name is kept. */
export function directoryTreeRows(text) {
  const lines = nonBlank(text);
  if (lines.length < 6) return null;
  const nodes = []; let root = null;
  for (const line of lines) {
    if (/^[\s│|]+$/u.test(line)) continue;
    const branch = line.match(/^((?:[│|]   |    )*)(?:├──|└──|├─|└─)\s*(.+?)\s*$/u);
    if (!branch) { if (root || nodes.length) return null; root = line.trim(); continue; }
    const [, prefix, rest] = branch, comment = rest.match(/^(.*?\S)\s+#\s*(.*)$/u);
    nodes.push({ depth: prefix.length / 4 + 1, name: (comment ? comment[1] : rest).trim(), comment: comment ? comment[2].trim() : '' });
  }
  const pathLike = nodes.filter(node => /\/$|\.[A-Za-z0-9]{1,6}$/u.test(node.name.split(/\s+/u)[0]));
  if (nodes.length < 5 || pathLike.length / nodes.length < .7 || nodes.some(node => !Number.isInteger(node.depth))) return null;
  const folded = (index, depth) => {
    const out = [];
    for (let i = index + 1; i < nodes.length && nodes[i].depth > depth; i++) {
      if (nodes[i].depth !== depth + 1) continue;
      const deeper = folded(i, depth + 1);
      out.push(`${nodes[i].name}${nodes[i].comment ? ' ' + nodes[i].comment : ''}${deeper.length ? `（${deeper.join('、')}）` : ''}`);
    }
    return out;
  };
  // A long entry is one row per child so no single table row can outgrow a
  // page (rows are the unit the measured paginator may split between).
  const rows = [];
  nodes.forEach((node, index) => {
    if (node.depth !== 1) return;
    const children = folded(index, 1), joined = children.join('；');
    if ([...joined].length <= 140) { rows.push([node.name, node.comment, joined]); return; }
    const packed = [];
    for (const child of children) {
      const last = packed.at(-1);
      if (last && [...last.join('；') + '；' + child].length <= 140) last.push(child); else packed.push([child]);
    }
    packed.forEach((group, n) => rows.push([node.name, n ? '' : node.comment, group.join('；')]));
  });
  if (rows.length < 2) return null;
  const header = han(text) ? ['目录', '作用', '包含'] : ['Directory', 'Purpose', 'Contains'];
  return { rows: [header, ...rows], root, basis: 'directory tree summarized by top-level entry; nested names folded in order' };
}

/** `path-or-name   # comment` on every line (a file listing). */
export function annotatedListRows(text) {
  const lines = nonBlank(text);
  if (lines.length < 2 || lines.some(line => BOX.test(line))) return null;
  const rows = lines.map(line => line.match(/^\s*(\S(?:.*?\S)?)\s+#\s+(\S.*)$/u));
  if (rows.some(row => !row)) return null;
  const header = han(text) ? ['项', '说明'] : ['Item', 'Description'];
  return { rows: [header, ...rows.map(row => [row[1], row[2].trim()])], basis: 'annotated listing: one row per line' };
}

/** Split a chain on arrows that are outside (), （）, [] and quotes. */
function splitChain(chain) {
  const parts = []; let depth = 0, current = '';
  const chars = [...chain];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if ('(（[【'.includes(ch)) depth++;
    if (')）]】'.includes(ch)) depth = Math.max(0, depth - 1);
    if (!depth && (ch === '→' || ch === '⇒' || ch === '-' && chars[i + 1] === '>')) {
      if (ch === '-') i++;
      parts.push(current.trim()); current = ''; continue;
    }
    current += ch;
  }
  parts.push(current.trim());
  return parts;
}

/** Every line is `label：A → B → C` (named flows such as read/write paths). */
export function labeledFlowRows(text) {
  const lines = nonBlank(text);
  if (lines.length < 2) return null;
  const rows = lines.map(line => line.trim().match(/^([^：:→]{1,16})[：:]\s*(.+)$/u));
  if (rows.some(row => !row || splitChain(row[2]).filter(Boolean).length < 3)) return null;
  const header = han(text) ? ['流程', '步骤'] : ['Flow', 'Steps'];
  return { rows: [header, ...rows.map(row => [row[1].trim(), row[2].trim()])], basis: 'named arrow flows: one row per flow' };
}

const MARKER = /^\s*(?:(\d{1,2})[.)、]|([①-⑳]))\s*(\S.*)$/u;
/** Ordered steps written in a fence: numbered/circled lines (continuation lines
 * stay with their step; one preamble line is kept as the first step), or one
 * arrow chain whose continuation lines start with →. */
export function textFlowSteps(text) {
  const lines = nonBlank(text);
  if (lines.length < 2 || lines.some(line => BOX.test(line))) return null;
  const markers = lines.filter(line => MARKER.test(line));
  if (markers.length >= 3) {
    const steps = []; let preamble = [];
    for (const line of lines) {
      const marker = line.match(MARKER);
      if (marker) { steps.push(line.trim()); continue; }
      if (!steps.length) { preamble.push(line.trim()); continue; }
      if (!/^\s/u.test(line)) return null;
      steps[steps.length - 1] += ' ' + line.trim();
    }
    if (preamble.length > 1) return null;
    const numbered = steps.every(step => /^\d/u.test(step));
    return { steps: [...preamble, ...steps].map(step => numbered ? step.replace(/^(\d{1,2})[、)]\s*/u, '$1. ') : step), marked: true, numbered, basis: 'ordered steps from numbered or circled lines' };
  }
  if (!lines.slice(1).every(line => /^\s*(?:→|⇒|->)/u.test(line)) && !(lines.length <= 3 && lines.slice(1).every(line => /^\s+(?:→|⇒|->)/u.test(line)))) return null;
  const chain = lines.map(line => line.trim()).join(' ');
  const steps = splitChain(chain.replace(/^(?:→|⇒|->)\s*/u, ''));
  // Short chains (Input → A → B) stay literal; a real procedure has 4+ steps.
  if (steps.length < 4 || steps.some(step => !step)) return null;
  return { steps, marked: false, numbered: false, basis: 'one arrow chain split on top-level arrows' };
}

/** Structured configuration or data example (YAML/JSON/INI style). */
export function isConfigListing(text, language = '') {
  if (/^(?:ya?ml|json|jsonc|toml|ini|conf|properties|env)$/iu.test(String(language).trim())) return true;
  const lines = nonBlank(text);
  if (lines.length < 3) return false;
  const keyed = lines.filter(line => /^\s*-?\s*[\w.@$-]+\s*:\s*(?:\S|$)/u.test(line)).length;
  return keyed / lines.length >= .6;
}

/** Short pure label paragraphs such as "**处理步骤**：" introduce the next
 * structure; they carry no separate fact and should travel with it. */
export function isLeadInCaption(text) {
  const value = String(text || '').trim();
  if (value.includes('\n') || !/[：:]$/u.test(value) || /`|\d/u.test(value)) return false;
  // Only an explicitly emphasised label ("**处理步骤**：", optionally with a
  // parenthetical); an ordinary sentence ending in a colon is content.
  if (!/^(?:\*\*|__)[^*_，,。；;]+(?:\*\*|__)(?:（[^）]*）|\([^)]*\))?\s*[：:]$/u.test(value)) return false;
  const plain = value.replace(/\*\*|__|[*_]/gu, '').replace(/[：:]$/u, '').trim();
  return plain.length > 0 && [...plain].length <= 24;
}
