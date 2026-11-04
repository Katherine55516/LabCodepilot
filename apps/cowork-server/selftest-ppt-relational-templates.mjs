import {requireSoffice,requireInputs} from './test/ppt-tool-requirements.mjs';requireSoffice('selftest-ppt-relational-templates');
/** Real native component export on builtin and uploaded template paths.
 * These are component proofs, not whole-deck model/editorial acceptance. */
import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import crypto from 'node:crypto';import {execFileSync}from'node:child_process';
import {project}from'./selftest-ppt-editorial-relational.mjs';
import {BUILT_INS,snapshotTemplate,analyzeTemplate}from'./lib/ppt-template.mjs';
import {prepareTemplateFidelity,bindTemplateFidelity,renderTemplatePptx}from'./lib/ppt-template-fidelity.mjs';
import {importEditablePptx}from'./lib/ppt/import-pptx.mjs';
import {bindSourceArtifacts}from'./lib/ppt-source-artifacts.mjs';
import {buildRenderTree}from'./lib/ppt/render-tree.mjs';
import {inspectObjectIntegrity}from'./lib/ppt-object-integrity.mjs';
import {renderPptx}from'./lib/ppt-render.mjs';
import {localPptRuntime}from'./test/ppt-local-runtime.mjs';
const output=process.env.PPT_RELATIONAL_TEMPLATE_OUTPUT,root=output?path.resolve(output):fs.mkdtempSync(path.join(os.tmpdir(),'ppt-relational-templates-'));
fs.mkdirSync(root,{recursive:true});process.env.COWORK_STATE_DIR=path.join(root,'state');
const templateDir=process.env.PPT_MATRIX_TEMPLATE_DIR||'/Users/dongli/Desktop/Spatial_omics/templates',runtime=localPptRuntime(root),results=[];
requireInputs('selftest-ppt-relational-templates',...['Copy-of-Mood-Board.pptx','Copy-of-Deal-Review (1).pptx'].map(file=>path.join(templateDir,file)));
try{for(const [index,file]of [null,'Copy-of-Mood-Board.pptx','Copy-of-Deal-Review (1).pptx','native-component-fixture'].entries()){
 // The two uploaded templates are personal files; without them the generated fixture and the rebuilt path still run.
 if(file&&file!=='native-component-fixture'&&!fs.existsSync(path.join(templateDir,file))){console.log(`SKIP external template ${file} (set PPT_MATRIX_TEMPLATE_DIR)`);continue;}
 const p=structuredClone(project);p.id='template-'+index;p.uid='relational-template-fixture';p.title='Card structure';p.templateContentMode='design_only';
 p.outline[0].role='cover';p.outline[1].role='architecture';p.outline[2].role='closing';
 p.deck={slides:p.outline.map(s=>({id:s.id,title:s.title,nodes:[]}))};
 if(file){const bytes=file==='native-component-fixture'?execFileSync(process.env.PPT_TEST_PYTHON||'python3',['-I','-c',`import io,sys
from pptx import Presentation
from pptx.util import Inches,Pt
p=Presentation();p.slide_width=Inches(13.333);p.slide_height=Inches(7.5)
for n in range(3):
 s=p.slides.add_slide(p.slide_layouts[6])
 records=[('Template cover',2.5,1.1,38)] if n==0 else [('Questions',2.5,1.1,38)] if n==2 else [('Template title',.3,.75,28),('Template body contains a complete explanation and its source conditions.',2.3,4.4,18)]
 for value,y,height,size in records:
  sh=s.shapes.add_textbox(Inches(.6),Inches(y),Inches(12),Inches(height));sh.text=value
  for r in sh.text_frame.paragraphs[0].runs:r.font.name='Arial';r.font.size=Pt(size)
b=io.BytesIO();p.save(b);sys.stdout.buffer.write(b.getvalue())`]):fs.readFileSync(path.join(templateDir,file)),hash=crypto.createHash('sha256').update(bytes).digest('hex');
  const id=String(index).padStart(32,'0');p.templateSpec={...await analyzeTemplate(p.uid,id,'pptx',bytes,runtime.io),id,kind:'uploaded',extension:'pptx',sha256:hash};p.template=p.templateSpec.id;
  (await import('./lib/ppt-store.mjs')).writeTemplate(p.uid,id,bytes);
  p.templateFidelity=await prepareTemplateFidelity(p,bytes,hash,p.templateSpec,{writeFile:runtime.writeFile,importPptx:(q,b,h)=>importEditablePptx(q,b,h,runtime.io)});
 }else{p.template='blue';p.templateSpec=snapshotTemplate(BUILT_INS.find(t=>t.id==='blue'));}
 bindSourceArtifacts(p,p.deck.slides[1],p.planning.slidePlan[1].sourceArtifacts,1);bindTemplateFidelity(p);
 assert.deepEqual(inspectObjectIntegrity(p).issues,[]);p.renderTree=buildRenderTree(p);
 fs.writeFileSync(path.join(root,p.id+'.json'),JSON.stringify(p,null,2));
 const info=await(file?renderTemplatePptx(p,runtime.io):renderPptx(p,runtime.io));assert.equal(info.exportVerification.status,'passed');
 const graph=p.deck.slides[1].nodes.find(n=>n.content?.diagram?.relational),expectedEdges=graph?.content.diagram.relational.edges.length||0;
 const nativeFile=path.join(root,p.id,'presentation.pptx');
 const probe=JSON.parse(execFileSync(process.env.PPT_TEST_PYTHON||'python3',['-I','-c',`import sys,json
from pptx import Presentation
p=Presentation(sys.argv[1]);edges=set()
for sh in p.slides[1].shapes:
 if sh.name.startswith('AIMate decor:flow:'):edges.add(sh.name.split(':')[-2])
print(json.dumps({'pages':len(p.slides),'edges':sorted(edges)}))`,nativeFile],{encoding:'utf8'}));
 assert.equal(probe.pages,3);assert.equal(probe.edges.length,expectedEdges,'native uploaded-template export retains the actual source connectors');
 if(file==='native-component-fixture')assert.equal(expectedEdges,7,'a spacious native template exercises actual cards and connectors, not only a table fallback');
 const result={template:file||'blue',path:file?'preserved_native':'rebuilt_native',nativeEdges:expectedEdges,component:p.deck.slides[1].sourceArtifactNodes[0].type,exportVerification:info.exportVerification};results.push(result);
 console.log(JSON.stringify({template:result.template,path:result.path,edges:expectedEdges,status:'passed'}));
}
fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify({status:'passed',boundary:'real component binding/template export/Office verification; no model editorial claim',results},null,2));
}finally{if(!output)fs.rmSync(root,{recursive:true,force:true});}
