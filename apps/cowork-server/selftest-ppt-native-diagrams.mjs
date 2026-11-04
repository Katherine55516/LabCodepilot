// Native diagram components (layer bands, card grid, KPI tiles, doughnut, flow
// connectors) from recognised source structures: every source cell stays
// visible and provable, and the real PPTX export carries native shapes/charts.
import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';
import {normalizePaste} from './lib/ppt-source.mjs';
import {bindSourceArtifacts} from './lib/ppt-source-artifacts.mjs';
import {inspectObjectIntegrity} from './lib/ppt-object-integrity.mjs';
import {buildRenderTree} from './lib/ppt/render-tree.mjs';
import {BUILT_INS,snapshotTemplate} from './lib/ppt-template.mjs';
import {renderPptx} from './lib/ppt-render.mjs';
import {localPptRuntime} from './test/ppt-local-runtime.mjs';
import {chooseTableDiagram,diagramCoverage} from './lib/ppt-diagram-cards.mjs';
import {applyPresentationPolicy} from './lib/ppt-presentation-policy.mjs';

const fence=(body,lang='')=>'```'+lang+'\n'+body+'\n```';
const markdown=`# 方案

## 架构
${fence(`┌────────────────────────────────────────┐
│ L3 输出层    审计方案 / 检查指引          │
├────────────────────────────────────────┤
│ L2 加工层    wiki/ ｜ 向量索引            │
├────────────────────────────────────────┤
│ L1 采集层    raw/ (不可变原件)            │
└────────────────────────────────────────┘`)}

## 检索
| 通道 | 引擎 | 权重 |
|---|---|---|
| 关键词 | ES（BM25） | 0.3 |
| 语义 | Milvus（向量） | 0.5 |
| 图谱 | 关系查询 | 0.2 |

## 决策
| 决策点 | 方案 | 理由 |
|---|---|---|
| 知识载体 | **Markdown + git** | 人机双可读 |
| 向量库 | 复用现有 Milvus | 不新增组件 |
| 模型 | 仅 DeepSeek | 硬性约束 |

## 指标
| 指标 | 目标 |
|---|---|
| 问答采纳率 | ≥ 70% |
| 单次问答响应 | ≤ 15 秒 |
| 敏感信息残留 | 0 例 |

## 编译
${fence('1. 读取元数据\n2. 定位已有实体\n3. 抽取断言\n4. 冲突检测')}
`;
const OVERVIEW={generationPolicy:{version:2,content:'overview',knowledge:'source_only',language:{mode:'source',body:'both'}}};
const source=applyPresentationPolicy(normalizePaste(markdown),OVERVIEW),items=source.semantic.inventory.items,bySection=name=>items.find(i=>i.sectionPath.at(-1)===name);
const layers=bySection('架构'),weights=bySection('检索'),decisions=bySection('决策'),metrics=bySection('指标'),steps=bySection('编译');
// A small source table stays a table (Fable D1, 2026-11-01); a share column is still a donut.
assert.equal(chooseTableDiagram(layers),null);assert.equal(chooseTableDiagram(weights),'donut');assert.equal(chooseTableDiagram(decisions),null);assert.equal(chooseTableDiagram(metrics),null);
assert.equal(steps.type,'ProcessBlock');
// Only the v2 overview contract opts tables into native diagrams.
assert.equal(decisions.tableRepresentation,'diagram');
assert.equal(applyPresentationPolicy(source,{generationPolicy:{version:2,content:'full_source'}}).semantic.inventory.items.find(i=>i.id===decisions.id).tableRepresentation,undefined,'only the v2 overview contract converts tables');

