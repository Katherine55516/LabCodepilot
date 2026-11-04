import {rehomeClosingAddenda} from './ppt-source-addenda.mjs';
import {literalTextFlow} from './ppt-text-flow.mjs';
import {asciiGraphProjection} from './ppt-ascii-graph.mjs';
import { buildContentInventory, markdownRows } from './ppt-content-inventory.mjs';
import { sourceChart } from './ppt-source-chart.mjs';
import { sourceSentences } from './ppt-source-boundaries.mjs';
/** Structure-aware, deterministic source index for the existing PPT source node.
 * Original source.segments remain the citation contract. Chunks can combine
 * several segments or split one segment, so chunk IDs never stand in for refs. */
import { buildEvidenceAtoms } from './ppt-evidence.mjs';
import { codeDiagram } from './ppt-presentation-policy.mjs';
import { isLeadInCaption } from './ppt-source-structures.mjs';
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
      const graphProjection=diagram?.kind==='ascii'?asciiGraphProjection(original):null;
      const literalDrawing=diagram?.kind==='ascii'&&['parallel','branching'].includes(diagram.relation)&&!graphProjection;
      const part = literalDrawing?original:diagram ? diagram.text : original;
      const chart = segment.chart || (!diagram && ['paragraph','table'].includes(type) ? sourceChart(part, { ...(type === 'table' ? {rows:segment.rows || markdownRows(part)} : {}), context:section.join(' ') }) : null);
      const diagramRows=graphProjection?.rows;
      const kind = diagramRows ? 'table' : chart ? 'chart' : diagram?.kind==='schema'?'table':diagram?.kind==='definition'?'paragraph':diagram ? 'diagram' : type === 'paragraph' && /(?:^|\n)\s*[┌└│├┐┘─]+/.test(part) ? 'diagram' : type;
      blocks.push({ id: `b_${String(blocks.length + 1).padStart(4, '0')}`, type: kind, text: part,
        sourceRefs: segment.sourceRefs || [String(segment.id)], location: segment.location || '', sectionPath: [...section],
        ...(segment.diagram?.kind==='sequence'?{sourceDiagramContext:{kind:'sequence',topologyEvidence:segment.diagram.topologyEvidence},mainIdeaRequired:kind!=='heading'}:{}),
        ...(diagram ? { diagramSource: { kind: diagram.kind, relation:graphProjection?'directed_graph':diagram.relation||'ordered', language: segment.language || '', text: original,...(diagram.intervalCount?{intervalCount:diagram.intervalCount}:{}),...(diagram.structureBasis?{structureBasis:diagram.structureBasis}:{}),...(literalDrawing?{presentation:'literal_source_lines'}:{}),...(graphProjection?{presentation:'semantic_graph_rows',originalRelation:diagram.relation||'ordered',graph:graphProjection.graph}:{}) },...(diagram.rows?{rows:diagram.rows}:{}) } : {}),
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
      // A wrapped author-year citation in PDF prose is not an ordered step:
      // "... Oudeyer et al.,\n2007) and information seeking ...". Require
      // an open parenthesis in the preceding prose so real numbered entries
      // (including large identifiers) keep their existing list semantics.
      const prior=pendingType==='paragraph'?pending.join('\n'):'';
      const citationContinuation=/^(?:1[5-9]\d{2}|20\d{2}|21\d{2})\)\s+/u.test(trimmed)&&
        (prior.match(/\(/gu)||[]).length>(prior.match(/\)/gu)||[]).length;
      const type = /^(?:\$\$|\\\[|\\\]|\\begin\{(?:align|equation)|\\end\{(?:align|equation))/.test(trimmed) ? 'equation' : /^\|.*\|$/.test(trimmed) || /^(?:CSV |工作表 |表 \d+ 行)/.test(segment.location || '') ? 'table'
        : !citationContinuation&&/^(?:[-*+]\s+|\d+[.)]\s+)/.test(trimmed) ? 'list'
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

/** A pure label paragraph ("**处理步骤**：") that introduces the next table,
 * listing, drawing or list in the same section travels with that structure as
 * its caption instead of becoming a separate content unit. */
export function attachLeadInCaptions(blocks) {
  const out = [];
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i], next = blocks[i + 1];
    if (block.type === 'paragraph' && next && ['table','code','diagram','list','chart'].includes(next.type) && sameSection(block, next) && isLeadInCaption(block.text)) {
      next.caption = block.text.replace(/\*\*|__/gu, '').replace(/[：:]\s*$/u, '').trim();
      next.captionSourceRefs = block.sourceRefs;
      continue;
    }
    out.push(block);
  }
  return out;
}

