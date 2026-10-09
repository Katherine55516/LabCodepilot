/** Balance metrics (A repetition, B media scaling, C distribution, D depth)
 * computed from a PPTX inspection, the template inspection and the source text.
 * Definitions: docs/exec-plans/active/ppt-general-content-media-balance.md.
 * These are evaluation measurements, not product gates. */
import { displayUnits } from '../../lib/ppt-density-profile.mjs';

const EMU_IN = 914400;
const quantile = (values, q) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const at = (sorted.length - 1) * q, low = Math.floor(at), high = Math.ceil(at);
  return Math.round((sorted[low] + (sorted[high] - sorted[low]) * (at - low)) * 10) / 10;
};
const band = values => ({ p10: quantile(values, .1), p50: quantile(values, .5), p90: quantile(values, .9) });
const compact = text => String(text || '').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
const grams = (text, n = 4) => { const value = compact(text), set = new Set(); for (let i = 0; i + n <= value.length; i++) set.add(value.slice(i, i + n)); return set; };
const jaccard = (a, b) => { if (!a.size || !b.size) return 0; let shared = 0; for (const item of a) if (b.has(item)) shared++; return shared / (a.size + b.size - shared); };

/** Classifies a picture by size and coverage on the slide. */
export function mediaClass(box, slideSize) {
  if (!box) return 'unknown';
  const [, , w, h] = box, area = w * h, slideArea = slideSize.cx * slideSize.cy;
  if (area >= slideArea * .8) return 'background';
  if (Math.max(w, h) / EMU_IN < 1.2) return 'icon';
  return area / (EMU_IN * EMU_IN) >= 12 ? 'large' : 'medium';
}

function slideFacts(slide, slideSize) {
  const texts = slide.shapes.filter(shape => shape.kind === 'text');
  const titleCandidates = texts.filter(shape => ['title', 'ctrTitle'].includes(shape.ph));
  const title = titleCandidates[0] || texts.filter(shape => (shape.maxSz || 0) >= 26 && shape.text.length <= 120)
    .sort((a, b) => (a.box?.[1] ?? 1e12) - (b.box?.[1] ?? 1e12))[0] || null;
  const body = texts.filter(shape => shape !== title && !/^\s*\d{1,3}\s*$/u.test(shape.text) && (shape.maxSz == null || shape.maxSz < 26));
  const tables = slide.shapes.filter(shape => shape.kind === 'table');
  const tableText = tables.map(shape => (shape.rows || []).flat().join(' ')).join('\n');
  const bodyText = [...body.map(shape => shape.text), tableText].filter(Boolean).join('\n');
  const media = { background: 0, large: 0, medium: 0, icon: 0, unknown: 0 };
  for (const pic of slide.shapes.filter(shape => shape.kind === 'pic')) media[mediaClass(pic.box, slideSize)]++;
  const content = slide.shapes.filter(shape => shape.box && ['text', 'pic', 'table', 'chart'].includes(shape.kind)
    && !(shape.kind === 'pic' && mediaClass(shape.box, slideSize) === 'background') && shape.box[2] * shape.box[3] < slideSize.cx * slideSize.cy * .9);
  const top = Math.min(...content.map(shape => shape.box[1])), bottom = Math.max(...content.map(shape => shape.box[1] + shape.box[3]));
  return {
    title: title?.text || '', titleSize: title?.maxSz ?? null, bodyBlocks: body.map(shape => shape.text), bodyText,
    bodyUnits: Math.round(displayUnits(bodyText)), bodyChars: [...bodyText.replace(/\s/gu, '')].length,
    latinWords: (bodyText.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/gu) || []).length, cjkChars: (bodyText.match(/\p{Script=Han}/gu) || []).length,
    media, tables: tables.length, charts: slide.shapes.filter(shape => shape.kind === 'chart').length,
    decorativeShapes: slide.shapes.filter(shape => shape.kind === 'shape').length,
    verticalFill: content.length ? Math.round(Math.max(0, Math.min(slideSize.cy, bottom) - Math.max(0, top)) / slideSize.cy * 100) / 100 : 0,
    bodyFontSizes: [...new Set(body.map(shape => shape.maxSz).filter(Number.isFinite))].sort((a, b) => a - b),
  };
}

