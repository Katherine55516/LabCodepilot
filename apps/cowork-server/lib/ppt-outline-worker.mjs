/** Runs the card outline's CPU-heavy steps in a worker thread (user decision
 * 2026-10-31, D3): on the server's event loop they left every request
 * unanswered for 40-100 s on a large document (docx/xlsx). The worker imports
 * the same modules, works on a copy of the project and sends back the result;
 * a model call it needs is answered here, on the thread that owns the model
 * queue. Without a worker (PPT_OUTLINE_WORKER=0, or one that cannot start or
 * is lost) the same function runs inline, as before.
 * Tasks: postProcess (capacity splits, table fonts, titles, parts, appendix)
 * and assess (the candidate measured on its pages, figures placed). */
import {Worker} from 'node:worker_threads';

let worker=null,nextJob=0;
const jobs=new Map();

function failAll(error){for(const job of jobs.values())job.reject(error);jobs.clear();worker=null;}
function ensureWorker(){
 if(worker)return worker;
 worker=new Worker(new URL('./ppt-outline-worker-thread.mjs',import.meta.url));
 worker.on('message',message=>{
  const job=jobs.get(message.jobId);if(!job)return;
  if(message.type==='log'){job.log(message.message);return;}
  if(message.type==='model'){
   job.modelCall(message.prompt,message.options).then(value=>({value}),error=>({error:{message:String(error?.message||error),code:error?.code}}))
    .then(reply=>worker?.postMessage({type:'model-result',jobId:message.jobId,callId:message.callId,...reply}));
   return;
  }
  if(message.type==='done'){jobs.delete(message.jobId);
   if(message.error)job.reject(Object.assign(new Error(message.error.message),{code:message.error.code}));
   else job.resolve(message.result);}
 });
 worker.on('error',failAll);
 worker.on('exit',code=>{if(jobs.size)failAll(Object.assign(new Error(`outline worker exited (${code})`),{code:'worker_unavailable'}));worker=null;});
 // An idle worker never keeps the process alive.
 worker.unref();
 return worker;
}

async function runTask(task,payload,{modelCall=async()=>{throw new Error('no model call in this task');},log=()=>{},id},inline){
 if(process.env.PPT_OUTLINE_WORKER==='0')return inline();
 let thread;try{thread=ensureWorker();}catch(error){log(`ppt ${id} outline worker unavailable (${String(error?.message||error).slice(0,120)}); ${task} inline`);return inline();}
 const jobId=++nextJob;
 try{
  return await new Promise((resolve,reject)=>{
   jobs.set(jobId,{resolve,reject,log,modelCall});
   // A running job keeps the process alive until it answers.
   thread.ref();thread.postMessage({type:'run',task,jobId,...payload});
  });
 }catch(error){
  // A cancellation or a real failure is the outline's; a lost worker is retried inline.
  if(error?.code!=='worker_unavailable')throw error;
  log(`ppt ${id} outline worker lost (${String(error.message).slice(0,120)}); ${task} inline`);return inline();
 }finally{if(!jobs.size)worker?.unref();}
}

export function runCardPostProcess(project,saved,{modelCall,log=()=>{},revision,id}){
 return runTask('postProcess',{project,saved,revision,id},{modelCall,log,id},async()=>(await import('./ppt-api.mjs')).cardOutlinePostProcess(project,saved,{modelCall,log,revision,id}));
}
export function runAssessCandidate(project,raw,{log=()=>{},id}){
 return runTask('assess',{project,raw},{log,id},async()=>(await import('./ppt-api.mjs')).assessCandidateNow(project,raw));
}