// PDF text arrives in layout fragments: a column or page break cuts a
// sentence, a numbered procedure or an inline formula into separate blocks,
// and a line-break hyphen splits words ("knowl- edge"). Rebuild reading units
// on sentence/step boundaries so one idea stays in one source unit.
const LAYOUT_SOURCE=/^PDF\b/u;
const MERGEABLE=new Set(['paragraph','list']);
const SENTENCE_END=/[.!?。！？;；:：]["'”’)\]]*\s*$/u;
const COMPOUND_HEAD=/^(?:model|self|well|high|low|non|multi|real|long|short|large|small|open|end|state|time|data|world|task|fine|pre|post|semi|cross|state-of-the|trade|first|second|third|two|three|single|zero|one)$/iu;
export function dehyphenateLayout(text){
 return String(text).replace(/(\b\p{L}{2,})-\s+(\p{Ll}{2,})/gu,(all,head,tail)=>COMPOUND_HEAD.test(head)?`${head}-${tail}`:head+tail);
}
const lastStep=text=>{let max=0;for(const match of String(text).matchAll(/(?:^|[\s(])(\d{1,2})[.)]\s+\S/gu))max=Math.max(max,Number(match[1]));return max;};
const firstStep=text=>Number(String(text).match(/^\s*(\d{1,2})[.)]\s+\S/u)?.[1]||0);
// A PDF table that crosses a page break is read as two tables, the header
// repeated (CodePilot pdf b_0110 + b_0111, "类别 | 命令": p11 showed one row).
// The second joins the first when its header is the same, or when it has the
// same columns and at most two rows (no repeated header); Fable, 2026-11-01, B5.
const tableLines=block=>String(block.text||'').split('\n').filter(line=>line.trim()&&!/^\s*\|?[\s:|-]+\|?\s*$/u.test(line));
const tableCells=line=>line.trim().replace(/^\||\|$/gu,'').split('|').map(cell=>cell.trim().normalize('NFKC').replace(/\s+/gu,' ').toLocaleLowerCase());
function continuedTable(prev,block){
 if(prev?.type!=='table'||block.type!=='table'||!LAYOUT_SOURCE.test(prev.location||'')||!LAYOUT_SOURCE.test(block.location||'')||prev.location===block.location)return null;
 if(JSON.stringify(prev.sectionPath)!==JSON.stringify(block.sectionPath))return null;
 const head=tableLines(prev),rows=tableLines(block);if(!head.length||!rows.length)return null;
 const header=tableCells(head[0]),first=tableCells(rows[0]);if(header.length!==first.length)return null;
 if(JSON.stringify(header)===JSON.stringify(first))return {rows:rows.slice(1),repeated:true};
 return rows.length<=2?{rows,repeated:false}:null;
}
export function mergeLayoutContinuations(blocks){
 const out=[];
 for(const original of blocks){
  // PDF table cells are laid out text too ("represen- tations"; Fable, 2026-11-01).
  const pdf=LAYOUT_SOURCE.test(original.location||'');
  const block=pdf&&MERGEABLE.has(original.type)?{...original,text:dehyphenateLayout(original.text)}
   :pdf&&original.type==='table'?{...original,text:dehyphenateLayout(original.text),...(Array.isArray(original.rows)?{rows:original.rows.map(row=>row.map(cell=>typeof cell==='string'?dehyphenateLayout(cell):cell))}:{})}:original;
  const prev=out.at(-1);
  const table=continuedTable(prev,block);
  if(table){const text=[String(prev.text).trimEnd(),...table.rows].join('\n');
   out[out.length-1]={...prev,text,...(Array.isArray(prev.rows)&&Array.isArray(block.rows)?{rows:[...prev.rows,...block.rows.slice(table.repeated?1:0)]}:{}),
    sourceRefs:[...new Set([...(prev.sourceRefs||[]),...(block.sourceRefs||[])])],tokenCount:estimateTokens(text),locationEnd:block.location};
   continue;}
  const eligible=prev&&MERGEABLE.has(prev.type)&&MERGEABLE.has(block.type)&&LAYOUT_SOURCE.test(prev.location||'')&&LAYOUT_SOURCE.test(block.location||'')&&JSON.stringify(prev.sectionPath)===JSON.stringify(block.sectionPath);
  const step=eligible&&firstStep(block.text);
  const continues=eligible&&(!SENTENCE_END.test(prev.text)||/^\s*[\p{Ll},;)\]]/u.test(block.text)||step&&step===lastStep(prev.text)+1);
  const fits=continues&&(block.tokenCount<=40||prev.tokenCount+block.tokenCount<=SOFT_TOKENS);
  if(!fits){out.push(block);continue;}
  const text=dehyphenateLayout(prev.text+(step?'\n':' ')+block.text.trimStart());
  out[out.length-1]={...prev,type:step||prev.type==='list'||block.type==='list'?'list':prev.type,text,
   sourceRefs:[...new Set([...(prev.sourceRefs||[]),...(block.sourceRefs||[])])],tokenCount:estimateTokens(text),
   ...(prev.location!==block.location?{locationEnd:block.location}:{})};
 }
 return out.map((block,position)=>({...block,position}));
}

