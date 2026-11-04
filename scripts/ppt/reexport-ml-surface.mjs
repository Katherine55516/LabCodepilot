/** Read the immutable prior artifact's project snapshot; render a separate
 * repair artifact using production native export. Never mutates the service. */
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {spawnSync}from'node:child_process';
import {renderTemplatePptx}from'../../apps/cowork-server/lib/ppt-template-fidelity.mjs';
import{localPptRuntime}from'../../apps/cowork-server/test/ppt-local-runtime.mjs';
const input=process.env.PPT_SURFACE_PROJECT;if(!input)throw Error('PPT_SURFACE_PROJECT is required');
const out=path.resolve(process.env.PPT_SURFACE_OUTPUT||'outputs/ppt-ml-editorial-20261020/surface');fs.mkdirSync(out,{recursive:true});
const p=JSON.parse(fs.readFileSync(input,'utf8'));p.renderOutput='/workspace/ML-Quant-Mood-Board-24p-Surface-Fixed.pptx';
const r=await renderTemplatePptx(p,localPptRuntime(out).io);fs.writeFileSync(path.join(out,'export-result.json'),JSON.stringify(r,null,2));
assert.equal(r.exportVerification.status,'passed');
const filename=r.path?.startsWith('/workspace/')?path.join(out,p.id,path.basename(r.path)):r.path||path.join(out,p.id,'ML-Quant-Mood-Board-24p-Surface-Fixed.pptx');
const expected=p.deck.slides.flatMap((s,i)=>s.nodes.filter(n=>n.semanticRole==='eyebrow'&&!n.nativeRef&&!n.style?.fill).map(n=>({page:i+1,id:n.id})));
const checked=spawnSync(process.env.PPT_TEST_PYTHON||'python3',['-c',String.raw`import sys,json,zipfile
from lxml import etree
with zipfile.ZipFile(sys.argv[1]) as z:
 ns={'p':'http://schemas.openxmlformats.org/presentationml/2006/main','a':'http://schemas.openxmlformats.org/drawingml/2006/main'}
 results=[]
 for entry in json.loads(sys.argv[2]):
  t=etree.fromstring(z.read('ppt/slides/slide%d.xml'%entry['page']))
  matches=[sp for sp in t.findall('.//p:sp',ns) if entry['id'] in str(sp.xpath('./p:nvSpPr/p:cNvPr/@name',namespaces=ns))]
  assert len(matches)==1,entry
  sp=matches[0];assert sp.find('p:spPr/a:noFill',ns) is not None,entry
  assert sp.find('p:spPr/a:solidFill',ns) is None,entry
  results.append(entry)
 assert len(results)==23,len(results)
 print(json.dumps({'pages':24,'transparentNavigationFramesChecked':len(results),'artifact':sys.argv[1]}))`,filename,JSON.stringify(expected)],{encoding:'utf8'});
if(checked.status!==0)throw Error(checked.stderr);console.log(checked.stdout);
