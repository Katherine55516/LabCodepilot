/** DrawingML integer coordinate regression: a real table grid produced .6 EMU. */
import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {_internals as exporter} from './lib/ppt-render.mjs';
const python=process.env.PPT_TEST_PYTHON||'python3',dir=fs.mkdtempSync(path.join(os.tmpdir(),'ppt-fractional-emu-'));
const bounds={x:4600041.6,y:2549500.25,width:6799478.4,height:2970581.75};
const elements=[{id:'table',nodeId:'table',kind:'table',bounds,content:{rows:[['Field','Description'],['audience','Retain the source audience.']]},style:{fontSizePt:18}},{id:'text',nodeId:'text',kind:'text',bounds:{x:900000.25,y:1100000.75,width:9000000.4,height:800000.6},content:{text:'Fractional layout remains editable.'},style:{fontSizePt:24}},{id:'shape',nodeId:'shape',kind:'shape',bounds:{x:900000.6,y:2200000.4,width:500000.4,height:500000.6},content:{shape:'rectangle',fill:'#6758c8'},style:{}},{id:'math',nodeId:'math',kind:'text',bounds:{x:900000,y:3300000,width:2000000,height:1000000},mathLayout:{bounds:{x:950000.75,y:3300000.25,width:2000000.4,height:1000000.6}},content:{mathMl:'<math xmlns="http://www.w3.org/1998/Math/MathML"><mi>x</mi></math>'},style:{fontSizePt:18}}];
const before=JSON.stringify(elements),file=path.join(dir,'actual.pptx');
try{
 const result=spawnSync(python,['-c',exporter.SCRIPT],{input:JSON.stringify({slides:[{title:'Coordinate contract',bullets:[]}],renderTree:{slides:[{id:'s',size:{width:12192000,height:6858000},elements}]},fonts:{title:'Arial',body:'Arial',titleEastAsia:'Noto Sans CJK SC',bodyEastAsia:'Noto Sans CJK SC',cjkExplicit:true},palette:{background:'#ffffff',accent:'#6758c8',foreground:'#111827',muted:'#222222'}}),env:{...process.env,PPT_OUTPUT:file},maxBuffer:4e6});assert.equal(result.status,0,result.stderr.toString());
 const check=spawnSync(python,['-c',String.raw`
import sys,re,json
from zipfile import ZipFile
from lxml import etree
from pptx import Presentation
p=Presentation(sys.argv[1]);s=p.slides[0]
for shape in s.shapes:
    assert all(isinstance(value,int) for value in (shape.left,shape.top,shape.width,shape.height))
table=next(shape for shape in s.shapes if shape.has_table)
assert table.left==4600042 and table.top==2549500 and table.width==6799478 and table.height==2970582
assert table.table.cell(1,1).text=='Retain the source audience.'
assert any(shape.has_text_frame and shape.text=='Fractional layout remains editable.' for shape in s.shapes)
with ZipFile(sys.argv[1]) as z:
    for name in z.namelist():
        if name.startswith('ppt/slides/') and name.endswith('.xml'):
            for element in etree.fromstring(z.read(name)).iter():
                if etree.QName(element).localname in ('off','ext','chOff','chExt'):
                    for key,value in element.attrib.items():
                        if key in ('x','y','cx','cy'):assert re.fullmatch(r'-?\d+',value),(key,value)
print(json.dumps({'pptxReopened':True,'allDrawingCoordinatesIntegral':True,'sourceTableTextUnchanged':True}))
`,file],{maxBuffer:1e6});assert.equal(check.status,0,check.stderr.toString());assert.equal(JSON.stringify(elements),before,'serialization must not mutate editor/source geometry');console.log(check.stdout.toString().trim());
}finally{fs.rmSync(dir,{recursive:true,force:true});}