// Qualifiers that change what a kept number means. Generic approximators
// (about/约) and single-character CJK words are excluded: they match too much.
const QUALIFIERS = ['one-way', 'two-way', 'round-trip', 'annualized', 'annualised', 'annual', 'monthly', 'daily', 'weekly', 'quarterly', 'per year', 'per month',
  'long-only', 'long-short', 'gross', 'net', 'in-sample', 'out-of-sample', 'at least', 'at most', 'up to',
  '单边', '双边', '年化', '月频', '日频', '周频', '季度', '样本内', '样本外', '至少', '至多', '毛收益', '净收益'];
const hasQualifier = (text, word) => /^[a-z]/u.test(word) ? new RegExp(`(?<![a-z-])${word}(?![a-z-])`, 'iu').test(text) : text.includes(word);
const NUMBER = /(?<![\w.])[-−]?\d+(?:[.,]\d+)*(?:\s?(?:%|bps|bp|x|倍))?/gu;
const normNumber = value => value.replace(/[−]/gu, '-').replace(/,(?=\d{3}\b)/gu, '').replace(/\s/gu, '');

/** D2/D3: numbers on slides that do not occur in the source, and kept numbers
 * whose source sentence qualifiers are missing from the slide block. */
function numberChecks(facts, sourceText) {
  if (!sourceText) return null;
  const sourceNumbers = new Set((sourceText.match(NUMBER) || []).map(normNumber));
  const sentences = sourceText.split(/(?<=[.!?。！？;；])\s+|\n+/u);
  const invented = [], missingQualifiers = [];
  facts.forEach((slide, index) => {
    for (const block of [...slide.bodyBlocks, slide.title]) {
      for (const raw of new Set(block.match(NUMBER) || [])) {
        const value = normNumber(raw), bare = value.replace(/%|bps|bp|x|倍/gu, '');
        // Ordinal badges (01, 02 …) and single digits are labels, not data.
        if (bare.length < 2 && !/[.%]/u.test(value) || /^0\d$/u.test(bare)) continue;
        if (!sourceNumbers.has(value) && !sourceNumbers.has(bare) && ![...sourceNumbers].some(item => item.replace(/%|bps|bp|x|倍/gu, '') === bare)) { invented.push({ slide: index + 1, value }); continue; }
        // Only distinctive numbers (unit, decimal or 3+ digits) found in at most
        // four source sentences are checked, so the source context is unambiguous.
        if (!/[%.]|bps|bp|倍/u.test(value) && bare.replace(/\D/gu, '').length < 3) continue;
        const pattern = new RegExp(`(?<![\\d.])${bare.replace(/[.]/gu, '\\.')}(?![\\d])`, 'u');
        const context = sentences.filter(sentence => pattern.test(sentence));
        if (!context.length || context.length > 4) continue;
        // The number's own clause: 15 characters before it up to the next number.
        const windows = context.map(sentence => {
          const at = sentence.search(pattern), after = sentence.slice(at + bare.length), next = after.search(/\d/u);
          return sentence.slice(Math.max(0, at - 15), at + bare.length + (next < 0 ? after.length : next));
        });
        const qualifiers = [...new Set(windows.flatMap(window => QUALIFIERS.filter(word => hasQualifier(window, word))))];
        const lost = qualifiers.filter(word => !hasQualifier(block, word));
        if (lost.length) missingQualifiers.push({ slide: index + 1, value, lost, sourceClause: windows[0].trim().slice(0, 120) });
      }
    }
  });
  return { inventedNumberCandidates: invented, missingQualifiers };
}

/** A2/A3: near-duplicate body blocks across and within slides. */
function duplicateChecks(facts) {
  const blocks = facts.flatMap((slide, index) => slide.bodyBlocks.filter(text => compact(text).length >= 40).map(text => ({ slide: index + 1, text, set: grams(text) })));
  const across = [], within = [];
  for (let i = 0; i < blocks.length; i++) for (let j = i + 1; j < blocks.length; j++) {
    const score = jaccard(blocks[i].set, blocks[j].set);
    if (blocks[i].slide !== blocks[j].slide && score >= .6) across.push({ slides: [blocks[i].slide, blocks[j].slide], score: Math.round(score * 100) / 100, text: blocks[j].text.slice(0, 120) });
    if (blocks[i].slide === blocks[j].slide && score >= .5) within.push({ slide: blocks[i].slide, score: Math.round(score * 100) / 100, severity: score >= .7 ? 'error' : 'warning', text: blocks[j].text.slice(0, 120) });
  }
  return { acrossSlides: across, withinSlide: within };
}

