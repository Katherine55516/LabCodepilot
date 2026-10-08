import { visibleNodes, nodeContentText } from './ppt-visible-content.mjs';
/** Source-grounded evidence lives in the existing semantic index. These atoms
 * are deterministic excerpts, not claims invented by the planner or writer. */
const QUANTITY = /(?<![\p{L}\p{N}_])(?<value>\d[\d,.]*(?:\s*(?:–|-|→|to)\s*\d[\d,.]*)?)\s*(?<unit>PFLOPS|TFLOPS|FLOPS|TPS\s*\/\s*(?:GPU|user)|tokens?\s*\/\s*(?:s|sec|second|GPU|user)|GB|GiB|TB|MB|ms|milliseconds?|seconds?|bits?\s*\/\s*value|bits?|bytes?|layers?|heads?|parameters?|points?|billion|million|万|亿|%|％|×|B\b|M\b)/giu;
const QUALIFIER = /\b(?:about|approximately|around|roughly|at least|up to|estimated?|under|for|with|at|compared with|versus)\b|约|大约|估算|至少|最高|相较|在[^，。；;]{1,25}(?:下|时)/giu;
const CONSTRAINT = /\b(?:unless|only if|requires?|limited by|cannot|must|depends on|bottleneck)\b|仅当|必须|取决于|不能|受限/iu;
const MECHANISM = /\b(?:because|therefore|uses?|enables?|reduces?|increases?|converts?|transfers?)\b|因为|通过|使得|导致|降低|提升/iu;
const CONTEXT = /\b(?:[A-Z]{1,8}\d[A-Z\d.-]*|[A-Z]\d{2,}[A-Z]?|\d+k\s*\/\s*\d+k|(?:BF|FP|INT|NVFP)\d{1,2})\b/giu;

export function evidenceMeasurements(value) {
  return [...String(value || '').matchAll(QUANTITY)].map(match => ({ raw: match[0].trim(),
    value: match.groups.value.replace(/,/g, '').replace(/\s+/g, ''), unit: match.groups.unit.replace(/\s+/g, '').toLowerCase().replace('％', '%') }));
}

function splitSentences(text) {
  return String(text || '').split(/(?<=[。！？!?;；.])\s+|\n+/u).map(item => item.trim()).filter(item => item.length >= 20);
}

export function buildEvidenceAtoms(blocks, chunks) {
  const chunkByBlock = new Map(chunks.flatMap(chunk => (chunk.sourceBlocks || []).map(id => [id, chunk.id])));
  const atoms = [];
  for (const block of blocks) {
    if (block.type === 'heading') continue;
    const sentences = splitSentences(block.text);
    for (let index = 0; index < sentences.length; index++) {
      const exactText = sentences[index];
      const measurements = evidenceMeasurements(exactText);
      const kind = measurements.length ? 'number' : block.contentKind === 'example' ? 'example'
        : CONSTRAINT.test(exactText) ? 'constraint' : MECHANISM.test(exactText) && ['process', 'architecture', 'comparison', 'explanation', 'metric'].includes(block.semanticType) ? 'mechanism' : null;
      if (!kind) continue;
      atoms.push({ id: `e_${block.id}_${String(index + 1).padStart(2, '0')}`, chunkId: chunkByBlock.get(block.id) || null,
        sourceRef: String(block.sourceRefs?.[0] || ''), sourceRefs: (block.sourceRefs || []).map(String), location: block.location || '',
        kind, exactText, value: measurements[0]?.value || null, unit: measurements[0]?.unit || null,
        measurements, qualifiers: [...new Set((exactText.match(QUALIFIER) || []).map(item => item.trim()))].slice(0, 8),
        contextTerms: [...new Set((exactText.match(CONTEXT) || []).map(item => item.replace(/\s+/g, '').toLowerCase()))].slice(0, 8),
        confidence: measurements.length ? 'exact-source-quantity' : 'source-excerpt' });
    }
  }
  return atoms;
}

function tokens(value) {
  return new Set((String(value || '').toLowerCase().match(/[a-z][a-z0-9_-]{2,}|[\u3400-\u9fff]{2,5}/g) || [])
    .filter(word => !['with', 'from', 'that', 'this', 'model', 'source', 'example', 'evidence', 'results'].includes(word)));
}

export function evidenceRelevance(atom, query) {
  const wanted = tokens(query);
  if (!wanted.size) return 0;
  const found = tokens(atom.exactText);
  return [...wanted].filter(word => found.has(word)).length / Math.sqrt(wanted.size * Math.max(1, found.size));
}

/** Require only a small, topical subset. Other atoms remain available for
 * retrieval; a generic chunk reference must not force unrelated numbers. */
