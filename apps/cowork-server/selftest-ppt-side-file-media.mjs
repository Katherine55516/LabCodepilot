// Command checkpoints, operations, revisions and proposals keep inline images
// as account media references, like the project file (live mlq-r34: a restore
// on a 48-page deck with template photos built a ~600 MB checkpoint string and
// failed with "RangeError: Invalid string length").
import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'ppt-side-media-'));process.env.COWORK_STATE_DIR=root;
try{
 const repo=await import('./lib/ppt/repository.mjs');
 const image='data:image/png;base64,'+'A'.repeat(200000),uid='side-media',id='a'.repeat(32);
 const project={uid,id,revision:3,deck:{slides:[{id:'s1',nodes:[{id:'n1',type:'image',content:{src:image}},{id:'n2',type:'image',content:{src:image}}]}]},renderTree:null};
 const dir=repo.projectDataDir(uid,id),size=file=>fs.statSync(file).size;
 // Checkpoint and its recovery.
 repo.checkpointCommit(project,{id:'op1',status:'committed',kind:'command',command:{payload:{deck:project.deck}},inverse:{deck:project.deck}},'test');
 const marker=path.join(dir,'pending-command.json');assert.ok(size(marker)<20000,'checkpoint keeps media references: '+size(marker));
 assert.equal(repo.readJson(marker,null,uid).project.deck.slides[0].nodes[1].content.src,image,'the checkpoint revives its images');
 // Operations log.
 repo.appendJsonLine(repo.operationsFile(uid,id),{id:'op2',status:'committed',command:{payload:{deck:project.deck}}},uid);
 assert.ok(size(repo.operationsFile(uid,id))<20000);assert.equal(repo.readJsonLines(repo.operationsFile(uid,id),uid)[0].command.payload.deck.slides[0].nodes[0].content.src,image);
 // Revisions, read singly and listed.
 repo.saveRevision(project,'test');const revision=path.join(dir,'revisions','3.json');
 assert.ok(size(revision)<20000,'revision keeps media references: '+size(revision));
 assert.equal(repo.readRevision(uid,id,3).deck.slides[0].nodes[0].content.src,image);assert.equal(repo.listRevisions(uid,id)[0].deck.slides[0].nodes[1].content.src,image);
 // A file written before references still reads (inline data URI).
 fs.writeFileSync(path.join(dir,'revisions','2.json'),JSON.stringify({revision:2,deck:project.deck}));assert.equal(repo.readRevision(uid,id,2).deck.slides[0].nodes[0].content.src,image);
 console.log('PPT side files (checkpoint, operations, revisions) keep media references and revive them: OK');
}finally{fs.rmSync(root,{recursive:true,force:true});}
