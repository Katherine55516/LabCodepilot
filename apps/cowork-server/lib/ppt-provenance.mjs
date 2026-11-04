import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const fingerprint=files=>{try{return hash(files.map(file=>file+':'+hash(fs.readFileSync(path.join(root,file)))).join('\n'));}catch{return null;}};
// Captured when this server module loads, never relabel an old checkpoint
// with the code currently on disk after a later edit.
const implementationHash=(()=>{const files=[];const walk=dir=>{for(const e of fs.readdirSync(path.join(root,dir),{withFileTypes:true})){const name=path.join(dir,e.name);if(e.isDirectory())walk(name);else if(name.endsWith('.mjs'))files.push(name);}};try{walk('');return fingerprint(files.sort());}catch{return null;}})();
const sourceParserHash=fingerprint(['ppt-source.mjs','ppt-document-extraction-python.mjs','ppt-pdf-layout-recovery.mjs','ppt-content-inventory.mjs']);
export const sourceParsingReceipt=source=>({version:1,parser:'ppt-source-20261028',implementationHash:sourceParserHash,sourceHash:source?.sha256||null,at:new Date().toISOString()});
export const generationReceipt=project=>({version:1,implementationHash,promptContractVersion:project.promptContractVersion,model:project.model,configId:project.configId,runId:project.currentRunId||null,at:new Date().toISOString()});
export function projectVersionDetails(project){
 return {source:project.provenance?.sourceParsing||null,generation:project.provenance?.generation||null,origin:project.provenance?.origin||null,sourceHash:project.source?.sha256||null,
  models:(project.modelUsage||[]).slice(-30).map(row=>({stage:row.stage,model:row.model})),draftRevision:project.revision,publishedRevision:project.publishedRevision,
  publishedRenderContractVersion:project.publishedRenderTree?.renderContractVersion??(project.quality?.exportVerification?.revision===project.publishedRevision?project.quality?.exportVerification?.renderContractVersion:null)};
}
/** A fresh project re-reads the original material; it never clones an edited
 * deck and calls it new generation. Image bytes remain input material. */
export function reparseInput(project,sourceBytes){
 if(!['prompt','paste','file'].includes(project.inputKind)||project.update)throw Object.assign(Error('This source needs its original update/import workflow; it cannot be recreated as one input.'),{statusCode:409});
 const input={inputKind:project.inputKind,prompt:project.prompt||'',readOnlyInput:true,template:project.template,templateContentMode:project.templateContentMode,templateFixedObjectIds:project.templateFixedObjectIds||[],configId:project.configId,model:project.model,generationPolicy:project.generationPolicy,executionPolicy:project.executionPolicy};
 if(project.deckTitle?.source==='user'&&project.deckTitle?.locked)input.title=project.deckTitle.raw||project.deckTitle.text;
 // Parser-created file figures are recovered from the original bytes. Do
 // not feed their full scientific captions/large rasters through the bounded
 // pasted-attachment schema. Legacy user attachments have other IDs.
 const images=project.inputSnapshot?.images??(project.inputKind==='file'?(project.source?.images||[]).filter(i=>!/^source_image_[a-f0-9]+$/iu.test(i.id||'')):project.source?.images||[]);
 input.images=images.filter(i=>i.dataUrl).map(i=>({id:i.id,fileName:i.fileName||i.name||i.id,dataUrl:i.dataUrl,caption:i.caption,required:i.required}));
 if(project.inputKind==='file'){
  if(!Buffer.isBuffer(sourceBytes)||!sourceBytes.length)throw Object.assign(Error('Original source bytes are unavailable; upload the original file again.'),{statusCode:409});
  if(project.source?.sha256&&hash(sourceBytes)!==project.source.sha256)throw Object.assign(Error('Original source hash differs; recreation was refused.'),{statusCode:409});
  input.fileName=project.source.name;input.fileBase64=sourceBytes.toString('base64');
 }else{
  if(project.inputKind==='paste')input.text=project.inputSnapshot?.text??project.source?.text??'';
  if(project.inputKind==='prompt')input.prompt=project.inputSnapshot?.text??project.prompt??'';
  if(!(input.text||input.prompt||input.images.length))throw Object.assign(Error('Original input is unavailable.'),{statusCode:409});
 }
 return input;
}