export function selectEvidenceForSlide(source, slide, limit = 2) {
  const atoms = source?.semantic?.evidenceAtoms || [];
  const chunks = new Set(slide.chunkRefs || slide.sourceChunks || []);
  // Semantic chunk IDs are precise. Segment ranges can overlap at section
  // boundaries, so use them only as a fallback when chunk IDs are absent.
  const refs = chunks.size ? new Set() : new Set(slide.refs || slide.sourceRefs || []);
  const query = [slide.title, slide.focus, slide.question, slide.headlineIntent, ...(slide.requiredDetails || [])].filter(Boolean).join(' ');
  const quantitative = /\b(?:evidence|results?|benchmark|metrics?|size|cost|throughput|latency|formats?|structure|comparison|trade[- ]?off)\b|证据|结果|数据|指标|规模|吞吐|延迟|结构|对比/iu.test(`${slide.title || ''} ${slide.headlineIntent || ''}`)
    || ['metric', 'chart', 'table'].includes(slide.visualIntent?.type) || slide.evidenceIntent === 'required';
  if (!quantitative) return [];
  const scored = atoms.filter(atom => chunks.has(atom.chunkId) || atom.sourceRefs.some(ref => refs.has(ref)))
    .filter(atom => atom.kind === 'number')
    .map(atom => {
      const units = atom.measurements.map(item => item.unit);
      const strongUnit = units.some(unit => /(?:bits?\/value|tps|flops|gb|gib|%|points?|ms|layers?)/iu.test(unit));
      const relevance = evidenceRelevance(atom, query);
      return { atom, score: relevance * 4 + (strongUnit ? 1 : 0) + Math.min(2, units.length) * .12 +
        (atom.contextTerms?.length ? .1 : 0) + (atom.exactText.length >= 45 ? .05 : 0) };
    })
    .sort((a, b) => b.score - a.score || a.atom.id.localeCompare(b.atom.id));
  return scored.slice(0, limit).map(item => item.atom.id);
}

function normalizedQuantity(value) { return String(value || '').replace(/,/g, '').replace(/\s+/g, '').toLowerCase().replace(/％/g, '%'); }
export function evidenceVisible(atom, text) {
  if (!atom) return false;
  const visible = normalizedQuantity(text);
  if (atom.measurements?.length) {
    const quantitiesPresent = atom.measurements.every(measure => visible.includes(normalizedQuantity(measure.raw)) ||
      visible.includes(normalizedQuantity(`${measure.value}${measure.unit}`)));
    const contextPresent = (atom.contextTerms || []).every(term => visible.includes(normalizedQuantity(term)));
    const approximate = (atom.qualifiers || []).some(term => /^(?:about|approximately|around|roughly|estimated?|约|大约|估算)/iu.test(term));
    const approximationPresent = !approximate || /\b(?:about|approximately|around|roughly|estimated?|approx\.?|~)\b|约|大约|估算/iu.test(text);
    return quantitiesPresent && contextPresent && approximationPresent;
  }
  if (atom.kind === 'example') {
    const canonical = value => String(value || '').normalize('NFKC')
      .replace(/\\(?:mathbf|mathrm|mathit|text|operatorname)\s*/gu, '')
      .replace(/\\(?:mu|gamma|Sigma|sigma|alpha|beta|epsilon)\b/gu, command => ({
        '\\mu': 'μ', '\\gamma': 'γ', '\\Sigma': 'Σ', '\\sigma': 'σ', '\\alpha': 'α', '\\beta': 'β', '\\epsilon': 'ε',
      })[command] || command)
      .replace(/\\propto\b/gu, '∝').replace(/\\Longrightarrow\b/gu, '⇒')
      .replace(/\\(?:,|;|quad|qquad|left|right)\b/gu, '')
      .toLocaleLowerCase().replace(/[^\p{L}\p{N}\u3400-\u9fff]+/gu, '');
    const exact = canonical(atom.exactText);
    return exact.length >= 4 && canonical(text).includes(exact);
  }
  const exact = tokens(atom.exactText), shown = tokens(text);
  return exact.size >= 3 && [...exact].filter(word => shown.has(word)).length >= Math.min(3, Math.ceil(exact.size * .55));
}

export function visibleSlideText(slide) {
  const nodes = slide?.nodes || [], shown = visibleNodes(slide);
  // Test binding against all nodes: hiding every exported node cannot revive
  // old slot/copy text. Source explanations share the exported body ownership.
  if (nodes.some(node => node.nativeRef && ['text', 'table'].includes(node.type))) {
    return shown.filter(node => node.nativeRef || node.sourceArtifact || node.semanticRole === 'source-explanation')
      .map(nodeContentText).filter(Boolean).join(' ');
  }
  if (nodes.length) {
    const title = nodes.some(node => node.semanticRole === 'title') ? '' : slide?.title;
    return [title, ...shown.map(nodeContentText)].filter(Boolean).join(' ');
  }
  const slotText = Object.values(slide?.templateSlotTexts || {}).flatMap(value => typeof value === 'string' ? [value]
    : Array.isArray(value) ? value.flatMap(item => [item.label, item.body]) : []);
  if (slotText.length) return [slide?.title, ...slotText].filter(Boolean).join(' ');
  return [slide?.title, slide?.copy?.subtitle, slide?.copy?.takeaway, ...(slide?.bullets || []),
    ...(slide?.copy?.blocks || []).flatMap(block => [block.heading, block.body])]
    .filter(Boolean).join(' ');
}

export function missingRequiredEvidence(project, slide, contract) {
  const atoms = new Map((project?.source?.semantic?.evidenceAtoms || []).map(atom => [atom.id, atom]));
  const visible = visibleSlideText(slide);
  return (contract?.requiredEvidenceIds || []).map(id => atoms.get(id)).filter(atom => atom && !evidenceVisible(atom, visible));
}
