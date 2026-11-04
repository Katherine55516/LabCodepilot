// A PDF table that crosses a page break is one table (Fable, 2026-11-01, B5):
// the CodePilot pdf's "类别 | 命令" table was read as two blocks with the
// header repeated, so its card showed one row. The second part joins the
// first when its header repeats, or when it has the same columns and at most
// two rows; a different table, another section or the same page stays apart.
import assert from 'node:assert/strict';
import {mergeLayoutContinuations} from './lib/ppt-semantic.mjs';

const table=(id,page,text,sectionPath=['9 编辑命令','结构化命令集合'])=>({id,type:'table',location:`PDF 第 ${page} 页`,text,sectionPath,sourceRefs:[String(page)],tokenCount:20});
const first=table('b_0110',21,'| 类别 | 命令 |\n| --- | --- |\n| 页面 | slide.insert、slide.delete |');
const repeated=table('b_0111',22,'| 类别 | 命令 |\n| --- | --- |\n| 单节点 | node.insert |\n| 主题 | theme.setPalette |');
const merged=mergeLayoutContinuations([first,repeated]);
assert.equal(merged.length,1);
assert.equal(merged[0].text,'| 类别 | 命令 |\n| --- | --- |\n| 页面 | slide.insert、slide.delete |\n| 单节点 | node.insert |\n| 主题 | theme.setPalette |');
assert.deepEqual(merged[0].sourceRefs,['21','22']);
assert.equal(merged[0].locationEnd,'PDF 第 22 页');

// A short part without a repeated header, same columns.
const bare=mergeLayoutContinuations([first,table('b_0112',22,'| AI 补丁 | ai.objectPatch |')]);
assert.equal(bare.length,1);assert.match(bare[0].text,/AI 补丁/u);

// Apart: another header with more rows, other columns, another section, the same page, a Word table.
const other=table('b_0114',22,'| 对象 | 限制 |\n| --- | --- |\n| 节点 | text |\n| 图表 | bar |\n| 表格 | 2–6 行 |');
assert.equal(mergeLayoutContinuations([first,other]).length,2);
assert.equal(mergeLayoutContinuations([first,table('x',22,'| a | b | c |\n| --- | --- | --- |\n| 1 | 2 | 3 |')]).length,2);
assert.equal(mergeLayoutContinuations([first,table('y',22,'| 类别 | 命令 |\n| --- | --- |\n| 单节点 | n |',['10 渲染'])]).length,2);
assert.equal(mergeLayoutContinuations([first,table('z',21,'| 类别 | 命令 |\n| --- | --- |\n| 单节点 | n |')]).length,2);
assert.equal(mergeLayoutContinuations([{...first,location:'Word 段落 3'},{...repeated,location:'Word 段落 4'}]).length,2);
console.log('PASS PDF table continuation: a repeated header or a short same-column part joins its table');
