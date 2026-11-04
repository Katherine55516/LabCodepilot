import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { _internals as renderer } from './lib/ppt-render.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const python = process.env.PPT_BENCH_PYTHON
  || '/Users/dongli/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3';
const artifactDir = path.join(repo, 'docs/research/artifacts');
fs.mkdirSync(artifactDir, { recursive: true });

const baseSlides = [
  {
    id: 'cover',
    title: 'AI Native Lab 企业推广复盘',
    bullets: ['2026 年第三季度 · 示例数据'],
    blocks: [],
    layoutId: 'cover',
  },
  {
    id: 'summary',
    title: '本季度增长来自试点转正式采购',
    bullets: [
      '付费席位环比增长 32%，其中 71% 来自已完成试点的客户。',
      '周活跃率由 54% 升至 68%，PPT 与测试工作台贡献了主要增量。',
      '安全评审仍是最大阻塞点，平均拉长企业转化周期 18 天。',
    ],
    blocks: [],
    layoutId: 'summary',
  },
  {
    id: 'kpi',
    title: '付费席位连续三个季度增长',
    bullets: [
      'Q3 付费席位达到 2,840 个，环比增加 690 个。',
      '正式采购客户从 18 家增至 27 家。',
    ],
    blocks: [{
      id: 'seat-growth', type: 'chart', chartType: 'bar',
      labels: ['Q4', 'Q1', 'Q2', 'Q3'], values: [980, 1420, 2150, 2840], unit: '付费席位',
    }],
    layoutId: 'chart',
  },
  {
    id: 'usage',
    title: '内容创作成为最高频使用场景',
    bullets: [
      'PPT 月活用户占付费用户的 62%，文档处理占 48%。',
      '测试与代码场景的单次任务时长更长，但使用人数仍有提升空间。',
    ],
    blocks: [{
      id: 'usage-chart', type: 'chart', chartType: 'bar',
      labels: ['PPT', '文档', '测试', '代码'], values: [62, 48, 36, 31], unit: '月活占比 %',
    }],
    layoutId: 'chart',
  },
  {
    id: 'segments',
    title: '科技与专业服务客户的续约意向最高',
    bullets: [
      '两个行业贡献了 59% 的正式采购客户。',
      '制造业活跃率偏低，需要补行业模板和部署指引。',
    ],
    blocks: [{
      id: 'segment-table', type: 'table', rows: [
        ['行业', '客户数', '周活跃率', '续约意向'],
        ['科技', '9', '76%', '89%'],
        ['专业服务', '7', '72%', '86%'],
        ['制造', '6', '55%', '67%'],
        ['其他', '5', '61%', '72%'],
      ],
    }],
    layoutId: 'table',
  },
  {
    id: 'funnel',
    title: '安全评审是企业转化的主要流失点',
    bullets: [
      '进入安全评审的 46 家客户中，只有 27 家完成采购。',
      '标准化安全材料可覆盖当前 63% 的重复问题。',
    ],
    blocks: [{
      id: 'funnel-chart', type: 'chart', chartType: 'bar',
      labels: ['线索', '试用', '评审', '采购'], values: [118, 73, 46, 27], unit: '客户数',
    }],
    layoutId: 'chart',
  },
  {
    id: 'feedback',
    title: '用户反馈集中在模板质量与团队协作',
    bullets: [
      '模板丰富度影响首次成稿质量，也是企业用户最常见的改进建议。',
      '协作反馈主要涉及批注、共享权限和多人编辑。',
    ],
    blocks: [{
      id: 'feedback-table', type: 'table', rows: [
        ['问题', '反馈数', '影响阶段'],
        ['模板不足', '38', '首次生成'],
        ['协作能力', '31', '团队评审'],
        ['图表样式', '19', '精修'],
        ['导出一致性', '12', '交付'],
      ],
    }],
    layoutId: 'table',
  },
  {
    id: 'priorities',
    title: '下一季度优先补齐质量闭环',
    bullets: [
      '先建立内容、版式和导出三层质量门禁，再扩展更多模板。',
      '把高频企业场景沉淀为可测试的版式族与内容规则。',
    ],
    blocks: [
      { id: 'p0', type: 'shape', shape: 'rect', fill: '#4f72e6', text: 'P0\n生成后自动质检' },
      { id: 'p1', type: 'shape', shape: 'rect', fill: '#16a3a5', text: 'P1\n企业模板与协作' },
    ],
    layoutId: 'comparison',
  },
  {
    id: 'plan',
    title: '12 周计划以质量门禁为第一里程碑',
    bullets: [
      '1–4 周：质量检查器阻断溢出和低对比度',
      '5–8 周：版式注册表覆盖常用页面',
      '9–12 周：媒体管线并行执行',
    ],
    blocks: [],
    layoutId: 'timeline',
  },
  {
    id: 'decision',
    title: '需要确认的产品决策',
    bullets: [
      '把“可编辑且无明显版式问题”设为首稿交付门槛。',
      '建立固定评测集，持续记录首稿接受率和人工修改时长。',
      '先优化 6–12 页企业汇报，再覆盖长篇课程和营销内容。',
    ],
    blocks: [],
    layoutId: 'conclusion',
  },
];

