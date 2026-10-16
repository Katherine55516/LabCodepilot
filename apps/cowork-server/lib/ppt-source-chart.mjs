/** Recognize explicit source data, never invent values from a chart request. */
const chartRequest = /图表|柱状图|柱形图|折线图|饼图|\b(?:chart|plot|bar graph)\b/iu;
const metric = /销量|销售额|营收|收入|产量|人数|访问量|数量|个数|数目|规模|占比|比例|\b(?:sales|revenue|visits|production|headcount|count|number|share|rate)\b/iu;
const numeric = value => /^[-+−]?\d+(?:,\d{3})*(?:\.\d+)?$/u.test(value.trim()) ? Number(value.replaceAll(',', '').replace('−', '-')) : null;

export function sourceChart(text, { rows, context = '' } = {}) {
  const requested = chartRequest.test(context + '\n' + text);
  let labels, values, unit = '', title = '';
  if (rows) {
    if (!requested || rows.length < 3 || rows.some(row => row.length !== 2)) return null;
    labels = rows.slice(1).map(row => String(row[0]).trim());
    values = rows.slice(1).map(row => numeric(String(row[1])));
    title = String(rows[0][1]);
  } else {
    // A closing sentence mark is not part of the last value's unit.
    const line = String(text).trim().replace(/[。．.;；]+$/u, '').match(/^([^\n：:]{1,80})[：:]\s*([^\n]+)$/u);
    if (!line) return null;
    // Three or more "label value" pairs with one unit are an explicit series.
    const pairCount = line[2].split(/[、，；;]|,(?=\s*[A-Za-z\p{Script=Han}])/u).filter(value => value.trim()).length;
    if (!requested && !metric.test(line[1]) && pairCount < 3) return null;
    title = line[1].trim();
    const parts = line[2].split(/[、，；;]|,(?=\s*[A-Za-z\p{Script=Han}])/u).map(value => value.trim()).filter(Boolean);
    if (parts.length < 2 || parts.length > 24) return null;
    const parsed = parts.map(part => part.match(/^(.{1,40}?)\s*(?:[:：=]\s*|\s+)([-+−]?\d+(?:,\d{3})*(?:\.\d+)?)\s*([^\d\s]{0,12})$/u));
    if (parsed.some(value => !value)) return null;
    labels = parsed.map(value => value[1].trim());
    values = parsed.map(value => numeric(value[2]));
    const units = [...new Set(parsed.map(value => value[3]))];
    if (units.length !== 1) return null;
    unit = units[0];
  }
  if (!labels.length || new Set(labels).size !== labels.length || labels.some(label => !label) || values.some(value => value === null || !Number.isFinite(value))) return null;
  const chartType = /折线|\bline\b/iu.test(context + text) ? 'line' : /饼图|\bpie\b/iu.test(context + text) ? 'pie' : 'bar';
  if (chartType === 'pie' && (values.some(value => value < 0) || !values.some(value => value > 0))) return null;
  return { chartType, labels, values, unit, chartTitle: title, chartSource: 'explicit_source_data' };
}
