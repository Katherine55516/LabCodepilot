// Regression: a source figure is a declared addition, even when its new shape
// ID reuses the ID of an omitted template shape. Its bytes must still match.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {_internals} from './lib/ppt/import-pptx.mjs';

const python=process.env.PPT_TEST_PYTHON||'python3',root=fs.mkdtempSync(path.join(os.tmpdir(),'ppt-native-image-'));
try {
 const original=path.join(root,'template.pptx'),picture=path.join(root,'picture.png');
 const make=spawnSync(python,['-c',`from pptx import Presentation
from pptx.util import Inches
from pptx.enum.shapes import MSO_SHAPE
from PIL import Image
import sys
Image.new('RGB',(20,10),'red').save(sys.argv[2])
p=Presentation();s=p.slides.add_slide(p.slide_layouts[6]);s.shapes.add_picture(sys.argv[2], Inches(1), Inches(1));s.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(4), Inches(1), Inches(1), Inches(1));p.save(sys.argv[1])`,original,picture],{encoding:'utf8'});
 assert.equal(make.status,0,make.stderr);
 const image={id:'source-figure',type:'image',geometry:{x:914400,y:914400,width:1828800,height:914400},content:{dataUrl:'data:image/png;base64,'+fs.readFileSync(picture).toString('base64')},sourceArtifact:{sourceUnitId:'image-1',type:'SourceImage'},style:{}};
 const input=JSON.stringify({original,fonts:{title:'Arial',body:'Arial',titleEastAsia:'Arial',bodyEastAsia:'Arial'},slides:[{nativeSlideIndex:0,omitShapeIds:[2,3],nodes:[],sourceArtifacts:[image]}]});
 const run=(script,file,payload=input)=>spawnSync(python,['-c',script],{input:payload,encoding:'utf8',env:{...process.env,PPT_OUTPUT:path.join(root,file)},maxBuffer:8e6});
 const result=run(_internals.EXPORT_SCRIPT,'result.pptx');assert.equal(result.status,0,result.stderr);
 const read=spawnSync(python,['-c',`from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE_TYPE
import hashlib,sys
p=Presentation(sys.argv[1]); images=[s for s in p.slides[0].shapes if s.shape_type==MSO_SHAPE_TYPE.PICTURE]
assert len(images)==1
assert hashlib.sha256(images[0].image.blob).digest()==hashlib.sha256(open(sys.argv[2],'rb').read()).digest()
`,path.join(root,'result.pptx'),picture],{encoding:'utf8'});assert.equal(read.status,0,read.stderr);
 const corrupt=_internals.EXPORT_SCRIPT.replace("added_pictures[int(ids)]=hashlib.sha256(image_bytes).hexdigest()","added_pictures[int(ids)]='0'*64");
 assert.notEqual(corrupt,_internals.EXPORT_SCRIPT);
 const bad=run(corrupt,'corrupt.pptx');assert.notEqual(bad.status,0);assert.match(bad.stderr,/source image bytes changed/);
 const keep=JSON.parse(input);keep.slides[0].omitShapeIds=[3];
 const kept=run(_internals.EXPORT_SCRIPT,'kept.pptx',JSON.stringify(keep));assert.equal(kept.status,0,kept.stderr);
 const count=spawnSync(python,['-c',`from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE_TYPE
import sys
p=Presentation(sys.argv[1]);assert sum(s.shape_type==MSO_SHAPE_TYPE.PICTURE for s in p.slides[0].shapes)==2`,path.join(root,'kept.pptx')],{encoding:'utf8'});assert.equal(count.status,0,count.stderr);
 console.log('PASS source figures are declared additions and their bytes are checked');
} finally { fs.rmSync(root,{recursive:true,force:true}); }
