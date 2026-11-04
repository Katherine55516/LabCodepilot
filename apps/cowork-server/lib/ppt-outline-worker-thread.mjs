/** Worker thread for ppt-outline-worker.mjs: runs one outline task on the
 * project copy it is sent, and asks the main thread for each model call. */
import {parentPort} from 'node:worker_threads';

const {cardOutlinePostProcess,assessCandidateNow}=await import('./ppt-api.mjs');
const calls=new Map();let nextCall=0;

parentPort.on('message',async message=>{
 if(message.type==='model-result'){
  const call=calls.get(message.callId);calls.delete(message.callId);if(!call)return;
  if(message.error)call.reject(Object.assign(new Error(message.error.message),{code:message.error.code}));else call.resolve(message.value);
  return;
 }
 if(message.type!=='run')return;
 const {jobId}=message;
 const modelCall=(prompt,options)=>new Promise((resolve,reject)=>{const callId=++nextCall;calls.set(callId,{resolve,reject});parentPort.postMessage({type:'model',jobId,callId,prompt,options});});
 const log=text=>parentPort.postMessage({type:'log',jobId,message:String(text)});
 try{
  const result=message.task==='assess'?assessCandidateNow(message.project,message.raw)
   :await cardOutlinePostProcess(message.project,message.saved,{modelCall,log,revision:message.revision,id:message.id});
  parentPort.postMessage({type:'done',jobId,result});
 }catch(error){parentPort.postMessage({type:'done',jobId,error:{message:String(error?.message||error),code:error?.code}});}
});
