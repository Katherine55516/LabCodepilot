import {roleBasedTemplateMap} from './ppt-template-roles.mjs';
/** Plan native template reuse before the outline is generated. The original
 * pages remain an ordered subsequence; only interior pages may be copied. */
export function maxPreservedPages(originalCount) {
  if (!Number.isInteger(originalCount) || originalCount < 1) throw new Error('invalid template page count');
  return originalCount < 4 ? originalCount : originalCount < 8 ? originalCount * 3 - 4 : 100;
}

export function templateReuseError(originalCount, requestedPages) {
  const max = maxPreservedPages(originalCount);
  if (requestedPages > max) return `该 ${originalCount} 页模板在封面和结尾各用一次、内容页受控复用且不连续重复的条件下，最多支持 ${max} 页；当前选择 ${requestedPages} 页。请减少页数或选择页数更多的模板。`;
  return '';
}

function evenlySelected(originalCount, extra) {
  const safe = Array.from({ length: Math.max(0, originalCount - 3) }, (_, index) => index + 1);
  if (extra > safe.length) return [...safe, originalCount - 2];
  if (extra === 0) return [];
  return Array.from({ length: extra }, (_, index) => safe[Math.floor((index + .5) * safe.length / extra)]);
}

function validMap(map, originalCount, requestedPages) {
  if (map.length !== requestedPages || map[0] !== 0 || map.at(-1) !== originalCount - 1) return false;
  const counts = Array(originalCount).fill(0);
  for (const [index, source] of map.entries()) {
    if (!Number.isInteger(source) || source < 0 || source >= originalCount || (index && source === map[index - 1])) return false;
    counts[source] += 1;
  }
  const maxUse = requestedPages <= originalCount * 2 - 2 ? 2 : requestedPages <= originalCount * 3 - 4 ? 3 : 24;
  if (counts[0] !== 1 || counts.at(-1) !== 1 || counts.some(count => count > maxUse)) return false;
  if (requestedPages >= originalCount && counts.slice(1, -1).some(count => count < 1)) return false;
  const selected = Array.from(new Set(map));
  return selected[0] === 0 && selected.at(-1) === originalCount - 1 && selected.every((source, index) => index === 0 || source > selected[index - 1]);
}

function reducedMap(originalCount, requestedPages, profiles, outline) {
  if (originalCount < 2 || requestedPages < 2) throw new Error('a preserved template needs a cover and a closing page');
  const interiorCount = requestedPages - 2;
  const interior = originalCount - 2;
  if (interiorCount > interior) throw new Error('invalid reduced template page count');
  if (!interiorCount) return [0, originalCount - 1];
  if (profiles.length !== originalCount || outline.length !== requestedPages) {
    const selected = interiorCount === 1
      ? [1 + Math.floor(interior / 2)]
      : Array.from({ length: interiorCount }, (_, index) => 1 + Math.floor(index * (interior - 1) / (interiorCount - 1)));
    return [0, ...selected, originalCount - 1];
  }
  const catalog = catalogTemplateLayouts(profiles);
  const similarity = profiles.map((left, i) => profiles.map((right, j) => i === j ? 1 : visualSimilarity(left, right)));
  const costs = Array.from({ length: interiorCount }, () => Array(interior).fill(Infinity));
  const previous = Array.from({ length: interiorCount }, () => Array(interior).fill(-1));
  for (let target = 0; target < interiorCount; target++) {
    for (let candidate = target; candidate <= interior - (interiorCount - target); candidate++) {
      const source = candidate + 1;
      const fit = templateContentFit(catalog[source], outline[target + 1]);
      if (target === 0) { costs[target][candidate] = fit; continue; }
      for (let prior = target - 1; prior < candidate; prior++) {
        const priorSource = prior + 1;
        const score = costs[target - 1][prior] + fit + similarity[priorSource][source] ** 2 * 12;
        if (score < costs[target][candidate] - 1e-6) {
          costs[target][candidate] = score;
          previous[target][candidate] = prior;
        }
      }
    }
  }
  let candidate = costs.at(-1).indexOf(Math.min(...costs.at(-1)));
  const selected = Array(interiorCount);
  for (let target = interiorCount - 1; target >= 0; target--) {
    selected[target] = candidate + 1;
    candidate = previous[target][candidate];
  }
  return [0, ...selected, originalCount - 1];
}