const units=[layers,weights,decisions,metrics,steps];
function project(){
  const p={id:'native-diagrams',source:structuredClone(source),template:'blue',templateSpec:snapshotTemplate(BUILT_INS.find(t=>t.id==='blue')),generationPolicy:{version:2,content:'overview',knowledge:'source_only',language:{mode:'source',body:'both'}}};
  p.outline=[{id:'cover',title:'方案'},...units.map((u,i)=>({id:'s'+i,title:u.sectionPath.at(-1),sourceUnitIds:[u.id],sourceArtifactRanges:[{sourceUnitId:u.id}]})),{id:'close',title:'谢谢'}];
  p.planning={slidePlan:p.outline.map(s=>({slideId:s.id,sourceArtifacts:s.sourceArtifactRanges||[]}))};
  p.deck={slides:p.outline.map(s=>({id:s.id,title:s.title,nodes:[]}))};
  p.pages=p.outline.length;p.pageDecision={mode:'explicit',finalPageCount:p.pages};p.revision=1;
  for(let i=1;i<p.outline.length-1;i++)bindSourceArtifacts(p,p.deck.slides[i],p.planning.slidePlan[i].sourceArtifacts,i);
  return p;
}
const p=project(),nodeOf=(p,id)=>p.deck.slides.flatMap(s=>s.nodes||[]).find(n=>n.sourceArtifact?.sourceUnitId===id);
for(const u of [layers,decisions,metrics])assert.equal(nodeOf(p,u.id).type,'table',u.sectionPath.at(-1)+' is drawn as a table');
assert.equal(nodeOf(p,weights.id).type,'chart');assert.equal(nodeOf(p,weights.id).content.chartType,'doughnut');assert.deepEqual(nodeOf(p,weights.id).content.values,[0.3,0.5,0.2]);
assert.ok(!nodeOf(p,decisions.id).content.rows.flat().some(cell=>String(cell).includes('**')),'inline Markdown is resolved, not shown');
assert.equal(nodeOf(p,decisions.id).content.rows[0].join('|'),decisions.rows[0].join('|'),'the header is the source block\'s first row');
assert.equal(diagramCoverage(weights,nodeOf(p,weights.id)).complete,true);
assert.deepEqual(inspectObjectIntegrity(p).issues,[],'every displayed cell is proven');

// Negative: a diagram that drops or alters a cell is not accepted as the table.
const relabelled=structuredClone(p);nodeOf(relabelled,weights.id).content.diagram.sourceRows[0].cells[1]='40%';
assert.equal(diagramCoverage(weights,nodeOf(relabelled,weights.id)).complete,false,'declared cells must equal the original');

// Render tree: same-row flow arrows; diagram boxes recomputed from the frame.
const tree=buildRenderTree(p);
const flow=tree.slides[5].elements.find(e=>e.content?.pointLayout?.variant==='flow');
assert.ok(flow?.content.pointLayout.connectors.length>=1);assert.equal(flow.content.pointLayout.connectors.length,flow.content.items.length-1,'cross-row source steps remain connected');

// Real PPTX export: structural verification against the instance manifest
// (rendered-visibility additionally needs LibreOffice in the runtime).
const root=fs.mkdtempSync(path.join(os.tmpdir(),'ppt-native-diagrams-'));
try{
  let structural='passed';
  try{const result=await renderPptx({...p,renderTree:tree},localPptRuntime(root).io);assert.equal(result.exportVerification.status,'passed');}
  catch(error){if(!/No such file or directory: 'soffice'|FileNotFoundError[^\n]*soffice|export_verifier_unavailable: LibreOffice/u.test(String(error.message)))throw error;structural='passed (visibility skipped: soffice missing)';}
  const file=path.join(root,p.id,'presentation.pptx');assert.ok(fs.existsSync(file));
  const python=process.env.PPT_TEST_PYTHON||'python3';
  const probe=JSON.parse(execFileSync(python,['-I','-c',"import sys,json\nfrom pptx import Presentation\nfrom pptx.enum.chart import XL_CHART_TYPE\np=Presentation(sys.argv[1]);out={'doughnut':0,'connectors':0}\nfor s in p.slides:\n  for sh in s.shapes:\n    if sh.has_chart and sh.chart.chart_type==XL_CHART_TYPE.DOUGHNUT: out['doughnut']+=1\n    if sh.name.startswith('AIMate decor:flow'): out['connectors']+=1\nprint(json.dumps(out))",file],{encoding:'utf8'}));
  assert.equal(probe.doughnut,1,'a native doughnut chart is exported');assert.ok(probe.connectors>=1,'native flow connectors are exported');
  console.log(`PPT native diagrams (small tables stay tables, doughnut, flow arrows): coverage proof, negatives and PPTX export ${structural}: OK`);
}finally{fs.rmSync(root,{recursive:true,force:true});}
