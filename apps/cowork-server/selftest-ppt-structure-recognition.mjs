// P0-1/P0-2/P0-3 structure recognition: plain-text drawings and listings in a
// technical document become editable native objects, configuration examples
// stay visible as compact code cards, and monospace text has its own floor.
import assert from 'node:assert/strict';
import { normalizePaste } from './lib/ppt-source.mjs';
import { applyPresentationPolicy } from './lib/ppt-presentation-policy.mjs';
import { layerStackRows, directoryTreeRows, annotatedListRows, labeledFlowRows, textFlowSteps, isLeadInCaption, isConfigListing } from './lib/ppt-source-structures.mjs';
import { measureComponent, CODE_FONT_FLOOR_PT } from './lib/ppt-density-capacity.mjs';

const fence = (body, language = '') => '```' + language + '\n' + body + '\n```';
const layers = `┌──────────────────────────────────────────────┐
│ L3 输出与闭环    审计方案 / 检查指引 / 质量评分   │
│                  ↑ 生成物自动归档回 wiki          │
├──────────────────────────────────────────────┤
│ L2 知识加工层    wiki/ ｜ 向量索引 ｜ 知识图谱     │
├──────────────────────────────────────────────┤
│ L1 数据采集层    raw/ (不可变原件 + 脱敏件)       │
└──────────────────────────────────────────────┘`;
const tree = `kb-root/
├── raw/                 # L0 不可变原件
│   ├── regulations/     # 政策法规
│   │   ├── 国家/        #   国家级法规
│   │   └── 监管/        #   金融监管总局
│   └── cases/           # 审计案例库
├── wiki/                # L1 编译层
│   └── topics/          # 专题综述
└── tools/               # CLI 工具集
    └── kb-lint/         # 健康检查`;
const yaml = `---
id: issue-2024-RH-0017      # 全局唯一实体 ID
type: issue
tags:
  business: 寿险业务
sources:
  - raw/reports/2024/RH-2024-03.md#L142-L168
---`;

// Pure recognizers keep every label.
const stack = layerStackRows(layers);
assert.deepEqual(stack.rows[0], ['层级', '组成与职责']);
assert.deepEqual(stack.rows.slice(1).map(row => row[0]), ['L3 输出与闭环', 'L2 知识加工层', 'L1 数据采集层']);
assert.match(stack.rows[1][1], /审计方案 \/ 检查指引 \/ 质量评分\n↑ 生成物自动归档回 wiki/);
const dirs = directoryTreeRows(tree);
assert.deepEqual(dirs.rows.slice(1).map(row => row[0]), ['raw/', 'wiki/', 'tools/']);
assert.equal(dirs.rows[1][2], 'regulations/ 政策法规（国家/ 国家级法规、监管/ 金融监管总局）；cases/ 审计案例库');
assert.equal(directoryTreeRows('├── Yes → approve\n├── No → reject\n└── Maybe → review\n├── a\n├── b\n└── c'), null, 'decision branches are not a directory tree');
assert.deepEqual(annotatedListRows('_index/MASTER.md   # 全局目录\n_index/by-tag.md   # 标签反查').rows.slice(1), [['_index/MASTER.md', '全局目录'], ['_index/by-tag.md', '标签反查']]);
assert.deepEqual(labeledFlowRows('读取路径：用户 → 网关 → 过滤 → 结果\n写入路径：智能体 → 编译 → 复核 → 提交').rows[1], ['读取路径', '用户 → 网关 → 过滤 → 结果']);
assert.deepEqual(textFlowSteps('原件接入 → 格式归一化(→md) → 脱敏\n        → 打标 → 触发编译').steps, ['原件接入', '格式归一化(→md)', '脱敏', '打标', '触发编译'], 'arrows inside parentheses do not split');
assert.equal(textFlowSteps('Input\n\n→ Story\n→ Render'), null, 'a short chain stays literal');
assert.equal(textFlowSteps('kb ask "<q>"\n  ① 校验\n  ② 改写\n     续行\n  ③ 生成').steps.join('|'), 'kb ask "<q>"|① 校验|② 改写 续行|③ 生成');
assert.ok(isLeadInCaption('**处理步骤**：') && isLeadInCaption('**输入源**（已具备，无需新建）：'));
assert.ok(!isLeadInCaption('有两种相互竞争的观点值得同时牢记于心：') && !isLeadInCaption('**编译流程**（智能体 `kb-compiler`）：'));
assert.ok(isConfigListing(yaml, 'yaml') && isConfigListing('version: 1\ndimensions:\n  a: b') && !isConfigListing('def f(x):\n    return x\nprint(f(1))'));

