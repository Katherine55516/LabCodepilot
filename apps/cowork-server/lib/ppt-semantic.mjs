import {literalTextFlow} from './ppt-text-flow.mjs';
import { buildContentInventory, markdownRows } from './ppt-content-inventory.mjs';
import { sourceChart } from './ppt-source-chart.mjs';
import { sourceSentences } from './ppt-source-boundaries.mjs';
/** Structure-aware, deterministic source index for the existing PPT source node.
 * Original source.segments remain the citation contract. Chunks can combine
 * several segments or split one segment, so chunk IDs never stand in for refs. */
import { buildEvidenceAtoms } from './ppt-evidence.mjs';
import { codeDiagram } from './ppt-presentation-policy.mjs';
const HARD_TOKENS = 1200;
const SOFT_TOKENS = 800;
const TARGET_TOKENS = 550;
const SMALL_TOKENS = 120;

export function estimateTokens(text) {
  const value = String(text || '');
  const cjk = (value.match(/[\u2e80-\u9fff\uf900-\ufaff]/g) || []).length;
  const other = value.replace(/[\u2e80-\u9fff\uf900-\ufaff]/g, ' ');
  return Math.max(1, Math.ceil(cjk * 1.35 + (other.match(/[\p{L}\p{N}_]+|[^\s]/gu) || []).length * 1.25));
}

function terms(text) {
  const latin = String(text).toLocaleLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) || [];
  const cjk = (String(text).match(/[\u3400-\u9fff]{2,}/g) || []).flatMap(word => word.length <= 4 ? [word] : [word.slice(0, 4), word.slice(-4)]);
  return new Set([...latin, ...cjk]);
}

function similarity(a, b) {
  const left = terms(a); const right = terms(b);
  if (!left.size || !right.size) return 0;
  const overlap = [...left].filter(term => right.has(term)).length;
  return overlap / Math.sqrt(left.size * right.size);
}

function semanticType(text, blockType) {
  const value = String(text || '').toLocaleLowerCase();
  if (blockType === 'table') return 'table';
  if (blockType === 'chart') return 'chart';
  if (blockType === 'diagram') return 'diagram';
  if (blockType === 'code') return 'code';
  // Temporal prerequisites (before/after acceptance) are not comparisons.
  if (/\b(?:vs\.?|versus|compare|comparison)\b|\bbefore\s*:[\s\S]*\bafter\s*:|对比|比较|差异|优劣/.test(value)) return 'comparison';
  if (/架构|architecture|系统组成|模块关系|组件/.test(value)) return 'architecture';
  if (/流程|步骤|pipeline|process|workflow/.test(value)) return 'process';
  if (/时间线|里程碑|roadmap|timeline|计划阶段/.test(value)) return 'timeline';
  if (/风险|制约|挑战|问题|risk|problem/.test(value)) return 'problem';
  if (/建议|原则|应该|recommendation|solution/.test(value)) return 'recommendation';
  if (/\d+(?:\.\d+)?\s*(?:%|万元|亿元|ms|秒|分钟)|指标|metric|kpi/.test(value)) return 'metric';
  if (/例如|案例|example|case study/.test(value)) return 'example';
  if (/因为|因此|原因|导致|cause|result/.test(value)) return 'evidence';
  if (/定义|是指|means|definition/.test(value)) return 'definition';
  return 'explanation';
}

function discourseRole(text, type) {
  if (type === 'heading') return 'topic';
  if (/例如|举例|example|case study/i.test(text)) return 'example';
  if (/来源|数据表明|证据|according to|evidence/i.test(text)) return 'evidence';
  if (/因此|所以|结论|意味着|therefore|implies/i.test(text)) return 'implication';
  if (/但是|然而|相比|whereas|however/i.test(text)) return 'contrast';
  return 'explanation';
}

function contentKind(sectionPath, blockType) {
  const section = (sectionPath || []).slice(-2).join(' ').toLocaleLowerCase();
  if (blockType === 'code' || /\b(?:example|examples|case study|case studies|how companies|sketch|worked|notebook \d+ objectives)\b/.test(section)) return 'example';
  if (/\b(?:steps|workflow|configuration|configuring|deployment path)\b/.test(section)) return 'procedure';
  return 'concept';
}

function visualCandidates(type, text) {
  const result = [];
  if (['comparison'].includes(type)) result.push('comparison');
  if (['process', 'timeline', 'diagram'].includes(type) || /→|->/.test(text)) result.push(type === 'timeline' ? 'timeline' : 'pipeline');
  if (type === 'architecture') result.push('architecture');
  if (type === 'table') result.push('table');
  if (type === 'chart') result.push('chart');
  if (type === 'metric') result.push('metric');
  return result;
}