/** B: media per content slide against the template's per-role density. */
function mediaChecks(facts, templateFacts) {
  const content = facts.slice(1), roles = ['background', 'large', 'medium', 'icon'];
  const per = role => content.reduce((n, slide) => n + slide.media[role], 0);
  const actual = Object.fromEntries(roles.map(role => [role, per(role)]));
  const textOnly = content.map(slide => roles.every(role => !slide.media[role]) && !slide.tables && !slide.charts);
  let run = 0, longestTextOnlyRun = 0; for (const value of textOnly) { run = value ? run + 1 : 0; longestTextOnlyRun = Math.max(longestTextOnlyRun, run); }
  const result = { contentSlides: content.length, actual, perContentSlide: Object.fromEntries(roles.map(role => [role, content.length ? Math.round(actual[role] / content.length * 100) / 100 : 0])),
    textOnlySlides: textOnly.filter(Boolean).length, longestTextOnlyRun };
  if (!templateFacts) return result;
  const tContent = templateFacts.slice(1);
  const rho = Object.fromEntries(roles.map(role => [role, tContent.length ? tContent.reduce((n, slide) => n + slide.media[role], 0) / tContent.length : 0]));
  const expected = Object.fromEntries(roles.map(role => [role, Math.round(rho[role] * content.length * 10) / 10]));
  const expectedTotal = roles.reduce((n, role) => n + expected[role], 0), actualTotal = roles.reduce((n, role) => n + actual[role], 0);
  const templateMediaShare = tContent.length ? tContent.filter(slide => roles.some(role => slide.media[role])).length / tContent.length : 0;
  return { ...result, templateRho: Object.fromEntries(roles.map(role => [role, Math.round(rho[role] * 100) / 100])), expected,
    conservation: expectedTotal ? Math.round(actualTotal / expectedTotal * 100) / 100 : null,
    rolesDroppedToZero: roles.filter(role => rho[role] > 0 && actual[role] === 0),
    textOnlyRunLimitApplies: templateMediaShare >= .5 };
}

export function deckMetrics(inspection, { template = null, sourceText = '' } = {}) {
  const facts = inspection.slides.map(slide => slideFacts(slide, inspection.slideSize));
  const templateFacts = template ? template.slides.map(slide => slideFacts(slide, template.slideSize)) : null;
  const body = facts.slice(1);
  return {
    slides: facts.length, slideSizeIn: [Math.round(inspection.slideSize.cx / EMU_IN * 100) / 100, Math.round(inspection.slideSize.cy / EMU_IN * 100) / 100],
    density: { bodyUnits: band(body.map(slide => slide.bodyUnits)), bodyChars: band(body.map(slide => slide.bodyChars)),
      latinWords: band(body.map(slide => slide.latinWords)), cjkChars: band(body.map(slide => slide.cjkChars)),
      verticalFill: band(body.map(slide => slide.verticalFill)), bodyFontSizes: [...new Set(body.flatMap(slide => slide.bodyFontSizes))].sort((a, b) => a - b),
      totals: { bodyChars: facts.reduce((n, slide) => n + slide.bodyChars, 0), latinWords: facts.reduce((n, slide) => n + slide.latinWords, 0), cjkChars: facts.reduce((n, slide) => n + slide.cjkChars, 0) } },
    repetition: duplicateChecks(facts),
    media: mediaChecks(facts, templateFacts),
    depth: numberChecks(facts, sourceText),
    perSlide: facts.map((slide, index) => ({ slide: index + 1, title: slide.title.slice(0, 90), bodyUnits: slide.bodyUnits, latinWords: slide.latinWords, cjkChars: slide.cjkChars,
      media: slide.media, tables: slide.tables, charts: slide.charts, verticalFill: slide.verticalFill })),
  };
}