const deck = {
  template: 'violet',
  fonts: {
    title: 'Noto Sans CJK SC', body: 'Noto Sans CJK SC',
    titleEastAsia: 'Noto Sans CJK SC', bodyEastAsia: 'Noto Sans CJK SC', cjkExplicit: true,
  },
  palette: {
    background: '#10182b', foreground: '#f4f7ff', muted: '#c4ccdc', accent: '#62c7d8',
  },
  slides: baseSlides,
};

function expandedSlides(count) {
  return Array.from({ length: count }, (_, index) => {
    const source = baseSlides[index % baseSlides.length];
    return { ...source, id: `${source.id}-${index + 1}`, title: source.title };
  });
}

function render(payload, output) {
  const started = performance.now();
  const result = spawnSync(python, ['-c', renderer.SCRIPT], {
    input: JSON.stringify(payload),
    env: { ...process.env, PPT_OUTPUT: output },
    encoding: 'utf8',
    maxBuffer: 8_000_000,
  });
  const elapsedMs = performance.now() - started;
  if (result.status !== 0) {
    throw new Error(`renderer failed: ${result.stderr || result.stdout}`);
  }
  return { elapsedMs, bytes: fs.statSync(output).size };
}

const sampleIr = path.join(artifactDir, 'ppt-m5-quality-sample-ir.json');
const samplePptx = path.join(artifactDir, 'ppt-m5-quality-sample.pptx');
fs.writeFileSync(sampleIr, `${JSON.stringify(deck, null, 2)}\n`);
render(deck, samplePptx);

const cases = [
  { id: 'text-3', name: '3 页纯文本简报', slides: 3 },
  { id: 'mixed-8', name: '8 页图表与表格汇报', slides: 8 },
  { id: 'review-10', name: '10 页企业季度复盘', slides: 10 },
  { id: 'mixed-20', name: '20 页混合内容长报告', slides: 20 },
  { id: 'upper-30', name: '30 页当前上限压力用例', slides: 30 },
];

const results = [];
const warmupOutput = path.join(artifactDir, '.benchmark-warmup.pptx');
render({ ...deck, slides: expandedSlides(3) }, warmupOutput);
fs.rmSync(warmupOutput, { force: true });
for (const item of cases) {
  const samples = [];
  const output = path.join(artifactDir, `.benchmark-${item.id}.pptx`);
  for (let run = 0; run < 7; run += 1) {
    samples.push(render({ ...deck, slides: expandedSlides(item.slides) }, output).elapsedMs);
  }
  samples.sort((a, b) => a - b);
  results.push({
    ...item,
    medianMs: Number(samples[3].toFixed(1)),
    minMs: Number(samples[0].toFixed(1)),
    maxMs: Number(samples[samples.length - 1].toFixed(1)),
    bytes: fs.statSync(output).size,
    samplesMs: samples.map(value => Number(value.toFixed(1))),
  });
  fs.rmSync(output, { force: true });
}

const report = {
  generatedAt: new Date().toISOString(),
  scope: 'Local deterministic python-pptx export only; excludes model, Cowork startup, network, media generation and upload/download.',
  python,
  repetitions: 7,
  statistic: 'median',
  cases: results,
};
const outputJson = path.join(artifactDir, 'ppt-m5-render-benchmark.json');
fs.writeFileSync(outputJson, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ samplePptx, sampleIr, outputJson, results }, null, 2));