function splitLongUnit(text, limit = 600) {
  if (estimateTokens(text) <= limit) return [text];
  // Preserve sentence boundaries; whitespace is a fallback for a long single
  // sentence. A final grapheme split is used only for unbroken source text.
  const pieces = sourceSentences(text);
  const units = pieces.flatMap(piece => {
    if (estimateTokens(piece) <= limit) return [piece];
    const words = piece.match(/\S+\s*|\s+/g) || [piece];
    if (words.length > 1) return words.flatMap(word => estimateTokens(word) <= limit ? [word] : [...word]);
    return [...piece];
  });
  const result = []; let current = '';
  for (const unit of units) {
    if (current && estimateTokens(current + unit) > limit) { result.push(current.trim()); current = ''; }
    current += unit;
  }
  if (current.trim()) result.push(current.trim());
  return result;
}

/** Wide ASCII architecture labels already have a normalized level order. A
 * compact drawing stays verbatim; a large one uses one editable table row per
 * complete normalized level, allowing the existing exact row-range paginator
 * to split it without cutting branches/labels or shrinking readable text. */
export function diagramPresentationRows(diagram,original){
  if(diagram?.kind!=='ascii'||!['parallel','branching'].includes(diagram.relation))return null;
  const raw=String(original||'').split('\n'),levels=String(diagram.text||'').split('\n').filter(line=>line.trim());
  if(raw.length<=13&&Math.max(...raw.map(line=>line.length))<=64||levels.length<2)return null;
  // Preserve the complete original lines, including condition labels, arrows,
  // indentation and blank lines. Normalized diagram.text is a navigation
  // summary and can omit branch edges; it cannot be the source of table cells.
  return [[''],...raw.map(line=>[line])];
}

