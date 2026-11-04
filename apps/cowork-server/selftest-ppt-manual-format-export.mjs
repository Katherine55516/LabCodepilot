// The author's own formatting reaches a generic (built-in template) PPTX: an
// italic, underlined or bold override and a font chosen for code are written to
// the runs, while text the author did not format keeps its rich-text styling
// (from main 9e0351cd, integration plan step 5).
import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {applyRenderContract,PT_EMU} from './lib/ppt/render-contract.mjs';
import {_internals as exporter} from './lib/ppt-render.mjs';
const python=process.env.PPT_TEST_PYTHON||process.env.PPT_PYTHON||'python3',root=fs.mkdtempSync(path.join(os.tmpdir(),'ppt-manual-format-'));
const size={width:12192000,height:6858000},fonts={title:'Arial',body:'Arial',titleEastAsia:'PingFang SC',bodyEastAsia:'PingFang SC'},palette={background:'#ffffff',accent:'#6758c8',foreground:'#111827',muted:'#222222'};
const box=(id,y,extra)=>applyRenderContract({id,nodeId:id,kind:'text',bounds:{x:60*PT_EMU,y:y*PT_EMU,width:600*PT_EMU,height:60*PT_EMU},zIndex:1,...extra});
const elements=[
 box('manual',40,{style:{fontSizePt:18,fontStyle:'italic',textDecoration:'underline',fontWeight:700},textStyleOverrides:['fontStyle','textDecoration','fontWeight'],content:{text:'Formatted by the author'}}),
 box('plain',130,{style:{fontSizePt:18,fontStyle:'italic',textDecoration:'underline'},content:{text:'Not formatted by the author'}}),
 box('code',220,{style:{fontSizePt:16,fontFamily:'Georgia'},textStyleOverrides:['fontFamily'],content:{text:'def verify(x): return x',codeBlock:true}}),
 box('code-default',310,{style:{fontSizePt:16,fontFamily:'Georgia'},content:{text:'def default(x): return x',codeBlock:true}}),
];
try{
 const file=path.join(root,'manual.pptx');
 const out=spawnSync(python,['-c',exporter.SCRIPT],{input:JSON.stringify({slides:[{title:'Manual format',bullets:[]}],renderTree:{slides:[{id:'s',size,elements}]},fonts,palette}),env:{...process.env,PPT_OUTPUT:file},maxBuffer:4e6});
 assert.equal(out.status,0,out.stderr.toString());
 const check=spawnSync(python,['-c',String.raw`
import sys,json
from pptx import Presentation
p=Presentation(sys.argv[1]);shapes={s.text_frame.text:s for s in p.slides[0].shapes if s.has_text_frame}
runs=lambda text:[r for para in shapes[text].text_frame.paragraphs for r in para.runs]
print(json.dumps({
 'manual':[[r.font.italic,r.font.underline,r.font.bold] for r in runs('Formatted by the author')],
 'plain':[[r.font.italic,r.font.underline] for r in runs('Not formatted by the author')],
 'code':[r.font.name for r in runs('def verify(x): return x')],
 'codeDefault':[r.font.name for r in runs('def default(x): return x')]}))
`,file],{encoding:'utf8'});
 assert.equal(check.status,0,check.stderr);const r=JSON.parse(check.stdout);
 assert.ok(r.manual.length&&r.manual.every(([i,u,b])=>i===true&&u===true&&b===true),'manual italic, underline and bold are exported: '+JSON.stringify(r.manual));
 assert.ok(r.plain.every(([i,u])=>i!==true&&u!==true),'an unformatted box keeps the renderer defaults: '+JSON.stringify(r.plain));
 assert.ok(r.code.every(name=>name==='Georgia'),'a font the author chose for code is kept: '+JSON.stringify(r.code));
 assert.ok(r.codeDefault.every(name=>name!=='Georgia'),'code without a chosen font stays monospace: '+JSON.stringify(r.codeDefault));
 console.log('PASS manual format export: italic, underline, bold and a chosen code font reach the generic PPTX; unformatted text keeps its defaults');
}finally{fs.rmSync(root,{recursive:true,force:true});}