function fallbackMap(originalCount, selected) {
  const repeats = [...selected];
  if (repeats[0] === originalCount - 2) repeats.push(repeats.shift());
  return [...Array.from({ length: originalCount - 1 }, (_, index) => index), ...repeats, originalCount - 1];
}

const clamp = value => Math.max(0, Math.min(1, value));
const jaccard = (left, right) => {
  if (!left.size && !right.size) return 1;
  const union = new Set([...left, ...right]);
  return union.size ? [...left].filter(value => right.has(value)).length / union.size : 1;
};
const hexDistance = (left, right) => {
  if (!left || !right) return 64;
  let xor = BigInt(`0x${left}`) ^ BigInt(`0x${right}`);
  let count = 0;
  while (xor) { count += Number(xor & 1n); xor >>= 1n; }
  return count;
};

/** Fingerprints contain no image bytes or source text. They use image hashes,
 * coarse object placement and palette so text replacement cannot change them. */
export function profileTemplateSlide(slide, size = {}) {
  const nodes = slide?.nodes || [];
  const width = Math.max(1, Number(size.width || 12_192_000));
  const height = Math.max(1, Number(size.height || 6_858_000));
  const layout = new Set(); const images = [];
  const objectTypes = { text: 0, image: 0, table: 0, chart: 0, shape: 0 };
  let directional = false;
  const palette = new Set();
  if (typeof slide?.nativeBackground === 'string') palette.add(slide.nativeBackground.toLowerCase());
  for (const node of nodes) {
    const geometry = node.geometry || {};
    const centerX = (Number(geometry.x || 0) + Number(geometry.width || 0) / 2) / width;
    const centerY = (Number(geometry.y || 0) + Number(geometry.height || 0) / 2) / height;
    const area = Number(geometry.width || 0) * Number(geometry.height || 0) / (width * height);
    const kind = node.type === 'image' ? 'image' : node.type === 'text' ? 'text' : node.type === 'table' ? 'table' : 'shape';
    objectTypes[node.type in objectTypes ? node.type : 'shape']++;
    // Arrows inside a sentence are content and move with their text box.
    // Native connectors and arrow shapes carry positional meaning.
    if (/ARROW|CHEVRON|CONNECTOR|FLOWCHART/i.test(`${node.nativeRef?.autoShapeType || ''} ${node.nativeRef?.name || ''}`)) directional = true;
    layout.add(`${kind}:${Math.floor(clamp(centerX) * 6)}:${Math.floor(clamp(centerY) * 4)}:${area > .12 ? 'large' : area > .025 ? 'medium' : 'small'}`);
    if (kind === 'image') images.push({ sha: node.content?.imageSha256 || '', dhash: node.content?.imageDhash || '',
      x: clamp(centerX), y: clamp(centerY), area: clamp(area) });
    const fill = node.style?.fill || node.style?.fillColor || node.style?.color;
    if (typeof fill === 'string' && /^#?[0-9a-f]{6}$/i.test(fill)) palette.add(fill.toLowerCase().replace(/^#/, ''));
  }
  return { layout: [...layout].sort(), images, palette: [...palette].sort(), shapeCount: nodes.length,
    objectTypes, directional };
}

export function visualSimilarity(left, right) {
  if (!left || !right) return 0;
  const layout = jaccard(new Set(left.layout || []), new Set(right.layout || []));
  const palette = jaccard(new Set(left.palette || []), new Set(right.palette || []));
  const a = left.images || [], b = right.images || [];
  if (!a.length && !b.length) return clamp(.8 * layout + .2 * palette);
  const matched = a.map(image => Math.max(0, ...b.map(other => {
    const visual = image.sha && image.sha === other.sha ? 1 : image.dhash && other.dhash
      ? clamp(1 - hexDistance(image.dhash, other.dhash) / 20) : 0;
    return visual * (1 - .3 * Math.min(1, Math.abs(image.x - other.x) + Math.abs(image.y - other.y)));
  })));
  const imageSimilarity = matched.reduce((sum, value) => sum + value, 0) / Math.max(a.length, b.length);
  return clamp(.5 * imageSimilarity + .4 * layout + .1 * palette);
}

function scheduleScore(map, originalCount, similarity, outline = [], catalog = []) {
  let score = 0;
  const first = Array(originalCount).fill(-1), last = Array(originalCount).fill(-1), copies = [];
  let copyRun = 0;
  map.forEach((source, index) => {
    const repeated = first[source] >= 0;
    if (!repeated) first[source] = index;
    else { copies.push(index); score += templateContentFit(catalog[source], outline[index]); }
    last[source] = index;
    copyRun = repeated ? copyRun + 1 : 0;
    if (copyRun > 1) score += copyRun === 2 ? 2 : 8;
  });
  for (let index = 1; index < map.length; index++) {
    const adjacent = similarity[map[index - 1]][map[index]];
    score += adjacent * adjacent * 12;
    if (index >= 2) score += similarity[map[index - 2]][map[index]] ** 2 * 2;
  }
  const priorMedia = new Map();
  map.forEach((source, index) => {
    const hash = catalog[source]?.dominantMediaHash;
    if (!hash || Number(catalog[source]?.dominantMediaArea || 0) < .15) return;
    const positions = priorMedia.get(hash) || [];
    score += positions.length * 2 + positions.filter(position => index - position <= 8).length * 9;
    positions.push(index); priorMedia.set(hash, positions);
  });
  for (let source = 1; source < originalCount - 1; source++) {
    if (last[source] > first[source]) score += .22 * Math.abs(last[source] - first[source] - 4);
  }
  // A gentle preference for copies spread across the deck and not all drawn
  // from the same region of the template. Visual penalties dominate this term.
  const idealGap = (map.length - 2) / (copies.length + 1);
  copies.forEach((position, index) => { score += .6 * Math.abs(position - (index + 1) * idealGap); });
  return score;
}

function assetReusePenalty(map, position, source, catalog) {
  const hash = catalog[source]?.dominantMediaHash;
  if (!hash || Number(catalog[source]?.dominantMediaArea || 0) < .15) return 0;
  const positions = map.flatMap((item, index) => catalog[item]?.dominantMediaHash === hash ? [index] : []);
  return positions.length * 3 + positions.filter(index => Math.abs(index - position) <= 8).length * 12;
}

function optimizeVisualMap(initial, originalCount, profiles, outline = []) {
  if (profiles.length !== originalCount) return initial;
  const catalog = catalogTemplateLayouts(profiles);
  const similarity = profiles.map((profile, i) => profiles.map((other, j) => i === j ? 1 : visualSimilarity(profile, other)));
  let map = initial; let bestScore = scheduleScore(map, originalCount, similarity, outline, catalog);
  // Move one repeated page at a time. Original pages are always the first
  // occurrence and stay in order; a candidate copy may only follow its source.
  for (let pass = 0; pass < 3; pass++) {
    let improved = false;
    const repeated = Array.from({ length: originalCount - 2 }, (_, index) => index + 1)
      .filter(source => map.lastIndexOf(source) > map.indexOf(source));
    for (const oldSource of repeated) {
      const stripped = [...map]; stripped.splice(stripped.lastIndexOf(oldSource), 1);
      let chosen = map; let chosenScore = bestScore;
      for (let source = 1; source < originalCount - 1; source++) {
        if (stripped.lastIndexOf(source) > stripped.indexOf(source)) continue;
        for (let position = stripped.indexOf(source) + 2; position < stripped.length; position++) {
          if (stripped[position - 1] === source || stripped[position] === source) continue;
          const candidate = [...stripped.slice(0, position), source, ...stripped.slice(position)];
          const score = scheduleScore(candidate, originalCount, similarity, outline, catalog);
          if (score < chosenScore - 1e-6) { chosen = candidate; chosenScore = score; }
        }
      }
      if (chosen !== map) { map = chosen; bestScore = chosenScore; improved = true; }
    }
    if (!improved) break;
  }
  return map;
}

function extendedMap(originalCount, requestedPages, profiles, outline = []) {
  const baseCount = originalCount * 2 - 2;
  const catalog = catalogTemplateLayouts(profiles);
  const interior = Array.from({ length: originalCount - 2 }, (_, index) => index + 1);
  const fallback = () => [0, ...interior, ...interior, ...interior.slice(0, requestedPages - baseCount), originalCount - 1];
  let map = planTemplateSlideMap(originalCount, baseCount, { profiles, outline });
  const similarity = profiles.length === originalCount
    ? profiles.map((a, i) => profiles.map((b, j) => i === j ? 1 : visualSimilarity(a, b)))
    : Array.from({ length: originalCount }, (_, i) => Array.from({ length: originalCount }, (_, j) => i === j ? 1 : 0));
  const complexity = source => {
    const profile = profiles[source];
    if (!profile) return 0;
    const images = profile.images || [];
    return images.reduce((sum, image) => sum + Math.min(1, image.area || 0), 0) * 30
      + images.length * .5 + Number(profile.shapeCount || (profile.layout || []).length) * .1;
  };
  while (map.length < requestedPages) {
    let best = null;
    for (let source = 1; source < originalCount - 1; source++) {
      const positions = map.flatMap((value, index) => value === source ? [index] : []);
      if (positions.length >= 3) continue;
      for (let position = positions[0] + 2; position < map.length; position++) {
        if (positions.some(existing => Math.abs(existing - position) < 2)) continue;
        if (map[position - 1] === source || map[position] === source) continue;
        const candidate = [...map.slice(0, position), source, ...map.slice(position)];
        if (!validMap(candidate, originalCount, candidate.length)) continue;
        const score = scheduleScore(candidate, originalCount, similarity, outline, catalog) + complexity(source) * 5;
        if (!best || score < best.score - 1e-6 || (Math.abs(score - best.score) < 1e-6 && source < best.source)) {
          best = { map: candidate, score, source };
        }
      }
    }
    if (!best) return fallback();
    map = best.map;
  }
  return validMap(map, originalCount, requestedPages) ? map : fallback();
}

/** A bounded, deterministic catalog of crop variants. Geometry variants are
 * recorded separately per native slide after overlap and direction checks. */
export const TEMPLATE_VARIANTS = Object.freeze([
  { id: 'original', crop: [0, 0, 0, 0] },
  { id: 'focus-left', crop: [0, 0, .05, 0] },
  { id: 'focus-right', crop: [.05, 0, 0, 0] },
  { id: 'focus-top', crop: [0, 0, 0, .05] },
  { id: 'focus-bottom', crop: [0, .05, 0, 0] },
  { id: 'focus-left-wide', crop: [0, 0, .09, 0] },
  { id: 'focus-right-wide', crop: [.09, 0, 0, 0] },
  { id: 'focus-center', crop: [.035, .02, .035, .02] },
  { id: 'focus-top-wide', crop: [0, 0, 0, .09] },
  { id: 'focus-bottom-wide', crop: [0, .09, 0, 0] },
  { id: 'focus-left-deep', crop: [0, 0, .13, 0] },
  { id: 'focus-right-deep', crop: [.13, 0, 0, 0] },
  { id: 'focus-center-wide', crop: [.07, .035, .07, .035] },
]);

export function catalogTemplateLayouts(profiles = []) {
  return profiles.map((profile, sourceIndex) => {
    const boundary = sourceIndex === 0 || sourceIndex === profiles.length - 1;
    const imageCount = profile.images?.length || 0;
    const complexity = Number(profile.shapeCount || 0) + imageCount * 2;
    const types = profile.objectTypes || {};
    const contentSlots = Number(profile.semantic?.contentSlots || 0);
    const family = types.table ? 'table' : types.chart ? 'chart' : profile.directional ? 'diagram'
      : imageCount && contentSlots >= 2 ? 'media-text' : contentSlots >= 4 ? 'cards' : 'text';
    const roleHints = family === 'table' ? ['evidence', 'comparison', 'metric', 'appendix']
      : family === 'chart' ? ['evidence', 'metric', 'comparison']
      : family === 'diagram' ? ['architecture', 'process', 'framework', 'runtime', 'mechanism']
      : family === 'media-text' ? ['evidence', 'case', 'summary', 'problem']
      : family === 'cards' ? ['summary', 'comparison', 'recommendation', 'evidence']
      : ['evidence', 'summary', 'mechanism', 'appendix'];
    const safeGeometryModes = profile.safeGeometryModes || (profile.directional || types.table || types.chart
      ? [] : ['content-mirror', 'title-content-mirror']);
    const baseMaxUses = imageCount ? complexity >= 38 ? 8 : complexity >= 29 ? 16 : 24 : 3;
    const maxUses = safeGeometryModes.length ? Math.min(baseMaxUses, imageCount ? 1 + safeGeometryModes.length * (TEMPLATE_VARIANTS.length - 1) : 1 + safeGeometryModes.length)
      : imageCount ? Math.min(baseMaxUses, TEMPLATE_VARIANTS.length) : 1;
    const dominantMedia = [...(profile.images || [])].sort((a, b) => (b.area || 0) - (a.area || 0))[0];
    const ordinalSequence = profile.semantic?.ordinalSequence || [];
    return { sourceIndex, shapeCount: Number(profile.shapeCount || 0), imageCount,
      density: complexity >= 38 ? 'dense' : complexity >= 29 ? 'balanced' : 'light',
      variantIds: imageCount ? TEMPLATE_VARIANTS.map(item => item.id) : ['original'],
      geometryVariants: boundary ? ['original'] : ['original', ...(safeGeometryModes.length ? safeGeometryModes : imageCount ? ['media-focus'] : [])],
      maxUses: boundary ? 1 : maxUses,
      family, roleHints, directional: Boolean(profile.directional),
      purpose: family === 'diagram' ? 'relationship' : family === 'media-text' ? 'illustration' : family,
      visualType: family, semanticRoles: roleHints,
      dominantMediaHash: dominantMedia?.sha || null, dominantMediaArea: Number(dominantMedia?.area || 0),
      readingOrder: profile.semantic?.readingOrder || [], ordinalSequence,
      orderedFlowCompatible: ordinalSequence.length < 2 || ordinalSequence.every((value, index) => value === index + 1),
      contentSlots, listItems: Number(profile.semantic?.listItems || 0),
      totalVisualCapacity: Number(profile.semantic?.totalVisualCapacity || 0),
      semanticUnitCapacity: Number(profile.semantic?.semanticUnitCapacity || 0) };
  });
}

/** A semantic fit score, not a hard rejection: all original template pages
 * remain present and in order, even when the subject differs from the source. */
export function templateContentFit(entry, slide) {
  if (!slide || !entry) return 0;
  const role = String(slide.role || '');
  const visual = String(slide.visualIntent?.type || slide.visual_intent?.type || '');
  const rolePenalty = role && !entry.roleHints?.includes(role) ? 10 : 0;
  const visualPenalty = ['table', 'chart', 'metric'].includes(visual) && !['table', 'chart'].includes(entry.family) ? 8
    : ['architecture', 'pipeline', 'process'].includes(visual) && entry.family !== 'diagram' ? 6 : 0;
  const targetUnits = Number(slide.semanticUnitBudget || slide.semantic_unit_budget || 0);
  const capacity = Number(entry.semanticUnitCapacity || 0);
  const capacityPenalty = targetUnits && capacity ? Math.max(0, targetUnits - capacity) * 3 + Math.max(0, capacity - targetUnits - 1) * 2 : 0;
  // Count of cards alone says little about explanation depth: four one-line
  // cards cannot carry the same source detail as a large body frame. This is
  // a soft cost because every original template page must still be preserved.
  const profile = String(slide.pointLengthProfile || slide.point_length_profile || 'standard');
  const perPoint = ({ compact: 25, standard: 48, deep: 75, very_deep: 105, mixed: 65 })[profile] || 48;
  const details = (slide.requiredDetails || slide.required_details || []).filter(Boolean);
  const demand = Math.max(targetUnits * perPoint, details.reduce((sum, value) => sum + String(value).length * .65, 0));
  const visibleCapacity = Number(entry.totalVisualCapacity || 0);
  const textCapacityPenalty = demand && visibleCapacity ? Math.min(24, Math.max(0, demand - visibleCapacity) / 15) : 0;
  const orderPenalty = ['pipeline', 'process', 'timeline'].includes(visual) && !entry.orderedFlowCompatible ? 18 : 0;
  const evidencePenalty = ['metric', 'chart', 'table'].includes(visual) && entry.purpose === 'illustration' && entry.dominantMediaArea >= .25 ? 14 : 0;
  return rolePenalty + visualPenalty + capacityPenalty + textCapacityPenalty + orderPenalty + evidencePenalty;
}

/** Content-aware native page expansion. This starts with every source slide
 * exactly once and inserts independently chosen interior variants. It never
 * repeats a fixed source-page cycle. */
function semanticMap(originalCount, requestedPages, profiles, outline) {
  const catalog = catalogTemplateLayouts(profiles);
  const targetUseCap = requestedPages <= originalCount * 2 - 2 ? 2 : requestedPages <= originalCount * 3 - 4 ? 3 : 24;
  const caps = catalog.map((entry, index) => index === 0 || index === originalCount - 1 ? 1 : Math.min(entry.maxUses, targetUseCap));
  const capacity = caps.reduce((sum, count) => sum + count, 0);
  if (requestedPages > capacity) throw Object.assign(new Error(`模板只有 ${capacity} 页安全的原生版式容量；无法在保留全部源页的同时生成 ${requestedPages} 页`),
    { code: 'TEMPLATE_REUSE_UNAVAILABLE', maxPages: capacity });
  const similarity = profiles.map((a, i) => profiles.map((b, j) => i === j ? 1 : visualSimilarity(a, b)));
  const map = Array.from({ length: originalCount }, (_, index) => index);
  const counts = Array(originalCount).fill(1);
  while (map.length < requestedPages) {
    let best;
    for (let source = 1; source < originalCount - 1; source++) {
      if (counts[source] >= caps[source]) continue;
      const entry = catalog[source];
      for (let position = map.indexOf(source) + 2; position < map.length; position++) {
        const left = map[position - 1], right = map[position];
        if (left === source || right === source) continue;
        const last = map.lastIndexOf(source);
        const localVisual = (similarity[left][source] || 0) ** 2 + (similarity[source][right] || 0) ** 2;
        const cadence = (map[position - 2] === source || map[position + 1] === source ? 12 : 0)
          + (map[position - 2] === right || left === map[position + 1] ? 8 : 0);
        const density = entry.density === 'dense' ? 18 : entry.density === 'balanced' ? 6 : 0;
        const score = counts[source] * 6 + localVisual * 15 + cadence + density + assetReusePenalty(map, position, source, catalog)
          + templateContentFit(entry, outline[position]) + 18 / Math.max(2, Math.abs(position - last));
        if (!best || score < best.score - 1e-6 || (Math.abs(score - best.score) < 1e-6 &&
            (source < best.source || source === best.source && position < best.position))) best = { source, position, score };
      }
    }
    if (!best) throw Object.assign(new Error('没有满足源页间距与安全变体上限的模板页映射'), { code: 'TEMPLATE_REUSE_UNAVAILABLE' });
    map.splice(best.position, 0, best.source);
    counts[best.source]++;
  }
  if (!validMap(map, originalCount, requestedPages)) throw new Error('semantic template schedule is invalid');
  return map;
}

function longMap(originalCount, requestedPages, profiles, outline = []) {
  const catalog = catalogTemplateLayouts(profiles);
  const baseCount = originalCount * 3 - 4;
  const map = planTemplateSlideMap(originalCount, baseCount, { profiles, outline });
  const counts = Array(originalCount).fill(0);
  for (const source of map) counts[source]++;
  const capacity = catalog.slice(1, -1).reduce((sum, entry) => sum + entry.maxUses, 2);
  if (requestedPages > capacity) throw Object.assign(new Error(`模板的受控版式变体最多支持 ${capacity} 页`), { code: 'TEMPLATE_REUSE_UNAVAILABLE', maxPages: capacity });
  const similarity = profiles.map(a => profiles.map(b => visualSimilarity(a, b)));
  while (map.length < requestedPages) {
    let best = null;
    for (let source = 1; source < originalCount - 1; source++) {
      if (counts[source] >= catalog[source].maxUses) continue;
      const last = map.lastIndexOf(source);
      for (let position = Math.max(map.indexOf(source) + 2, 2); position < map.length; position++) {
        const left = map[position - 1], right = map[position];
        if (left === source || right === source) continue;
        const target = outline[position];
        const preferred = target?.semanticUnitBudget || (target?.density === 'high' ? 7 : 4);
        const slotFit = Math.abs(Math.min(9, Math.max(2, Math.round(catalog[source].shapeCount / 5))) - preferred);
        const score = counts[source] * 3 + assetReusePenalty(map, position, source, catalog)
          + (catalog[source].density === 'dense' ? 65 : catalog[source].density === 'balanced' ? 25 : 0)
          + (similarity[left]?.[source] || 0) * 12 + (similarity[source]?.[right] || 0) * 12
          + (outline.length ? slotFit * 2 + templateContentFit(catalog[source], target) : 0) + 8 / Math.max(2, Math.abs(position - last))
          + (map[position - 2] === source || map[position + 1] === source ? 80 : 0)
          + (map[position - 3] === source || map[position + 2] === source ? 24 : 0);
        if (!best || score < best.score - 1e-6 || (Math.abs(score - best.score) < 1e-6 && (source < best.source || source === best.source && position < best.position)))
          best = { source, position, score };
      }
    }
    if (!best) throw Object.assign(new Error('模板版式无法在不连续复用的条件下扩展到指定页数'), { code: 'TEMPLATE_REUSE_UNAVAILABLE' });
    map.splice(best.position, 0, best.source); counts[best.source]++;
  }
  return map;
}

export function planTemplateSlideMap(originalCount, requestedPages, { profiles = [], outline = [],reusePolicy='all_pages' } = {}) {
  if(reusePolicy==='role_based'&&profiles.length===originalCount&&requestedPages<=100)return roleBasedTemplateMap(originalCount,requestedPages,profiles,outline);
  if (!Number.isInteger(requestedPages) || requestedPages < 1) throw new Error('invalid requested page count');
  const message = templateReuseError(originalCount, requestedPages);
  if (message) throw Object.assign(new Error(message), { code: 'TEMPLATE_REUSE_UNAVAILABLE', maxPages: maxPreservedPages(originalCount) });
  if (requestedPages < originalCount) return reducedMap(originalCount, requestedPages, profiles, outline);
  if (requestedPages > originalCount && profiles.length === originalCount && profiles.every(profile => profile.semantic))
    return semanticMap(originalCount, requestedPages, profiles, outline);
  if (originalCount >= 8 && requestedPages > originalCount * 3 - 4) {
    if (profiles.length !== originalCount) throw new Error('long presentation needs a complete template layout catalog');
    const map = longMap(originalCount, requestedPages, profiles, outline);
    if (!validMap(map, originalCount, requestedPages)) throw new Error('long template schedule is invalid');
    return map;
  }
  if (originalCount >= 4 && requestedPages > originalCount * 2 - 2) return extendedMap(originalCount, requestedPages, profiles, outline);
  const extra = requestedPages - originalCount;
  if (!extra) return Array.from({ length: originalCount }, (_, index) => index);
  const selected = evenlySelected(originalCount, extra);
  const map = Array.from({ length: originalCount }, (_, index) => index);
  for (const [copyIndex, source] of selected.entries()) {
    const originalPosition = map.indexOf(source);
    const target = Math.round((copyIndex + 1) * (requestedPages - 1) / (extra + 1));
    const options = [];
    for (let position = originalPosition + 2; position < map.length; position++) {
      const left = map[position - 1], right = map[position];
      if (left === source || right === source) continue;
      const gap = position - originalPosition;
      const score = Math.abs(position - target) * 2 + 5 / gap;
      options.push({ position, score });
    }
    options.sort((a, b) => a.score - b.score || a.position - b.position);
    if (options.length) map.splice(options[0].position, 0, source);
    else return optimizeVisualMap(fallbackMap(originalCount, selected), originalCount, profiles, outline);
  }
  const feasible = validMap(map, originalCount, requestedPages) ? map : fallbackMap(originalCount, selected);
  const optimized = optimizeVisualMap(feasible, originalCount, profiles, outline);
  return validMap(optimized, originalCount, requestedPages) ? optimized : feasible;
}

export const _internals = { evenlySelected, validMap, fallbackMap, scheduleScore, reducedMap };