function parseBlocks(segments) {
  const blocks = [];
  const section = [];
  let mathFence = false; let mathLines = []; let mathRefs = [];
  let fenceLanguage = ''; let fenceMark = ''; let fence = false; let fenceLines = []; let fenceRefs = []; let fenceLocation = '';
  let origin = null;
  function add(type, text, segment) {
    const value = type === 'code' ? text : text.trim();
    if (!value) return;
    for (const original of ['table','code','chart','equation'].includes(type) ? [value] : splitLongUnit(value)) {
      // A fenced ASCII/mermaid flowchart is a process, not code: it becomes
      // ordered steps (the raw drawing stays in diagramSource for tracing).
      const diagram = type === 'code' ? codeDiagram(original, segment.language || '') : type==='equation'?literalTextFlow(original):null;
      const part = diagram ? diagram.text : original;
      const chart = segment.chart || (!diagram && ['paragraph','table'].includes(type) ? sourceChart(part, { ...(type === 'table' ? {rows:segment.rows || markdownRows(part)} : {}), context:section.join(' ') }) : null);
      const diagramRows=diagramPresentationRows(diagram,original);
      const kind = diagramRows ? 'table' : chart ? 'chart' : diagram?.kind==='schema'?'table':diagram?.kind==='definition'?'paragraph':diagram ? 'diagram' : type === 'paragraph' && /(?:^|\n)\s*[┌└│├┐┘─]+/.test(part) ? 'diagram' : type;
      blocks.push({ id: `b_${String(blocks.length + 1).padStart(4, '0')}`, type: kind, text: part,
        sourceRefs: segment.sourceRefs || [String(segment.id)], location: segment.location || '', sectionPath: [...section],
        ...(diagram ? { diagramSource: { kind: diagram.kind, relation:diagram.relation||'ordered', language: segment.language || '', text: original,...(diagramRows?{presentation:'ordered_rows'}:{}) },...(diagram.rows?{rows:diagram.rows}:{}) } : {}),
        ...(diagramRows?{rows:diagramRows}:segment.rows ? { rows:segment.rows } : {}), ...(chart?{chart}:{}), ...(kind==='code'?{language:segment.language || ''}:{}),
        position: blocks.length, tokenCount: estimateTokens(part), semanticType: diagram?.kind==='definition'?'definition':diagram&&['parallel','branching'].includes(diagram.relation)?'comparison':semanticType(part, kind),
        contentKind: contentKind(section, kind),
        discourseRole: discourseRole(part, kind) });
    }
  }
  for (const segment of segments || []) {
    if (segment.origin && segment.origin !== origin) { origin = segment.origin; section.length = 0; section.push(origin === 'base' ? '旧版' : '最新进展'); }
    // Page labels stand in for sections only when the file has no headings;
    // a PDF section with real headings continues across page breaks.
    if (!segment.origin && !segment.continuesSection && /^(?:幻灯片|PDF 第)\s*\d+/.test(segment.location || '')) { section.length = 0; section.push(segment.location); }
    if (segment.kind==='code' || segment.kind==='table' || segment.kind==='chart') { add(segment.kind,segment.text,segment); continue; }
    const lines = String(segment.text || '').replace(/\r\n?/g, '\n').split('\n');
    let pending = []; let pendingType = 'paragraph';
    function flush() { if (pending.length) add(pendingType, pending.join('\n'), segment); pending = []; }
    for (const line of lines) {
      const trimmed = line.trim();
      const codeFence=trimmed.match(/^(`{3,}|~{3,})(.*)$/);
      if (codeFence && (!fence || codeFence[1][0]===fenceMark[0] && codeFence[1].length>=fenceMark.length && !codeFence[2].trim())) {
        flush();
        if (fence) { add('code', fenceLines.join('\n'), { sourceRefs: [...new Set([...fenceRefs, String(segment.id)])], location: fenceLocation, language:fenceLanguage }); fenceLines = []; fenceRefs = []; fence = false; }
        else { fenceLanguage=codeFence[2].trim(); fenceMark=codeFence[1]; fence = true; fenceRefs = [String(segment.id)]; fenceLocation = segment.location || ''; }
        continue;
      }
      if (fence) { fenceLines.push(line); if (!fenceRefs.includes(String(segment.id))) fenceRefs.push(String(segment.id)); continue; }
      if (/^(?:\$\$|\\\[|\\\])$/.test(trimmed)) {
        flush();
        if (mathFence) { add('equation', '$$\n'+mathLines.join('\n')+'\n$$', {sourceRefs:[...new Set([...mathRefs,String(segment.id)])],location:segment.location}); mathLines=[]; mathRefs=[]; mathFence=false; }
        else { mathFence=true; mathRefs=[String(segment.id)]; }
        continue;
      }
      if (mathFence) { mathLines.push(line); mathRefs.push(String(segment.id)); continue; }
      const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
      if (heading) {
        flush(); const level = heading[1].length + (origin ? 1 : 0);
        section.length = Math.min(section.length, level - 1);
        section[level - 1] = heading[2].trim();
        add('heading', heading[2], segment);
        continue;
      }
      if (!trimmed) { flush(); continue; }
      const type = /^(?:\$\$|\\\[|\\\]|\\begin\{(?:align|equation)|\\end\{(?:align|equation))/.test(trimmed) ? 'equation' : /^\|.*\|$/.test(trimmed) || /^(?:CSV |工作表 |表 \d+ 行)/.test(segment.location || '') ? 'table'
        : /^(?:[-*+]\s+|\d+[.)]\s+)/.test(trimmed) ? 'list'
          : /^>\s?/.test(trimmed) ? 'quote'
            : /(?:^|\s)(?:→|->|↓|↑|⇄)(?:\s|$)|^[┌└│├┐┘─]/.test(trimmed) ? 'diagram'
              : 'paragraph';
      if (pending.length && type !== pendingType) flush();
      pendingType = type; pending.push(line);
    }
    flush();
  }
  if (mathLines.length) add('equation', mathLines.join('\n'), {sourceRefs:[...new Set(mathRefs)]});
  if (fenceLines.length) add('code', fenceLines.join('\n'), { sourceRefs: fenceRefs, location: fenceLocation, language:fenceLanguage });
  return blocks;
}

function sameSection(a, b) {
  const left = a.sectionPath.join('\0'); const right = b.sectionPath.join('\0');
  return left === right || !left || !right;
}

function groupBlocks(blocks) {
  const initial = []; let current = [];
  function flush() { if (current.length) initial.push(current); current = []; }
  for (const block of blocks) {
    const last = current.at(-1);
    const tokens = current.reduce((sum, item) => sum + item.tokenCount, 0);
    const sectionBreak = last && !sameSection(last, block);
    const topicBreak = last && tokens >= 220 && block.tokenCount >= 100 && similarity(last.text, block.text) < .08 && block.type !== 'list';
    const sizeBreak = last && tokens + block.tokenCount > TARGET_TOKENS && tokens >= SMALL_TOKENS;
    if (sectionBreak || topicBreak || sizeBreak) flush();
    current.push(block);
  }
  flush();
  // Only adjacent chunks with compatible sections can merge. This captures
  // headings, schema fields and short list fragments without crossing topics.
  let mergedCount = 0;
  for (let index = 0; index < initial.length - 1; index++) {
    const group = initial[index]; const next = initial[index + 1];
    const count = group.reduce((sum, block) => sum + block.tokenCount, 0);
    const nextCount = next.reduce((sum, block) => sum + block.tokenCount, 0);
    const headingOnly = group.every(block => block.type === 'heading');
    const parentHeading = headingOnly && next[0].sectionPath.join('\0').startsWith(group.at(-1).sectionPath.join('\0'));
    if (count >= SMALL_TOKENS || count + nextCount > SOFT_TOKENS || !(sameSection(group.at(-1), next[0]) || parentHeading)) continue;
    if (headingOnly || similarity(group.at(-1).text, next[0].text) >= .12 || count < 80) {
      next.unshift(...group); initial.splice(index, 1); mergedCount++; index--;
    }
  }
  const groups = [];
  for (const group of initial) {
    let part = []; let count = 0;
    for (const block of group) {
      if (part.length && count + block.tokenCount > HARD_TOKENS && !(block.type==='code' && part.every(item=>item.type==='heading'))) { groups.push(part); part = []; count = 0; }
      part.push(block); count += block.tokenCount;
    }
    if (part.length) groups.push(part);
  }
  return { groups, initialCount: initial.length + mergedCount, mergedCount, splitCount: groups.length - initial.length };
}

export function buildSemanticIndex(segments) {
  const blocks = parseBlocks(segments);
  const { groups, initialCount, mergedCount, splitCount } = groupBlocks(blocks);
  const chunks = groups.map((group, index) => {
    const text = group.map(block => block.text).join('\n\n');
    const navigation = /^(?:table of contents|contents|目录)(?:\s*\||$)/iu.test(String(group.at(-1).sectionPath.at(-1) || '').trim());
    const meaningful = group.find(block => block.type !== 'heading') || group[0];
    const types = group.map(block => block.semanticType);
    const semanticType = types.find(type => ['architecture', 'comparison', 'process', 'timeline', 'table', 'metric', 'diagram'].includes(type)) || meaningful.semanticType;
    return { id: `c_${String(index + 1).padStart(3, '0')}`, topic: group.at(-1).sectionPath.at(-1) || group[0].text.slice(0, 80),
      sectionPath: group.at(-1).sectionPath, semanticType, discourseRole: meaningful.discourseRole,
      contentKind: navigation ? 'navigation' : contentKind(group.at(-1).sectionPath, meaningful.type),
      text, tokenCount: group.reduce((sum, block) => sum + block.tokenCount, 0),
      sourceBlocks: group.map(block => block.id), sourceRefs: [...new Set(group.flatMap(block => block.sourceRefs))],
      visualCandidates: [...new Set(group.flatMap(block => visualCandidates(block.semanticType, block.text)))],
      // A heading defines a boundary; it does not make a short navigation or
      // chapter-intro fragment a high-priority content page by itself.
      priority: !navigation && group.filter(block => block.type !== 'heading').reduce((sum, block) => sum + block.tokenCount, 0) >= 120 &&
        ['architecture', 'comparison', 'process', 'metric', 'recommendation'].includes(semanticType) ? 'high' : 'normal',
    };
  });
  const evidenceAtoms = buildEvidenceAtoms(blocks, chunks);
  const evidenceByChunk = new Map();
  for (const atom of evidenceAtoms) {
    if (!atom.chunkId) continue;
    if (!evidenceByChunk.has(atom.chunkId)) evidenceByChunk.set(atom.chunkId, []);
    evidenceByChunk.get(atom.chunkId).push(atom.id);
  }
  for (const chunk of chunks) chunk.evidenceIds = evidenceByChunk.get(chunk.id) || [];
  const graph = chunks.slice(1).map((chunk, index) => ({ from: chunks[index].id, to: chunk.id,
    relation: chunk.semanticType === 'comparison' ? 'contrasts_with' : chunk.semanticType === 'process' ? 'precedes' : 'explains' }));
  return { version: 3, blocks, chunks, evidenceAtoms, graph, inventory: buildContentInventory(blocks, chunks, graph),
    stats: { atomicBlockCount: blocks.length, initialChunkCount: initialCount, mergedChunkCount: mergedCount,
      splitChunkCount: Math.max(0, splitCount), finalChunkCount: chunks.length,
      evidenceAtomCount: evidenceAtoms.length, numericEvidenceCount: evidenceAtoms.filter(atom => atom.kind === 'number').length,
      orphanHeadingCount: chunks.filter(chunk => chunk.sourceBlocks.length === 1 && blocks.find(block => block.id === chunk.sourceBlocks[0])?.type === 'heading').length,
      oversizedAtomicCodeCount: chunks.filter(chunk=>chunk.tokenCount>HARD_TOKENS&&chunk.sourceBlocks.some(id=>blocks.find(block=>block.id===id)?.type==='code')).length,
      oversizedChunkCount: chunks.filter(chunk => chunk.tokenCount > HARD_TOKENS).length } };
}

export function withSemanticIndex(source) {
  if (!source || !Array.isArray(source.segments)) return source;
  return { ...source, semantic: buildSemanticIndex(source.segments) };
}

export const SEMANTIC_LIMITS = { HARD_TOKENS, SOFT_TOKENS, TARGET_TOKENS, SMALL_TOKENS };
