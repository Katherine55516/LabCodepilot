/** Source is ground truth; the optional reference deck is only a comparison.
 * Lexical recall and paragraph counts are diagnostics, not semantic entailment. */
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {normalizePaste} from '../../apps/cowork-server/lib/ppt-source.mjs';
import {inspectInventoryCoverage,recall} from '../../apps/cowork-server/lib/ppt-content-inventory.mjs';
const [sourcePath,outputPath,referencePath,reportPath]=process.argv.slice(2);
if(!sourcePath||!outputPath)throw Error('Usage: benchmark-content.mjs SOURCE.md OUTPUT.pptx [REFERENCE.pptx] [REPORT.json]');
const source=normalizePaste(fs.readFileSync(sourcePath,'utf8'));
const python=process.env.PPT_TEST_PYTHON||'/Users/dongli/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3';
const inspectScript=String.raw`
import json,sys,re
from pptx import Presentation
p=Presentation(sys.argv[1]);pages=[]
for s in p.slides:
 text=[];tables=[];objects=[];units=0
 for shape in s.shapes:
  row={'name':shape.name}
  if shape.has_text_frame:
   text.append(shape.text);row['text']=shape.text
   row['paragraphs']=[q.text for q in shape.text_frame.paragraphs if q.text.strip()]
   units+=sum(len(q.split())>=5 or len(re.findall(r'[\u3400-\u9fff]',q))>=8 for q in row['paragraphs'])
  if shape.has_table:
   rows=[[cell.text for cell in row.cells] for row in shape.table.rows]
   tables.append(rows);row['rows']=rows;text.extend(' | '.join(row) for row in rows);units+=len(rows)-1
  objects.append(row)
 pages.append({'text':'\n'.join(text),'tables':tables,'objects':objects,'shapes':len(s.shapes),'visibleContentUnits':units})
print(json.dumps({'width':p.slide_width,'height':p.slide_height,'pages':pages},ensure_ascii=False))
`;
function inspect(file){
 const r=spawnSync(python,['-c',inspectScript,file],{maxBuffer:10_000_000});
 if(r.status)throw Error(r.stderr.toString());return JSON.parse(r.stdout);
}
function nodesFor(page){
 return page.objects.flatMap(object=>{
  const provenance=object.name.match(/^AIMate source:([^:]+):(.+)$/);
  if(provenance){
   const type=provenance[2]==='TableBlock'?'table':provenance[2]==='ProcessBlock'?'timeline':provenance[2]==='ChecklistBlock'?'list':'text';
   return [{type,content:type==='table'?{rows:object.rows}:['timeline','list'].includes(type)?{items:object.paragraphs.map(text=>({text:text.replace(/^\s*(?:\d+[.)]|•)\s*/, '')}))}:{text:object.text},sourceArtifact:{sourceUnitId:provenance[1],type:provenance[2]}}];
  }
  if(!object.rows)return [];
  const header=object.rows[0].join('|').toLowerCase();
  const candidates=source.semantic.inventory.items.filter(item=>item.type==='TableBlock'&&item.rows[0].join('|').toLowerCase()===header);
  const item=candidates.sort((a,b)=>recall(b.text,object.rows.flat().join(' '))-recall(a.text,object.rows.flat().join(' ')))[0];
  return [{type:'table',content:{rows:object.rows},sourceArtifact:item?{sourceUnitId:item.id,type:'TableBlock'}:null}];
 });
}
function measure(file){
 const deck=inspect(file),counts=deck.pages.map(page=>page.text.replace(/\s/g,'').length),sorted=[...counts].sort((a,b)=>a-b);
 const slides=deck.pages.map((page,index)=>({id:`s${index}`,text:page.text,nodes:nodesFor(page)}));
 const review=inspectInventoryCoverage(source,slides,slide=>slide.text);
 const fragmentation=[],redundancy=[];
 for(let i=1;i<deck.pages.length-2;i++){
  const similarity=Math.min(recall(deck.pages[i].text,deck.pages[i+1].text),recall(deck.pages[i+1].text,deck.pages[i].text));
  if(counts[i]<180&&counts[i+1]<180&&similarity>.35)fragmentation.push([i+1,i+2]);
  if(similarity>.65)redundancy.push({pages:[i+1,i+2],similarity});
 }
 return {file:path.basename(file),pageCount:deck.pages.length,totalVisibleChars:counts.reduce((a,b)=>a+b,0),medianVisibleChars:sorted[Math.floor(sorted.length/2)],nativeTables:deck.pages.reduce((a,p)=>a+p.tables.length,0),size:{width:deck.width,height:deck.height},metrics:review.metrics,
 underfilledPages:counts.flatMap((count,i)=>i>0&&i<counts.length-1&&count<180?[i+1]:[]),fragmentationCandidates:fragmentation,fragmentationIndex:fragmentation.length/Math.max(1,deck.pages.length-2),adjacentRedundancy:redundancy,
 pages:deck.pages.map((page,i)=>({page:i+1,title:page.text.split('\n')[0],visibleChars:counts[i],visibleContentUnits:page.visibleContentUnits,tableCount:page.tables.length,text:page.text}))};
}
const report={version:2,source:{file:path.basename(sourcePath),chars:source.text.length,chunks:source.semantic.chunks.length,inventoryItems:source.semantic.inventory.items.length},aimate:measure(outputPath),...(referencePath?{reference:measure(referencePath)}:{}),limitations:['Token overlap is not semantic entailment','Visible content units count substantive paragraphs and table rows, not model-evaluated meaning','AIMate provenance identifies typed objects; reference structures without provenance require visual review, so their structure recall is a lower bound','Bilingual distribution, whitespace and table text extraction differ across producers','A zero short-paragraph fragmentation score does not exclude conceptual over-fragmentation; inspect planner and per-page evidence']};
const target=reportPath||'outputs/ppt-next-round/content-benchmark.json';fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(report,null,2));
console.log(JSON.stringify({source:report.source,aimate:{...report.aimate,pages:undefined,metrics:{...report.aimate.metrics,items:undefined}},reference:report.reference&&{...report.reference,pages:undefined,metrics:{...report.reference.metrics,items:undefined}}},null,2));
