/** Allocate source-owned fragments before the writer sees a container. This
 * never synthesizes facts: only explicit arrow chains can be split, with their
 * shared boundary step repeated to make a cross-container continuation clear. */
const weight = text => [...text].reduce((n, c) => n + (/\p{Script=Han}/u.test(c) ? 2 : 1), 0);
const room = frame => Math.max(1, (frame.capacity?.maxLines || 3) *
  (frame.capacity?.latinCharactersPerLine || frame.capacity?.lineVisualUnits || 30));

function unitsOf(points) {
  return points.flatMap((point, pointIndex) => {
    const steps = point.text.split(/\s*(?:->|→|⇒)\s*/u).map(s => s.trim());
    // One implication is indivisible. Do not treat code, equations or empty
    // stages as a process merely because they happen to contain an arrow.
    const process = steps.length >= 3 && steps.length <= 64 && steps.every(s => s && !s.includes('\n')) &&
      !/[`{};=|]/u.test(point.text);
    return process ? steps.slice(1).map((_, i) => ({pointIndex, start: i, end: i + 1, steps})) :
      [{pointIndex, text: point.text}];
  });
}

function fragmentsOf(units, points) {
  const fragments = [];
  for (const unit of units) {
    const point = points[unit.pointIndex], previous = fragments.at(-1);
    if (unit.steps && previous?.pointId === point.id && previous.endStep === unit.start) {
      previous.endStep = unit.end;
      previous.sourceText = unit.steps.slice(previous.startStep, unit.end + 1).join(' → ');
      previous.continuesNext = unit.end < unit.steps.length - 1;
    } else fragments.push({pointId: point.id, sourceUnitIds: point.sourceUnitIds || [],
      sourceText: unit.steps ? unit.steps.slice(unit.start, unit.end + 1).join(' → ') : unit.text,
      ...(unit.steps ? {startStep: unit.start, endStep: unit.end,
        continuationFromPrevious: unit.start > 0, continuesNext: unit.end < unit.steps.length - 1} : {})});
  }
  return fragments;
}

export function planComponentAssignments(points, frames) {
  if (!points.length || !frames.length || frames.length > 12 ||
      points.some(p => !p.id || !String(p.text || '').trim()) ||
      new Set(points.map(p => p.id)).size !== points.length ||
      new Set(frames.map(f => f.id)).size !== frames.length) throw Error('invalid_component_plan');
  const units = unitsOf(points);
  if (units.length < frames.length) throw Error('source_insufficient');
  if (units.length > 240) throw Error('component_plan_capacity');
  // Contiguous partitions preserve both source order and the supplied visual
  // reading order. Penalize mixing independent points when separate boxes fit.
  const n = units.length, m = frames.length, dp = Array.from({length: m + 1}, () => Array(n + 1).fill(Infinity));
  const cut = Array.from({length: m + 1}, () => Array(n + 1).fill(-1));
  const weights = [0], shared = [0], breaks = [0];
  for (let i = 0; i < n; i++) {
    const u = units[i], prior = units[i - 1];
    weights.push(weights[i] + weight(u.steps ? u.steps.slice(u.start, u.end + 1).join(' → ') : u.text));
    shared.push(shared[i] + (u.steps && prior?.pointIndex === u.pointIndex ? weight(u.steps[u.start]) : 0));
    breaks.push(breaks[i] + (prior && prior.pointIndex !== u.pointIndex ? 1 : 0));
  }
  dp[0][0] = 0;
  for (let count = 1; count <= m; count++) for (let end = count; end <= n - (m - count); end++) {
    for (let start = count - 1; start < end; start++) {
      if (!Number.isFinite(dp[count - 1][start])) continue;
      const load = (weights[end] - weights[start] - shared[end] + shared[start + 1]) / room(frames[count - 1]);
      const score = dp[count - 1][start] + load * load + (breaks[end] - breaks[start + 1]) * 4;
      if (score < dp[count][end]) { dp[count][end] = score; cut[count][end] = start; }
    }
  }
  const result = [];
  for (let count = m, end = n; count; count--) {
    const start = cut[count][end];
    if (start < 0) throw Error('component_plan_capacity');
    const fragments = fragmentsOf(units.slice(start, end), points);
    result.unshift({...frames[count - 1], pointIds: [...new Set(fragments.map(f => f.pointId))], fragments});
    end = start;
  }
  return {version: 1, basis: 'ordered_source_fragments_and_measured_container_capacity', assignments: result};
}