export function buildSemanticIndex(segments) {
  const blocks = attachLeadInCaptions(mergeLayoutContinuations(parseBlocks(segments)));
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

// A bibliography is archive (Fable 2026-10-27, world_models.pdf): its entries
// are never cards, never required objects and never owed an owner.
const BIBLIOGRAPHY=/^(?:[\dA-Z]+[.)]?\s+)?(?:references?|bibliography|works cited|literature cited|参考文献|參考文獻|引用文献)$/iu;
const ACKNOWLEDGEMENTS=/^(?:[\dA-Z]+[.)]?\s+)?(?:acknowledg(?:e)?ments?|致谢|致謝|鸣谢|鳴謝)$/iu;
// Appendices of papers/reports: supplementary detail, not the presentation's story.
const APPENDIX=/^(?:[\dA-Z]+[.)]?\s+)?(?:appendix|appendices|supplementary(?:\s+(?:material|materials|information))?|附录|附錄)(?:\s+[\dA-Z]+)?$/iu;
export function withSemanticIndex(source) {
  if (!source || !Array.isArray(source.segments)) return source;
  const semantic = buildSemanticIndex(source.segments);
  rehomeClosingAddenda(semantic.inventory);
  for (const item of semantic?.inventory?.items || []){
    const headings=(item.sectionPath||[]).map(heading=>String(heading).trim());
    const basis=backMatterBasis(headings);
    if(!item.presentation&&basis)Object.assign(item,{presentation:'excluded_by_policy',presentationBasis:basis,must_preserve_structure:false});
  }
  return { ...source, semantic, ...(Array.isArray(source.images)?{images:markBackMatterImages(source.images,semantic.blocks)}:{}) };
}
/** Back matter (bibliography, acknowledgements, appendix) is document provenance, not the presentation's story. */
export function backMatterBasis(headings){
 const list=(headings||[]).map(heading=>String(heading).trim());
 return list.some(heading=>BIBLIOGRAPHY.test(heading))?'bibliography':list.some(heading=>ACKNOWLEDGEMENTS.test(heading))?'acknowledgements':list.some(heading=>APPENDIX.test(heading))?'appendix':null;
}
const pageOf=value=>{const match=String(value||'').match(/(\d+)/u);return match?Number(match[1]):null;};
const figureLabel=caption=>String(caption||'').match(/^\s*(?:figure|fig\.?|图|圖)\s*([A-Z]?\d+(?:\.\d+)?)/iu)?.[1]||null;
/** A source figure that only appears in back matter is marked like its text:
 * after the first back-matter page, or on that boundary page when the body
 * never cites its figure number. Figures the body cites stay available. */
export function markBackMatterImages(images,blocks=[]){
 const back=blocks.filter(block=>block.type==='heading'&&backMatterBasis([...(block.sectionPath||[]),block.text]));
 const firstBackPage=Math.min(...back.map(block=>pageOf(block.location)??pageOf(block.sourceRefs?.[0])).filter(Number.isFinite));
 if(!Number.isFinite(firstBackPage))return images;
 const body=blocks.filter(block=>block.type!=='heading'&&!backMatterBasis(block.sectionPath)).map(block=>String(block.text||'')).filter(text=>!/^\s*(?:figure|fig\.?|图|圖)\s*[A-Z]?\d/iu.test(text)).join('\n');
 const cited=label=>label&&new RegExp(`(?:figure|fig\\.?|图|圖)\\s*${label.replace('.','\\.')}(?![\\d.])`,'iu').test(body);
 return images.map(image=>{
  if(image.presentation||image.mustPreserve||image.explicitMustDisplay||image.mustDisplay)return image;
  const page=pageOf(image.location)??pageOf(image.sourceRefs?.[0]);
  const backOnly=Number.isFinite(page)&&(page>firstBackPage||page===firstBackPage&&!cited(figureLabel(image.caption)));
  return backOnly?{...image,presentation:'excluded_by_policy',presentationBasis:'appendix'}:image;
 });
}

export const SEMANTIC_LIMITS = { HARD_TOKENS, SOFT_TOKENS, TARGET_TOKENS, SMALL_TOKENS };
