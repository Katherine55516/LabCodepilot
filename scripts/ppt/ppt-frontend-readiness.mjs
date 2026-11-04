/** Local-only readiness: invalid IDs are rejected before provider lookup/claim.
 * This checks the actual model execution route without spending model tokens. */
export async function probePptFrontend(base,request=fetch){
 try{
  const page=await request(new URL('/ppt',base),{signal:AbortSignal.timeout(10000)});
  if(!page.ok)return {ok:false,kind:'page',status:page.status};await page.body?.cancel();
  // The PPT API through the proxy, answered from memory: a probe on the
  // project list made a slow list an outage (2026-10-26, 130 projects).
  const health=await request(new URL('/api/ppt/health',base),{signal:AbortSignal.timeout(10000),cache:'no-store'});
  if(!health.ok||!health.headers.get('content-type')?.includes('application/json')||(await health.json()).ok!==true)return {ok:false,kind:'project_api',status:health.status};
  const worker=await request(new URL('/api/ppt/model-jobs/run',base),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:'readiness-invalid-id'}),signal:AbortSignal.timeout(10000)});
  const json=await worker.json().catch(()=>null);
  return worker.status===400&&json?.error==='Invalid model job ID'?{ok:true}:{ok:false,kind:'model_execution_route',status:worker.status};
 }catch{return {ok:false,kind:'transport'};}
}