// Through the real parser and presentation policy.
const markdown = `# 方案

## 架构
${fence(layers)}

## 目录结构
${fence(tree)}

## Schema
${fence(yaml, 'yaml')}

## 编译
**处理步骤**：

${fence('1. 读取元数据\n2. 定位已有实体\n3. 抽取断言\n4. 冲突检测')}

## 程序
${fence('def f(x):\n    return x * 2\nprint(f(3))', 'python')}
`;
const source = applyPresentationPolicy(normalizePaste(markdown), { generationPolicy: { version: 2, content: 'overview', selection: 'editorial', code: { presentation: 'omit' } } });
const items = source.semantic.inventory.items, bySection = name => items.find(item => item.sectionPath.at(-1) === name);
assert.equal(bySection('架构').type, 'TableBlock'); assert.equal(bySection('架构').diagramSource.relation, 'layer-stack');
assert.equal(bySection('目录结构').type, 'TableBlock'); assert.equal(bySection('目录结构').diagramSource.relation, 'directory-tree');
assert.equal(bySection('目录结构').diagramSource.text, tree, 'the original drawing stays immutable for tracing');
const config = bySection('Schema');
assert.equal(config.type, 'CodeBlock'); assert.equal(config.codeKind, 'config');
assert.equal(config.presentation, undefined, 'configuration examples are not omitted with program code'); assert.equal(config.must_preserve_structure, true);
const excluded = { ...source, semantic: { ...source.semantic, inventory: { ...source.semantic.inventory, items: items.map(item => item === config ? { ...item, presentation: 'excluded_by_policy', presentationBasis: 'editorial selection' } : item) } } };
assert.equal(applyPresentationPolicy(excluded, { generationPolicy: { version: 2, content: 'overview', selection: 'editorial', code: { presentation: 'omit' } } }).semantic.inventory.items.find(item => item.id === config.id).presentation, 'excluded_by_policy', 'an editorial exclusion survives policy re-application');
const flow = bySection('编译');
assert.equal(flow.type, 'ProcessBlock'); assert.equal(flow.diagramSource.kind, 'text-flow'); assert.equal(flow.caption, '处理步骤');
assert.ok(!items.some(item => /处理步骤/.test(item.text)), 'the lead-in label is not a separate content unit');
const program = bySection('程序');
assert.equal(program.codeKind, 'program'); assert.equal(program.presentation, 'omitted_by_policy');

// P0-3: monospace text steps down to stop wrapping, never below the floor.
const frame = { x: 0, y: 0, width: 6 * 914400, height: 5 * 914400 };
const wide = { type: 'text', content: { text: 'x'.repeat(60) + '\n' + 'y'.repeat(60), codeBlock: { language: 'text', sourceText: '' } } };
const measured = measureComponent(wide, frame, 18);
assert.ok(measured.fontSizePt < 18 && measured.fontSizePt >= CODE_FONT_FLOOR_PT, `code font ${measured.fontSizePt}`);
assert.equal(measured.fontBasis, 'monospace_code_floor');
const prose = measureComponent({ type: 'text', content: { text: 'x'.repeat(200) } }, frame, 18);
assert.equal(prose.fontSizePt, undefined, 'prose keeps the page font');
console.log('PPT structure recognition (layer stack, directory tree, flows, config listings, captions, code font floor): OK');
