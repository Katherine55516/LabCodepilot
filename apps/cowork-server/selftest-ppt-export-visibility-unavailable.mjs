// Plan ppt-pipeline-unblocked phase 2: a host without a usable rendering engine
// is an environment gap, not a failed deck. Without soffice, or with one that
// cannot start (a launcher left by an uninstalled app, a binary the OS kills at
// launch: both seen on a real host), the reopened-PPTX checks still gate
// publication and rendered visibility is recorded as unavailable. A soffice
// that runs and then fails to convert still blocks publication.
// Runs on every host: PPT_SOFFICE names the engine (or a missing one), so an
// installed LibreOffice never takes part.
import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createPptHttpHarness}from'./test/ppt-http-harness.mjs';import{pipelineModelFixture,PIPELINE_SOURCE}from'./test/ppt-pipeline-model-fixture.mjs';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'ppt-export-visibility-'));
const policy={version:2,detail:'standard',selection:'editorial',archive:'none',content:'overview',language:{mode:'source',body:'both'},knowledge:'source_only'};

async function generate(h){
 const made=await h.request('POST','projects',{inputKind:'prompt',prompt:PIPELINE_SOURCE,readOnlyInput:true,template:'light',configId:'simulation-only',model:'controlled-model',generationPolicy:policy});assert.equal(made.status,201,JSON.stringify(made.body));const id=made.body.project.id;
 let p=await h.settle(id,['input_ready','failed']);assert.equal(p.status,'input_ready',p.error);
 assert.equal((await h.request('POST',`projects/${id}/planning`,{command:'outline',length:{exact:6},contentMode:'standard'})).status,202);
 p=await h.settle(id,['outline_ready','failed']);assert.equal(p.status,'outline_ready',JSON.stringify({error:p.error,failure:p.failure}));
 assert.equal((await h.request('POST',`projects/${id}/generate`,{})).status,202);
 return {id,project:await h.settle(id,['completed','failed','quality_blocked'])};
}

const h=await createPptHttpHarness({root,modelCall:pipelineModelFixture()});
try{
 // (a) No rendering engine: published, with the gap recorded.
 process.env.PPT_SOFFICE=path.join(root,'no-soffice');
 const {id,project:p}=await generate(h);
 assert.equal(p.status,'completed',JSON.stringify({error:p.error,issues:p.quality?.deterministic?.issues}));
 assert.equal(p.quality.acceptanceAxes.nativeExport.status,'verified');
 assert.equal(p.quality.acceptanceAxes.nativeExport.renderedVisibility,'unavailable');
 assert.equal(p.quality.renderedTextVerified,false,'an unavailable check is never reported as passed');
 assert.equal(p.quality.exportVerification.renderedVisibility.status,'unavailable');
 const exported=await h.request('GET',`projects/${id}/export`);assert.equal(exported.status,200);assert.ok(exported.body.length>1000);

 const fakeSoffice=script=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ppt-fake-soffice-'));fs.writeFileSync(path.join(dir,'soffice'),script,{mode:0o755});process.env.PPT_SOFFICE=path.join(dir,'soffice');};

 // (b) An engine that cannot start is not installed in any useful sense:
 // published, with the reason recorded.
 for(const [label,script,reason] of [
  ['launcher of an uninstalled app','#!/bin/sh\nexec /nonexistent/LibreOffice.app/Contents/MacOS/soffice "$@"\n',/cannot run \(version probe exit 12[67]\)/],
  ['killed at launch','#!/bin/sh\nkill -9 $$\n',/cannot run \(version probe exit -9\)/]]){
  fakeSoffice(script);
  const {project:broken}=await generate(h);
  assert.equal(broken.status,'completed',label+': '+JSON.stringify({status:broken.status,error:broken.error}));
  assert.equal(broken.quality.acceptanceAxes.nativeExport.renderedVisibility,'unavailable',label);
  assert.match(broken.quality.exportVerification.renderedVisibility.reason,reason,label);
  assert.equal(broken.quality.renderedTextVerified,false,label);
 }

 // (c) A rendering engine that runs but fails to convert: still blocked.
 fakeSoffice('#!/bin/sh\ncase "$*" in *--version*) echo "LibreOffice 99.0 (test double)"; exit 0;; esac\necho "fake soffice: conversion broken" >&2\nexit 1\n');
 const {project:blocked}=await generate(h);
 assert.equal(blocked.status,'quality_blocked',JSON.stringify({status:blocked.status,error:blocked.error}));
 assert.match(blocked.error,/exported visibility conversion failed/);
 assert.equal(blocked.quality.acceptanceAxes.nativeExport.status,'failed');
 console.log('PASS export visibility: no engine or an engine that cannot start -> published with renderedVisibility unavailable; an engine that fails to convert -> blocked');
}finally{await h.close?.();fs.rmSync(root,{recursive:true,force:true});}
process.exit(0);
