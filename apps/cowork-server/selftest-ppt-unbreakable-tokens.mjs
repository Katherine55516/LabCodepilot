// Words joined without a space ("tools/list、resources/list、prompts/list",
// "CallToolResult(content,isError)", "87.5") do not break in the renderers, so
// the shared line estimator measures each at its real width before packing
// (Fable 2026-10-31, MCP xlsx p10: the API names wrapped a line more than
// measured and "清单" overlapped the next card's label).
import assert from 'node:assert/strict';
import {measureText,textContract,CARD_PADDING,PT_EMU} from './lib/ppt/render-contract.mjs';
import {diagramCardPlan,DIAGRAM_VERSION} from './lib/ppt-diagram-cards.mjs';

const IN=914400;
const measure=(text,widthIn,pt=18)=>{const e={kind:'text',bounds:{width:widthIn*72*PT_EMU,height:1e12},style:{fontSizePt:pt,lineHeight:1.18,paragraphSpacingEm:0},content:{text}};return measureText(e,textContract(e,CARD_PADDING));};

// The xlsx card: the joined API names cannot follow "分别查询" on line 1, so
// "获取清单" takes a third line (as LibreOffice rendered it).
assert.equal(measure('分别查询 tools/list、resources/list、prompts/list 获取清单',5.863).lines,3);
// Spaces between the names are break points again.
assert.equal(measure('查询 tools/list 与 prompts/list',5.863).lines,1);
// Ordinary prose measures as before.
assert.equal(measure('用户输入需求，Host 提供用户需求与能力摘要给模型',5.863).lines,2);
assert.equal(measure('The model can answer directly, run a built-in capability, or call an external one.',5.863).lines,3);
// A unit wider than the whole line still breaks inside (as the renderers do), never reported as overflowing.
{const long=measure('see apps/cowork-server/lib/ppt-card-pages.mjs/fitThemePage/themePageAt/laddered/components/now',2.4,14);
 assert.equal(long.widthOverflow,false);assert.ok(long.lines>=3);}
// Closing punctuation stays with its word: "list、" is never measured as a line start.
assert.ok(measure('a/b、c/d',.9,18).lines>=1);

// The page-10 grid: each card's box holds its measured lines, so the
// API-name card's row is taller than a two-line row.
{const items=[['初始化阶段','Host 发送 initialize，Server 返回协议版本、capabilities 开关和 serverInfo'],['能力发现阶段','分别查询 tools/list、resources/list、prompts/list 获取清单'],['上下文阶段','用户输入需求，Host 提供用户需求与能力摘要给模型'],['分支选择','模型可直接回答、执行内置能力，或通过 MCP 调用外部能力'],['MCP 调用路径','单独调 Tool、先读 Resource 再调 Tool，或按工作流 Prompt 编排'],['输出阶段','Server 返回 CallToolResult(content,isError)，模型组织自然语言输出']].map(([heading,body])=>({heading,body,text:heading+'\n'+body}));
 const geometry={x:661475,y:1969034,width:10868745,height:3644799},plan=diagramCardPlan({items,diagram:{version:DIAGRAM_VERSION,kind:'card-grid',cardPage:true}},geometry,18);
 assert.ok(plan,'a plan exists');
 const width=geometry.width/IN,cellWidth=plan.boxes[1].w*width;
 const need=item=>{const head=measure(item.heading,cellWidth,plan.fontSizePt),body=measure(item.body,cellWidth,plan.fontSizePt);return head.lines+body.lines;};
 assert.equal(need(items[1]),plan.fontSizePt===18?4:need(items[1]),'heading and three body lines at 18 pt');
 if(!plan.overflow){const rowOf=k=>plan.boxes[k].y,row1=plan.boxes.filter(b=>b.y===rowOf(1)),row0=plan.boxes.filter(b=>b.y===rowOf(0));
  if(rowOf(0)!==rowOf(1))assert.ok(row1[0].h>row0[0].h*.99);
  const heightIn=plan.boxes[1].h*geometry.height/IN,lineIn=plan.fontSizePt*1.18/72;
  assert.ok(heightIn>=need(items[1])*lineIn,`the card holds its ${need(items[1])} lines: ${heightIn.toFixed(2)} in`);}}
console.log('PASS joined words and their closing punctuation are measured whole; over-wide units still break; grid cards hold their real lines');
