/** Actual native export/Office visibility, separate from controlled semantics. */
import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {execFileSync}from'node:child_process';
import {project,scene}from'./selftest-ppt-editorial-relational.mjs';
import {renderPptx}from'./lib/ppt-render.mjs';
import {localPptRuntime}from'./test/ppt-local-runtime.mjs';
import {normalizePaste}from'./lib/ppt-source.mjs';
import {applyPresentationPolicy}from'./lib/ppt-presentation-policy.mjs';
import {auditSourceGraphs} from './test/ppt-graph-audit-fixture.mjs';
import {bindSourceArtifacts}from'./lib/ppt-source-artifacts.mjs';
import {buildRenderTree}from'./lib/ppt/render-tree.mjs';
import {inspectObjectIntegrity}from'./lib/ppt-object-integrity.mjs';
import {exportManifest,acceptExportVerification,EXPORT_VERIFY_SCRIPT}from'./lib/ppt-export-integrity.mjs';
const output=process.env.PPT_RELATIONAL_OUTPUT,root=output?path.resolve(output):fs.mkdtempSync(path.join(os.tmpdir(),'ppt-relational-export-'));fs.mkdirSync(root,{recursive:true});
try{
 const result=await renderPptx({...project,renderTree:scene},localPptRuntime(root).io);assert.equal(result.exportVerification.status,'passed');
 const file=path.join(root,project.id,'presentation.pptx'),probe=JSON.parse(execFileSync(process.env.PPT_TEST_PYTHON||'python3',['-I','-c',`import sys,json
from pptx import Presentation
p=Presentation(sys.argv[1]);edges=set();cards=[]
for s in p.slides:
 for sh in s.shapes:
  if sh.name.startswith('AIMate decor:flow:'):
   parts=sh.name.split(':');edges.add(parts[-2])
  if sh.has_text_frame:cards.append(sh.text)
print(json.dumps({'pages':len(p.slides),'edges':sorted(edges),'text':'\\n'.join(cards)}))`,file],{encoding:'utf8'}));
 const graph=project.source.semantic.inventory.items.find(i=>i.diagramSource?.graph).diagramSource.graph;
 assert.equal(probe.pages,3);assert.equal(probe.edges.length,graph.edges.length);for(const n of graph.nodes)assert.ok(probe.text.includes(n.label),'native source label '+n.label);
 assert.throws(()=>acceptExportVerification(project,{exportVerification:{...result.exportVerification,relationRouteVersion:undefined}}),/relation routes/,'old verification cannot authorize an unverified connector artifact');
 const routeProof=JSON.parse(execFileSync(process.env.PPT_TEST_PYTHON||'python3',['-I','-c',`import sys,json
from pptx import Presentation
from pptx.oxml.ns import qn
${EXPORT_VERIFY_SCRIPT}
manifest=json.load(sys.stdin);node=next(n for n in manifest['slides'][1]['nodes'] if (n.get('content') or {}).get('pointLayout',{}).get('connectors'))
def sample():
 p=Presentation(sys.argv[1]);s=p.slides[1];line=next(sh for sh in s.shapes if sh.name.startswith('AIMate decor:flow:'));return s,line
s,line=sample();errors=[];count=verify_point_routes(list(s.shapes),node,errors);assert not errors,errors
s,line=sample();s.shapes._spTree.remove(line._element);errors=[];verify_point_routes(list(s.shapes),node,errors);assert any('relation segment' in e for e in errors),errors
s,line=sample();line.end_x+=10000;errors=[];verify_point_routes(list(s.shapes),node,errors);assert any('direction/route' in e for e in errors),errors
s,line=sample();line.name='AIMate decor:flow:'+node['id']+':invented:0';errors=[];verify_point_routes(list(s.shapes),node,errors);assert any('unsupported relation' in e for e in errors),errors
s,line=sample();arrow=next(sh for sh in s.shapes if sh._element.find('.//'+qn('a:tailEnd')) is not None);tail=arrow._element.find('.//'+qn('a:tailEnd'));tail.getparent().remove(tail);errors=[];verify_point_routes(list(s.shapes),node,errors);assert any('arrow missing' in e for e in errors),errors
print(json.dumps({'segments':count,'negativeChecks':['missing segment','changed route','invented relation','missing arrow']}))`,file],{input:JSON.stringify(exportManifest(project,scene)),encoding:'utf8',maxBuffer:5000000}));
 const markdown='# Relation variants\n\n## Decision\n\n```text\nAllowed?\n ├─ Yes\n └─ No\n```\n\n## Lanes\n\n| Role | Stage | Action |\n|---|---|---|\n| Research | 1 | Collect evidence |\n| Writing | 1 | Explain evidence |\n| Research | 2 | Check sources |\n\n## Calendar\n\n| Date | Event |\n|---|---|\n| 2025-01-01 | Read |\n| 2025-02-01 | Write |\n| 2025-03-01 | Review |';
 const variant={id:'relation-variants',revision:1,template:'light',templateSpec:project.templateSpec,generationPolicy:project.generationPolicy};
 variant.source=applyPresentationPolicy(normalizePaste(markdown),variant);
 auditSourceGraphs(variant,{equivalent:true});
 const units=variant.source.semantic.inventory.items.filter(i=>i.rows);
 variant.outline=[{id:'cover',title:'Source relations'},...units.map((u,i)=>({id:'variant-'+i,title:u.sectionPath.at(-1),sourceUnitIds:[u.id]})),{id:'end',title:'Review'}];
 variant.pages=variant.outline.length;variant.pageDecision={mode:'explicit',finalPageCount:variant.pages};variant.planning={slidePlan:variant.outline.map(s=>({slideId:s.id,sourceArtifacts:(s.sourceUnitIds||[]).map(sourceUnitId=>({sourceUnitId}))}))};
 variant.deck={slides:variant.outline.map(s=>({id:s.id,title:s.title,nodes:[]}))};
 for(let i=1;i<variant.pages-1;i++)bindSourceArtifacts(variant,variant.deck.slides[i],variant.planning.slidePlan[i].sourceArtifacts,i);
 assert.deepEqual(inspectObjectIntegrity(variant).issues,[]);
 const kinds=variant.deck.slides.flatMap(s=>s.nodes||[]).flatMap(n=>n.content?.diagram?[n.content.diagram.kind]:[]);assert.deepEqual(kinds,['decision','swimlane','timeline']);
 const variants=await renderPptx({...variant,renderTree:buildRenderTree(variant)},localPptRuntime(root).io);assert.equal(variants.exportVerification.status,'passed');
 fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify({status:'passed',boundary:'deterministic structural fixture; no real model quality claim',exportVerification:result.exportVerification,probe,routeProof,variants:{kinds,exportVerification:variants.exportVerification}},null,2));
 console.log(JSON.stringify({status:'passed',pages:probe.pages,nativeSourceEdges:probe.edges.length,file}));
}finally{if(!output)fs.rmSync(root,{recursive:true,force:true});}
